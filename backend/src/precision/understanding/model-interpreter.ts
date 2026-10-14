/**
 * Model-backed interpreter. The model READS; it never decides.
 *   - the request carries only the client's words, the question they answered, and the allowed vocabulary (aspect keys, concept ids);
 *   - the answer is untrusted JSON: coerced field by field (anything malformed is dropped), then the GOVERNOR (step.ts) verifies every
 *     quote against the client's text and every value for plausibility, and the frame reducer decides what becomes knowledge;
 *   - the rule interpreter always runs too: what the model did not find, the rules add; if the model is unavailable or answers
 *     nonsense, the rules answer alone and the conversation goes on (a model outage never loses a turn nor blocks Understanding).
 */
import { ModelUnavailableError, type ModelProvider } from "../conversation/ports";
import { CONCEPTS } from "./concepts";
import { emptyInterpretation, interpretByRules, type Interpretation, type Intent } from "./interpreter";
import { PROBES } from "./probes";
import type { UnderstandingInterpreter, InterpretRequest as EngineInterpretRequest } from "./engine";
import type { CountryRole, Interpretive, NeedResolution, PriorityRank } from "./types";

const INTENTS = new Set<Intent>(["answer", "unknown", "withheld", "undecided", "done", "question", "add_service", "unclear", "affirm", "deny"]);
const ROLES = new Set<CountryRole>(["origin", "process", "sales", "operation", "transit", "support", "headquarters", "unspecified"]);
const RESOLUTIONS = new Set<NeedResolution>(["resolved", "ambiguous", "unresolved", "outcome", "compound"]);
const RANKS = new Set<PriorityRank>(["top", "important", "can_wait"]);
const INTERPRETIVE = new Set<Interpretive>(["observed", "understood", "implicit"]);

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown, max = 400): string => (typeof v === "string" ? v.slice(0, max) : "");

/** Defensive parse of the model's JSON into the Interpretation shape. Never throws; unknown or malformed parts are dropped. */
export function coerceInterpretation(json: unknown): Interpretation | null {
  const o = obj(json);
  if (Object.keys(o).length === 0) return null;
  const out = emptyInterpretation("model");
  if (typeof o.intent === "string" && INTENTS.has(o.intent as Intent)) out.intent = o.intent as Intent;
  out.correction = o.correction === true;
  for (const x of arr(o.observations).slice(0, 30)) {
    const e = obj(x);
    const key = str(e.key, 80);
    const quote = str(e.quote, 300);
    if (!key || !("value" in e)) continue;
    const interpretive = INTERPRETIVE.has(e.interpretive as Interpretive) ? (e.interpretive as Interpretive) : "understood";
    out.observations.push({ key, value: e.value, display: str(e.display, 240) || String(e.value ?? "").slice(0, 240), quote, interpretive, ...(typeof e.confidence === "number" ? { confidence: e.confidence } : {}) });
  }
  for (const x of arr(o.concepts).slice(0, 30)) { const e = obj(x); if (str(e.id, 60)) out.concepts.push({ id: str(e.id, 60), quote: str(e.quote, 300) }); }
  for (const x of arr(o.needs).slice(0, 20)) {
    const e = obj(x);
    const text = str(e.text, 140);
    if (!text) continue;
    out.needs.push({ text, conceptIds: arr(e.conceptIds).filter((c): c is string => typeof c === "string").slice(0, 6), quote: str(e.quote, 300), resolution: RESOLUTIONS.has(e.resolution as NeedResolution) ? (e.resolution as NeedResolution) : "unresolved" });
  }
  for (const x of arr(o.countries).slice(0, 12)) {
    const e = obj(x);
    const code = str(e.code, 2).toUpperCase();
    if (!/^[A-Z]{2}$/.test(code)) continue;
    out.countries.push({ code, role: ROLES.has(e.role as CountryRole) ? (e.role as CountryRole) : "unspecified", quote: str(e.quote, 300) });
  }
  for (const x of arr(o.rationale).slice(0, 4)) { const e = obj(x); const text = str(e.text, 240); if (text) out.rationale.push({ subject: str(e.subject, 40) || "project", text, quote: str(e.quote, 300) }); }
  for (const x of arr(o.priorities).slice(0, 6)) {
    const e = obj(x);
    const subjects = arr(e.subjects).filter((s): s is string => typeof s === "string").slice(0, 8);
    if (subjects.length === 0 || !RANKS.has(e.rank as PriorityRank)) continue;
    out.priorities.push({ subjects, rank: e.rank as PriorityRank, quote: str(e.quote, 300), ...(str(e.reason, 200) ? { reason: str(e.reason, 200) } : {}) });
  }
  out.question = str(o.question, 300) || null;
  return out;
}

/** The model's reading completed by the rule baseline: the model wins where both speak, the rules fill what it did not find. */
export function mergeInterpretations(model: Interpretation, rules: Interpretation): Interpretation {
  const has = new Set(model.observations.map((o) => o.key));
  const needKey = (n: { conceptIds: string[]; text: string }): string => (n.conceptIds[0] ?? n.text.toLowerCase());
  const needs = [...model.needs];
  for (const n of rules.needs) if (!needs.some((m) => needKey(m) === needKey(n))) needs.push(n);
  const countries = [...model.countries];
  for (const c of rules.countries) if (!countries.some((m) => m.code === c.code && m.role === c.role)) countries.push(c);
  const concepts = [...model.concepts];
  for (const c of rules.concepts) if (!concepts.some((m) => m.id === c.id)) concepts.push(c);
  return {
    ...model,
    intent: model.intent === "unclear" ? rules.intent : model.intent,
    correction: model.correction || rules.correction,
    observations: [...model.observations, ...rules.observations.filter((o) => !has.has(o.key))],
    concepts,
    needs,
    countries,
    phases: model.phases.length > 0 ? model.phases : rules.phases,
    rationale: model.rationale.length > 0 ? model.rationale : rules.rationale,
    priorities: model.priorities.length > 0 ? model.priorities : rules.priorities,
    question: model.question ?? rules.question,
    answerState: model.answerState ?? rules.answerState,
    yesNo: model.yesNo ?? rules.yesNo,
  };
}

export interface ModelInterpreterOptions {
  provider: ModelProvider;
  timeoutMs?: number;
  /** Called (never with the client's text) when the model could not be used. */
  onFallback?: (reason: "unavailable" | "unreadable") => void;
}

export function createModelInterpreter(opts: ModelInterpreterOptions): UnderstandingInterpreter {
  const probeKeys = PROBES.map((p) => p.key);
  const conceptIds = CONCEPTS.map((c) => c.id);
  return {
    async interpret(r: EngineInterpretRequest): Promise<Interpretation> {
      const rules = interpretByRules({ text: r.text, locale: r.locale, frame: r.frame, asked: r.asked, source: "client" });
      try {
        const res = await opts.provider.complete({
          task: "interpret", surface: "understanding", step: "interpret", locale: r.locale, turnKey: r.turnKey, clientText: r.text, question: r.asked,
          probeKeys, conceptIds, timeoutMs: opts.timeoutMs ?? 8000,
        });
        const model = coerceInterpretation(res.json);
        if (!model) { opts.onFallback?.("unreadable"); return rules; }
        return mergeInterpretations(model, rules);
      } catch (err) {
        if (err instanceof ModelUnavailableError) { opts.onFallback?.("unavailable"); return rules; }
        opts.onFallback?.("unreadable");
        return rules;
      }
    },
  };
}
