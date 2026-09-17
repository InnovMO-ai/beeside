import { getFieldDefinition } from "@beeside/canonical-fields";
import { needsLeafLabel } from "../fa/content/needs-explorer-taxonomy";
import type { Locale, QuestionBankBundle } from "../fa/engine/bundle-types";
import { isAnswered } from "../fa/engine/conditions";
import { EXPANSION_TIER_COPY, ExpansionDimensionScore, scoreExpansionProfile } from "../fa/engine/expansion-profile";
import type { NeedsMapDependency, NeedsMapStatus, NeedsMapValue } from "../fa/engine/needs-map-types";
import { isNotSureValue } from "../fa/engine/values";
import type { FindingResult, RulesEvaluation } from "../rules/engine";
import type { RulesEngineBundle } from "../rules/types";
import type { SnapshotTemplateBundle, SnapshotTemplateCopy } from "./template";

/**
 * Deterministic assembly of the two frozen records generated at COMPLETED_LOCKED:
 * the client Expansion Snapshot (Functional Specification v1 §6) and the richer Internal beeside
 * Assessment with precision_focus (§7). Pure functions: no I/O, no clock, no free-text generation —
 * every sentence is a template filled from canonical fields, rule output or verbatim answers.
 */

export interface ComposeInput {
  projectId: string;
  generatedAt: Date;
  versions: { questionBank: string; rulesEngine: string; snapshotTemplate: string };
  company: { name: string; website: string | null };
  person: { firstName: string; lastName: string; preferredName: string | null; deliverableLanguage: string; interactionLanguage: string };
  /** Effective (applicable) DECLARED_BY_USER answers by field_key. */
  answers: ReadonlyMap<string, unknown>;
  /**
   * field_keys whose question was applicable in this respondent's journey (JourneyState.
   * applicableQuestionIds mapped through the pinned bundle's questions[].field_key) — a superset of
   * `answers.keys()` that also includes applicable-but-unanswered fields. Required to score the
   * Expansion Profile fairly: a field the respondent was never asked must not count against them.
   */
  applicableFieldKeys: ReadonlySet<string>;
  questionBank: QuestionBankBundle;
  rules: RulesEngineBundle;
  template: SnapshotTemplateBundle;
  evaluation: RulesEvaluation;
}

type PanelStatus = "DEFINED" | "NEEDS_ATTENTION" | "CRITICAL_GAP";
/** Client-facing panel identity: internal status names never leave the server. */
export type SnapshotTone = "well_defined" | "needs_attention" | "resolve_early";
const TONE: Record<PanelStatus, SnapshotTone> = { DEFINED: "well_defined", NEEDS_ATTENTION: "needs_attention", CRITICAL_GAP: "resolve_early" };

/** One radar axis, fully localized and ready to render — no raw field-level detail (Sherpa-only, see
 *  composeInternalAssessment's `expansion_profile`). `value` is internal (0..1), used only to place
 *  the axis point — never rendered as a number/percentage. `tier` is a stable, non-localized key (for
 *  a CSS/icon hook, same pattern as `SnapshotTone`'s `tone`); `tierLabel` is the qualitative wording
 *  meant to be shown next to/instead of the axis. */
export interface RenderedExpansionDimension {
  key: ExpansionDimensionScore["key"];
  label: string;
  value: number;
  tier: ExpansionDimensionScore["tier"];
  tierLabel: string;
}

/** "What Matters Now" (§3.3): declared order (index 0 = Immediate Priority). Never reordered by
 *  dependency data — `dependsOnLabel`/`owner`/`approvalRequired` are shown alongside, not used to
 *  resequence this list. */
export interface RenderedNeedsPriority {
  key: string;
  label: string;
  isImmediatePriority: boolean;
  isBlocker: boolean;
  dependsOnLabel: string | null;
  owner: string | null;
  approvalRequired: boolean;
  approvalFrom: string | null;
}

/** One of the four PathwayDiagram stages (§3.4). Not a rigid methodology — a deterministic bucket by
 *  dependency depth over the client's own declared `fa.needs.map` dependency graph: items with no
 *  unresolved prerequisite are NOW, one prerequisite deep is DEFINE, two is ENABLE, three or more (or
 *  a cyclical/unresolvable chain) is LAUNCH. Items sharing a stage are parallel paths, not a forced
 *  serial sequence. */
export type PathwayStage = "now" | "define" | "enable" | "launch";

export interface RenderedPathwayItem {
  key: string;
  label: string;
  stage: PathwayStage;
  isImmediatePriority: boolean;
  isBlocker: boolean;
  dependsOnLabel: string | null;
}

