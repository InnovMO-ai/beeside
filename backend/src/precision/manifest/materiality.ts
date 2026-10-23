/**
 * Materiality of a change between two states of a category (D11) — decides whether a client-initiated change after a
 * confirmed CRP needs a new version / a new service-map version. Pure and deterministic; the model never decides it.
 *
 *  - `change_policy: operational`  -> never material;
 *  - `any`                         -> any change is material;
 *  - `threshold`                   -> numeric relative change >= change_threshold.relative_pct, or a date shift of at
 *                                     least change_threshold.period_shift_months (a threshold that cannot be computed is
 *                                     conservative: material);
 *  - structural events             -> always material: a new or removed Strategic Advisory / Ecosystem Development need
 *                                     (array item added or removed) and any item added/removed on a non-operational group.
 */
import { itemFact } from "./ast";
import type { FieldDefinition } from "./effective-fields";
import type { FactMap } from "./types";

export interface FieldChange {
  field_key: string;
  /** Item index and sub-field, for changes inside a repeatable_group. */
  item?: number;
  sub?: string;
  material: boolean;
  reason: string;
}

const deepEq = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const num = (v: unknown): number | null => {
  if (typeof v === "number") return v;
  if (v && typeof v === "object") {
    const o = v as { value?: unknown; amount?: unknown };
    if (typeof o.value === "number") return o.value;
    if (typeof o.amount === "number") return o.amount;
  }
  return null;
};
function monthsBetween(a: unknown, b: unknown): number {
  const [ya = 0, ma = 1] = String(a).split("-").map(Number);
  const [yb = 0, mb = 1] = String(b).split("-").map(Number);
  return Math.abs((yb - ya) * 12 + ((mb || 1) - (ma || 1)));
}

/** Field keys whose group items represent a client's separate SA / ED needs (structural when added or removed). */
const STRUCTURAL_GROUPS: ReadonlySet<string> = new Set(["sa_studies", "ed_engagements"]);

export function isMaterialFieldChange(field: Pick<FieldDefinition, "type" | "change_policy" | "change_threshold">, before: unknown, after: unknown, isStructural = false): { material: boolean; reason: string } {
  if (isStructural) return { material: true, reason: "structural event" };
  if (deepEq(before, after)) return { material: false, reason: "unchanged" };
  const policy = field.change_policy;
  if (policy === "operational") return { material: false, reason: "operational field" };
  if (policy === "any") return { material: true, reason: "change_policy any" };
  const t = field.change_threshold;
  if (field.type === "date" && t?.period_shift_months) {
    const m = monthsBetween(before, after);
    return { material: m >= t.period_shift_months, reason: `date shifted ${m} month(s), threshold ${t.period_shift_months}` };
  }
  const nb = num(before);
  const na = num(after);
  if (nb !== null && na !== null && t?.relative_pct) {
    const pct = nb === 0 ? (na === 0 ? 0 : 100) : (Math.abs(na - nb) / Math.abs(nb)) * 100;
    return { material: pct >= t.relative_pct, reason: `relative change ${pct.toFixed(1)}%, threshold ${t.relative_pct}%` };
  }
  return { material: true, reason: "threshold not computable: conservative" };
}

const valueOf = (facts: FactMap, key: string): unknown => facts[key]?.value;

/** Every changed field between two fact states of `manifest` (derived fields are ignored). */
export function materialChanges(manifest: { fields: FieldDefinition[] }, beforeFacts: FactMap, afterFacts: FactMap): FieldChange[] {
  const out: FieldChange[] = [];
  for (const f of manifest.fields) {
    if (f.derived === true) continue;
    const b = valueOf(beforeFacts, f.field_key);
    const a = valueOf(afterFacts, f.field_key);
    if (f.type === "repeatable_group") {
      const bl = Array.isArray(b) ? (b as Array<Record<string, unknown> | null>) : [];
      const al = Array.isArray(a) ? (a as Array<Record<string, unknown> | null>) : [];
      if (al.length !== bl.length) {
        if (STRUCTURAL_GROUPS.has(f.field_key)) out.push({ field_key: f.field_key, material: true, reason: "new/removed SA-ED need (structural)" });
        else if (f.change_policy === "operational") out.push({ field_key: f.field_key, material: false, reason: "operational field" });
        else out.push({ field_key: f.field_key, material: true, reason: "item added/removed on a non-operational group" });
        continue;
      }
      al.forEach((it, i) => {
        for (const sub of f.group_item_schema ?? []) {
          const r = isMaterialFieldChange(sub, itemFact(bl[i] ? bl[i]?.[sub.field_key] : undefined).value, itemFact(it ? it[sub.field_key] : undefined).value);
          if (r.reason !== "unchanged") out.push({ field_key: f.field_key, item: i, sub: sub.field_key, ...r });
        }
      });
      continue;
    }
    const r = isMaterialFieldChange(f, b, a);
    if (r.reason !== "unchanged") out.push({ field_key: f.field_key, ...r });
  }
  return out;
}

export const isMaterial = (changes: readonly FieldChange[]): boolean => changes.some((c) => c.material);
