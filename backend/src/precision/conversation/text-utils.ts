/** Small deterministic text helpers shared by the verifiers, the pre-router and the engine. */

/** Lowercase, accent-free, punctuation-free, single-spaced. Used only for matching, never for display. */
export function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Same sentence splitter as the Gate D copy-lint (placeholders collapsed to one word). */
export function stripPlaceholders(t: string): string {
  return t.replace(/\[[^\]]+\]/g, "x").replace(/\{[A-Za-z_]+\}/g, "x");
}

export function splitSentences(text: string): string[] {
  return stripPlaceholders(text)
    .split(/(?<=[.?!…])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function wordCount(s: string): number {
  return s.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

export function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Stable, dependency-free 32-bit FNV-1a hash rendered in base36 (used for deterministic ids/rotations). */
export function hashString(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export function hashNumber(s: string): number {
  return parseInt(hashString(s), 36);
}

export function lowerFirst(s: string): string {
  return s.length > 0 ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}
export function upperFirst(s: string): string {
  return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
