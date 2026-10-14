import type { OhHandoffPayload } from "./operation-hub";

/**
 * Payload hygiene lint — what must never appear in the TEXT that travels to Operation Hub: conversational debris (questions, assistant
 * phrasing, chat role prefixes, code fences), model/system leftovers (placeholders, "undefined", internal markers and keys) and any
 * platform or vendor name. Structural fields (ids, contract, provenance) are skipped.
 *
 * It is a pure check, used by tests over realistic flows and available to QA / Admin diagnostics. It never rewrites content: the payload
 * builder already sanitises; this proves the result is clean and makes a regression loud.
 */
const SKIP = new Set(["contract", "identity", "provenance", "crp_id", "crp_artifact_id", "workstream_id", "category_key", "crp_kind", "language", "state", "priority", "kind"]);

const RULES: Array<[string, RegExp]> = [
  ["question mark", /[?¿]/],
  ["assistant phrasing", /\b(as an ai|i'?m (?:an? )?(?:ai|assistant|language model)|let me know|i (?:can|will) help|great question|buena pregunta|por supuesto|entendido,|claro que s[ií]|thanks for|gracias por (?:compartir|la informaci))/i],
  ["chat role prefix", /^\s*(assistant|user|client|cliente|asistente|system|sherpa)\s*:/im],
  ["code fence / markup", /```|<\/?[a-z][^>]*>/i],
  ["placeholder or empty literal", /\b(undefined|null|NaN|lorem ipsum|TBD|TODO|N\/A)\b|\[object|\{\{|\}\}|<[A-Z_]+>/],
  ["internal marker or key", /\b(MOCK|STUB|SIMULATOR|SIMULATED|CONTEXT_ONLY|CCIR|BV\d{3}|FA4)\b|precision\.|new:|\b[a-z]+_[a-z]+_[a-z_]+\b/],
  ["platform or vendor name", /\b(clickup|click up|stripe|anthropic|claude|openai|operation hub)\b/i],
  ["e-mail address", /[^\s@]+@[^\s@]+\.[^\s@]+/],
];

export interface HygieneFinding { path: string; rule: string; match: string }

/**
 * Item labels and titles are authored manifest content (the approved requirement wording, which may be phrased as the question it answers).
 * They are checked for everything except the question mark; client-derived text (values, entries, context, pending) is checked for all.
 */
const AUTHORED = /\.(label|title|category_label)$/;

function walk(value: unknown, path: string, out: HygieneFinding[]): void {
  if (typeof value === "string") {
    for (const [rule, re] of RULES) {
      if (rule === "question mark" && AUTHORED.test(path)) continue;
      const m = re.exec(value);
      if (m) out.push({ path, rule, match: m[0].slice(0, 40) });
    }
  } else if (Array.isArray(value)) {
    value.forEach((v, i) => walk(v, `${path}[${i}]`, out));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) if (!SKIP.has(k)) walk(v, `${path}.${k}`, out);
  }
}

export function payloadHygiene(payload: OhHandoffPayload): HygieneFinding[] {
  const out: HygieneFinding[] = [];
  walk(payload.company_context, "company_context", out);
  walk(payload.project_context, "project_context", out);
  walk(payload.workstream, "workstream", out);
  walk(payload.artifact.structured, "artifact.structured", out);
  return out;
}
