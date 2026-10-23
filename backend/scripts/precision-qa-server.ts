/**
 * Precision QA server (internal; QA and rehearsal tooling, NOT product code).
 *
 * It composes the real product (`createApp` + `createPrecisionRuntime`: the same routers, domain, manifests, conversation engine,
 * delivery service and database as `src/index.ts`) with the isolated providers, and wraps those providers so a test can make them
 * fail on purpose: model unavailable / slow, First Assessment context unavailable, Operation Hub timeout / outage / rejection,
 * entitlement changes. The wrappers are keyed by PROJECT, so parallel browser tests never disturb each other.
 *
 * A second, loopback-only HTTP listener (the control port, key-protected) exposes the seams. The product port never exposes them.
 *
 *   DATABASE_URL=... PORT=18081 CONTROL_PORT=18082 QA_CONTROL_KEY=... ALLOWED_ORIGINS=http://localhost:14181 npx tsx scripts/precision-qa-server.ts
 */
import http from "node:http";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { Pool } from "pg";
import { createApp, securityOptionsFromEnv } from "../src/index";
import { createPoolDb } from "../src/db/database";
import { jsonLogger } from "../src/security/redact";
import { FixtureEntitlementProvider } from "../src/precision/adapters/fixture-entitlement";
import { FixtureFaContextReader } from "../src/precision/adapters/fixture-fa-context";
import { SimulatedOperationHub, type SimulatorAccessMode } from "../src/precision/adapters/simulator-operation-hub";
import { ModelUnavailableError, selectModelProvider, type ModelProvider, type ModelRequest, type ModelResponseFor } from "../src/precision/conversation";
import { DEMO_SCRIPT_FIXTURE } from "../src/precision/domain/seed/demo-script";
import { loadDemoFixtures, seedDemoProject, type DemoStage } from "../src/precision/domain/seed/demo-project";
import { createPrecisionRuntime } from "../src/precision/api/wiring";
import { OhPortError, type OhAccessState, type OhAcceptance, type OhHandoffPayload, type OhVerification, type OperationHubPort } from "../src/precision/ports/operation-hub";
import type { FaContextRead, FaContextReader } from "../src/precision/ports/fa-context";
import type { EntitlementState } from "../src/precision/ports/entitlement";
import type { RateLimiter, RateLimitDecision, RateLimitPolicy } from "../src/security/rate-limit";

const env = process.env;
if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const controlKey = env.QA_CONTROL_KEY ?? "";
if (controlKey.length < 16) throw new Error("QA_CONTROL_KEY (16+ chars) is required");
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ------------------------------------------------------------------ per-project fault state
interface ProjectFaults {
  modelFail: number; // next N model calls throw ModelUnavailableError
  modelSlowMs: number; // added latency per model call
  faFail: number | "always"; // First Assessment reads that throw
  ohFaults: Array<"timeout_after_store" | "unavailable" | "rate_limit" | "reject" | "corrupt" | "auth">;
  ohSlowMs: number;
  ohAccess: SimulatorAccessMode | null;
}
let clockOffsetMs = 0;
const faults = new Map<string, ProjectFaults>();
const faultsOf = (projectId: string): ProjectFaults => {
  let f = faults.get(projectId);
  if (!f) { f = { modelFail: 0, modelSlowMs: 0, faFail: 0, ohFaults: [], ohSlowMs: 0, ohAccess: null }; faults.set(projectId, f); }
  return f;
};

const pool = new Pool({ connectionString: env.DATABASE_URL, max: Number(env.PRECISION_DB_POOL_MAX ?? 20) });
const db = createPoolDb(pool);

async function projectOfTurn(turnKey: string): Promise<string | null> {
  const r = await pool.query<{ project_id: string }>("SELECT project_id FROM precision_turn WHERE turn_key = $1 LIMIT 1", [turnKey]);
  return r.rows[0]?.project_id ?? null;
}

class QaModelProvider implements ModelProvider {
  calls = 0;
  constructor(private readonly inner: ModelProvider) {}
  describe(): ReturnType<ModelProvider["describe"]> { return this.inner.describe(); }
  async complete<R extends ModelRequest>(req: R): Promise<ModelResponseFor<R>> {
    this.calls += 1;
    if (faults.size > 0) {
      const projectId = await projectOfTurn(req.turnKey);
      const f = projectId ? faults.get(projectId) : undefined;
      if (f) {
        if (f.modelSlowMs > 0) await sleep(f.modelSlowMs);
        if (f.modelFail > 0) { f.modelFail -= 1; throw new ModelUnavailableError("timeout"); }
      }
    }
    return this.inner.complete(req);
  }
}

class QaFaReader implements FaContextReader {
  constructor(readonly inner: FixtureFaContextReader) {}
  describe(): ReturnType<FaContextReader["describe"]> { return this.inner.describe(); }
  async read(projectId: string): Promise<FaContextRead | null> {
    const f = faults.get(projectId);
    if (f && f.faFail !== 0) {
      if (f.faFail !== "always") f.faFail -= 1;
      throw new Error("fa context unavailable (injected)");
    }
    return this.inner.read(projectId);
  }
}

