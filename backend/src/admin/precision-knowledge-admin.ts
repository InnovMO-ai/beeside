import { randomUUID } from "node:crypto";
import type { Db } from "../db/database";
import { FaError } from "../fa/services/errors";
import { validateResource, type CountryResource } from "../precision/knowledge/country-resources";
import { createPgCountryResources, createPgKnowledgeRepository } from "../precision/knowledge/pg-repo";

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
