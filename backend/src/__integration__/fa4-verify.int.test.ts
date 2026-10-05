import { Pool } from "pg";
import request from "supertest";
import { SEED_CATALOG } from "@beeside/fa-public-engine/seed";
import { journeyA, journeyB } from "@beeside/fa-public-engine/testing";
import { Answers } from "@beeside/fa-public-engine";
import { Db, createPoolDb } from "../db/database";
import { createApp } from "../index";
import { CaptureEmailTransport } from "../fa/email/email-adapter";
import {
  catalogVersions, loadPublishedCatalog, publishCapability, rawSignals, saveCapabilityDraft, seedCatalogIfEmpty,
} from "../fa4/repository";
import { Fa4Deps } from "../fa4/routes";
import { MemoryRateLimitStore, createRateLimiter } from "../security/rate-limit";

/**
 * VERIFY fix pass — runs against REAL PostgreSQL with REAL commits and the ACTUAL least-privilege `beeside_runtime_role`:
 *   TEST_RUNTIME_ADMIN_DATABASE_URL  owner / migration role (assertions, privileged operations)
 *   TEST_RUNTIME_DATABASE_URL        a LOGIN role that is a member of beeside_runtime_role (what the application uses)
 * Use a dedicated database: data is committed (append-only tables cannot be cleaned), every test uses unique emails / versions.
 */
const adminUrl = process.env.TEST_RUNTIME_ADMIN_DATABASE_URL;
const runtimeUrl = process.env.TEST_RUNTIME_DATABASE_URL;
const describeRt = adminUrl && runtimeUrl ? describe : describe.skip;

const legal = { termsVersion: "T-1", termsUrl: { es: "https://fa.test/es/t", en: "https://fa.test/en/t" }, privacyVersion: "P-1", privacyUrl: { es: "https://fa.test/es/p", en: "https://fa.test/en/p" } };
let counter = 0;
const uniq = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

