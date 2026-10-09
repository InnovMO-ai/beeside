/**
 * Voice lint (Voice Guide v1 + v1.1): the structural rules the Voice Pack says must be deterministic checks,
 * not only instructions — one question per turn (R3, in tone.ts), no exclamation/emoji (R2, tone.ts), no quality
 * judgments (R7, tone.ts), plus: no list formatting, no percentages in Precision Understanding, no Sherpa before
 * a real assignment, never re-ask known facts (R6), no invented promises of timing, no meta/AI leakage, answer in
 * the requested language.
 */
import { normalizeText, splitSentences } from "../text-utils";
import type { Violation, VerifyContext } from "./types";

function vl(code: string, hit: string, message: string, rule: Violation["rule"] = "VOICE"): Violation {
  return { rule, code, hit, message, critical: true };
}

const LIST_LINE = /^\s*(?:[-*•–—]|\d+[.)]|[a-z][.)])\s+\S/m;
const PERCENT = /\d+(?:[.,]\d+)?\s*(?:%|por\s*ciento|percent)/i;
const SHERPA_ANY = /sherpa/i;
const SHERPA_POSSESSIVE = /(?<![\p{L}])(?:tu|tus|mi|mis|su|your|my|the)\s+sherpa/iu;
const SHERPA_CONTACT = /(?:contacta(?:r)?\s+(?:a|con)?\s*(?:tu|mi|el)\s+sherpa|contact\s+(?:your|my|the)\s+sherpa|escr[ií]bele\s+a\s+tu\s+sherpa)/iu;
const SHERPA_ASSIGNMENT_IMPLIED =
  /(?:sherpa\s+(?:te\s+acompa[ñn]ar[aá]|ya\s+(?:est[aá]|tiene)|te\s+contactar[aá]|ser[aá]\s+asignado|has\s+been\s+assigned|will\s+(?:contact|accompany|reach)\s+you)|te\s+(?:asignaremos|asignar[aá]n?)|se\s+te\s+asignar[aá]|we\s+will\s+assign|will\s+be\s+assigned|ya\s+tienes\s+un\s+sherpa|you\s+(?:already\s+)?have\s+a\s+sherpa)/iu;
const PROMISE =
  /(?:en\s+(?:las\s+)?pr[oó]ximas?\s+\d+|dentro\s+de\s+\d+\s+(?:horas?|d[ií]as?|semanas?)|within\s+\d+\s+(?:hours?|days?|weeks?|business)|garantizamos|garantizado|we\s+guarantee|guaranteed|sin\s+falta|siempre\s+en\s+menos\s+de|always\s+within)/iu;
const META_LEAK = /<\/?meta|<\/?(?:thinking|assistant|system)|as\s+an\s+ai\b|como\s+(?:modelo|asistente)\s+de\s+(?:lenguaje|ia)|language\s+model|modelo\s+de\s+lenguaje|\[\s*(?:system|assistant)\s*\]/iu;

const ES_STOP = new Set(["el", "la", "los", "las", "de", "que", "tu", "tus", "para", "con", "una", "un", "es", "por", "como", "en", "y", "lo", "se", "del"]);
const EN_STOP = new Set(["the", "and", "you", "your", "for", "with", "that", "this", "is", "are", "to", "of", "in", "it", "what", "can"]);

function stopRatio(tokens: string[], set: Set<string>): number {
  if (tokens.length === 0) return 0;
  return tokens.filter((t) => set.has(t)).length / tokens.length;
}

/** Significant tokens (length > 3) of a label, used for the re-ask heuristic. */
const LABEL_STOP = new Set(["para", "este", "esta", "esto", "como", "cual", "cuales", "that", "this", "with", "from", "your", "have", "will", "what", "which", "frente", "trabajo", "main", "being"]);
export function significantTokens(label: string): string[] {
  return normalizeText(label)
    .split(" ")
    .filter((t) => t.length > 3 && !LABEL_STOP.has(t));
}

