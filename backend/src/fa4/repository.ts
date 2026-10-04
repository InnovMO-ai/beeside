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
export type ProjectStatus = "IN_PROGRESS" | "DELIVERED" | "INELIGIBLE" | "ANONYMIZED";

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
  const { rows } = await db.query<{ content: Catalog }>("SELECT content FROM fa4_catalog_version ORDER BY version_seq DESC LIMIT 1");
  const row = rows[0];
  if (!row) throw new Error("no published FA4 catalog version: seed the catalog first");
  return publishedOnly(row.content);
}

export async function catalogVersions(db: Db): Promise<string[]> {
  return (await db.query<{ version: string }>("SELECT version FROM fa4_catalog_version ORDER BY version_seq")).rows.map((r) => r.version);
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

/**
 * Saves a pending edit. Draft and published are isolated (CATALOG_MODEL §5): a draft only fills `draft_data`/`draft_status`; the
 * entity's effective `data` and `publication_status` — what the next catalog version is built from — never change until publish.
 */
export async function saveCapabilityDraft(db: Db, cap: Capability, by: string, reason: string): Promise<void> {
  await db.transaction(async (tx) => {
    const prev = (await tx.query<{ publication_status: string }>("SELECT publication_status FROM fa4_catalog_entity WHERE entity_type='CAPABILITY' AND entity_id=$1 FOR UPDATE", [cap.capabilityId])).rows[0];
    if (prev?.publication_status === "ARCHIVED") throw new Error("ARCHIVED ids are never reused (D-094)");
    const draft = { ...cap, publicationStatus: "DRAFT" as const, updatedAt: new Date().toISOString().slice(0, 10) };
    await tx.query(
      `INSERT INTO fa4_catalog_entity (entity_type, entity_id, publication_status, data, draft_data, draft_status, valid_from)
       VALUES ('CAPABILITY', $1, 'DRAFT', $2::jsonb, $2::jsonb, 'DRAFT', $3)
       ON CONFLICT (entity_type, entity_id) DO UPDATE SET
         draft_data = EXCLUDED.draft_data, draft_status = 'DRAFT', updated_at = now(),
         data = CASE WHEN fa4_catalog_entity.publication_status = 'PUBLISHED' THEN fa4_catalog_entity.data ELSE EXCLUDED.data END`,
      [cap.capabilityId, JSON.stringify(draft), cap.validFrom],
    );
    await logChange(tx, "CAPABILITY", cap.capabilityId, by, prev?.publication_status ?? null, "DRAFT", reason, null);
  });
}

export interface PublishHooks {
  /** Test seam: runs right after the publish lock is held (used to prove two concurrent publishes are serialized). */
  afterLock?: () => Promise<void>;
}

/**
 * Publishes ONE capability as a new immutable catalog version. Publishing is serialized by a transaction-level advisory lock and the
 * base is read AFTER the lock, so two concurrent publishes can never build their versions from the same base and drop each other's
 * change. Only the published capability is applied onto the latest published version: other capabilities' drafts never leak in, and
 * a draft never removes or replaces the published capability it is based on (B2).
 */
export async function publishCapability(
  db: Db, capabilityId: string, by: string, reason: string, version: string, hooks: PublishHooks = {},
): Promise<{ ok: true; version: string } | { ok: false; errors: string[] }> {
  return db.transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(hashtext('fa4_catalog_publish'))");
    if (hooks.afterLock) await hooks.afterLock();
    const row = (await tx.query<{ data: Capability; draft_data: Capability | null; publication_status: string }>(
      "SELECT data, draft_data, publication_status FROM fa4_catalog_entity WHERE entity_type='CAPABILITY' AND entity_id=$1 FOR UPDATE", [capabilityId])).rows[0];
    if (!row) return { ok: false as const, errors: ["capability not found"] };
    if (row.publication_status === "ARCHIVED") return { ok: false as const, errors: ["ARCHIVED ids are never reused (D-094)"] };
    if (!row.draft_data && row.publication_status === "PUBLISHED") return { ok: false as const, errors: ["nothing to publish: no pending draft"] };
    if ((await tx.query("SELECT 1 FROM fa4_catalog_version WHERE version = $1", [version])).rows.length) return { ok: false as const, errors: [`catalog version ${version} already exists`] };
    const cap: Capability = { ...(row.draft_data ?? row.data) };
    if (cap.capabilityStatus === "SOURCEABLE" && !cap.sourcingPolicy) cap.sourcingPolicy = reason; // policy lives in the change reason (§5.3)
    // Base = the latest immutable version, read after the lock.
    const base = (await tx.query<{ content: Catalog }>("SELECT content FROM fa4_catalog_version ORDER BY version_seq DESC LIMIT 1")).rows[0]?.content;
    if (!base) return { ok: false as const, errors: ["no published catalog version"] };
    const snapshot: Catalog = { ...base, capabilities: base.capabilities.filter((c) => c.capabilityId !== capabilityId) };
    const errors = validateCapabilityForPublish(cap, snapshot);
    if (errors.length) return { ok: false as const, errors };
    cap.publicationStatus = "PUBLISHED";
    snapshot.capabilities = [...snapshot.capabilities, cap].sort((a, b) => a.capabilityId.localeCompare(b.capabilityId));
    snapshot.version = version;
    snapshot.publishedAt = new Date().toISOString().slice(0, 10);
    await tx.query("INSERT INTO fa4_catalog_version (version, content) VALUES ($1, $2::jsonb)", [version, JSON.stringify(snapshot)]);
    await tx.query(
      "UPDATE fa4_catalog_entity SET publication_status='PUBLISHED', data=$2::jsonb, draft_data=NULL, draft_status=NULL, updated_at=now() WHERE entity_type='CAPABILITY' AND entity_id=$1",
      [capabilityId, JSON.stringify(cap)],
    );
    await logChange(tx, "CAPABILITY", capabilityId, by, row.publication_status, "PUBLISHED", reason, version);
    return { ok: true as const, version };
  });
}

