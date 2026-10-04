import { createHash } from "node:crypto";
import {
  Answers,
  Catalog,
  Capability,
  DemandSignal,
  YourExpansionViewModel,
  publishedOnly,
  validateCapabilityForPublish,
} from "@beeside/fa-public-engine";
import { Db } from "../db/database";
import { generateAccessToken, hashAccessToken } from "../fa/services/tokens";

/**
 * FA Public v1.0 persistence (PostgreSQL, raw SQL over the shared `Db` abstraction, like the rest of the backend).
 * Tables: see db/schema/fa4.ts. Integrity (append-only results, immutable catalog versions) is enforced by triggers (0016).
 */
export type TokenKind = "SESSION" | "RESUME";
export type ProjectStatus = "IN_PROGRESS" | "DELIVERED" | "INELIGIBLE";

export interface Fa4ProjectRow {
  projectId: string;
  email: string;
  locale: "es" | "en";
  stepKey: string;
  answers: Answers;
  status: ProjectStatus;
  createdAt: Date;
  updatedAt: Date;
}

type Row = Record<string, unknown>;
const toProject = (r: Row): Fa4ProjectRow => ({
  projectId: r.project_id as string,
  email: r.email as string,
  locale: r.locale as "es" | "en",
  stepKey: r.step_key as string,
  answers: r.answers as Answers,
  status: r.status as ProjectStatus,
  createdAt: r.created_at as Date,
  updatedAt: r.updated_at as Date,
});

export const normalizeEmail = (e: string) => e.trim().toLowerCase();

// ------------------------------------------------------------------ catalog
export async function seedCatalogIfEmpty(db: Db, seed: Catalog): Promise<boolean> {
  return db.transaction(async (tx) => {
    const { rows } = await tx.query<{ n: number }>("SELECT count(*)::int AS n FROM fa4_catalog_version");
    if ((rows[0]?.n ?? 0) > 0) return false;
    const put = (type: string, id: string, status: string, data: unknown, validFrom: string) =>
      tx.query(
        `INSERT INTO fa4_catalog_entity (entity_type, entity_id, publication_status, data, valid_from)
         VALUES ($1, $2, $3, $4::jsonb, $5) ON CONFLICT (entity_type, entity_id) DO NOTHING`,
        [type, id, status, JSON.stringify(data), validFrom],
      );
    for (const f of seed.fronts) await put("FRONT", f.key, "PUBLISHED", f, seed.publishedAt);
    for (const c of seed.categories) await put("CATEGORY", c.categoryId, c.publicationStatus, c, c.validFrom);
    for (const s of seed.services) await put("SERVICE", s.serviceId, s.publicationStatus, s, s.validFrom);
    for (const c of seed.capabilities) await put("CAPABILITY", c.capabilityId, c.publicationStatus, c, c.validFrom);
    for (const c of seed.countries) await put("COUNTRY", c.iso, "PUBLISHED", c, c.validFrom);
    await tx.query("INSERT INTO fa4_catalog_version (version, published_at, content) VALUES ($1, $2, $3::jsonb)", [seed.version, seed.publishedAt, JSON.stringify(seed)]);
    return true;
  });
}

/** The latest PUBLISHED, immutable catalog version — the only catalog that may affect customer-facing results. */
export async function loadPublishedCatalog(db: Db): Promise<Catalog> {
  const { rows } = await db.query<{ content: Catalog }>("SELECT content FROM fa4_catalog_version ORDER BY published_at DESC, version DESC LIMIT 1");
  const row = rows[0];
  if (!row) throw new Error("no published FA4 catalog version: seed the catalog first");
  return publishedOnly(row.content);
}

export async function catalogVersions(db: Db): Promise<string[]> {
  return (await db.query<{ version: string }>("SELECT version FROM fa4_catalog_version ORDER BY published_at, version")).rows.map((r) => r.version);
}

export async function catalogChanges(db: Db, entityId: string) {
  return (await db.query("SELECT entity_type, entity_id, changed_by, previous_status, new_status, reason, catalog_version FROM fa4_catalog_change WHERE entity_id = $1 ORDER BY change_id", [entityId])).rows;
}

async function logChange(tx: Db, type: string, id: string, by: string, prev: string | null, next: string, reason: string, version: string | null) {
  await tx.query(
    "INSERT INTO fa4_catalog_change (entity_type, entity_id, changed_by, previous_status, new_status, reason, catalog_version) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [type, id, by, prev, next, reason, version],
  );
}

