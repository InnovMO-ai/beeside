/**
 * Level 2 — ORIENT. Turns a client objective into relevant criteria, retrieves indicators, compares and states trade-offs, and raises
 * project-specific questions. It orients; it never recommends a place and never turns an index score into a decision.
 *
 * Granularity guard: a state-level source cannot speak about a municipality or city. When the client names one, the answer says so,
 * offers the state-level context clearly labelled as such (or another approved source if one exists), and flags it for the specialist.
 */
import { fold } from "../understanding/text";
import { findPlaces, findStates } from "./geo";
import { retrieve } from "./retrieve";
import type { Granularity, Hit, Indicator, KnowledgeRepository, Topic } from "./types";

const RANK: Record<Granularity, number> = { none: 0, country: 1, sector: 1, state: 2, municipality: 3, city: 3 };

export interface GranularityLimit {
  place: string;
  state: string;
  /** The finest level the available sources cover for the requested topics. */
  availableLevel: Granularity;
  message: { es: string; en: string };
}
export interface ComparisonRow { criterion: string; topic: Topic; entries: { unit: string; value: number | string; rank?: number; year?: string; hit: Hit }[]; leader?: string }
export interface Comparison { rows: ComparisonRow[]; units: string[] }
export interface Orientation {
  hits: Hit[];
  limits: GranularityLimit[];
  comparison?: Comparison;
  /** Raised when the client's real question cannot be answered from approved sources: the specialist takes it. */
  sherpaFlag?: { reason: string; basis: string[] };
  /** Always false: orientation never recommends a place. Kept explicit so consumers cannot assume otherwise. */
  recommends: false;
}

export interface OrientRequest { text: string; jurisdiction: string; topics: Topic[]; candidates?: string[]; limit?: number }

export async function orient(repo: KnowledgeRepository, req: OrientRequest): Promise<Orientation> {
  const places = findPlaces(req.text);
  const states = [...new Set([...(req.candidates ?? []).flatMap((c) => findStates(c)), ...findStates(req.text), ...places.map((p) => p.state).filter(Boolean)])];

  const sources = await repo.listSources({ active: true, jurisdiction: req.jurisdiction });
  const best = sources.filter((s) => s.topics.some((t) => req.topics.includes(t))).reduce<Granularity>((a, s) => (RANK[s.granularity] > RANK[a] ? s.granularity : a), "none");

  const limits: GranularityLimit[] = [];
  for (const p of places) {
    if (RANK[best] >= RANK.municipality) continue;
    const lvl = best === "state" ? "estatal" : "nacional";
    const lvlEn = best === "state" ? "state-level" : "national";
    limits.push({
      place: p.name, state: p.state, availableLevel: best,
      message: {
        es: `Las fuentes que tengo cubren el nivel ${lvl}, no ${p.name} como municipio o ciudad; por eso no te daré una lectura de ${p.name} en sí.${p.state ? ` Sí puedo darte contexto de ${p.state} como estado, señalando que es del estado y no de ${p.name}.` : ""}`,
        en: `The sources I have cover the ${lvlEn} level, not ${p.name} as a municipality or city, so I will not give you a reading of ${p.name} itself.${p.state ? ` I can give you ${p.state} context as a state, making clear it is state-level and not about ${p.name}.` : ""}`,
      },
    });
  }

  let hits = await retrieve(repo, { text: req.text, topics: req.topics, jurisdiction: req.jurisdiction, units: states, limit: (req.limit ?? 6) * 2 });
  // Never present a passage as being about a finer unit than its source supports.
  hits = hits.filter((h) => !(h.passage.granularity === "municipality" && RANK[best] < RANK.municipality));
  hits = hits.slice(0, req.limit ?? 6);

  let comparison: Comparison | undefined;
  if (states.length >= 2) comparison = compare(await indicatorHits(repo, req, states), states, req.topics);

  const res: Orientation = { hits, limits, ...(comparison && comparison.rows.length ? { comparison } : {}), recommends: false };
  if (limits.length) res.sherpaFlag = { reason: `Pregunta sobre ${limits.map((l) => l.place).join(", ")} a nivel municipal/ciudad; las fuentes aprobadas cubren hasta nivel ${best === "state" ? "estatal" : "nacional"}.`, basis: limits.map((l) => l.place) };
  else if (hits.length === 0) res.sherpaFlag = { reason: "Sin fuentes aprobadas que cubran la pregunta de orientación.", basis: req.topics };
  return res;
}

async function indicatorHits(repo: KnowledgeRepository, req: OrientRequest, states: string[]): Promise<Hit[]> {
  const all = await retrieve(repo, { topics: req.topics, jurisdiction: req.jurisdiction, units: states, limit: 200 });
  return all.filter((h) => h.passage.indicators.some((i) => i.unitKind === "state" && states.some((s) => fold(s) === fold(i.unit))));
}

function compare(hits: Hit[], states: string[], topics: Topic[]): Comparison {
  const byCriterion = new Map<string, ComparisonRow>();
  for (const h of hits) {
    for (const ind of h.passage.indicators as Indicator[]) {
      if (ind.unitKind !== "state" || !states.some((s) => fold(s) === fold(ind.unit))) continue;
      const topic = h.passage.topics.find((t) => topics.includes(t)) ?? h.passage.topics[0];
      if (!topic) continue;
      const key = `${topic}|${ind.name}`;
      const row = byCriterion.get(key) ?? { criterion: ind.name, topic, entries: [] };
      if (!row.entries.some((e) => fold(e.unit) === fold(ind.unit))) row.entries.push({ unit: ind.unit, value: ind.value, ...(ind.rank !== undefined ? { rank: ind.rank } : {}), ...(ind.year ? { year: ind.year } : {}), hit: h });
      byCriterion.set(key, row);
    }
  }
  const rows = [...byCriterion.values()].filter((r) => r.entries.length >= 2);
  for (const r of rows) {
    const withRank = r.entries.filter((e) => e.rank !== undefined);
    if (withRank.length === r.entries.length) r.leader = withRank.sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))[0]?.unit;
    else if (r.entries.every((e) => typeof e.value === "number")) r.leader = [...r.entries].sort((a, b) => Number(b.value) - Number(a.value))[0]?.unit;
  }
  return { rows, units: states };
}

/** Neutral trade-off wording. No recommendation, ever; it names the source and the criterion. */
export function describeComparison(c: Comparison, loc: "es" | "en"): string {
  const lines = c.rows.map((r) => {
    const parts = r.entries.map((e) => `${e.unit}${e.rank !== undefined ? ` (${loc === "es" ? "lugar" : "rank"} ${e.rank})` : ` (${e.value})`}`).join(loc === "es" ? ", " : ", ");
    return loc === "es" ? `En «${r.criterion}»: ${parts}` : `On “${r.criterion}”: ${parts}`;
  });
  const tail = loc === "es" ? "Es contexto de competitividad, no una recomendación de dónde ubicarte." : "This is competitiveness context, not a recommendation on where to locate.";
  return `${lines.join(". ")}. ${tail}`;
}
