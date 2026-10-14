/** In-memory repository: reference implementation of the retrieval semantics (tests, local runs). The Postgres implementation mirrors it with FTS. */
import { fold } from "../understanding/text";
import type { KnowledgeDocument, KnowledgePassage, KnowledgeRepository, KnowledgeSource, RetrieveQuery } from "./types";

const STOP = new Set(["de", "la", "el", "los", "las", "en", "y", "o", "a", "un", "una", "que", "por", "para", "con", "del", "al", "se", "es", "the", "of", "and", "in", "to", "for", "a", "an", "is"]);
export const tokens = (s: string): string[] => fold(s).split(/[^a-z0-9]+/).filter((t) => t.length > 2 && !STOP.has(t)).map((t) => t.replace(/(es|s)$/, ""));

export class InMemoryKnowledgeRepository implements KnowledgeRepository {
  private sources = new Map<string, KnowledgeSource>();
  private docs = new Map<string, KnowledgeDocument>();
  private passages = new Map<string, KnowledgePassage[]>();

  async upsertSource(s: KnowledgeSource): Promise<void> { this.sources.set(s.id, { ...s }); }
  async getSource(id: string): Promise<KnowledgeSource | null> { return this.sources.get(id) ?? null; }
  async listSources(f?: { active?: boolean; jurisdiction?: string }): Promise<KnowledgeSource[]> {
    return [...this.sources.values()].filter((s) => (f?.active === undefined || s.active === f.active) && (!f?.jurisdiction || s.jurisdiction === f.jurisdiction));
  }
  async insertDocument(d: KnowledgeDocument, passages: KnowledgePassage[]): Promise<void> {
    if (this.docs.has(d.id)) throw new Error(`document ${d.id} exists: versions are immutable`);
    this.docs.set(d.id, { ...d }); this.passages.set(d.id, passages.map((p) => ({ ...p })));
  }
  async getDocument(id: string): Promise<KnowledgeDocument | null> { return this.docs.get(id) ?? null; }
  async listDocuments(f?: { sourceId?: string; status?: KnowledgeDocument["status"] }): Promise<KnowledgeDocument[]> {
    return [...this.docs.values()].filter((d) => (!f?.sourceId || d.sourceId === f.sourceId) && (!f?.status || d.status === f.status));
  }
  async markSuperseded(oldId: string, newId: string): Promise<void> {
    const o = this.docs.get(oldId); const n = this.docs.get(newId);
    if (!o || !n) throw new Error("unknown document");
    o.status = "superseded"; o.supersededById = newId; n.supersedesId = oldId;
  }

  async getPassage(id: string): Promise<{ passage: KnowledgePassage; doc: KnowledgeDocument } | null> {
    for (const [docId, ps] of this.passages) { const p = ps.find((x) => x.id === id); if (p) return { passage: p, doc: this.docs.get(docId)! }; }
    return null;
  }

  async search(q: RetrieveQuery): Promise<{ passage: KnowledgePassage; doc: KnowledgeDocument; score: number }[]> {
    const qt = tokens(q.text ?? "");
    const units = (q.units ?? []).map(fold);
    const out: { passage: KnowledgePassage; doc: KnowledgeDocument; score: number }[] = [];
    for (const [docId, ps] of this.passages) {
      const doc = this.docs.get(docId)!;
      if (doc.status === "withdrawn") continue;
      if (doc.status === "superseded" && !q.includeSuperseded) continue;
      const src = this.sources.get(doc.sourceId);
      if (!src || !src.active) continue;
      if (q.jurisdiction && doc.jurisdiction !== q.jurisdiction) continue;
      if (q.authorities && !q.authorities.includes(src.authority)) continue;
      for (const p of ps) {
        const pt = new Set(tokens(`${p.text} ${p.indicators.map((i) => i.name).join(" ")}`));
        let score = qt.reduce((a, t) => a + (pt.has(t) ? 1 : 0), 0) / Math.max(1, qt.length);
        if (q.topics?.length) { const ov = p.topics.filter((t) => q.topics!.includes(t)).length; if (ov === 0 && qt.length === 0) continue; score += ov * 0.5; }
        if (units.length) { const u = p.units.map(fold); const ov = units.filter((x) => u.includes(x)).length; if (ov === 0 && qt.length === 0 && !q.topics?.length) continue; score += ov * 0.6; }
        if (score <= 0) continue;
        out.push({ passage: p, doc, score });
      }
    }
    out.sort((a, b) => b.score - a.score || a.passage.ordinal - b.passage.ordinal);
    return out.slice(0, (q.limit ?? 8) * 3);
  }
}
