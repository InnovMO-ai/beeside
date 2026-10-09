/**
 * Fixture DATA for the scripted model provider, used by the demo route (docs/f5/demo-route.md).
 *
 * History: the provider's built-in heuristics used to write the country named for "origin country" into "destination country"
 * as well ("Chile to Chile"). That is fixed in the provider itself (it now reads one answer for one field and tells the two ends
 * of a lane apart), and a test plays the route without this fixture. The fixture stays as a stricter, explicit script for the
 * lane step: it reads a lane answer ONLY for the field being asked and leaves the rest alone.
 *
 * It is script/fixture, not product behaviour: the real model reads the same text with its own judgement, and nothing here
 * is imported by product code. Pass it to the scripted provider (`new ScriptedModelProvider({ fixture })` or
 * `selectModelProvider({ fixture })`). Spanish and English utterances are both understood.
 */
import type { ExtractRequest, ExtractedValue } from "../../conversation/ports";
import type { ScriptedFixture } from "../../conversation/providers/scripted-model";

const COUNTRIES: Record<string, string> = {
  mexico: "MX", chile: "CL", "estados unidos": "US", "united states": "US", canada: "CA", colombia: "CO", peru: "PE", argentina: "AR",
  brasil: "BR", brazil: "BR", espana: "ES", spain: "ES", china: "CN", panama: "PA",
};

const norm = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const has = (text: string, needle: string): boolean => needle.length > 0 && new RegExp(`(?:^|\\s)${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\s|$)`).test(text);
const notFound = (name: string): ExtractedValue => ({ name, status: "not_found", value: null, confidence: null, source: null });
const found = (name: string, value: ExtractedValue["value"], source: string): ExtractedValue => ({ name, status: "ok", value, confidence: 0.95, source });

/** Lane answers: only the asked field is read from countries and free text; quantities and options are read wherever they appear. */
function extractLaneAnswer(req: ExtractRequest): ExtractedValue[] {
  const text = req.clientText.trim();
  const n = norm(text);
  return req.specs.map((spec): ExtractedValue => {
    if (spec.type === "multi_enum" && /ISO 3166/.test(spec.description)) {
      if (!spec.isTarget) return notFound(spec.name);
      const hit = Object.keys(COUNTRIES).filter((c) => has(n, c)).sort((a, b) => b.length - a.length)[0];
      return hit ? found(spec.name, [COUNTRIES[hit] as string], hit) : notFound(spec.name);
    }
    if (spec.type === "string") return spec.isTarget && text ? found(spec.name, text.slice(0, 600), text.slice(0, 600)) : notFound(spec.name);
    if (spec.type === "number") {
      const m = text.match(/(?<![\d.])\d+(?:[.,]\d+)?/);
      return m ? found(spec.name, Number(m[0].replace(",", ".")), m[0]) : notFound(spec.name);
    }
    if (spec.type === "enum") {
      const hit = (spec.enumValues ?? []).find((v) => has(n, norm(spec.enumLabels?.[v] ?? v)) || has(n, norm(v)));
      return hit ? found(spec.name, hit, norm(spec.enumLabels?.[hit] ?? hit)) : notFound(spec.name);
    }
    return notFound(spec.name);
  });
}

export const DEMO_SCRIPT_FIXTURE: ScriptedFixture = {
  // key: `${surface}:${step}`; the step of a lane answer is the field that holds the lanes
  "category:logistics_flows": { extract: extractLaneAnswer },
};
