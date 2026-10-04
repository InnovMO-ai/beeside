/** Accent- and case-insensitive normalization used for deterministic keyword matching (no AI, D-077). */
export function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9&\s-]/g, ' ').replace(/\s+/g, ' ').trim();
}
/** Whole-token / phrase containment on normalized text. */
export function containsTerm(haystackNorm: string, term: string): boolean {
  const t = norm(term);
  if (!t) return false;
  return (` ${haystackNorm} `).includes(` ${t} `) || (t.length >= 6 && haystackNorm.includes(t));
}
