/**
 * Material overlay — READINESS = MATERIAL SUFFICIENCY FOR THIS PROJECT (frozen rule), not "the generic blocking fields are complete".
 *
 * What the project already established (a Mexican entity with a Portuguese parent that funds it and sells it services...) makes some
 * dimensions of a category MATERIAL for this project: before the category can be called understood, those dimensions must have been
 * explored with the client. The overlay is a small, auditable system fact of the category instance (`material_overlay`), written by the
 * Understanding layer from the project's signals and read by the readiness engine as plain data — the engine stays pure and the call
 * sites do not change.
 *
 *  - a material field becomes applicable even if its generic applicability rule would hide it, and counts as required;
 *  - material sub-fields of a group count as required for every entered item;
 *  - it is a critical item (`material:<field>`) until it has been ASKED: an honest "I do not know" / "prefer not to say" satisfies it
 *    (the question is answered; the gap goes to the specialist as pending), but a field nobody asked does not;
 *  - `unless` drops an item when the client's own category facts contradict its premise (e.g. "no intercompany transactions").
 */
import { evaluateRule, type Rule } from "./ast";
import type { FactMap } from "./types";

export const MATERIAL_OVERLAY_KEY = "material_overlay";

export interface MaterialItem {
  /** Manifest field that must have been explored. */
  field: string;
  /** Sub-fields of a repeatable_group that become required for each entered item. */
  subs?: string[];
  /** Signals (see understanding/material-signals) that make it material: audit trail, never shown raw to the client. */
  because: string[];
  /** Premise guard: when this rule is true over the category's facts, the item does not apply. */
  unless?: Rule;
}

export interface MaterialOverlay { v: 1; items: MaterialItem[] }

export const emptyOverlay = (): MaterialOverlay => ({ v: 1, items: [] });

export function parseOverlay(fact: FactMap[string]): MaterialOverlay {
  const raw = fact && typeof fact.value === "object" && fact.value !== null ? (fact.value as Partial<MaterialOverlay>) : null;
  if (!raw || !Array.isArray(raw.items)) return emptyOverlay();
  const items: MaterialItem[] = [];
  for (const it of raw.items) {
    if (!it || typeof it !== "object" || typeof (it as MaterialItem).field !== "string") continue;
    const m = it as MaterialItem;
    items.push({
      field: m.field,
      ...(Array.isArray(m.subs) ? { subs: m.subs.filter((s): s is string => typeof s === "string") } : {}),
      because: Array.isArray(m.because) ? m.because.filter((s): s is string => typeof s === "string") : [],
      ...(m.unless ? { unless: m.unless } : {}),
    });
  }
  return { v: 1, items };
}

/** Active material items by field (premise-guarded items whose `unless` holds over the category's facts are dropped). Shared by the engine and the conversation. */
export function activeMaterial(facts: FactMap): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const it of parseOverlay(facts[MATERIAL_OVERLAY_KEY]).items) {
    if (it.unless && evaluateRule(it.unless, facts)) continue;
    const subs = out.get(it.field) ?? new Set<string>();
    for (const s of it.subs ?? []) subs.add(s);
    out.set(it.field, subs);
  }
  return out;
}
