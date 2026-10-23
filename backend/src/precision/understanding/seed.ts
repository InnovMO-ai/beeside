/**
 * Discovery -> Understanding seed.
 *
 *   "DISCOVERY DOES NOT COMPLETE UNDERSTANDING. But PRECISION MUST KNOW AND USE WHAT DISCOVERY ALREADY KNOWS."
 *
 * Discovery's content is the starting hypothesis. It is read ONCE into the project frame as `discovery`-provenance knowledge (its
 * structured fields and its free text, interpreted with the same governed interpreter as the client's words), so that:
 *  - what Discovery established is used from the first turn and never asked again (if Discovery says the product is coffee,
 *    Precision does not ask what product is being moved) — unless the client contradicts it, it changed, or it is ambiguous/stale;
 *  - Precision deepens it with the dimensions Discovery never covers.
 * How Discovery represents the information (inherited context, source facts, pre-facts) is irrelevant to this behaviour.
 */
import { govern } from "./governor";
import { applyInterpretation } from "./frame";
import { detectConcepts, interpretByRules, type Interpretation } from "./interpreter";
import { fold, squash } from "./text";
import { conceptById } from "./concepts";
import { emptyFrame, type Frame, type Loc, type NeedItem } from "./types";

export interface DiscoverySeedInput {
  pinId?: string | null;
  locale: Loc;
  destinationCodes: string[];
  destinationMarket?: string;
  sector?: string;
  objective?: string;
  timeframe?: string;
  /** Countries where the company operates today (origin side). */
  operatingCountries?: string[];
  needs?: { capabilityId: string; label: string; priority?: string; status?: string }[];
  /** Free text the client wrote in Discovery (untrusted). */
  literals?: { motive?: string; context?: string };
}

export interface SeedResult { frame: Frame; interpretations: Interpretation[] }

export function seedFromDiscovery(input: DiscoverySeedInput, now: string): SeedResult {
  let frame = emptyFrame(input.locale);
  frame.discoveryPinId = input.pinId ?? null;
  const interpretations: Interpretation[] = [];
  const ref = (path: string): { sourcePinId?: string; sourceItemRef: string } => ({ ...(input.pinId ? { sourcePinId: input.pinId } : {}), sourceItemRef: path });
  const item = (key: string, display: string, value: unknown, path: string): void => {
    if (!display) return;
    frame.items[key] = { key, value, display: squash(display).slice(0, 240), status: "known", provenance: "discovery", interpretive: "observed", quote: squash(display).slice(0, 240), at: now, ...ref(path) };
  };

  // Structured fields
  for (const code of input.destinationCodes) {
    if (!frame.countries.some((c) => c.code === code && c.role === "operation")) frame.countries.push({ code: code.toUpperCase(), role: "operation", provenance: "discovery", sourceItemRef: "project.destinationCountry", at: now });
  }
  for (const code of input.operatingCountries ?? []) {
    if (!frame.countries.some((c) => c.code === code.toUpperCase())) frame.countries.push({ code: code.toUpperCase(), role: "origin", provenance: "discovery", sourceItemRef: "company.operatingCountries", at: now });
  }
  if (input.objective) item("project.objective", input.objective, input.objective, "project.expansionObjective");
  if (input.timeframe) item("project.timeframe", input.timeframe, input.timeframe, "project.timeframe");
  if (input.sector) item("company.sector", input.sector, input.sector, "project.sector");
  if (input.destinationMarket) item("project.market", input.destinationMarket, input.destinationMarket, "project.destinationMarket");

  // Needs (catalog capabilities Discovery determined): known, never re-asked
  for (const n of input.needs ?? []) {
    const f = fold(n.label);
    const { hits } = detectConcepts(n.label, f);
    const concepts = hits.filter((h) => conceptById(h.id)?.kind === "need").map((h) => h.id);
    for (const h of hits) if (!frame.concepts[h.id]) frame.concepts[h.id] = { first: squash(n.label), origin: "discovery" };
    const def = concepts[0] ? conceptById(concepts[0]) : undefined;
    const need: NeedItem = {
      id: `n:disc:${n.capabilityId}`, text: squash(n.label).slice(0, 140), conceptIds: concepts, resolution: "resolved",
      categoryKey: def?.category ?? null, serviceKeys: [n.capabilityId], status: "proposed", origin: "discovery", quote: squash(n.label).slice(0, 140), at: now,
    };
    if (!frame.needs.some((x) => x.id === need.id)) frame.needs.push(need);
    if (n.priority) frame.notes.push({ text: `Discovery: ${n.label} (prioridad en Discovery: ${n.priority})`.slice(0, 220), at: now });
  }

  // Free text: the objective and the client's literals, interpreted like any other client text but with Discovery provenance
  const texts: { text: string; path: string }[] = [
    ...(input.objective ? [{ text: input.objective, path: "project.expansionObjective" }] : []),
    ...(input.literals?.motive ? [{ text: input.literals.motive, path: "literals.motive" }] : []),
    ...(input.literals?.context ? [{ text: input.literals.context, path: "literals.context" }] : []),
    ...(input.sector ? [{ text: input.sector, path: "project.sector" }] : []),
  ];
  for (const t of texts) {
    const raw = interpretByRules({ text: t.text, locale: input.locale, frame, asked: null, source: "discovery" });
    const { interpretation } = govern(raw, { text: t.text, source: "discovery" });
    interpretations.push(interpretation);
    // The destination countries come from structured data; free text only adds roles it states (origin/headquarters/sales/transit).
    interpretation.countries = interpretation.countries.filter((c) => !(c.role === "operation" && frame.countries.some((x) => x.role === "operation" && x.code !== c.code) && input.destinationCodes.length > 0 && !input.destinationCodes.includes(c.code)));
    const applied = applyInterpretation(frame, interpretation, { now, source: "discovery", asked: null, text: t.text, ...ref(t.path) });
    frame = applied.frame;
    // Free text feeds facts, observations, rationale and countries — it never creates a service need. Discovery's structured capabilities
    // (`n:disc:*`) are its needs; a sentence the client wrote ("what the company does", "why the project exists") is not a service label, and
    // putting it on My Service Map would show the client their own sentence as if it were a service. What the text implies the client still
    // confirms in the conversation (the concepts it mentioned stay known, so the implied-need offer can name them properly).
    frame.needs = frame.needs.filter((n) => n.id.startsWith("n:disc:") || n.origin !== "discovery");
  }
  frame.version = 1;
  return { frame, interpretations };
}
