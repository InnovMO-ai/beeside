/**
 * Read-side data access for the CRP surface. Plain parametrised SQL through `Db` (same convention as repository.ts).
 * Every loader takes the project id and scopes by it: a category, pack or snapshot of another project is never returned.
 */
import type { Db } from "../../../db/database";
import type { CenterDto, Locale, SendStateDto } from "../../api/dto";
import type { OhDeliveryService } from "../../delivery/oh-delivery-service";
import type { AnswerState, FactMap } from "../../manifest/types";
import { ohContactAction } from "../oh-contact";
import { CrpError } from "./errors";
import { sanitizeOrNull } from "./sanitize";

export type CategoryLifecycle = "proposed" | "not_selected" | "confirmed" | "in_progress" | "completed";

export interface CategoryRow {
  instanceId: string;
  projectId: string;
  categoryKey: string;
  lifecycle: CategoryLifecycle;
  manifestVersion: string;
  currentPackId: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: unknown): s is string => typeof s === "string" && UUID.test(s);

interface CategoryDbRow {
  instance_id: string;
  project_id: string;
  category_key: string;
  lifecycle_status: CategoryLifecycle;
  manifest_version: string;
  current_pack_id: string | null;
}

/** Category of THIS project by `category_assessment.instance_id`. Anything else (unknown, other project, not a visible category) is NOT_FOUND. */
export async function resolveCategory(db: Db, projectId: string, id: string): Promise<CategoryRow> {
  if (!isUuid(id)) throw new CrpError("NOT_FOUND");
  const { rows } = await db.query<CategoryDbRow>(
    "SELECT instance_id, project_id, category_key, lifecycle_status, manifest_version, current_pack_id FROM category_assessment WHERE instance_id = $1 AND project_id = $2",
    [id, projectId],
  );
  const r = rows[0];
  if (!r || r.lifecycle_status === "proposed" || r.lifecycle_status === "not_selected") throw new CrpError("NOT_FOUND");
  return { instanceId: r.instance_id, projectId: r.project_id, categoryKey: r.category_key, lifecycle: r.lifecycle_status, manifestVersion: r.manifest_version, currentPackId: r.current_pack_id };
}

export async function lockCategory(tx: Db, instanceId: string): Promise<void> {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 7))", [`precision_crp:${instanceId}`]);
}

/** Current (non-superseded) facts of one instance, keyed by manifest field key (the "precision." prefix removed). */
export async function loadFactMap(db: Db, instanceId: string): Promise<{ facts: FactMap; factIds: string[] }> {
  const { rows } = await db.query<{ id: string; field_key: string; value: unknown; answer_state: string }>(
    "SELECT id, field_key, value, answer_state FROM fact WHERE scope_instance_id = $1 AND superseded_by IS NULL ORDER BY field_key",
    [instanceId],
  );
  const facts: Record<string, { value: unknown; answerState: AnswerState }> = {};
  for (const r of rows) facts[r.field_key.replace(/^precision\./, "")] = { value: r.value, answerState: r.answer_state as AnswerState };
  return { facts, factIds: rows.map((r) => r.id) };
}

export interface ProjectFacts {
  countries: string[];
  objective: string | null;
  timeWindow: string | null;
  productOrService: string | null;
  operatingEntity: string | null;
  factIds: string[];
}

function plain(v: unknown): string | null {
  if (typeof v === "string") return sanitizeOrNull(v, 500);
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (Array.isArray(v)) return sanitizeOrNull(v.map(plain).filter(Boolean).join(", "), 500);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const text = o.text ?? o.label ?? o.value;
    if (text !== undefined) return plain(text);
    const from = plain(o.from ?? o.start);
    const to = plain(o.to ?? o.end);
    if (from && to) return `${from} – ${to}`;
    return from ?? to;
  }
  return null;
}

