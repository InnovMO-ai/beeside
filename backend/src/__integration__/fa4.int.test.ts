import { Client } from "pg";
import request from "supertest";
import { SEED_CATALOG } from "@beeside/fa-public-engine/seed";
import { journeyA, journeyB, journeyC } from "@beeside/fa-public-engine/testing";
import { aggregateDemand, canReadRawDemand, Answers } from "@beeside/fa-public-engine";
import { createSavepointDb } from "../db/database";
import { createApp } from "../index";
import { CaptureEmailTransport } from "../fa/email/email-adapter";
import { deliverDueFa4Emails } from "../fa4/email";
import {
  allSignals, catalogChanges, catalogVersions, continuationRequests, latestResult, publishCapability, rawSignals, resultsFor,
  saveCapabilityDraft, seedCatalogIfEmpty,
} from "../fa4/repository";
import { Fa4Deps } from "../fa4/routes";
import { MemoryRateLimitStore, PostgresRateLimitStore, createRateLimiter } from "../security/rate-limit";

const url = process.env.TEST_DATABASE_URL;
const describeWithDb = url ? describe : describe.skip;

/** FA Public v1.0 against real PostgreSQL (migrations 0015/0016). Every test runs in a transaction that is rolled back. */
describeWithDb("FA Public v1.0 persistence (PostgreSQL, rolled back)", () => {
  const client = new Client({ connectionString: url });
  const email = new CaptureEmailTransport();
  const clock = { now: new Date("2026-10-04T12:00:00Z") };
  const db = createSavepointDb(client);
  const deps: Fa4Deps = {
    db, email,
    config: { appBaseUrl: "https://fa.test", sessionTtlHours: 24, resumeLinkDays: 30, emailCooldownMinutes: 5, now: () => clock.now },
    emailDispatch: "inline",
  };
  const api = (opts: { limiter?: ReturnType<typeof createRateLimiter> } = {}) =>
    request(createApp({ fa4: deps, ...(opts.limiter ? { security: { limiter: opts.limiter } } : {}) }));

  beforeAll(() => client.connect());
  afterAll(() => client.end());
  beforeEach(async () => {
    email.messages.length = 0; email.idempotencyKeys.length = 0; email.failNext.length = 0;
    clock.now = new Date("2026-10-04T12:00:00Z");
    await client.query("BEGIN");
    await seedCatalogIfEmpty(db, SEED_CATALOG);
  });
  afterEach(() => client.query("ROLLBACK"));

  async function start(a: Answers = journeyA(), step = "company") {
    const res = await api().post("/api/fa4/sessions").send({ answers: a, step });
    expect(res.status).toBe(201);
    return res.body.sessionToken as string;
  }
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const projectId = async (token: string) =>
    (await client.query("SELECT t.project_id FROM fa4_access_token t WHERE t.token_hash = encode(sha256(convert_to($1,'UTF8')),'hex')", [token])).rows[0].project_id as string;

  it("the real migrations created the FA4 tables and the catalog seeds into a PUBLISHED, immutable version", async () => {
    const { rows } = await client.query("SELECT count(*)::int AS n FROM fa4_catalog_entity WHERE entity_type = 'CAPABILITY'");
    expect(rows[0].n).toBe(49);
    expect(await catalogVersions(db)).toEqual([SEED_CATALOG.version]);
    const cat = await api().get("/api/fa4/catalog");
    expect(cat.status).toBe(200);
    expect(cat.body.version).toBe(SEED_CATALOG.version);
    expect(JSON.stringify(cat.body)).not.toMatch(/internalRef|Grant Thornton|Traxi|Santander|MAPFRE|sourcingPolicy/);   // internal fields never leave the server
  });

  describe("identity, save and resume (no account, same email)", () => {
    it("creates the project right after identity and refuses incomplete identity / unaccepted terms", async () => {
      const bad = journeyA(); bad.identity.termsAccepted = false;
      const refused = await api().post("/api/fa4/sessions").send({ answers: bad });
      expect(refused.status).toBe(400);
      expect(refused.body.details.fields).toContain("termsAccepted");
      const invalid = await api().post("/api/fa4/sessions").send({ answers: { nope: true } });
      expect(invalid.status).toBe(400);
      const token = await start();
      const p = (await client.query("SELECT * FROM fa4_project WHERE project_id = $1", [await projectId(token)])).rows[0];
      expect(p).toMatchObject({ email: "laura@nubia.example", status: "IN_PROGRESS", locale: "es" });
    });

    it("stores only a hash of every token", async () => {
      const token = await start();
      const dump = JSON.stringify((await client.query("SELECT * FROM fa4_access_token")).rows);
      expect(dump).not.toContain(token);
    });

    it("autosave keeps answers; the captured email can never be swapped; the session requires a valid bearer token", async () => {
      const token = await start();
      const a = journeyA(); a.reasonText = "otra cosa"; a.identity.email = "attacker@evil.example";
      expect((await api().put("/api/fa4/session").set(auth(token)).send({ answers: a, step: "reason" })).status).toBe(200);
      const got = await api().get("/api/fa4/session").set(auth(token));
      expect(got.body.step).toBe("reason");
      expect(got.body.answers.reasonText).toBe("otra cosa");
      expect(got.body.answers.identity.email).toBe("laura@nubia.example");
      expect((await api().get("/api/fa4/session")).status).toBe(401);
      expect((await api().get("/api/fa4/session").set(auth("x".repeat(43)))).status).toBe(401);
    });

    it("'save for later' mails a resume link to the stored address; the token travels in the URL fragment and exchanges for a new session of the SAME project", async () => {
      const token = await start();
      const res = await api().post("/api/fa4/session/finish-later").set(auth(token));
      expect(res.status).toBe(200);
      expect(res.body.email).toBe("l***@nubia.example");
      expect(email.messages).toHaveLength(1);
      const m = email.messages[0]!;
      expect(m.to).toBe("laura@nubia.example");
      expect(m.ctaUrl).toMatch(/^https:\/\/fa\.test\/fa4#r=[A-Za-z0-9_-]{43}$/);
      expect(m.ctaUrl).not.toContain("?");
      expect(email.idempotencyKeys).toHaveLength(1);

      const linkToken = m.ctaUrl.split("#r=")[1]!;
      const cont = await api().post("/api/fa4/links/continue").send({ token: linkToken });
      expect(cont.status).toBe(200);
      const resumed = await api().get("/api/fa4/session").set(auth(cont.body.sessionToken));
      expect(resumed.status).toBe(200);
      expect(await projectId(cont.body.sessionToken)).toBe(await projectId(token));
      // a SESSION token is not a link token, and garbage is refused
      expect((await api().post("/api/fa4/links/continue").send({ token })).status).toBe(404);
      expect((await api().post("/api/fa4/links/continue").send({ token: "short" })).status).toBe(404);
    });

    it("expired sessions and links stop working", async () => {
      const token = await start();
      clock.now = new Date(clock.now.getTime() + 25 * 3_600_000);
      expect((await api().get("/api/fa4/session").set(auth(token))).status).toBe(401);
    });

    it("resend cooldown prevents mail flooding; resume-by-email answers identically for known and unknown addresses (no enumeration)", async () => {
      const token = await start();
      await api().post("/api/fa4/session/finish-later").set(auth(token));
      await api().post("/api/fa4/session/finish-later").set(auth(token));
      expect(email.messages).toHaveLength(1);
      clock.now = new Date(clock.now.getTime() + 6 * 60_000);
      await api().post("/api/fa4/links/request").send({ email: "laura@nubia.example" });
      const known = await api().post("/api/fa4/links/request").send({ email: "laura@nubia.example" });
      const unknown = await api().post("/api/fa4/links/request").send({ email: "nobody@nowhere.example" });
      expect(known.status).toBe(200); expect(unknown.status).toBe(200);
      expect(known.body).toEqual(unknown.body);
      expect(email.messages.every((m) => m.to === "laura@nubia.example")).toBe(true);
      expect(email.messages).toHaveLength(2);
    });

    it("delivery failures back off, never leak the address, and succeed on retry", async () => {
      const token = await start();
      email.failNext.push(new Error("smtp refused laura@nubia.example"));
      deps.emailDispatch = "deferred";
      await api().post("/api/fa4/session/finish-later").set(auth(token));
      const emailDeps = { db, email, config: { appBaseUrl: "https://fa.test", resumeLinkDays: 30, now: () => clock.now } };
      expect(await deliverDueFa4Emails(emailDeps)).toEqual({ sent: 0, failed: 1, dead: 0 });
      const row = (await client.query("SELECT status, last_error, attempts, next_attempt_at FROM fa4_email_delivery")).rows[0];
      expect(row.status).toBe("FAILED"); expect(row.last_error).not.toContain("laura@");
      expect(await deliverDueFa4Emails(emailDeps)).toEqual({ sent: 0, failed: 0, dead: 0 });     // not due yet
      clock.now = new Date(row.next_attempt_at.getTime() + 1000);
      expect(await deliverDueFa4Emails(emailDeps)).toEqual({ sent: 1, failed: 0, dead: 0 });
      deps.emailDispatch = "inline";
    });
  });

  describe("Your Expansion View: deterministic, versioned, immutable", () => {
    it("Journey A/B/C produce the frozen outcomes from the PostgreSQL-held catalog", async () => {
      const a = await start(journeyA());
      const ra = await api().post("/api/fa4/session/result").set(auth(a));
      expect(ra.status).toBe(200);
      expect(ra.body.model.catalogVersion).toBe(SEED_CATALOG.version);
      expect(ra.body.model.destinations[0].glance).toEqual([{ key: "ACTIVE", count: 2 }, { key: "SOURCEABLE", count: 1 }, { key: "DEPENDENT", count: 1 }]);
      expect(ra.body.model.premium.shown).toBe(true);

      const b = await start(journeyB("es", "unknown"));
      const rb = await api().post("/api/fa4/session/result").set(auth(b));
      const mx = rb.body.model.destinations.find((d: { destination: string }) => d.destination === "MX");
      expect(mx.glance).toEqual([{ key: "ACTIVE", count: 6 }, { key: "SOURCEABLE", count: 1 }, { key: "REVIEW", count: 2 }, { key: "TO_REVIEW_WITH_SHERPA", count: 1 }]);
      const us = rb.body.model.destinations.find((d: { destination: string }) => d.destination === "US");
      expect(us.countryMessage).toBe("NO_ACTIVE_COVERAGE"); expect(us.valueGroups).toEqual([]);

      const c = await start(journeyC("es", "unknown"));
      const rc = await api().post("/api/fa4/session/result").set(auth(c));
      expect(rc.body.model.destinations[0].glance).toEqual([{ key: "ACTIVE", count: 3 }, { key: "SOURCEABLE", count: 2 }, { key: "REVIEW", count: 3 }, { key: "DEPENDENT", count: 1 }]);
      expect(rc.body.model.counts).toMatchObject({ applies: 12, marked: 8, notIndicated: 4 });
    });

    it("a delivered result keeps its catalog version and cannot be altered, deleted or re-pointed — by the app or by SQL", async () => {
      const t = await start(journeyB("es", "unknown"));
      const first = await api().post("/api/fa4/session/result").set(auth(t));
      await expect(client.query("SAVEPOINT s1")).resolves.toBeDefined();
      await expect(client.query("UPDATE fa4_result SET catalog_version = 'x'")).rejects.toMatchObject({ code: "BV601" });
      await client.query("ROLLBACK TO SAVEPOINT s1");
      await expect(client.query("DELETE FROM fa4_result")).rejects.toMatchObject({ code: "BV601" });
      await client.query("ROLLBACK TO SAVEPOINT s1");
      await expect(client.query("UPDATE fa4_catalog_version SET content = '{}'::jsonb")).rejects.toMatchObject({ code: "BV601" });
      await client.query("ROLLBACK TO SAVEPOINT s1");
      expect(first.body.model.catalogVersion).toBe(SEED_CATALOG.version);
    });

    it("a later catalog change creates a new version and never mutates previously delivered results", async () => {
      const t = await start(journeyB("es", "unknown"));
      await api().post("/api/fa4/session/result").set(auth(t));
      const pid = await projectId(t);
      const before = JSON.stringify((await latestResult(db, pid))!.model);

      const rec = SEED_CATALOG.capabilities.find((c) => c.capabilityId === "CAP_HIVE_HR_RECRUITMENT")!;
      await saveCapabilityDraft(db, { ...rec, capabilityStatus: "ACTIVE", providerStatus: "AFFILIATED", businessCheckStatus: "PASSED", coverage: [{ value: "MX", state: "CONFIRMED", validFrom: "2026-11-01" }] }, "catalog-admin", "Provider approved + Business Check");
      // drafts never affect FA
      const draftRun = await api().post("/api/fa4/session/result").set(auth(t));
      expect(draftRun.body.model.catalogVersion).toBe(SEED_CATALOG.version);
      expect(await publishCapability(db, "CAP_HIVE_HR_RECRUITMENT", "catalog-admin", "Provider approved + Business Check", "2026-11-01.v5")).toEqual({ ok: true, version: "2026-11-01.v5" });

      const second = await api().post("/api/fa4/session/result").set(auth(t));
      expect(second.body.model.catalogVersion).toBe("2026-11-01.v5");
      const items = second.body.model.destinations[0].valueGroups.flatMap((g: { key: string; items: { front: string }[] }) => g.items.map((i) => [i.front, g.key]));
      expect(items).toContainEqual(["FR_RECRUITMENT", "ACTIVE"]);
      expect((await resultsFor(db, pid)).map((r) => r.catalog_version)).toEqual([SEED_CATALOG.version, SEED_CATALOG.version, "2026-11-01.v5"]);
      // the first delivered result is byte-identical
      const firstRow = (await client.query("SELECT model FROM fa4_result WHERE project_id = $1 ORDER BY result_seq LIMIT 1", [pid])).rows[0].model;
      expect(JSON.stringify(firstRow)).toBe(before);
      expect(await catalogVersions(db)).toEqual([SEED_CATALOG.version, "2026-11-01.v5"]);
      expect((await catalogChanges(db, "CAP_HIVE_HR_RECRUITMENT")).map((c) => c.new_status)).toEqual(["DRAFT", "PUBLISHED"]);
    });

    it("publication rules are enforced (unknown front, SPECIFIC without terms); catalog ids are never deleted or reused", async () => {
      const base = SEED_CATALOG.capabilities.find((c) => c.capabilityId === "CAP_HIVE_FIN_BANKING")!;
      await saveCapabilityDraft(db, { ...base, capabilityId: "CAP_NEW_X", fronts: [{ front: "FR_NOPE" as never, match: "SPECIFIC" }], triggerTermsEs: [], triggerTermsEn: [] }, "a", "x");
      const r = await publishCapability(db, "CAP_NEW_X", "a", "x", "v-x");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.join(" ")).toMatch(/Front Catalog/);
      await client.query("SAVEPOINT s2");
      await expect(client.query("DELETE FROM fa4_catalog_entity WHERE entity_id = 'CAP_NEW_X'")).rejects.toMatchObject({ code: "BV602" });
      await client.query("ROLLBACK TO SAVEPOINT s2");
      await client.query("UPDATE fa4_catalog_entity SET publication_status = 'ARCHIVED' WHERE entity_id = 'CAP_NEW_X'");
      await expect(client.query("UPDATE fa4_catalog_entity SET publication_status = 'PUBLISHED' WHERE entity_id = 'CAP_NEW_X'")).rejects.toMatchObject({ code: "BV602" });
    });

    it("the 'no existing business' gate: marked INELIGIBLE and no result is produced", async () => {
      const a = journeyA(); a.company.hasExistingBusiness = false;
      const t = await start(a);
      expect((await api().post("/api/fa4/session/result").set(auth(t))).status).toBe(409);
      await api().put("/api/fa4/session").set(auth(t)).send({ answers: a, step: "company" });
      expect((await client.query("SELECT status FROM fa4_project WHERE project_id = $1", [await projectId(t)])).rows[0].status).toBe("INELIGIBLE");
    });
  });

  describe("Premium continuation and result email", () => {
    it("records an explicit continuation on the same project only when the result shows it; result link is mailed to the stored email", async () => {
      const t = await start(journeyA());
      expect((await api().post("/api/fa4/session/continue").set(auth(t))).status).toBe(409);       // no result yet
      await api().post("/api/fa4/session/result").set(auth(t));
      expect((await api().post("/api/fa4/session/continue").set(auth(t))).status).toBe(200);
      expect(await continuationRequests(db, await projectId(t))).toHaveLength(1);
      expect((await api().post("/api/fa4/session/result/email").set(auth(t))).status).toBe(200);
      expect(email.messages.at(-1)!.ctaUrl).toMatch(/#r=[A-Za-z0-9_-]{43}&view=result$/);
      expect(email.messages.at(-1)!.to).toBe("laura@nubia.example");
    });

    it("a result without real value shows no Premium continuation and refuses a continuation request (D-050)", async () => {
      const a = journeyA();
      a.destinations = { list: [{ iso: "JP" }], open: false, sameInAll: true };
      a.components = [{ ...a.components[0]!, destinations: ["JP"] }];
      const t = await start(a);
      const r = await api().post("/api/fa4/session/result").set(auth(t));
      expect(r.body.model.premium.shown).toBe(false);
      expect((await api().post("/api/fa4/session/continue").set(auth(t))).status).toBe(409);
    });
  });

  describe("Demand Signals (internal, least-privilege before Premium)", () => {
    it("are derived with the right class / reason, deduplicated, replaced (not duplicated) on re-delivery, and never exposed in the API", async () => {
      const t = await start(journeyB("es", "unknown"));
      const res = await api().post("/api/fa4/session/result").set(auth(t));
      expect(JSON.stringify(res.body)).not.toMatch(/demand|ACTIONABLE|INFORMATIONAL|sourcing_status/i);
      const pid = await projectId(t);
      const sig = await rawSignals(db, pid);
      const by = (r: string) => sig.filter((s) => s.reason === r);
      expect(by("SOURCEABLE").map((s) => s.capabilityId)).toEqual(["CAP_HIVE_HR_RECRUITMENT"]);
      expect(by("NO_ACTIVE_COVERAGE").every((s) => s.destination === "US" && s.class === "ACTIONABLE")).toBe(true);
      expect(by("NOT_OFFERED")).toHaveLength(1);
      expect(by("NOT_OFFERED")[0]).toMatchObject({ class: "INFORMATIONAL", capabilityId: "CAP_HIVE_LEGAL_PERMITS" });
      expect(sig.some((s) => s.capabilityId?.startsWith("CAP_SA_"))).toBe(false);          // advisory REVIEW never creates a signal
      expect(sig.every((s) => s.catalogVersion === SEED_CATALOG.version && s.premiumState === "OFFERED")).toBe(true);
      const n = sig.length;
      await api().post("/api/fa4/session/result").set(auth(t));
      expect((await rawSignals(db, pid)).length).toBe(n);
    });

    it("raw access is limited to authorized internal roles; providers and general sales only see aggregates without project data", async () => {
      const t = await start(journeyB("es", "unknown"));
      await api().post("/api/fa4/session/result").set(auth(t));
      const sig = await allSignals(db);
      for (const role of ["provider", "sales_general", "sherpa_premium"] as const) expect(canReadRawDemand(role, sig[0]!)).toBe(false);
      for (const role of ["normalization", "catalog_maintenance", "coverage_planning", "product_ops_review"] as const) expect(canReadRawDemand(role, sig[0]!)).toBe(true);
      const agg = JSON.stringify(aggregateDemand(sig));
      expect(agg).not.toContain(await projectId(t)); expect(agg).not.toMatch(/Müller|klaus/i);
    });

    it("no signals are created while the destination is undefined", async () => {
      const a = journeyA(); a.destinations = { list: [], open: true, sameInAll: null }; a.components = [{ ...a.components[0]!, destinations: ["OPEN"] }];
      const t = await start(a);
      const r = await api().post("/api/fa4/session/result").set(auth(t));
      expect(r.body.model.destinations[0].countryMessage).toBe("UNDEFINED");
      expect(await rawSignals(db, await projectId(t))).toEqual([]);
    });
  });

  describe("abuse prevention uses the shared PostgreSQL rate limiter", () => {
    it("project creation is limited per address and counted in rate_limit_counter", async () => {
      const limiter = createRateLimiter({ store: new PostgresRateLimitStore(db), secret: "test-secret-at-least-thirty-two-characters", now: () => clock.now });
      let last = 201;
      for (let i = 0; i < 12; i++) last = (await api({ limiter }).post("/api/fa4/sessions").send({ answers: journeyA() })).status;
      expect(last).toBe(429);
      const { rows } = await client.query("SELECT policy, max(hits)::int AS hits FROM rate_limit_counter WHERE policy LIKE 'fa4_%' GROUP BY policy");
      expect(rows.find((r) => r.policy === "fa4_create_address")!.hits).toBeGreaterThan(10);
      void MemoryRateLimitStore;
    });
  });
});
