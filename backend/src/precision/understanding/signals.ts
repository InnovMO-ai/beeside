/**
 * Small, conservative signal readers shared by the probe extractors: how a client answers (unknown / withheld / undecided / yes / no),
 * ranges, money amounts and negations. Everything works on folded text (see text.ts) and never throws.
 */
import { NUMBER_SOURCE, hasTerm, parseQuantity, termRegex } from "./text";

export type AnswerKind = "unknown" | "withheld" | "undecided" | "yes" | "no" | "done" | null;

const UNKNOWN = ["no se", "no lo se", "ni idea", "no tengo (?:ese )?dato", "no tengo idea", "aun no lo se", "todavia no lo se", "no sabemos", "no lo sabemos", "desconozco", "no tengo esa informacion", "no cuento con (?:ese )?dato", "i do not know", "i don't know", "no idea", "not sure yet", "we do not know", "we don't know", "no se todavia", "no estoy seguro", "no estamos seguros"];
const WITHHELD = ["prefiero no (?:decir|compartir|responder)", "no puedo (?:compartir|decir|responder)", "es confidencial", "no quiero compartir", "no es publico", "i prefer not to", "i would rather not", "can't share", "cannot share", "confidential"];
const UNDECIDED = ["no lo hemos (?:decidido|definido)", "no hemos (?:decidido|definido)", "aun no (?:esta|esta) (?:decidido|definido)", "aun no (?:lo )?(?:decidimos|definimos)", "todavia no (?:esta )?(?:lo )?(?:decidido|definido|decidimos|definimos)", "esta por definir", "por definir", "lo estamos evaluando", "estamos evaluando", "aun lo estamos viendo", "no esta decidido", "no esta definido", "pendiente de definir", "depende de", "queremos que nos (?:asesoren|recomienden|ayuden a decidir)", "necesitamos asesoria para decidir", "not decided yet", "have not decided", "haven't decided", "still deciding", "still evaluating", "to be defined", "undecided", "we want advice on"];
const DONE = ["eso es todo", "nada mas", "ya esta", "es todo", "no tengo nada mas", "eso seria todo", "that is all", "that's all", "nothing else", "that's everything"];
const YES = ["si", "claro", "correcto", "exacto", "asi es", "afirmativo", "efectivamente", "yes", "yeah", "correct", "exactly", "right", "sure", "of course"];
const NO = ["no", "nope", "para nada", "negativo", "no es asi", "no hay", "no tenemos", "no habra", "ninguno", "ninguna", "none", "not at all"];

const anyTerm = (f: string, terms: string[]): boolean => terms.some((t) => termRegex(t).test(f));

