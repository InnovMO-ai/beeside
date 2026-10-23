import { Db } from "../../db/database";
import {
  OhAccessState,
  OhAcceptance,
  OhErrorCode,
  OhExternalReference,
  OhHandoffPayload,
  OhPortError,
  OperationHubPort,
  payloadChecksum,
} from "../ports/operation-hub";

/**
 * OhDeliveryService — orchestrates "Send to Operation Hub" on top of OperationHubPort and the append-only
 * `oh_delivery` ledger. It knows nothing about the platform behind the port.
 *
 * Rules (contract v1.1):
 *  - "sent" is produced ONLY from a port acceptance whose checksum equals payloadChecksum(payload).
 *  - A delivered key is never published twice (duplicate click, concurrent click, retry after success).
 *  - The first send of a project must succeed before a different artifact may be sent (ACTIVATION_PENDING_RETRY_FIRST).
 *  - An unknown outcome (TIMEOUT / UNAVAILABLE) is resolved by a read-back before it is called a failure.
 *  - The ledger is append-only: queued -> delivered | failed per attempt; a user retry is a new attempt of the same key.
 *  - Clients get a calm category, never a technical code. The code goes to the ledger only.
 *
 * Concurrency: one transaction per send holds a per-project advisory lock for its whole duration (project-level
 * rather than key-level, which also serialises the first-send gate). The platform call therefore happens while a
 * connection is held; the port's own timeouts and this service's bounded attempts keep that finite.
 */

export type OhLedgerKind = "crp" | "psm" | "update_note";
export type SendState = "sent" | "failed" | "blocked";
/** What a client may be told. Never contains a platform name or a technical code. */
export type ClientFailureCategory = "try_again_later" | "needs_attention" | "first_send_required";

export interface SendInput {
  projectId: string;
  kind: OhLedgerKind;
  /** crp: the pack. */
  packId?: string;
  /** psm: the service-map snapshot. */
  snapshotId?: string;
  artifactVersion: number;
  payload: OhHandoffPayload;
}

export interface SendResult {
  state: SendState;
  idempotencyKey: string;
  /** Ledger attempt number this call wrote (absent when nothing was attempted). */
  attempt?: number;
  /** Opaque compact reference (see encodeOhReference) when sent. */
  reference?: string;
  /** True when the key had already been delivered and the port was not called. */
  alreadySent?: boolean;
  clientCategory?: ClientFailureCategory;
  /** Whether showing a "Try again" action makes sense. */
  canRetry?: boolean;
}

export interface SendRetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface OhDeliveryDeps {
  db: Db;
  port: OperationHubPort;
  retry?: Partial<SendRetryPolicy>;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export interface LastDelivery {
  idempotencyKey: string;
  kind: OhLedgerKind;
  status: "queued" | "delivered" | "failed";
  attempt: number;
  artifactVersion: number;
  createdAt: Date;
  reference?: string;
}

export type GoToOperationHub = "hidden" | "pending_access" | "enter";

export interface SendStateView {
  firstSendDone: boolean;
  lastDelivery?: LastDelivery;
  ohAccess: OhAccessState;
  ux: { goToOperationHub: GoToOperationHub; contactMySherpa: boolean };
}

const DEFAULT_RETRY: SendRetryPolicy = { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 15_000 };

export function ohIdempotencyKey(i: { projectId: string; kind: OhLedgerKind; artifactId: string; artifactVersion: number }): string {
  return `${i.projectId}:${i.kind}:${i.artifactId}:${i.artifactVersion}`;
}

const REF_FIELDS = ["artifactId", "locationId", "workItemId", "secureReference"] as const;

/** Compact opaque string, no JSON: `artifactId=..|locationId=..` with values percent-encoded. Precision never interprets it. */
export function encodeOhReference(ref: OhExternalReference): string {
  return REF_FIELDS.filter((f) => ref[f]).map((f) => `${f}=${encodeURIComponent(ref[f]!)}`).join("|");
}

export function decodeOhReference(text: string): OhExternalReference {
  const out: OhExternalReference = {};
  for (const part of text.split("|")) {
    const i = part.indexOf("=");
    const raw = part.slice(0, i);
    // `taskId` is the pre-neutral spelling of workItemId: references stored before the rename still read.
    const k = (raw === "taskId" ? "workItemId" : raw) as (typeof REF_FIELDS)[number];
    if (i > 0 && REF_FIELDS.includes(k)) out[k] = decodeURIComponent(part.slice(i + 1));
  }
  return out;
}

/**
 * Presents a stored reference in the neutral model. The ledger is append-only and is NEVER rewritten: rows written before the neutral
 * `workItemId` (spelled `taskId` then) keep their text, and every read goes through here, so old state stays readable and new writes use
 * the canonical spelling. An unreadable value is returned as it is (never dropped).
 */
export function normalizeOhReference(text: string): string {
  const decoded = decodeOhReference(text);
  const encoded = encodeOhReference(decoded);
  return encoded === "" ? text : encoded;
}

const PAYLOAD_KINDS: Record<OhLedgerKind, ReadonlyArray<OhHandoffPayload["contract"]["kind"]>> = {
  crp: ["first_send", "crp"],
  psm: ["psm_update"],
  update_note: [],
};

function categoryFor(code: OhErrorCode): ClientFailureCategory {
  switch (code) {
    case "TIMEOUT":
    case "UNAVAILABLE":
    case "RATE_LIMITED":
    case "UNKNOWN":
      return "try_again_later";
    default:
      return "needs_attention";
  }
}

interface Resolved { code: OhErrorCode }

export class OhDeliveryService {
  private readonly retry: SendRetryPolicy;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(private readonly deps: OhDeliveryDeps) {
    this.retry = { ...DEFAULT_RETRY, ...(deps.retry ?? {}) };
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.random = deps.random ?? Math.random;
  }

