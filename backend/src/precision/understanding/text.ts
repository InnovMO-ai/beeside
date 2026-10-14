/**
 * Text helpers for the Understanding layer: accent/case folding, whole-word term matching with an optional `*` prefix wildcard,
 * quote verification (a quoted span must really be in the client's words) and small, conservative number parsing.
 * Pure and total: nothing here throws on odd input.
 */
export const fold = (s: string): string => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export const squash = (s: string): string => s.replace(/\s+/g, " ").trim();

const reCache = new Map<string, RegExp>();
/** A term written with regex syntax (groups, classes, escapes, `?`) is matched as a regex; everything else is a literal phrase. */
const isRegexTerm = (t: string): boolean => /[\\()[\]?|]/.test(t);
/**
 * `contrat*` matches contratar / contratación / contratos; `empleado` matches empleado/empleados; phrases keep flexible spaces.
 * Terms with regex syntax (e.g. `financiamiento (?:desde|de) (?:la )?matriz`, `nom-?\\d*`) are used as regexes; inside them a letter followed by `*`
 * is still the prefix wildcard (`financi*`), while `\\w*`/`\\d*` keep their regex meaning.
 */
export function termRegex(term: string): RegExp {
  const hit = reCache.get(term);
  if (hit) return hit;
  const t = fold(term).trim();
  let re: RegExp;
  if (isRegexTerm(t)) {
    const body = t.replace(/\s+/g, "\\s+").replace(/(?<!\\)([a-z])\*/g, "$1\\p{L}*");
    try {
      re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${body})(?![\\p{L}\\p{N}])`, "u");
    } catch {
      re = /(?!)/u; // a malformed term never matches (and never throws at run time)
    }
  } else {
    const wildcard = t.endsWith("*");
    const base = escapeRe(wildcard ? t.slice(0, -1) : t).replace(/\s+/g, "\\s+");
    re = new RegExp(`(?<![\\p{L}\\p{N}])${base}${wildcard ? "\\p{L}*" : "(?:s|es)?"}(?![\\p{L}\\p{N}])`, "u");
  }
  reCache.set(term, re);
  return re;
}

/** Folded text for matching (computed once per message by callers that test many terms). */
export const matchable = (text: string): string => fold(text);
export function hasTerm(foldedText: string, term: string): boolean {
  return termRegex(term).test(foldedText);
}
export function firstTerm(foldedText: string, terms: readonly string[]): string | null {
  for (const t of terms) if (hasTerm(foldedText, t)) return t;
  return null;
}

/** The sentence-ish span of `text` around position `idx` (fold() preserves length for precomposed characters, so positions line up). */
export function spanAt(text: string, idx: number, max = 160): string {
  const at = Math.max(0, Math.min(idx, text.length - 1));
  const start = Math.max(0, text.lastIndexOf(".", at) + 1, text.lastIndexOf("\n", at) + 1, text.lastIndexOf("?", at) + 1, text.lastIndexOf("!", at) + 1);
  let end = text.indexOf(".", at);
  if (end < 0) end = text.length;
  const clipped = squash(text.slice(start, Math.min(end + 1, start + max * 2)));
  if (clipped.length <= max) return clipped;
  // Keep the part around the match when the sentence is long.
  const rel = Math.max(0, at - start - Math.floor(max / 3));
  return squash(text.slice(start + rel, start + rel + max));
}

/** The sentence-ish span of `text` around the first match of `term`, used as the quote of an observation. */
export function spanAround(text: string, term: string, max = 160): string {
  const m = termRegex(term).exec(fold(text));
  if (!m) return squash(text).slice(0, max);
  return spanAt(text, m.index, max);
}

/** A quote is acceptable only if (after folding and squashing) it occurs in the client's text. */
export function quoteInText(quote: string, text: string): boolean {
  const q = squash(fold(quote)).replace(/^["'“”«»]+|["'“”«»]+$/g, "");
  if (q.length < 2) return false;
  return squash(fold(text)).includes(q);
}

// ---------------------------------------------------------------- numbers
const UNITS: Record<string, number> = {
  un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15,
  dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20, veintiun: 21, veintiuno: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
  treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90, cien: 100, ciento: 100, doscientos: 200, trescientos: 300, cuatrocientos: 400, quinientos: 500, seiscientos: 600, setecientos: 700, ochocientos: 800, novecientos: 900,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100,
};
const NUM_WORD = Object.keys(UNITS).sort((a, b) => b.length - a.length).join("|");

/** "40", "1,200", "1.200" (es thousands), "12.5", "cuarenta", "treinta y cinco" -> number, or null. */
export function parseQuantity(raw: string): number | null {
  const t = fold(raw).trim();
  const digits = t.match(/^\d{1,3}(?:[.,]\d{3})+(?!\d)$|^\d+(?:[.,]\d+)?$/);
  if (digits) {
    const s = digits[0];
    if (/^\d{1,3}(?:[.,]\d{3})+$/.test(s)) return Number(s.replace(/[.,]/g, ""));
    return Number(s.replace(",", "."));
  }
  const words = t.split(/\s+(?:y|and)\s+|\s+/).filter(Boolean);
  if (words.length === 0) return null;
  let total = 0;
  let any = false;
  for (const w of words) {
    if (w === "mil" || w === "thousand") { total = (total || 1) * 1000; any = true; continue; }
    const v = UNITS[w];
    if (v === undefined) return null;
    total += v;
    any = true;
  }
  return any ? total : null;
}

const NUM = `(?:\\d{1,3}(?:[.,]\\d{3})+|\\d+(?:[.,]\\d+)?|(?:${NUM_WORD})(?:\\s+(?:y|and)?\\s*(?:${NUM_WORD}))*)`;
export const NUMBER_SOURCE = NUM;

export interface QuantityHit { value: number; index: number; text: string }
/** Every quantity in the text with the folded index where it starts. */
export function quantities(foldedText: string): QuantityHit[] {
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(${NUM})(?![\\p{L}\\p{N}])`, "giu");
  const out: QuantityHit[] = [];
  for (const m of foldedText.matchAll(re)) {
    const v = parseQuantity(m[1] ?? "");
    if (v !== null) out.push({ value: v, index: m.index ?? 0, text: m[1] ?? "" });
  }
  return out;
}

