/**
 * Frame -> category facts. FROZEN PRINCIPLE: Precision never asks again what it already knows (unless ambiguity, contradiction,
 * freshness, material change or insufficient depth). What the project conversation (and Discovery before it) established is
 * translated into the fields of each category's manifest, with its provenance, so the category conversation DEEPENS the project
 * instead of restarting it.
 *
 * Pure and deterministic. Rules:
 *  - only what the client said, confirmed, corrected or Discovery captured is inherited; an AI proposal (`proposed`, `implicit`)
 *    never becomes a category fact;
 *  - a value is inherited only when it means EXACTLY what the field asks. "Through a third party" does not say whether that is an
 *    employer of record, staffing or contractors: that stays open and is what the category asks (depth, not repetition);
 *  - "I do not know" / "prefer not to say" are honest knowledge and are inherited as such (never asked again);
 *  - a partially known group item is inherited partially: the category asks only for what is missing in it.
 */
import type { FieldDefinition } from "../manifest/effective-fields";
import type { Frame, FrameItem, Loc, NeedItem } from "./types";

export type InheritedState = "ANSWERED" | "UNKNOWN" | "WITHHELD";
export type InheritedProvenance = "client_answered" | "client_confirmed" | "client_corrected";

export interface InheritedFact {
  fieldKey: string;
  value: unknown;
  valueType: string;
  answerState: InheritedState;
  provenance: InheritedProvenance;
  /** The frame item (or `need:<id>`) this comes from. */
  frameKey: string;
  sourcePinId?: string;
  sourceItemRef?: string;
  /** Short client-language rendering, for the category opening ("lo que ya sé"). */
  display: string;
}

type FieldIndex = ReadonlyMap<string, Pick<FieldDefinition, "field_key" | "type" | "values">>;

const provenanceOf = (p: FrameItem["provenance"] | undefined): InheritedProvenance | null => {
  switch (p) {
    case "client_stated":
    case "discovery": return "client_answered";
    case "client_confirmed": return "client_confirmed";
    case "client_corrected": return "client_corrected";
    default: return null; // ai_understood: a proposal, not something the client said
  }
};

interface Source { provenance: InheritedProvenance; frameKey: string; sourcePinId?: string; sourceItemRef?: string }

function sourceOf(frame: Frame, item: FrameItem): Source | null {
  const provenance = provenanceOf(item.provenance);
  if (!provenance) return null;
  const pin = item.sourcePinId ?? (item.provenance === "discovery" ? frame.discoveryPinId ?? undefined : undefined);
  return { provenance, frameKey: item.key, ...(pin ? { sourcePinId: pin, sourceItemRef: item.sourceItemRef ?? item.key } : {}) };
}

const settled = (i: FrameItem | undefined): i is FrameItem => Boolean(i) && (i!.status === "known" || i!.status === "undecided" || i!.status === "unknown" || i!.status === "withheld");

/** `unknown` / `withheld` frame items carry over as the honest answer state of the primary field. */
const stateOf = (i: FrameItem): InheritedState => (i.status === "unknown" ? "UNKNOWN" : i.status === "withheld" ? "WITHHELD" : "ANSWERED");

interface Rule {
  /** Manifest field written. */
  field: string;
  /** Frame probes it reads (all must be settled unless the rule says otherwise). */
  from: string;
  /** The honest "I do not know" of the frame also settles this field. */
  carryState?: boolean;
  /** Value (null = the frame does not say exactly this). */
  convert: (item: FrameItem, frame: Frame, loc: Loc, def: Pick<FieldDefinition, "values">) => { value: unknown; display?: string } | null;
}

const valid = (def: Pick<FieldDefinition, "values">, v: string): boolean => !Array.isArray(def.values) || def.values.includes(v);

const operationCountry = (frame: Frame): string | undefined => frame.countries.find((c) => c.role === "operation")?.code;
const counterpartyCountries = (frame: Frame): string[] => [...new Set(frame.countries.filter((c) => c.role === "origin" || c.role === "headquarters").map((c) => c.code))];

type Kind = { kind?: string; label?: string | null };
const entityKind = (i: FrameItem): Kind => (i.value && typeof i.value === "object" ? (i.value as Kind) : {});

function intercompanyTypes(display: string): string[] {
  const t = display.toLowerCase();
  const out: string[] = [];
  if (/servicios|services/.test(t)) out.push("services");
  if (/equipo|materiales|equipment|goods/.test(t)) out.push("goods");
  if (/pr[eé]stamos|loans?|financ/.test(t)) out.push("financing");
  if (/regal[ií]as|licen[cs]|royalt/.test(t)) out.push("royalties_ip");
  return out;
}
const kindsOf = (i: FrameItem): { kinds: string[]; unspecified: boolean } => {
  const v = (i.value && typeof i.value === "object" ? (i.value as { kinds?: unknown; unspecified?: unknown }) : {}) as { kinds?: unknown; unspecified?: unknown };
  const kinds = Array.isArray(v.kinds) ? v.kinds.filter((k): k is string => typeof k === "string") : [];
  const only = kinds.every((k) => k === "unspecified");
  return { kinds: kinds.filter((k) => k !== "unspecified"), unspecified: Boolean(v.unspecified) && only };
};

