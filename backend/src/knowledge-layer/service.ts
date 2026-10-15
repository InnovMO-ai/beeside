/**
 * The Knowledge Layer service: implements the permanent contract over the layer's own store (sources registry, versioned editions,
 * passages with provenance), the professional boundary, the Knowledge Demand registry and the Country Resource library.
 * This is where the former KSeed capabilities live behind the boundary; nothing here knows about Precision.
 */
import { BOUNDARY_AREA, type BoundaryKind } from "./boundary";
import type {
  Boundary, ComparisonSummary, DemandContext, DemandReceipt, Interpretation, JurisdictionCoverage, KnowledgeLayer, KnowledgeRequest,
  KnowledgeResponse, KnowledgeUnit, Limit, ResourceDescriptor, Unresolved,
} from "./contract";
import { assertNormalized, demandFromSignal, readQuestion, type DemandRepository, type DemandSignal } from "./demand";
import { isOpenable, resolveResources, type CountryResourceRepository } from "./country-resources";
import { describeComparison, orient } from "./orient";
import { citation, wordingClass } from "./retrieve";
import type { Hit, KnowledgeRepository, Topic } from "./types";

export interface KnowledgeLayerDeps {
  knowledge: KnowledgeRepository;
  demand: DemandRepository;
  resources: CountryResourceRepository;
  now?: () => Date;
  onError?: (err: unknown) => void;
}

const boundaryOf = (kind: BoundaryKind | null): Boundary | null => (kind ? { kind, area: { es: BOUNDARY_AREA[kind].es, en: BOUNDARY_AREA[kind].en }, specialistCategoryKey: BOUNDARY_AREA[kind].categoryKey } : null);

function unitOf(h: Hit): KnowledgeUnit {
  const p = h.provenance;
  return {
    id: h.passage.id, text: h.passage.text, topics: h.passage.topics, granularity: h.passage.granularity, units: h.passage.units, indicators: h.passage.indicators,
    source: {
      sourceId: p.sourceId, institution: p.institution, documentId: p.documentId, documentTitle: p.documentTitle, edition: p.edition, version: p.version,
      jurisdiction: p.jurisdiction, ...(p.publishedAt ? { publishedAt: p.publishedAt } : {}), ...(p.effectiveAt ? { effectiveAt: p.effectiveAt } : {}),
      retrievedAt: p.retrievedAt, locator: p.locator, location: p.location, authority: p.authority, roles: p.sourceRoles, risk: p.risk, confidence: p.confidence, status: p.documentStatus,
    },
    citation: citation(p),
    wording: wordingClass(h),
  };
}

