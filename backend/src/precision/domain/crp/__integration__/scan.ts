/** Customer-facing text scan (Track A contract section 0 + voice rules). Walks a JSON body and checks every string value except structural ones. */
const STRUCTURAL = new Set(["id", "categoryId", "previewChecksum", "confirmedAt", "asOf", "createdAt", "error", "state", "iconKey", "kind", "clientAction", "blockedReason", "sendState", "url"]);

const RULES: Array<[string, RegExp]> = [
  ["internal markers", /\b(MOCK|STUB|SIMULATOR|SIMULATED|SANDBOX|BV409|BV404|JSON|CONTEXT_ONLY|CCIR)\b/],
  ["internal slugs", /new:|_generic|precision\.|[a-z]+_[a-z]+_[a-z_]+/],
  ["internal acronyms", /\b(PSM|MSM|OH|PbyC|PA|FA|FA4)\b/],
  ["forbidden words", /\b(reopen|reabrir|Unmapped|Out of Scope|Discovery|ClickUp|Stripe|Anthropic)\b/i],
  ["quality judgements", /\b(ready|validated|excellent|perfect|listo|lista|validado|excelente)\b/i],
  ["exclamation / emoji", /[!¡]|\p{Extended_Pictographic}/u],
  ["raw errors", /\b(stack|exception|undefined|NaN|TypeError|ECONN|SQLSTATE|violates)\b|\[object|\bnull\b/i],
  ["version numbers", /\b(v\d+(\.\d+)*|versi[oó]n \d+|version \d+)\b/i],
  ["sherpa before assigned", /\bsherpa\b/i],
  ["error codes", /\b(PREVIEW_STALE|NOT_READY|ACTIVATION_PENDING_RETRY_FIRST|PRECISION_READ_ONLY|TEMPORARILY_UNAVAILABLE)\b/],
];

export function scanCustomerBody(body: unknown, path = "$"): string[] {
  const hits: string[] = [];
  if (typeof body === "string") {
    for (const [name, re] of RULES) {
      const m = re.exec(body);
      if (m) hits.push(`${path}: ${name}: "${m[0]}" in "${body.slice(0, 80)}"`);
    }
  } else if (Array.isArray(body)) {
    body.forEach((v, i) => hits.push(...scanCustomerBody(v, `${path}[${i}]`)));
  } else if (body && typeof body === "object") {
    for (const [k, v] of Object.entries(body)) if (!STRUCTURAL.has(k)) hits.push(...scanCustomerBody(v, `${path}.${k}`));
  }
  return hits;
}
