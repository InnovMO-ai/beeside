/**
 * "Lo que ya sé de esta parte de tu proyecto" — the compact category panel. Three or four short lines in the client's language that say what
 * the project already established for THIS category, so the category reads as the continuation of the conversation (Discovery -> Understanding
 * -> Category) and the client can see, and correct, what the product is relying on.
 *
 * Derived only from canonical known facts (the Project Frame: probes the client answered or confirmed, material signals derived from them,
 * and the cross-cutting facts they stated) — never from an AI proposal, never from technical state (no percentages, no field names). It is not
 * a summary and not a checklist. Pure and deterministic.
 */
import { crossCuttingFor } from "./cross-cutting";
import { knownLines } from "./category-readiness";
import { materialSignals, type SignalKey } from "./material-signals";
import { fold } from "./text";
import type { Frame, Loc } from "./types";

export interface KnowsLine { id: string; text: string; /** What the composer is prefilled with when the client chooses to correct this line. */ correctPrompt: string }
export interface KnowsPanel { heading: string; hint: string; correctLabel: string; lines: KnowsLine[] }

const COPY = {
  heading: { es: "Lo que ya sé de esta parte de tu proyecto", en: "What I already know about this part of your project" },
  hint: { es: "Si algo no es así, corrígelo y lo ajusto.", en: "If something is not right, correct it and I will adjust." },
  correct: { es: "Corregir", en: "Correct" },
  prefix: { es: "Corrijo lo de", en: "Correction on" },
} as const;

/** Signals worth saying out loud in a category (the ones that shape what it asks), in priority order. */
const LEAD: ReadonlyArray<{ key: SignalKey; categories: readonly string[] | "all" }> = [
  { key: "foreign_parent", categories: ["tax_accounting_audit", "corporate_legal_admin", "banking_finance_insurance", "people_payroll_employment", "international_trade_customs"] },
  { key: "existing_presence", categories: ["corporate_legal_admin", "tax_accounting_audit", "people_payroll_employment"] },
  { key: "partners", categories: ["corporate_legal_admin", "tax_accounting_audit"] },
];

const clip = (t: string, n = 90): string => (t.length <= n ? t : `${t.slice(0, n).replace(/\s+\S*$/, "").trimEnd()}…`);
const sentence = (t: string): string => { const s = t.trim(); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; };

export function knowsPanel(frame: Frame, categoryKey: string, max = 4): KnowsPanel | null {
  const loc: Loc = frame.locale;
  const signals = materialSignals(frame);
  const raw: { id: string; text: string }[] = [];
  for (const l of LEAD) {
    if (l.categories !== "all" && !l.categories.includes(categoryKey)) continue;
    const s = signals.find((x) => x.key === l.key);
    if (s) raw.push({ id: `signal:${s.key}`, text: s.text[loc] });
  }
  for (const line of knownLines(frame, categoryKey, max)) raw.push({ id: `known:${fold(line).slice(0, 24)}`, text: line });
  for (const x of crossCuttingFor(frame, categoryKey)) raw.push({ id: x.id, text: x.quote });

  const seen: string[] = [];
  const lines: KnowsLine[] = [];
  for (const r of raw) {
    const text = sentence(clip(r.text.replace(/\s+/g, " ").replace(/[?¿]/g, "")));
    const key = fold(text).replace(/[^a-z0-9 ]/g, "");
    // the same fact said twice (a signal and the probe that produced it) is one line
    if (!key || seen.some((s) => s === key || s.includes(key) || key.includes(s))) continue;
    seen.push(key);
    lines.push({ id: r.id, text, correctPrompt: `${COPY.prefix[loc]} «${text.replace(/[.…]+$/, "")}»: ` });
    if (lines.length >= max) break;
  }
  if (lines.length === 0) return null;
  return { heading: COPY.heading[loc], hint: COPY.hint[loc], correctLabel: COPY.correct[loc], lines };
}
