/** Retrieval with provenance. Authority comes from the source: only official primary sources may ground a statement about obligations. */
import type { Hit, KnowledgeRepository, Provenance, RetrieveQuery } from "./types";

export async function retrieve(repo: KnowledgeRepository, q: RetrieveQuery): Promise<Hit[]> {
  const rows = await repo.search(q);
  const hits: Hit[] = [];
  for (const r of rows) {
    const src = await repo.getSource(r.doc.sourceId);
    if (!src) continue;
    const provenance: Provenance = {
      sourceId: src.id, documentId: r.doc.id, institution: src.institution, documentTitle: r.doc.title, edition: r.doc.edition, version: r.doc.version,
      ...(r.doc.publishedAt ? { publishedAt: r.doc.publishedAt } : {}), ...(r.doc.effectiveAt ? { effectiveAt: r.doc.effectiveAt } : {}), retrievedAt: r.doc.retrievedAt, jurisdiction: r.doc.jurisdiction,
      locator: r.doc.locator, location: r.passage.location, authority: src.authority, sourceRoles: src.roles, risk: src.risk, confidence: r.doc.confidence, documentStatus: r.doc.status,
    };
    hits.push({ passage: r.passage, score: r.score, provenance, mayGroundObligation: src.authority === "official_primary" && src.roles.includes("obligation") && r.doc.status === "active" });
  }
  return hits.slice(0, q.limit ?? 8);
}

/** "IMCO, Índice de Competitividad Estatal 2025 (ed. 2025, v1), p. 14" — a citation a person can check. */
export function citation(p: Provenance): string {
  return `${p.institution}, ${p.documentTitle} (${p.edition}${p.version > 1 ? `, v${p.version}` : ""}), ${p.location}`;
}

/**
 * Statement guard: a hit may be presented as a requirement ONLY if it can ground obligations. Everything else is context/analysis
 * and must be worded as such. Returns the wording class the composer must use.
 */
export function wordingClass(h: Hit): "obligation" | "context" {
  return h.mayGroundObligation ? "obligation" : "context";
}
