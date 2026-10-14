/**
 * Composition root of Precision: environment -> integrations -> manifest registry -> conversation engine -> router.
 *
 * Switches (all default to the isolated, non-external implementation, so a missing variable can never reach a real system):
 *   PRECISION_API_ENABLED=true            mount /api/precision in the server (off by default)
 *   PRECISION_MODEL_PROVIDER              scripted (default) | gateway
 *   PRECISION_OH_PROVIDER                 simulator (default) | clickup
 *   PRECISION_ENTITLEMENT_PROVIDER        fixture (default) | core
 *   PRECISION_FA_CONTEXT_PROVIDER         fixture (default) | reader (no adapter yet: refuses to start)
 *   PRECISION_INTERNAL_KEY                enables GET /api/precision/internal/status (absent -> 404)
 *   PRECISION_UNDERSTANDING_ENGINE        core (default) | legacy — the Understanding surface runs on the Understanding Core, or on the generic manifest-driven engine (rollback lever)
 *   PRECISION_UNDERSTANDING_INTERPRETER   rules (default) | model — the model reads the client's words (governed, with the rule baseline as fallback); stays off until the real-model privacy approval (zero data retention) is in place
 *   PRECISION_KNOWLEDGE_SEED_ON_BOOT      true|false (default true) -> idempotent registration of the initial Knowledge Source Registry entries
 *   PRECISION_PUBLISH_MANIFESTS_ON_BOOT   true|false (default: true outside production) -> idempotent publish of the bundled manifests
 *   PRECISION_FIXTURE_PROJECT=true        register the synthetic seeded project with the fixture providers (no effect with real providers)
 */
import type { Router } from "express";
import type { Pool } from "pg";
import { createPoolDb, type Db } from "../../db/database";
import { premiumPolicyFromEnv } from "../../premium/premium-policy";
import type { RateLimiter } from "../../security/rate-limit";
import { jsonLogger, type Logger } from "../../security/redact";
import { ClickUpOperationHub, clickUpConfigFromEnv } from "../adapters/clickup-operation-hub";
import { CoreEntitlementProvider } from "../adapters/core-entitlement";
import { FixtureEntitlementProvider } from "../adapters/fixture-entitlement";
import { FixtureFaContextReader } from "../adapters/fixture-fa-context";
import { SimulatedOperationHub } from "../adapters/simulator-operation-hub";
import {
  DrizzleConversationStore, createConversationEngine, selectModelProvider, systemClock,
  type ModelProvider,
} from "../conversation";
import { engineValueRenderer } from "../conversation/adapters/engine-bindings";
import { OhDeliveryService } from "../delivery/oh-delivery-service";
import { createManifestRegistry, evaluateCategory, publishBundledManifests } from "../manifest";
import type { PrecisionIntegrations } from "../ports/registry";
import { selectionFromEnv } from "../ports/registry";
import { createContextReader } from "../domain/context-reader";
import { createFactHooks } from "../domain/conversations";
import type { PrecisionDomainDeps } from "../domain/deps";
import { DbFactWriter } from "../domain/facts";
import { createFaContextService } from "../domain/fa-context";
import { createPrecisionDomain, type PrecisionDomain } from "../domain";
import { createPrecisionRouter } from "./router";
import { createUnderstandingEngine } from "../understanding/engine";
import { createModelInterpreter } from "../understanding/model-interpreter";
import { createPgFrameStore } from "../understanding/pg-store";
import { seedFromFaContext } from "../understanding/seed-source";
import { createPgCountryResources, createPgKnowledgeRepository } from "../knowledge/pg-repo";
import { createResourcesPort } from "../knowledge/resources-port";
import { createOrientationPort } from "../knowledge/orientation-port";
import { seedInitialSources } from "../knowledge/registry";

export interface PrecisionRuntimeOptions {
  env?: NodeJS.ProcessEnv;
  pool: Pool;
  /** Defaults to a Db over `pool`. */
  db?: Db;
  log?: Logger;
  now?: () => Date;
  limiter?: RateLimiter;
  /** Overrides (tests and local rehearsal). */
  integrations?: PrecisionIntegrations;
  provider?: ModelProvider;
  /** Publish the bundled manifests before serving. Default: env PRECISION_PUBLISH_MANIFESTS_ON_BOOT. */
  publishManifests?: boolean;
}

