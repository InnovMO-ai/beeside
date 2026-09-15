import { FA_FIELDS } from "@beeside/canonical-fields";
import { checkFieldRegistry } from "../fa/admin/field-registry";
import { getFirstAssessmentPrecisionContext } from "../precision-context/first-assessment-context";
import { MANUFACTURER, describeWithDb, identity, runJourney, useHarness } from "./fa-harness";

describeWithDb("First Assessment core (PostgreSQL, rolled back)", () => {
  const h = useHarness();

  async function start(overrides: Record<string, unknown> = {}) {
    const res = await h.api().post("/api/fa/identity").send(identity(overrides));
    expect(res.status).toBe(201);
    return res.body.sessionToken as string;
  }

  async function projectOf(token: string) {
    const { rows } = await h.client.query(
      `SELECT p.* FROM project p JOIN project_access_token t ON t.project_id = p.project_id
        WHERE t.token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')`,
      [token],
    );
    return rows[0];
  }

  it("keeps field_key_registry synchronized with shared/canonical-fields and rejects manual inserts", async () => {
    expect(await checkFieldRegistry(h.client)).toEqual({ missing: [], extra: [], changed: [] });
    const { rows } = await h.client.query("SELECT count(*)::int AS n FROM field_key_registry WHERE module = 'first_assessment' AND active");
    expect(rows[0].n).toBe(FA_FIELDS.length);
    await h.client.query("SAVEPOINT manual");
    await expect(
      h.client.query("INSERT INTO field_key_registry (field_key, data_type, source, module) VALUES ('fa.manual.key', 'text', 'x', 'first_assessment')"),
    ).rejects.toMatchObject({ code: "BV403" });
    await h.client.query("ROLLBACK TO SAVEPOINT manual");
  });

  it("creates person → company → project with pinned versions, legal acceptance and a working session", async () => {
    const token = await start();
    const project = await projectOf(token);
    expect(project.assessment_state).toBe("IN_PROGRESS");
    expect(project.question_bank_version).toBe("fa-qb-1.0.0");
    expect(project.created_by_person_id).toBe(project.responsible_person_id);

    const person = (await h.client.query("SELECT * FROM person WHERE person_id = $1", [project.created_by_person_id])).rows[0];
    expect(person.primary_email).toBe("ana.rivera@northwind-test.example");
    expect(person.interface_language).toBe("es");
    const company = (await h.client.query("SELECT * FROM company WHERE company_id = $1", [project.company_id])).rows[0];
    expect(company).toMatchObject({ normalized_domain: "northwind-test.example", email_domain: "northwind-test.example", normalized_name: "northwind manufacturing" });

    const legal = await h.client.query("SELECT document, document_url FROM legal_acceptance WHERE project_id = $1 ORDER BY document", [project.project_id]);
    expect(legal.rows).toEqual([
      { document: "PRIVACY_POLICY", document_url: null },
      { document: "TERMS", document_url: "https://www.beeside.you/termsandconditions" },
    ]);
    const transitions = await h.client.query("SELECT from_state, to_state FROM assessment_state_transition WHERE project_id = $1", [project.project_id]);
    expect(transitions.rows).toEqual([{ from_state: "DRAFT", to_state: "IN_PROGRESS" }]);

    const view = await h.api().get("/api/fa/session").set("Authorization", `Bearer ${token}`);
    expect(view.status).toBe(200);
    expect(view.body).toMatchObject({ status: "IN_PROGRESS", currentStepId: "project_story", finishLaterAvailable: true, interfaceLanguage: "es" });

    const events = await h.client.query("SELECT * FROM fa_journey_event WHERE project_id = $1", [project.project_id]);
    expect(events.rows.map((e) => e.event_type)).toEqual(["identity_completed"]);
    expect(JSON.stringify(events.rows)).not.toMatch(/ana|rivera|northwind/i);
  });

  it("requires legal acceptance and accepts personal email domains without a company email signal", async () => {
    const refused = await h.api().post("/api/fa/identity").send(identity({ acceptLegal: false }));
    expect(refused.status).toBe(400);
    expect(refused.body.details.fields).toContain("acceptLegal");

    const token = await start({ email: "ana.rivera.personal@gmail.com", website: "", personalEmailAcknowledged: true });
    const project = await projectOf(token);
    const company = (await h.client.query("SELECT email_domain, normalized_domain FROM company WHERE company_id = $1", [project.company_id])).rows[0];
    expect(company).toEqual({ email_domain: null, normalized_domain: null });
    const ack = await h.client.query("SELECT value FROM answer WHERE project_id = $1 AND field_key = 'fa.identity.personal_email_acknowledged'", [project.project_id]);
    expect(ack.rows[0].value).toBe("yes");
  });

  it("validates applicability and values, and revises answers append-only", async () => {
    const token = await start();
    const auth = { Authorization: `Bearer ${token}` };
    const put = (id: string, value: unknown) => h.api().put(`/api/fa/session/answers/${id}`).set(auth).send({ value });

    expect((await put("G3", "not_yet")).status).toBe(200);
    expect((await put("G4", { precision: "month", value: "2027-05" })).body.error).toBe("NOT_APPLICABLE");
    expect((await put("CAP1", ["not_sure", "tax"])).status).toBe(400);
    expect((await put("G3", "sometime")).status).toBe(400);

    expect((await put("P3", "exploring")).status).toBe(200);
    expect((await put("P3", "already_operating")).status).toBe(200);
    const growth = await put("GROWTH1", ["grow_sales"]);
    expect(growth.body.answers.GROWTH1).toEqual(["grow_sales"]);
    const back = await put("P3", "validating");
    expect(back.body.answers.GROWTH1).toBeUndefined();

    const project = await projectOf(token);
    const history = await h.client.query(
      "SELECT value, superseded_by IS NULL AS current FROM answer WHERE project_id = $1 AND field_key = 'fa.project.stage' ORDER BY answered_at, created_at",
      [project.project_id],
    );
    expect(history.rows.map((r) => r.value)).toEqual(["exploring", "already_operating", "validating"]);
    expect(history.rows.filter((r) => r.current)).toHaveLength(1);
    const stored = await h.client.query("SELECT value FROM answer WHERE project_id = $1 AND field_key = 'fa.operation.growth_focus'", [project.project_id]);
    expect(stored.rows).toHaveLength(1);
  });

  it("refuses to skip ahead or confirm a step with missing required answers", async () => {
    const token = await start();
    const auth = { Authorization: `Bearer ${token}` };
    expect((await h.api().post("/api/fa/session/steps/goal/complete").set(auth).send({})).body.error).toBe("INCOMPLETE");
    const missing = await h.api().post("/api/fa/session/steps/project_story/complete").set(auth).send({});
    expect(missing.body).toMatchObject({ error: "INCOMPLETE", details: { missing: ["STORY", "ANOTHER_PROJECT"] } });
  });

  it("runs the full journey to COMPLETED_LOCKED, freezes answers and exposes the FA → Precision context", async () => {
    const token = await start();
    const view = await runJourney(h, token, MANUFACTURER);
    expect(view.status).toBe("COMPLETED_LOCKED");

    const project = await projectOf(token);
    const locked = await h.api().put("/api/fa/session/answers/C5").set("Authorization", `Bearer ${token}`).send({ value: "Changed" });
    expect(locked.body.error).toBe("LOCKED");
    await h.client.query("SAVEPOINT direct");
    await expect(
      h.client.query(
        "INSERT INTO answer (project_id, field_key, value, value_type, question_bank_version) VALUES ($1, 'fa.project.primary_concern', '\"x\"', 'text', 'fa-qb-1.0.0')",
        [project.project_id],
      ),
    ).rejects.toMatchObject({ code: "BV409" });
    await h.client.query("ROLLBACK TO SAVEPOINT direct");

    const events = await h.client.query("SELECT event_type, count(*)::int AS n FROM fa_journey_event WHERE project_id = $1 GROUP BY event_type", [project.project_id]);
    const counts = Object.fromEntries(events.rows.map((r) => [r.event_type, r.n]));
    expect(counts.assessment_completed).toBe(1);
    expect(counts.step_completed).toBeGreaterThanOrEqual(10);
    expect(counts.answer_saved).toBeGreaterThanOrEqual(40);
    const leaked = await h.client.query("SELECT count(*)::int AS n FROM fa_journey_event WHERE properties::text ~* 'valve|monterrey|ana'");
    expect(leaked.rows[0].n).toBe(0);

    const context = await getFirstAssessmentPrecisionContext(h.deps.db, h.deps.bundles, project.project_id);
    expect(context).toMatchObject({
      projectId: project.project_id,
      personId: project.created_by_person_id,
      companyId: project.company_id,
      person: { firstName: "Ana", lastName: "Rivera", preferredName: "Ana", interactionLanguage: "es", deliverableLanguage: "en" },
      targetMarkets: ["MX"],
      industry: "manufacturing",
      projectObjective: "set_up_local_operation",
      timing: { launchTimingStatus: "firm_commitment", launchTarget: { precision: "quarter", value: "2027-Q2" }, timingDriver: "customer_contract" },
      declaredPriority: { priorityKnown: "yes", clientPriority: "local_entity_legal_setup", timing: "within_30_days", reason: null },
      assessment: { status: "COMPLETED_LOCKED", questionBankVersion: "fa-qb-1.0.0" },
      findings: [],
      snapshot: null,
    });
    expect(context?.assessment.completedAt).not.toBeNull();
    expect(context?.openTextAnswers["fa.project.story_raw"]?.value).toBe(MANUFACTURER.STORY);
    expect(context?.structuredAnswers["fa.operation.components"]?.value).toEqual(["manufacturing", "import_export", "local_workforce"]);
    expect(context?.structuredAnswers["fa.operation.growth_focus"]).toBeUndefined();
    expect(context?.notSureFieldKeys).toEqual(["fa.operation.workforce.first_year_headcount"]);

    const another = await h.api().post("/api/fa/session/another-project").set("Authorization", `Bearer ${token}`).send({ acceptLegal: true });
    expect(another.status).toBe(201);
    const second = await projectOf(another.body.sessionToken);
    expect(second.company_id).toBe(project.company_id);
    expect(second.created_by_person_id).toBe(project.created_by_person_id);
    expect(second.project_id).not.toBe(project.project_id);
  });
});
