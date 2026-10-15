/**
 * Indicator sheets in PDFs: a page (or half page) per entity with tables headed "Indicador | Cifra | Posición | Desempeño". Plain text
 * extraction scrambles these tables (two tables side by side, names wrapped over several lines, numbers vertically centred), so they
 * are read by WORD POSITION (`pdftotext -tsv`) and turned into one structured row per indicator: entity, sub-index, indicator, value,
 * position among the entities compared. Nothing here knows any publication: it recognises the table header and the geometry.
 */
import { findStates } from "./geo";

export interface PdfWord { page: number; left: number; top: number; width: number; height: number; text: string }
export interface SheetRow {
  page: number;
  entity: string;
  /** Overall position of the entity on the page heading, when published ("Posición: 19"). */
  entityRank?: number;
  group: string;
  groupRank?: number;
  indicator: string;
  description: string;
  display: string;
  value: number | string;
  rank?: number;
}

/** `pdftotext -tsv` -> words grouped by page. Only word rows (level 5) with text are kept. */
export function parseTsv(tsv: string): Map<number, PdfWord[]> {
  const out = new Map<number, PdfWord[]>();
  for (const line of tsv.split("\n")) {
    const c = line.split("\t");
    if (c.length < 12 || c[0] !== "5") continue;
    const text = (c[11] ?? "").trim();
    if (!text) continue;
    const w: PdfWord = { page: Number(c[1]), left: Number(c[6]), top: Number(c[7]), width: Number(c[8]), height: Number(c[9]), text };
    if (![w.page, w.left, w.top, w.width, w.height].every(Number.isFinite)) continue;
    const list = out.get(w.page) ?? [];
    list.push(w);
    out.set(w.page, list);
  }
  return out;
}

const NUM = /^[-–−]?\$?\(?[-–−]?\d[\d,]*(?:\.\d+)?%?\)?$/;
const toNumber = (s: string): number | null => {
  const n = Number(s.replace(/[$,%()\s]/g, "").replace(/[–−]/g, "-"));
  return Number.isFinite(n) ? n : null;
};

interface Line { top: number; words: PdfWord[] }
const lineOf = (words: PdfWord[]): string => [...words].sort((a, b) => a.left - b.left).map((w) => w.text).join(" ");

/** Groups words into visual lines (same baseline within a tolerance). */
function toLines(words: PdfWord[]): Line[] {
  const sorted = [...words].sort((a, b) => a.top - b.top || a.left - b.left);
  const lines: Line[] = [];
  for (const w of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(w.top - last.top) <= 3) last.words.push(w);
    else lines.push({ top: w.top, words: [w] });
  }
  return lines;
}

/** Text of a block of words in reading order: line by line (top to bottom), each line left to right. */
const linesText = (ws: PdfWord[]): string => toLines(ws).map((l) => lineOf(l.words)).join(" ");
const clean = (s: string): string => s.replace(/\s+/g, " ").trim();