/** DRAFT/REVIEW edits never affect FA until PUBLISHED and a new immutable catalog version is cut. */
export async function saveCapabilityDraft(db: Db, cap: Capability, by: string, reason: string): Promise<void> {
  await db.transaction(async (tx) => {
    const prev = (await tx.query<{ publication_status: string }>("SELECT publication_status FROM fa4_catalog_entity WHERE entity_type='CAPABILITY' AND entity_id=$1 FOR UPDATE", [cap.capabilityId])).rows[0];
    if (prev?.publication_status === "ARCHIVED") throw new Error("ARCHIVED ids are never reused (D-094)");
    const draft = { ...cap, publicationStatus: "DRAFT" as const, updatedAt: new Date().toISOString().slice(0, 10) };
    await tx.query(
      `INSERT INTO fa4_catalog_entity (entity_type, entity_id, publication_status, data, valid_from)
       VALUES ('CAPABILITY', $1, 'DRAFT', $2::jsonb, $3)
       ON CONFLICT (entity_type, entity_id) DO UPDATE SET publication_status = 'DRAFT', data = EXCLUDED.data, updated_at = now()`,
      [cap.capabilityId, JSON.stringify(draft), cap.validFrom],
    );
    await logChange(tx, "CAPABILITY", cap.capabilityId, by, prev?.publication_status ?? null, "DRAFT", reason, null);
  });
}

export async function publishCapability(db: Db, capabilityId: string, by: string, reason: string, version: string): Promise<{ ok: true; version: string } | { ok: false; errors: string[] }> {
  return db.transaction(async (tx) => {
    const row = (await tx.query<{ data: Capability; publication_status: string }>("SELECT data, publication_status FROM fa4_catalog_entity WHERE entity_type='CAPABILITY' AND entity_id=$1 FOR UPDATE", [capabilityId])).rows[0];
    if (!row) return { ok: false as const, errors: ["capability not found"] };
    const cap: Capability = { ...row.data };
    if (cap.capabilityStatus === "SOURCEABLE" && !cap.sourcingPolicy) cap.sourcingPolicy = reason; // policy lives in the change reason (§5.3)
    const working = await workingCatalog(tx);
    const errors = validateCapabilityForPublish(cap, working);
    if (errors.length) return { ok: false as const, errors };
    cap.publicationStatus = "PUBLISHED";
    await tx.query("UPDATE fa4_catalog_entity SET publication_status='PUBLISHED', data=$2::jsonb, updated_at=now() WHERE entity_type='CAPABILITY' AND entity_id=$1", [capabilityId, JSON.stringify(cap)]);
    await logChange(tx, "CAPABILITY", capabilityId, by, row.publication_status, "PUBLISHED", reason, version);
    const snapshot = await workingCatalog(tx);
    snapshot.version = version;
    snapshot.publishedAt = new Date().toISOString().slice(0, 10);
    snapshot.capabilities = snapshot.capabilities.filter((c) => c.publicationStatus === "PUBLISHED");
    await tx.query("INSERT INTO fa4_catalog_version (version, content) VALUES ($1, $2::jsonb)", [version, JSON.stringify(snapshot)]);
    return { ok: true as const, version };
  });
}

async function workingCatalog(tx: Db): Promise<Catalog> {
  const all = async <T>(type: string) => (await tx.query<{ data: T }>("SELECT data FROM fa4_catalog_entity WHERE entity_type=$1 ORDER BY entity_id", [type])).rows.map((r) => r.data);
  const latest = (await tx.query<{ content: Catalog }>("SELECT content FROM fa4_catalog_version ORDER BY published_at DESC, version DESC LIMIT 1")).rows[0]!.content;
  return { ...latest, fronts: await all("FRONT"), categories: await all("CATEGORY"), services: await all("SERVICE"), capabilities: await all("CAPABILITY"), countries: await all("COUNTRY") };
}

// ------------------------------------------------------------------ projects & tokens
export async function issueToken(tx: Db, projectId: string, kind: TokenKind, expiresAt: Date): Promise<string> {
  const token = generateAccessToken();
  await tx.query("INSERT INTO fa4_access_token (project_id, kind, token_hash, expires_at) VALUES ($1, $2, $3, $4)", [projectId, kind, hashAccessToken(token), expiresAt]);
  return token;
}

export async function createProject(db: Db, answers: Answers, stepKey: string, sessionExpiresAt: Date): Promise<{ projectId: string; sessionToken: string }> {
  return db.transaction(async (tx) => {
    const { rows } = await tx.query<{ project_id: string }>(
      "INSERT INTO fa4_project (email, locale, step_key, answers) VALUES ($1, $2, $3, $4::jsonb) RETURNING project_id",
      [normalizeEmail(answers.identity.email), answers.locale, stepKey, JSON.stringify(answers)],
    );
    const projectId = rows[0]!.project_id;
    const sessionToken = await issueToken(tx, projectId, "SESSION", sessionExpiresAt);
    return { projectId, sessionToken };
  });
}

