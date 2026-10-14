/** Sections -> retrievable passages with topics, geographic units and structured indicators. */
import { classifyTopics } from "./topics";
import { findPlaces, findStates, MX_STATES } from "./geo";
import type { Granularity, Indicator, KnowledgePassage } from "./types";
import type { Section } from "./extract";

const MAX = 900;

export function splitSection(s: Section): { location: string; text: string; row?: Record<string, string> }[] {
  if (s.row || s.text.length <= MAX) return [s];
  const out: { location: string; text: string }[] = [];
  const sentences = s.text.split(/(?<=[.!?])\s+|\n+/);
  let buf = "";
  for (const sn of sentences) {
    if ((buf + " " + sn).length > MAX && buf) { out.push({ location: s.location, text: buf.trim() }); buf = sn; } else buf = buf ? `${buf} ${sn}` : sn;
  }
  if (buf.trim()) out.push({ location: s.location, text: buf.trim() });
  return out;
}

const pick = (row: Record<string, string>, names: string[]): string | undefined => {
  for (const k of Object.keys(row)) if (names.includes(k.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim())) return row[k];
  return undefined;
};

export function indicatorFromRow(row: Record<string, string>): Indicator | null {
  const unit = pick(row, ["estado", "entidad", "entidad federativa", "unidad", "state", "municipio", "ciudad", "city"]);
  const name = pick(row, ["indicador", "subindice", "indicator", "variable", "tema"]);
  const value = pick(row, ["valor", "value", "puntaje", "score", "calificacion"]);
  if (!unit || !name || value === undefined || value === "") return null;
  const num = Number(value.replace(/,/g, ""));
  const rank = pick(row, ["lugar", "posicion", "rank", "ranking"]);
  const year = pick(row, ["ano", "year", "edicion", "periodo"]);
  const kind: Granularity = pick(row, ["municipio", "ciudad", "city"]) ? "municipality" : MX_STATES.some((s) => s.toLowerCase() === unit.toLowerCase()) || findStates(unit).length ? "state" : unit.toLowerCase() === "nacional" ? "country" : "none";
  return { name, unit, unitKind: kind, value: Number.isFinite(num) ? num : value, ...(year ? { year } : {}), ...(rank && Number.isFinite(Number(rank)) ? { rank: Number(rank) } : {}) };
}

export interface ChunkContext { documentId: string; sourceId: string; defaultTopics?: KnowledgePassage["topics"] }

export function chunkSections(sections: Section[], ctx: ChunkContext): KnowledgePassage[] {
  const out: KnowledgePassage[] = [];
  let ord = 0;
  for (const sec of sections) {
    for (const part of splitSection(sec)) {
      if (!part.text.trim()) continue;
      const states = findStates(part.text);
      const places = findPlaces(part.text);
      const row = (part as { row?: Record<string, string> }).row;
      const ind = row ? indicatorFromRow(row) : null;
      const units = [...new Set([...states, ...places.map((p) => p.name), ...(ind ? [ind.unit] : [])])];
      const granularity: Granularity = places.length ? "municipality" : ind ? ind.unitKind : states.length ? "state" : "country";
      let topics = classifyTopics(`${part.text} ${ind?.name ?? ""}`);
      if (topics.length === 0 && ctx.defaultTopics) topics = ctx.defaultTopics.slice(0, 2);
      out.push({ id: `${ctx.documentId}:${ord}`, documentId: ctx.documentId, sourceId: ctx.sourceId, ordinal: ord++, text: part.text, location: part.location, topics, units, granularity, indicators: ind ? [ind] : [] });
    }
  }
  return out;
}
