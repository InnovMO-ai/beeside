// Prototipo de Design (NO es código de Precision): compara el comparador actual de R10 (contención de texto)
// con el propuesto (igualdad exacta de la frase normalizada contra afirmaciones aprobadas y versionadas).
// normalizeText y splitSentences son copia literal de precision/conversation/text-utils.ts @ a8f8f3e.
import { createHash } from "node:crypto";

function normalizeText(s) {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}
function stripPlaceholders(t) { return t.replace(/\[[^\]]+\]/g, "x").replace(/\{[A-Za-z_]+\}/g, "x"); }
function splitSentences(text) { return stripPlaceholders(text).split(/(?<=[.?!…])\s+|\n+/).map((s) => s.trim()).filter(Boolean); }

// Detector de R10 sin cambios (versión reducida del original: país + señal legal; preguntas excluidas).
const COUNTRIES = ["mexico", "chile", "colombia", "espana", "spain", "united states"];
const CLAIM = [/\b(ley|leyes|normativa|reglamento|obligatori[oa]s?|law|laws|mandatory|required)\b/, /\b(se\s+requiere|debes|tienes\s+que|necesitas|you\s+(need|must))\b/, /\b(iva|isr|impuesto|arancel|tasa|vat|tax)\b.*\b\d+(\s*%|\s+por\s+ciento|\s+percent)/];
const isClaim = (n) => COUNTRIES.some((c) => new RegExp(`(^|\\s)${c}(\\s|$)`).test(n)) && CLAIM.some((p) => p.test(n));

// ---- Comparador ACTUAL (country-claims.ts: isApproved)
function approvedCurrent(sentenceNorm, sources) {
  return sources.some((s) => { const src = normalizeText(s.text); return src.length > 0 && (src.includes(sentenceNorm) || sentenceNorm.includes(src)); });
}
// ---- Comparador PROPUESTO: igualdad exacta + idioma + vigencia; devuelve el claimId aprobado
const sha = (s) => createHash("sha256").update(s).digest("hex");
function indexClaims(claims) {
  const m = new Map();
  for (const c of claims) {
    const n = normalizeText(c.text);
    if (sha(n) !== c.normalizedSha256) throw new Error(`huella inválida en ${c.claimId}`);
    m.set(`${c.locale}|${n}`, [...(m.get(`${c.locale}|${n}`) ?? []), c]);
  }
  return m;
}
function approvedProposed(sentenceNorm, index, locale, now) {
  const hit = (index.get(`${locale}|${sentenceNorm}`) ?? []).find((c) => !c.authorization.validUntil || c.authorization.validUntil >= now);
  return hit ? hit.claimId : null;
}

const claim = (claimId, locale, country, text, validUntil) => ({
  claimId, unitRef: claimId.split("#")[0], country, locale, text, normalizedSha256: sha(normalizeText(text)), authority: "A",
  authorization: { kind: "specialist_validated", validationRef: "val-0001", validUntil },
});
// Afirmaciones de PRUEBA (textos sintéticos para el verificador; no son conocimiento de KL).
const CLAIMS = [
  claim("test.card.vat_general@1#1", "es", "CL", "En Chile el IVA general es del 19 por ciento."),
  claim("test.card.vat_border@1#1", "es", "MX", "En México el IVA general es del 16 por ciento, salvo en la región fronteriza, donde se aplica una tasa reducida."),
  claim("test.card.expired@1#1", "es", "MX", "En México la ley exige el registro previo de esta actividad ante la autoridad competente.", "2026-01-01"),
];
const SOURCES_SHORT = [{ sourceRef: "x", text: "IVA del 19 por ciento" }];
const NOW = "2026-10-16";
const idx = indexClaims(CLAIMS);

const cases = [
  ["P1 idéntica", "es", "En Chile el IVA general es del 19 por ciento.", CLAIMS, true],
  ["P2 solo mayúsculas, acentos y puntuación", "es", "en chile, el iva general es del 19 por ciento", CLAIMS, true],
  ["N1 extensión en la misma frase", "es", "En Chile el IVA general es del 19 por ciento y no aplica a servicios digitales.", CLAIMS, false],
  ["N2 truncamiento que borra la excepción", "es", "En México el IVA general es del 16 por ciento.", CLAIMS, false],
  ["N3 fuente corta que aprueba frases largas", "es", "En Chile el IVA del 19 por ciento no aplica a exportadores de servicios.", SOURCES_SHORT, false],
  ["N4 negación", "es", "No es cierto que en Chile el IVA general es del 19 por ciento.", CLAIMS, false],
  ["N5 idioma distinto", "en", "In Chile the general VAT is 19 percent.", CLAIMS, false],
  ["N6 afirmación vencida", "es", "En México la ley exige el registro previo de esta actividad ante la autoridad competente.", CLAIMS, false],
  ["N7 cifra cambiada", "es", "En Chile el IVA general es del 18 por ciento.", CLAIMS, false],
  ["N8 dos afirmaciones unidas", "es", "En Chile el IVA general es del 19 por ciento y en México el IVA general es del 16 por ciento.", CLAIMS, false],
];

const rows = [];
for (const [name, locale, text, src, expectApproved] of cases) {
  for (const sent of splitSentences(text)) {
    const n = normalizeText(sent);
    if (!isClaim(n)) { rows.push({ name, note: "no es afirmación para R10" }); continue; }
    const current = src === SOURCES_SHORT ? approvedCurrent(n, src) : approvedCurrent(n, CLAIMS);
    const proposedId = src === SOURCES_SHORT ? null : approvedProposed(n, idx, locale, NOW);
    rows.push({ name, expectApproved, current, proposed: !!proposedId, claimId: proposedId, ok: !!proposedId === expectApproved });
  }
}
console.table(rows);
const failed = rows.filter((r) => r.ok === false);
const unsafeToday = rows.filter((r) => r.expectApproved === false && r.current === true).map((r) => r.name);
console.log(JSON.stringify({ proposed_all_expected: failed.length === 0, current_wrongly_approves: unsafeToday }, null, 1));
if (failed.length) process.exit(1);
