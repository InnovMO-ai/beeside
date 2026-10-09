/**
 * Test-only "client simulator": repeatedly answers whatever the engine says to ask next (nextTarget), choosing values
 * from the manifest's own vocabulary (and from the keywords / values the manifest's rules look for) with a seeded PRNG.
 * Used to prove that no branch of any shipped manifest dead-ends (G-C3 reachability): the engine must always be able
 * to reach ready = true, 100 %, nextFieldKey = null.
 */
import { ruleItemRefs, type Rule } from "../ast";
import type { FieldDefinition } from "../effective-fields";
import { evaluateCategoryDetailed, type DetailedEvaluation } from "../readiness";
import type { CategoryManifestDoc } from "../bundled";
import type { FactMap, FactView } from "../types";

export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const walkRules = (manifest: CategoryManifestDoc): Rule[] => {
  const out: Rule[] = [];
  const add = (r: unknown): void => { if (r) out.push(r as Rule); };
  const fieldsOf = (m: CategoryManifestDoc): FieldDefinition[] => [...m.fields, ...Object.values(m.country_overlays).flatMap((o) => o.add ?? [])];
  for (const f of fieldsOf(manifest)) add(f.applicability_rule);
  for (const d of manifest.critical_decisions as Array<{ resolution_rule: Rule }>) add(d.resolution_rule);
  return out;
};

/** Item-level vocabulary the rules care about: "group.sub" -> candidate values (rule literals + a benign value). */
function ruleVocabulary(manifest: CategoryManifestDoc): Map<string, unknown[]> {
  const vocab = new Map<string, unknown[]>();
  const add = (k: string, v: unknown): void => { const a = vocab.get(k) ?? []; if (!a.some((x) => JSON.stringify(x) === JSON.stringify(v))) a.push(v); vocab.set(k, a); };
  const visit = (r: Rule): void => {
    switch (r.op) {
      case "and": case "or": r.rules.forEach(visit); break;
      case "not": visit(r.rule); break;
      case "group_item_text_matches_any": add(`${r.field_key}.${r.item_field_key}`, r.keywords[0]); break;
      case "group_any_item_equals": add(`${r.field_key}.${r.item_field_key}`, r.value); break;
      case "group_any_item_in": add(`${r.field_key}.${r.item_field_key}`, r.values[0]); add(`${r.field_key}.${r.item_field_key}`, r.values[r.values.length - 1]); break;
      case "group_any_item_differs": add(`${r.field_key}.${r.item_field_a}`, "CN"); add(`${r.field_key}.${r.item_field_b}`, "US"); add(`${r.field_key}.${r.item_field_a}`, "US"); break;
      default: break;
    }
  };
  walkRules(manifest).forEach(visit);
  for (const r of walkRules(manifest)) void ruleItemRefs(r);
  return vocab;
}

function scalarCandidates(f: FieldDefinition, nested: boolean): unknown[] {
  switch (f.type) {
    case "boolean": return [true, false];
    case "enum": return [...(f.values ?? [])];
    case "multi_enum": return [[f.values?.[0]], (f.values ?? []).slice(0, 3), [...(f.values ?? [])]];
    case "number": return [10];
    case "number_with_unit": return [{ value: 10, unit: f.unit_values?.[0] ?? "units" }];
    case "money": return [{ amount: 1000, currency: "USD" }];
    case "date": return ["2027-03"];
    case "country_list": return nested ? ["US", "CN", "DE"] : [["US"]];
    case "language_list": return [["en"]];
    case "text_list": return [["reference one"]];
    default: return ["Standard commercial goods"];
  }
}

export interface DriveOptions { seed: number; countries: string[]; extraFacts?: FactMap; maxSteps?: number }
export interface DriveResult { facts: Record<string, FactView | undefined>; ev: DetailedEvaluation; steps: number }

export function drive(manifest: CategoryManifestDoc, opts: DriveOptions): DriveResult {
  const rand = rng(opts.seed);
  const vocab = ruleVocabulary(manifest);
  const pick = <T,>(a: T[]): T => a[Math.floor(rand() * a.length)] as T;
  const facts: Record<string, FactView | undefined> = { ...(opts.extraFacts ?? {}) };
  const max = opts.maxSteps ?? 300;
  let ev = evaluateCategoryDetailed({ manifest, facts, countries: opts.countries });
  let steps = 0;
  const makeItem = (g: FieldDefinition): Record<string, unknown> => {
    const item: Record<string, unknown> = {};
    for (const sub of g.group_item_schema ?? []) {
      if (sub.requirement_level === "supporting" || sub.requirement_level === "informational") continue;
      const v = vocab.get(`${g.field_key}.${sub.field_key}`);
      const cands = [...(v ?? []), ...scalarCandidates(sub, true)];
      item[sub.field_key] = pick(cands);
    }
    return item;
  };
  while (ev.nextTarget && steps < max) {
    const t = ev.nextTarget;
    const field = ev.details[t.fieldKey]!.field;
    if (field.type === "repeatable_group") {
      const cur = facts[field.field_key];
      const items = Array.isArray(cur?.value) ? [...(cur!.value as Array<Record<string, unknown>>)] : [];
      if (t.itemIndex !== undefined && t.subFieldKey) {
        const sub = field.group_item_schema!.find((s) => s.field_key === t.subFieldKey)!;
        items[t.itemIndex] = { ...items[t.itemIndex], [t.subFieldKey]: pick(scalarCandidates(sub, true)) };
      } else items.push(makeItem(field));
      facts[field.field_key] = { answerState: "ANSWERED", value: items };
    } else {
      const v = pick(scalarCandidates(field, false));
      facts[field.field_key] = field.type === "boolean" && v === false ? { answerState: "EXPLICIT_NO", value: false } : { answerState: "ANSWERED", value: v };
    }
    ev = evaluateCategoryDetailed({ manifest, facts, countries: opts.countries });
    steps += 1;
  }
  return { facts, ev, steps };
}
