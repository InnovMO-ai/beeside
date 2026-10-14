import type { OhHandoffPayload } from "./operation-hub";

/**
 * Payload hygiene lint — what must never appear in the TEXT that travels to Operation Hub.
 *
 * Text in the payload comes from three different places and the lint treats them differently:
 *
 *   A. APPROVED CANONICAL PRODUCT CONTENT — manifest titles, requirement labels (which may well be written as the question they answer, in
 *      the second person), pending-item labels, "required later" lines, category labels. This is approved wording: it is NEVER judged for
 *      tone, question marks or interrogative phrasing, and it is never "cleaned" to satisfy the lint. It is only checked for leaks.
 *   B. CUSTOMER FACT VALUES — what the client said, normalised: values, entries, context lines, Service Map items, objective, destinations…
 *      These are checked for LEAKS and for CONVERSATIONAL / META RESIDUE.
 *   C. CONVERSATIONAL / META RESIDUE — "café, ya te lo había dicho", "no te he dicho eso", "quiero agregar más servicios", frustration or
 *      comments aimed at the assistant, assistant instructions, raw transcript fragments, unresolved markers. Never a legitimate fact value.
 *
 * LEAKS (every class): internal markers/keys, vendor or platform names, e-mail addresses, placeholders, markup/code fences.
 * A question mark or a second-person phrase is NOT residue by itself, in either class.
 *
 * Pure check; it never rewrites content. Used by tests over realistic flows and available to QA / Admin diagnostics.
 */
const SKIP = new Set(["contract", "identity", "provenance", "crp_id", "crp_artifact_id", "workstream_id", "category_key", "crp_kind", "language", "state", "priority", "kind"]);

const LEAK_RULES: Array<[string, RegExp]> = [
  ["code fence / markup", /```|<\/?[a-z][^>]*>/i],
  ["placeholder or empty literal", /\b(undefined|null|NaN|lorem ipsum)\b|\[object|\{\{|\}\}|<[A-Z_]+>/],
  ["internal marker or key", /\b(MOCK|STUB|SIMULATOR|SIMULATED|CONTEXT_ONLY|CCIR|BV\d{3}|FA4)\b|precision\.|new:|\b[a-z]+_[a-z]+_[a-z_]+\b/],
  ["platform or vendor name", /\b(clickup|click up|stripe|anthropic|claude|openai|operation hub)\b/i],
  ["e-mail address", /[^\s@]+@[^\s@]+\.[^\s@]+/],
];

/** Class C: only ever applied to customer fact values (class B). */
const RESIDUE_RULES: Array<[string, RegExp]> = [
  ["meta-comment to the assistant", /\b(ya te (?:lo )?(?:dije|había dicho|habia dicho|comenté|comente|mencioné|mencione)|te lo (?:dije|había dicho|habia dicho)|no te he dicho|ya (?:lo )?(?:dije|mencioné|mencione|respondí|respondi)|como (?:te )?(?:dije|comenté)|i (?:already|just) (?:told|said|mentioned)|as i (?:said|told|mentioned)|i never said|i didn'?t say that|you (?:already|just|keep) (?:asked|asking|said))\b/i],
  ["request aimed at the assistant", /\b(?:quiero|quisiera|necesito|me gustar[ií]a)\s+(?:agregar|añadir|anadir|otro servicio|más servicios|mas servicios|cambiar lo|volver)|\b(?:i want to|i'?d like to|can you|could you)\s+(?:add|change|go back|remove)|\b(?:puedes|podr[ií]as|puedes por favor)\s+(?:agregar|añadir|cambiar)/i],
  ["frustration or confusion", /\b(no entiendo (?:la pregunta|por qu[eé])|otra vez (?:lo mismo|la misma)|i don'?t understand (?:the question|why)|not again|you keep asking|ya te respond[ií]|why do you keep)\b/i],
  ["assistant phrasing or instruction", /\b(as an ai|i'?m (?:an? )?(?:ai|assistant|language model)|let me know|i (?:can|will) help|great question|buena pregunta|ask the (?:client|user|customer)|tell the (?:client|user|customer)|pregunta(?:le)? al cliente|responde (?:al|con)|dime si|av[ií]same)\b/i],
  ["transcript fragment", /^\s*(assistant|user|client|cliente|asistente|system|sherpa)\s*:|\[(?:client|assistant|user|system|cliente|asistente)\]|^\s*>\s/im],
  ["unresolved marker", /\?\?+|\b(TBD|TODO|XXX|FIXME)\b/],
];

type Class = "canonical" | "customer";

/** Approved manifest / canonical wording inside artifact.structured and the workstream. Everything else that is text is customer-derived. */
const CANONICAL_PATHS: RegExp[] = [
  /^workstream\.category_label$/,
  /^artifact\.structured\.title$/,
  /^artifact\.structured\.sections\[\d+\]\.title$/,
  /^artifact\.structured\.sections\[\d+\]\.items\[\d+\]\.label$/,
  /^artifact\.structured\.sections\[\d+\]\.items\[\d+\]\.missing\[\d+\]$/,
  /^artifact\.structured\.pending\[\d+\]\.label$/,
  /^artifact\.structured\.pending\[\d+\]\.missing\[\d+\]$/,
  /^artifact\.structured\.required_later\[\d+\]$/,
  /^project_context\.psm\.categories\[\d+\]\.category_label$/,
];

export function classifyPath(path: string): Class {
  return CANONICAL_PATHS.some((re) => re.test(path)) ? "canonical" : "customer";
}

export interface HygieneFinding { path: string; rule: string; match: string; class: "leak" | "residue" }

function walk(value: unknown, path: string, out: HygieneFinding[]): void {
  if (typeof value === "string") {
    for (const [rule, re] of LEAK_RULES) {
      const m = re.exec(value);
      if (m) out.push({ path, rule, match: m[0].slice(0, 40), class: "leak" });
    }
    if (classifyPath(path) === "customer") {
      for (const [rule, re] of RESIDUE_RULES) {
        const m = re.exec(value);
        if (m) out.push({ path, rule, match: m[0].slice(0, 40), class: "residue" });
      }
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
