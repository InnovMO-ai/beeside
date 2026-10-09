/**
 * Conversions of CRP content between its three shapes:
 *   crp.v1 (stored in `pack.content`, built by the manifest engine)
 *     -> StructuredCrp (the WHITELISTED, sanitized form that travels to Operation Hub as `artifact.structured`)
 *     -> CrpViewDto (what the client sees in "review" and in the Preview).
 * The Preview and the payload therefore cannot diverge: both are derived from the same StructuredCrp.
 * No manifest field key, internal id, enum code or JSON leaves through these shapes.
 */
import type { CrpRequirementDto, CrpSectionDto, CrpViewDto, ItemState } from "../../api/dto";
import { plainCopy } from "../../conversation/copy";
import type { CrpRequirementContent, CrpV1Content } from "../../manifest/crp-content";
import type { Locale } from "../../manifest/value-render";
import { sanitizeOrNull, sanitizeText } from "./sanitize";

export interface StructuredItem {
  label: string;
  value: string | null;
  state: ItemState;
  execution_dependency: boolean;
  entries?: string[];
  missing?: string[];
  /** Restricts who may see the item downstream. A technical flag: never rendered to the client. */
  visibility?: "confidential" | "context_only";
}
export interface StructuredCrp {
  language: Locale;
  crp_kind: string;
  title: string;
  context: string[];
  sections: Array<{ title: string; items: StructuredItem[] }>;
  pending: StructuredItem[];
  required_later: string[];
}

const STATES: ReadonlySet<string> = new Set(["confirmed", "assumed", "pending", "not_applicable"]);

function item(r: CrpRequirementContent): StructuredItem {
  const out: StructuredItem = {
    label: sanitizeText(r.label, 300),
    value: sanitizeOrNull(r.value),
    state: (STATES.has(r.state) ? r.state : "pending") as ItemState,
    execution_dependency: r.executionDependency === true,
  };
  const entries = (r.entries ?? []).map((e) => sanitizeText(e)).filter(Boolean);
  if (entries.length) out.entries = entries;
  const missing = (r.missing ?? []).map((e) => sanitizeText(e, 300)).filter(Boolean);
  if (missing.length) out.missing = missing;
  if (r.visibility) out.visibility = r.visibility;
  return out;
}

const strings = (xs: readonly string[], max?: number): string[] => xs.map((x) => sanitizeText(x, max)).filter(Boolean);

/** Whitelist projection of a crp.v1 content. Unknown keys are dropped by construction. */
export function toStructured(content: CrpV1Content): StructuredCrp {
  return {
    language: content.locale === "es" ? "es" : "en",
    crp_kind: sanitizeText(content.crpKind, 60),
    title: sanitizeText(content.title, 300),
    context: strings(content.context, 500),
    sections: content.sections.map((s) => ({ title: sanitizeText(s.title, 300), items: s.items.map(item) })),
    pending: content.pending.map(item),
    required_later: strings(content.requiredLater, 500),
  };
}

/** Opaque, positional ids: stable for one content, meaningless outside it. */
function requirementDto(r: StructuredItem, id: string, locale: Locale): CrpRequirementDto {
  let value = r.value;
  if (r.missing?.length) {
    const tag = plainCopy("crp_item_state_pending", locale);
    const lines = [...(value ? [value] : []), ...r.missing.map((m) => `${tag}: ${m}`)];
    value = lines.join("\n");
  }
  return { id, label: r.label, value, state: r.state, executionDependency: r.execution_dependency };
}

export interface CrpViewFlags {
  categoryId: string;
  state: CrpViewDto["state"];
  confirmedAt: string | null;
  canConfirm: boolean;
  canRequestChanges: boolean;
  canStartNewVersion: boolean;
}

export function toCrpView(s: StructuredCrp, flags: CrpViewFlags): CrpViewDto {
  const sections: CrpSectionDto[] = s.sections.map((sec, i) => ({
    id: `s${i + 1}`,
    title: sec.title,
    items: sec.items.map((r, j) => requirementDto(r, `r${i + 1}_${j + 1}`, s.language)),
  }));
  return {
    categoryId: flags.categoryId,
    title: s.title,
    state: flags.state,
    confirmedAt: flags.confirmedAt,
    context: [...s.context],
    sections,
    pending: s.pending.map((r, j) => requirementDto(r, `p${j + 1}`, s.language)),
    requiredLater: [...s.required_later],
    canConfirm: flags.canConfirm,
    canRequestChanges: flags.canRequestChanges,
    canStartNewVersion: flags.canStartNewVersion,
  };
}

/** Flat human lines of a view, for the Preview block (label: value, one per line; pending marked). */
export function viewLines(v: CrpViewDto, locale: Locale): string[] {
  const out: string[] = [];
  const state = (s: ItemState): string => (s === "confirmed" ? "" : ` (${plainCopy(`crp_item_state_${s}`, locale)})`);
  for (const sec of v.sections) {
    out.push(sec.title);
    for (const r of sec.items) out.push(`${r.label}: ${r.value ?? "—"}${state(r.state)}`);
  }
  if (v.pending.length) {
    out.push(plainCopy("crp_pending_section_title", locale));
    for (const r of v.pending) out.push(r.label);
  }
  return out;
}