/** Project-level (Understanding) facts the CRP and the payload need. Missing facts are simply absent. */
export async function loadProjectFacts(db: Db, projectId: string): Promise<ProjectFacts> {
  const { rows } = await db.query<{ id: string; field_key: string; value: unknown; answer_state: string }>(
    `SELECT f.id, f.field_key, f.value, f.answer_state FROM fact f JOIN precision_instance pi ON pi.id = f.scope_instance_id
      WHERE pi.project_id = $1 AND pi.scope = 'project' AND f.superseded_by IS NULL AND f.field_key LIKE 'precision.pa\\_%'`,
    [projectId],
  );
  const by = new Map(rows.filter((r) => r.answer_state === "ANSWERED" || r.answer_state === "ASSUMED").map((r) => [r.field_key.replace(/^precision\./, ""), r]));
  const countriesRaw = by.get("pa_destination_countries")?.value;
  const countries = (Array.isArray(countriesRaw) ? countriesRaw : typeof countriesRaw === "string" ? [countriesRaw] : [])
    .map((c) => (typeof c === "string" ? c.trim().toUpperCase() : ""))
    .filter((c) => /^[A-Z]{2}$/.test(c));
  return {
    countries: [...new Set(countries)],
    objective: plain(by.get("pa_project_objective")?.value),
    timeWindow: plain(by.get("pa_time_window")?.value),
    productOrService: plain(by.get("pa_expansion_product_or_service")?.value),
    operatingEntity: plain(by.get("pa_operating_entity")?.value),
    factIds: [...by.values()].map((r) => r.id),
  };
}

export interface ContextVersions { pinId: string | null; catalog: string | null; crosswalk: string | null; contract: string | null }

export async function loadContextVersions(db: Db, projectId: string): Promise<ContextVersions> {
  const { rows } = await db.query<{ id: string; catalog_version: string; crosswalk_version: string; contract_version: string }>(
    "SELECT id, catalog_version, crosswalk_version, contract_version FROM context_pin WHERE project_id = $1 AND status = 'current'",
    [projectId],
  );
  const r = rows[0];
  return { pinId: r?.id ?? null, catalog: r?.catalog_version ?? null, crosswalk: r?.crosswalk_version ?? null, contract: r?.contract_version ?? null };
}

export interface PackRow { id: string; version: number; generatedAt: Date; content: unknown; contextSnapshot: unknown; confirmedAt: Date | null }

/** The category's current pack with its client confirmation (null `confirmedAt` = not confirmed). */
export async function loadCurrentPack(db: Db, category: CategoryRow): Promise<PackRow | null> {
  if (!category.currentPackId) return null;
  const { rows } = await db.query<{ id: string; version: number; generated_at: Date; content: unknown; context_snapshot: unknown; confirmed_at: Date | null }>(
    `SELECT p.id, p.version, p.generated_at, p.content, p.context_snapshot, c.confirmed_at
       FROM pack p LEFT JOIN crp_confirmation c ON c.pack_id = p.id AND c.project_id = $3
      WHERE p.id = $1 AND p.category_assessment_instance_id = $2`,
    [category.currentPackId, category.instanceId, category.projectId],
  );
  const r = rows[0];
  return r ? { id: r.id, version: r.version, generatedAt: r.generated_at, content: r.content, contextSnapshot: r.context_snapshot, confirmedAt: r.confirmed_at } : null;
}

export interface SnapshotRow { id: string; version: number; confirmedAt: Date; content: unknown }

/** The current confirmed My Service Map snapshot of the project (never a live view). */
export async function loadCurrentSnapshot(db: Db, projectId: string): Promise<SnapshotRow | null> {
  const { rows } = await db.query<{ id: string; version: number; confirmed_at: Date; content: unknown }>(
    `SELECT s.id, s.version, s.confirmed_at, s.content
       FROM precision_assessment pa
       JOIN precision_instance pi ON pi.id = pa.instance_id AND pi.project_id = $1 AND pi.scope = 'project'
       JOIN service_map_snapshot s ON s.id = pa.service_map_snapshot_id`,
    [projectId],
  );
  const r = rows[0];
  return r ? { id: r.id, version: r.version, confirmedAt: r.confirmed_at, content: r.content } : null;
}

export async function loadCompany(db: Db, projectId: string): Promise<{ companyId: string; name: string } | null> {
  const { rows } = await db.query<{ company_id: string; name: string }>(
    "SELECT c.company_id, c.name FROM project p JOIN company c ON c.company_id = p.company_id WHERE p.project_id = $1",
    [projectId],
  );
  return rows[0] ? { companyId: rows[0].company_id, name: rows[0].name } : null;
}