// ------------------------------------------------------------------ projects & tokens
/**
 * Issues a token. A RESUME link is project-specific and single-use; issuing a replacement revokes every earlier RESUME link of the
 * same project that has not been used yet (so only the newest emailed link of a project is live).
 */
export async function issueToken(tx: Db, projectId: string, kind: TokenKind, expiresAt: Date): Promise<string> {
  if (kind === "RESUME") await tx.query("UPDATE fa4_access_token SET revoked_at = now() WHERE project_id = $1 AND kind = 'RESUME' AND used_at IS NULL AND revoked_at IS NULL", [projectId]);
  const token = generateAccessToken();
  await tx.query("INSERT INTO fa4_access_token (project_id, kind, token_hash, expires_at) VALUES ($1, $2, $3, $4)", [projectId, kind, hashAccessToken(token), expiresAt]);
  return token;
}

/** Approved legal documents, from configuration (LEGAL-1 / CHK-1: the final versions and URLs are launch blockers). */
export interface LegalConfig {
  termsVersion: string; termsUrl: Record<"es" | "en", string>;
  privacyVersion: string; privacyUrl: Record<"es" | "en", string>;
}

export async function createProject(db: Db, answers: Answers, stepKey: string, sessionExpiresAt: Date, legal: LegalConfig): Promise<{ projectId: string; sessionToken: string }> {
  return db.transaction(async (tx) => {
    const { rows } = await tx.query<{ project_id: string }>(
      "INSERT INTO fa4_project (email, locale, step_key, answers) VALUES ($1, $2, $3, $4::jsonb) RETURNING project_id",
      [normalizeEmail(answers.identity.email), answers.locale, stepKey, JSON.stringify(answers)],
    );
    const projectId = rows[0]!.project_id;
    // Immutable acceptance evidence: Terms and Privacy are separate records; no IP or other personal data is stored with them.
    const lang = answers.locale;
    await tx.query(
      `INSERT INTO fa4_legal_acceptance (project_id, document, document_version, document_url, language) VALUES ($1,'TERMS',$2,$3,$5), ($1,'PRIVACY',$4,$6,$5)`,
      [projectId, legal.termsVersion, legal.termsUrl[lang], legal.privacyVersion, lang, legal.privacyUrl[lang]],
    );
    const sessionToken = await issueToken(tx, projectId, "SESSION", sessionExpiresAt);
    return { projectId, sessionToken };
  });
}

