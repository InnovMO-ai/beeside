import { describeWithDb, identity, lastLinkToken, useHarness } from "./fa-harness";

describeWithDb("First Assessment save/resume lifecycle (PostgreSQL, rolled back)", () => {
  const h = useHarness();
  const DAY = 86_400_000;

  async function start(overrides: Record<string, unknown> = {}) {
    const res = await h.api().post("/api/fa/identity").send(identity(overrides));
    expect(res.status).toBe(201);
    return res.body.sessionToken as string;
  }

  async function lifecycle(token: string) {
    const { rows } = await h.client.query(
      `SELECT l.* FROM fa_project_lifecycle l JOIN project_access_token t ON t.project_id = l.project_id
        WHERE t.token_hash = encode(sha256(convert_to($1, 'UTF8')), 'hex')`,
      [token],
    );
    return rows[0];
  }

  it("Finish Later opens a 15-day access window, emails a private link and resumes the same project", async () => {
    const token = await start();
    const auth = { Authorization: `Bearer ${token}` };
    await h.api().put("/api/fa/session/answers/STORY").set(auth).send({ value: "Our story" });

    const res = await h.api().post("/api/fa/session/finish-later").set(auth);
    expect(res.status).toBe(200);
    const l = await lifecycle(token);
    const started = new Date(l.access_window_started_at).getTime();
    expect(new Date(l.access_expires_at).getTime() - started).toBe(15 * DAY);
    expect(new Date(l.access_max_until).getTime() - started).toBe(45 * DAY);
    expect(new Date(l.retention_until).getTime() - started).toBe(60 * DAY);

    expect(h.email.messages).toHaveLength(1);
    expect(h.email.messages[0]).toMatchObject({ template: "resume_link", locale: "es", to: "ana.rivera@northwind-test.example" });
    expect(h.email.messages[0]?.subject).toBe("Tu evaluación de beeside está guardada");
    const resumeToken = lastLinkToken(h);

    // Repeated clicks within the cooldown do not send or rotate links.
    await h.api().post("/api/fa/session/finish-later").set(auth);
    expect(h.email.messages).toHaveLength(1);

    const opened = await h.api().post("/api/fa/links/open").send({ token: resumeToken });
    expect(opened.body).toMatchObject({ canContinue: true, canRecover: false, closed: false, companyName: "Northwind Manufacturing S.A. de C.V." });
    const resumed = await h.api().post("/api/fa/links/continue").send({ token: resumeToken });
    expect(resumed.status).toBe(201);
    const view = await h.api().get("/api/fa/session").set("Authorization", `Bearer ${resumed.body.sessionToken}`);
    expect(view.body.answers.STORY).toBe("Our story");
    const projects = await h.client.query("SELECT count(*)::int AS n FROM project");
    const before = projects.rows[0].n;
    expect((await lifecycle(resumed.body.sessionToken)).project_id).toBe(l.project_id);

    // After the cooldown a new link rotates the previous one.
    h.advanceMinutes(6);
    await h.api().post("/api/fa/session/finish-later").set(auth);
    expect(h.email.messages).toHaveLength(2);
    expect((await h.api().post("/api/fa/links/open").send({ token: resumeToken })).status).toBe(404);
    expect((await h.client.query("SELECT count(*)::int AS n FROM project")).rows[0].n).toBe(before);
  });

  it("expires access on day 15, recovers with an immediate structured extension, and caps access at day 45", async () => {
    const token = await start();
    await h.api().post("/api/fa/session/finish-later").set("Authorization", `Bearer ${token}`);
    const link = lastLinkToken(h);
    const start0 = new Date((await lifecycle(token)).access_window_started_at).getTime();

    // A working session opened just before day 15 stops working when access expires.
    h.advanceDays(14.9);
    const lateSession = await h.api().post("/api/fa/links/continue").send({ token: link });
    expect(lateSession.status).toBe(201);
    h.advanceDays(0.2);
    expect((await h.api().get("/api/fa/session").set("Authorization", `Bearer ${lateSession.body.sessionToken}`)).body.error).toBe("ACCESS_EXPIRED");
    expect((await h.api().post("/api/fa/links/continue").send({ token: link })).body.error).toBe("ACCESS_EXPIRED");
    expect((await h.api().post("/api/fa/links/open").send({ token: link })).body).toMatchObject({ canContinue: false, canRecover: true });

    const recovered = await h.api().post("/api/fa/links/extend").send({ token: link, days: 15, reason: "unsure_market_timing" });
    expect(recovered.status).toBe(200);
    expect(new Date(recovered.body.accessUntil).getTime()).toBe(h.clock.now.getTime() + 15 * DAY);
    expect((await h.api().post("/api/fa/links/continue").send({ token: link })).status).toBe(201);

    const capped = await h.api().post("/api/fa/links/extend").send({ token: link, days: 30, reason: "missing_information" });
    expect(new Date(capped.body.accessUntil).getTime()).toBe(start0 + 45 * DAY);
    expect((await h.api().post("/api/fa/links/extend").send({ token: link, days: 15, reason: "something_else" })).body).toMatchObject({
      error: "NOT_RECOVERABLE",
      details: { reason: "maximum_reached" },
    });

    const extensions = await h.client.query("SELECT requested_days, reason, was_expired FROM fa_access_extension ORDER BY requested_at");
    expect(extensions.rows).toEqual([
      { requested_days: 15, reason: "UNSURE_MARKET_TIMING", was_expired: true },
      { requested_days: 30, reason: "MISSING_INFORMATION", was_expired: false },
    ]);
    expect((await h.api().post("/api/fa/links/extend").send({ token: link, days: 20, reason: "something_else" })).status).toBe(400);

    h.advanceDays(30);
    expect((await h.api().post("/api/fa/links/open").send({ token: link })).body).toMatchObject({ canContinue: false, canRecover: false, closed: true });
  });

  it("never attaches an unverified requester to an existing email; the verified link starts a new project", async () => {
    await start();
    const firstProject = (await h.client.query("SELECT project_id, company_id, created_by_person_id FROM project")).rows[0];

    const again = await h.api().post("/api/fa/identity").send(identity({ firstName: "Someone", company: "Other Co" }));
    expect(again.status).toBe(202);
    expect(again.body).toEqual({ status: "verification_required" });
    expect((await h.client.query("SELECT count(*)::int AS n FROM project")).rows[0].n).toBe(1);
    expect((await h.client.query("SELECT first_name FROM person")).rows[0].first_name).toBe("Ana");
    expect(h.email.messages[0]?.template).toBe("existing_assessment_link");
    const link = lastLinkToken(h);

    const same = await h.api().post("/api/fa/links/new-project").send({ token: link, sameCompany: true, acceptLegal: true });
    expect(same.status).toBe(201);
    const other = await h.api().post("/api/fa/links/new-project").send({ token: link, sameCompany: false, companyName: "Nueva Empresa", acceptLegal: true });
    expect(other.status).toBe(201);
    const projects = await h.client.query("SELECT company_id, created_by_person_id FROM project ORDER BY created_at");
    expect(projects.rows).toHaveLength(3);
    expect(projects.rows.every((p) => p.created_by_person_id === firstProject.created_by_person_id)).toBe(true);
    expect(projects.rows.filter((p) => p.company_id === firstProject.company_id)).toHaveLength(2);
    expect((await h.client.query("SELECT count(*)::int AS n FROM company")).rows[0].n).toBe(2);

    const generic = await h.api().post("/api/fa/links/request").send({ email: "nobody@unknown-test.example" });
    expect(generic.status).toBe(202);
  });

  it("stores whitelisted journey analytics without personal data or open text", async () => {
    const anonymousSessionId = "0b3c2f4e-8a1d-4f6b-9c2e-7d5a4b3c2e1f";
    const res = await h.api().post("/api/fa/events").send({
      anonymousSessionId,
      events: [
        { type: "assessment_entered", interfaceLanguage: "en" },
        { type: "assessment_started" },
        { type: "question_viewed", questionId: "STORY", stepId: "project_story", durationMs: 800 },
        { type: "question_viewed", questionId: "ana@example.com" },
        { type: "language_changed", properties: { to: "es", email: "ana@example.com" } },
        { type: "identity_completed" },
      ],
    });
    expect(res.body).toEqual({ accepted: 5 });
    const rows = await h.client.query("SELECT event_type, question_id, properties FROM fa_journey_event WHERE anonymous_session_id = $1 ORDER BY occurred_at, event_id", [anonymousSessionId]);
    expect(rows.rows.map((r) => r.event_type).sort()).toEqual(["assessment_entered", "assessment_started", "language_changed", "question_viewed", "question_viewed"]);
    expect(JSON.stringify(rows.rows)).not.toContain("@");
    expect((await h.api().post("/api/fa/events").send({ events: [] })).status).toBe(400);
  });
});