/** Rules by category. A category without rules still inherits the services in scope from its confirmed needs. */
const RULES: Readonly<Record<string, readonly Rule[]>> = {
  corporate_legal_admin: [
    {
      field: "legal_entity_stage", from: "entity.form", carryState: true,
      convert: (i, _f, _l, def) => {
        if (i.status === "undecided") return valid(def, "evaluating_options") ? { value: "evaluating_options" } : null;
        if (i.status === "known" && entityKind(i).kind) return valid(def, "decided_to_incorporate") ? { value: "decided_to_incorporate" } : null;
        return null;
      },
    },
    {
      field: "legal_entity_form_preference", from: "entity.form",
      convert: (i) => {
        if (i.status !== "known") return null;
        const k = entityKind(i);
        if (k.kind === "company" && k.label) return { value: k.label };
        if (k.kind === "branch") return { value: i.display };
        if (k.kind === "rep_office") return { value: i.display };
        return null; // "subsidiary, type to be defined": the category asks which company type
      },
    },
  ],
  people_payroll_employment: [
    {
      field: "hr_employment_model", from: "workforce.model", carryState: true,
      convert: (i, _f, _l, def) => {
        if (i.status === "undecided") return valid(def, "undecided") ? { value: "undecided" } : null;
        // direct hiring is exactly "direct_entity"; "through a third party" / "mixed" do not say employer of record vs staffing vs
        // contractors, so the category asks that (deepening)
        if (i.status === "known" && i.value === "direct") return valid(def, "direct_entity") ? { value: "direct_entity" } : null;
        return null;
      },
    },
    {
      field: "hr_employee_population_breakdown", from: "workforce.headcount",
      convert: (i, frame, loc) => {
        if (i.status !== "known") return null;
        const split = frame.items["workforce.split"];
        const country = operationCountry(frame);
        const sv = split?.status === "known" && split.value && typeof split.value === "object" ? (split.value as { direct?: unknown; outsourced?: unknown }) : null;
        const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) && x > 0 ? x : null);
        const groups: Array<Record<string, unknown>> = [];
        const cn = country ? { country: [country] } : {};
        if (sv && num(sv.direct) && num(sv.outsourced)) {
          groups.push({ headcount: num(sv.direct), ...cn }, { headcount: num(sv.outsourced), ...cn });
          return { value: groups, display: loc === "es" ? `${num(sv.direct)} directas y ${num(sv.outsourced)} por un tercero` : `${num(sv.direct)} direct and ${num(sv.outsourced)} through a third party` };
        }
        const v = i.value as { min?: unknown; max?: unknown } | null;
        const n = v && num(v.min) && v.min === v.max ? num(v.min) : null;
        if (!n) return null;
        return { value: [{ headcount: n, ...cn }], display: i.display };
      },
    },
  ],
  tax_accounting_audit: [
    {
      field: "tax_has_intercompany_transactions", from: "tax.intercompany",
      convert: (i) => {
        if (i.status !== "known") return null;
        const k = kindsOf(i);
        return { value: k.kinds.length > 0 || k.unspecified };
      },
    },
    {
      field: "tax_intercompany_transactions", from: "tax.intercompany",
      convert: (i, frame) => {
        if (i.status !== "known") return null;
        const types = [...new Set(kindsOf(i).kinds.flatMap(intercompanyTypes))].filter((t) => ["goods", "services", "royalties_ip", "financing", "cost_sharing"].includes(t));
        const parent = counterpartyCountries(frame);
        if (types.length === 0) return null;
        return { value: types.map((t) => ({ transaction_type: t, ...(parent.length === 1 ? { counterparty_country: parent } : {}) })) };
      },
    },
    {
      field: "tax_parent_reporting_required", from: "accounting.setup",
      convert: (i) => (i.status === "known" && /consolid|reporte (?:a|para) la matriz|reportar a la matriz|group reporting|report to the parent/i.test(`${i.display} ${typeof i.value === "string" ? i.value : ""}`) ? { value: true } : null),
    },
    {
      field: "tax_accounting_framework", from: "accounting.setup",
      convert: (i, _f, _l, def) => {
        if (i.status !== "known") return null;
        const t = `${i.display} ${typeof i.value === "string" ? i.value : ""}`.toLowerCase();
        const v = /us[\s-]?gaap/.test(t) ? "us_gaap" : /\b(?:ifrs|niif)\b/.test(t) ? "ifrs" : null;
        return v && valid(def, v) ? { value: v } : null;
      },
    },
  ],
  international_trade_customs: [
    {
      field: "customs_related_party_transactions", from: "tax.intercompany",
      convert: (i) => {
        if (i.status !== "known") return null;
        const k = kindsOf(i);
        return { value: k.kinds.some((t) => intercompanyTypes(t).includes("goods")) };
      },
    },
  ],
};

