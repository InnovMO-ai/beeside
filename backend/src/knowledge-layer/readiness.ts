/**
 * Is the Knowledge Layer READY to be connected? The first production connection is NOT an empty layer: the initial prepared knowledge
 * (the seed) must already be published. A registry of approved sources with no published document is not knowledge.
 *
 * Read-only; looks only at what the layer itself holds (active documents with passages, per jurisdiction).
 */
import type { KnowledgeRepository } from "./types";

export interface JurisdictionReadiness { jurisdiction: string; activeDocuments: number; passages: number; ready: boolean }
export interface KnowledgeReadiness { ready: boolean; jurisdictions: JurisdictionReadiness[] }

export async function knowledgeReadiness(repo: KnowledgeRepository, jurisdictions: string[]): Promise<KnowledgeReadiness> {
  const active = await repo.listDocuments({ status: "active" });
  const out: JurisdictionReadiness[] = [];
  for (const j of [...new Set(jurisdictions.map((x) => x.trim().toUpperCase()).filter(Boolean))]) {
    const docs = active.filter((d) => d.jurisdiction.toUpperCase() === j);
    let passages = 0;
    for (const d of docs) passages += (await repo.listPassages(d.id)).length;
    out.push({ jurisdiction: j, activeDocuments: docs.length, passages, ready: docs.length > 0 && passages > 0 });
  }
  return { ready: out.length > 0 && out.every((x) => x.ready), jurisdictions: out };
}
