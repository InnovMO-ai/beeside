/**
 * Deterministic reading of the client's answer STATE (Build Readiness §C/§M): UNKNOWN, WITHHELD, estimate,
 * explicit "no"/"none"/zero and bare yes/no or option answers. These never need a model call: the model is only
 * used to extract values from free text.
 */
import { enumValuesOf, type FieldDefinition, type ValueRenderer } from "./fields";
import { normalizeText, wordCount } from "./text-utils";
import type { Locale } from "./types";

const UNKNOWN_RE =
  /\b(?:no se|no lo se|no sabria|no sabemos|no tengo idea|ni idea|no estoy seguro|no estoy segura|no estamos seguros|aun no (?:lo )?(?:se|sabemos|tengo|tenemos|definimos|decidimos|hemos definido|hemos decidido)|todavia no (?:lo )?(?:se|sabemos|tengo|tenemos|definimos|decidimos|hemos definido|hemos decidido)|no (?:lo )?(?:he|hemos) (?:definido|decidido)|por definir|sin definir|i don t know|i do not know|dont know|not sure|no idea|not yet|we don t know|we do not know|we haven t decided|have not decided|haven t decided yet|tbd)\b/;
const WITHHELD_RE =
  /\b(?:prefiero no (?:decir|compartir|dar|responder|indicar|contestar)\w*|preferimos no (?:decir|compartir|dar|responder|indicar|contestar)\w*|no (?:quiero|puedo|podemos|queremos) (?:decir|compartir|dar|indicar|responder|contestar)\w*|prefer not to|would rather not|rather not (?:say|share|answer)|can t share|cannot share|can not share|es confidencial|is confidential)\b/;
const ESTIMATE_RE = /\b(?:aproximad\w*|aprox|mas o menos|alrededor de|cerca de|unos|unas|estimo|estimamos|estimad\w*|approximately|approx|around|about|roughly|estimate\w*|ballpark)\b/;
const NONE_RE = /^(?:ninguno|ninguna|ningun|nada|no tenemos(?: ninguno| ninguna| nada)?|no tengo(?: ninguno| ninguna| nada)?|no hay(?: ninguno| ninguna| nada)?|none|no|not any|we have none|there are none|there is none|nothing|nope|no thanks|no gracias)$/;
const ZERO_RE = /^(?:cero|0|zero|ninguno|ninguna|none|nada|no tenemos|no tengo)$/;
const YES_RE = /^(?:si|sii|claro|correcto|asi es|exacto|efectivamente|por supuesto|yes|yeah|yep|yup|sure|correct|that s right|that is right|right|exactly|of course|affirmative)$/;
const NO_RE = /^(?:no|nope|nel|para nada|no es asi|no lo es|not really|negative|nah|no gracias|no thanks)$/;

export type AnswerSignal = "UNKNOWN" | "WITHHELD" | null;

function strip(norm: string): string {
  return norm.replace(/^(?:pues|bueno|mmm|hmm|este|eh|well|um|uh|ok|okay|vale)\s+/, "").replace(/\s+(?:por ahora|todavia|aun|ahora|yet|for now|right now|at the moment)$/, "").trim();
}

/** UNKNOWN / WITHHELD signal. `pure` = the message is essentially only that signal (<= 10 words). */
export function detectAnswerSignal(text: string): { signal: AnswerSignal; pure: boolean } {
  const norm = normalizeText(text);
  if (WITHHELD_RE.test(norm)) return { signal: "WITHHELD", pure: wordCount(text) <= 10 };
  if (UNKNOWN_RE.test(norm)) return { signal: "UNKNOWN", pure: wordCount(text) <= 10 };
  return { signal: null, pure: false };
}

export function hasEstimateCue(text: string): boolean {
  return ESTIMATE_RE.test(normalizeText(text));
}

const LIST_LIKE = new Set(["multi_enum", "country_list", "language_list", "text_list", "text_or_language_code_list", "repeatable_group"]);

export interface Deterministic {
  value: unknown;
  answerState: "ANSWERED" | "EXPLICIT_NO" | "ZERO";
}

/** A bare answer that needs no extraction: yes/no for booleans, "none" for lists, zero for numbers, one option for enums. */
export function deterministicAnswer(def: FieldDefinition, text: string, locale: Locale, r: ValueRenderer, scope?: string): Deterministic | null {
  const norm = strip(normalizeText(text));
  if (norm.length === 0 || wordCount(text) > 6) return null;
  switch (def.type) {
    case "boolean":
      if (YES_RE.test(norm)) return { value: true, answerState: "ANSWERED" };
      if (NO_RE.test(norm)) return { value: false, answerState: "EXPLICIT_NO" };
      return null;
    case "number":
      if (ZERO_RE.test(norm)) return { value: 0, answerState: "ZERO" };
      if (/^\d+(?:[.,]\d+)?$/.test(norm.replace(/\s+/g, ""))) {
        const n = Number(norm.replace(/\s+/g, "").replace(",", "."));
        if (Number.isFinite(n)) return n === 0 ? { value: 0, answerState: "ZERO" } : { value: n, answerState: "ANSWERED" };
      }
      return null;
    case "enum": {
      const values = enumValuesOf(def);
      const hits = values.filter((v) => {
        const lbl = normalizeText(r.enumLabel(v, locale, scope ?? def.field_key));
        return norm === lbl || norm === normalizeText(v);
      });
      return hits.length === 1 ? { value: hits[0], answerState: "ANSWERED" } : null;
    }
    default:
      if (LIST_LIKE.has(def.type) && NONE_RE.test(norm)) return { value: [], answerState: "EXPLICIT_NO" };
      return null;
  }
}
