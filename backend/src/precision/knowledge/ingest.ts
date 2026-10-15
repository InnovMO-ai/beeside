/**
 * Ingestion: registered source + document bytes -> versioned document + passages.
 * A new edition of the same publication creates a NEW version and supersedes the previous one; nothing is ever overwritten silently.
 */
import { createHash } from "node:crypto";
import { extractSections, detectFormat } from "./extract";
import { chunkSections } from "./chunk";
import { classifyTopics } from "./topics";
import { RegistryError, allowedHost } from "./registry";
import type { KnowledgeDocument, KnowledgeRepository, Topic } from "./types";

export interface IngestInput {
  sourceId: string;
  title: string;
  edition: string;
  /** URL or document destination. If it is a URL, its host must belong to the source's approved domains. */
  locator: string;
  filename: string;
  data: Buffer;
  now: string;
  publishedAt?: string;
  effectiveAt?: string;
  jurisdiction?: string;
  topics?: Topic[];
  language?: string;
  confidence?: KnowledgeDocument["confidence"];
}
export type IngestResult =
  | { status: "ingested"; document: KnowledgeDocument; passages: number; supersededId?: string; /** The edition was older than one already held: it is stored as historical, never active. */ historical?: boolean; supersededById?: string }
  | { status: "unchanged"; document: KnowledgeDocument };

export const sha = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex");

/**
 * Edition series. Annual / periodic publications keep ONE series title; the edition is its own field. A title that carries the year
 * ("ICE 2025 Boletas", "ICE-2026_Boletas") is reduced to the series title so a new edition lands in the same series and the older one
 * is superseded, never overwritten. Titles without a year are unchanged.
 */
export function seriesTitle(title: string): string {
  const stripped = title.replace(/_+/g, " ").replace(/\b(19|20)\d{2}(?:[-/ ]?(?:q[1-4]|s[12]|h[12]))?\b/gi, " ").replace(/\s*[-–]\s*(?=\s|$)/g, " ").replace(/\s+/g, " ").replace(/^[\s\-–]+|[\s\-–]+$/g, "");
  return stripped.length >= 3 ? stripped : title.trim();
}

/** Natural ordering of editions: "2025" < "2026" < "2026-Q2" < "2026-Q4" < "2027". Negative when a is older than b. */
export function compareEditions(a: string, b: string): number {
  const na = a.match(/\d+|[a-z]+/gi) ?? [];
  const nb = b.match(/\d+|[a-z]+/gi) ?? [];
  for (let i = 0; i < Math.max(na.length, nb.length); i++) {
    const x = na[i]; const y = nb[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const dx = /^\d+$/.test(x); const dy = /^\d+$/.test(y);
    const c = dx && dy ? Number(x) - Number(y) : x.toLowerCase().localeCompare(y.toLowerCase());
    if (c !== 0) return c < 0 ? -1 : 1;
  }
  return 0;
}

export async function ingestDocument(repo: KnowledgeRepository, input: IngestInput): Promise<IngestResult> {
  const src = await repo.getSource(input.sourceId);
  if (!src) throw new RegistryError(`Source ${input.sourceId} is not registered`);
  if (!src.active) throw new RegistryError(`Source ${input.sourceId} is inactive`);
  if (/^https?:\/\//i.test(input.locator) && !allowedHost(src, input.locator)) throw new RegistryError(`Host of ${input.locator} is not an approved domain of ${src.id}`);

  const series = seriesTitle(input.title);
  const hash = sha(input.data);
  const existing = (await repo.listDocuments({ sourceId: src.id })).filter((d) => seriesTitle(d.title) === series);
  // a series already stored under a title that carries its year (ingested before series existed) keeps that stored title: the database only
  // lets a document be superseded by one with the SAME title
  const title = [...existing].sort((a, b) => b.version - a.version)[0]?.title ?? series;
  const same = existing.find((d) => d.contentHash === hash && d.status === "active");
  if (same) return { status: "unchanged", document: same };
  // The same bytes already held as a historical edition are also "unchanged": re-ingesting never resurrects or duplicates history.
  const sameHistorical = existing.find((d) => d.contentHash === hash && d.edition === input.edition);
  if (sameHistorical) return { status: "unchanged", document: sameHistorical };

  // Editions: the newest edition in the series is the active one. Anything older than what we hold is stored as historical.
  const newerHeld = existing.filter((d) => compareEditions(d.edition, input.edition) > 0).sort((a, b) => compareEditions(a.edition, b.edition))[0];
  const prev = newerHeld ? undefined : existing.filter((d) => d.status === "active").sort((a, b) => b.version - a.version)[0];
  const version = (existing.reduce((m, d) => Math.max(m, d.version), 0)) + 1;
  const id = `${src.id}:${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}:v${version}`;

  const sections = extractSections(input.filename, input.data);
  const docTopics = input.topics ?? classifyTopics(sections.slice(0, 20).map((s) => s.text).join(" "), 6);
  const doc: KnowledgeDocument = {
    id, sourceId: src.id, title, edition: input.edition, version, retrievedAt: input.now,
    ...(input.publishedAt ? { publishedAt: input.publishedAt } : {}), ...(input.effectiveAt ? { effectiveAt: input.effectiveAt } : {}),
    jurisdiction: input.jurisdiction ?? src.jurisdiction, topics: docTopics, locator: input.locator, contentHash: hash,
    confidence: input.confidence ?? (src.authority === "official_primary" ? "high" : "medium"), status: "active", language: input.language ?? "es",
  };
  const passages = chunkSections(sections, { documentId: id, sourceId: src.id, defaultTopics: docTopics });
  await repo.insertDocument(doc, passages);
  if (prev) await repo.markSuperseded(prev.id, id);
  if (newerHeld) await repo.markSuperseded(id, newerHeld.id);
  void detectFormat;
  return { status: "ingested", document: newerHeld ? { ...doc, status: "superseded", supersededById: newerHeld.id } : doc, passages: passages.length, ...(prev ? { supersededId: prev.id } : {}), ...(newerHeld ? { historical: true, supersededById: newerHeld.id } : {}) };
}