function coverage(sentenceTokens: Set<string>, label: string): number {
  const toks = significantTokens(label);
  if (toks.length < 2) return 0;
  const hit = toks.filter((t) => sentenceTokens.has(t) || [...sentenceTokens].some((s) => s.length > 4 && t.length > 4 && (s.startsWith(t.slice(0, 5)) || t.startsWith(s.slice(0, 5)) ))).length;
  return hit / toks.length;
}

export function checkVoice(text: string, ctx: VerifyContext): Violation[] {
  const out: Violation[] = [];
  const trimmed = text.trim();
  if (trimmed.length === 0) out.push(vl("empty", "", "empty text"));
  if (trimmed.length > 1400) out.push(vl("too_long", `${trimmed.length} chars`, "text is too long for one turn"));

  const list = trimmed.match(LIST_LINE);
  if (list) out.push(vl("format_list", list[0].trim().slice(0, 40), "no list formatting: one question in prose"));
  if (/\n\s*\n/.test(trimmed) && (trimmed.match(/\n/g) ?? []).length > 4) out.push(vl("format_multiline", "blank lines", "too many paragraphs for one turn"));
  if (/[*_#]{2,}|`/.test(trimmed)) out.push(vl("format_markdown", "markdown", "no markdown formatting"));

  if (ctx.surface === "understanding") {
    const p = trimmed.match(PERCENT);
    if (p) out.push(vl("percentage_in_understanding", p[0], "no percentage anywhere in Precision Understanding"));
  }

  if (SHERPA_ANY.test(trimmed)) {
    if (!ctx.sherpaAssigned) {
      const poss = trimmed.match(SHERPA_POSSESSIVE) ?? trimmed.match(SHERPA_CONTACT);
      if (poss) out.push(vl("sherpa_before_assignment", poss[0], "never 'your Sherpa' before a real assignment"));
      const implied = trimmed.match(SHERPA_ASSIGNMENT_IMPLIED);
      if (implied) out.push(vl("sherpa_assignment_implied", implied[0], "never imply an assignment"));
      if (!ctx.allowSherpaGeneral) out.push(vl("sherpa_not_introduced", "Sherpa", "no Sherpa before one is assigned (general explanation only when asked)"));
    }
  }

  const promise = trimmed.match(PROMISE);
  if (promise) out.push(vl("promise_of_timing_or_outcome", promise[0], "no promised timing or guaranteed outcome"));
  const meta = trimmed.match(META_LEAK);
  if (meta) out.push(vl("meta_leak", meta[0], "no internal markup or AI self-reference"));

  const tokens = normalizeText(trimmed).split(" ").filter(Boolean);
  if (tokens.length >= 8) {
    const es = stopRatio(tokens, ES_STOP);
    const en = stopRatio(tokens, EN_STOP);
    if (ctx.locale === "es" && en > 0.18 && en > es * 1.5) out.push(vl("locale_mismatch", "en text in es", "reply must be in Spanish"));
    if (ctx.locale === "en" && es > 0.22 && es > en * 1.5) out.push(vl("locale_mismatch", "es text in en", "reply must be in English"));
  }

  // R6 — never re-ask facts the client already confirmed.
  if (ctx.knownFields && ctx.knownFields.length > 0) {
    const targetLabels = ctx.targetLabels ?? [];
    for (const sentence of splitSentences(trimmed)) {
      if (!/[?¿]/.test(sentence)) continue;
      const toks = new Set(normalizeText(sentence).split(" ").filter(Boolean));
      if (targetLabels.some((l) => coverage(toks, l) >= 0.5)) continue;
      for (const k of ctx.knownFields) {
        if (coverage(toks, k.label) >= 0.8) {
          out.push(vl("reask_known_fact", k.fieldKey, "never re-ask a fact the client already gave", "R6"));
          break;
        }
      }
    }
  }
  return out;
}