/** The quantity that directly precedes (within `gap` characters) or follows one of the labels. */
export function quantityNear(foldedText: string, labels: readonly string[], opts: { before?: boolean; after?: boolean; gap?: number } = {}): number | null {
  const gap = opts.gap ?? 18;
  const before = opts.before ?? true;
  const after = opts.after ?? true;
  const qs = quantities(foldedText);
  for (const label of labels) {
    const re = termRegex(label);
    const g = new RegExp(re.source, "gu");
    for (const m of foldedText.matchAll(g)) {
      const at = m.index ?? 0;
      const end = at + m[0].length;
      if (before) {
        const q = qs.filter((x) => x.index + x.text.length <= at && at - (x.index + x.text.length) <= gap).sort((a, b) => b.index - a.index)[0];
        if (q && !/[.;]\s*$/.test(foldedText.slice(q.index + q.text.length, at))) return q.value;
      }
      if (after) {
        const q = qs.filter((x) => x.index >= end && x.index - end <= gap).sort((a, b) => a.index - b.index)[0];
        if (q && !/[.;]/.test(foldedText.slice(end, q.index))) return q.value;
      }
    }
  }
  return null;
}

/** "2-3 años", "de dos a tres años", "approximately 2 to 3 years", "18 meses", "un año" -> months range. */
export function parseDuration(foldedText: string): { minMonths: number; maxMonths: number; text: string } | null {
  const unit = "(anos?|years?|meses|mes|months?)";
  const range = new RegExp(`(?<![\\p{L}\\p{N}])(${NUM})\\s*(?:-|–|a|o|to|or|hasta)\\s*(${NUM})\\s*${unit}`, "iu").exec(foldedText);
  const mult = (u: string): number => (/^(ano|year)/.test(u) ? 12 : 1);
  if (range) {
    const a = parseQuantity(range[1] ?? "");
    const b = parseQuantity(range[2] ?? "");
    if (a !== null && b !== null) {
      const m = mult(range[3] ?? "");
      return { minMonths: Math.min(a, b) * m, maxMonths: Math.max(a, b) * m, text: squash(range[0]) };
    }
  }
  const single = new RegExp(`(?<![\\p{L}\\p{N}])(?:unos|aproximadamente|aprox\\.?|alrededor de|about|around|approximately|approx\\.?)?\\s*(${NUM})\\s*${unit}`, "iu").exec(foldedText);
  if (single) {
    const a = parseQuantity(single[1] ?? "");
    if (a !== null) {
      const m = mult(single[2] ?? "");
      return { minMonths: a * m, maxMonths: a * m, text: squash(single[0]) };
    }
  }
  return null;
}

/** Years for a duration in months, in client-ish words (es/en). */
export function describeMonths(min: number, max: number, locale: "es" | "en"): string {
  const unit = (m: number): [number, string] => (m % 12 === 0 ? [m / 12, locale === "es" ? (m / 12 === 1 ? "año" : "años") : m / 12 === 1 ? "year" : "years"] : [m, locale === "es" ? (m === 1 ? "mes" : "meses") : m === 1 ? "month" : "months"]);
  if (min === max) { const [n, u] = unit(min); return `${n} ${u}`; }
  if (min % 12 === 0 && max % 12 === 0) return locale === "es" ? `${min / 12}–${max / 12} años` : `${min / 12}–${max / 12} years`;
  return locale === "es" ? `${min}–${max} meses` : `${min}–${max} months`;
}
