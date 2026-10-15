/**
 * Edition series and edition comparison.
 * A series is one publication across its editions (ICE 2025, ICE 2026...). The newest edition is active, older ones stay as historical
 * documents with full provenance. Comparison is a read-only report over the indicators of two editions; it never changes anything and is
 * the input a person uses to decide whether changes need review.
 */
import { compareEditions } from "./ingest";
import type { Indicator, KnowledgeDocument, KnowledgeRepository } from "./types";

export interface EditionRow { id: string; edition: string; version: number; status: KnowledgeDocument["status"]; retrievedAt: string; locator: string; contentHash: string; supersededById?: string }
export interface Series { sourceId: string; title: string; current: EditionRow | null; editions: EditionRow[] }

export async function listSeries(repo: KnowledgeRepository, sourceId?: string): Promise<Series[]> {
  const docs = await repo.listDocuments(sourceId ? { sourceId } : undefined);
  const by = new Map<string, KnowledgeDocument[]>();
  for (const d of docs) by.set(`${d.sourceId}\u0000${d.title}`, [...(by.get(`${d.sourceId}\u0000${d.title}`) ?? []), d]);
  return [...by.values()].map((ds) => {
    const editions = ds.sort((a, b) => compareEditions(a.edition, b.edition) || a.version - b.version).map((d): EditionRow => ({ id: d.id, edition: d.edition, version: d.version, status: d.status, retrievedAt: d.retrievedAt, locator: d.locator, contentHash: d.contentHash, ...(d.supersededById ? { supersededById: d.supersededById } : {}) }));
    return { sourceId: ds[0]!.sourceId, title: ds[0]!.title, current: [...editions].reverse().find((e) => e.status === "active") ?? null, editions };
  }).sort((a, b) => a.sourceId.localeCompare(b.sourceId) || a.title.localeCompare(b.title));
}

export interface IndicatorChange { name: string; unit: string; before?: Indicator; after?: Indicator; kind: "added" | "removed" | "value_changed" | "rank_changed" }
export interface EditionComparison {
  from: { id: string; edition: string }; to: { id: string; edition: string };
  added: number; removed: number; changed: number; unchanged: number;
  changes: IndicatorChange[];
  /** True when at least one existing value or rank moved: a person should look before relying on trend statements. */
  needsReview: boolean;
}

const key = (i: Indicator): string => `${i.name}\u0000${i.unit}`;

export async function compareDocuments(repo: KnowledgeRepository, fromId: string, toId: string): Promise<EditionComparison> {
  const a = await repo.getDocument(fromId);
  const b = await repo.getDocument(toId);
  if (!a || !b) throw new Error("unknown document");
  const pa = await repo.listPassages(fromId);
  const pb = await repo.listPassages(toId);
  const ia = new Map(pa.flatMap((p) => p.indicators).map((i) => [key(i), i]));
  const ib = new Map(pb.flatMap((p) => p.indicators).map((i) => [key(i), i]));
  const changes: IndicatorChange[] = [];
  let unchanged = 0;
  for (const [k, before] of ia) {
    const after = ib.get(k);
    if (!after) { changes.push({ name: before.name, unit: before.unit, before, kind: "removed" }); continue; }
    if (String(before.value) !== String(after.value)) changes.push({ name: before.name, unit: before.unit, before, after, kind: "value_changed" });
    else if (before.rank !== after.rank) changes.push({ name: before.name, unit: before.unit, before, after, kind: "rank_changed" });
    else unchanged++;
  }
  for (const [k, after] of ib) if (!ia.has(k)) changes.push({ name: after.name, unit: after.unit, after, kind: "added" });
  const n = (k: IndicatorChange["kind"][]): number => changes.filter((c) => k.includes(c.kind)).length;
  return {
    from: { id: a.id, edition: a.edition }, to: { id: b.id, edition: b.edition },
    added: n(["added"]), removed: n(["removed"]), changed: n(["value_changed", "rank_changed"]), unchanged, changes,
    needsReview: n(["value_changed", "rank_changed", "removed"]) > 0,
  };
}

/** Compares an edition with the one it supersedes (or, for the current edition, the one before it). */
export async function compareWithPrevious(repo: KnowledgeRepository, documentId: string): Promise<EditionComparison | null> {
  const d = await repo.getDocument(documentId);
  if (!d) return null;
  const prevId = d.supersedesId;
  return prevId ? compareDocuments(repo, prevId, documentId) : null;
}
