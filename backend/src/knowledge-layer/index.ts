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
