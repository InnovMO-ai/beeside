/**
 * R10 — country-specific legal/regulatory claims need an approved source (Build Readiness §M-2).
 *
 * A *statement* (not a question) that names a country AND asserts an obligation, prohibition, rate or
 * regulatory fact is a claim. It is accepted only when the sentence is contained in (or contains) the text of
 * an approved source (manifest/overlay help, sector/territory knowledge) supplied by the context. Questions
 * ("what is the license status for Mexico?") are never claims.
 */
import { normalizeText, splitSentences } from "../text-utils";
import type { Violation, VerifyContext } from "./types";

/** Compact table of common country names (normalized, accent-free). Destination names from the context are added. */
const COUNTRY_NAMES = [
  "mexico", "estados unidos", "eeuu", "ee uu", "united states", "canada", "espana", "spain", "alemania", "germany",
  "francia", "france", "italia", "italy", "reino unido", "united kingdom", "paises bajos", "netherlands", "holanda",
  "portugal", "belgica", "belgium", "suiza", "switzerland", "polonia", "poland", "singapur", "singapore", "china", "japon",
  "japan", "corea del sur", "south korea", "india", "emiratos arabes", "united arab emirates", "uae", "arabia saudita",
  "saudi arabia", "brasil", "brazil", "argentina", "chile", "colombia", "peru", "panama", "costa rica", "guatemala",
  "australia", "nueva zelanda", "new zealand", "turquia", "turkey", "vietnam", "tailandia", "thailand", "indonesia",
];

const CLAIM_ES = [
  /\b(ley|leyes|normativa|reglamento|regulacion|regulaciones|regulatori[oa]s?|legalmente|ilegal|prohibid[oa]s?|sancion(es)?|multas?)\b/,
  /\b(es|son|esta|estan)\s+(obligatori[oa]s?|necesari[oa]s?|exigid[oa]s?)\b/,
  /\b(se\s+requiere|se\s+exige|es\s+necesario|hay\s+que|debes|tienes\s+que|necesitas|necesitaras|exigen?|requiere[n]?)\s+(?:\w+\s+){0,3}(permiso|licencia|registro|certificad[oa]|autorizacion|impuesto|arancel|inscripcion|aviso)\b/,
  /\b(iva|isr|impuesto|arancel|tasa)\b.*\b\d+(\s*%|\s+por\s+ciento)/,
];
const CLAIM_EN = [
  /\b(law|laws|legal|legally|illegal|regulation|regulations|regulatory|prohibited|penalt(y|ies)|fines?)\b/,
  /\b(is|are)\s+(mandatory|required|compulsory)\b/,
  /\b(you\s+(need|must|have\s+to|will\s+need)|is\s+required|are\s+required|requires?|required\s+to)\s+(?:\w+\s+){0,3}(permit|license|licence|registration|certificate|authori[sz]ation|tax|tariff|duty|filing)\b/,
  /\b(vat|tax|duty|tariff|rate)\b.*\b\d+(\s*%|\s+percent)/,
];

function countryRegex(extra: readonly string[]): RegExp {
  const names = [...COUNTRY_NAMES, ...extra.map(normalizeText).filter(Boolean)];
  const unique = [...new Set(names)].sort((a, b) => b.length - a.length);
  return new RegExp(`(?:^|\\s)(?:${unique.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(?=\\s|$)`);
}

function isApproved(sentenceNorm: string, sources: VerifyContext["approvedSources"]): boolean {
  return sources.some((s) => {
    const src = normalizeText(s.text);
    return src.length > 0 && (src.includes(sentenceNorm) || sentenceNorm.includes(src));
  });
}

export interface CountryClaim { sentence: string; country: string }

export function findCountryClaims(text: string, ctx: Pick<VerifyContext, "locale" | "approvedSources" | "extraCountryNames">): CountryClaim[] {
  const countryRe = countryRegex(ctx.extraCountryNames ?? []);
  const claims: CountryClaim[] = [];
  for (const sentence of splitSentences(text)) {
    if (/[?¿]/.test(sentence)) continue; // questions are never claims
    const norm = normalizeText(sentence);
    const c = countryRe.exec(norm);
    if (!c) continue;
    const patterns = [...CLAIM_ES, ...CLAIM_EN];
    if (!patterns.some((p) => p.test(norm))) continue;
    if (isApproved(norm, ctx.approvedSources)) continue;
    claims.push({ sentence, country: c[0].trim() });
  }
  return claims;
}

export function checkCountryClaims(text: string, ctx: Pick<VerifyContext, "locale" | "approvedSources" | "extraCountryNames">): Violation[] {
  return findCountryClaims(text, ctx).map((c) => ({
    rule: "R10" as const,
    code: "unapproved_country_claim",
    hit: c.sentence.slice(0, 120),
    message: "country-specific legal or regulatory claim without an approved source",
    critical: true,
  }));
}

/** True when the client message itself asks a country-specific legal/regulatory question (no source can be cited). */
export function isCountryLegalQuestion(clientText: string, extraCountryNames: readonly string[] = []): boolean {
  const norm = normalizeText(clientText);
  if (!countryRegex(extraCountryNames).test(norm)) return false;
  const legalCue =
    /\b(ley|leyes|legal|legalmente|normativa|reglamento|regulacion|regulaciones|obligatori[oa]|permiso|licencia|impuestos?|aranceles?|arancel|iva|requisitos? legales?|law|laws|regulation|regulations|mandatory|permit|license|licence|tax|taxes|tariff|duty|duties|vat|legally)\b/;
  const asksQuestion = /\?|^\s*(que|cual|cuales|como|cuando|necesito|debo|tengo que|hay que|es obligatorio|se necesita|do i|must i|what|which|how|is it|are there|need)\b/.test(norm) || clientText.includes("?");
  return legalCue.test(norm) && asksQuestion;
}
