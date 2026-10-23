/**
 * Knowledge drives the CONVERSATION, not only the answers: what the project is (150 hires, a logistics hub, a site decision) decides
 * which knowledge topics are relevant, which orientation to offer, and which source references a finding can point to.
 */
import { LOCATION_CRITERIA } from "../understanding/criteria";
import type { Frame, L10n } from "../understanding/types";
import type { Topic } from "../../knowledge-layer/contract";

export interface TopicDriver { topic: Topic; reason: L10n; origin: "criteria" | "headcount" | "logistics" | "investment" }

export function topicDrivers(frame: Frame): TopicDriver[] {
  const out: TopicDriver[] = [];
  const add = (topic: Topic, origin: TopicDriver["origin"], es: string, en: string): void => { if (!out.some((d) => d.topic === topic)) out.push({ topic, origin, reason: { es, en } }); };
  const crit = frame.items["location.criteria"];
  if (crit?.status === "known" && Array.isArray(crit.value)) {
    for (const id of crit.value as string[]) {
      const c = LOCATION_CRITERIA.find((x) => x.id === id);
      for (const t of c?.topics ?? []) add(t as Topic, "criteria", `Dijiste que pesa ${c!.label.es}.`, `You said ${c!.label.en} weighs most.`);
    }
  }
  const head = frame.items["workforce.headcount"];
  const n = head?.status === "known" ? ((head.value as { max?: number } | undefined)?.max ?? 0) : 0;
  if (n >= 50) { add("labor_market", "headcount", `Planeas contratar alrededor de ${n} personas.`, `You plan to hire around ${n} people.`); add("wages", "headcount", `Planeas contratar alrededor de ${n} personas.`, `You plan to hire around ${n} people.`); }
  if (frame.concepts["industrial_site"] || frame.concepts["logistics_transport"] || frame.concepts["warehousing"]) {
    add("infrastructure", "logistics", "Tu proyecto mueve o almacena mercancía.", "Your project moves or stores goods.");
    add("transportation_logistics", "logistics", "Tu proyecto mueve o almacena mercancía.", "Your project moves or stores goods.");
  }
  return out;
}

/** A single optional offer, only when the location is still open and a state-level source can speak to what the client weighs. */
export function orientationOffer(frame: Frame, hasSources: boolean): { topics: Topic[]; question: L10n } | null {
  if (!hasSources) return null;
  const loc = frame.items["location.criteria"];
  if (!loc || loc.status !== "known") return null;
  if (frame.asked["offer:orientation"]) return null;
  const topics = topicDrivers(frame).filter((d) => d.origin === "criteria").map((d) => d.topic);
  if (topics.length === 0) return null;
  return {
    topics: [...new Set(topics)],
    question: {
      es: `Si te sirve, puedo darte contexto de competitividad por estado sobre ${loc.display}. Es orientación, no una recomendación. ¿Quieres verlo?`,
      en: `If useful, I can give you state-level competitiveness context on ${loc.display}. It is orientation, not a recommendation. Would you like to see it?`,
    },
  };
}
