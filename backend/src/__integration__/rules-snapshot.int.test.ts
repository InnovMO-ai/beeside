import { MANUFACTURER, describeWithDb, identity, lastLinkToken, runJourney, useHarness } from "./fa-harness";

const INTERNAL_NAMES = /Hive|Business Check|Market Brief|Trade & Market Access|Supplier Search|Partner Search|STRONG|SUPPORTING|POSSIBLE|CRITICAL_GAP|NEEDS_ATTENTION|NOT_APPLICABLE|re-1\.0\.0/;

describeWithDb("Rules + Snapshot at COMPLETED_LOCKED (PostgreSQL, rolled back)", () => {
  const h = useHarness();

  async function completedProject(persona: Record<string, unknown> = MANUFACTURER) {
    const start = await h.api().post("/api/fa/identity").send(identity());
    expect(start.status).toBe(201);
    const token = start.body.sessionToken as string;
    const view = await runJourney(h, token, persona);
    expect(view.status).toBe("COMPLETED_LOCKED");
    const { rows } = await h.client.query(
      `SELECT p.* FROM project p JOIN project_access_token t ON t.project_id = p.project_id
        WHERE t.token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')`,
      [token],
    );
    return { token, project: rows[0] };
  }

  it("generates findings, alignment, capability ranks, Snapshot and Internal Assessment in the completion transaction", async () => {
    const { project } = await completedProject();
    expect(project).toMatchObject({ rules_engine_version: "re-1.0.0", snapshot_template_version: "st-1.0.0", assessment_state: "COMPLETED_LOCKED" });

    const findings = await h.client.query("SELECT * FROM finding WHERE project_id = $1 ORDER BY area_id", [project.project_id]);
    expect(findings.rows).toHaveLength(14);
    for (const f of findings.rows) {
      expect(f.rule_triggered).toMatch(/^area\.\d+\./);
      expect(f.reason_internal).toContain(f.rule_triggered);
      expect(f.rules_engine_version).toBe("re-1.0.0");
      if (f.status === "NOT_APPLICABLE") expect(f.reason_client).toBeNull();
      else expect(f.reason_client).toBeTruthy();
    }
    // Every piece of evidence points at the live answer row it was computed from.
    const evidence = findings.rows.flatMap((f) => f.evidence as Array<{ field_key: string; answerId: string | null; fieldKey: string }>);
    expect(evidence.length).toBeGreaterThan(0);
    const answers = await h.client.query("SELECT answer_id, field_key FROM answer WHERE project_id = $1 AND superseded_by IS NULL", [project.project_id]);
    const live = new Map(answers.rows.map((a) => [a.field_key, a.answer_id]));
    for (const e of evidence) expect(e.answerId).toBe(live.get(e.fieldKey));

    const statuses = Object.fromEntries(findings.rows.map((f) => [f.area_id, f.status]));
    expect(statuses).toMatchObject({ 1: "NEEDS_ATTENTION", 2: "CRITICAL_GAP", 7: "CRITICAL_GAP", 11: "CRITICAL_GAP", 12: "CRITICAL_GAP", 3: "NOT_APPLICABLE" });

    const alignment = await h.client.query("SELECT * FROM priority_alignment WHERE project_id = $1", [project.project_id]);
    expect(alignment.rows[0]).toMatchObject({ alignment: "TENSION_DETECTED", tension_area_id: 7, tests_matched: ["go_to_market_dependency"] });
    const capabilities = await h.client.query("SELECT * FROM capability_rank WHERE project_id = $1 ORDER BY rank", [project.project_id]);
    expect(capabilities.rows.filter((c) => c.included_in_snapshot).length).toBeLessThanOrEqual(6);

    const snapshot = await h.client.query("SELECT * FROM snapshot WHERE project_id = $1", [project.project_id]);
    const internal = await h.client.query("SELECT * FROM internal_assessment WHERE project_id = $1", [project.project_id]);
    expect(snapshot.rows).toHaveLength(1);
    expect(internal.rows).toHaveLength(1);
    expect(snapshot.rows[0].generated_at.getTime()).toBe(internal.rows[0].generated_at.getTime());
    // The respondent chose English for deliverables.
    expect(snapshot.rows[0].content.deliverable_locale).toBe("en");
    expect(JSON.stringify(snapshot.rows[0].content.locales)).not.toMatch(INTERNAL_NAMES);
    expect(internal.rows[0].content.precision_focus[0]).toMatchObject({ kind: "priority_tension" });
    expect(internal.rows[0].content.findings).toHaveLength(14);

    const events = await h.client.query(
      "SELECT event_type, properties FROM fa_journey_event WHERE project_id = $1 AND event_type IN ('snapshot_generated', 'snapshot_email_sent', 'assessment_completed')",
      [project.project_id],
    );
    expect(events.rows.map((e) => e.event_type).sort()).toEqual(["assessment_completed", "snapshot_email_sent", "snapshot_generated"]);
    expect(events.rows.find((e) => e.event_type === "snapshot_generated")?.properties).toMatchObject({ resolve_early: 3, tension_detected: true });
  });

  it("serves the Snapshot to the respondent's session and through the private delivery link", async () => {
    const { token, project } = await completedProject();
    const own = await h.api().get("/api/fa/session/snapshot").set("Authorization", `Bearer ${token}`);
    expect(own.status).toBe(200);
    expect(own.body.content.kind).toBe("expansion_snapshot");
    expect(own.body.content.locales.en.panels.every((p: { items: unknown[] }) => p.items.length <= 5)).toBe(true);

    const delivery = h.email.messages[h.email.messages.length - 1];
    expect(delivery).toMatchObject({ template: "snapshot_ready", locale: "en", subject: "Your beeside Expansion Snapshot is ready" });
    const link = lastLinkToken(h);
    const opened = await h.api().post("/api/fa/links/open").send({ token: link });
    expect(opened.body).toMatchObject({ completed: true, canContinue: false });
    const viaLink = await h.api().post("/api/fa/links/snapshot").send({ token: link });
    expect(viaLink.status).toBe(200);
    expect(viaLink.body.snapshotId).toBe(own.body.snapshotId);

    expect((await h.api().post("/api/fa/links/snapshot").send({ token: "not-a-real-token-value-at-all-000000000000" })).status).toBe(404);
    const events = await h.client.query("SELECT count(*)::int AS n FROM email_event WHERE project_id = $1 AND email_type = 'snapshot_ready'", [project.project_id]);
    expect(events.rows[0].n).toBe(1);
  });

  it("keeps every generated record frozen once the First Assessment is locked", async () => {
    const { project, token } = await completedProject();
    const attempt = async (sql: string, params: unknown[]) => {
      await h.client.query("SAVEPOINT frozen");
      try {
        await h.client.query(sql, params);
        return null;
      } catch (error) {
        return error as { code?: string; message: string };
      } finally {
        await h.client.query("ROLLBACK TO SAVEPOINT frozen");
      }
    };
    // Refused either by the guard or, when the suite runs as the least-privilege runtime role
    // (Phase 13), by the missing UPDATE privilege — stricter, never weaker.
    const frozen = (reason: string) => expect.stringMatching(new RegExp(`${reason}|permission denied`));
    expect(await attempt("UPDATE snapshot SET content = '{}' WHERE project_id = $1", [project.project_id])).toMatchObject({ message: frozen("immutable") });
    expect(await attempt("UPDATE internal_assessment SET content = '{}' WHERE project_id = $1", [project.project_id])).toMatchObject({ message: frozen("immutable") });
    expect(await attempt("UPDATE finding SET status = 'DEFINED' WHERE project_id = $1 AND area_id = 2", [project.project_id])).toMatchObject({ message: frozen("COMPLETED_LOCKED") });
    expect(
      await attempt(
        `INSERT INTO finding (project_id, area_id, status, reason_client, rule_triggered, reason_internal, rules_engine_version)
         VALUES ($1, 1, 'DEFINED', 'x', 'area.1.x', 'x', 're-1.0.0')`,
        [project.project_id],
      ),
    ).toMatchObject({ code: "BV409" });
    // Completing again is refused; nothing is regenerated.
    const again = await h.api().post("/api/fa/session/steps/preferences/complete").set("Authorization", `Bearer ${token}`).send({});
    expect(again.body.error).toBe("LOCKED");
  });

  it("refuses to open a Snapshot for an assessment that is still in progress", async () => {
    const start = await h.api().post("/api/fa/identity").send(identity({ email: "in.progress@northwind-test.example" }));
    const res = await h.api().get("/api/fa/session/snapshot").set("Authorization", `Bearer ${start.body.sessionToken}`);
    expect(res.body.error).toBe("INCOMPLETE");
  });
});