/** Which category fields answer which probe (so an answer given in the category also resolves the aspect in the combined readiness). */
export const PROBE_COVERAGE: Readonly<Record<string, readonly string[]>> = {
  "entity.form": ["legal_entity_stage", "legal_entity_form_preference"],
  "workforce.headcount": ["hr_employee_population_breakdown"],
  "workforce.split": ["hr_employee_population_breakdown"],
  "workforce.model": ["hr_employment_model"],
  "tax.intercompany": ["tax_has_intercompany_transactions", "tax_intercompany_transactions"],
  "accounting.setup": ["tax_parent_reporting_required", "tax_accounting_framework"],
};

/** The probes whose answers this category inherits (they come first when the thread says what it already knows). */
export const inheritedProbes = (categoryKey: string): string[] => [...new Set((RULES[categoryKey] ?? []).map((r) => r.from))];

const servicesField = (fields: FieldIndex): string | null => {
  for (const k of fields.keys()) if (k.endsWith("_services_in_scope")) return k;
  return null;
};

/** The client's own needs placed in this category, with their catalog service keys, that the services field can hold. */
export function needsOf(frame: Frame, categoryKey: string): NeedItem[] {
  return frame.needs.filter((n) => n.categoryKey === categoryKey && n.status !== "removed" && n.origin !== "implied");
}

export function deriveInherited(frame: Frame, categoryKey: string, fields: FieldIndex): InheritedFact[] {
  const out: InheritedFact[] = [];
  const loc = frame.locale;

  const svcField = servicesField(fields);
  if (svcField) {
    const def = fields.get(svcField)!;
    const allowed = new Set(Array.isArray(def.values) ? def.values.filter((v): v is string => typeof v === "string") : []);
    const needs = needsOf(frame, categoryKey).filter((n) => n.serviceKeys.some((k) => allowed.has(k)));
    const keys = [...new Set(needs.flatMap((n) => n.serviceKeys.filter((k) => allowed.has(k))))];
    if (keys.length > 0) {
      const disc = needs.every((n) => n.origin === "discovery");
      const pin = frame.discoveryPinId ?? undefined;
      out.push({
        fieldKey: svcField, value: keys, valueType: def.type, answerState: "ANSWERED", provenance: "client_answered", frameKey: `need:${needs[0]!.id}`,
        ...(disc && pin ? { sourcePinId: pin, sourceItemRef: `need:${needs[0]!.id}` } : {}),
        display: needs.map((n) => n.text).slice(0, 3).join(", "),
      });
    }
  }

  for (const rule of RULES[categoryKey] ?? []) {
    const def = fields.get(rule.field);
    const item = frame.items[rule.from];
    if (!def || !settled(item)) continue;
    const src = sourceOf(frame, item);
    if (!src) continue;
    const r = rule.convert(item, frame, loc, def);
    if (r) {
      out.push({ fieldKey: rule.field, value: r.value, valueType: def.type, answerState: "ANSWERED", provenance: src.provenance, frameKey: src.frameKey, ...(src.sourcePinId ? { sourcePinId: src.sourcePinId, sourceItemRef: src.sourceItemRef } : {}), display: r.display ?? item.display });
    } else if (rule.carryState && (item.status === "unknown" || item.status === "withheld")) {
      out.push({ fieldKey: rule.field, value: null, valueType: def.type, answerState: stateOf(item), provenance: src.provenance, frameKey: src.frameKey, ...(src.sourcePinId ? { sourcePinId: src.sourcePinId, sourceItemRef: src.sourceItemRef } : {}), display: item.display });
    }
  }
  // a loan from the parent is an intra-group financing transaction even when the client has not listed it among the intercompany ones
  if (categoryKey === "tax_accounting_audit" && fields.has("tax_intercompany_transactions")) {
    const st = frame.items["entity.funding_structure"];
    const src = settled(st) && st.status === "known" ? sourceOf(frame, st) : null;
    if (st && src && (st.value === "loan" || st.value === "mixed")) {
      const parent = counterpartyCountries(frame);
      const fin: Record<string, unknown> = { transaction_type: "financing", ...(parent.length === 1 ? { counterparty_country: parent } : {}) };
      const def = fields.get("tax_intercompany_transactions")!;
      const at = out.findIndex((f) => f.fieldKey === "tax_intercompany_transactions");
      if (at >= 0) {
        const cur = out[at]!;
        const items = Array.isArray(cur.value) ? (cur.value as Array<Record<string, unknown>>) : [];
        if (!items.some((x) => x.transaction_type === "financing")) out[at] = { ...cur, value: [...items, fin] };
      } else {
        out.push({ fieldKey: "tax_intercompany_transactions", value: [fin], valueType: def.type, answerState: "ANSWERED", provenance: src.provenance, frameKey: src.frameKey, ...(src.sourcePinId ? { sourcePinId: src.sourcePinId, sourceItemRef: src.sourceItemRef } : {}), display: st.display });
      }
      if (fields.has("tax_has_intercompany_transactions") && !out.some((f) => f.fieldKey === "tax_has_intercompany_transactions")) {
        out.push({ fieldKey: "tax_has_intercompany_transactions", value: true, valueType: fields.get("tax_has_intercompany_transactions")!.type, answerState: "ANSWERED", provenance: src.provenance, frameKey: src.frameKey, display: st.display });
      }
    }
  }
  return out;
}
