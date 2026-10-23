/**
 * Knowledge Agent — independent of Precision. Scheduled research, monitoring, change detection, candidate updates, versioning and
 * risk-based human review. It can only act on sources approved in the Registry (active, allowed domain); there is no open-web ingestion.
 * The fetch itself is a port: this module decides WHAT may be fetched, WHEN, and WHAT HAPPENS with the result.
 */
import { allowedHost } from "./registry";
import { ingestDocument, seriesTitle, sha, type IngestInput } from "./ingest";
import { extractSections } from "./extract";
import { classifyTopics } from "./topics";
import type { KnowledgeRepository, KnowledgeSource, Topic, UpdateCadence } from "./types";

export interface FetchedDocument { url: string; title: string; edition: string; filename: string; data: Buffer; publishedAt?: string; effectiveAt?: string }
/** Port: returns the current publications of a source (the infrastructure implements polling/scraping; the agent never trusts it blindly). */
export interface SourceFetcher { fetch(source: KnowledgeSource): Promise<FetchedDocument[]> }

export type CandidateStatus = "pending_review" | "approved" | "rejected" | "auto_applied" | "unchanged";
export interface CandidateUpdate {
  id: string;
  sourceId: string;
  title: string;
  edition: string;
  url: string;
  contentHash: string;
  change: "new_document" | "new_version" | "unchanged";
  risk: KnowledgeSource["risk"];
  /** Rule that decided the review path, kept for audit. */
  reviewReason: string;
  /** Review depth that applied: strong (area specialist, obligations/regulatory), standard (one reviewer), light (auto-applied, audited, reversible). */
  tier?: ReviewTier;
  /** Topics detected in the content itself (not only declared by the source). */
  contentTopics?: Topic[];
  status: CandidateStatus;
  detectedAt: string;
  input?: Omit<IngestInput, "data" | "now"> & { dataBase64?: string };
}
export interface CandidateStore {
  save(c: CandidateUpdate, data?: Buffer): Promise<void>;
  get(id: string): Promise<{ candidate: CandidateUpdate; data?: Buffer } | null>;
  list(status?: CandidateStatus): Promise<CandidateUpdate[]>;
}

const DAYS: Record<UpdateCadence, number> = { continuous: 1, monthly: 30, quarterly: 91, annual: 365, biennial: 730, ad_hoc: Number.POSITIVE_INFINITY };
export const isDue = (s: KnowledgeSource, lastRun: string | null, now: string): boolean => s.active && (!lastRun || (Date.parse(now) - Date.parse(lastRun)) / 86_400_000 >= DAYS[s.cadence]);

export type ReviewTier = "strong" | "standard" | "light";

/** Topics whose content can state or imply an obligation, a deadline or a regulatory consequence: always reviewed by a person. */
export const HIGH_RISK_TOPICS: readonly Topic[] = ["taxes", "customs", "corporate_law", "immigration_mobility", "social_security", "regulatory_environment", "foreign_investment"];

/**
 * Risk-based review (not manual by default). The depth of review follows the risk of WHAT changed, not the mere fact that something changed:
 *  - strong:   high-risk source, a source that grounds obligations, or high-risk content (tax, customs, corporate, labor/social security,
 *              immigration, regulation) from an official source -> a specialist of the area decides before anything goes live.
 *  - standard: sources flagged for review, medium-risk non-primary sources, or high-risk topics coming from a non-primary source -> one reviewer.
 *  - light:    terminology, aliases, general definitions and non-regulatory context from low-risk sources -> applied under governance: audit record,
 *              provenance, new version (never an overwrite), reversible, and listed for sampling. No human gate, but never invisible.
 * Content that cannot be classified is never treated as light.
 */
export function reviewPath(s: KnowledgeSource, content?: { topics: Topic[] | null }): { review: boolean; reason: string; tier: ReviewTier } {
  const highContent = content?.topics?.some((t) => HIGH_RISK_TOPICS.includes(t)) ?? false;
  if (s.risk === "high") return { review: true, reason: "high_risk_source", tier: "strong" };
  if (s.roles.includes("obligation") && (highContent || content?.topics === null)) return { review: true, reason: "obligation_content", tier: "strong" };
  if (s.reviewRequired) return { review: true, reason: "source_requires_review", tier: "standard" };
  if (s.authority !== "official_primary" && s.risk === "medium") return { review: true, reason: "medium_risk_non_primary", tier: "standard" };
  if (highContent) return { review: true, reason: s.authority === "official_primary" ? "high_risk_content" : "high_risk_content_non_primary", tier: s.authority === "official_primary" ? "strong" : "standard" };
  if (content?.topics === null) return { review: true, reason: "unclassified_content", tier: "standard" };
  return { review: false, reason: "low_risk_auto", tier: "light" };
}

