/**
 * Test harness for the Precision API on a real PostgreSQL database (TEST_DATABASE_URL): COMMITTED rows through a pool,
 * because the conversation store takes a session-level lock on its own connection. Every project is fresh (random ids), so
 * suites can share one scratch database. Providers are the isolated ones: scripted model, simulated Operation Hub,
 * fixture entitlement and First Assessment context.
 */
import { randomUUID } from "node:crypto";
import express from "express";
import { Pool } from "pg";
import request from "supertest";
import { createPoolDb, type Db } from "../../../db/database";
import { syncFieldRegistry } from "../../../fa/admin/field-registry";
import { ensureDevBootstrapAdmin, publishDevConfiguration } from "../../../fa/admin/publish-config";
import { SimulatedOperationHub } from "../../adapters/simulator-operation-hub";
import { FixtureEntitlementProvider } from "../../adapters/fixture-entitlement";
import { CoreEntitlementProvider } from "../../adapters/core-entitlement";
import { premiumPolicyFromEnv } from "../../../premium/premium-policy";
import { FixtureFaContextReader } from "../../adapters/fixture-fa-context";
import { ScriptedModelProvider, type ScriptedFixture } from "../../conversation";
import type { RateLimiter } from "../../../security/rate-limit";
import { createLinkToken } from "../../domain/tokens";
import type { FaClientSafeContext, FaContextReader } from "../../ports/fa-context";
import type { EntitlementState } from "../../ports/entitlement";
import { createPrecisionRuntime, type PrecisionRuntime } from "../wiring";
import type { KnowledgeLayer } from "../../../knowledge-layer/contract";

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

export const FA_CONTEXT: FaClientSafeContext = {
  project: { destinationCountry: "Mexico", sector: "Food manufacturing", expansionObjective: "Open a distribution hub for our packaged foods", timeframe: "2027-04" },
  company: { displayName: "Harness Foods", operatingCountries: ["ES"] },
  needs: [
    { capabilityId: "CAP_HIVE_IL_3PL", label: "Third-party logistics", priority: "high" },
    { capabilityId: "CAP_HIVE_OL_FREIGHT", label: "Freight transportation", priority: "medium" },
    { capabilityId: "CAP_HIVE_FI_TAX", label: "Tax and accounting advice", priority: "medium" },
  ],
  literals: {},
  locale: "en",
};

export interface Seen { method: string; path: string; status: number; body: unknown }

export interface Harness {
  /** Every customer-facing JSON answer produced through `app` (internal status excluded). */
  seen: Seen[];
  /** Log lines produced by the runtime (level + message + fields, JSON). */
  logs: string[];
  pool: Pool;
  db: Db;
  runtime: PrecisionRuntime;
  app: express.Express;
  provider: ScriptedModelProvider;
  entitlement: FixtureEntitlementProvider;
  fa: FixtureFaContextReader;
  newProject(opts?: { context?: FaClientSafeContext | null; mode?: EntitlementState["accessMode"]; premium?: boolean; projectId?: string }): Promise<{ projectId: string; companyId: string }>;
  /** A one-time link token for the project (what the invitation e-mail carries). */
  link(projectId: string, ttlMs?: number): Promise<string>;
  /** Exchanges a fresh link for a session token. */
  session(projectId: string): Promise<string>;
  api(token: string, locale?: "en" | "es"): ApiClient;
  close(): Promise<void>;
}

export interface ApiClient {
  get(path: string): request.Test;
  post(path: string, body?: unknown): request.Test;
}

async function ensureFaConfiguration(db: Db): Promise<void> {
  const cur = async (t: string): Promise<boolean> => (await db.query(`SELECT 1 FROM ${t} WHERE is_current`)).rows.length > 0;
  if ((await cur("question_bank_version")) && (await cur("rules_engine_version")) && (await cur("snapshot_template_version"))) return;
  await db.transaction(async (tx) => {
    await syncFieldRegistry(tx);
    const admin = await ensureDevBootstrapAdmin(tx);
    await publishDevConfiguration(tx, admin);
  });
}

