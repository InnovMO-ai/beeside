import { randomUUID } from "node:crypto";
import type { Db } from "../db/database";
import { FaError } from "../fa/services/errors";
import { validateResource, type CountryResource } from "../precision/knowledge/country-resources";
import { createPgCountryResources, createPgDemandRepository, createPgKnowledgeRepository } from "../precision/knowledge/pg-repo";
import { DEMAND_STATUSES, type DemandStatus, type StoredDemand } from "../precision/knowledge/demand";
import { assessKSeed, type KSeedAssessment } from "../precision/knowledge/kseed-spec";
import { renderGapReport } from "../precision/knowledge/kseed-report";

/**
 * Admin side of the Country Resource Library and the Source Registry (read-only view). Destinations are configuration:
 * nothing is hardcoded in code. A new edition of a guide is a NEW row with the same title and language (the newest active one is
 * what the client is offered); the previous one is deactivated, never deleted, so every change is reversible.
 */
const str = (v: unknown, field: string, max = 300): string => {
  if (typeof v !== "string" || !v.trim() || v.length > max) throw new FaError("INVALID_INPUT", `${field} is required`, { fields: [field] });
  return v.trim();
};
const optStr = (v: unknown, field: string, max = 120): string | undefined => (v === undefined || v === null || v === "" ? undefined : str(v, field, max));

function parseResource(id: string, b: Record<string, unknown>, now: Date): CountryResource {
  const dest = typeof b.destination === "object" && b.destination !== null ? (b.destination as Record<string, unknown>) : {};
  const kind = dest.kind === "document" ? "document" : dest.kind === "url" ? "url" : null;
  if (!kind) throw new FaError("INVALID_INPUT", "destination.kind must be url or document", { fields: ["destination"] });
  const topic = optStr(b.topic, "topic");
  const section = optStr(b.section, "section");
  const effectiveAt = optStr(b.effectiveAt, "effectiveAt", 40);
  if (effectiveAt && Number.isNaN(new Date(effectiveAt).getTime())) throw new FaError("INVALID_INPUT", "effectiveAt must be a date", { fields: ["effectiveAt"] });
  const r: CountryResource = {
    id,
    countryCode: str(b.countryCode, "countryCode", 2).toUpperCase(),
    title: str(b.title, "title"),
    language: str(b.language, "language", 2).toLowerCase(),
    version: str(b.version, "version", 40),
    destination: { kind, ref: str(dest.ref, "destination.ref", 600) },
    // a document without a URL cannot be opened by a customer in V1: it is kept as an inactive draft until it has an https URL
    active: b.active === false ? false : b.active === true ? true : kind === "url",
    updatedAt: now.toISOString(),
    ...(effectiveAt ? { effectiveAt } : {}),
    ...(topic ? { topic } : {}),
    ...(section ? { section } : {}),
  };
  const errors = validateResource(r);
  if (errors.length) throw new FaError("INVALID_INPUT", errors.join("; "), { fields: ["resource"] });
  return r;
}

export async function listCountryResources(db: Db, countryCode?: string): Promise<{ resources: CountryResource[] }> {
  return { resources: await createPgCountryResources(db).list(countryCode ? { countryCode: countryCode.toUpperCase() } : undefined) };
}

export async function createCountryResource(db: Db, body: Record<string, unknown>, now: Date): Promise<CountryResource> {
  const r = parseResource(randomUUID(), body, now);
  await createPgCountryResources(db).upsert(r);
  return r;
}

export async function updateCountryResource(db: Db, id: string, body: Record<string, unknown>, now: Date): Promise<CountryResource> {
  const repo = createPgCountryResources(db);
  const cur = await repo.get(id);
  if (!cur) throw new FaError("NOT_FOUND", "resource not found");
  const r = parseResource(id, { ...cur, ...body, destination: body.destination ?? cur.destination }, now);
  await repo.upsert(r);
  return r;
}

export async function setCountryResourceActive(db: Db, id: string, active: boolean, now: Date): Promise<CountryResource> {
  const repo = createPgCountryResources(db);
  const cur = await repo.get(id);
  if (!cur) throw new FaError("NOT_FOUND", "resource not found");
  const next = { ...cur, active, updatedAt: now.toISOString() };
  const errors = validateResource(next);
  if (errors.length) throw new FaError("INVALID_INPUT", errors.join("; "), { fields: ["resource"] });
  await repo.upsert(next);
  return next;
}

/** Read-only view of the Source Registry (authority and status), so Admin can see what grounds the Knowledge Layer. */
export async function listKnowledgeSources(db: Db): Promise<{ sources: unknown[] }> {
  return { sources: await createPgKnowledgeRepository(db).listSources() };
}

// ------------------------------------------------------------------ Knowledge demand + KSeed status (Admin)
/** Normalised unmet-knowledge demand, most recurrent first. Contains no client text and no identifiers. */
export async function listKnowledgeDemand(db: Db, q: { country?: unknown; topic?: unknown; status?: unknown; minOccurrences?: unknown }): Promise<{ demand: StoredDemand[] }> {
  const status = typeof q.status === "string" && q.status ? q.status : undefined;
  if (status && !(DEMAND_STATUSES as readonly string[]).includes(status)) throw new FaError("INVALID_INPUT", "status is not valid", { fields: ["status"] });
  const min = Number(q.minOccurrences ?? 0);
  return {
    demand: await createPgDemandRepository(db).list({
      ...(typeof q.country === "string" && q.country ? { country: q.country } : {}),
      ...(typeof q.topic === "string" && q.topic ? { topic: q.topic } : {}),
      ...(status ? { status: status as DemandStatus } : {}),
      ...(Number.isFinite(min) && min > 0 ? { minOccurrences: Math.floor(min) } : {}),
    }),
  };
}

/** The only way a demand changes status: a person's decision (recurrence never publishes to the Knowledge Layer). */
export async function decideKnowledgeDemand(db: Db, id: string, b: Record<string, unknown>, now: Date): Promise<StoredDemand> {
  const status = str(b.status, "status", 40);
  if (!(DEMAND_STATUSES as readonly string[]).includes(status)) throw new FaError("INVALID_INPUT", "status is not valid", { fields: ["status"] });
  const note = optStr(b.note, "note", 500) ?? null;
  const repo = createPgDemandRepository(db);
  if (!(await repo.get(id))) throw new FaError("NOT_FOUND", "demand not found");
  return repo.decide(id, status as DemandStatus, note, now.toISOString());
}

/** KSeed coverage against the expectation spec, plus the rendered gap report (Spanish). */
export async function kseedStatus(db: Db, now: Date): Promise<{ assessment: KSeedAssessment[]; report: string }> {
  const repo = createPgKnowledgeRepository(db);
  const assessment = await assessKSeed(repo);
  const documents: { doc: Awaited<ReturnType<typeof repo.listDocuments>>[number]; source: NonNullable<Awaited<ReturnType<typeof repo.getSource>>> }[] = [];
  for (const doc of await repo.listDocuments({ status: "active" })) { const source = await repo.getSource(doc.sourceId); if (source) documents.push({ doc, source }); }
  const resources = await createPgCountryResources(db).list();
  const demand = await createPgDemandRepository(db).list();
  return { assessment, report: renderGapReport({ generatedAt: now.toISOString(), assessment, documents, resources, demand }) };
}