/** "Capability Landscape" (§3.5): every declared need with its coverage status — never a purchase
 *  signal, never a provider name. `status` is a stable key for icon/tone; `statusLabel` is the only
 *  wording meant to be shown. */
export interface RenderedNeedsLandscapeItem {
  key: string;
  label: string;
  status: NeedsMapStatus;
  statusLabel: string;
}

export interface RenderedSnapshot {
  eyebrow: string;
  headline: string;
  generatedOn: string;
  summary: string[];
  /** The six-dimension Expansion Profile radar (owner-approved final taxonomy, 2026-09-17). Fixed
   *  order — see EXPANSION_PROFILE_DIMENSIONS in expansion-profile.ts. */
  expansionProfile: RenderedExpansionDimension[];
  facts: Array<{ key: "company" | "market" | "launch" | "priority"; label: string; value: string; detail: string | null }>;
  counts: Array<{ tone: SnapshotTone; label: string; count: number }>;
  panels: Array<{ tone: SnapshotTone; title: string; intro: string; items: Array<{ areaId: number; label: string; reason: string | null }> }>;
  immediatePriority: { title: string; value: string; timing: string | null; reason: string | null } | null;
  reconcile: { title: string; text: string } | null;
  decisionAhead: { title: string; text: string } | null;
  shapePlan: { title: string; items: string[] } | null;
  oneThing: { title: string; text: string } | null;
  capabilities: { title: string; intro: string; items: Array<{ categoryId: number; label: string; description: string }> } | null;
  /** null when the respondent declared no priorityRank (Needs Explorer optional or skipped). */
  needsPriorities: {
    title: string;
    intro: string;
    immediateLabel: string;
    nextLabel: string;
    blockerLabel: string;
    dependsOnLabel: string;
    items: RenderedNeedsPriority[];
  } | null;
  /** null under the same condition as `needsPriorities` — the pathway is only ever built over
   *  prioritized needs (`fa.needs.map.dependencies` is itself scoped to `priorityRank` items only). */
  pathway: { title: string; intro: string; stageLabels: Record<PathwayStage, string>; items: RenderedPathwayItem[] } | null;
  /** null when no needs were selected at all. */
  needsLandscape: { title: string; intro: string; items: RenderedNeedsLandscapeItem[] } | null;
  disclosure: { title: string; text: string };
}

export interface ClientSnapshotContent {
  schema_version: 1;
  kind: "expansion_snapshot";
  generated_at: string;
  deliverable_locale: Locale;
  versions: ComposeInput["versions"];
  locales: Record<Locale, RenderedSnapshot>;
}

const PANEL_ORDER: PanelStatus[] = ["DEFINED", "NEEDS_ATTENTION", "CRITICAL_GAP"];
const SHAPE_PLAN_CEILING = 5;
const VOLUMETRIC_FIELDS = [
  "fa.operation.manufacturing.monthly_volume",
  "fa.operation.manufacturing.sku_range",
  "fa.operation.sourcing.critical_supplier_count",
  "fa.operation.import_export.monthly_shipments",
  "fa.operation.warehousing.scale",
  "fa.operation.freight.frequency",
  "fa.operation.last_mile.monthly_deliveries",
  "fa.operation.workforce.first_year_headcount",
];
const STRATEGIC_OPEN_TEXT = [
  "fa.strategic.decided_vs_open",
  "fa.strategic.commercial_success",
  "fa.strategic.slowdown_concern",
  "fa.constraints.existing_commitments",
  "fa.constraints.non_negotiables",
];

export const localeOf = (value: string): Locale => (value === "es" ? "es" : "en");
const intlLocale = (locale: Locale) => (locale === "es" ? "es-MX" : "en-US");

function fill(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (match, name: string) => variables[name] ?? match);
}

