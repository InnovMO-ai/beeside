import { createHash } from "node:crypto";
import type { Queryable } from "./domain-isolation";

/**
 * Privacy-erasure consistency across the transition between the legacy `discovery` database and the canonical `beeside` database (finding F2).
 *
 * Rule: a personal-data erasure (fa4_anonymize_project) is effective on BOTH sides, whichever side it was executed on and whenever (before the copy, between the copy and the
 * write freeze, after the cutover, after a rollback). Nothing that moves data between the sides may bring personal data back.
 *
 *   evidence   every side keeps its own append-only fa4_privacy_erasure_log. Propagating an erasure writes a NEW row on the lagging side (through the same SECURITY DEFINER
 *              function, run by that side's own migrator) whose reason names the origin (database, erasure id, original actor and time). The domain sync later copies the log rows both
 *              ways (append-only), so both logs end up with the complete history. Nothing is ever deleted or edited.
 *   converged  for every project that has an erasure row on EITHER side and exists on a side: that side has an erasure row for it AND holds no personal data for it (every table is in
 *              the exact scrubbed form fa4_anonymize_project writes). A project that does not exist yet on a side is not a problem: the sync copies the already scrubbed rows.
 *   fail safe  domain-data-sync refuses to start (and aborts its transaction) unless both sides are converged and no erasure happened on either side while it ran. If the state cannot
 *              be read or the erasure function is not available, it is NOT converged.
 * No row content is ever returned: only identifiers, counts and hashes.
 */
export const ERASURE_ACTOR = "domain-erasure-reconcile";

export class ErasureGateError extends Error {
  constructor(message: string, readonly detail: Record<string, unknown> = {}) { super(message); this.name = "ErasureGateError"; }
}

export interface ErasureEntry { erasureId: string; projectId: string; performedAt: string; actor: string; origin: string }
export interface ErasureManifest { version: 1; entries: ErasureEntry[]; sha256: string }
export interface SideReport {
  database: string;
  logRows: number;
  /** erased projects (of the union) that exist on this side */
  present: number;
  /** present projects without an erasure row on this side */
  missingEvidence: number;
  /** present projects that still hold personal data on this side */
  residue: number;
  /** projects this run re-anonymised on this side */
  applied: number;
}
export interface ReconcileReport { a: SideReport; b: SideReport | null; erasedProjects: number; converged: boolean; manifestSha256: string; apply: boolean }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function manifestOf(entries: ErasureEntry[]): ErasureManifest {
  const seen = new Map<string, ErasureEntry>();
  for (const e of entries) if (!seen.has(e.erasureId)) seen.set(e.erasureId, e);
  const sorted = [...seen.values()].sort((x, y) => (x.performedAt + x.erasureId).localeCompare(y.performedAt + y.erasureId));
  const sha256 = createHash("sha256").update(JSON.stringify(sorted.map((e) => [e.erasureId, e.projectId, e.performedAt, e.actor, e.origin]))).digest("hex");
  return { version: 1, entries: sorted, sha256 };
}

export function parseManifest(text: string): ErasureManifest {
  let m: ErasureManifest;
  try { m = JSON.parse(text) as ErasureManifest; } catch { throw new ErasureGateError("the erasure manifest is not valid JSON"); }
  if (m.version !== 1 || !Array.isArray(m.entries)) throw new ErasureGateError("unsupported erasure manifest");
  for (const e of m.entries) {
    if (!UUID.test(e.erasureId) || !UUID.test(e.projectId) || typeof e.performedAt !== "string" || typeof e.actor !== "string" || typeof e.origin !== "string") throw new ErasureGateError("malformed erasure manifest entry");
  }
  if (manifestOf(m.entries).sha256 !== m.sha256) throw new ErasureGateError("the erasure manifest was altered: its SHA-256 does not match its entries");
  return m;
}

async function requireErasureSchema(db: Queryable, label: string): Promise<void> {
  const r = (await db.query<{ log: string | null; project: string | null; fn: string | null }>(
    "SELECT to_regclass('public.fa4_privacy_erasure_log')::text AS log, to_regclass('public.fa4_project')::text AS project, to_regprocedure('public.fa4_anonymize_project(uuid,text,text)')::text AS fn")).rows[0]!;
  if (!r.log || !r.project || !r.fn) throw new ErasureGateError(`${label}: the erasure log or fa4_anonymize_project() is missing: privacy consistency cannot be guaranteed`);
}

export async function dbName(db: Queryable): Promise<string> {
  return (await db.query<{ d: string }>("SELECT current_database() AS d")).rows[0]!.d;
}