  async send(input: SendInput): Promise<SendResult> {
    const artifactId = input.kind === "psm" ? input.snapshotId : input.packId;
    if (input.kind === "update_note") throw new Error("update_note deliveries are not supported yet");
    if (!artifactId) throw new Error(`${input.kind} delivery requires ${input.kind === "psm" ? "snapshotId" : "packId"}`);
    if ((input.kind === "psm" ? input.packId : input.snapshotId) !== undefined) throw new Error("a delivery references exactly one artifact");
    if (!Number.isInteger(input.artifactVersion) || input.artifactVersion < 1) throw new Error("artifactVersion must be a positive integer");
    const key = ohIdempotencyKey({ projectId: input.projectId, kind: input.kind, artifactId, artifactVersion: input.artifactVersion });
    const p = input.payload;
    if (p.contract.idempotency_key !== key) throw new Error("payload idempotency_key does not match the delivery key");
    if (p.identity.project_id !== input.projectId) throw new Error("payload project does not match the delivery project");
    if (!PAYLOAD_KINDS[input.kind].includes(p.contract.kind)) throw new Error(`payload kind ${p.contract.kind} does not match delivery kind ${input.kind}`);

    return this.deps.db.transaction((tx) => this.sendLocked(tx, input, key));
  }

  private async sendLocked(tx: Db, input: SendInput, key: string): Promise<SendResult> {
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`oh:project:${input.projectId}`]);

    const current = await tx.query<{ status: string; oh_reference: string | null }>(
      "SELECT status, oh_reference FROM oh_delivery_current WHERE idempotency_key = $1",
      [key],
    );
    const cur = current.rows[0];
    if (cur?.status === "delivered") {
      return { state: "sent", idempotencyKey: key, alreadySent: true, ...(cur.oh_reference ? { reference: normalizeOhReference(cur.oh_reference) } : {}) };
    }

    // Activation gate: the first CRP send of a project must succeed before anything else is sent.
    const provisioned = (await tx.query("SELECT 1 FROM oh_delivery WHERE project_id = $1 AND kind = 'crp' AND status = 'delivered' LIMIT 1", [input.projectId])).rows.length > 0;
    if (!provisioned) {
      const first = (await tx.query<{ idempotency_key: string }>("SELECT idempotency_key FROM oh_delivery WHERE project_id = $1 AND kind = 'crp' ORDER BY seq ASC LIMIT 1", [input.projectId])).rows[0];
      const blocked = input.kind !== "crp" || (first !== undefined && first.idempotency_key !== key);
      if (blocked) {
        return { state: "blocked", idempotencyKey: key, clientCategory: "first_send_required", canRetry: false };
      }
    }