export function createKnowledgeLayer(deps: KnowledgeLayerDeps): KnowledgeLayer {
  const { knowledge, demand, resources } = deps;
  const now = (): Date => (deps.now ? deps.now() : new Date());

  const readingOf = (question: string): Interpretation => {
    const r = readQuestion(question);
    return { topics: r.topics, topic: r.topic, subtopic: r.subtopic, infoType: r.infoType, boundary: boundaryOf(r.boundary) };
  };
  const emptyInterpretation: Interpretation = { topics: [], topic: "unclassified", subtopic: "general", infoType: "general_context", boundary: null };

  const coverage = async (jurisdiction: string | null): Promise<JurisdictionCoverage> => {
    if (!jurisdiction) return { jurisdiction: "unknown", available: false, sourceCount: 0, topics: [] };
    const sources = (await knowledge.listSources({ active: true, jurisdiction })).filter((s) => s.roles.includes("context") || s.roles.includes("analysis"));
    return { jurisdiction, available: sources.length > 0, sourceCount: sources.length, topics: [...new Set(sources.flatMap((s) => s.topics))] };
  };

  return {
    coverage,

    async interpret(question) { return readingOf(question); },

    async request(req: KnowledgeRequest): Promise<KnowledgeResponse> {
      const question = req.intent === "answer_question" ? (req.question ?? "") : "";
      const interpretation = question ? readingOf(question) : emptyInterpretation;
      const boundary = req.intent === "answer_question" ? interpretation.boundary : null;
      const base = { jurisdiction: req.jurisdiction, units: [] as KnowledgeUnit[], limits: [] as Limit[], unresolved: [] as Unresolved[], boundary, interpretation, recommends: false as const };
      const unavailable = (reason: NonNullable<KnowledgeResponse["reason"]>, extra: Partial<KnowledgeResponse> = {}): KnowledgeResponse => ({
        ...base, availability: "unavailable", reason, ...extra,
        unresolved: boundary ? [{ kind: "professional_judgment", detail: boundary.area }] : [],
      });

      const j = req.jurisdiction;
      if (!j) return unavailable("no_sources");
      if (!(await coverage(j)).available) return unavailable("no_sources");

      // an answered question is about the topics it is about; project context is about the topics the consumer names
      const asked = interpretation.topics;
      const topics: Topic[] = (req.intent === "project_context" ? [...new Set([...asked, ...(req.topics ?? [])])] : asked).slice(0, 4);
      if (topics.length === 0) return unavailable(boundary ? "professional_judgment" : "no_hits");

      const res = await orient(knowledge, { text: question, jurisdiction: j, topics, ...(req.context?.candidates ? { candidates: req.context.candidates } : {}), limit: req.limit ?? 3 });
      const units = res.hits.map(unitOf);
      const limits: Limit[] = res.limits.map((l) => ({ kind: "granularity", place: l.place, message: l.message }));
      const comparison: ComparisonSummary | undefined = res.comparison
        ? {
          units: res.comparison.units,
          rows: res.comparison.rows.map((r) => ({ criterion: r.criterion, topic: r.topic, entries: r.entries.map((e) => ({ unit: e.unit, value: e.value, ...(e.rank !== undefined ? { rank: e.rank } : {}), ...(e.year ? { year: e.year } : {}) })), ...(r.leader ? { leader: r.leader } : {}) })),
          summary: { es: describeComparison(res.comparison, "es"), en: describeComparison(res.comparison, "en") },
        }
        : undefined;
      const specialistNote = res.sherpaFlag?.reason;

      // nothing usable: no passage and no comparison
      if (units.length === 0 && !comparison) return unavailable(boundary ? "professional_judgment" : "no_hits", specialistNote ? { specialistNote } : {});

      // a granularity limit or a professional-judgment ask means approved knowledge covers only part of what was asked
      const granular = limits.length > 0;
      const covered = new Set(units.flatMap((u) => u.topics));
      const unresolved: Unresolved[] = [
        ...limits.map((l): Unresolved => ({ kind: "granularity", detail: l.message })),
        ...(boundary ? [{ kind: "professional_judgment", detail: boundary.area } as Unresolved] : []),
        ...topics.filter((t) => !covered.has(t)).map((t): Unresolved => ({ kind: "topic_not_covered", topic: t })),
      ];
      // topics asked but not covered are reported in `unresolved`; they do not by themselves make the answer partial (a neighbouring topic can fully answer it)
      const availability = granular || boundary ? "partial" : "sufficient";
      return {
        ...base, availability, units, limits, unresolved,
        ...(availability === "partial" ? { reason: granular ? ("granularity" as const) : ("professional_judgment" as const) } : {}),
        ...(comparison ? { comparison } : {}), ...(specialistNote ? { specialistNote } : {}),
      };
    },

    async recordDemand(ctx: DemandContext, signal: DemandSignal): Promise<DemandReceipt | null> {
      const d = demandFromSignal(signal);
      if (!d) return null;
      try {
        assertNormalized(d);
        await demand.register(d, { projectId: ctx.projectId, turnKey: ctx.turnKey }, now().toISOString());
      } catch (err) {
        deps.onError?.(err);
      }
      return { topic: d.topic, subtopic: d.subtopic, infoType: d.infoType, coverage: d.coverage, disposition: d.disposition, reason: d.reason, boundary: boundaryOf(d.boundary) };
    },

    async resources(q): Promise<ResourceDescriptor[]> {
      const rs = await resolveResources(resources, { countryCode: q.country, language: q.language, ...(q.topic ? { topic: q.topic } : {}), ...(q.now ? { now: q.now } : {}) });
      return rs.map((r) => ({ id: r.id, country: r.countryCode, title: r.title, language: r.language, version: r.version, ...(r.topic ? { topic: r.topic } : {}), ...(r.section ? { section: r.section } : {}) }));
    },

    async openResource(id) {
      const r = await resources.get(id);
      if (!r || !r.active || !isOpenable(r)) return null;
      return { id: r.id, title: r.title, url: r.destination.ref };
    },
  };
}
