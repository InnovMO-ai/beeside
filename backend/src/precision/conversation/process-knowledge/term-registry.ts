/**
 * Term registry (Process Knowledge L-5, decisions D-9 / D-10).
 *
 *  - Canonical names are English and are never translated.
 *  - First relevant mention is FULL NAME (ACRONYM); afterwards the acronym only when a public acronym exists
 *    (today only CRP). Every other term is always written in full.
 *  - Internal acronyms and labels are never shown to the client.
 */

export interface TermEntry {
  id: string;
  canonical: string;
  /** Public acronym approved for use after the first mention. Today only CRP. */
  publicAcronym?: string;
}

export const TERM_REGISTRY: readonly TermEntry[] = [
  { id: "precision_center", canonical: "Precision Center" },
  { id: "precision_understanding", canonical: "Precision Understanding" },
  { id: "my_service_map", canonical: "My Service Map" },
  { id: "precision_by_category", canonical: "Precision by Category" },
  { id: "crp", canonical: "Category Requirement Pack", publicAcronym: "CRP" },
  { id: "add_a_service", canonical: "Add a Service" },
  { id: "operation_hub", canonical: "Operation Hub" },
  { id: "sherpa", canonical: "Sherpa" },
  { id: "first_assessment", canonical: "First Assessment" },
  { id: "the_hive", canonical: "The Hive" },
];

/** First-mention spelling of the only public acronym. */
export const CRP_FULL = "Category Requirement Pack (CRP)";
export const CRP_SHORT = "CRP";
export const CRP_TOKEN = "{crp}";

export interface ForbiddenTerm {
  id: string;
  pattern: RegExp;
  reason: string;
}

/**
 * Terms that must never reach a customer surface (Track A contract §0, Build Readiness T3). Acronyms are
 * matched case-sensitively so ordinary words ("oh", "pa") are not flagged.
 */
export const FORBIDDEN_INTERNAL_TERMS: readonly ForbiddenTerm[] = [
  { id: "PSM", pattern: /(?<![\p{L}\p{N}_])PSM(?![\p{L}\p{N}_])/u, reason: "internal acronym (use My Service Map)" },
  { id: "MSM", pattern: /(?<![\p{L}\p{N}_])MSM(?![\p{L}\p{N}_])/u, reason: "internal acronym (use My Service Map)" },
  { id: "OH", pattern: /(?<![\p{L}\p{N}_])OH(?![\p{L}\p{N}_])/u, reason: "internal acronym (use Operation Hub)" },
  { id: "PbyC", pattern: /(?<![\p{L}\p{N}_])(?:PbyC|PBC)(?![\p{L}\p{N}_])/u, reason: "internal acronym (use Precision by Category)" },
  { id: "PA", pattern: /(?<![\p{L}\p{N}_])PA(?![\p{L}\p{N}_])/u, reason: "internal acronym (use Precision Understanding)" },
  { id: "FA", pattern: /(?<![\p{L}\p{N}_])FA(?![\p{L}\p{N}_])/u, reason: "internal acronym (use First Assessment)" },
  { id: "CCIR", pattern: /(?<![\p{L}\p{N}_])CCIR(?![\p{L}\p{N}_])/u, reason: "internal name" },
  { id: "KYC", pattern: /(?<![\p{L}\p{N}_])(?:KYC|due diligence)(?![\p{L}\p{N}_])/iu, reason: "forbidden compliance framing" },
  { id: "mock-labels", pattern: /(?<![\p{L}\p{N}_])(?:MOCK|STUB|SIMULATOR|SANDBOX|SIMULATED)(?![\p{L}\p{N}_])/u, reason: "environment label" },
  { id: "error-code", pattern: /\bBV\d{3}\b/, reason: "raw error code" },
  { id: "internal-keys", pattern: /new:<slug>|new:[a-z0-9_-]+|_generic|CONTEXT_ONLY|LOCKED_CONTEXT|PREFILL_CONFIRM|NOT_ASKED|UNKNOWN|WITHHELD/, reason: "internal key" },
  { id: "version-number", pattern: /(?<![\p{L}\p{N}_])(?:v\d+(?:\.\d+)?|version\s+\d+|versión\s+\d+)(?![\p{L}\p{N}_])/iu, reason: "version numbers are never shown" },
  { id: "provider-names", pattern: /(?<![\p{L}\p{N}_])(?:OpenAI|Anthropic|Claude|ChatGPT|GPT-?\d*|Gemini|Mistral|LLM)(?![\p{L}\p{N}_])/u, reason: "provider name" },
  { id: "json", pattern: /\bJSON\b|```|\{\s*"/, reason: "raw structure" },
];

/** Non-approved variants of canonical names. */
export const UNAPPROVED_VARIANTS: readonly ForbiddenTerm[] = [
  { id: "service-map-bare", pattern: /(?<!My\s)(?<![\p{L}\p{N}_])Service Map(?![\p{L}\p{N}_])/u, reason: "write My Service Map" },
  { id: "my-precision-service-map", pattern: /My Precision Service Map|Precision Service Map/u, reason: "old name; write My Service Map" },
  { id: "requirement-pack-bare", pattern: /(?<!Category\s)(?<![\p{L}\p{N}_])Requirement Pack(?![\p{L}\p{N}_])/u, reason: "write Category Requirement Pack" },
  { id: "understanding-bare", pattern: /(?<!Precision\s)(?<![\p{L}\p{N}_])Understanding(?![\p{L}\p{N}_])/u, reason: "write Precision Understanding" },
  { id: "precision-assessment", pattern: /Precision Assessment/u, reason: "write Precision Understanding" },
  { id: "add-category", pattern: /Add Category|Add a Category|Add Category or Service/iu, reason: "write Add a Service" },
  { id: "snapshot-client", pattern: /(?<![\p{L}\p{N}_])Snapshot(?![\p{L}\p{N}_])/u, reason: "internal label" },
  { id: "pack-label", pattern: /Strategic Advisory Brief|Unmapped Service|New Category/iu, reason: "forbidden label" },
];

export function termIdsIn(text: string): Set<string> {
  const found = new Set<string>();
  if (text.includes(CRP_FULL)) found.add("crp");
  for (const t of TERM_REGISTRY) {
    if (t.id === "crp") continue;
    if (text.includes(t.canonical)) found.add(t.id);
  }
  return found;
}

/** Terms that count as already introduced to the client, given earlier assistant texts. */
export function introducedFromTexts(texts: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const t of texts) if (t.includes(CRP_FULL)) out.add("crp");
  return out;
}

/**
 * Expands `{crp}` tokens: the first expansion of a text is the full name when the term is not introduced yet,
 * every later one (and every one when already introduced) is the acronym.
 */
export function expandCrpToken(text: string, introduced: ReadonlySet<string>): { text: string; introduced: Set<string> } {
  const after = new Set(introduced);
  const out = text.replace(/\{crp\}/g, () => {
    if (after.has("crp")) return CRP_SHORT;
    after.add("crp");
    return CRP_FULL;
  });
  return { text: out, introduced: after };
}
