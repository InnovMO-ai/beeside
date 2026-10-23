/**
 * Terms the client must never see (docs/f5/source/voice-pack.md section 2 and rule R7, plus the Track A contract).
 * Used only by tests. A rule has an `allow` list of exact dictionary keys where the term is legitimate.
 */
export interface Rule { id: string; re: RegExp; allowKeys?: string[]; note: string }

export const RULES: Rule[] = [
  { id: "exclamation", re: /[!¡]/, note: "no exclamation marks" },
  { id: "emoji", re: /\p{Extended_Pictographic}/u, note: "no emoji" },
  { id: "es-listo", re: /\b(listo|lista|listos|listas)\b/i, note: "'listo/lista' is forbidden (R7)" },
  { id: "ready", re: /\b(ready|validated|excellent|excelente|perfect|perfecto|genial)\b/i, note: "no quality judgements" },
  { id: "validado", re: /\bvalidad[oa]s?\b/i, note: "validado is forbidden" },
  { id: "internal-labels", re: /\b(add category|new category|unmapped service|strategic advisory brief|discovery mode|out of scope|scenario|readiness score|provider-ready|AAA|core\/on-demand|on-demand)\b/i, note: "internal labels" },
  { id: "rfx", re: /\b(RFI|RFP|RFQ|SOW)\b/, note: "procurement jargon" },
  { id: "tools", re: /\b(ClickUp|Stripe|Anthropic|OpenAI|Claude|GPT)\b/i, note: "vendor names" },
  { id: "acronyms", re: /\b(PSM|MSM|OH|FA4|FA 4\.0|CCIR|KYC|PbyC)\b/, note: "internal acronyms" },
  { id: "hive", re: /\b(hive)\b/i, note: "The Hive is not named to the client here" },
  { id: "sherpa", re: /\bsherpa\b/i, allowKeys: ["center.oh.contactSherpa"], note: "Sherpa only after it exists (action label only)" },
  { id: "version-numbers", re: /\b(v\d+(\.\d+)?|versión \d+|version \d+)\b/i, note: "no version numbers shown to the client" },
  { id: "internal-states", re: /\b(ACTIVE|SOURCEABLE|REVIEW|NOT_OFFERED|ACTIVATION_PENDING_RETRY_FIRST|PREVIEW_STALE|TEMPORARILY_UNAVAILABLE)\b/, note: "internal states and error codes" },
  { id: "reopen", re: /\b(reopen|reabrir)\b/i, note: "reopen is forbidden" },
  { id: "errors", re: /\b(stack|exception|undefined|NaN|null|\[object)\b/i, note: "no raw errors" },
  { id: "es-coloquial", re: /\b(ahorita|chévere|órale|chido|guay|bacán|súper)\b/i, note: "colloquialisms" },
  { id: "es-usted", re: /\b(usted|ustedes|su proyecto|sus datos)\b/i, note: "tuteo only" },
];

export function scan(text: string, key?: string): string[] {
  const hits: string[] = [];
  for (const r of RULES) {
    if (r.allowKeys && key && r.allowKeys.includes(key)) continue;
    const m = r.re.exec(text);
    if (m) hits.push(`${r.id}: "${m[0]}" (${r.note})`);
  }
  return hits;
}