export async function setupHarness(options: { fixture?: ScriptedFixture; limiter?: RateLimiter; internalKey?: string; engine?: "core" | "legacy"; knowledge?: (db: Db) => Promise<KnowledgeLayer> | KnowledgeLayer; faReader?: (db: Db) => FaContextReader; /** Extra environment for the runtime (e.g. PRECISION_UNDERSTANDING_INTERPRETER). */ env?: Record<string, string>; /** true: the model provider is selected from the environment (PRECISION_MODEL_PROVIDER=gateway) instead of the scripted one. */ modelFromEnv?: boolean; /** Precision is gated by the REAL Core entitlement (the permanent provider) instead of the fixture; `now` lets a test move the clock. */ coreEntitlement?: { now?: () => Date } } = {}): Promise<Harness> {
  if (!TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is required");
  const pool = new Pool({ connectionString: TEST_DATABASE_URL, max: 10 });
  const db = createPoolDb(pool);
  await ensureFaConfiguration(db);
  const logs: string[] = [];
  const provider = new ScriptedModelProvider(options.fixture ? { fixture: options.fixture } : {});
  const entitlement = new FixtureEntitlementProvider();
  const fa = new FixtureFaContextReader();
  const runtime = await createPrecisionRuntime({
    env: { PRECISION_UNDERSTANDING_ENGINE: options.engine ?? "legacy", ...(options.env ?? {}), ...(options.internalKey ? { PRECISION_INTERNAL_KEY: options.internalKey } : {}) } as NodeJS.ProcessEnv,
    pool,
    db,
    log: (level, message, fields) => void logs.push(JSON.stringify({ level, message, ...(fields ?? {}) })),
    integrations: { operationHub: new SimulatedOperationHub(), entitlement: options.coreEntitlement ? new CoreEntitlementProvider(db, { policy: premiumPolicyFromEnv(), ...(options.coreEntitlement.now ? { now: options.coreEntitlement.now } : {}) }) : entitlement, faContext: options.faReader ? options.faReader(db) : fa },
    ...(options.modelFromEnv ? {} : { provider }),
    publishManifests: true,
    ...(options.knowledge ? { knowledge: await options.knowledge(db) } : {}),
    ...(options.limiter ? { limiter: options.limiter } : {}),
  });
  const seen: Seen[] = [];
  const app = express();
  app.use((req, res, next) => {
    if (!req.path.includes("/internal/")) {
      const original = res.json.bind(res);
      res.json = (body?: unknown) => {
        seen.push({ method: req.method, path: req.path, status: res.statusCode, body });
        return original(body);
      };
    }
    next();
  });
  app.use(runtime.router);

  const client = (token: string, locale: "en" | "es" = "en"): ApiClient => ({
    get: (path) => request(app).get(`/api/precision${path}`).set("Authorization", `Bearer ${token}`).set("X-Precision-Locale", locale),
    post: (path, body) => request(app).post(`/api/precision${path}`).set("Authorization", `Bearer ${token}`).set("X-Precision-Locale", locale).send((body ?? {}) as object),
  });

  const h: Harness = {
    seen, logs, pool, db, runtime, app, provider, entitlement, fa,
    async newProject(opts = {}) {
      const tag = randomUUID().slice(0, 8);
      const company = (await db.query<{ id: string }>("INSERT INTO company (name) VALUES ($1) RETURNING company_id AS id", [`Harness ${tag} Co`])).rows[0]!.id;
      const person = (await db.query<{ id: string }>(
        `INSERT INTO person (first_name, last_name, primary_email, interface_language, preferred_interaction_language, preferred_deliverable_language)
         VALUES ('Test', 'Person', $1, 'en', 'en', 'en') RETURNING person_id AS id`,
        [`${randomUUID()}@beeside-test.invalid`],
      )).rows[0]!.id;
      const project = (await db.query<{ id: string }>(
        `INSERT INTO project (project_id, company_id, created_by_person_id, responsible_person_id, question_bank_version, rules_engine_version, snapshot_template_version)
         VALUES (COALESCE($3::uuid, gen_random_uuid()), $1, $2, $2, (SELECT version FROM question_bank_version WHERE is_current), (SELECT version FROM rules_engine_version WHERE is_current), (SELECT version FROM snapshot_template_version WHERE is_current))
         RETURNING project_id AS id`,
        [company, person, opts.projectId ?? null],
      )).rows[0]!.id;
      if (opts.premium !== false) await db.query("UPDATE project SET premium_ever_activated = true, premium_first_activated_at = now() WHERE project_id = $1", [project]);
      entitlement.set({ projectId: project, premiumActive: (opts.mode ?? "FULL") === "FULL", accessMode: opts.mode ?? "FULL" });
      if (opts.context !== null) fa.add({ projectId: project, resultId: randomUUID(), context: opts.context ?? FA_CONTEXT });
      return { projectId: project, companyId: company };
    },
    async link(projectId, ttlMs) {
      return (await createLinkToken(db, projectId, ttlMs, new Date())).token;
    },
    async session(projectId) {
      const res = await request(app).post("/api/precision/session/exchange").send({ code: await h.link(projectId) });
      if (res.status !== 200) throw new Error(`exchange failed: ${res.status}`);
      return (res.body as { sessionToken: string }).sessionToken;
    },
    api: client,
    async close() {
      await pool.end();
    },
  };
  return h;
}