class QaOperationHub implements OperationHubPort {
  inner = new SimulatedOperationHub();
  publishCalls = new Map<string, number>();
  describe(): ReturnType<OperationHubPort["describe"]> { return this.inner.describe(); }
  async publish(payload: OhHandoffPayload): Promise<OhAcceptance> {
    const pid = payload.identity.project_id;
    this.publishCalls.set(pid, (this.publishCalls.get(pid) ?? 0) + 1);
    const f = faults.get(pid);
    if (f?.ohSlowMs) await sleep(f.ohSlowMs);
    const next = f?.ohFaults.shift();
    // The simulator reads its fault queue synchronously at the start of publish, so this cannot leak to another project.
    if (next === "timeout_after_store") this.inner.timeoutAfterStore();
    else if (next === "unavailable") this.inner.unavailableBeforeStore();
    else if (next === "rate_limit") this.inner.rateLimitNext();
    else if (next === "reject") this.inner.rejectNext();
    else if (next === "corrupt") this.inner.corruptNext();
    else if (next === "auth") this.inner.authFailureNext();
    return this.inner.publish(payload);
  }
  verify(key: string): Promise<OhVerification> { return this.inner.verify(key); }
  async accessState(projectId: string): Promise<OhAccessState> {
    const real = await this.inner.accessState(projectId);
    const mode = faults.get(projectId)?.ohAccess;
    if (!mode || !real.provisioned) return real;
    if (mode === "pending") return { provisioned: true, clientAccessible: false, sherpaAssigned: false };
    if (mode === "accessible_without_sherpa") return { provisioned: true, clientAccessible: true, sherpaAssigned: false };
    return { provisioned: true, clientAccessible: true, sherpaAssigned: true, sherpaDisplayName: "Your beeside team" };
  }
  storedCount(): number { return this.inner.storedCount(); }
}

/** Rate limiting is off by default so a browser suite sharing one client address is not throttled; `arm` re-enables a tiny cap for one test. */
class QaLimiter implements RateLimiter {
  private armed = new Map<string, { limit: number; hits: Map<string, number> }>();
  arm(name: string, limit: number): void { this.armed.set(name, { limit, hits: new Map() }); }
  disarm(): void { this.armed.clear(); }
  async consume(policy: RateLimitPolicy, subject: string): Promise<RateLimitDecision> {
    const a = this.armed.get(policy.name);
    if (!a) return { allowed: true, hits: 0, retryAfterSeconds: 0 };
    const hits = (a.hits.get(subject) ?? 0) + 1;
    a.hits.set(subject, hits);
    return { allowed: hits <= a.limit, hits, retryAfterSeconds: 30 };
  }
}

