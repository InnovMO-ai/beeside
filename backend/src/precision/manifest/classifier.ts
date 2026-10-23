/**
 * Deterministic classification for "Add a Service" and category proposal from the First Assessment needs.
 * No model: the AI may SUGGEST signals (text, capability ids, a service key), this module DECIDES, in the frozen order
 *   out_of_scope -> strategic_advisory -> ecosystem_development -> known_service -> unmapped_known_category -> discovery
 * (plus `ambiguous`, which is returned to the client as one question, and `known_category_exists`, which never creates
 * a `new:<slug>` for a category that exists).
 *
 * Keyword matching is accent- and case-insensitive and respects word boundaries (so "revisable" never matches "visa");
 * a plural "s"/"es" suffix is accepted.
 */
import { bundledCatalog, bundledProjectManifest, type CandidateCategory, type ProjectManifestDoc } from "./bundled";
import type { EngineClassification } from "./types";

export type ClassificationScenario = EngineClassification["scenario"];

export interface ClassificationSignals {
  /** The client's words (untrusted text). */
  text?: string;
  /** Capability ids the First Assessment / the model associated with the need. */
  capability_ids?: string[];
  /** A catalog service key the client already confirmed, if any. */
  service_key?: string;
  /** A catalog category the need was already attached to (unmapped need inside a known category). */
  category_key?: string;
  /** Slug proposed for a possible new service (normalised before use). */
  proposed_slug?: string;
  /** Instance keys the project already has (decides create_instance vs append). */
  existing_instance_keys?: string[];
}

/** category_key -> service keys (services projection). */
export type ServiceCatalog = Record<string, string[]>;

