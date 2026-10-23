/**
 * Text hygiene for everything that leaves Precision toward Operation Hub (and into the Preview that mirrors it).
 * Free text comes from the client (untrusted): markup is neutralised, control and invisible direction characters are
 * removed, whitespace is normalised and length is bounded. Structure (newlines between entries) is preserved.
 */
const MAX_TEXT = 4000;
// C0/C1 controls except \n, zero-width and bidi override/isolate characters, BOM, line/paragraph separators.
const RANGES: Array<[number, number]> = [[0x00, 0x09], [0x0b, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x2064], [0x2066, 0x2069], [0xfeff, 0xfeff]];
const hex = (n: number): string => `\\u${n.toString(16).padStart(4, "0")}`;
const INVISIBLE = new RegExp(`[${RANGES.map(([a, b]) => (a === b ? hex(a) : `${hex(a)}-${hex(b)}`)).join("")}]`, "g");

export function sanitizeText(input: unknown, max = MAX_TEXT): string {
  if (typeof input !== "string") return "";
  let t = input.normalize("NFC").replace(/\r\n?/g, "\n").replace(/\t/g, " ").replace(INVISIBLE, "");
  t = t.replace(/<\s*\/?\s*[A-Za-z!?][^>]*>/g, " "); // tags
  t = t.replace(/[<>]/g, ""); // leftovers
  t = t.replace(/&(?:#\d+|#x[0-9a-f]+|[a-z]+);/gi, " "); // entities are never meaningful here
  t = t
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

export function sanitizeOrNull(input: unknown, max = MAX_TEXT): string | null {
  const t = sanitizeText(input, max);
  return t === "" ? null : t;
}
