import { createHash } from "node:crypto";

/**
 * Normalización de texto para las afirmaciones aprobadas (CR-KL-001): minúsculas, sin acentos, espacios colapsados,
 * sin puntuación final. NOTA DE INTEGRACIÓN: debe coincidir con `normalizeText` de Precision; mientras CR-KL-001 no se
 * acepte la compuerta está apagada y esta función no se ejerce en producción.
 */
export function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.!?;:,\s]+$/g, "")
    .trim();
}

export const sha256Hex = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

export const claimDigest = (text: string): string => sha256Hex(normalizeText(text));

/** Una frase por afirmación (aproximación de splitSentences de Precision): sin saltos y un solo cierre de oración. */
export function isSingleSentence(text: string): boolean {
  const t = text.trim();
  if (t.length < 8 || t.length > 400 || /\n/.test(t)) return false;
  const interior = t.slice(0, -1).match(/[.!?](\s+|$)/g);
  return !interior;
}

export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
