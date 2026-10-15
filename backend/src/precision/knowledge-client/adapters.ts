/**
 * Adapters from the Knowledge Layer contract to the ports the Understanding engine consumes.
 *
 * Everything here is Precision's own: reading the project Frame (which country, which topics the project weighs, which service-map
 * category a question belongs to), and wording what the layer returned for a conversation (context, never an obligation or a
 * recommendation). Everything knowledge-related — what is known, from which source, edition and version, how well it covers a
 * question, where the professional boundary lies, what counts as a demand — is the layer's, reached ONLY through `KnowledgeLayer`.
 */
import type { KnowledgeLayer, Topic } from "../../knowledge-layer/contract";
import type { Frame } from "../understanding/types";
import { topicDrivers } from "./drivers";
import type { DemandPort, OrientationAnswer, OrientationPort, ResourcesPort } from "./ports";

const clip = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

/** The country a knowledge request is about: where the operation happens, else where the project sells. */
export function jurisdictionOf(frame: Frame): string | null {
  return frame.countries.find((c) => c.role === "operation")?.code ?? frame.countries.find((c) => c.role === "sales")?.code ?? null;
}

const countryOf = (frame: Frame): string => {
  const j = jurisdictionOf(frame);
  return j ? String(j).toUpperCase().slice(0, 2) : "unknown";
};

// ------------------------------------------------------------------ orientation
export function createOrientationPort(kl: KnowledgeLayer): OrientationPort {
  return {
    async available(frame) {
      return (await kl.coverage(jurisdictionOf(frame))).available;
    },
    async answer(frame, question, locale): Promise<OrientationAnswer | null> {
      const j = jurisdictionOf(frame);
      if (!j) return null;
      const criteria = question === "criterios";
      const states = frame.items["location.candidates"]?.value as string[] | undefined;
      const res = await kl.request({
        jurisdiction: j, language: locale, limit: 3,
        ...(criteria ? { intent: "project_context" as const, topics: topicDrivers(frame).map((d) => d.topic as Topic) } : { intent: "answer_question" as const, question }),
        ...(states ? { context: { candidates: states } } : {}),
      });
      const boundary = res.boundary ? { kind: res.boundary.kind, area: res.boundary.area } : undefined;
      if (res.units.length === 0 && !res.comparison) {
        return boundary ? { text: "", sourceRefs: [], coverage: "none", reason: "professional_judgment", boundary } : null;
      }
      const parts: string[] = [];
      // the granularity note only introduces context that exists: with nothing to give, the engine states the plain limit instead
      for (const l of res.limits.slice(0, 1)) parts.push(l.message[locale]);
      if (res.comparison) parts.push(res.comparison.summary[locale]);
      else {
        const u = res.units[0]!;
        const body = clip(u.text.replace(/\s+/g, " "), 260);
        parts.push(locale === "es"
          ? `Como contexto de ${u.source.institution}: ${body} Fuente: ${u.citation}. Es contexto, no una obligación ni una recomendación.`
          : `As context from ${u.source.institution}: ${body} Source: ${u.citation}. This is context, not an obligation or a recommendation.`);
      }
      const granular = res.limits.length > 0;
      return {
        text: clip(parts.join(" "), 900),
        sourceRefs: res.units.map((u) => u.id),
        coverage: res.availability === "sufficient" ? "full" : "partial",
        ...(granular ? { reason: "granularity" as const } : boundary ? { reason: "professional_judgment" as const } : {}),
        ...(boundary ? { boundary } : {}),
        ...(res.specialistNote ? { sherpaNote: res.specialistNote } : {}),
      };
    },
  };
}

// ------------------------------------------------------------------ demand
/** Default service-map category for a knowledge topic: how THIS product's Service Map files the topic (the layer knows nothing about it). */
const TOPIC_CATEGORY: Partial<Record<Topic, string>> = {
  taxes: "tax_accounting_audit", corporate_law: "corporate_legal_admin", foreign_investment: "corporate_legal_admin", regulatory_environment: "corporate_legal_admin",
  labor_market: "people_payroll_employment", wages: "people_payroll_employment", social_security: "people_payroll_employment", immigration_mobility: "people_payroll_employment",
  customs: "international_trade_customs", exports_trade: "international_trade_customs",
  transportation_logistics: "logistics", infrastructure: "industrial_real_estate", energy: "industrial_real_estate",
  competitiveness_state: "market_intelligence", economy_innovation: "market_intelligence", education_talent: "market_intelligence", rule_of_law: "market_intelligence",
};

