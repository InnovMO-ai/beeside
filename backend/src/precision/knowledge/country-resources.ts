/**
 * Country Resource Library — "Doing Business in Mexico"-style guides. Minimal by design (no DMS): a configurable list of resources per
 * country, offered in context and never mandatory. Destinations (URL or document reference) are configuration managed in Admin; nothing is hardcoded.
 */
import type { L10n } from "../understanding/types";

export type ResourceDestination = { kind: "url"; ref: string } | { kind: "document"; ref: string };
export interface CountryResource {
  id: string;
  countryCode: string; // ISO-2
  title: string;
  language: string; // "es" | "en"
  version: string;
  destination: ResourceDestination;
  active: boolean;
  effectiveAt?: string;
  updatedAt: string;
  topic?: string;
  section?: string;
}
export interface CountryResourceRepository {
  list(filter?: { countryCode?: string; activeOnly?: boolean }): Promise<CountryResource[]>;
  get(id: string): Promise<CountryResource | null>;
  upsert(r: CountryResource): Promise<void>;
}

export function validateResource(r: CountryResource): string[] {
  const e: string[] = [];
  if (!/^[A-Z]{2}$/.test(r.countryCode)) e.push("countryCode must be ISO-2");
  if (!r.title.trim()) e.push("title required");
  if (!/^[a-z]{2}$/.test(r.language)) e.push("language must be a 2-letter code");
  if (!r.version.trim()) e.push("version required");
  if (r.destination.kind === "url" && !/^https:\/\/[^\s]+$/.test(r.destination.ref)) e.push("url must be https");
  if (r.destination.kind === "document" && !/^[A-Za-z0-9][A-Za-z0-9_./:-]{2,200}$/.test(r.destination.ref)) e.push("document reference is invalid");
  return e;
}

export class InMemoryCountryResources implements CountryResourceRepository {
  private m = new Map<string, CountryResource>();
  async list(f?: { countryCode?: string; activeOnly?: boolean }): Promise<CountryResource[]> { return [...this.m.values()].filter((r) => (!f?.countryCode || r.countryCode === f.countryCode) && (!f?.activeOnly || r.active)); }
  async get(id: string): Promise<CountryResource | null> { return this.m.get(id) ?? null; }
  async upsert(r: CountryResource): Promise<void> { const e = validateResource(r); if (e.length) throw new Error(e.join("; ")); this.m.set(r.id, { ...r }); }
}

/** Newest active version of each resource title for the country, in the client's language first. */
export async function resolveResources(repo: CountryResourceRepository, q: { countryCode: string; language: string; topic?: string; now?: string }): Promise<CountryResource[]> {
  const all = await repo.list({ countryCode: q.countryCode.toUpperCase(), activeOnly: true });
  const live = all.filter((r) => !r.effectiveAt || !q.now || r.effectiveAt <= q.now);
  const latest = new Map<string, CountryResource>();
  for (const r of live) {
    const k = `${r.title}|${r.language}`;
    const cur = latest.get(k);
    if (!cur || r.updatedAt > cur.updatedAt) latest.set(k, r);
  }
  return [...latest.values()]
    .map((r) => ({ r, s: (r.language === q.language ? 2 : 0) + (q.topic && r.topic === q.topic ? 3 : 0) }))
    .sort((a, b) => b.s - a.s || a.r.title.localeCompare(b.r.title))
    .map((x) => x.r);
}

/** Contextual offer: only when the conversation touches the resource's topic, once per resource, and never as required reading. */
export function offerResource(resources: CountryResource[], opts: { topics: string[]; alreadyOffered: string[]; language: string }): { resource: CountryResource; text: L10n } | null {
  const r = resources.find((x) => !opts.alreadyOffered.includes(x.id) && (!x.topic || opts.topics.includes(x.topic)));
  if (!r) return null;
  return {
    resource: r,
    text: {
      es: `Si quieres contexto general, tengo una guía disponible: «${r.title}». No es necesario leerla para seguir.`,
      en: `If you want general context, I have a guide available: “${r.title}”. You do not need to read it to continue.`,
    },
  };
}
