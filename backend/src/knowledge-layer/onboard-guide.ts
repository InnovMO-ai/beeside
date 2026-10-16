/**
 * Country resource onboarding ("beeside Doing Business México" and any later edition of the family): ONE operation that does everything the guide needs, so
 * that when the document arrives no code has to change.
 *
 *   1. registers (or reuses) the curated source for the country, approving the host of the guide's HTTPS destination;
 *   2. ingests the file into KSeed as curated material (versioned, with provenance; a new edition supersedes the old one, never overwrites);
 *   3. registers the country resource with its HTTPS destination (Admin can edit it later), deactivating older editions (never deleting);
 *   4. is idempotent: the same bytes, the same edition => nothing changes.
 *
 * Curated guides are CONTEXT: they can orient and help ask better questions; they can never ground legal, tax or labor obligations
 * (only official primary sources do). Nothing here touches the network: the caller supplies the bytes.
 */
import { ingestDocument, seriesTitle, type IngestResult } from "./ingest";
import { isOpenable, validateResource, type CountryResource, type CountryResourceRepository } from "./country-resources";
import { RegistryError, registerSource } from "./registry";
import { TOPICS, type KnowledgeRepository, type KnowledgeSource, type Topic } from "./types";

export interface GuideOnboardInput {
  countryCode: string;
  /** Series title as clients see it, e.g. "beeside Doing Business México". The edition is NOT part of the title. */
  title: string;
  language: string;
  /** Edition / version label, e.g. "2026". */
  edition: string;
  /** Public HTTPS destination the client opens. */
  url: string;
  file: { filename: string; data: Buffer };
  now: string;
  publishedAt?: string;
  /** Optional topic to bind the offer to (otherwise the guide is offered at the priority moment, always optional). */
  topic?: string;
  institution?: string;
  /** Governed resource type; defaults to `pdf` when the supplied file is a PDF. */
  resourceType?: "pdf" | "web";
}
export interface GuideOnboardResult {
  sourceId: string;
  ingest: IngestResult;
  resource: CountryResource;
  deactivated: string[];
  approvedHost: string;
}

const slug = (s: string): string => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export const guideSourceId = (countryCode: string): string => `beeside-curated-${countryCode.toLowerCase()}`;

export async function onboardCountryGuide(knowledge: KnowledgeRepository, resources: CountryResourceRepository, i: GuideOnboardInput): Promise<GuideOnboardResult> {
  const cc = i.countryCode.toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) throw new RegistryError("countryCode must be ISO-2");
  if (!/^https:\/\/[^\s]+$/.test(i.url)) throw new RegistryError("the guide destination must be an https URL");
  const host = new URL(i.url).hostname.toLowerCase();
  const id = guideSourceId(cc);

  // 1. curated source: context only, reviewed, host approved by whoever runs the onboarding (an Admin decision)
  const prev = await knowledge.getSource(id);
  const base: KnowledgeSource = prev ?? {
    id, institution: i.institution ?? "beeside (material curado)", domains: [], jurisdiction: cc,
    topics: (TOPICS as readonly Topic[]).filter((t) => t !== "informality"), authority: "beeside_curated", roles: ["context"], primary: false,
    cadence: "annual", risk: "medium", reviewRequired: true, granularity: "country", active: true,
    notes: "Guías país curadas por beeside. Contexto para orientar y preguntar mejor; nunca fundamento de obligaciones legales, fiscales o laborales.",
  };
  const source: KnowledgeSource = { ...base, active: true, domains: [...new Set([...base.domains, host])].sort() };
  await registerSource(knowledge, source);

  // 2. ingest as curated, versioned material
  const ingest = await ingestDocument(knowledge, {
    sourceId: id, title: i.title, edition: i.edition, locator: i.url, filename: i.file.filename, data: i.file.data, now: i.now,
    language: i.language, jurisdiction: cc, confidence: "medium", ...(i.publishedAt ? { publishedAt: i.publishedAt } : {}),
  });

  // 3. the country resource (HTTPS destination) — older editions of the same guide are deactivated, not deleted
  const rid = `guide-${cc.toLowerCase()}-${slug(seriesTitle(i.title))}-${i.language}-${slug(i.edition)}`;
  const resource: CountryResource = {
    id: rid, countryCode: cc, title: seriesTitle(i.title), language: i.language, version: i.edition, destination: { kind: "url", ref: i.url }, active: true,
    effectiveAt: i.publishedAt ?? i.now.slice(0, 10), updatedAt: i.now, ...(i.topic ? { topic: i.topic } : {}),
    ...((i.resourceType ?? (/\.pdf$/i.test(i.file.filename) ? "pdf" : undefined)) ? { resourceType: (i.resourceType ?? "pdf") } : {}),
  };
  const errs = validateResource(resource);
  if (errs.length || !isOpenable(resource)) throw new RegistryError(`invalid country resource: ${errs.join("; ")}`);
  const deactivated: string[] = [];
  for (const r of await resources.list({ countryCode: cc })) {
    if (r.id !== rid && r.active && r.title === resource.title && r.language === resource.language) { await resources.upsert({ ...r, active: false, updatedAt: i.now }); deactivated.push(r.id); }
  }
  await resources.upsert(resource);
  return { sourceId: id, ingest, resource, deactivated, approvedHost: host };
}