/** The project's own category for a question: a topic's default when the project has that category open, else the specialist area of the boundary. */
function categoryFor(frame: Frame, topic: Topic | "unclassified", boundaryCategory: string | null): string | null {
  const open = new Set(frame.needs.filter((n) => n.status !== "removed" && n.categoryKey).map((n) => n.categoryKey as string));
  const preferred = topic !== "unclassified" ? TOPIC_CATEGORY[topic] ?? null : null;
  if (preferred && open.has(preferred)) return preferred;
  if (boundaryCategory && open.has(boundaryCategory)) return boundaryCategory;
  return preferred ?? boundaryCategory;
}

export function createDemandPort(kl: KnowledgeLayer, opts: { onError?: (err: unknown) => void } = {}): DemandPort {
  return {
    async register(i) {
      if (i.outcome.coverage === "full" && !i.outcome.boundary) return null;
      try {
        // the question is read for classification only; what crosses to the layer's registry is the normalised signal
        const reading = await kl.interpret(i.question);
        const boundary = i.outcome.boundary ?? reading.boundary?.kind;
        const categoryKey = categoryFor(i.frame, reading.topic, reading.boundary?.specialistCategoryKey ?? null);
        const serviceKey = categoryKey ? (i.frame.needs.find((n) => n.status !== "removed" && n.categoryKey === categoryKey)?.serviceKeys[0] ?? null) : null;
        const receipt = await kl.recordDemand({ projectId: i.projectId, turnKey: i.turnKey }, {
          country: countryOf(i.frame), topic: reading.topic, subtopic: reading.subtopic, infoType: reading.infoType, categoryKey, serviceKey,
          outcome: { coverage: i.outcome.coverage, reason: i.outcome.reason, ...(boundary ? { boundary } : {}) },
        });
        return receipt ? { topic: receipt.topic, subtopic: receipt.subtopic, infoType: receipt.infoType, coverage: receipt.coverage, boundary: receipt.boundary ? { kind: receipt.boundary.kind, area: receipt.boundary.area } : null } : null;
      } catch (err) {
        opts.onError?.(err);
        return null;
      }
    },
  };
}

// ------------------------------------------------------------------ country resources
const DESTINATION_ROLES = new Set(["operation", "sales"]);

/**
 * Country guides ("Doing Business in Mexico"-style) published through the layer, offered inside the conversation ONCE, only for a country
 * where the operation will happen (or sell), only when its topic is on the table (or it has no topic and the client is already at the
 * priority moment), always optional. The text never carries the destination: the client opens it through the resolver endpoint.
 */
export function createResourcesPort(kl: KnowledgeLayer): ResourcesPort {
  return {
    async offer(frame, locale, now, stage) {
      const countries = [...new Set(frame.countries.filter((c) => DESTINATION_ROLES.has(c.role)).map((c) => c.code.toUpperCase()))];
      if (countries.length === 0) return null;
      const topics = [...new Set([...Object.keys(frame.concepts), ...frame.needs.flatMap((n) => n.conceptIds), ...topicDrivers(frame).map((d) => d.topic as string)])];
      const alreadyOffered = Object.keys(frame.asked).filter((k) => k.startsWith("res:")).map((k) => k.slice(4));
      for (const country of countries) {
        const resources = await kl.resources({ country, language: locale, now });
        const usable = resources.filter((r) => (r.topic ? topics.includes(r.topic) : stage === "priority"));
        const r = usable.find((x) => !alreadyOffered.includes(x.id) && (!x.topic || topics.includes(x.topic)));
        if (r) {
          const text = locale === "es"
            ? `Si quieres contexto general, tengo una guía disponible: «${r.title}». No es necesario leerla para seguir.`
            : `If you want general context, I have a guide available: “${r.title}”. You do not need to read it to continue.`;
          return { key: `res:${r.id}`, id: r.id, title: r.title, text };
        }
      }
      return null;
    },
  };
}
