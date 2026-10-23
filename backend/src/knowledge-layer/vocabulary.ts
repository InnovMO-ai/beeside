/**
 * Knowledge Layer — the controlled VOCABULARY PACK (kl.v1), the only part of the layer a consumer may run in its own process.
 *
 * The frozen boundary says KL never receives the client's words: the consumer reads the question LOCALLY, in the layer's controlled
 * vocabularies (topic, subtopic, information type, professional boundary, geography), and sends the layer only the structured result.
 * This module is that local reader. It is PURE: no store, no network, no I/O, no state — a consumer that imports it cannot reach knowledge,
 * only classify its own text. If the layer later runs as a service, this file ships as a versioned package; the contract does not change.
 *
 * `normalizedQuery` writes the optional "consulta normalizada" of the contract: it is composed ONLY from vocabulary terms of the
 * classification, never from the client's text, so by construction it carries no customer or project data.
 */
import { BOUNDARY_AREA, type BoundaryKind } from "./boundary";
import { readQuestion, subtopicTerms, type QuestionReading } from "./demand";
import { findPlaces, findStates } from "./geo";
import { topicTerms } from "./topics";
import type { Topic } from "./types";

export { BOUNDARY_AREA, readQuestion, findPlaces, findStates };
export type { BoundaryKind, QuestionReading };

/** Where the client's question points geographically: states from the controlled gazetteer, and whether it names something finer than a state. */
export interface GeoReading { states: string[]; places: string[]; finerThanState: boolean }
export function readGeography(text: string): GeoReading {
  const places = findPlaces(text);
  const states = [...new Set([...findStates(text), ...places.map((p) => p.state).filter(Boolean)])];
  return { states, places: places.map((p) => p.name), finerThanState: places.length > 0 };
}

const MAX_TERMS = 6;
/**
 * The normalised query for a classified question: the vocabulary terms of its subtopic and topics (deduplicated, capped). It contains
 * no word of the client's text unless that word is itself a vocabulary term, which is what makes it safe to cross the boundary.
 */
export function normalizedQuery(r: { topic: Topic | "unclassified"; topics: Topic[]; subtopic: string }): string {
  const terms: string[] = [...subtopicTerms(r.subtopic).slice(0, 3)];
  const ordered: Topic[] = [...(r.topic !== "unclassified" ? [r.topic] : []), ...r.topics];
  for (const t of [...new Set(ordered)]) terms.push(...topicTerms(t).slice(0, 3));
  return [...new Set(terms)].slice(0, MAX_TERMS).join(" ");
}