    const attempt = (await tx.query<{ n: number }>("SELECT COALESCE(MAX(attempt), 0) + 1 AS n FROM oh_delivery WHERE idempotency_key = $1", [key])).rows[0]!.n;
    const insert = (status: "queued" | "delivered" | "failed", extra: { reference?: string; errorCode?: string } = {}) =>
      tx.query(
        `INSERT INTO oh_delivery (project_id, kind, pack_id, snapshot_id, artifact_version, status, oh_reference, idempotency_key, error_code, attempt)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [input.projectId, input.kind, input.packId ?? null, input.snapshotId ?? null, input.artifactVersion, status, extra.reference ?? null, key, extra.errorCode ?? null, attempt],
      );
    await insert("queued");

    const outcome = await this.publishWithPolicy(input.payload, key);
    if (outcome.ok) {
      const reference = encodeOhReference(outcome.reference);
      await insert("delivered", { reference });
      return { state: "sent", idempotencyKey: key, attempt, reference };
    }
    await insert("failed", { errorCode: outcome.code });
    const category = categoryFor(outcome.code);
    return { state: "failed", idempotencyKey: key, attempt, clientCategory: category, canRetry: category === "try_again_later" };
  }

  /** Publishes with bounded attempts; every unknown outcome is resolved by read-back before it is counted as a failure. */
  private async publishWithPolicy(payload: OhHandoffPayload, key: string): Promise<{ ok: true; reference: OhExternalReference } | ({ ok: false } & Resolved)> {
    const expected = payloadChecksum(payload);
    let lastCode: OhErrorCode = "UNKNOWN";
    for (let attempt = 1; attempt <= this.retry.maxAttempts; attempt++) {
      const res: { acceptance: OhAcceptance } | { error: OhPortError } = await this.deps.port.publish(payload).then(
        (acceptance) => ({ acceptance }),
        (e: unknown) => ({ error: e instanceof OhPortError ? e : new OhPortError("UNKNOWN", "unexpected failure") }),
      );
      if ("acceptance" in res) {
        // "Sent" requires an acceptance AND a checksum equal to what we sent.
        if (res.acceptance.checksum === expected) return { ok: true, reference: res.acceptance.reference };
        return { ok: false, code: "CHECKSUM_MISMATCH" };
      }
      const error = res.error;
      lastCode = error.code;
      if (error.outcomeUnknown) {
        const seen = await this.deps.port.verify(key).catch(() => undefined);
        if (seen?.found) {
          if (seen.checksum === expected && seen.reference) return { ok: true, reference: seen.reference };
          return { ok: false, code: "CHECKSUM_MISMATCH" };
        }
      }
      if (!error.retryable) return { ok: false, code: error.code };
      if (attempt < this.retry.maxAttempts) {
        const exp = Math.min(this.retry.maxDelayMs, this.retry.baseDelayMs * 2 ** (attempt - 1));
        await this.sleep(Math.floor(this.random() * exp));
      }
    }
    return { ok: false, code: lastCode };
  }

  /** State for the UX rules; reads the ledger and asks the port for access only once a first send has been accepted. */
  async getSendState(projectId: string): Promise<SendStateView> {
    const { db, port } = this.deps;
    const firstSendDone = (await db.query("SELECT 1 FROM oh_delivery WHERE project_id = $1 AND kind = 'crp' AND status = 'delivered' LIMIT 1", [projectId])).rows.length > 0;
    const last = (await db.query<{
      idempotency_key: string; kind: OhLedgerKind; status: LastDelivery["status"]; attempt: number; artifact_version: number; created_at: Date; oh_reference: string | null;
    }>("SELECT idempotency_key, kind, status, attempt, artifact_version, created_at, oh_reference FROM oh_delivery WHERE project_id = $1 ORDER BY seq DESC LIMIT 1", [projectId])).rows[0];

    let ohAccess: OhAccessState = { provisioned: false, clientAccessible: false, sherpaAssigned: false };
    if (firstSendDone) {
      // If the platform cannot be asked right now, say only what the ledger proves: provisioned, nothing more.
      ohAccess = await port.accessState(projectId).catch((): OhAccessState => ({ provisioned: true, clientAccessible: false, sherpaAssigned: false }));
    }
    const goToOperationHub: GoToOperationHub = !firstSendDone ? "hidden" : ohAccess.clientAccessible ? "enter" : "pending_access";
    return {
      firstSendDone,
      ...(last
        ? {
            lastDelivery: {
              idempotencyKey: last.idempotency_key,
              kind: last.kind,
              status: last.status,
              attempt: last.attempt,
              artifactVersion: last.artifact_version,
              createdAt: last.created_at,
              ...(last.oh_reference ? { reference: normalizeOhReference(last.oh_reference) } : {}),
            },
          }
        : {}),
      ohAccess,
      ux: { goToOperationHub, contactMySherpa: ohAccess.provisioned && ohAccess.clientAccessible && ohAccess.sherpaAssigned },
    };
  }
}
