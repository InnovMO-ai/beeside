/**
 * What ANY consumer does before it talks to the Knowledge Layer (frozen kl.v1 boundary): read the question LOCALLY in the controlled
 * vocabularies and send only structured dimensions. Test helper shared by the layer's own suites; Precision's adapter does the same.
 */
import { createHash } from "node:crypto";
import type { DemandRefs, KnowledgeLayer, KnowledgeRequest, Locale } from "../contract";
import { normalizedQuery, readGeography, readQuestion } from "../vocabulary";

export function structured(question: string, jurisdiction: string | null = "MX", language: Locale = "es", extra: Partial<KnowledgeRequest> = {}): KnowledgeRequest {
  const r = readQuestion(question);
  const g = readGeography(question);
  return {
    jurisdiction, stage: "understanding", intent: "answer_question", language,
    topics: r.topics, topic: r.topic, subtopic: r.subtopic, infoType: r.infoType,
    ...(g.states.length ? { regions: g.states } : {}), ...(g.finerThanState ? { finerThanState: true } : {}),
    query: normalizedQuery(r), ...extra,
  };
}
export const askLocally = (kl: KnowledgeLayer, question: string, jurisdiction: string | null = "MX", extra: Partial<KnowledgeRequest> = {}) => kl.request(structured(question, jurisdiction, "es", extra));

/** Opaque 32-hex references for tests (the layer only validates their shape; Precision derives the real ones with an HMAC). */
export const refsOf = (project: string, turn: string): DemandRefs => ({
  projectRef: createHash("sha256").update(`p:${project}`).digest("hex").slice(0, 32),
  eventRef: createHash("sha256").update(`e:${project}:${turn}`).digest("hex").slice(0, 32),
});