/** How the client answered, independent of content. */
export function answerKind(f: string): AnswerKind {
  const short = f.length <= 90;
  if (anyTerm(f, WITHHELD)) return "withheld";
  if (anyTerm(f, DONE) && short) return "done";
  if (anyTerm(f, UNDECIDED)) return "undecided";
  if (anyTerm(f, UNKNOWN)) return "unknown";
  if (short) {
    const first = f.trim().replace(/^[¿¡"']+/, "").split(/[\s,.;:!?]+/)[0] ?? "";
    if (YES.includes(first)) return "yes";
    if (first === "no" && !/^no\s+(?:se|lo|tengo|sabemos|hemos|estoy|estamos|puedo|quiero)\b/.test(f.trim())) return "no";
    if (NO.some((n) => n.includes(" ") && f.includes(n))) return "no";
  }
  return null;
}

/** True when the text negates the given phrase within a short window ("no necesitamos constituir"). */
export function negated(f: string, phrase: RegExp): boolean {
  const m = phrase.exec(f);
  if (!m) return false;
  const before = f.slice(Math.max(0, m.index - 40), m.index);
  return /(?:\bno\b|\bni\b|\bsin\b|\bnunca\b|\bwithout\b|\bnot\b|\bdon't\b|\bdo not\b)[^.;]*$/.test(before);
}

// ---------------------------------------------------------------- ranges
export interface Range { min: number; max: number; text: string; index: number }

const RANGE_RE = new RegExp(`(?<![\\p{L}\\p{N}])(?:entre\\s+|de\\s+|between\\s+|from\\s+)?(${NUMBER_SOURCE})\\s*(?:-|–|y|a|and|to|hasta)\\s*(${NUMBER_SOURCE})(?![\\p{L}\\p{N}])`, "giu");

/** "entre 30 y 50", "30-50", "de veinte a treinta" -> ranges (never a duration: callers check the following unit). */
export function ranges(f: string): Range[] {
  const out: Range[] = [];
  for (const m of f.matchAll(RANGE_RE)) {
    const a = parseQuantity(m[1] ?? "");
    const b = parseQuantity(m[2] ?? "");
    if (a === null || b === null || b < a) continue;
    out.push({ min: a, max: b, text: m[0].trim(), index: m.index ?? 0 });
  }
  return out;
}

// ---------------------------------------------------------------- money
export type Currency = "USD" | "EUR" | "MXN" | "OTHER" | null;
export type Period = "month" | "year" | null;
export interface Money { min: number; max: number; currency: Currency; period: Period; text: string; index: number }

const SCALE = "(mil millones|millones|millon|million|millions|miles|mil|thousand|k|mm|m)";
const CUR = "(usd|us\\$|dolares|dolar|dollars?|eur|euros?|mxn|pesos|mdp|mdd|\\$|€)";
const MONEY_RE = new RegExp(`(?<![\\p{L}\\p{N}])(?:${CUR}\\s*)?(${NUMBER_SOURCE})\\s*${SCALE}?\\s*(?:de\\s+)?${CUR}?(?![\\p{L}\\p{N}])`, "giu");

function currencyOf(s: string | undefined): Currency {
  if (!s) return null;
  if (/usd|us\$|dolar|dollar|mdd/.test(s)) return "USD";
  if (/eur|€/.test(s)) return "EUR";
  if (/mxn|peso|mdp/.test(s)) return "MXN";
  return "OTHER";
}
function scaleOf(s: string | undefined): number {
  if (!s) return 1;
  if (/mil millones/.test(s)) return 1e9;
  if (/mill|^mm$|^m$/.test(s)) return 1e6;
  return 1e3;
}

/** Money amounts (one or a range) with the currency and period the sentence implies. Needs a currency or a scale word to count. */
export function money(f: string): Money[] {
  const out: Money[] = [];
  const periodAt = (idx: number, len: number): Period => {
    const around = f.slice(Math.max(0, idx - 30), idx + len + 40);
    if (/mensual|al mes|por mes|cada mes|monthly|per month|a month/.test(around)) return "month";
    if (/anual|al ano|por ano|cada ano|annual|yearly|per year|a year|al anio/.test(around)) return "year";
    return null;
  };
  for (const m of f.matchAll(MONEY_RE)) {
    const [, c1, num, sc, c2] = m;
    const cur = currencyOf(c1) ?? currencyOf(c2);
    if (!cur && !sc) continue; // a bare number is not money
    if (!cur && (sc === "m" || sc === "k" || sc === "mm")) continue; // "5 m" is not money without a currency
    const base = parseQuantity(num ?? "");
    if (base === null) continue;
    // A scale of "m"/"k" glued to a bare number inside an ordinary word is unlikely thanks to the boundaries above.
    const v = base * scaleOf(sc);
    out.push({ min: v, max: v, currency: cur, period: periodAt(m.index ?? 0, m[0].length), text: m[0].trim(), index: m.index ?? 0 });
  }
  // Two amounts joined by "y|a|-" -> range ("entre 1 y 2 millones")
  const merged: Money[] = [];
  for (let i = 0; i < out.length; i++) {
    const a = out[i]!;
    const b = out[i + 1];
    if (b && /^\s*(?:y|a|-|–|and|to|hasta)\s*$/.test(f.slice(a.index + a.text.length, b.index))) {
      merged.push({ min: Math.min(a.min, b.min), max: Math.max(a.max, b.max), currency: a.currency ?? b.currency, period: a.period ?? b.period, text: `${a.text} - ${b.text}`, index: a.index });
      i++;
    } else merged.push(a);
  }
  return merged;
}

export function describeMoney(m: { min: number; max: number; currency: Currency; period: Period }, locale: "es" | "en"): string {
  const fmt = (n: number): string => {
    if (n >= 1e9) return `${+(n / 1e9).toFixed(1)}${locale === "es" ? " mil millones" : "B"}`;
    if (n >= 1e6) return `${+(n / 1e6).toFixed(1)}${locale === "es" ? " millones" : "M"}`;
    if (n >= 1e3) return `${+(n / 1e3).toFixed(1)}${locale === "es" ? " mil" : "K"}`;
    return String(n);
  };
  const cur = m.currency && m.currency !== "OTHER" ? ` ${m.currency}` : "";
  const per = m.period ? (locale === "es" ? (m.period === "month" ? " al mes" : " al año") : m.period === "month" ? " per month" : " per year") : "";
  const body = m.min === m.max ? fmt(m.min) : `${fmt(m.min)}–${fmt(m.max)}`;
  return `${body}${cur}${per}`;
}

// ---------------------------------------------------------------- small helpers
export const mentions = (f: string, terms: readonly string[]): string | null => {
  for (const t of terms) if (hasTerm(f, t)) return t;
  return null;
};
