/**
 * Test harness for the CRP surface: a scratch PostgreSQL database with COMMITTED rows (needed to test real concurrency),
 * the real manifests, the simulated Operation Hub, a test-only fake of the authentication middleware and the CRP router.
 */
import express from "express";
import { Pool } from "pg";
import { createPoolDb, type Db } from "../../../../db/database";
import { SimulatedOperationHub, type SimulatorOptions } from "../../../adapters/simulator-operation-hub";
import { OhDeliveryService } from "../../../delivery/oh-delivery-service";
import { createManifestRegistry } from "../../../manifest";
import type { OhAcceptance, OhHandoffPayload, OperationHubPort } from "../../../ports/operation-hub";
import type { PrecisionDomainDeps } from "../../deps";
import { fillCategory, seedDemoProject, DEMO_LOGISTICS_FACTS, DEMO_STRATEGIC_FACTS, type DemoSeedResult } from "../../seed";
import { createCrpRouter } from "../router";

export const databaseUrl = process.env.TEST_DATABASE_URL;
export const describeWithDb = databaseUrl ? describe : describe.skip;

/** Counts what actually reaches the platform. */
export class SpyPort implements OperationHubPort {
  publishCalls = 0;
  payloads: OhHandoffPayload[] = [];
  constructor(readonly inner: SimulatedOperationHub) {}
  describe() { return this.inner.describe(); }
  async publish(p: OhHandoffPayload): Promise<OhAcceptance> { this.publishCalls += 1; this.payloads.push(p); return this.inner.publish(p); }
  verify(k: string) { return this.inner.verify(k); }
  accessState(projectId: string) { return this.inner.accessState(projectId); }
}

export interface Harness {
  pool: Pool;
  db: Db;
  sim: SimulatedOperationHub;
  spy: SpyPort;
  deps: PrecisionDomainDeps;
  app: express.Express;
  logs: string[];
  close(): Promise<void>;
  /** A fresh Northwind project at the "logistics ready" checkpoint, plus a ready Strategic Advisory category. */
  newProject(opts?: { strategicReady?: boolean }): Promise<DemoSeedResult & { id: (key: string) => string }>;
}

export async function createHarness(sim: SimulatorOptions = {}): Promise<Harness> {
  const pool = new Pool({ connectionString: databaseUrl, max: 10 });
  const db = createPoolDb(pool);
  const simulator = new SimulatedOperationHub(sim);
  const spy = new SpyPort(simulator);
  const logs: string[] = [];
  const delivery = new OhDeliveryService({ db, port: spy, retry: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 2 }, sleep: async () => undefined, random: () => 0.5 });
  const registry = createManifestRegistry(db, { currentTtlMs: 0 });
  const deps: PrecisionDomainDeps = {
    db,
    integrations: {} as never,
    delivery,
    registry,
    conversation: {} as never,
    now: () => new Date(),
    log: (level, message, fields) => { logs.push(`${level} ${message} ${JSON.stringify(fields ?? {})}`); },
  };

  const app = express();
  app.use(express.json());
  // TEST-ONLY fake of the authentication middleware: the real one is DOMAIN-A's.
  app.use((req, res, next) => {
    const project = req.header("x-test-project");
    if (!project) { res.status(401).json({ error: "UNAUTHENTICATED", message: "x", retryable: false }); return; }
    const mode = (req.header("x-test-access") ?? "FULL") as "FULL" | "READ_ONLY" | "REVOKED";
    req.precision = { projectId: project, locale: req.header("x-precision-locale") === "es" ? "es" : "en", entitlement: { projectId: project, premiumActive: mode === "FULL", accessMode: mode } };
    next();
  });
  app.use(createCrpRouter(deps));

  return {
    pool, db, sim: simulator, spy, deps, app, logs,
    close: () => pool.end(),
    async newProject(opts = {}) {
      const seeded = await seedDemoProject(db, { reset: true, stage: "logistics_ready", mintLink: false, bootstrapFaConfig: true });
      const id = (key: string): string => seeded.categories.find((c) => c.categoryKey === key)!.categoryId;
      if (opts.strategicReady) await fillCategory(db, seeded.projectId, id("strategic_advisory"), DEMO_STRATEGIC_FACTS);
      return Object.assign(seeded, { id });
    },
  };
}

export { DEMO_LOGISTICS_FACTS };
