/**
 * The briefing: what Precision UNDERSTOOD, in client language, ready to travel with My Service Map (Preview and Operation Hub).
 * Built from the frame — never from the conversation — so no question, greeting, fragment of a paragraph or "I don't know" can
 * leak. Three parts:
 *   - context: the client's situation in a few lines (why they are here, where, for how long)
 *   - facts: what is known, by dimension label ("Personal: 60 personas", "Facturación: 3 millones USD al año")
 *   - pending: what the client left open or said they did not know (honest knowledge, for the specialist)
 *   - findings: "Hallazgos para poner atención" — issues for a specialist to review; never a professional conclusion
 *
 * `briefingHygiene` is the gate (also used by the acceptance suite): nothing that reads as conversational debris passes.
 */
import { computeFindings, type FindingKnowledge } from "./findings";
import { PROBES } from "./probes";
import { countryName } from "./countries";
import type { Frame, Loc, Specialty } from "./types";

export interface BriefingFact { label: string; value: string }
export interface BriefingFinding { title: string; detail: string; specialty: Specialty | null }
export interface Briefing {
  context: string[];
  facts: BriefingFact[];
  pending: string[];
  findings: BriefingFinding[];
}

/** Items already shown elsewhere on the map (objective, start date) are not repeated. */
const SKIP = new Set(["project.objective", "project.timeframe", "project.why", "project.phases"]);
const ROLE: Record<string, Record<Loc, string>> = {
  origin: { es: "origen", en: "home country" },
  headquarters: { es: "casa matriz", en: "headquarters" },
  operation: { es: "operación", en: "operation" },
  sales: { es: "ventas", en: "sales" },
  process: { es: "proceso", en: "processing" },
  transit: { es: "tránsito", en: "transit" },
  support: { es: "apoyo", en: "support" },
};
const MAX = { line: 220, facts: 24, findings: 12 };

const clean = (s: string, n = MAX.line): string => s.replace(/\s+/g, " ").replace(/[*_`#>]/g, "").trim().slice(0, n);

export function buildBriefing(frame: Frame, now: string, knowledge: FindingKnowledge = {}): Briefing {
  const loc = frame.locale;
  const context: string[] = [];
  const why = frame.rationale.find((r) => r.subject === "project") ?? frame.rationale[0];
  if (why) context.push(clean(why.text));
  const dur = frame.items["project.duration"];
  if (dur?.status === "known") context.push(loc === "es" ? `Duración prevista: ${dur.display}.` : `Expected duration: ${dur.display}.`);
  const places = frame.countries.filter((c, i, a) => a.findIndex((x) => x.code === c.code && x.role === c.role) === i);
  if (places.length > 1) context.push(clean(places.map((c) => `${countryName(c.code, loc)} (${ROLE[c.role]?.[loc] ?? c.role})`).join(", ")));
  if (frame.phases.length > 0) context.push(clean(frame.phases.map((p) => p.label).join(" → ")));

  const facts: BriefingFact[] = [];
  const pending: string[] = [];
  for (const p of [...PROBES].sort((a, b) => a.order - b.order)) {
    if (SKIP.has(p.key)) continue;
    const it = frame.items[p.key];
    if (!it) continue;
    if (it.status === "known" && it.display.trim()) facts.push({ label: p.label[loc], value: clean(it.display, 160) });
    else if (it.status === "undecided") facts.push({ label: p.label[loc], value: loc === "es" ? "todavía por definir" : "still to be decided" });
    else if (it.status === "unknown" || it.status === "withheld") pending.push(p.label[loc]);
  }

  const findings = computeFindings(frame, now, knowledge)
    .filter((f) => f.status === "open")
    .slice(0, MAX.findings)
    .map((f) => ({ title: clean(f.title[loc], 160), detail: clean(f.detail[loc], 420), specialty: f.specialty ?? null }));

  return { context: context.filter(Boolean), facts: facts.slice(0, MAX.facts), pending: [...new Set(pending)], findings };
}

// ------------------------------------------------------------------ hygiene gate
const DEBRIS: { id: string; re: RegExp }[] = [
  { id: "question", re: /[¿?]/ },
  { id: "greeting", re: /^(?:hola|gracias|claro|entendido|perfecto|listo|ok\b|hello|thanks|thank you|sure|got it)/i },
  { id: "dont_know", re: /(?:todavía no lo sé|no lo sé|no tengo más detalle|i do not know|i don't know)/i },
  { id: "markdown", re: /(?:\*\*|__|^#{1,6}\s|^[-*]\s)/m },
  { id: "internal", re: /(?:\bfa4_|\bpa_|new:|_generic|\bfr:|\bn:disc|\bf:[a-z_]+|\bundefined\b|\bnull\b|\[object)/i },
  { id: "sherpa_early", re: /\bsherpa\b/i },
];

/** Reasons a briefing is not clean enough to travel. Empty = clean. */
export function briefingHygiene(b: Briefing): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const check = (where: string, text: string): void => {
    if (!text.trim()) out.push(`${where}: empty`);
    for (const d of DEBRIS) if (d.re.test(text)) out.push(`${where}: ${d.id}`);
    if (text.length > MAX.line * 2) out.push(`${where}: too_long`);
    const k = text.toLowerCase();
    if (seen.has(k)) out.push(`${where}: duplicate`);
    seen.add(k);
  };
  b.context.forEach((t, i) => check(`context[${i}]`, t));
  b.facts.forEach((f, i) => { check(`fact[${i}].label`, f.label); check(`fact[${i}].value`, f.value); });
  b.pending.forEach((t, i) => check(`pending[${i}]`, t));
  b.findings.forEach((f, i) => { check(`finding[${i}].title`, f.title); check(`finding[${i}].detail`, f.detail); });
  return out;
}

/** The briefing with every line that fails the gate dropped (a line is never "fixed" by guessing). */
export function sanitizeBriefing(b: Briefing): Briefing {
  const ok = (t: string): boolean => briefingHygiene({ context: [t], facts: [], pending: [], findings: [] }).length === 0;
  return {
    context: b.context.filter(ok),
    facts: b.facts.filter((f) => ok(f.label) && ok(f.value)),
    pending: b.pending.filter(ok),
    findings: b.findings.filter((f) => ok(f.title) && ok(f.detail)),
  };
}