async function main(): Promise<void> {
  const fixtureEntitlement = new FixtureEntitlementProvider();
  const fixtureFa = new FixtureFaContextReader();
  const qaFa = new QaFaReader(fixtureFa);
  const hub = new QaOperationHub();
  const model = new QaModelProvider(selectModelProvider({ env: { PRECISION_MODEL_PROVIDER: "scripted" }, fixture: DEMO_SCRIPT_FIXTURE }));
  const limiter = new QaLimiter();
  const runtime = await createPrecisionRuntime({
    env: { ...env, PRECISION_INTERNAL_KEY: env.PRECISION_INTERNAL_KEY ?? controlKey } as NodeJS.ProcessEnv,
    pool,
    db,
    log: jsonLogger,
    now: () => new Date(Date.now() + clockOffsetMs),
    limiter,
    integrations: { operationHub: hub, entitlement: fixtureEntitlement, faContext: qaFa },
    provider: model,
    publishManifests: true,
  });
  await loadDemoFixtures(db, { faContext: fixtureFa as never, entitlement: fixtureEntitlement as never });

  const security = securityOptionsFromEnv(env, db);
  const app = createApp({ precision: { router: runtime.router }, security: { ...security, limiter } });
  const port = Number(env.PORT ?? 18081);
  const server = app.listen(port, "127.0.0.1", () => jsonLogger("info", "qa precision server listening", { port }));
  server.requestTimeout = 60_000;

  // ---------------------------------------------------------------- control listener (loopback only)
  const controlServer = http.createServer((req, res) => {
    void (async () => {
      const given = String(req.headers["x-qa-key"] ?? "");
      const ok = given.length === controlKey.length && timingSafeEqual(Buffer.from(given), Buffer.from(controlKey));
      const send = (status: number, body: unknown): void => { res.writeHead(status, { "Content-Type": "application/json" }); res.end(JSON.stringify(body)); };
      if (!ok) return send(404, { error: "NOT_FOUND" });
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      let body: Record<string, unknown> = {};
      try { body = chunks.length ? (JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>) : {}; } catch { return send(400, { error: "bad json" }); }
      const url = new URL(req.url ?? "/", "http://x");
      const projectId = String(body.projectId ?? url.searchParams.get("projectId") ?? "");
      try {
        switch (`${req.method} ${url.pathname}`) {
          case "POST /seed": {
            const stage = (String(body.stage ?? "start") as DemoStage);
            const r = await seedDemoProject(db, { stage, reset: true, mintLink: true, bootstrapFaConfig: true, ...(body.linkTtlMs ? { linkTtlMs: Number(body.linkTtlMs) } : {}) });
            return send(200, { projectId: r.projectId, categories: r.categories, code: r.linkToken });
          }
          case "POST /link": {
            const { createLinkToken } = await import("../src/precision/domain/tokens");
            const t = await createLinkToken(db, projectId, body.ttlMs ? Number(body.ttlMs) : 600_000, new Date());
            return send(200, { code: t.token });
          }
          case "POST /revoke-sessions": {
            const { revokeProjectTokens } = await import("../src/precision/domain/tokens");
            return send(200, { revoked: await revokeProjectTokens(db, projectId) });
          }
          case "POST /short-session": {
            // A genuine session whose lifetime is short (tokens are immutable once stored, and a global clock shift would disturb parallel tests).
            const { createLinkToken, exchangeLinkToken } = await import("../src/precision/domain/tokens");
            const now = new Date();
            const link = await createLinkToken(db, projectId, 60_000, now);
            const issued = await exchangeLinkToken(db, link.token, now, Number(body.ttlMs ?? 3000));
            return send(200, { sessionToken: issued?.token ?? null, expiresAt: issued?.expiresAt.toISOString() ?? null });
          }
          case "POST /clock": { clockOffsetMs = Number(body.offsetMs ?? 0); return send(200, { ok: true }); }
          case "POST /entitlement": {
            const mode = String(body.mode ?? "FULL") as EntitlementState["accessMode"];
            fixtureEntitlement.set({ projectId, premiumActive: mode === "FULL", accessMode: mode, ...(body.readonlyUntil ? { readonlyUntil: String(body.readonlyUntil) } : {}) });
            return send(200, { ok: true });
          }
          case "POST /model": { const f = faultsOf(projectId); if (body.fail !== undefined) f.modelFail = Number(body.fail); if (body.slowMs !== undefined) f.modelSlowMs = Number(body.slowMs); return send(200, { ok: true }); }
          case "POST /fa": { const f = faultsOf(projectId); f.faFail = body.always ? "always" : Number(body.fail ?? 0); return send(200, { ok: true }); }
          case "POST /oh/fault": { const f = faultsOf(projectId); const n = Number(body.count ?? 1); for (let i = 0; i < n; i++) f.ohFaults.push(body.kind as ProjectFaults["ohFaults"][number]); return send(200, { ok: true }); }
          case "POST /oh/slow": { faultsOf(projectId).ohSlowMs = Number(body.ms ?? 0); return send(200, { ok: true }); }
          case "POST /oh/access": { faultsOf(projectId).ohAccess = String(body.mode) as SimulatorAccessMode; return send(200, { ok: true }); }
          case "POST /limits": { if (body.name) limiter.arm(String(body.name), Number(body.limit ?? 3)); else limiter.disarm(); return send(200, { ok: true }); }
          case "POST /clear": { faults.delete(projectId); return send(200, { ok: true }); }
          case "GET /stats": {
            const deliveries = await pool.query<{ state: string; n: string }>("SELECT status AS state, count(*)::text AS n FROM oh_delivery WHERE project_id = $1 GROUP BY status", [projectId]);
            const delivered = await pool.query<{ n: string }>("SELECT count(DISTINCT idempotency_key)::text AS n FROM oh_delivery WHERE project_id = $1 AND status = 'delivered'", [projectId]);
            const rows = await pool.query<{ n: string }>("SELECT count(*)::text AS n FROM oh_delivery WHERE project_id = $1", [projectId]);
            return send(200, {
              deliveryByState: Object.fromEntries(deliveries.rows.map((r) => [r.state, Number(r.n)])),
              deliveredKeys: Number(delivered.rows[0]?.n ?? 0),
              deliveryRows: Number(rows.rows[0]?.n ?? 0),
              publishCalls: hub.publishCalls.get(projectId) ?? 0,
              platformStored: hub.storedCount(),
              modelCalls: model.calls,
            });
          }
          case "GET /facts": {
            const r = await pool.query<{ field_key: string; value: unknown; answer_state: string }>("SELECT field_key, value, answer_state FROM fact WHERE project_id = $1 AND superseded_by IS NULL ORDER BY field_key", [projectId]);
            return send(200, { facts: r.rows });
          }
          case "GET /health": return send(200, { ok: true, id: randomUUID().slice(0, 4) });
          default: return send(404, { error: "NOT_FOUND" });
        }
      } catch (e) {
        return send(500, { error: String(e instanceof OhPortError ? e.message : e).slice(0, 300) });
      }
    })();
  });
  controlServer.listen(Number(env.CONTROL_PORT ?? 18082), "127.0.0.1");
}

void main().catch((e) => { jsonLogger("error", "qa server failed to start", { error: String(e).slice(0, 300) }); process.exit(1); });
