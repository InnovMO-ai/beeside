/**
 * Session, entitlement, locale, error contract, rate limits and the internal status page — through HTTP, on PostgreSQL.
 */
import { randomUUID } from "node:crypto";
import request from "supertest";
import { createLinkToken, hashToken, revokeProjectTokens } from "../../domain/tokens";
import type { RateLimiter } from "../../../security/rate-limit";
import { internalTermsIn } from "./drive";
import { FA_CONTEXT, setupHarness, TEST_DATABASE_URL, type Harness } from "./harness";

const describeWithDb = TEST_DATABASE_URL ? describe : describe.skip;
const ERROR_KEYS = ["error", "message", "retryable"];
const UNAUTH_KEYS = [...ERROR_KEYS, "support"];

describeWithDb("Precision API — session, access, errors", () => {
  let h: Harness;
  let withKey: Harness;
  beforeAll(async () => {
    h = await setupHarness();
    withKey = await setupHarness({ internalKey: "internal-key-for-tests-0123456789" });
  }, 120_000);
  afterAll(async () => {
    expect(internalTermsIn(h.seen)).toEqual([]);
    await h.close();
    await withKey.close();
  });

  const exchange = (code: unknown, locale?: string) => {
    const r = request(h.app).post("/api/precision/session/exchange");
    if (locale) r.set("X-Precision-Locale", locale);
    return r.send({ code } as object);
  };

  describe("link exchange", () => {
    it("turns a one-time link into an opaque session; only the sha256 is stored", async () => {
      const { projectId } = await h.newProject();
      const link = await h.link(projectId);
      const r = await exchange(link);
      expect(r.status).toBe(200);
      const body = r.body as { sessionToken: string; expiresAt: string };
      expect(Object.keys(body).sort()).toEqual(["expiresAt", "sessionToken"]);
      expect(body.sessionToken).toMatch(/^[A-Za-z0-9_-]{40,}$/);
      expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now());
      const rows = (await h.db.query<{ kind: string; token_hash: string; consumed_at: Date | null }>("SELECT kind, token_hash, consumed_at FROM precision_access_token WHERE project_id = $1 ORDER BY kind", [projectId])).rows;
      expect(rows.map((x) => x.kind)).toEqual(["link", "session"]);
      expect(rows.find((x) => x.kind === "link")!.consumed_at).not.toBeNull();
      expect(rows.map((x) => x.token_hash).sort()).toEqual([hashToken(link), hashToken(body.sessionToken)].sort());
      const raw = await h.db.query("SELECT 1 FROM precision_access_token WHERE token_hash = $1 OR token_hash = $2", [link, body.sessionToken]);
      expect(raw.rows).toHaveLength(0);
      // neither token ever reached the logs
      expect(h.logs.join("\n")).not.toContain(link);
      expect(h.logs.join("\n")).not.toContain(body.sessionToken);
    });

    it("is single use: the second exchange of the same link fails", async () => {
      const { projectId } = await h.newProject();
      const link = await h.link(projectId);
      expect((await exchange(link)).status).toBe(200);
      const again = await exchange(link);
      expect(again.status).toBe(401);
      expect(Object.keys(again.body).sort()).toEqual(UNAUTH_KEYS.slice().sort());
      expect(again.body).toMatchObject({ error: "UNAUTHENTICATED", retryable: false });
    });

    it("lets exactly one of two parallel exchanges win", async () => {
      const { projectId } = await h.newProject();
      const link = await h.link(projectId);
      const results = await Promise.all([exchange(link), exchange(link), exchange(link)]);
      expect(results.filter((x) => x.status === 200)).toHaveLength(1);
      expect(results.filter((x) => x.status === 401)).toHaveLength(2);
    });

    it("refuses an expired link", async () => {
      const { projectId } = await h.newProject();
      const link = (await createLinkToken(h.db, projectId, 1)).token;
      await new Promise((r) => setTimeout(r, 30));
      expect((await exchange(link)).status).toBe(401);
    });

    it("refuses a revoked link and kills the sessions of the project", async () => {
      const { projectId } = await h.newProject();
      const session = await h.session(projectId);
      expect((await h.api(session).get("/entry")).status).toBe(200);
      const link = await h.link(projectId);
      await revokeProjectTokens(h.db, projectId, new Date());
      expect((await exchange(link)).status).toBe(401);
      expect((await h.api(session).get("/entry")).status).toBe(401);
    });

    it("answers every malformed or unknown code the same way, with the configured Contact beeside address", async () => {
      for (const bad of [undefined, "", "short", 12345, "x".repeat(300), "not a code with spaces!!!!!!", randomUUID() + randomUUID()]) {
        const r = await exchange(bad);
        expect(r.status).toBe(401);
        expect(r.body).toMatchObject({ error: "UNAUTHENTICATED", retryable: false, support: { email: "contact@beeside.you" } });
      }
      await h.db.query("UPDATE precision_config SET is_active = false WHERE key = 'contact_beeside_email' AND is_active");
      await h.db.query("INSERT INTO precision_config (key, locale, value) VALUES ('contact_beeside_email', '*', $1::jsonb)", [JSON.stringify("ops@example.test")]);
      expect((await exchange(randomUUID() + randomUUID())).body.support).toEqual({ email: "ops@example.test" });
      await h.db.query("UPDATE precision_config SET is_active = false WHERE key = 'contact_beeside_email' AND is_active");
      expect((await exchange(randomUUID() + randomUUID())).body.support).toEqual({ email: "contact@beeside.you" });
    });

    it("GET /support is public and returns only the Contact beeside address", async () => {
      const r = await request(h.app).get("/api/precision/support");
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ email: "contact@beeside.you" });
    });

    it("answers in the requested language", async () => {
      const es = await exchange(randomUUID() + randomUUID(), "es");
      const en = await exchange(randomUUID() + randomUUID(), "en");
      expect(es.body.message).toMatch(/enlace/i);
      expect(en.body.message).toMatch(/link/i);
    });
  });

  describe("bearer sessions", () => {
    it("rejects missing, malformed, unknown and expired tokens", async () => {
      for (const header of [undefined, "Bearer", "Bearer x", "Basic abcdefghijklmnopqrstuvwxyz", `Bearer ${"a".repeat(43)}`]) {
        const r = request(h.app).get("/api/precision/entry");
        if (header) r.set("Authorization", header);
        const res = await r;
        expect(res.status).toBe(401);
        expect(res.body).toMatchObject({ error: "UNAUTHENTICATED" });
      }
      const { projectId } = await h.newProject();
      const raw = `expired${randomUUID().replace(/-/g, "")}`;
      await h.db.query("INSERT INTO precision_access_token (token_hash, project_id, kind, expires_at) VALUES ($1, $2, 'session', now() - interval '1 minute')", [hashToken(raw), projectId]);
      expect((await h.api(raw).get("/entry")).status).toBe(401);
    });

    it("a link token is not a session", async () => {
      const { projectId } = await h.newProject();
      const link = await h.link(projectId);
      expect((await h.api(link).get("/entry")).status).toBe(401);
    });
  });

  describe("entitlement is evaluated on every request", () => {
    it("FULL / READ_ONLY / REVOKED", async () => {
      const { projectId } = await h.newProject();
      const api = h.api(await h.session(projectId));
      const fullCenter = await api.get("/center");
      expect(fullCenter.status).toBe(200);
      expect(fullCenter.body.identity).toEqual({ name: "Test Person", premium: true });
      expect((await api.post("/understanding/turns", { turnKey: "turn-full-0001", text: "Open a hub in Mexico" })).status).toBe(200);

      h.entitlement.set({ projectId, premiumActive: false, accessMode: "READ_ONLY", readonlyUntil: "2027-01-01T00:00:00.000Z" });
      const center = await api.get("/center");
      expect(center.status).toBe(200);
      expect(center.body.access).toEqual({ mode: "READ_ONLY", readOnlyUntil: "2027-01-01T00:00:00.000Z" });
      // identity: the real Person's name stays; the PREMIUM label only while the entitlement is FULL
      expect(center.body.identity).toEqual({ name: "Test Person", premium: false });
      expect((await api.get("/understanding")).status).toBe(200);
      for (const [path, body] of [
        ["/understanding/turns", { turnKey: "turn-ro-0001", text: "hello there" }],
        ["/add-service/turns", { turnKey: "turn-ro-0002", text: "hello there" }],
        ["/service-map/confirm", { requestKey: "confirm-ro-0001" }],
        ["/categories/" + randomUUID() + "/turns", { turnKey: "turn-ro-0003", text: "hello there" }],
        ["/categories/" + randomUUID() + "/send", { previewChecksum: "x" }],
      ] as const) {
        const r = await api.post(path, body);
        expect([r.status, r.body.error]).toEqual([403, "PRECISION_READ_ONLY"]);
        expect(Object.keys(r.body).sort()).toEqual(ERROR_KEYS.slice().sort());
      }
      // the one sanctioned write while read-only: marking the cover seen
      expect((await api.post("/cover/seen")).status).toBe(200);

      h.entitlement.set({ projectId, premiumActive: false, accessMode: "REVOKED" });
      const entry = await api.get("/entry");
      expect(entry.status).toBe(200);
      expect(entry.body).toMatchObject({ access: { mode: "REVOKED" }, cover: null });
      for (const path of ["/center", "/understanding", "/help", "/service-map", "/add-service"]) {
        const r = await api.get(path);
        expect([r.status, r.body.error]).toEqual([403, "PRECISION_REVOKED"]);
      }
      expect((await api.post("/cover/seen")).status).toBe(403);

      // access returns the moment Core says so: nothing is cached in the session
      h.entitlement.set({ projectId, premiumActive: true, accessMode: "FULL" });
      expect((await api.get("/center")).status).toBe(200);
    });

    it("fails closed (retryable) when the entitlement cannot be determined", async () => {
      const { projectId } = await h.newProject();
      const api = h.api(await h.session(projectId));
      const original = h.entitlement.get.bind(h.entitlement);
      h.entitlement.get = async () => { throw new Error("core unreachable: connection refused to 10.0.0.1:5432"); };
      try {
        const r = await api.get("/center");
        expect(r.status).toBe(500);
        expect(r.body).toMatchObject({ error: "TEMPORARILY_UNAVAILABLE", retryable: true });
        expect(JSON.stringify(r.body)).not.toMatch(/10\.0\.0\.1|refused|core/i);
      } finally {
        h.entitlement.get = original;
      }
    });
  });

  describe("locale", () => {
    it("header first, then the First Assessment language, then English", async () => {
      const es = await h.newProject({ context: { ...FA_CONTEXT, locale: "es" } });
      const none = await h.newProject({ context: null });
      const tEs = await h.session(es.projectId);
      const tNone = await h.session(none.projectId);
      const noHeader = (token: string) => request(h.app).get("/api/precision/center").set("Authorization", `Bearer ${token}`);
      expect((await noHeader(tEs)).body.locale).toBe("es");
      expect((await noHeader(tNone)).body.locale).toBe("en");
      expect((await h.api(tEs, "en").get("/center")).body.locale).toBe("en");
      expect((await h.api(tNone, "es").get("/center")).body.locale).toBe("es");
      const u = await h.api(tNone, "es").get("/understanding");
      expect(u.body.turns.find((t: { kind: string }) => t.kind === "message").text).toMatch(/[¿]/);
    });
  });

  describe("error contract", () => {
    it("is one shape, localized, with no technical text", async () => {
      const { projectId } = await h.newProject();
      const other = await h.newProject();
      const api = h.api(await h.session(projectId), "es");
      const cases: Array<[string, request.Test]> = [
        ["unknown route", api.get("/does-not-exist")],
        ["malformed id", api.get("/categories/not-a-uuid")],
        ["unknown id", api.get(`/categories/${randomUUID()}`)],
        ["bad turn body", api.post("/understanding/turns", { turnKey: "x", text: "" })],
        ["not ready map", api.get("/service-map")],
        ["bad confirm key", api.post("/service-map/confirm", { requestKey: "x" })],
      ];
      for (const [label, call] of cases) {
        const r = await call;
        expect([label, r.status >= 400 && r.status < 500]).toEqual([label, true]);
        expect(Object.keys(r.body).sort()).toEqual(ERROR_KEYS.slice().sort());
        expect(typeof r.body.retryable).toBe("boolean");
        expect(JSON.stringify(r.body)).not.toMatch(/\bat \w+.*\(|node_modules|SELECT|INSERT|pg_|ERROR:|stack|BV\d{3}|violates|uuid/i);
      }
      expect((await api.get("/categories/not-a-uuid")).status).toBe(404);
      expect((await api.get("/service-map")).body.error).toBe("NOT_READY");
      void other;
    });

    it("caps bodies at 100 kB and rejects broken JSON, in the same shape", async () => {
      const { projectId } = await h.newProject();
      const token = await h.session(projectId);
      const big = await request(h.app).post("/api/precision/service-map/confirm").set("Authorization", `Bearer ${token}`).send({ requestKey: "x".repeat(200_000) });
      expect(big.status).toBe(400);
      expect(big.body).toMatchObject({ error: "INVALID_INPUT" });
      const broken = await request(h.app).post("/api/precision/service-map/confirm").set("Authorization", `Bearer ${token}`).set("Content-Type", "application/json").send("{not json");
      expect(broken.status).toBe(400);
      expect(Object.keys(broken.body).sort()).toEqual(ERROR_KEYS.slice().sort());
    });

    it("never lets one project read another project's category", async () => {
      const a = await h.newProject();
      const b = await h.newProject();
      const apiA = h.api(await h.session(a.projectId));
      const apiB = h.api(await h.session(b.projectId));
      const { confirmedProject } = await import("./drive");
      const cats = await confirmedProject(apiA);
      const idA = (Object.values(cats)[0] as { id: string }).id;
      expect((await apiA.get(`/categories/${idA}`)).status).toBe(200);
      expect((await apiB.get(`/categories/${idA}`)).status).toBe(404);
      expect((await apiB.post(`/categories/${idA}/turns`, { turnKey: "cross-0001-aa", text: "hello" })).status).toBe(404);
      expect((await apiB.get(`/categories/${idA}/crp`)).status).toBe(404);
    });
  });

  describe("rate limits", () => {
    it("answers 429 in the API error shape, with Retry-After", async () => {
      const calls: string[] = [];
      const limiter: RateLimiter = {
        async consume(policy) {
          calls.push(policy.name);
          return { allowed: !(policy.name === "precision_exchange_address" || policy.name === "precision_turns_project"), hits: 99, retryAfterSeconds: 7 };
        },
      };
      const lim = await setupHarness({ limiter });
      try {
        const x = await request(lim.app).post("/api/precision/session/exchange").send({ code: randomUUID() + randomUUID() });
        expect(x.status).toBe(429);
        expect(x.headers["retry-after"]).toBe("7");
        expect(x.body).toMatchObject({ error: "RATE_LIMITED", retryable: true });
        expect(Object.keys(x.body).sort()).toEqual(ERROR_KEYS.slice().sort());
        const { projectId } = await lim.newProject();
        const api = lim.api(await lim.session(projectId).catch(async () => {
          // the exchange itself is limited in this harness: mint the session directly
          const { token } = await (await import("../../domain/tokens")).issueSessionToken(lim.db, projectId, new Date());
          return token;
        }));
        expect((await api.get("/center")).status).toBe(200);
        const t = await api.post("/understanding/turns", { turnKey: "turn-rl-0001", text: "Open a hub" });
        expect([t.status, t.body.error]).toEqual([429, "RATE_LIMITED"]);
        expect(calls).toEqual(expect.arrayContaining(["precision_exchange_address", "precision_address", "precision_turns_project"]));
        expect(internalTermsIn(lim.seen)).toEqual([]);
      } finally {
        await lim.close();
      }
    });
  });

  describe("internal status", () => {
    it("does not exist without a configured key, and is invisible without the right one", async () => {
      expect((await request(h.app).get("/api/precision/internal/status").set("X-Precision-Internal-Key", "anything")).status).toBe(404);
      expect((await request(h.app).get("/api/precision/internal/status")).status).toBe(404);
      expect((await request(withKey.app).get("/api/precision/internal/status")).status).toBe(404);
      expect((await request(withKey.app).get("/api/precision/internal/status").set("X-Precision-Internal-Key", "wrong-key-for-tests-0123456789x")).status).toBe(404);
      // a customer session does not open it either
      const { projectId } = await withKey.newProject();
      const token = await withKey.session(projectId);
      expect((await request(withKey.app).get("/api/precision/internal/status").set("Authorization", `Bearer ${token}`)).status).toBe(404);
    });

    it("with the key: integrations (mode and verification), dataset, build and manifest versions", async () => {
      const r = await request(withKey.app).get("/api/precision/internal/status").set("X-Precision-Internal-Key", "internal-key-for-tests-0123456789");
      expect(r.status).toBe(200);
      const ports = (r.body.integrations as Array<{ port: string; implementation: string; mode: string; verification: string }>).map((i) => i.port).sort();
      expect(ports).toEqual(["entitlement", "fa_context", "model_provider", "operation_hub"]);
      expect((r.body.integrations as Array<{ mode: string }>).every((i) => i.mode === "SIMULATED")).toBe(true);
      expect(r.body.dataset).toBe("SYNTHETIC");
      expect(typeof r.body.manifests.project).toBe("string");
      expect(Object.keys(r.body.manifests.categories)).toEqual(expect.arrayContaining(["logistics", "_generic"]));
      // and none of it leaks into customer answers
      const { projectId } = await withKey.newProject();
      const api = withKey.api(await withKey.session(projectId));
      await api.get("/entry");
      await api.get("/center");
      expect(JSON.stringify(withKey.seen)).not.toMatch(/SIMULATED|scripted|fixture|NOT_VERIFIED/);
    });
  });
});