export async function readLog(db: Queryable): Promise<ErasureEntry[]> {
  const origin = await dbName(db);
  await requireErasureSchema(db, origin);
  return (await db.query<{ erasure_id: string; project_id: string; performed_at: string; actor: string }>(
    "SELECT erasure_id::text, project_id::text, to_char(performed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"') AS performed_at, actor FROM fa4_privacy_erasure_log ORDER BY performed_at, erasure_id")).rows
    .map((r) => ({ erasureId: r.erasure_id, projectId: r.project_id, performedAt: r.performed_at, actor: r.actor, origin }));
}

/** Order-independent fingerprint of the erasure ledger of one side (changes if any erasure is recorded). */
export async function ledgerFingerprint(db: Queryable): Promise<string> {
  const r = (await db.query<{ n: number; s: string }>(
    "SELECT count(*)::int AS n, COALESCE(md5(string_agg(erasure_id::text || ':' || project_id::text, ',' ORDER BY erasure_id)), '') AS s FROM fa4_privacy_erasure_log")).rows[0]!;
  return `${r.n}:${r.s}`;
}

interface ProjectState { id: string; hasLog: boolean; residue: boolean }

/** For the given erased projects: which exist on this side, whether this side has evidence for them, and whether any personal data is left. */
async function stateOf(db: Queryable, ids: string[]): Promise<ProjectState[]> {
  if (!ids.length) return [];
  const rows = (await db.query<{ id: string; has_log: boolean; residue: boolean }>(
    `SELECT p.project_id::text AS id,
            EXISTS (SELECT 1 FROM fa4_privacy_erasure_log l WHERE l.project_id = p.project_id) AS has_log,
            (p.status <> 'ANONYMIZED'
             OR p.email <> 'anonymized+' || p.project_id::text || '@invalid.invalid'
             OR p.answers <> '{}'::jsonb
             OR EXISTS (SELECT 1 FROM fa4_result r WHERE r.project_id = p.project_id
                          AND (r.model <> '{"anonymized": true}'::jsonb
                               OR r.source_snapshot IS DISTINCT FROM CASE WHEN r.source_snapshot IS NULL THEN NULL ELSE '{"anonymized": true}'::jsonb END
                               OR r.resolution_snapshot IS DISTINCT FROM CASE WHEN r.resolution_snapshot IS NULL THEN NULL ELSE '{"anonymized": true}'::jsonb END))
             OR EXISTS (SELECT 1 FROM fa4_demand_signal s WHERE s.project_id = p.project_id AND s.payload <> '{"anonymized": true}'::jsonb)
             OR EXISTS (SELECT 1 FROM fa4_contact_request c WHERE c.project_id = p.project_id
                          AND (c.name <> 'anonymized' OR c.company <> 'anonymized' OR c.message <> 'anonymized' OR c.email <> 'anonymized+' || c.contact_id::text || '@invalid.invalid'))
             OR EXISTS (SELECT 1 FROM fa4_access_token t WHERE t.project_id = p.project_id AND t.revoked_at IS NULL)) AS residue
       FROM fa4_project p WHERE p.project_id = ANY($1::uuid[]) ORDER BY 1`, [ids])).rows;
  return rows.map((r) => ({ id: r.id, hasLog: r.has_log, residue: r.residue }));
}

const needsWork = (s: ProjectState): boolean => !s.hasLog || s.residue;

/** Applies the erasures of `entries` that this side is missing (or only half has), one transaction, through the side's own migrator. */
async function applySide(db: Queryable, label: string, entries: ErasureEntry[], apply: boolean): Promise<SideReport> {
  const ids = [...new Set(entries.map((e) => e.projectId))].sort();
  const log = await readLog(db);
  let state = await stateOf(db, ids);
  let applied = 0;
  const pending = state.filter(needsWork);
  if (apply && pending.length) {
    await db.query("BEGIN");
    try {
      for (const p of pending) {
        // the earliest known erasure of the project is the origin recorded as evidence
        const origin = entries.filter((e) => e.projectId === p.id).sort((x, y) => (x.performedAt + x.erasureId).localeCompare(y.performedAt + y.erasureId))[0]!;
        const reason = `${p.hasLog ? "residual re-scrub" : "propagated"} of erasure ${origin.erasureId} (origin ${origin.origin}, actor ${origin.actor}, at ${origin.performedAt})`;
        await db.query("SELECT fa4_anonymize_project($1::uuid, $2, $3)", [p.id, ERASURE_ACTOR, reason]);
        applied += 1;
      }
      await db.query("COMMIT");
    } catch (e) {
      await db.query("ROLLBACK");
      throw new ErasureGateError(`${label}: the erasure could not be applied (${e instanceof Error ? e.message : String(e)}); nothing was changed on this side`);
    }
    state = await stateOf(db, ids);
  }
  return {
    database: label, logRows: log.length, present: state.length,
    missingEvidence: state.filter((s) => !s.hasLog).length, residue: state.filter((s) => s.residue).length, applied,
  };
}

/**
 * Brings both sides to the same erasure state (apply=true) or only measures it (apply=false). With `offline` entries (a manifest exported from the other side) only side A is touched.
 * Throws ErasureGateError if, after applying, either side is still not converged.
 */
export async function reconcileErasures(a: Queryable, b: Queryable | null, opts: { apply: boolean; offline?: ErasureManifest }): Promise<ReconcileReport> {
  const entriesA = await readLog(a);
  const entriesB = b ? await readLog(b) : [];
  const manifest = manifestOf([...entriesA, ...entriesB, ...(opts.offline?.entries ?? [])]);
  const [la, lb] = [await dbName(a), b ? await dbName(b) : ""];
  const ra = await applySide(a, la, manifest.entries, opts.apply);
  const rb = b ? await applySide(b, lb, manifest.entries, opts.apply) : null;
  const converged = [ra, rb].every((r) => !r || (r.missingEvidence === 0 && r.residue === 0));
  const report: ReconcileReport = { a: ra, b: rb, erasedProjects: new Set(manifest.entries.map((e) => e.projectId)).size, converged, manifestSha256: manifest.sha256, apply: opts.apply };
  if (opts.apply && !converged) throw new ErasureGateError("erasure state is still not converged after applying: stop and investigate before any data move", { report });
  return report;
}

/** The gate used by domain-data-sync: measure only, never write. Throws unless both sides are converged. */
export async function assertErasureConverged(source: Queryable, target: Queryable): Promise<{ report: ReconcileReport; fingerprints: { source: string; target: string } }> {
  const report = await reconcileErasures(source, target, { apply: false });
  if (!report.converged) throw new ErasureGateError("refused: the two databases disagree about personal-data erasures (run domain-erasure-reconcile first); nothing was copied", { report });
  return { report, fingerprints: { source: await ledgerFingerprint(source), target: await ledgerFingerprint(target) } };
}