const strip = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Does `text` contain `term` as a whole word / phrase (optional plural suffix), ignoring case and accents? */
export function containsTerm(text: string, term: string): boolean {
  const t = strip(term).trim();
  if (!t) return false;
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(t).replace(/\s+/g, "\\s+")}(?:s|es)?(?![\\p{L}\\p{N}])`, "u");
  return re.test(strip(text));
}
const hasAny = (text: string, terms: readonly string[] | undefined): boolean => (terms ?? []).some((t) => containsTerm(text, t));

export function normalizeSlug(text: string): string {
  return String(text)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60)
    .replace(/^([^a-z])/, "n$1");
}

export function classifyNeed(signals: ClassificationSignals, pm: ProjectManifestDoc = bundledProjectManifest(), catalog: ServiceCatalog = bundledCatalog()): EngineClassification {
  const text = String(signals.text ?? "");
  const caps = new Set(signals.capability_ids ?? []);
  const existing = new Set(signals.existing_instance_keys ?? []);
  const cat = (k: string): CandidateCategory | undefined => pm.candidate_categories.find((c) => c.category_key === k);

  const oos = pm.out_of_scope_topics.find((t) => t.sources.capability_ids.some((c) => caps.has(c)) || hasAny(text, t.sources.lexicon_en) || hasAny(text, t.sources.lexicon_es));
  if (oos) return { scenario: "out_of_scope", topic_key: oos.topic_key, creates_workstream: false, creates_psm_version: false, notice_key: oos.notice_key };

  const svc = signals.service_key ? Object.entries(catalog).find(([, keys]) => keys.includes(signals.service_key as string)) : undefined;
  const hit = (c: CandidateCategory | undefined): boolean =>
    !!c && ((c.capability_signals ?? []).some((x) => caps.has(x)) || hasAny(text, c.detection_signals_positive.en) || hasAny(text, c.detection_signals_positive.es));
  const saHit = hit(cat("strategic_advisory"));
  const edHit = hit(cat("ecosystem_development"));

  // genuine ambiguity: study wording together with a catalog service the client already confirmed -> ask, never choose
  if (saHit && svc && caps.size === 0) return { scenario: "ambiguous", options: ["strategic_advisory", svc[0]], resolution: "ask_client_one_question" };
  if (saHit) return { scenario: "strategic_advisory", instance_key: "strategic_advisory", action: existing.has("strategic_advisory") ? "append_item" : "create_instance", item_array: "sa_studies" };
  if (edHit) return { scenario: "ecosystem_development", instance_key: "ecosystem_development", action: existing.has("ecosystem_development") ? "append_item" : "create_instance", item_array: "ed_engagements" };
  if (svc) return { scenario: "known_service", category_key: svc[0], service_key: signals.service_key, action: existing.has(svc[0]) ? "append_service" : "create_instance" };
  const known = signals.category_key ? cat(signals.category_key) : undefined;
  if (signals.category_key && known && known.kind === "catalog") {
    return { scenario: "unmapped_known_category", category_key: signals.category_key, block: "generic_unmapped_needs", internal_tag: "unmapped_known_category", action: existing.has(signals.category_key) ? "append_item" : "create_instance" };
  }
  const candidate = pm.new_category_policy.known_candidates.find((k) => hasAny(text, [k.slug.replace(/_/g, " "), k.slug]) || caps.has(k.capability ?? ""));
  const slug = normalizeSlug(candidate ? candidate.slug : signals.proposed_slug || text);
  if (Object.keys(catalog).includes(slug)) return { scenario: "known_category_exists", category_key: slug, note: "never create new:<slug> if the category exists" };
  const key = `new:${slug}`;
  return { scenario: "discovery", instance_key: key, manifest_category_key: "_generic", action: existing.has(key) ? "append_item" : "create_instance", crp_kind: "new_category_discovery", internal_label_visible_to_client: false };
}

/** Add a Service is available only after the Service Map is confirmed (>= 1 snapshot) in an active project. */
export function addServiceAvailability(s: { paStatus: string; snapshotCount: number; projectActive: boolean }): boolean {
  return s.paStatus === "confirmed" && s.snapshotCount >= 1 && s.projectActive === true;
}

// ------------------------------------------------------------------ category proposal from the FA needs
export interface FaNeedInput { capabilityId: string; label?: string; priority?: "high" | "medium" | "low" | string }
export interface ProposedCategory {
  categoryKey: string;
  kind: CandidateCategory["kind"];
  /** Has an authored category manifest (otherwise the generic manifest backs it). */
  authored: boolean;
  capabilityIds: string[];
  /** Highest client priority among the needs that led here. */
  priority: "high" | "medium" | "low" | null;
}
export interface CategoryProposal {
  categories: ProposedCategory[];
  /** Capability ids that belong to an out-of-scope topic (nothing is created for them). */
  outOfScope: Array<{ capabilityId: string; topicKey: string }>;
  /** Capability ids with no mapping: classification scenario, never an error. */
  unmapped: string[];
}

const RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };
const norm = (p: unknown): "high" | "medium" | "low" | null => (p === "high" || p === "medium" || p === "low" ? p : null);

/**
 * Initial category proposal: First Assessment needs[].capabilityId mapped through `capability_signals` of the project
 * manifest (Strategic Advisory / Ecosystem Development are reserved platform categories). Unknown capability ids are
 * collected in `unmapped`, never thrown. Order: highest client priority first, then the manifest's catalog order.
 */
export function proposeCategories(needs: readonly FaNeedInput[], pm: ProjectManifestDoc = bundledProjectManifest()): CategoryProposal {
  const byKey = new Map<string, ProposedCategory>();
  const outOfScope: CategoryProposal["outOfScope"] = [];
  const unmapped: string[] = [];
  const seenCaps = new Set<string>();
  for (const need of needs ?? []) {
    const id = typeof need?.capabilityId === "string" ? need.capabilityId.trim() : "";
    if (!id || seenCaps.has(id)) continue;
    seenCaps.add(id);
    const topic = pm.out_of_scope_topics.find((t) => t.sources.capability_ids.includes(id));
    if (topic) {
      outOfScope.push({ capabilityId: id, topicKey: topic.topic_key });
      continue;
    }
    const matches = pm.candidate_categories.filter((c) => (c.capability_signals ?? []).includes(id));
    if (matches.length === 0) {
      unmapped.push(id);
      continue;
    }
    const pr = norm(need.priority);
    for (const c of matches) {
      const cur = byKey.get(c.category_key) ?? { categoryKey: c.category_key, kind: c.kind, authored: c.category_manifest_status !== "NOT_AUTHORED", capabilityIds: [], priority: null };
      cur.capabilityIds.push(id);
      if (pr && (cur.priority === null || (RANK[pr] ?? 3) < (RANK[cur.priority] ?? 3))) cur.priority = pr;
      byKey.set(c.category_key, cur);
    }
  }
  const order = new Map(pm.candidate_categories.map((c, i) => [c.category_key, i]));
  const categories = [...byKey.values()].sort(
    (a, b) => (a.priority ? RANK[a.priority] ?? 3 : 3) - (b.priority ? RANK[b.priority] ?? 3 : 3) || (order.get(a.categoryKey) ?? 0) - (order.get(b.categoryKey) ?? 0),
  );
  return { categories, outOfScope, unmapped };
}
