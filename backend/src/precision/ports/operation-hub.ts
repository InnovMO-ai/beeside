import { createHash } from "node:crypto";
import { Described } from "./integration-descriptor";

/**
 * OperationHubPort — the only thing Precision knows about Operation Hub.
 *
 * Precision hands over a canonical, whitelisted payload and receives either an acceptance or a typed
 * error. Everything that is specific to a concrete platform (folders, lists, tasks, custom fields,
 * identifiers, workflow states) lives inside an adapter and never crosses this interface.
 *
 * "Sent" is a customer-visible state produced ONLY when `publish` returns an acceptance.
 */

export const OH_CONTRACT_VERSION = "1.1";

export type OhDeliveryKind = "first_send" | "crp" | "psm_update";

/** Canonical handoff payload (contract v1.1 whitelist). No YEV, no FA provenance, no conversation, no e-mail. */
export interface OhHandoffPayload {
  contract: {
    oh_contract_version: string;
    delivery_id: string;
    idempotency_key: string;
    kind: OhDeliveryKind;
    sent_at: string;
  };
  identity: { company_id: string; project_id: string };
  company_context: Record<string, unknown>;
  project_context: { psm: Record<string, unknown> };
  workstream: { workstream_id: string; category_key: string; category_label: string; crp_kind: string };
  artifact: { crp_id: string; crp_artifact_id: string; crp_version: number; structured: Record<string, unknown> };
  provenance: {
    psm_version: number;
    psm_confirmed_at: string;
    crp_version: number;
    crp_created_at: string;
    oh_contract_version: string;
  };
}

/** Opaque references returned by the platform. Precision stores them but never interprets them. */
export interface OhExternalReference {
  artifactId?: string;
  locationId?: string;
  taskId?: string;
  secureReference?: string;
}

export interface OhAcceptance {
  /** Stable reference that identifies this delivery on the platform side. */
  reference: OhExternalReference;
  /** Checksum the platform computed over what it stored (must equal the checksum Precision sent). */
  checksum: string;
  contractVersion: string;
  acceptedAt: string;
  /** True when the platform recognised the idempotency key and returned the existing delivery. */
  replayed: boolean;
}

/** Error taxonomy. `retryable` says whether repeating the SAME request (same idempotency key) is safe. */
export type OhErrorCode =
  | "TIMEOUT" //             outcome unknown: verify before treating as failed
  | "UNAVAILABLE" //         platform down / 5xx / network interruption
  | "RATE_LIMITED"
  | "REJECTED_VALIDATION" // payload refused; repeating will not help
  | "IDENTITY_MISMATCH" //   company/project do not match
  | "UNSUPPORTED_KIND"
  | "CHECKSUM_MISMATCH" //   platform stored something other than what was sent
  | "ACTIVATION_PENDING_RETRY_FIRST" // an earlier first send has not succeeded yet
  | "AUTH" //                credentials / configuration problem
  | "UNKNOWN";

export const OH_ERROR_RETRYABLE: Readonly<Record<OhErrorCode, boolean>> = {
  TIMEOUT: true,
  UNAVAILABLE: true,
  RATE_LIMITED: true,
  REJECTED_VALIDATION: false,
  IDENTITY_MISMATCH: false,
  UNSUPPORTED_KIND: false,
  CHECKSUM_MISMATCH: false,
  ACTIVATION_PENDING_RETRY_FIRST: false,
  AUTH: false,
  UNKNOWN: true,
};

export class OhPortError extends Error {
  readonly code: OhErrorCode;
  readonly retryable: boolean;
  /** For TIMEOUT / UNAVAILABLE: the platform may or may not have stored the delivery. */
  readonly outcomeUnknown: boolean;
  constructor(code: OhErrorCode, message: string, opts: { outcomeUnknown?: boolean } = {}) {
    super(message);
    this.name = "OhPortError";
    this.code = code;
    this.retryable = OH_ERROR_RETRYABLE[code];
    this.outcomeUnknown = opts.outcomeUnknown ?? (code === "TIMEOUT" || code === "UNAVAILABLE" || code === "UNKNOWN");
  }
}

export interface OhVerification {
  found: boolean;
  reference?: OhExternalReference;
  checksum?: string;
}

/** What Precision may know about the client's Operation Hub access (never Sherpa workflow). */
export interface OhAccessState {
  /** First send accepted and the workspace provisioned. */
  provisioned: boolean;
  /** The client can actually enter. */
  clientAccessible: boolean;
  sherpaAssigned: boolean;
  sherpaDisplayName?: string;
  /**
   * A direct channel to the assigned Sherpa, only when the platform itself provides one for this project.
   * Absent = no direct channel is known; Precision then offers general Contact beeside and never invents an address.
   */
  sherpaContactEmail?: string;
}

export interface OperationHubPort extends Described {
  /** Idempotent by `payload.contract.idempotency_key`. Resolves only on acceptance; otherwise throws OhPortError. */
  publish(payload: OhHandoffPayload): Promise<OhAcceptance>;
  /** Read-back by idempotency key. Used after TIMEOUT/UNAVAILABLE to learn whether the delivery exists. */
  verify(idempotencyKey: string): Promise<OhVerification>;
  /** Access state for the project, for the "Go to Operation Hub" / "Contact my Sherpa" rules. */
  accessState(projectId: string): Promise<OhAccessState>;
}

/** Deterministic JSON: object keys sorted recursively; arrays keep order. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(",")}}`;
}

/**
 * Checksum of the payload content that must be preserved end to end. The delivery metadata that
 * legitimately differs between attempts (`sent_at`) is excluded, so a retry of the same delivery
 * yields the same checksum.
 */
export function payloadChecksum(payload: OhHandoffPayload): string {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- sent_at is not part of the contract hash
  const { sent_at: _sentAt, ...contract } = payload.contract;
  return createHash("sha256").update(canonicalJson({ ...payload, contract })).digest("hex");
}
