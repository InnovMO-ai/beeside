import type { AnswerState, FactMap, FactView } from "../types";
import { bundledCatalog, bundledCategoryManifest, bundledProjectManifest, type CategoryManifestDoc } from "../bundled";

export const ALL_KEYS = ["logistics", "international_trade_customs", "people_payroll_employment", "corporate_legal_admin", "tax_accounting_audit", "strategic_advisory", "ecosystem_development", "_generic"] as const;
export const DEMO_KEYS = ["logistics", "international_trade_customs", "corporate_legal_admin", "strategic_advisory"] as const;

/** Deep copy of a bundled manifest (tests mutate freely). */
export function load(categoryKey: string): CategoryManifestDoc {
  const m = bundledCategoryManifest(categoryKey);
  if (!m) throw new Error(`no bundled manifest ${categoryKey}`);
  return JSON.parse(JSON.stringify(m)) as CategoryManifestDoc;
}
export const PM = (): ReturnType<typeof bundledProjectManifest> => JSON.parse(JSON.stringify(bundledProjectManifest()));
export const catalog = bundledCatalog();

export const A = (value: unknown, state: AnswerState = "ANSWERED"): FactView => ({ answerState: state, value });
export const NO = (): FactView => ({ answerState: "EXPLICIT_NO", value: false });
export const UNK = (): FactView => ({ answerState: "UNKNOWN", value: null });
export const WH = (): FactView => ({ answerState: "WITHHELD", value: null });
export const ZERO = (): FactView => ({ answerState: "ZERO", value: 0 });
export const facts = (o: Record<string, FactView | undefined>): FactMap => o;
export const wrap = (state: AnswerState, value: unknown = null): { answer_state: AnswerState; value: unknown } => ({ answer_state: state, value });
