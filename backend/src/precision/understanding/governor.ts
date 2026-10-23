/**
 * The governor: "the AI understands, the product decides". Whatever an interpreter returns (rules or model) is checked here before
 * any of it can become knowledge:
 *  - every observation names a known probe and carries a quote that REALLY occurs in the client's text (Discovery text counts as the
 *    source for Discovery-seeded observations);
 *  - implicit inferences are demoted to proposals and never count for sufficiency;
 *  - values are sanity-checked (no 40,000 employees from a typo'd "40 000 000");
 *  - concepts and countries must exist in the vocabulary; free strings are cleaned and bounded.
 * Anything rejected is returned (never silently dropped) so tests and telemetry can see what the interpreter tried.
 */
import { countryByCode } from "./countries";
import { conceptById } from "./concepts";
import type { Interpretation, Observation } from "./interpreter";
import { probeByKey } from "./probes";
import { quoteInText, squash } from "./text";

export interface Rejection { what: string; reason: string }
export interface Governed { interpretation: Interpretation; rejected: Rejection[] }

// eslint-disable-next-line no-control-regex -- strips control characters on purpose
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g;
export const cleanDisplay = (s: string, max = 160): string => squash(String(s ?? "").replace(CONTROL, " ").replace(/[<>]/g, "")).slice(0, max);

function sane(key: string, value: unknown): boolean {
  const v = value as Record<string, unknown> | null;
  const nonNeg = (n: unknown): boolean => typeof n === "number" && Number.isFinite(n) && n >= 0;
  switch (key) {
    case "workforce.headcount": return Boolean(v) && nonNeg(v!.min) && nonNeg(v!.max) && (v!.max as number) <= 200_000 && (v!.min as number) <= (v!.max as number);
    case "scale.suppliers": return Boolean(v) && nonNeg(v!.min) && nonNeg(v!.max) && (v!.max as number) <= 1_000_000;
    case "project.duration": return Boolean(v) && nonNeg(v!.minMonths) && nonNeg(v!.maxMonths) && (v!.maxMonths as number) <= 600 && (v!.minMonths as number) <= (v!.maxMonths as number);
    case "scale.revenue": return Boolean(v) && nonNeg(v!.min) && nonNeg(v!.max) && (v!.max as number) <= 1e13;
    default: return value !== undefined;
  }
}

export interface GovernInput { text: string; source: "client" | "discovery" }

export function govern(raw: Interpretation, input: GovernInput): Governed {
  const rejected: Rejection[] = [];
  const text = input.text;
  const quoteOk = (q: string): boolean => (q ? quoteInText(q, text) : false);
  const out: Interpretation = { ...raw, observations: [], concepts: [], needs: [], countries: [], phases: [], rationale: [], priorities: [] };

  for (const o of raw.observations) {
    if (!probeByKey(o.key)) { rejected.push({ what: o.key, reason: "unknown_probe" }); continue; }
    if (o.interpretive !== "implicit" && !quoteOk(o.quote)) { rejected.push({ what: o.key, reason: "quote_not_in_text" }); continue; }
    if (!sane(o.key, o.value)) { rejected.push({ what: o.key, reason: "implausible_value" }); continue; }
    const g: Observation = { ...o, display: cleanDisplay(o.display), quote: cleanDisplay(o.quote, 240) };
    if (o.interpretive === "implicit") g.status = "proposed";
    if (typeof g.confidence === "number") g.confidence = Math.max(0, Math.min(1, g.confidence));
    out.observations.push(g);
  }

  const seenConcept = new Set<string>();
  for (const c of raw.concepts) {
    if (!conceptById(c.id)) { rejected.push({ what: c.id, reason: "unknown_concept" }); continue; }
    if (seenConcept.has(c.id)) continue;
    seenConcept.add(c.id);
    out.concepts.push({ id: c.id, quote: cleanDisplay(c.quote, 240) });
  }

  for (const n of raw.needs) {
    const ids = n.conceptIds.filter((id) => conceptById(id));
    if (n.conceptIds.length > 0 && ids.length === 0) { rejected.push({ what: n.text, reason: "unknown_concept" }); continue; }
    if (!quoteOk(n.quote) && n.quote) { rejected.push({ what: n.text, reason: "quote_not_in_text" }); continue; }
    out.needs.push({ ...n, text: cleanDisplay(n.text, 140), conceptIds: ids, quote: cleanDisplay(n.quote, 240) });
  }

  for (const c of raw.countries) {
    if (!countryByCode(c.code)) { rejected.push({ what: c.code, reason: "unknown_country" }); continue; }
    if (c.quote && !quoteOk(c.quote)) { rejected.push({ what: c.code, reason: "quote_not_in_text" }); continue; }
    out.countries.push({ ...c, code: c.code.toUpperCase(), quote: cleanDisplay(c.quote, 240) });
  }

  for (const p of raw.phases) {
    const codes = p.countries.filter((c) => countryByCode(c));
    if (codes.length === 0) { rejected.push({ what: p.label, reason: "unknown_country" }); continue; }
    out.phases.push({ ...p, label: cleanDisplay(p.label, 80), countries: codes.map((c) => c.toUpperCase()), quote: cleanDisplay(p.quote, 240) });
  }

  for (const r of raw.rationale) {
    if (!quoteOk(r.quote)) { rejected.push({ what: r.subject, reason: "quote_not_in_text" }); continue; }
    out.rationale.push({ subject: cleanDisplay(r.subject, 60), text: cleanDisplay(r.text, 240), quote: cleanDisplay(r.quote, 240) });
  }

  for (const p of raw.priorities) {
    const subjects = p.subjects.filter((s) => conceptById(s));
    if (subjects.length === 0) { rejected.push({ what: p.quote, reason: "priority_without_known_subject" }); continue; }
    if (!quoteOk(p.quote)) { rejected.push({ what: p.quote, reason: "quote_not_in_text" }); continue; }
    out.priorities.push({ ...p, subjects, quote: cleanDisplay(p.quote, 240), ...(p.reason ? { reason: cleanDisplay(p.reason, 200) } : {}), ...(p.timing ? { timing: cleanDisplay(p.timing, 60) } : {}) });
  }

  if (raw.question) out.question = cleanDisplay(raw.question, 400);
  return { interpretation: out, rejected };
}