function contentTopicsOf(filename: string, data: Buffer): Topic[] | null {
  try {
    const sections = extractSections(filename, data);
    if (sections.length === 0) return null;
    return classifyTopics(sections.slice(0, 40).map((x) => x.text).join(" "), 8);
  } catch { return null; }
}

export interface CycleReport { checked: string[]; skipped: { sourceId: string; reason: string }[]; candidates: CandidateUpdate[] }

export async function runAgentCycle(repo: KnowledgeRepository, store: CandidateStore, fetcher: SourceFetcher, now: string, lastRun: Record<string, string> = {}): Promise<CycleReport> {
  const report: CycleReport = { checked: [], skipped: [], candidates: [] };
  for (const src of await repo.listSources({ active: true })) {
    if (!isDue(src, lastRun[src.id] ?? null, now)) { report.skipped.push({ sourceId: src.id, reason: "not_due" }); continue; }
    report.checked.push(src.id);
    const docs = await fetcher.fetch(src);
    for (const d of docs) {
      if (!allowedHost(src, d.url)) { report.skipped.push({ sourceId: src.id, reason: `host_not_approved:${d.url}` }); continue; }
      const hash = sha(d.data);
      const st = seriesTitle(d.title);
      const existing = (await repo.listDocuments({ sourceId: src.id })).filter((x) => seriesTitle(x.title) === st && x.status === "active");
      const unchanged = existing.some((x) => x.contentHash === hash);
      const ctopics = unchanged ? [] : contentTopicsOf(d.filename, d.data);
      const path = reviewPath(src, { topics: ctopics });
      const cand: CandidateUpdate = {
        id: `${src.id}:${hash.slice(0, 12)}`, sourceId: src.id, title: d.title, edition: d.edition, url: d.url, contentHash: hash,
        change: unchanged ? "unchanged" : existing.length ? "new_version" : "new_document", risk: src.risk, reviewReason: path.reason, tier: path.tier, ...(ctopics ? { contentTopics: ctopics } : {}),
        status: unchanged ? "unchanged" : path.review ? "pending_review" : "approved", detectedAt: now,
        input: { sourceId: src.id, title: d.title, edition: d.edition, locator: d.url, filename: d.filename, ...(d.publishedAt ? { publishedAt: d.publishedAt } : {}), ...(d.effectiveAt ? { effectiveAt: d.effectiveAt } : {}) },
      };
      await store.save(cand, d.data);
      report.candidates.push(cand);
      if (cand.status === "approved") { await applyCandidate(repo, store, cand.id, now); cand.status = "auto_applied"; }
    }
  }
  return report;
}

export async function decideCandidate(store: CandidateStore, id: string, decision: "approved" | "rejected"): Promise<void> {
  const r = await store.get(id);
  if (!r) throw new Error(`unknown candidate ${id}`);
  if (r.candidate.status !== "pending_review") throw new Error(`candidate ${id} is ${r.candidate.status}`);
  await store.save({ ...r.candidate, status: decision }, r.data);
}

/** Only an approved candidate is ever ingested; the document becomes a new version and supersedes the previous one. */
export async function applyCandidate(repo: KnowledgeRepository, store: CandidateStore, id: string, now: string) {
  const r = await store.get(id);
  if (!r || !r.data || !r.candidate.input) throw new Error(`candidate ${id} not applicable`);
  if (r.candidate.status !== "approved") throw new Error(`candidate ${id} is not approved`);
  const { dataBase64: _ignored, ...input } = r.candidate.input;
  void _ignored;
  const res = await ingestDocument(repo, { ...input, data: r.data, now });
  await store.save({ ...r.candidate, status: "auto_applied" }, r.data);
  return res;
}

export class InMemoryCandidateStore implements CandidateStore {
  private m = new Map<string, { candidate: CandidateUpdate; data?: Buffer }>();
  async save(c: CandidateUpdate, data?: Buffer): Promise<void> { const prev = this.m.get(c.id); const d = data ?? prev?.data; this.m.set(c.id, { candidate: { ...c }, ...(d ? { data: d } : {}) }); }
  async get(id: string) { return this.m.get(id) ?? null; }
  async list(status?: CandidateStatus): Promise<CandidateUpdate[]> { return [...this.m.values()].map((x) => x.candidate).filter((c) => !status || c.status === status); }
}