function text(answers: ReadonlyMap<string, unknown>, key: string): string | null {
  const value = answers.get(key);
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function list(answers: ReadonlyMap<string, unknown>, key: string, exclude: string[] = []): string[] {
  const value = answers.get(key);
  return Array.isArray(value) ? value.map(String).filter((v) => !exclude.includes(v)) : [];
}

/** Display label of a stored option value, from the project's pinned question bank. */
export function optionLabel(qb: QuestionBankBundle, fieldKey: string, value: string, locale: Locale): string {
  for (const question of qb.questions) {
    if (question.field_key !== fieldKey) continue;
    const option = (question.options ?? []).find((o) => o.value === value);
    if (option) return option.copy[locale] ?? option.copy.en;
  }
  return value;
}

function categoryLabel(qb: QuestionBankBundle, category: string, locale: Locale): string {
  return optionLabel(qb, "fa.priority.client_priority", category, locale);
}

function countryNames(codes: string[], locale: Locale): string {
  let names = codes;
  try {
    const display = new Intl.DisplayNames([intlLocale(locale)], { type: "region" });
    names = codes.map((code) => display.of(code) ?? code);
  } catch {
    // Intl data unavailable: keep ISO codes
  }
  try {
    return new Intl.ListFormat(intlLocale(locale), { style: "long", type: "conjunction" }).format(names);
  } catch {
    return names.join(", ");
  }
}

function formatLaunch(value: unknown, template: SnapshotTemplateBundle, locale: Locale): string | null {
  if (!value || typeof value !== "object") return null;
  const timing = value as { precision?: string; value?: string | null };
  if (typeof timing.value !== "string") return null;
  if (timing.precision === "quarter") {
    const [year, quarter] = timing.value.split("-Q");
    return fill(template.copy[locale].quarter_format, { quarter: quarter ?? "", year: year ?? "" });
  }
  const iso = timing.precision === "month" ? `${timing.value}-01` : timing.value;
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  const options: Intl.DateTimeFormatOptions =
    timing.precision === "month" ? { month: "long", year: "numeric", timeZone: "UTC" } : { dateStyle: "long", timeZone: "UTC" };
  return new Intl.DateTimeFormat(intlLocale(locale), options).format(date);
}

function areaFor(rules: RulesEngineBundle, areaId: number) {
  const area = rules.areas.find((a) => a.id === areaId);
  if (!area) throw new Error(`rules bundle has no area ${areaId}`);
  return area;
}

const needsLabel = (key: string, locale: Locale): string => needsLeafLabel(key, locale) ?? key;

const PATHWAY_STAGES: readonly PathwayStage[] = ["now", "define", "enable", "launch"];

/**
 * Dependency depth over the client's own declared graph, scoped to `priorityRank` (dependencies on
 * an item outside the prioritized set — already excluded by the Needs Explorer's own guided flow —
 * are treated as "no prerequisite", i.e. depth 0). A cycle (should not occur given the guided UI, but
 * defended against here since this must stay a pure, always-terminating function) parks every member
 * of the cycle at the deepest stage rather than looping forever.
 */
function pathwayDepths(priorityRank: readonly string[], dependencies: readonly NeedsMapDependency[]): Map<string, number> {
  const dependsOn = new Map(dependencies.map((d) => [d.key, d.dependsOn]));
  const ranked = new Set(priorityRank);
  const depth = new Map<string, number>();
  const inProgress = new Set<string>();
  const maxDepth = PATHWAY_STAGES.length - 1;

  function depthOf(key: string): number {
    const cached = depth.get(key);
    if (cached !== undefined) return cached;
    if (inProgress.has(key)) return maxDepth; // cycle: unresolved chain lands in the last stage
    inProgress.add(key);
    const parent = dependsOn.get(key) ?? null;
    const resolved = parent && ranked.has(parent) && parent !== key ? Math.min(depthOf(parent) + 1, maxDepth) : 0;
    inProgress.delete(key);
    depth.set(key, resolved);
    return resolved;
  }

  for (const key of priorityRank) depthOf(key);
  return depth;
}

function computeNeedsPriorities(needs: NeedsMapValue | undefined, locale: Locale, copy: SnapshotTemplateCopy): RenderedSnapshot["needsPriorities"] {
  if (!needs || needs.priorityRank.length === 0) return null;
  const byKey = new Map(needs.dependencies.map((d) => [d.key, d]));
  const items: RenderedNeedsPriority[] = needs.priorityRank.map((key, index) => {
    const dep = byKey.get(key);
    return {
      key,
      label: needsLabel(key, locale),
      isImmediatePriority: index === 0,
      isBlocker: needs.blockerKeys.includes(key),
      dependsOnLabel: dep?.dependsOn ? needsLabel(dep.dependsOn, locale) : null,
      owner: dep?.owner ?? null,
      approvalRequired: dep?.approvalRequired ?? false,
      approvalFrom: dep?.approvalFrom ?? null,
    };
  });
  return {
    title: copy.priorities_title,
    intro: copy.priorities_intro,
    immediateLabel: copy.priorities_immediate_label,
    nextLabel: copy.priorities_next_label,
    blockerLabel: copy.priorities_blocker_label,
    dependsOnLabel: copy.priorities_depends_on_label,
    items,
  };
}

function computePathway(needs: NeedsMapValue | undefined, locale: Locale, copy: SnapshotTemplateCopy): RenderedSnapshot["pathway"] {
  if (!needs || needs.priorityRank.length === 0) return null;
  const depths = pathwayDepths(needs.priorityRank, needs.dependencies);
  const dependsOnByKey = new Map(needs.dependencies.map((d) => [d.key, d.dependsOn]));
  const items: RenderedPathwayItem[] = needs.priorityRank.map((key, index) => {
    const dependsOn = dependsOnByKey.get(key) ?? null;
    return {
      key,
      label: needsLabel(key, locale),
      stage: PATHWAY_STAGES[depths.get(key) ?? 0] ?? "now",
      isImmediatePriority: index === 0,
      isBlocker: needs.blockerKeys.includes(key),
      dependsOnLabel: dependsOn ? needsLabel(dependsOn, locale) : null,
    };
  });
  return {
    title: copy.pathway_title,
    intro: copy.pathway_intro,
    stageLabels: {
      now: copy.pathway_stage_now,
      define: copy.pathway_stage_define,
      enable: copy.pathway_stage_enable,
      launch: copy.pathway_stage_launch,
    },
    items,
  };
}

const NEEDS_STATUS_LABEL_KEY: Record<NeedsMapStatus, keyof SnapshotTemplateCopy> = {
  covered_internally: "needs_status_covered_internally",
  covered_by_provider: "needs_status_covered_by_provider",
  in_progress: "needs_status_in_progress",
  needs_resolution: "needs_status_needs_resolution",
  needs_confirmation: "needs_status_needs_confirmation",
};

function computeNeedsLandscape(needs: NeedsMapValue | undefined, locale: Locale, copy: SnapshotTemplateCopy): RenderedSnapshot["needsLandscape"] {
  if (!needs || needs.selections.length === 0) return null;
  const items: RenderedNeedsLandscapeItem[] = needs.selections.map((s) => ({
    key: s.key,
    label: needsLabel(s.key, locale),
    status: s.status,
    statusLabel: copy[NEEDS_STATUS_LABEL_KEY[s.status]],
  }));
  return { title: copy.needs_landscape_title, intro: copy.needs_landscape_intro, items };
}

function renderLocale(input: ComposeInput, locale: Locale): RenderedSnapshot {
  const { answers, questionBank: qb, rules, template, evaluation } = input;
  const copy = template.copy[locale];
  const phrases = template.phrases.copy[locale];
  const findings = new Map(evaluation.findings.map((f) => [f.areaId, f]));

  // ---- Expansion Profile radar (six-dimension "degree of definition", owner-approved 2026-09-17).
  const expansionProfile: RenderedExpansionDimension[] = scoreExpansionProfile(answers, input.applicableFieldKeys).map((d) => ({
    key: d.key,
    label: d.label[locale],
    value: d.value,
    tier: d.tier,
    tierLabel: EXPANSION_TIER_COPY[d.tier][locale],
  }));

  // ---- Header summary (Appendix C {{project_summary}}), with graceful omission.
  const summary: string[] = [];
  const goal = text(answers, "fa.goal.primary_goal");
  const markets = list(answers, "fa.project.target_markets");
  if (goal && phrases.goal[goal]) {
    const variables = { company_name: input.company.name, goal_phrase: phrases.goal[goal] ?? "", markets: countryNames(markets, locale) };
    summary.push(fill(markets.length > 0 ? copy.summary_market : copy.summary_goal, variables));
  }
  const stage = text(answers, "fa.project.stage");
  const launch = formatLaunch(answers.get("fa.goal.launch_target"), template, locale);
  const timingStatus = text(answers, "fa.goal.launch_timing_status");
  if (stage && phrases.stage[stage]) {
    const timingClause = launch && timingStatus && phrases.timing[timingStatus] ? fill(phrases.timing[timingStatus] ?? "", { launch }) : "";
    summary.push(fill(copy.summary_stage, { stage_phrase: phrases.stage[stage] ?? "", timing_clause: timingClause }));
  }

  // ---- Facts bar.
  const facts: RenderedSnapshot["facts"] = [];
  const businessType = text(answers, "fa.business.type");
  facts.push({ key: "company", label: copy.facts_company, value: input.company.name, detail: businessType ? optionLabel(qb, "fa.business.type", businessType, locale) : null });
  const destination = text(answers, "fa.project.destination_status");
  const locationDetail = text(answers, "fa.project.target_location_detail");
  if (markets.length > 0) facts.push({ key: "market", label: copy.facts_market, value: countryNames(markets, locale), detail: locationDetail });
  else if (destination) facts.push({ key: "market", label: copy.facts_market, value: optionLabel(qb, "fa.project.destination_status", destination, locale), detail: null });
  if (launch) facts.push({ key: "launch", label: copy.facts_launch, value: launch, detail: null });
  else if (timingStatus) facts.push({ key: "launch", label: copy.facts_launch, value: optionLabel(qb, "fa.goal.launch_timing_status", timingStatus, locale), detail: null });
  const priority = evaluation.priorityAlignment.priorityCategory;
  if (priority) facts.push({ key: "priority", label: copy.facts_priority, value: categoryLabel(qb, priority, locale), detail: null });

  // ---- Status panels: at-a-glance counts plus the ranked, capped, never-padded lists.
  const titles: Record<PanelStatus, [string, string]> = {
    DEFINED: [copy.panel_defined_title, copy.panel_defined_intro],
    NEEDS_ATTENTION: [copy.panel_needs_title, copy.panel_needs_intro],
    CRITICAL_GAP: [copy.panel_critical_title, copy.panel_critical_intro],
  };
  const counts = PANEL_ORDER.map((status) => ({ tone: TONE[status], label: titles[status][0], count: evaluation.panelCounts[status] }));
  const panels = PANEL_ORDER.filter((status) => evaluation.panels[status].length > 0).map((status) => ({
    tone: TONE[status],
    title: titles[status][0],
    intro: titles[status][1],
    items: evaluation.panels[status].map((areaId) => {
      const finding = findings.get(areaId) as FindingResult;
      return {
        areaId,
        label: areaFor(rules, areaId).copy[locale].label,
        reason: status === "DEFINED" ? null : (finding.reasonClient?.[locale] ?? null),
      };
    }),
  }));

  // ---- Immediate priority (verbatim declaration) and Something to Reconcile (at most one line).
  const priorityTiming = text(answers, "fa.priority.timing");
  const immediatePriority = priority
    ? {
        title: copy.priority_title,
        value: categoryLabel(qb, priority, locale),
        timing: priorityTiming ? optionLabel(qb, "fa.priority.timing", priorityTiming, locale) : null,
        reason: text(answers, "fa.priority.reason"),
      }
    : null;
  const reconcileText = evaluation.priorityAlignment.alignment === "TENSION_DETECTED" ? evaluation.priorityAlignment.reason?.[locale] : null;
  const nextDecision = text(answers, "fa.project.next_decision");
  const primaryConcern = text(answers, "fa.project.primary_concern");

  // ---- What could shape the plan: declared structured constraints and commitments only.
  const shape: string[] = [];
  const push = (item: string) => {
    if (!shape.includes(item)) shape.push(item);
  };
  const critical = text(answers, "fa.constraints.critical");
  if (critical) push(categoryLabel(qb, critical, locale));
  if (answers.get("fa.constraints.has_customer_contract") === "yes") push(copy.shape_customer_contract);
  if (timingStatus === "firm_commitment") push(copy.shape_firm_commitment);
  for (const key of ["fa.constraints.commitment_areas", "fa.constraints.non_negotiable_areas", "fa.constraints.items"]) {
    for (const category of list(answers, key, ["none", "not_sure"])) push(categoryLabel(qb, category, locale));
  }

  const capabilities = evaluation.capabilities
    .filter((c) => c.includedInSnapshot)
    .map((c) => {
      const category = rules.capabilities.categories.find((k) => k.id === c.categoryId);
      return { categoryId: c.categoryId, label: category?.copy[locale].label ?? String(c.categoryId), description: category?.copy[locale].description ?? "" };
    });

  // ---- Needs Landscape (fa.needs.map): declared priority order, dependency-derived pathway, and the
  // full coverage-status grid, always kept as separate facts (Ranking & Dependency Interaction).
  const needsMap = answers.get("fa.needs.map") as NeedsMapValue | undefined;
  const needsPriorities = computeNeedsPriorities(needsMap, locale, copy);
  const pathway = computePathway(needsMap, locale, copy);
  const needsLandscape = computeNeedsLandscape(needsMap, locale, copy);

  return {
    eyebrow: copy.eyebrow,
    headline: copy.headline,
    generatedOn: fill(copy.generated_on, { date: new Intl.DateTimeFormat(intlLocale(locale), { dateStyle: "long", timeZone: "UTC" }).format(input.generatedAt) }),
    summary,
    expansionProfile,
    facts,
    counts,
    panels,
    immediatePriority,
    reconcile: reconcileText ? { title: copy.reconcile_title, text: reconcileText } : null,
    decisionAhead: nextDecision ? { title: copy.decision_title, text: nextDecision } : null,
    shapePlan: shape.length > 0 ? { title: copy.shape_title, items: shape.slice(0, SHAPE_PLAN_CEILING) } : null,
    oneThing: primaryConcern ? { title: copy.one_thing_title, text: primaryConcern } : null,
    capabilities: capabilities.length > 0 ? { title: copy.capabilities_title, intro: copy.capabilities_intro, items: capabilities } : null,
    needsPriorities,
    pathway,
    needsLandscape,
    disclosure: { title: copy.disclosure_title, text: copy.disclosure },
  };
}

export function composeClientSnapshot(input: ComposeInput): ClientSnapshotContent {
  return {
    schema_version: 1,
    kind: "expansion_snapshot",
    generated_at: input.generatedAt.toISOString(),
    deliverable_locale: localeOf(input.person.deliverableLanguage),
    versions: input.versions,
    locales: { en: renderLocale(input, "en"), es: renderLocale(input, "es") },
  };
}

// =====================================================================================================
// Internal beeside Assessment (Sherpa-facing only; never exposed through a public URL).
// =====================================================================================================

export interface PrecisionFocusItem {
  kind: "priority_tension" | "finding" | "not_sure_answer" | "stop_go";
  areaId?: number;
  status?: string;
  fieldKey?: string;
  text: Record<Locale, string>;
}

function labelOrNull(qb: QuestionBankBundle, key: string, answers: ReadonlyMap<string, unknown>, locale: Locale): string | null {
  const value = text(answers, key);
  return value ? optionLabel(qb, key, value, locale) : null;
}

function executiveSummary(input: ComposeInput, locale: Locale, rankedUnresolved: FindingResult[]): string {
  const { answers, questionBank: qb, rules } = input;
  const es = locale === "es";
  const sentences: string[] = [];
  const businessType = labelOrNull(qb, "fa.business.type", answers, locale);
  const markets = list(answers, "fa.project.target_markets");
  const where = markets.length > 0 ? countryNames(markets, locale) : labelOrNull(qb, "fa.project.destination_status", answers, locale);
  if (businessType && where) sentences.push(es ? `Negocio de ${businessType.toLocaleLowerCase("es")} evaluando ${where}.` : `${businessType} business evaluating ${where}.`);
  else if (where) sentences.push(es ? `Proyecto evaluando ${where}.` : `Project evaluating ${where}.`);

  const driver = labelOrNull(qb, "fa.goal.expansion_driver", answers, locale);
  const timing = labelOrNull(qb, "fa.goal.launch_timing_status", answers, locale);
  const timingDriver = labelOrNull(qb, "fa.goal.timing_driver", answers, locale);
  if (driver && timing) {
    const drivenBy = timingDriver ? (es ? ` (impulsado por: ${timingDriver})` : ` (driven by: ${timingDriver})`) : "";
    sentences.push(es ? `Motivo de la expansión: ${driver}. Tiempos: ${timing}${drivenBy}.` : `Expansion driver: ${driver}. Timing: ${timing}${drivenBy}.`);
  }

  const components = list(answers, "fa.operation.components", ["other"]).slice(0, 2).map((c) => optionLabel(qb, "fa.operation.components", c, locale));
  if (components.length > 0) sentences.push(es ? `Operación esperada: ${components.join(", ")}.` : `Expected operation: ${components.join(", ")}.`);

  const open = rankedUnresolved.slice(0, 2).map((f) => areaFor(rules, f.areaId).copy[locale].label);
  if (open.length > 0) sentences.push(es ? `Sin definir todavía: ${open.join(", ")}.` : `Still undefined: ${open.join(", ")}.`);

  const concern = text(answers, "fa.project.primary_concern");
  if (concern) sentences.push(es ? `Preocupación principal: ${concern}` : `Primary concern: ${concern}`);
  const responsibility = labelOrNull(qb, "fa.ownership.project_responsibility", answers, locale);
  if (responsibility) sentences.push(es ? `Responsabilidad de quien respondió: ${responsibility}.` : `Respondent: ${responsibility}.`);
  return sentences.join(" ");
}

export function composeInternalAssessment(input: ComposeInput) {
  const { answers, questionBank: qb, rules, evaluation } = input;
  // Full detail (defined/applicable field counts per dimension) is Sherpa-only — never part of the
  // client Snapshot payload, which only ever sees composeClientSnapshot's rounded RenderedExpansionDimension.
  const expansionProfile = scoreExpansionProfile(answers, input.applicableFieldKeys);
  const byRank = (a: FindingResult, b: FindingResult) => (a.panelRank ?? 99) - (b.panelRank ?? 99) || a.areaId - b.areaId;
  const priorityFinding = evaluation.findings.find((f) => f.areaId === evaluation.priorityAreaId);
  const criticalRanked = [
    ...(priorityFinding ? [priorityFinding] : []),
    ...evaluation.findings.filter((f) => f.status === "CRITICAL_GAP" && f !== priorityFinding).sort(byRank),
  ];
  const needsRanked = evaluation.findings.filter((f) => f.status === "NEEDS_ATTENTION").sort(byRank);

  const declared = (key: string) => {
    const value = answers.get(key);
    return isAnswered(value) ? value : undefined;
  };
  const omitEmpty = (record: Record<string, unknown>) => Object.fromEntries(Object.entries(record).filter(([, v]) => v !== undefined && v !== null));

  const notSure = [...answers.entries()].filter(([key, value]) => !getFieldDefinition(key)?.binding && isNotSureValue(value)).map(([key]) => key);
  const quality = rules.internal.handoff_quality;
  const handoffRating = notSure.length <= quality.high_max_not_sure ? "HIGH" : notSure.length <= quality.medium_max_not_sure ? "MEDIUM" : "LOW";

  const commitments =
    list(answers, "fa.constraints.commitment_areas", ["none"]).length +
    list(answers, "fa.constraints.non_negotiable_areas", ["none"]).length +
    (answers.get("fa.constraints.has_customer_contract") === "yes" ? 1 : 0) +
    (answers.get("fa.goal.launch_timing_status") === "firm_commitment" ? 1 : 0);
  const flexibility = rules.internal.decision_flexibility;
  const flexibilityRating = commitments <= flexibility.high_max_commitments ? "HIGH" : commitments <= flexibility.medium_max_commitments ? "MEDIUM" : "LOW";

  const services = new Map<string, { signal: string; strength: string; areaIds: number[]; evidenceFieldKeys: string[] }>();
  const strengthRank = { STRONG: 3, SUPPORTING: 2, POSSIBLE: 1 } as const;
  for (const finding of evaluation.findings) {
    for (const s of finding.signals) {
      const key = s.signal ?? `unnamed:area.${finding.areaId}`;
      const current = services.get(key);
      const evidenceKeys = finding.evidence.map((e) => e.fieldKey);
      if (!current) services.set(key, { signal: key, strength: s.strength, areaIds: [finding.areaId], evidenceFieldKeys: evidenceKeys });
      else {
        if (strengthRank[s.strength] > strengthRank[current.strength as keyof typeof strengthRank]) current.strength = s.strength;
        current.areaIds.push(finding.areaId);
        current.evidenceFieldKeys = [...new Set([...current.evidenceFieldKeys, ...evidenceKeys])];
      }
    }
  }

  const precisionFocus: PrecisionFocusItem[] = [];
  if (evaluation.priorityAlignment.reason) precisionFocus.push({ kind: "priority_tension", areaId: evaluation.priorityAlignment.tensionAreaId ?? undefined, text: evaluation.priorityAlignment.reason });
  for (const finding of [...criticalRanked, ...needsRanked]) {
    const area = areaFor(rules, finding.areaId);
    precisionFocus.push({ kind: "finding", areaId: finding.areaId, status: finding.status, text: { en: area.copy.en.precision_focus, es: area.copy.es.precision_focus } });
  }
  for (const key of notSure) {
    const question = qb.questions.find((q) => q.field_key === key);
    const title = question ? { en: question.copy.en.title, es: question.copy.es.title } : { en: key, es: key };
    precisionFocus.push({ kind: "not_sure_answer", fieldKey: key, text: { en: `Clarify: ${title.en}`, es: `Aclarar: ${title.es}` } });
  }
  const stopGo = list(answers, "fa.project.stop_go_criteria", ["nothing_specific"]);
  if (stopGo.length > 0) {
    const labels = (locale: Locale) => stopGo.map((v) => optionLabel(qb, "fa.project.stop_go_criteria", v, locale)).join(", ");
    precisionFocus.push({ kind: "stop_go", text: { en: `Validate the stop/go criteria: ${labels("en")}.`, es: `Validar los criterios para avanzar o detenerse: ${labels("es")}.` } });
  }

  return {
    schema_version: 1 as const,
    kind: "internal_assessment" as const,
    generated_at: input.generatedAt.toISOString(),
    versions: input.versions,
    executive_summary: { en: executiveSummary(input, "en", [...criticalRanked, ...needsRanked]), es: executiveSummary(input, "es", [...criticalRanked, ...needsRanked]) },
    respondent: omitEmpty({
      first_name: input.person.firstName,
      last_name: input.person.lastName,
      preferred_name: input.person.preferredName,
      project_responsibility: declared("fa.ownership.project_responsibility"),
      interaction_language: input.person.interactionLanguage,
      deliverable_language: input.person.deliverableLanguage,
      decision_owner: null,
    }),
    company: input.company,
    expansion_profile: expansionProfile.map((d) => ({
      key: d.key,
      label: d.label.en,
      value: d.value,
      tier: d.tier,
      defined_field_count: d.definedFieldCount,
      applicable_field_count: d.applicableFieldCount,
    })),
    narrative: omitEmpty({
      project_story_raw: declared("fa.project.story_raw"),
      success_definition: declared("fa.goal.success_definition"),
      previous_expansion_learning: declared("fa.project.previous_expansion_learning"),
      additional_context: declared("fa.project.additional_context"),
      priority_reason: declared("fa.priority.reason"),
      strategic_prompts: omitEmpty(Object.fromEntries(STRATEGIC_OPEN_TEXT.map((key) => [key, declared(key)]))),
    }),
    profile: omitEmpty({
      primary_goal: declared("fa.goal.primary_goal"),
      expansion_driver: declared("fa.goal.expansion_driver"),
      destination_status: declared("fa.project.destination_status"),
      target_markets: declared("fa.project.target_markets"),
      target_location_detail: declared("fa.project.target_location_detail"),
      stage: declared("fa.project.stage"),
      timing: omitEmpty({
        status: declared("fa.goal.launch_timing_status"),
        target: declared("fa.goal.launch_target"),
        driver: declared("fa.goal.timing_driver"),
      }),
      business: omitEmpty({
        description: declared("fa.business.description"),
        type: declared("fa.business.type"),
        customer_model: declared("fa.business.customer_model"),
        revenue_model: declared("fa.business.revenue_model"),
        value_chain_role: declared("fa.business.value_chain_role"),
        employee_band: declared("fa.business.employee_band"),
      }),
      operation_components: declared("fa.operation.components"),
      expected_capabilities: declared("fa.operation.expected_capabilities"),
      growth_focus: declared("fa.operation.growth_focus"),
      previous_expansion_experience: declared("fa.project.previous_expansion_experience"),
    }),
    volumetrics: VOLUMETRIC_FIELDS.filter((key) => isAnswered(answers.get(key))).map((key) => ({ field_key: key, value: answers.get(key) })),
    findings: evaluation.findings.map((f) => ({
      area_id: f.areaId,
      category: f.category,
      label: areaFor(rules, f.areaId).copy.en.label,
      status: f.status,
      source_type: "DERIVED_BY_RULE",
      rule_triggered: f.ruleTriggered,
      reason_client: f.reasonClient,
      reason_internal: f.reasonInternal,
      evidence: f.evidence,
      pressure_matched: f.pressureMatched,
      signals: f.signals,
      signal_strength: f.signalStrength,
      panel_rank: f.panelRank,
      included_in_snapshot: f.includedInSnapshot,
    })),
    declared_priority: {
      source_type: "DECLARED_BY_USER",
      ...omitEmpty({
        priority_known: declared("fa.priority.priority_known"),
        client_priority: declared("fa.priority.client_priority"),
        timing: declared("fa.priority.timing"),
        reason: declared("fa.priority.reason"),
      }),
    },
    derived_early_attention: { source_type: "DERIVED_BY_RULE", area_ids: criticalRanked.map((f) => f.areaId) },
    priority_alignment: evaluation.priorityAlignment,
    constraints: {
      items: list(answers, "fa.constraints.items"),
      critical: declared("fa.constraints.critical") ?? null,
      commitment_areas: list(answers, "fa.constraints.commitment_areas"),
      has_customer_contract: declared("fa.constraints.has_customer_contract") ?? null,
      non_negotiable_areas: list(answers, "fa.constraints.non_negotiable_areas"),
      decision_flexibility: { rating: flexibilityRating, declared_commitments: commitments, source_type: "DERIVED_BY_RULE" },
    },
    stop_go_criteria: list(answers, "fa.project.stop_go_criteria"),
    next_decision: declared("fa.project.next_decision") ?? null,
    primary_concern: declared("fa.project.primary_concern") ?? null,
    candidate_services: [...services.values()],
    strategic_signals: evaluation.strategicSignals,
    not_sure_answers: notSure,
    capabilities: evaluation.capabilities.map((c) => ({
      ...c,
      label: rules.capabilities.categories.find((k) => k.id === c.categoryId)?.copy.en.label ?? String(c.categoryId),
    })),
    handoff_quality: { rating: handoffRating, not_sure_count: notSure.length, basis: quality },
    precision_focus: precisionFocus,
    recommended_questions: {
      en: precisionFocus.filter((p) => p.kind === "finding").map((p) => p.text.en),
      es: precisionFocus.filter((p) => p.kind === "finding").map((p) => p.text.es),
    },
    near_timing: evaluation.nearTiming,
  };
}

export type InternalAssessmentContent = ReturnType<typeof composeInternalAssessment>;
