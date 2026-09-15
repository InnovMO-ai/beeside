import { EMPTY_SEGMENT, feedbackComments, feedbackMetrics, friction, funnel, journeyHealth, operationalMetrics, parseRange, segmentBreakdown } from "../analytics/metrics";
import { MANUFACTURER, describeWithDb, identity, lastLinkToken, runJourney, useHarness } from "./fa-harness";

describeWithDb("Analytics and post-Snapshot feedback (PostgreSQL, rolled back)", () => {
  const h = useHarness();
  const range = () => parseRange({}, h.clock.now);
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function start(email: string) {
    const res = await h.api().post("/api/fa/identity").send(identity({ email }));
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

  async function completed(email: string) {
    const token = await start(email);
    const view = await runJourney(h, token, MANUFACTURER);
    expect(view.status).toBe("COMPLETED_LOCKED");
    return { token, project: await projectOf(token) };
  }

  it("records the segmentation profile from enumerated answers only, and completes it with the finding signals", async () => {
    const { token, project } = await completed("profile@northwind-test.example");
    await h.api().get("/api/fa/session/snapshot").set(auth(token));

    const { rows } = await h.client.query("SELECT * FROM analytics_project_profile WHERE project_id = $1", [project.project_id]);
    const profile = rows[0];
    expect(profile).toMatchObject({
      question_bank_version: "fa-qb-1.1.0",
      primary_goal: "set_up_local_operation",
      project_stage: "preparing_entry",
      entry_mode: "new_market",
      destination_status: "know_country_comparing_locations",
      business_type: "manufacturing",
      target_markets: ["MX"],
    });
    expect(profile.expected_capabilities).toEqual(expect.arrayContaining(["legal_corporate", "banking", "customs_trade"]));
    expect(profile.operation_components).toEqual(expect.arrayContaining(["manufacturing", "import_export", "local_workforce"]));
    expect(profile.completed_at).not.toBeNull();
    expect(Object.keys(profile.signal_areas as Record<string, string[]>).length).toBeGreaterThan(0);
    // No open text, name, email or company name can reach the profile.
    expect(JSON.stringify(profile)).not.toMatch(/valve|Monterrey|Ana|Rivera|Northwind|@/i);
  });

  it("asks for feedback only after the Snapshot, once, and keeps the comment out of analytics", async () => {
    const inProgress = await start("feedback-early@northwind-test.example");
    expect((await h.api().get("/api/fa/session/feedback").set(auth(inProgress))).body).toMatchObject({ available: false, submitted: false });
    expect((await h.api().post("/api/fa/session/feedback").set(auth(inProgress)).send({ usefulness: 5 })).body.error).toBe("NOT_APPLICABLE");

    const { token, project } = await completed("feedback@northwind-test.example");
    const status = await h.api().get("/api/fa/session/feedback").set(auth(token));
    expect(status.body).toMatchObject({ available: true, submitted: false, questionVersion: "snapshot-feedback-v1" });
    expect(status.body.copy.en.question).toBe("How useful was this experience in helping you think more clearly about your project?");

    expect((await h.api().post("/api/fa/session/feedback").set(auth(token)).send({ usefulness: 9 })).status).toBe(400);
    const submitted = await h.api().post("/api/fa/session/feedback").set(auth(token)).send({ usefulness: 4, comment: "Write to ana.rivera@northwind-test.example about the Monterrey plant." });
    expect(submitted.status).toBe(201);
    expect(submitted.body).toMatchObject({ available: true, submitted: true });
    expect((await h.api().post("/api/fa/session/feedback").set(auth(token)).send({ usefulness: 1 })).body.error).toBe("ALREADY_SUBMITTED");

    const stored = await h.client.query("SELECT usefulness, comment, channel, interface_language, question_version FROM snapshot_feedback WHERE project_id = $1", [project.project_id]);
    expect(stored.rows[0]).toMatchObject({ usefulness: 4, channel: "session", interface_language: "es", question_version: "snapshot-feedback-v1" });
    expect(stored.rows[0].comment).toContain("Monterrey");

    // The rating reaches analytics; the comment never does.
    const events = await h.client.query("SELECT properties FROM fa_journey_event WHERE project_id = $1 AND event_type = 'feedback_submitted'", [project.project_id]);
    expect(events.rows[0].properties).toEqual({ usefulness: 4, comment_provided: true, channel: "session" });
    const allEvents = await h.client.query("SELECT properties::text AS p FROM fa_journey_event");
    expect(allEvents.rows.map((r) => r.p).join(" ")).not.toMatch(/@|Monterrey/);
  });

  it("accepts feedback from the private link and reports it to the Control Center", async () => {
    const { token, project } = await completed("feedback-link@northwind-test.example");
    await h.api().get("/api/fa/session/snapshot").set(auth(token));
    const link = lastLinkToken(h);

    expect((await h.api().post("/api/fa/links/feedback").send({ token: link })).body).toMatchObject({ available: true, submitted: false });
    const sent = await h.api().post("/api/fa/links/feedback/submit").send({ token: link, usefulness: 5, comment: "Very clear." });
    expect(sent.status).toBe(201);
    expect((await h.client.query("SELECT channel FROM snapshot_feedback WHERE project_id = $1", [project.project_id])).rows[0].channel).toBe("private_link");

    const metrics = await feedbackMetrics(h.deps.db, range(), EMPTY_SEGMENT);
    expect(metrics).toMatchObject({ responses: 1, completed: 1, average: 5, responseRate: 1 });
    expect(metrics.distribution.find((d) => d.value === 5)?.responses).toBe(1);
    const comments = await feedbackComments(h.deps.db, range());
    expect(comments[0]).toMatchObject({ usefulness: 5, comment: "Very clear.", project_id: project.project_id });
    // The comment list carries no name, email or company.
    expect(JSON.stringify(comments)).not.toMatch(/@|Northwind|Ana/);
  });

  it("builds the funnel, journey health and friction views of a cohort without personal data", async () => {
    const { token } = await completed("funnel-completed@northwind-test.example");
    await h.api().get("/api/fa/session/snapshot").set(auth(token));
    await h.api().post("/api/fa/session/feedback").set(auth(token)).send({ usefulness: 5 });

    const saved = await start("funnel-saved@northwind-test.example");
    await h.api().put("/api/fa/session/answers/STORY").set(auth(saved)).send({ value: "Our story" });
    await h.api().post("/api/fa/session/steps/project_story/complete").set(auth(saved)).send({ durationMs: 60_000 });
    await h.api().post("/api/fa/session/finish-later").set(auth(saved));
    const link = lastLinkToken(h);
    await h.api().post("/api/fa/links/continue").send({ token: link });
    for (const email of ["funnel-a@northwind-test.example", "funnel-b@northwind-test.example", "funnel-c@northwind-test.example"]) await start(email);

    const result = await funnel(h.deps.db, range(), EMPTY_SEGMENT);
    expect(result.suppressed).toBe(false);
    expect(result.projects).toMatchObject({ identity_completed: 5, completed: 1, finish_later: 1, resumed: 1, snapshot_viewed: 1, feedback_submitted: 1 });
    expect(result.rates.identity_to_completed).toBe(0.2);
    expect(result.anonymous).toEqual({ entered: 0, started: 0 });
    expect(JSON.stringify(result)).not.toMatch(/@|Northwind|Ana/);

    const health = await journeyHealth(h.deps.db, range(), EMPTY_SEGMENT, h.clock.now);
    expect(health.outcomes).toMatchObject({ total: 5, completed: 1, inProgress: 4, completionRate: 0.2 });
    expect(health.timing.activeMedianMinutes).not.toBeNull();
    expect(health.resume).toMatchObject({ finishLater: 1, resumed: 1, resumeRate: 1 });

    const rough = await friction(h.deps.db, range(), EMPTY_SEGMENT, h.clock.now);
    expect(rough.suppressed).toBe(false);
    expect(Array.isArray(rough.questions)).toBe(true);
    expect(rough.steps.some((s) => s.stepId === "project_story")).toBe(true);
    expect(rough.signals).toMatchObject({ saveFailed: 0, automatedSignals: 0 });

    const operations = await operationalMetrics(h.deps.db, range(), h.clock.now);
    expect(operations.email.length).toBeGreaterThan(0);
    expect(operations.retention).toMatchObject({ purgedInRange: 0, dueForPurge: 0, heldByPendingPremiumRequest: 0 });
    expect(JSON.stringify(operations)).not.toMatch(/@|Northwind/);
  });

  it("suppresses a segment that could identify a single company", async () => {
    await completed("segment@northwind-test.example");
    const segmented = await funnel(h.deps.db, range(), { ...EMPTY_SEGMENT, market: "MX" });
    expect(segmented).toMatchObject({ segmented: true, suppressed: true, anonymous: null });
    expect(Object.values(segmented.projects).every((value) => value === null)).toBe(true);
    const breakdown = await segmentBreakdown(h.deps.db, range());
    expect(breakdown.minimumSegmentSize).toBe(5);
    expect(breakdown.primaryGoal).toEqual([]);
  });
});