export interface PrecisionRuntime {
  deps: PrecisionDomainDeps;
  domain: PrecisionDomain;
  router: Router;
  provider: ModelProvider;
}

export function integrationsFromEnv(env: NodeJS.ProcessEnv, db: Db): PrecisionIntegrations {
  const sel = selectionFromEnv(env);
  if (sel.faContext === "reader") throw new Error("PRECISION_FA_CONTEXT_PROVIDER=reader: the First Assessment reader adapter is not available yet (use fixture)");
  return {
    operationHub: sel.operationHub === "clickup" ? new ClickUpOperationHub(clickUpConfigFromEnv(env)) : new SimulatedOperationHub(),
    entitlement: sel.entitlement === "core" ? new CoreEntitlementProvider(db, { policy: premiumPolicyFromEnv(env) }) : new FixtureEntitlementProvider(),
    faContext: new FixtureFaContextReader(),
  };
}

export async function createPrecisionRuntime(options: PrecisionRuntimeOptions): Promise<PrecisionRuntime> {
  const env = options.env ?? process.env;
  const log = options.log ?? jsonLogger;
  const now = options.now ?? ((): Date => new Date());
  const db = options.db ?? createPoolDb(options.pool);
  const integrations = options.integrations ?? integrationsFromEnv(env, db);
  const fixtureProject = env.PRECISION_FIXTURE_PROJECT === "true";
  const provider = options.provider ?? selectModelProvider({ env });
  const registry = createManifestRegistry(db);
  const delivery = new OhDeliveryService({ db, port: integrations.operationHub });

  const publish = options.publishManifests ?? (env.PRECISION_PUBLISH_MANIFESTS_ON_BOOT ? env.PRECISION_PUBLISH_MANIFESTS_ON_BOOT === "true" : env.NODE_ENV !== "production");
  if (publish) await publishBundledManifests(db, { onPublished: () => registry.invalidate() });

  const fa = createFaContextService(integrations.faContext, log);
  const store = new DrizzleConversationStore(options.pool);
  const core = { db, integrations, delivery, registry, now, log, ...(env.PRECISION_INTERNAL_KEY ? { internalKey: env.PRECISION_INTERNAL_KEY } : {}) };
  const context = createContextReader(core, fa);
  const facts = new DbFactWriter(db, createFactHooks(core, fa));
  const genericEngine = createConversationEngine({ store, context, facts, evaluate: evaluateCategory, provider, renderer: engineValueRenderer, clock: systemClock });
  const knowledgeRepo = createPgKnowledgeRepository(db);
  if ((env.PRECISION_KNOWLEDGE_SEED_ON_BOOT ?? "true") === "true") await seedInitialSources(knowledgeRepo);
  const conversation = (env.PRECISION_UNDERSTANDING_ENGINE ?? "core") === "legacy"
    ? genericEngine
    : createUnderstandingEngine({ base: genericEngine, store, frames: createPgFrameStore(db), context, seed: seedFromFaContext(db, fa), facts, ...((env.PRECISION_UNDERSTANDING_INTERPRETER ?? "rules") === "model" ? { interpreter: createModelInterpreter({ provider, onFallback: (reason) => log("warn", "understanding interpreter fell back to rules", { reason }) }) } : {}), orientation: createOrientationPort(knowledgeRepo), resources: createResourcesPort(createPgCountryResources(db)), clock: systemClock, now });
  const deps: PrecisionDomainDeps = { ...core, conversation };
  const domain = createPrecisionDomain(deps, { fa, store });

  if (fixtureProject) {
    const { loadFixtureProject } = await import("../domain/seed");
    await loadFixtureProject(db, { faContext: integrations.faContext as never, entitlement: integrations.entitlement as never });
  }
  const router = createPrecisionRouter(deps, domain, { ...(options.limiter ? { limiter: options.limiter } : {}), modelProvider: provider, env });
  return { deps, domain, router, provider };
}
