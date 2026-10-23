// Deterministic tone checks R1, R2, R3, R4, R7 (F2 voice pack §4) + glossary-forbidden terms. R5, R6, R8 stay human.
const WB = (w) => new RegExp(`(?<![\\p{L}\\p{N}_])(?:${w})(?![\\p{L}\\p{N}_])`, "iu");
export const RULES = {
  R1: { re: WB("usted|ustedes|vos|tenés|querés|podés|sos|vosotros"), msg: "register must be 'tú' (no usted/vos)" },
  R2: { re: new RegExp(`${WB("ahorita|chévere|chevere|órale|orale|chido|guay|bacán|bacan|de una|súper|super|genial|perfecto|vale|qué padre|muy padre").source}|!|¡|\\p{Extended_Pictographic}`, "iu"), msg: "colloquialism, exclamation or emoji" },
  R7: { re: WB("listo|lista|listos|validado|validada|calificado|calificada|excelente|AAA|provider-ready|RFI|RFP|RFQ|SOW|ClickUp|Add Category|reabrir|reabierto|reopen|Strategic Advisory Brief|Unmapped Service|New Category|Discovery|Out of Scope|scenario|readiness score|Core|On-Demand|SOURCEABLE|NOT_OFFERED|no tenemos ese servicio"), msg: "forbidden term or quality judgment" },
};
// PO-approved customer-facing verification state label (CCIR, 7 Oct). Exact-match exemption from R7 only; the word stays forbidden in any other copy.
export const APPROVED_STATE_LABELS = new Set(["Datos validados"]);
// PO-approved verbatim CCIR texts: exempt from the R4 length heuristic only (never edited; R1/R2/R3/R7 still apply).
export const APPROVED_VERBATIM = new Set([
  "Nos ayuda a entender la escala real de tu empresa y dimensionar mejor los servicios que puede requerir tu expansión.",
  "It helps us understand the real scale of your company and better size the services your expansion may require.",
  "Si más adelante algún servicio requiere evidencia o documentación adicional, tu Sherpa o el proveedor correspondiente te lo indicará.",
  "If a specific service later requires evidence or additional documentation, your Sherpa or the corresponding provider will let you know.",
  "Now that I understand your expansion project, I'd like to complete a few company details that will help us prepare the next steps and avoid asking for the same information again later.",
  "You previously indicated that your company has between [min] and [max] employees. Approximately how many employees do you currently have?",
]);
const strip = (t) => t.replace(/\[[^\]]+\]/g, "x"); // placeholders count as one word
export function sentences(text) { return strip(text).split(/(?<=[.?!…])\s+|\n+/).map((s) => s.trim()).filter(Boolean); }
export function words(s) { return s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)); }
export function lintCopy(key, text, opts = {}) {
  const f = [];
  const t = strip(text);
  for (const [id, r] of Object.entries(RULES)) { if (id === "R7" && APPROVED_STATE_LABELS.has(text.trim())) continue; const m = t.match(r.re); if (m) f.push({ rule: id, key, hit: m[0], msg: r.msg, critical: id !== "R4" }); }
  if (/(?<![\p{L}])Beeside(?![\p{L}])/u.test(t)) f.push({ rule: "R7", key, hit: "Beeside", msg: "brand is always lowercase: beeside", critical: true });
  if (/(?<![\p{L}])(?:the hive|Hive)(?![\p{L}])/.test(t) && !/The Hive/.test(t)) f.push({ rule: "R7", key, hit: "hive", msg: "write The Hive", critical: true });
  const q = (t.match(/¿/g) || []).length;
  if (q > 1) f.push({ rule: "R3", key, hit: `${q} questions`, msg: "one question per turn", critical: false });
  const verbatim = APPROVED_VERBATIM.has(text.trim());
  const ss = sentences(t); const wc = ss.map((s) => words(s).length);
  const avg = wc.reduce((a, b) => a + b, 0) / Math.max(1, wc.length);
  if (!verbatim && avg > 18) f.push({ rule: "R4", key, hit: `avg ${avg.toFixed(1)}`, msg: "average sentence length > 18", critical: false });
  if (!verbatim && Math.max(0, ...wc) > 35) f.push({ rule: "R4", key, hit: `max ${Math.max(...wc)}`, msg: "a sentence > 35 words", critical: false });
  if (/^add_service_/.test(key) && /categor[ií]a/i.test(t)) f.push({ rule: "G", key, hit: "categoría", msg: "Add a Service never says category", critical: true });
  return f;
}
export function parseFixedCopy(md) {
  const sec = md.slice(md.indexOf("## 3. Inventario de copy fijo"), md.indexOf("## 4. Rúbrica de tono"));
  const rows = [];
  for (const line of sec.split("\n")) {
    const c = line.split("|").map((x) => x.trim());
    if (c.length < 5 || !c[1].startsWith("`")) continue;
    const keys = [...c[1].matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    const quoted = [...c[3].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    rows.push({ keys, where: c[2], texts: quoted, notes: c[4] });
  }
  return rows;
}
export function lintFixedCopy(md) {
  const rows = parseFixedCopy(md); const findings = []; let n = 0;
  for (const r of rows) for (const [i, t] of r.texts.entries()) { n++; findings.push(...lintCopy(r.keys[Math.min(i, r.keys.length - 1)] || r.keys[0], t)); }
  return { items: n, findings };
}
