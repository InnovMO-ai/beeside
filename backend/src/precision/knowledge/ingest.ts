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
  | { status: "ingested"; document: KnowledgeDocument; passages: number; supersededId?: string }
  | { status: "unchanged"; document: KnowledgeDocument };

export const sha = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex");

export async function ingestDocument(repo: KnowledgeRepository, input: IngestInput): Promise<IngestResult> {
  const src = await repo.getSource(input.sourceId);
  if (!src) throw new RegistryError(`Source ${input.sourceId} is not registered`);
  if (!src.active) throw new RegistryError(`Source ${input.sourceId} is inactive`);
  if (/^https?:\/\//i.test(input.locator) && !allowedHost(src, input.locator)) throw new RegistryError(`Host of ${input.locator} is not an approved domain of ${src.id}`);

  const hash = sha(input.data);
  const existing = (await repo.listDocuments({ sourceId: src.id })).filter((d) => d.title === input.title);
  const same = existing.find((d) => d.contentHash === hash && d.status === "active");
  if (same) return { status: "unchanged", document: same };

  const prev = existing.filter((d) => d.status === "active").sort((a, b) => b.version - a.version)[0];
  const version = (existing.reduce((m, d) => Math.max(m, d.version), 0)) + 1;
  const id = `${src.id}:${input.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}:v${version}`;

  const sections = extractSections(input.filename, input.data);
  const docTopics = input.topics ?? classifyTopics(sections.slice(0, 20).map((s) => s.text).join(" "), 6);
  const doc: KnowledgeDocument = {
    id, sourceId: src.id, title: input.title, edition: input.edition, version, retrievedAt: input.now,
    ...(input.publishedAt ? { publishedAt: input.publishedAt } : {}), ...(input.effectiveAt ? { effectiveAt: input.effectiveAt } : {}),
    jurisdiction: input.jurisdiction ?? src.jurisdiction, topics: docTopics, locator: input.locator, contentHash: hash,
    confidence: input.confidence ?? (src.authority === "official_primary" ? "high" : "medium"), status: "active", language: input.language ?? "es",
  };
  const passages = chunkSections(sections, { documentId: id, sourceId: src.id, defaultTopics: docTopics });
  await repo.insertDocument(doc, passages);
  if (prev) await repo.markSuperseded(prev.id, id);
  void detectFormat;
  return { status: "ingested", document: doc, passages: passages.length, ...(prev ? { supersededId: prev.id } : {}) };
}