describeRt("FA Public v1.0 — runtime role, publish isolation, resume security, legal evidence, anonymization", () => {
  const admin = new Pool({ connectionString: adminUrl });
  const rt = new Pool({ connectionString: runtimeUrl });
  const adminDb: Db = createPoolDb(admin);
  const rtDb: Db = createPoolDb(rt);
  const mail = new CaptureEmailTransport();
  const clock = { now: new Date() };
  const mkDeps = (over: Partial<Fa4Deps["config"]> = {}): Fa4Deps => ({
    db: rtDb, email: mail, emailDispatch: "inline",
    config: { appBaseUrl: "https://fa.test", sessionTtlHours: 24, resumeLinkDays: 30, emailCooldownMinutes: 5, emailRecipientDailyQuota: 6, resumeProjectsPerRequest: 3, legal, now: () => clock.now, ...over },
  });
  const app = (over: Partial<Fa4DepsConfig> = {}, limiter?: ReturnType<typeof createRateLimiter>) =>
    request(createApp({ fa4: mkDeps(over), ...(limiter ? { security: { limiter } } : {}) }));
  type Fa4DepsConfig = Fa4Deps["config"];
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const answersFor = (email: string, base: Answers = journeyA()): Answers => ({ ...base, identity: { ...base.identity, email } });
  const q = async (sql: string, v: unknown[] = []) => (await admin.query(sql, v)).rows;
  const start = async (email: string, base?: Answers) => {
    const r = await app().post("/api/fa4/sessions").send({ answers: answersFor(email, base), step: "company" });
    expect(r.status).toBe(201);
    const pid = (await q("SELECT project_id FROM fa4_project WHERE email = $1 ORDER BY created_at DESC LIMIT 1", [email]))[0].project_id as string;
    return { token: r.body.sessionToken as string, pid };
  };
  const linkFrom = (m: { ctaUrl?: string }) => /#r=([^&]+)/.exec(m.ctaUrl ?? "")?.[1] ?? "";
  const email = (tag: string) => `${tag}.${uniq()}@verify.example`;

  beforeAll(async () => { await seedCatalogIfEmpty(adminDb, SEED_CATALOG); });
  beforeEach(() => { mail.messages.length = 0; clock.now = new Date(); });
  afterAll(async () => { await admin.end(); await rt.end(); });

  describe("B1 — least privilege: the app works as beeside_runtime_role with no broad DELETE", () => {
    it("the login role is really the runtime role: not owner, not superuser, no DELETE anywhere", async () => {
      const who = (await rt.query("SELECT current_user AS u, (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS su, pg_has_role(current_user, 'beeside_runtime_role', 'member') AS member")).rows[0];
      expect(who.su).toBe(false); expect(who.member).toBe(true);
      const del = await q("SELECT count(*)::int AS n FROM information_schema.role_table_grants WHERE grantee = 'beeside_runtime_role' AND privilege_type = 'DELETE' AND table_name LIKE 'fa4_%'");
      expect(del[0].n).toBe(0);
      await expect(rt.query("DELETE FROM fa4_demand_signal")).rejects.toMatchObject({ code: "42501" });
    });

    it("create → autosave → result (twice, with changed demand) → finish-later → resume all work under the runtime role", async () => {
      const e = email("b1");
      const { token } = await start(e);
      expect((await app().put("/api/fa4/session").set(auth(token)).send({ answers: answersFor(e), step: "dest" })).status).toBe(200);
      const r1 = await app().post("/api/fa4/session/result").set(auth(token));
      expect(r1.status).toBe(200);
      const changed = answersFor(e); changed.addedNeeds = [{ destination: changed.components[0]!.destinations[0]!, text: "algo muy específico que no existe", front: null } as never];
      await app().put("/api/fa4/session").set(auth(token)).send({ answers: changed, step: "result" });
      const r2 = await app().post("/api/fa4/session/result").set(auth(token));
      expect(r2.status).toBe(200);
      expect((await app().post("/api/fa4/session/finish-later").set(auth(token))).status).toBe(200);
      expect(mail.messages.at(-1)!.to).toBe(e);
      const ex = await app().post("/api/fa4/links/continue").send({ token: linkFrom(mail.messages.at(-1)!) });
      expect(ex.status).toBe(200);
    });

    it("the runtime role cannot rewrite history or erase personal data: no UPDATE on append-only tables, no TRUNCATE, no anonymize function", async () => {
      for (const sql of [
        "UPDATE fa4_result SET model = '{}'", "UPDATE fa4_catalog_version SET content = '{}'", "UPDATE fa4_legal_acceptance SET language = 'en'",
        "UPDATE fa4_privacy_erasure_log SET actor = 'x'", "TRUNCATE fa4_result", "TRUNCATE fa4_legal_acceptance",
        "SELECT fa4_anonymize_project(gen_random_uuid(), 'a', 'b')",
      ]) await expect(rt.query(sql)).rejects.toMatchObject({ code: "42501" });
      // the erasure bypass setting is not something the application can turn on
      const c = await rt.connect();
      try {
        await c.query("SET fa4.erasure = 'on'");
        await expect(c.query("UPDATE fa4_result SET model = '{}'")).rejects.toMatchObject({ code: "42501" });
      } finally { c.release(); }
    });

    it("even the owner role cannot UPDATE / DELETE / TRUNCATE delivered results through ordinary SQL", async () => {
      await expect(admin.query("UPDATE fa4_result SET model = '{}'")).rejects.toMatchObject({ code: "BV601" });
      await expect(admin.query("DELETE FROM fa4_result")).rejects.toMatchObject({ code: "BV601" });
      await expect(admin.query("TRUNCATE fa4_result CASCADE")).rejects.toMatchObject({ code: "BV601" });
    });
  });

  describe("B2 — drafts never overwrite or remove the PUBLISHED capability; publishing is serialized", () => {
    const cloneOf = (id: string, over: Record<string, unknown> = {}) => ({ ...SEED_CATALOG.capabilities.find((c) => c.capabilityId === "CAP_HIVE_FIN_BANKING")!, capabilityId: id, ...over }) as never;
    const published = async () => (await loadPublishedCatalog(adminDb)).capabilities;

    it("a draft on an already PUBLISHED capability leaves the published one untouched; draft A + publish B keeps A", async () => {
      const tag = uniq();
      const A = `CAP_TEST_A_${tag}`; const B = `CAP_TEST_B_${tag}`;
      const vA = `va-${tag}`; const vB = `vb-${tag}`;
      const baseline = (await published()).length;
      // A: new capability, published
      await saveCapabilityDraft(rtDb, cloneOf(A), "admin", "A");
      expect(await publishCapability(rtDb, A, "admin", "A", vA)).toEqual({ ok: true, version: vA });
      const publishedA = (await published()).find((c) => c.capabilityId === A)!;
      expect(publishedA.publicationStatus).toBe("PUBLISHED");
      // a DRAFT edit of A, then publish B
      await saveCapabilityDraft(rtDb, cloneOf(A, { nameEs: "A editado (borrador)", capabilityStatus: "UNAVAILABLE" }), "admin", "draft A");
      const ent = (await q("SELECT publication_status, data, draft_data FROM fa4_catalog_entity WHERE entity_id = $1", [A]))[0];
      expect(ent.publication_status).toBe("PUBLISHED");            // effective record untouched
      expect(ent.data.nameEs).toBe(publishedA.nameEs);
      expect(ent.draft_data.nameEs).toBe("A editado (borrador)");   // pending edit kept apart
      await saveCapabilityDraft(rtDb, cloneOf(B), "admin", "B");
      expect(await publishCapability(rtDb, B, "admin", "B", vB)).toEqual({ ok: true, version: vB });
      const caps = await published();
      const a = caps.find((c) => c.capabilityId === A)!;
      expect(a).toBeDefined();                                       // A not dropped (was: 48 vs 49)
      expect(a.nameEs).toBe(publishedA.nameEs);                      // and not replaced by its draft
      expect(a.publicationStatus).toBe("PUBLISHED");
      expect(caps.find((c) => c.capabilityId === B)).toBeDefined();
      expect(caps.filter((c) => c.publicationStatus !== "PUBLISHED")).toHaveLength(0);
      expect(caps.length).toBe(baseline + 2);                         // nothing dropped, exactly A and B added
      // later publishing A's draft is an explicit act
      expect(await publishCapability(rtDb, A, "admin", "publish draft A", `vc-${tag}`)).toMatchObject({ ok: true });
      expect((await published()).find((c) => c.capabilityId === A)!.nameEs).toBe("A editado (borrador)");
    });

    it("two concurrent publishes are serialized and neither drops the other (deterministic: second blocks on the lock until the first commits)", async () => {
      const tag = uniq();
      const X = `CAP_TEST_X_${tag}`; const Y = `CAP_TEST_Y_${tag}`;
      await saveCapabilityDraft(rtDb, cloneOf(X), "admin", "X"); await saveCapabilityDraft(rtDb, cloneOf(Y), "admin", "Y");
      const before = (await catalogVersions(adminDb)).length;
      let release!: () => void; const gate = new Promise<void>((r) => { release = r; });
      let firstLocked!: () => void; const locked = new Promise<void>((r) => { firstLocked = r; });
      const p1 = publishCapability(rtDb, X, "admin", "X", `vx-${tag}`, { afterLock: async () => { firstLocked(); await gate; } });
      await locked;
      let secondDone = false;
      const p2 = publishCapability(rtDb, Y, "admin", "Y", `vy-${tag}`).then((r) => { secondDone = true; return r; });
      // the second publish must be waiting on the advisory lock, not racing ahead
      for (let i = 0; i < 100; i++) {
        const w = await q("SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted");
        if (w[0].n > 0) break;
        await new Promise((r) => setTimeout(r, 20));
      }
      expect((await q("SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted"))[0].n).toBeGreaterThan(0);
      expect(secondDone).toBe(false);
      release();
      expect(await p1).toMatchObject({ ok: true }); expect(await p2).toMatchObject({ ok: true });
      const ids = (await published()).map((c) => c.capabilityId);
      expect(ids).toContain(X); expect(ids).toContain(Y);             // no lost update
      expect((await catalogVersions(adminDb)).length).toBe(before + 2);
      // the later version contains everything the earlier one had
      const seq = await q("SELECT version, jsonb_array_length(content->'capabilities') AS n FROM fa4_catalog_version ORDER BY version_seq DESC LIMIT 2");
      expect(seq[0].n).toBe(seq[1].n + 1);
    });

    it("publishing the same version id twice is refused cleanly", async () => {
      const tag = uniq(); const Z = `CAP_TEST_Z_${tag}`;
      await saveCapabilityDraft(rtDb, cloneOf(Z), "admin", "Z");
      expect(await publishCapability(rtDb, Z, "admin", "Z", `vz-${tag}`)).toMatchObject({ ok: true });
      await saveCapabilityDraft(rtDb, cloneOf(Z, { nameEs: "otro" }), "admin", "Z2");
      const dup = await publishCapability(rtDb, Z, "admin", "Z2", `vz-${tag}`);
      expect(dup.ok).toBe(false);
    });
  });

  describe("M1 — project-specific, single-use resume links; no abuse by email alone", () => {
    it("an email alone never opens 'the latest project': each link opens exactly its own project", async () => {
      const e = email("m1");
      const p1 = await start(e); const p2 = await start(e, journeyB());
      expect(p1.pid).not.toBe(p2.pid);
      const r = await app().post("/api/fa4/links/request").send({ email: e });
      expect(r.status).toBe(200); expect(r.body).toEqual({ ok: true });      // no tokens, links or hints in the response
      expect(JSON.stringify(r.body)).not.toMatch(/token|#r=/);
      expect(mail.messages).toHaveLength(2);
      expect(mail.messages.every((m) => m.to === e)).toBe(true);
      const opened = new Set<string>();
      for (const m of mail.messages) {
        const ex = await app().post("/api/fa4/links/continue").send({ token: linkFrom(m) });
        expect(ex.status).toBe(200);
        opened.add((await q("SELECT project_id FROM fa4_access_token WHERE token_hash = encode(sha256(convert_to($1,'UTF8')),'hex')", [ex.body.sessionToken]))[0].project_id);
      }
      expect(opened).toEqual(new Set([p1.pid, p2.pid]));
    });

    it("creating another project with the same email does not change what an issued link opens", async () => {
      const e = email("m1b");
      const p1 = await start(e);
      await app().post("/api/fa4/session/finish-later").set(auth(p1.token));
      const link = linkFrom(mail.messages.at(-1)!);
      await start(e); await start(e);                                         // newer projects with the same address
      const ex = await app().post("/api/fa4/links/continue").send({ token: link });
      const opened = (await q("SELECT project_id FROM fa4_access_token WHERE token_hash = encode(sha256(convert_to($1,'UTF8')),'hex')", [ex.body.sessionToken]))[0].project_id;
      expect(opened).toBe(p1.pid);
    });

    it("links are single-use: a replay is refused with the same generic answer as an unknown link", async () => {
      const e = email("m1c");
      const p = await start(e);
      await app().post("/api/fa4/session/finish-later").set(auth(p.token));
      const link = linkFrom(mail.messages.at(-1)!);
      const first = await app().post("/api/fa4/links/continue").send({ token: link });
      expect(first.status).toBe(200);
      const replay = await app().post("/api/fa4/links/continue").send({ token: link });
      const unknown = await app().post("/api/fa4/links/continue").send({ token: "A".repeat(43) });
      expect(replay.status).toBe(404);
      expect(replay.body).toEqual(unknown.body);
      // concurrent exchange of one link: exactly one winner
      await app().post("/api/fa4/session/finish-later").set(auth(p.token));      // within cooldown → no mail
      clock.now = new Date(clock.now.getTime() + 6 * 60_000);
      await app().post("/api/fa4/session/finish-later").set(auth(p.token));
      const l2 = linkFrom(mail.messages.at(-1)!);
      const results = await Promise.all([1, 2, 3, 4].map(() => app().post("/api/fa4/links/continue").send({ token: l2 })));
      expect(results.filter((x) => x.status === 200)).toHaveLength(1);
    });

    it("issuing a replacement revokes the superseded unused link", async () => {
      const e = email("m1d");
      const p = await start(e);
      await app().post("/api/fa4/session/finish-later").set(auth(p.token));
      const old = linkFrom(mail.messages.at(-1)!);
      clock.now = new Date(clock.now.getTime() + 6 * 60_000);
      await app().post("/api/fa4/session/finish-later").set(auth(p.token));
      const fresh = linkFrom(mail.messages.at(-1)!);
      expect(fresh).not.toBe(old);
      expect((await app().post("/api/fa4/links/continue").send({ token: old })).status).toBe(404);
      expect((await app().post("/api/fa4/links/continue").send({ token: fresh })).status).toBe(200);
      expect((await q("SELECT count(*)::int AS n FROM fa4_access_token WHERE project_id = $1 AND kind = 'RESUME' AND revoked_at IS NULL", [p.pid]))[0].n).toBe(0);
    });

    it("resume-by-email never reveals whether an address exists (same body, same status) and an attacker never receives a token", async () => {
      const known = email("m1e"); await start(known);
      const a = await app().post("/api/fa4/links/request").send({ email: known });
      const b = await app().post("/api/fa4/links/request").send({ email: email("nobody") });
      const c = await app().post("/api/fa4/links/request").send({ email: "not-an-email" });
      expect([a.status, b.status, c.status]).toEqual([200, 200, 200]);
      expect(a.body).toEqual(b.body); expect(b.body).toEqual(c.body);
      expect(a.headers["set-cookie"]).toBeUndefined();
    });

    it("flooding a victim is bounded: per (email + origin), per email and per-recipient daily quota (configurable)", async () => {
      const victim = email("victim"); await start(victim);
      const limiter = createRateLimiter({ store: new MemoryRateLimitStore(), secret: "x".repeat(32), now: () => clock.now });
      const hit = () => app({ emailCooldownMinutes: 0, emailRecipientDailyQuota: 3 }, limiter).post("/api/fa4/links/request").send({ email: victim });
      const statuses: number[] = [];
      for (let i = 0; i < 6; i++) { statuses.push((await hit()).status); clock.now = new Date(clock.now.getTime() + 1000); }
      expect(statuses.filter((s) => s === 200).length).toBe(2);                       // (email+origin) pair limit = 2 / hour
      expect(statuses.filter((s) => s === 429).length).toBe(4);
      // limits are configuration, not code
      const lenient = createRateLimiter({ store: new MemoryRateLimitStore(), secret: "y".repeat(32), now: () => clock.now });
      const ok: number[] = [];
      for (let i = 0; i < 5; i++) { ok.push((await app({ emailCooldownMinutes: 0, emailRecipientDailyQuota: 3, rateLimits: { linkRequestPair: { limit: 50, windowSeconds: 3600 }, linkRequestEmail: { limit: 50, windowSeconds: 3600 }, linkRequestAddress: { limit: 50, windowSeconds: 3600 } } }, lenient).post("/api/fa4/links/request").send({ email: victim })).status); clock.now = new Date(clock.now.getTime() + 1000); }
      expect(ok).toEqual([200, 200, 200, 200, 200]);
      // …but the victim's inbox is still capped by the per-recipient quota
      expect(mail.messages.filter((m) => m.to === victim).length).toBeLessThanOrEqual(3);
    });

    it("cooldown dedupe holds under a race: simultaneous requests queue one email", async () => {
      const e = email("race"); const p = await start(e);
      await Promise.all([1, 2, 3, 4, 5].map(() => app().post("/api/fa4/session/finish-later").set(auth(p.token))));
      expect((await q("SELECT count(*)::int AS n FROM fa4_email_delivery WHERE project_id = $1", [p.pid]))[0].n).toBe(1);
    });
  });

  describe("M2 — immutable, separate legal-acceptance evidence", () => {
    it("records Terms and Privacy separately with version, URL, language, timestamp — and nothing else about the person", async () => {
      const e = email("m2"); const p = await start(e);
      const rows = await q("SELECT * FROM fa4_legal_acceptance WHERE project_id = $1 ORDER BY document", [p.pid]);
      expect(rows.map((r) => r.document)).toEqual(["PRIVACY", "TERMS"]);
      const terms = rows.find((r) => r.document === "TERMS");
      expect(terms).toMatchObject({ document_version: "T-1", document_url: "https://fa.test/es/t", language: "es" });
      expect(terms.accepted_at).toBeInstanceOf(Date);
      expect(Object.keys(terms).sort()).toEqual(["accepted_at", "acceptance_id", "document", "document_url", "document_version", "language", "project_id"].sort());   // no IP / user agent / email
    });

    it("changing normal answers (name, flags, email) never rewrites the evidence; flags and email are pinned", async () => {
      const e = email("m2b"); const p = await start(e);
      const before = JSON.stringify(await q("SELECT * FROM fa4_legal_acceptance WHERE project_id = $1 ORDER BY document", [p.pid]));
      const edited = answersFor(email("other"));
      edited.identity = { ...edited.identity, name: "Otro Nombre", termsAccepted: false, privacyAcknowledged: false };
      expect((await app().put("/api/fa4/session").set(auth(p.token)).send({ answers: edited, step: "x" })).status).toBe(200);
      const saved = (await app().get("/api/fa4/session").set(auth(p.token))).body.answers.identity;
      expect(saved).toMatchObject({ email: e, termsAccepted: true, privacyAcknowledged: true, name: "Otro Nombre" });
      expect(JSON.stringify(await q("SELECT * FROM fa4_legal_acceptance WHERE project_id = $1 ORDER BY document", [p.pid]))).toBe(before);
    });

    it("the evidence is append-only for everyone, owner included", async () => {
      await expect(admin.query("UPDATE fa4_legal_acceptance SET language = 'en'")).rejects.toMatchObject({ code: "BV601" });
      await expect(admin.query("DELETE FROM fa4_legal_acceptance")).rejects.toMatchObject({ code: "BV601" });
      await expect(admin.query("TRUNCATE fa4_legal_acceptance")).rejects.toMatchObject({ code: "BV601" });
    });

    it("a project cannot be created without configured legal identifiers in production", () => {
      const { fa4LegalFromEnv } = jest.requireActual("../index") as typeof import("../index");
      expect(() => fa4LegalFromEnv({ NODE_ENV: "production" } as never)).toThrow(/LEGAL-1/);
      expect(fa4LegalFromEnv({ NODE_ENV: "development" } as never).privacyVersion).toBe("UNSET-LEGAL-1");   // Terms default to the official version; Privacy stays an explicit placeholder
    });
  });

  describe("M3 — authorized irreversible anonymization (no automatic purge)", () => {
    it("anonymizes personal data, keeps append-only structure and legal evidence, logs the erasure, revokes tokens", async () => {
      const e = email("m3"); const p = await start(e);
      await app().post("/api/fa4/session/result").set(auth(p.token));
      const beforeVersion = (await q("SELECT catalog_version FROM fa4_result WHERE project_id = $1", [p.pid]))[0].catalog_version;
      await expect(admin.query("SELECT fa4_anonymize_project($1, '', 'x')", [p.pid])).rejects.toMatchObject({ code: "BV603" });          // actor and reason are mandatory
      await admin.query("SELECT fa4_anonymize_project($1, 'dpo@example.org', 'data-subject request #1')", [p.pid]);
      const proj = (await q("SELECT email, answers, status FROM fa4_project WHERE project_id = $1", [p.pid]))[0];
      expect(proj.status).toBe("ANONYMIZED"); expect(proj.email).not.toContain(e.split("@")[0]); expect(proj.answers).toEqual({});
      const res = await q("SELECT catalog_version, model FROM fa4_result WHERE project_id = $1", [p.pid]);
      expect(res[0].model).toEqual({ anonymized: true }); expect(res[0].catalog_version).toBe(beforeVersion);
      expect((await q("SELECT count(*)::int AS n FROM fa4_legal_acceptance WHERE project_id = $1", [p.pid]))[0].n).toBe(2);
      expect((await q("SELECT actor, mode FROM fa4_privacy_erasure_log WHERE project_id = $1", [p.pid]))[0]).toEqual({ actor: "dpo@example.org", mode: "ANONYMIZE" });
      expect((await app().get("/api/fa4/session").set(auth(p.token))).status).toBe(401);                                            // sessions are dead
      expect(JSON.stringify(await q("SELECT * FROM fa4_demand_signal WHERE project_id = $1", [p.pid]))).not.toContain(e);
      // append-only protection is intact afterwards
      await expect(admin.query("UPDATE fa4_result SET model = '{}' WHERE project_id = $1", [p.pid])).rejects.toMatchObject({ code: "BV601" });
      await expect(admin.query("UPDATE fa4_privacy_erasure_log SET actor = 'x'")).rejects.toMatchObject({ code: "BV601" });
      // an anonymized address is not resumable by email
      mail.messages.length = 0;
      await app().post("/api/fa4/links/request").send({ email: proj.email });
      expect(mail.messages).toHaveLength(0);
    });
  });

  describe("M4 — stable Demand Signal identity", () => {
    it("re-delivery updates the same signal, keeps sourcing work, supersedes (not deletes) vanished demand and revives returning demand", async () => {
      const e = email("m4"); const p = await start(e);
      await app().post("/api/fa4/session/result").set(auth(p.token));
      const first = await rawSignals(adminDb, p.pid, { includeSuperseded: true });
      expect(first.length).toBeGreaterThan(0);
      const target = first[0]!;
      await admin.query("UPDATE fa4_demand_signal SET owner = 'sourcing.lead', sourcing_status = 'RESEARCHING' WHERE signal_id = $1", [target.signalId]);
      await app().post("/api/fa4/session/result").set(auth(p.token));        // re-delivery, same answers
      const again = await q("SELECT signal_id, owner, sourcing_status, superseded_at FROM fa4_demand_signal WHERE project_id = $1 ORDER BY signal_id", [p.pid]);
      expect(again.map((r) => r.signal_id)).toEqual(first.map((s) => s.signalId).sort());      // same ids, no duplicates
      const row = again.find((r) => r.signal_id === target.signalId)!;
      expect(row).toMatchObject({ owner: "sourcing.lead", sourcing_status: "RESEARCHING", superseded_at: null });
      // demand disappears → superseded, row and sourcing work kept
      const none = answersFor(e); none.components = none.components.map((c) => ({ ...c, destinations: [] }));
      await app().put("/api/fa4/session").set(auth(p.token)).send({ answers: none, step: "x" });
      const del = await app().post("/api/fa4/session/result").set(auth(p.token));
      if (del.status === 200) {
        const gone = (await q("SELECT owner, superseded_at FROM fa4_demand_signal WHERE signal_id = $1", [target.signalId]))[0];
        expect(gone.owner).toBe("sourcing.lead"); expect(gone.superseded_at).not.toBeNull();
      }
      // demand returns → same id revived with its work intact
      await app().put("/api/fa4/session").set(auth(p.token)).send({ answers: answersFor(e), step: "x" });
      await app().post("/api/fa4/session/result").set(auth(p.token));
      const back = (await q("SELECT owner, sourcing_status, superseded_at FROM fa4_demand_signal WHERE signal_id = $1", [target.signalId]))[0];
      expect(back).toMatchObject({ owner: "sourcing.lead", sourcing_status: "RESEARCHING", superseded_at: null });
    });

    it("integrity constraints reject invalid operational values and unknown catalog versions", async () => {
      await expect(admin.query("UPDATE fa4_demand_signal SET sourcing_status = 'BOGUS'")).rejects.toMatchObject({ code: "23514" });
      await expect(admin.query("UPDATE fa4_demand_signal SET premium_state = 'BOGUS'")).rejects.toMatchObject({ code: "23514" });
      await expect(admin.query("UPDATE fa4_demand_signal SET catalog_version = 'no-such-version'")).rejects.toMatchObject({ code: "23503" });
    });
  });

  describe("public catalog, status normalization and input hygiene", () => {
    it("the public catalog cannot enumerate the internal capability × coverage matrix; resolution is server-side and per project", async () => {
      const tag = uniq(); const id = `CAP_TEST_LEAK_${tag}`;
      const secret = { internalRef: "SECRET-INTERNAL-REF", sourcingPolicy: "SECRET-POLICY", providerStatus: "AFFILIATED", businessCheckStatus: "PASSED", internalDescription: "SECRET-DESC", scopeLimitEs: "límite interno" };
      await saveCapabilityDraft(rtDb, { ...SEED_CATALOG.capabilities.find((c) => c.capabilityId === "CAP_HIVE_FIN_BANKING")!, capabilityId: id, ...secret } as never, "a", "x");
      expect(await publishCapability(rtDb, id, "a", "x", `vleak-${tag}`)).toMatchObject({ ok: true });
      const res = await app().get("/api/fa4/catalog");   // unauthenticated
      expect(res.status).toBe(200);
      const keys = new Set<string>();
      JSON.stringify(res.body, (k, v) => { if (k && Number.isNaN(Number(k))) keys.add(k); return v; });
      expect([...keys].sort()).toEqual(["front", "fronts", "key", "nameEn", "nameEs", "term", "textIndex", "version", "weight"]);   // no capabilities, coverage, countries or statuses exist in the shape
      const body = JSON.stringify(res.body);
      for (const s of ["SECRET-", "AFFILIATED", "PASSED", "CAP_HIVE", id, "capabilityStatus", "Grant Thornton", "Santander", "MAPFRE"]) expect(body).not.toContain(s);
      // the resolution endpoint is not public…
      expect((await app().post("/api/fa4/session/resolution").send({ answers: journeyA() })).status).toBe(401);
      // …and for a session it returns only coarse facts for that project: no capability, coverage or state per capability
      const p = await start(email("res"));
      const r = await app().post("/api/fa4/session/resolution").set(auth(p.token)).send({ answers: journeyA() });
      expect(r.status).toBe(200);
      expect(Object.keys(r.body).sort()).toEqual(["cargoRouteDestinations", "destinations", "premiumShown"]);
      expect(JSON.stringify(r.body)).not.toMatch(/CAP_|capabilit|coverage|SOURCEABLE|"ACTIVE"|"REVIEW"|trace|provider/);
      // a probe over many crafted projects still yields only booleans/lists of the project's own topics, never a matrix of countries × capabilities
      for (const dest of ["MX", "US", "DE", "ZZ"]) {
        const a = journeyA(); a.destinations.list = [{ iso: dest } as never]; a.components = a.components.map((c) => ({ ...c, destinations: [dest] }));
        const pr = await app().post("/api/fa4/session/resolution").set(auth(p.token)).send({ answers: a });
        expect(pr.status).toBe(200);
        expect(JSON.stringify(pr.body)).not.toMatch(/CAP_|coverage|NO_ACTIVE_COVERAGE|DEVELOPING/);
      }
    });

    it("project status is normalized after an eligibility correction (INELIGIBLE is not sticky)", async () => {
      const e = email("st"); const p = await start(e);
      const no = answersFor(e); no.company.hasExistingBusiness = false;
      await app().put("/api/fa4/session").set(auth(p.token)).send({ answers: no, step: "company" });
      expect((await q("SELECT status FROM fa4_project WHERE project_id = $1", [p.pid]))[0].status).toBe("INELIGIBLE");
      await app().put("/api/fa4/session").set(auth(p.token)).send({ answers: answersFor(e), step: "company" });
      expect((await q("SELECT status FROM fa4_project WHERE project_id = $1", [p.pid]))[0].status).toBe("IN_PROGRESS");
      await app().post("/api/fa4/session/result").set(auth(p.token));
      await app().put("/api/fa4/session").set(auth(p.token)).send({ answers: answersFor(e), step: "result" });
      expect((await q("SELECT status FROM fa4_project WHERE project_id = $1", [p.pid]))[0].status).toBe("DELIVERED");
    });

    it("prototype-pollution record keys are never stored; a repeated continuation click is idempotent", async () => {
      const e = email("pp"); const a = answersFor(e); a.fronts = {};
      const raw = JSON.stringify({ answers: a }).replace('"fronts":{}', '"fronts":{"__proto__":{"status":"resolved"}}');
      expect(raw).toContain("__proto__");
      const bad = await request(createApp({ fa4: mkDeps() })).post("/api/fa4/sessions").set("Content-Type", "application/json").send(raw);
      // either refused or sanitized: the reserved key is never stored and the prototype is never polluted
      if (bad.status === 201) {
        const stored = (await q("SELECT answers->'fronts' ? '__proto__' AS has FROM fa4_project WHERE email = $1", [e]))[0];
        expect(stored.has).toBe(false);
      } else expect(bad.status).toBe(400);
      expect(({} as Record<string, unknown>).status).toBeUndefined();
      const p = await start(e);
      const r = await app().post("/api/fa4/session/result").set(auth(p.token));
      if (r.body.model?.premium?.shown) {
        await app().post("/api/fa4/session/continue").set(auth(p.token)); await app().post("/api/fa4/session/continue").set(auth(p.token));
        expect((await q("SELECT count(*)::int AS n FROM fa4_continuation_request WHERE project_id = $1", [p.pid]))[0].n).toBe(1);
      }
    });
  });
});