export async function legalAcceptances(db: Db, projectId: string) {
  return (await db.query("SELECT document, accepted_at, document_version, document_url, language FROM fa4_legal_acceptance WHERE project_id = $1 ORDER BY document", [projectId])).rows;
}

/** A multi-use SESSION token. RESUME links must go through `consumeResumeToken`. */
export async function projectByToken(db: Db, rawToken: string, kind: "SESSION", now: Date): Promise<Fa4ProjectRow | null> {
  const { rows } = await db.query(
    `SELECT p.*, t.token_id FROM fa4_access_token t JOIN fa4_project p ON p.project_id = t.project_id
      WHERE t.token_hash = $1 AND t.kind = $2 AND t.revoked_at IS NULL AND t.expires_at > $3 AND p.status <> 'ANONYMIZED'`,
    [hashAccessToken(rawToken), kind, now],
  );
  const r = rows[0];
  if (!r) return null;
  await db.query("UPDATE fa4_access_token SET last_used_at = $2 WHERE token_id = $1", [r.token_id, now]);
  return toProject(r);
}

/** Atomically spends a single-use RESUME link and mints the working session in the same transaction. Replays return null. */
export async function exchangeResumeToken(db: Db, rawToken: string, now: Date, sessionExpiresAt: Date): Promise<{ projectId: string; sessionToken: string } | null> {
  return db.transaction(async (tx) => {
    const { rows } = await tx.query<{ project_id: string }>(
      `UPDATE fa4_access_token t SET used_at = $2, revoked_at = $2, last_used_at = $2
        WHERE t.token_hash = $1 AND t.kind = 'RESUME' AND t.used_at IS NULL AND t.revoked_at IS NULL AND t.expires_at > $2
          AND EXISTS (SELECT 1 FROM fa4_project p WHERE p.project_id = t.project_id AND p.status <> 'ANONYMIZED')
        RETURNING t.project_id`,
      [hashAccessToken(rawToken), now],
    );
    const projectId = rows[0]?.project_id;
    if (!projectId) return null;
    return { projectId, sessionToken: await issueToken(tx, projectId, "SESSION", sessionExpiresAt) };
  });
}

/**
 * Saves answers. Status is NORMALIZED from facts, never sticky: INELIGIBLE iff the answers say there is no existing business,
 * otherwise DELIVERED iff a result exists, else IN_PROGRESS. The captured email never changes here.
 */
export async function saveProject(db: Db, projectId: string, answers: Answers, stepKey: string): Promise<void> {
  const ineligible = answers.company.hasExistingBusiness === false;
  await db.query(
    `UPDATE fa4_project SET answers = $2::jsonb, step_key = $3, locale = $4, updated_at = now(),
            status = CASE WHEN $5::boolean THEN 'INELIGIBLE'
                          WHEN EXISTS (SELECT 1 FROM fa4_result r WHERE r.project_id = $1) THEN 'DELIVERED' ELSE 'IN_PROGRESS' END
      WHERE project_id = $1 AND status <> 'ANONYMIZED'`,
    [projectId, JSON.stringify(answers), stepKey, answers.locale, ineligible],
  );
}

/** Projects of this email (most recently active first). Resume-by-email sends one project-specific link per project; never "the latest". */
export async function recentProjectsForEmail(db: Db, email: string, limit: number): Promise<string[]> {
  const { rows } = await db.query<{ project_id: string }>(
    "SELECT project_id FROM fa4_project WHERE email = $1 AND status <> 'ANONYMIZED' ORDER BY updated_at DESC LIMIT $2", [normalizeEmail(email), limit]);
  return rows.map((r) => r.project_id);
}