/** Parses one page. Returns [] when the page carries no indicator tables or the entity cannot be named. */
export function parseIndicatorSheet(words: PdfWord[]): SheetRow[] {
  const cifras = words.filter((w) => w.text === "Cifra");
  // a table header row is "Indicador ... Cifra" on one line; an indicator NAME that begins with "Indicador" has no Cifra beside it
  const headers = words.filter((w) => w.text === "Indicador" && cifras.some((c) => Math.abs(c.top - w.top) <= 4 && c.left > w.left && c.left - w.left < 400));
  if (headers.length === 0) return [];

  const firstHeaderTop = Math.min(...headers.map((h) => h.top));
  const head = words.filter((w) => w.top < firstHeaderTop - 30);
  const headText = linesText(head);
  const entity = findStates(headText)[0] ?? null;
  if (!entity) return [];
  const rankTok = head.find((w, i) => /^Posici[oó]n:$/.test(w.text) && head[i + 1]);
  let entityRank: number | undefined;
  if (rankTok) {
    const near = head.filter((w) => Math.abs(w.top - rankTok.top) <= 6 && w.left > rankTok.left && /^\d{1,2}$/.test(w.text)).sort((a, b) => a.left - b.left)[0];
    if (near) entityRank = Number(near.text);
  }

  const rows: SheetRow[] = [];
  const sortedHeaders = [...headers].sort((a, b) => a.top - b.top || a.left - b.left);
  for (const h of sortedHeaders) {
    // columns of the page: the next column to the right of this table, wherever its own header sits vertically
    const nextX = sortedHeaders.filter((o) => o.left > h.left + 40).sort((a, b) => a.left - b.left)[0]?.left ?? Number.POSITIVE_INFINITY;
    const xMin = h.left - 6;
    const xMax = nextX - 6;
    const inX = (w: PdfWord): boolean => w.left >= xMin && w.left < xMax;
    const below = sortedHeaders.filter((o) => o.top > h.top + 20 && Math.abs(o.left - h.left) < 40).sort((a, b) => a.top - b.top)[0];
    const yMax = below ? below.top - 52 : Number.POSITIVE_INFINITY;

    const cifra = cifras.filter((c) => Math.abs(c.top - h.top) <= 4 && c.left > h.left && c.left < xMax).sort((a, b) => a.left - b.left)[0];
    const posicion = words.filter((p) => /^Posici[oó]n$/.test(p.text) && Math.abs(p.top - h.top) <= 4 && cifra && p.left > cifra.left && p.left < xMax).sort((a, b) => a.left - b.left)[0];
    if (!cifra) continue;
    const posX = posicion?.left ?? cifra.left + 27;
    const cifraLo = cifra.left - 16;
    const posLo = posX - 8;
    const posHi = posX + 28;

    // group (sub-index) title and its position, printed above the header
    const titleWords = words.filter((w) => inX(w) && w.top < h.top - 2 && w.top >= h.top - 52 && !/^Posici[oó]n$/.test(w.text) && !/^\d{1,2}$/.test(w.text));
    const group = clean(linesText(titleWords));
    const groupRankTok = words.find((w) => inX(w) && /^\d{1,2}$/.test(w.text) && w.top < h.top - 2 && w.top >= h.top - 52);
    const groupRank = groupRankTok ? Number(groupRankTok.text) : undefined;

    const body = words.filter((w) => inX(w) && w.top > h.top + 8 && w.top < yMax);
    const lines = toLines(body.filter((w) => w.left < cifraLo)).filter((l) => !/^El desempe[nñ]o/i.test(lineOf(l.words)));
    const numLines = toLines(body.filter((w) => w.left >= cifraLo));
    if (lines.length === 0 || numLines.length === 0) continue;

    // rows are blocks of name lines separated by a clearly larger vertical gap than the line pitch inside a block
    const gaps = lines.slice(1).map((l, i) => l.top - (lines[i]?.top ?? 0)).filter((g) => g > 0);
    const small = gaps.filter((g) => g <= 11).sort((a, b) => a - b);
    const pitch = small.length ? small[Math.floor(small.length / 2)]! : 8;
    const threshold = pitch * 1.45;
    const blocks: Line[][] = [];
    for (const l of lines) {
      const cur = blocks[blocks.length - 1];
      const prev = cur?.[cur.length - 1];
      if (cur && prev && l.top - prev.top <= threshold) cur.push(l);
      else blocks.push([l]);
    }
    for (const block of blocks) {
      const top = block[0]!.top - 3;
      const bottom = block[block.length - 1]!.top + 3;
      const nums = numLines.filter((nl) => nl.top >= top && nl.top <= bottom).flatMap((nl) => nl.words);
      const cifraTok = nums.filter((w) => w.left >= cifraLo && w.left < posLo && NUM.test(w.text)).sort((a, b) => a.left - b.left)[0];
      const posTok = nums.filter((w) => w.left >= posLo && w.left < posHi && /^\d{1,2}$/.test(w.text))[0];
      if (!cifraTok) continue;
      const texts = block.map((l) => clean(lineOf(l.words)));
      const firstDesc = texts.findIndex((t, i) => i > 0 && t.startsWith("(")) ;
      const descStart = texts[0]?.startsWith("(") ? 0 : firstDesc;
      const indicator = clean(texts.slice(0, descStart < 0 ? texts.length : Math.max(descStart, 1)).join(" "));
      const description = descStart < 0 ? "" : clean(texts.slice(Math.max(descStart, 1)).join(" "));
      if (!indicator) continue;
      const num = toNumber(cifraTok.text);
      rows.push({
        page: h.page, entity, ...(entityRank !== undefined ? { entityRank } : {}), group, ...(groupRank !== undefined ? { groupRank } : {}),
        indicator, description, display: cifraTok.text, value: num ?? cifraTok.text, ...(posTok ? { rank: Number(posTok.text) } : {}),
      });
    }
  }
  return rows;
}