export async function projectByToken(db: Db, rawToken: string, kind: TokenKind, now: Date): Promise<Fa4ProjectRow | null> {
  const { rows } = await db.query(
    `SELECT p.*, t.token_id FROM fa4_access_token t JOIN fa4_project p ON p.project_id = t.project_id
      WHERE t.token_hash = $1 AND t.kind = $2 AND t.revoked_at IS NULL AND t.expires_at > $3`,
    [hashAccessToken(rawToken), kind, now],
  );
  const r = rows[0];
  if (!r) return null;
  await db.query("UPDATE fa4_access_token SET last_used_at = $2 WHERE token_id = $1", [r.token_id, now]);
  return toProject(r);
}

export async function saveProject(db: Db, projectId: string, answers: Answers, stepKey: string, status?: ProjectStatus): Promise<void> {
  // The email captured at identity is the single identifier for save/resume, result delivery and continuation: it is never replaced here.
  await db.query(
    `UPDATE fa4_project SET answers = $2::jsonb, step_key = $3, locale = $4, status = COALESCE($5, status), updated_at = now() WHERE project_id = $1`,
    [projectId, JSON.stringify(answers), stepKey, answers.locale, status ?? null],
  );
}

export async function latestProjectIdForEmail(db: Db, email: string): Promise<string | null> {
  const { rows } = await db.query<{ project_id: string }>("SELECT project_id FROM fa4_project WHERE email = $1 ORDER BY updated_at DESC LIMIT 1", [normalizeEmail(email)]);
  return rows[0]?.project_id ?? null;
}

// ------------------------------------------------------------------ results (append-only)
export async function storeResult(tx: Db, projectId: string, model: YourExpansionViewModel): Promise<string> {
  const { rows } = await tx.query<{ result_id: string }>("INSERT INTO fa4_result (project_id, catalog_version, model) VALUES ($1, $2, $3::jsonb) RETURNING result_id", [projectId, model.catalogVersion, JSON.stringify(model)]);
  await tx.query("UPDATE fa4_project SET status = 'DELIVERED', updated_at = now() WHERE project_id = $1 AND status <> 'INELIGIBLE'", [projectId]);
  return rows[0]!.result_id;
}
export async function latestResult(db: Db, projectId: string): Promise<{ resultId: string; model: YourExpansionViewModel } | null> {
  const { rows } = await db.query<{ result_id: string; model: YourExpansionViewModel }>("SELECT result_id, model FROM fa4_result WHERE project_id = $1 ORDER BY result_seq DESC LIMIT 1", [projectId]);
  return rows[0] ? { resultId: rows[0].result_id, model: rows[0].model } : null;
}
export async function resultsFor(db: Db, projectId: string) {
  return (await db.query<{ result_id: string; catalog_version: string }>("SELECT result_id, catalog_version FROM fa4_result WHERE project_id = $1 ORDER BY result_seq", [projectId])).rows;
}

// ------------------------------------------------------------------ demand signals (INTERNAL)
/** Replaces the project's signals that nobody has started working on; advanced / owned signals are kept. */
export async function replaceOpenSignals(tx: Db, projectId: string, signals: DemandSignal[]): Promise<void> {
  await tx.query("DELETE FROM fa4_demand_signal WHERE project_id = $1 AND owner IS NULL AND (sourcing_status IS NULL OR sourcing_status = 'OPEN')", [projectId]);
  for (const s of signals) {
    const id = `${s.signalId}`.slice(0, 120);
    await tx.query(
      `INSERT INTO fa4_demand_signal (signal_id, project_id, destination, capability_id, reason, class, sourcing_status, triage_status, owner, premium_state, catalog_version, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb) ON CONFLICT (signal_id) DO NOTHING`,
      [id, projectId, s.destination, s.capabilityId, s.reason, s.class, s.sourcingStatus, s.triageStatus, s.owner, s.premiumState, s.catalogVersion, JSON.stringify({ ...s, signalId: id })],
    );
  }
}
export async function rawSignals(db: Db, projectId: string): Promise<DemandSignal[]> {
  return (await db.query<{ payload: DemandSignal }>("SELECT payload FROM fa4_demand_signal WHERE project_id = $1 ORDER BY signal_id", [projectId])).rows.map((r) => r.payload);
}
export async function allSignals(db: Db): Promise<DemandSignal[]> {
  return (await db.query<{ payload: DemandSignal }>("SELECT payload FROM fa4_demand_signal ORDER BY signal_id")).rows.map((r) => r.payload);
}

// ------------------------------------------------------------------ continuation
export async function requestContinuation(db: Db, projectId: string, resultId: string): Promise<void> {
  await db.query("INSERT INTO fa4_continuation_request (project_id, result_id) VALUES ($1, $2)", [projectId, resultId]);
}
export async function continuationRequests(db: Db, projectId: string) {
  return (await db.query("SELECT request_id, result_id FROM fa4_continuation_request WHERE project_id = $1", [projectId])).rows;
}

export const stableId = (...parts: string[]) => createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