// ------------------------------------------------------------------ results (append-only)
export async function storeResult(tx: Db, projectId: string, model: YourExpansionViewModel): Promise<string> {
  const { rows } = await tx.query<{ result_id: string }>("INSERT INTO fa4_result (project_id, catalog_version, model) VALUES ($1, $2, $3::jsonb) RETURNING result_id", [projectId, model.catalogVersion, JSON.stringify(model)]);
  await tx.query("UPDATE fa4_project SET status = 'DELIVERED', updated_at = now() WHERE project_id = $1 AND status = 'IN_PROGRESS'", [projectId]);
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
const MAX_SIGNAL_ID = 200;
/** Semantic ids are stable across re-delivery; very long ones (free-text needs) are shortened deterministically. */
export const storedSignalId = (id: string) => (id.length <= MAX_SIGNAL_ID ? id : `${id.slice(0, 150)}:${stableId(id)}`);

/**
 * Synchronizes the project's signals with its current demand without ever deleting (the runtime role has no DELETE):
 *  - a signal that is still demanded is UPSERTed under the same semantic id; operational fields (owner, sourcing, triage) are kept
 *    so sourcing work is never orphaned by a re-delivery;
 *  - a signal that is no longer demanded is SUPERSEDED (kept for history and visible to Sourcing), and revived if demand returns.
 */
export async function syncSignals(tx: Db, projectId: string, signals: DemandSignal[]): Promise<void> {
  const ids: string[] = [];
  for (const s of signals) {
    const id = storedSignalId(s.signalId);
    ids.push(id);
    await tx.query(
      `INSERT INTO fa4_demand_signal (signal_id, project_id, destination, capability_id, reason, class, sourcing_status, triage_status, owner, premium_state, catalog_version, payload)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
       ON CONFLICT (signal_id) DO UPDATE SET
         destination = EXCLUDED.destination, capability_id = EXCLUDED.capability_id, reason = EXCLUDED.reason, class = EXCLUDED.class,
         premium_state = EXCLUDED.premium_state, catalog_version = EXCLUDED.catalog_version, superseded_at = NULL, updated_at = now(),
         payload = EXCLUDED.payload || jsonb_build_object('createdAt', fa4_demand_signal.payload->'createdAt', 'owner', fa4_demand_signal.owner, 'sourcingStatus', fa4_demand_signal.sourcing_status, 'triageStatus', fa4_demand_signal.triage_status)
       WHERE fa4_demand_signal.project_id = EXCLUDED.project_id`,
      [id, projectId, s.destination, s.capabilityId, s.reason, s.class, s.sourcingStatus, s.triageStatus, s.owner, s.premiumState, s.catalogVersion, JSON.stringify({ ...s, signalId: id, supersededAt: null })],
    );
  }
  await tx.query(
    `UPDATE fa4_demand_signal SET superseded_at = now(), updated_at = now(),
            payload = payload || jsonb_build_object('supersededAt', now())
      WHERE project_id = $1 AND superseded_at IS NULL AND NOT (signal_id = ANY($2::text[]))`,
    [projectId, ids],
  );
}
export async function rawSignals(db: Db, projectId: string, opts: { includeSuperseded?: boolean } = {}): Promise<DemandSignal[]> {
  return (await db.query<{ payload: DemandSignal }>(
    `SELECT payload FROM fa4_demand_signal WHERE project_id = $1 ${opts.includeSuperseded ? "" : "AND superseded_at IS NULL"} ORDER BY signal_id`, [projectId])).rows.map((r) => r.payload);
}
export async function allSignals(db: Db, opts: { includeSuperseded?: boolean } = {}): Promise<DemandSignal[]> {
  return (await db.query<{ payload: DemandSignal }>(
    `SELECT payload FROM fa4_demand_signal ${opts.includeSuperseded ? "" : "WHERE superseded_at IS NULL"} ORDER BY signal_id`)).rows.map((r) => r.payload);
}

// ------------------------------------------------------------------ continuation
/** Idempotent per (project, result): a second click does not create a second request. */
export async function requestContinuation(db: Db, projectId: string, resultId: string): Promise<void> {
  await db.query("INSERT INTO fa4_continuation_request (project_id, result_id) VALUES ($1, $2) ON CONFLICT (project_id, result_id) DO NOTHING", [projectId, resultId]);
}
export async function continuationRequests(db: Db, projectId: string) {
  return (await db.query("SELECT request_id, result_id FROM fa4_continuation_request WHERE project_id = $1", [projectId])).rows;
}

export const stableId = (...parts: string[]) => createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 16);
