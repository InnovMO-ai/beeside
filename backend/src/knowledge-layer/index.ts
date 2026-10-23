/**
 * Knowledge Layer — public entry points.
 *
 *  - `contract.ts` is what every consumer (Precision, later others) imports: types + the `KnowledgeLayer` interface.
 *  - `createKnowledgeLayer` (service.ts) implements it over any repositories; `createPgKnowledgeLayer` is the production assembly.
 *  - Publishing content (ingestion, registry, editions, country guides, demand triage) is the layer's own admin surface
 *    (src/admin/knowledge-layer-admin.ts, src/scripts/*): consumers never publish and never read the store.
 */
import type { Db } from "../db/database";
import { createPgCountryResources, createPgDemandRepository, createPgKnowledgeRepository } from "./pg-repo";
import { knowledgeReadiness } from "./readiness";
import { seedInitialSources } from "./registry";
import { createKnowledgeLayer } from "./service";
import type { KnowledgeLayer } from "./contract";

export { createKnowledgeLayer } from "./service";
export type { KnowledgeLayerDeps } from "./service";
export type { KnowledgeLayer } from "./contract";

export interface PgKnowledgeLayerOptions {
  /** Publishes the initial registry (KSeed sources) on boot. Idempotent. */
  seedSources?: boolean;
  now?: () => Date;
  onError?: (err: unknown) => void;
}

export async function createPgKnowledgeLayer(db: Db, opts: PgKnowledgeLayerOptions = {}): Promise<KnowledgeLayer> {
  const knowledge = createPgKnowledgeRepository(db);
  if (opts.seedSources ?? true) await seedInitialSources(knowledge);
  return createKnowledgeLayer({
    knowledge, demand: createPgDemandRepository(db), resources: createPgCountryResources(db),
    ...(opts.now ? { now: opts.now } : {}), ...(opts.onError ? { onError: opts.onError } : {}),
  });
}

/**
 * Fail-closed start guard for a production connection: refuses to proceed while the layer holds no published knowledge for the required
 * jurisdictions (an empty layer is never the intended production state; the initial seed is loaded first, see scripts/kl-seed).
 */
export async function assertKnowledgeReady(db: Db, jurisdictions: string[]): Promise<void> {
  const r = await knowledgeReadiness(createPgKnowledgeRepository(db), jurisdictions);
  if (!r.ready) {
    const gaps = r.jurisdictions.filter((x) => !x.ready).map((x) => `${x.jurisdiction} (${x.activeDocuments} active documents)`).join(", ");
    throw new Error(`the Knowledge Layer has no published knowledge for ${gaps || jurisdictions.join(", ")}: load the initial seed before connecting Precision (scripts/kl-seed)`);
  }
}
export { knowledgeReadiness } from "./readiness";
export type { KnowledgeReadiness, JurisdictionReadiness } from "./readiness";
