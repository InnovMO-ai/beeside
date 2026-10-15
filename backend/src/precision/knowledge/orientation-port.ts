/**
 * Level-2 orientation for the Understanding engine, over the Knowledge Service. It answers from approved sources only, always names the
 * source, says what the source is (context, not an obligation) and never recommends a place. When the question needs a finer level than
 * the sources cover, it says so and leaves a note for the specialist.
 */
import type { OrientationPort } from "../understanding/engine";
import { professionalAsk } from "./boundary";
import { topicDrivers } from "./drivers";
import { describeComparison, orient } from "./orient";
import { citation } from "./retrieve";
import { classifyTopics } from "./topics";
import type { KnowledgeRepository, Topic } from "./types";
import type { Frame } from "../understanding/types";

const clip = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

export function jurisdictionOf(frame: Frame): string | null {
  return frame.countries.find((c) => c.role === "operation")?.code ?? frame.countries.find((c) => c.role === "sales")?.code ?? null;
}

export function createOrientationPort(repo: KnowledgeRepository): OrientationPort {
  return {
    async available(frame) {
      const j = jurisdictionOf(frame);
      if (!j) return false;
      return (await repo.listSources({ active: true, jurisdiction: j })).some((s) => s.roles.includes("context") || s.roles.includes("analysis"));
    },
    async answer(frame, question, locale) {
      const j = jurisdictionOf(frame);
      if (!j) return null;
      const drivers = topicDrivers(frame).map((d) => d.topic);
      const asked = classifyTopics(question) as Topic[];
      // The offered orientation ("criterios") speaks about what the project weighs; a real question is answered ONLY for the topics it is about.
      const topics = question === "criterios" ? [...new Set([...asked, ...drivers])].slice(0, 4) : asked.slice(0, 4);
      const boundary = question === "criterios" ? null : professionalAsk(question);
      if (topics.length === 0) return boundary ? { text: "", sourceRefs: [], coverage: "none", reason: "professional_judgment", boundary } : null;
      const states = frame.items["location.candidates"]?.value as string[] | undefined;
      const res = await orient(repo, { text: question === "criterios" ? "" : question, jurisdiction: j, topics, ...(states ? { candidates: states } : {}), limit: 3 });
      const refs = res.hits.map((h) => h.passage.id);
      const parts: string[] = [];
      // the granularity note only introduces context that exists: with nothing to give, the engine states the plain limit instead
      if (res.comparison || res.hits.length > 0) for (const l of res.limits.slice(0, 1)) parts.push(l.message[locale]);
      if (res.comparison) parts.push(describeComparison(res.comparison, locale));
      else if (res.hits.length > 0) {
        const h = res.hits[0]!;
        const cite = citation(h.provenance);
        const body = clip(h.passage.text.replace(/\s+/g, " "), 260);
        parts.push(locale === "es"
          ? `Como contexto de ${h.provenance.institution}: ${body} Fuente: ${cite}. Es contexto, no una obligación ni una recomendación.`
          : `As context from ${h.provenance.institution}: ${body} Source: ${cite}. This is context, not an obligation or a recommendation.`);
      }
      if (parts.length === 0) return boundary ? { text: "", sourceRefs: [], coverage: "none", reason: "professional_judgment", boundary } : null;
      const text = clip(parts.join(" "), 900);
      const sherpaNote = res.sherpaFlag?.reason;
      // coverage: a granularity limit or a professional-judgment ask means approved knowledge covers only part of what was asked
      const granular = res.limits.length > 0 && parts.length > 0;
      const coverage = granular || boundary ? "partial" : "full";
      return { text, sourceRefs: refs, coverage, ...(granular ? { reason: "granularity" as const } : boundary ? { reason: "professional_judgment" as const } : {}), ...(boundary ? { boundary } : {}), ...(sherpaNote ? { sherpaNote } : {}) };
    },
  };
}
