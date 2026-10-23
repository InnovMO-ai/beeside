/**
 * Source references for findings: from the knowledge actually available for a jurisdiction, the passages a consumer's finding topic can point to.
 * The consumer's finding vocabulary is mapped to knowledge topics here (references are passage ids; resolve them to full provenance with `resolveRef`).
 */
import { retrieve } from "./retrieve";
import type { KnowledgeRepository, Topic } from "./types";

/** Finding topic strings (understanding vocabulary) -> knowledge topics. */
const FINDING_TOPICS: Record<string, Topic[]> = {
  entity_forms: ["corporate_law"], intercompany_funding: ["taxes"], transfer_pricing: ["taxes"], workforce_models: ["labor_market", "social_security"],
  employment_benefits: ["social_security", "wages"], labor_market: ["labor_market", "wages"],
};

/**
 * Builds the synchronous `refsFor` the findings engine expects, from the knowledge actually available for the jurisdiction.
 * References are passage ids (resolve them to full provenance with `resolveRef`); official sources are listed first.
 */
export async function buildRefsFor(repo: KnowledgeRepository, jurisdiction: string): Promise<(topic: string) => string[]> {
  const cache = new Map<string, string[]>();
  for (const [ft, kts] of Object.entries(FINDING_TOPICS)) {
    const ids: string[] = [];
    for (const kt of kts) {
      const hits = await retrieve(repo, { topics: [kt], jurisdiction, limit: 3 });
      hits.sort((a, b) => Number(b.mayGroundObligation) - Number(a.mayGroundObligation) || b.score - a.score);
      for (const h of hits.slice(0, 2)) if (!ids.includes(h.passage.id)) ids.push(h.passage.id);
    }
    cache.set(ft, ids);
  }
  return (topic) => cache.get(topic) ?? [];
}

export async function resolveRef(repo: KnowledgeRepository, id: string) {
  const r = await repo.getPassage(id);
  if (!r) return null;
  const src = await repo.getSource(r.doc.sourceId);
  return src ? { passage: r.passage, document: r.doc, source: src } : null;
}

