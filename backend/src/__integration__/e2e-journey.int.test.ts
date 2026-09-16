import { getFirstAssessmentPrecisionContext } from "../precision-context/first-assessment-context";
import { getPrecisionStartContext } from "../premium/precision-handoff";
import { processSubscriptionEvent } from "../premium/subscription-events";
import { MANUFACTURER, describeWithDb, identity, lastLinkToken, runJourney, useHarness } from "./fa-harness";

/**
 * End-to-end QA (Build Plan v1.1 Phase 14). These are not unit checks of one service: each test
 * drives the whole product through its public API exactly as the web app does — entry, identity,
 * the four stages, Finish Later, the emailed private link, resume, completion, the Snapshot, the
 * feedback question, the Premium transition and the Precision handoff — and verifies that the same
 * person, company and project identity carries through without duplicating First Assessment context.
 */
describeWithDb("End-to-end journeys (PostgreSQL, rolled back)", () => {
  const h = useHarness();
  const DAY = 86_400_000;
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  /** Same persona, already operating in the destination market instead of entering it. */
  const ALREADY_OPERATING: Record<string, unknown> = { ...MANUFACTURER, P3: "already_operating", GROWTH1: ["grow_sales"] };
  /** Same persona, working entirely in English. */
  const ENGLISH: Record<string, unknown> = { ...MANUFACTURER, S6_INTERACTION: "en", S6_DELIVERABLE: "en" };

  async function start(email: string, overrides: Record<string, unknown> = {}) {
    const res = await h.api().post("/api/fa/identity").send(identity({ email, ...overrides }));
    expect(res.status).toBe(201);
    return res.body.sessionToken as string;
  }

  async function projectOf(token: string) {
    const { rows } = await h.client.query(
      `SELECT p.*, l.completed_at FROM project p
         LEFT JOIN fa_project_lifecycle l ON l.project_id = p.project_id
         JOIN project_access_token t ON t.project_id = p.project_id
        WHERE t.token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')`,
      [token],
    );
    return rows[0];
  }

  const count = async (sql: string, params: unknown[] = []) => (await h.client.query<{ n: number }>(sql, params)).rows[0]?.n ?? 0;

  it("carries one identity from entry to the Precision handoff: Finish Later, private link, resume, Snapshot, feedback and Premium", async () => {
    // --- entry and identity -------------------------------------------------------------------
    await h.api().post("/api/fa/events").send({
      anonymousSessionId: "3f2b1a0c-5d4e-4f6a-9b8c-7d6e5f4a3b2c",
      events: [{ type: "assessment_entered", interfaceLanguage: "es" }, { type: "assessment_started" }],
    });
    const token = await start("e2e.new.user@northwind-test.example");
    const project = await projectOf(token);
    expect(project.assessment_state).toBe("IN_PROGRESS");

    const legal = await h.client.query("SELECT document FROM legal_acceptance WHERE project_id = $1 ORDER BY document", [project.project_id]);
    expect(legal.rows.map((r) => r.document)).toEqual(["PRIVACY_POLICY", "TERMS"]);

    // --- first answers, then Finish Later --------------------------------------------------------
    await h.api().put("/api/fa/session/answers/STORY").set(auth(token)).send({ value: MANUFACTURER.STORY });
    await h.api().put("/api/fa/session/answers/ANOTHER_PROJECT").set(auth(token)).send({ value: "no" });
    const saved = await h.api().post("/api/fa/session/finish-later").set(auth(token));
    expect(saved.status).toBe(200);
    expect(new Date(saved.body.accessUntil as string).getTime()).toBe(h.clock.now.getTime() + 15 * DAY);
    expect(h.email.messages.map((m) => m.template)).toEqual(["resume_link"]);
    const link = lastLinkToken(h);

    // --- resume from the emailed private link, days later ---------------------------------------
    h.advanceDays(3);
    const opened = await h.api().post("/api/fa/links/open").send({ token: link });
    expect(opened.body).toMatchObject({ canContinue: true, closed: false, completed: false });
    const resumed = await h.api().post("/api/fa/links/continue").send({ token: link });
    expect(resumed.status).toBe(201);
    const resumedToken = resumed.body.sessionToken as string;
    expect((await projectOf(resumedToken)).project_id).toBe(project.project_id);
    expect((await h.api().get("/api/fa/session").set(auth(resumedToken))).body.answers.STORY).toBe(MANUFACTURER.STORY);

    // --- complete the assessment ------------------------------------------------------------------
    const view = await runJourney(h, resumedToken, MANUFACTURER);
    expect(view.status).toBe("COMPLETED_LOCKED");
    const completed = await projectOf(resumedToken);
    expect(completed.completed_at).not.toBeNull();
    expect(completed.company_id).toBe(project.company_id);
    expect(completed.created_by_person_id).toBe(project.created_by_person_id);

    // --- Snapshot and its delivery email ----------------------------------------------------------
    const snapshot = await h.api().get("/api/fa/session/snapshot").set(auth(resumedToken));
    expect(snapshot.status).toBe(200);
    expect(snapshot.body.content.locales.es).toBeDefined();
    expect(h.email.messages.map((m) => m.template)).toContain("snapshot_ready");
    const snapshotLink = lastLinkToken(h);
    expect((await h.api().post("/api/fa/links/snapshot").send({ token: snapshotLink })).body.snapshotId).toBe(snapshot.body.snapshotId);

    // --- post-Snapshot feedback --------------------------------------------------------------------
    expect((await h.api().get("/api/fa/session/feedback").set(auth(resumedToken))).body).toMatchObject({ available: true, submitted: false });
    expect((await h.api().post("/api/fa/session/feedback").set(auth(resumedToken)).send({ usefulness: 5, comment: "Clearer than expected." })).status).toBe(201);

    // --- Premium transition: content, request, then beeside's confirmation ---------------------------
    const premiumContent = await h.api().get("/api/fa/session/premium/content").set(auth(resumedToken));
    expect(premiumContent.body.previewRoomUrl).toBe("https://www.beeside.you/preview");
    expect(JSON.stringify(premiumContent.body)).not.toMatch(/\$|USD|MXN|precio|price/i);
    expect((await h.api().get("/api/fa/session/premium").set(auth(resumedToken))).body).toMatchObject({ available: true, canActivate: true, accessActive: false });

    const requested = await h.api().post("/api/fa/session/premium/activation").set(auth(resumedToken)).send({ acceptTerms: true });
    expect(requested.status).toBe(201);
    expect(requested.body.outcome).toEqual({ kind: "pending_confirmation" });
    const pending = await h.api().get("/api/fa/session/premium").set(auth(resumedToken));
    expect(pending.body.pendingRequest).toMatchObject({ kind: "activation" });
    expect(pending.body).toMatchObject({ canActivate: false, canReactivate: false, accessActive: false });

    const activation = await h.deps.db.transaction((tx) =>
      processSubscriptionEvent(tx, h.deps.bundles, {
        projectId: project.project_id,
        eventType: "premium_activated",
        occurredAt: h.clock.now,
        source: "admin_manual_confirmation",
        idempotencyKey: `e2e-${project.project_id}`,
        periodStart: h.clock.now,
        periodEnd: new Date(h.clock.now.getTime() + 30 * DAY),
      }),
    );
    expect(activation).toMatchObject({ premiumAccessActive: true, premiumEverActivated: true, precisionState: "STARTED", handoffGenerated: true });
    expect(await count("SELECT count(*)::int AS n FROM premium_activation_request WHERE project_id = $1 AND status = 'FULFILLED'", [project.project_id])).toBe(1);

    // --- Precision starts from the frozen handoff and the canonical First Assessment ------------------
    const precision = await getPrecisionStartContext(h.deps.db, h.deps.bundles, project.project_id);
    expect(precision.handoffPackage.content).toMatchObject({
      projectId: project.project_id,
      personId: project.created_by_person_id,
      companyId: project.company_id,
      guardrails: { findingsAreNotContractedServices: true, clientProviderDirectContact: "not_authorized", regeneratedOnReactivation: false },
    });
    expect(precision.firstAssessment?.assessment.status).toBe("COMPLETED_LOCKED");
    expect(precision.precisionAnswers).toEqual([]);
    // One handoff package, one Snapshot, one Internal Assessment: no duplicated First Assessment context.
    expect(await count("SELECT count(*)::int AS n FROM precision_handoff_package WHERE project_id = $1", [project.project_id])).toBe(1);
    expect(await count("SELECT count(*)::int AS n FROM snapshot WHERE project_id = $1", [project.project_id])).toBe(1);
    expect(await count("SELECT count(*)::int AS n FROM internal_assessment WHERE project_id = $1", [project.project_id])).toBe(1);
  });

  it("recognises a returning respondent: the same email never attaches a stranger, and the verified link continues the same project", async () => {
    const token = await start("e2e.returning@northwind-test.example");
    const first = await projectOf(token);

    // Someone submits the same email again: nothing is attached, a private link is emailed instead.
    const again = await h.api().post("/api/fa/identity").send(identity({ email: "e2e.returning@northwind-test.example", firstName: "Impostor", company: "Other Co" }));
    expect(again.status).toBe(202);
    expect(again.body).toEqual({ status: "verification_required" });
    expect(h.email.messages[h.email.messages.length - 1]?.template).toBe("existing_assessment_link");
    expect(await count("SELECT count(*)::int AS n FROM person")).toBe(1);
    expect(await count("SELECT count(*)::int AS n FROM project")).toBe(1);

    const link = lastLinkToken(h);
    const continued = await h.api().post("/api/fa/links/continue").send({ token: link });
    expect(continued.status).toBe(201);
    const same = await projectOf(continued.body.sessionToken as string);
    expect(same.project_id).toBe(first.project_id);
    expect(same.created_by_person_id).toBe(first.created_by_person_id);
    expect(same.company_id).toBe(first.company_id);
  });

  it("keeps two projects of the same person and company completely separate", async () => {
    const firstToken = await start("e2e.multi@northwind-test.example");
    const first = await projectOf(firstToken);
    await runJourney(h, firstToken, MANUFACTURER);
    await h.api().get("/api/fa/session/snapshot").set(auth(firstToken));
    await h.api().post("/api/fa/session/feedback").set(auth(firstToken)).send({ usefulness: 4 });

    const second = await h.api().post("/api/fa/session/another-project").set(auth(firstToken)).send({ acceptLegal: true });
    expect(second.status).toBe(201);
    const secondToken = second.body.sessionToken as string;
    const secondProject = await projectOf(secondToken);
    expect(secondProject.project_id).not.toBe(first.project_id);
    expect(secondProject.company_id).toBe(first.company_id);
    expect(secondProject.created_by_person_id).toBe(first.created_by_person_id);
    expect(secondProject.assessment_state).toBe("IN_PROGRESS");

    // The second project starts empty of project answers. The three preference fields are canonical
    // in `person` (never duplicated as answers), so they legitimately follow the respondent.
    const fresh = (await h.api().get("/api/fa/session").set(auth(secondToken))).body.answers as Record<string, unknown>;
    expect(Object.keys(fresh).sort()).toEqual(["S5", "S6_DELIVERABLE", "S6_INTERACTION"]);
    expect(await count("SELECT count(*)::int AS n FROM answer WHERE project_id = $1", [secondProject.project_id])).toBe(0);
    for (const table of ["answer", "finding", "snapshot", "internal_assessment", "capability_rank", "snapshot_feedback"]) {
      expect(await count(`SELECT count(*)::int AS n FROM ${table} WHERE project_id = $1`, [secondProject.project_id])).toBe(0);
      expect(await count(`SELECT count(*)::int AS n FROM ${table} WHERE project_id = $1`, [first.project_id])).toBeGreaterThan(0);
    }

    // Premium on the first project does not touch the second.
    await h.deps.db.transaction((tx) =>
      processSubscriptionEvent(tx, h.deps.bundles, {
        projectId: first.project_id,
        eventType: "premium_activated",
        occurredAt: h.clock.now,
        source: "admin_manual_confirmation",
        idempotencyKey: `e2e-multi-${first.project_id}`,
        periodStart: h.clock.now,
        periodEnd: new Date(h.clock.now.getTime() + 30 * DAY),
      }),
    );
    // Addressed by id: inside the rolled-back test transaction both projects share created_at.
    const stateOf = async (projectId: string) =>
      (await h.client.query("SELECT premium_ever_activated, precision_state FROM project WHERE project_id = $1", [projectId])).rows[0];
    expect(await stateOf(first.project_id)).toEqual({ premium_ever_activated: true, precision_state: "STARTED" });
    expect(await stateOf(secondProject.project_id)).toEqual({ premium_ever_activated: false, precision_state: "NOT_STARTED" });
    expect(await count("SELECT count(*)::int AS n FROM entitlement WHERE project_id = $1", [secondProject.project_id])).toBe(0);
    expect(await count("SELECT count(*)::int AS n FROM precision_handoff_package WHERE project_id = $1", [secondProject.project_id])).toBe(0);
  });

  it("branches an already-operating project to growth questions and reflects it in the Snapshot context", async () => {
    const token = await start("e2e.operating@northwind-test.example");
    const view = await runJourney(h, token, ALREADY_OPERATING);
    expect(view.status).toBe("COMPLETED_LOCKED");
    const project = await projectOf(token);

    const context = await getFirstAssessmentPrecisionContext(h.deps.db, h.deps.bundles, project.project_id);
    expect(context?.structuredAnswers["fa.project.stage"]?.value).toBe("already_operating");
    expect(context?.structuredAnswers["fa.operation.growth_focus"]?.value).toEqual(["grow_sales"]);
    expect(context?.findings.length).toBeGreaterThan(0);

    const snapshot = await h.api().get("/api/fa/session/snapshot").set(auth(token));
    expect(snapshot.status).toBe(200);
    const panels = snapshot.body.content.locales.es.panels as unknown[];
    expect(panels.length).toBeGreaterThan(0);
    expect(panels.length).toBeLessThanOrEqual(5);
    // Internal vocabulary never reaches the client Snapshot.
    expect(JSON.stringify(snapshot.body.content)).not.toMatch(/CRITICAL_GAP|internal_signal|rule_triggered|panel_rank|signal_strength/);
  });

  it("runs the whole journey in English: interface, Snapshot and every email", async () => {
    const token = await start("e2e.english@northwind-test.example", { interfaceLanguage: "en", firstName: "Anna", lastName: "Reed" });
    await h.api().put("/api/fa/session/answers/STORY").set(auth(token)).send({ value: MANUFACTURER.STORY });
    await h.api().put("/api/fa/session/answers/ANOTHER_PROJECT").set(auth(token)).send({ value: "no" });
    await h.api().post("/api/fa/session/finish-later").set(auth(token));
    const resumeEmail = h.email.messages[h.email.messages.length - 1];
    expect(resumeEmail).toMatchObject({ template: "resume_link", locale: "en" });
    expect(resumeEmail?.subject).toBe("Your beeside assessment is saved");

    const view = await runJourney(h, token, ENGLISH);
    expect(view.status).toBe("COMPLETED_LOCKED");
    const snapshot = await h.api().get("/api/fa/session/snapshot").set(auth(token));
    expect(snapshot.body.content.deliverable_locale).toBe("en");
    expect(snapshot.body.content.locales.en).toBeDefined();
    const snapshotEmail = h.email.messages[h.email.messages.length - 1];
    expect(snapshotEmail).toMatchObject({ template: "snapshot_ready", locale: "en" });

    const feedback = await h.api().get("/api/fa/session/feedback").set(auth(token));
    expect(feedback.body.copy.en.question).toBe("How useful was this experience in helping you think more clearly about your project?");
  });
});