/** `precision_config` value for a key (locale-specific row first, then '*'). Missing -> null, never an error. */
export async function readConfigString(db: Db, key: string, locale: Locale): Promise<string | null> {
  try {
    const { rows } = await db.query<{ value: unknown }>(
      "SELECT value FROM precision_config WHERE key = $1 AND is_active AND locale IN ($2, '*') ORDER BY (locale = $2) DESC LIMIT 1",
      [key, locale],
    );
    const v = rows[0]?.value;
    const s = typeof v === "string" ? v : v && typeof v === "object" && typeof (v as { url?: unknown }).url === "string" ? (v as { url: string }).url : null;
    return s && /^https?:\/\//i.test(s) ? s : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- ledger projections

export interface LedgerView {
  sendState: SendStateDto;
  /** True when the project's first CRP delivery has been accepted. */
  firstSendDone: boolean;
  /** Key of the project's first accepted CRP delivery (null before). */
  firstDeliveredKey: string | null;
  /** The first send of the project was attempted with ANOTHER key and has not succeeded: this one must wait. */
  blockedByOther: boolean;
  /** Ledger rows exist for this key (some attempt happened). */
  attempted: boolean;
  /** Technical code of the latest failed attempt for this key (ledger only; never shown). */
  lastErrorCode: string | null;
}

export type FailureAction = "try_again_later" | "needs_attention";
/** What the client may be told after a failed attempt: a calm category derived from the ledger code. */
export function failureAction(code: string | null): { clientAction: FailureAction; retryable: boolean } {
  const transient = code === null || ["TIMEOUT", "UNAVAILABLE", "RATE_LIMITED", "UNKNOWN"].includes(code);
  return transient ? { clientAction: "try_again_later", retryable: true } : { clientAction: "needs_attention", retryable: false };
}

export const crpDeliveryKey = (projectId: string, packId: string, version: number): string => `${projectId}:crp:${packId}:${version}`;

export async function ledgerView(db: Db, projectId: string, key: string | null): Promise<LedgerView> {
  const first = (await db.query<{ idempotency_key: string }>(
    "SELECT idempotency_key FROM oh_delivery WHERE project_id = $1 AND kind = 'crp' AND status = 'delivered' ORDER BY seq ASC LIMIT 1",
    [projectId],
  )).rows[0];
  let sendState: SendStateDto = "not_sent";
  let attempted = false;
  let blockedByOther = false;
  let lastErrorCode: string | null = null;
  if (key) {
    const cur = (await db.query<{ status: string; error_code: string | null }>("SELECT status, error_code FROM oh_delivery_current WHERE idempotency_key = $1 AND project_id = $2", [key, projectId])).rows[0];
    if (cur) {
      attempted = true;
      lastErrorCode = cur.error_code;
      sendState = cur.status === "delivered" ? "sent" : cur.status === "queued" ? "sending" : "failed";
    }
    if (!first) {
      const firstAttempt = (await db.query<{ idempotency_key: string }>(
        "SELECT idempotency_key FROM oh_delivery WHERE project_id = $1 AND kind = 'crp' ORDER BY seq ASC LIMIT 1",
        [projectId],
      )).rows[0];
      blockedByOther = firstAttempt !== undefined && firstAttempt.idempotency_key !== key;
    }
  }
  return { sendState, firstSendDone: first !== undefined, firstDeliveredKey: first?.idempotency_key ?? null, blockedByOther, attempted, lastErrorCode };
}

/** The `operationHub` block of the Center / Send result, from real states only. */
export async function operationHubDto(db: Db, delivery: OhDeliveryService, projectId: string, locale: Locale): Promise<CenterDto["operationHub"]> {
  const view = await delivery.getSendState(projectId);
  const state = view.ux.goToOperationHub;
  const url = state === "enter" ? await readConfigString(db, "operation_hub_url", locale) : null;
  return { state, url, contact: url ? await ohContactAction(db, locale, view) : null };
}
