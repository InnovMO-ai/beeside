/**
 * Deterministic tone checks R1, R2, R3, R4, R7 (voice pack §4) plus the glossary-forbidden terms. R5, R6 and R8 stay
 * human. Port of the Gate D linter (validator/copy-lint.mjs); used by tests to lint fixed copy and by callers that want
 * to vet generated customer-facing strings. Pure.
 */
export interface LintFinding {
  rule: "R1" | "R2" | "R3" | "R4" | "R7" | "G";
  key: string;
  hit: string;
  msg: string;
  critical: boolean;
}

const WB = (w: string): RegExp => new RegExp(`(?<![\\p{L}\\p{N}_])(?:${w})(?![\\p{L}\\p{N}_])`, "iu");

export const RULES: Record<"R1" | "R2" | "R7", { re: RegExp; msg: string }> = {
  R1: { re: WB("usted|ustedes|vos|tenés|querés|podés|sos|vosotros"), msg: "register must be 'tú' (no usted/vos)" },
  R2: {
    re: new RegExp(`${WB("ahorita|chévere|chevere|órale|orale|chido|guay|bacán|bacan|de una|súper|super|genial|perfecto|vale|qué padre|muy padre").source}|!|¡|\\p{Extended_Pictographic}`, "iu"),
    msg: "colloquialism, exclamation or emoji",
  },
  R7: {
    re: WB(
      "listo|lista|listos|validado|validada|calificado|calificada|excelente|AAA|provider-ready|RFI|RFP|RFQ|SOW|ClickUp|Add Category|reabrir|reabierto|reopen|Strategic Advisory Brief|Unmapped Service|New Category|Discovery Mode|Out of Scope|scenario|readiness score|Core|On-Demand|SOURCEABLE|NOT_OFFERED|no tenemos ese servicio",
    ),
    msg: "forbidden term or quality judgment",
  },
};

/** PO-approved customer-facing verification state label (CCIR). Exact-match exemption from R7 only. */
export const APPROVED_STATE_LABELS: ReadonlySet<string> = new Set(["Datos validados"]);

/** PO-approved verbatim CCIR texts: exempt from the R4 length heuristic only (R1/R2/R3/R7 still apply). */
export const APPROVED_VERBATIM: ReadonlySet<string> = new Set([
  "Nos ayuda a entender la escala real de tu empresa y dimensionar mejor los servicios que puede requerir tu expansión.",
  "It helps us understand the real scale of your company and better size the services your expansion may require.",
  "Now that I understand your expansion project, I'd like to complete a few company details that will help us prepare the next steps and avoid asking for the same information again later.",
  "You previously indicated that your company has between [min] and [max] employees. Approximately how many employees do you currently have?",
]);

const strip = (t: string): string => t.replace(/\[[^\]]+\]/g, "x"); // placeholders count as one word

export function sentences(text: string): string[] {
  return strip(text)
    .split(/(?<=[.?!…])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
export function words(s: string): string[] {
  return s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
}

export function lintCopy(key: string, text: string): LintFinding[] {
  const f: LintFinding[] = [];
  const t = strip(text);
  for (const id of ["R1", "R2", "R7"] as const) {
    if (id === "R7" && APPROVED_STATE_LABELS.has(text.trim())) continue;
    const r = RULES[id];
    const m = t.match(r.re);
    if (m) f.push({ rule: id, key, hit: m[0], msg: r.msg, critical: true });
  }
  if (/(?<![\p{L}])Beeside(?![\p{L}])/u.test(t)) f.push({ rule: "R7", key, hit: "Beeside", msg: "brand is always lowercase: beeside", critical: true });
  if (/(?<![\p{L}])(?:the hive|Hive)(?![\p{L}])/u.test(t) && !/The Hive/.test(t)) f.push({ rule: "R7", key, hit: "hive", msg: "write The Hive", critical: true });
  const q = (t.match(/¿/g) ?? []).length;
  if (q > 1) f.push({ rule: "R3", key, hit: `${q} questions`, msg: "one question per turn", critical: false });
  const verbatim = APPROVED_VERBATIM.has(text.trim());
  const wc = sentences(t).map((s) => words(s).length);
  const avg = wc.reduce((a, b) => a + b, 0) / Math.max(1, wc.length);
  if (!verbatim && avg > 18) f.push({ rule: "R4", key, hit: `avg ${avg.toFixed(1)}`, msg: "average sentence length > 18", critical: false });
  const max = Math.max(0, ...wc);
  if (!verbatim && max > 35) f.push({ rule: "R4", key, hit: `max ${max}`, msg: "a sentence > 35 words", critical: false });
  if (/^add_service_/.test(key) && /categor[ií]a/i.test(t)) f.push({ rule: "G", key, hit: "categoría", msg: "Add a Service never says category", critical: true });
  return f;
}

export interface FixedCopyRow { keys: string[]; where: string; texts: string[]; notes: string }

/** Parses the fixed-copy inventory table (voice pack §3). */
export function parseFixedCopy(md: string): FixedCopyRow[] {
  const from = md.indexOf("## 3. Inventario de copy fijo");
  const to = md.indexOf("## 4. Rúbrica de tono");
  const sec = from >= 0 ? md.slice(from, to > from ? to : undefined) : "";
  const rows: FixedCopyRow[] = [];
  for (const line of sec.split("\n")) {
    const c = line.split("|").map((x) => x.trim());
    const c1 = c[1];
    if (c.length < 5 || c1 === undefined || !c1.startsWith("`")) continue;
    const keys = [...c1.matchAll(/`([^`]+)`/g)].map((m) => m[1] as string);
    const quoted = [...(c[3] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1] as string);
    rows.push({ keys, where: c[2] ?? "", texts: quoted, notes: c[4] ?? "" });
  }
  return rows;
}

export function lintFixedCopy(md: string): { items: number; findings: LintFinding[] } {
  const findings: LintFinding[] = [];
  let items = 0;
  for (const r of parseFixedCopy(md)) {
    for (const [i, t] of r.texts.entries()) {
      items += 1;
      findings.push(...lintCopy(r.keys[Math.min(i, r.keys.length - 1)] ?? r.keys[0] ?? "", t));
    }
  }
  return { items, findings };
}
