/**
 * Send to Operation Hub (Build Readiness E-5/E-6/E-7).
 *
 * Order of checks:
 *   1. the category and its CURRENT pack must be confirmed (an unconfirmed pack is never sent);
 *   2. a key that is already delivered answers "sent" right away (duplicate click, double submit, lost response:
 *      same result, no second effect, whatever checksum the retry carries);
 *   3. the echoed `previewChecksum` must equal the checksum of the payload rebuilt NOW (else PREVIEW_STALE);
 *   4. the activation gate: while the project's first send has not succeeded only that one may be (re)sent
 *      (ACTIVATION_PENDING_RETRY_FIRST for another CRP);
 *   5. OhDeliveryService.send performs the idempotent, ledgered, read-back-verified delivery. "sent" in the response is
 *      produced ONLY from its `sent` result, which exists only after a port acceptance whose checksum matched.
 * Failures are reported as a calm category (try again later / needs attention); no technical text leaves the server.
 */
import { describeError } from "../../../security/redact";
import type { Locale, SendResultDto } from "../../api/dto";
import type { PrecisionDomainDeps } from "../deps";
import { emitEvent } from "../events";
import { operationHubDto, resolveCategory } from "./data";
import { CrpError } from "./errors";
import { buildHandoff } from "./payload";
import type { CrpActor } from "./service";

type SendDeps = Pick<PrecisionDomainDeps, "db" | "delivery" | "now" | "log">;

export interface SendInput {
  previewChecksum: string;
  /** Optional client retry key. The delivery key is derived from the pack, so duplicates are safe with or without it. */
  requestKey?: string;
}

const CHECKSUM = /^[0-9a-f]{64}$/;
export const REQUEST_KEY = /^[A-Za-z0-9_.:-]{8,120}$/;

export function parseSendInput(body: unknown): SendInput {
  const o = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (typeof o.previewChecksum !== "string" || !CHECKSUM.test(o.previewChecksum)) throw new CrpError("INVALID_INPUT");
  if (o.requestKey !== undefined && (typeof o.requestKey !== "string" || !REQUEST_KEY.test(o.requestKey))) throw new CrpError("INVALID_INPUT");
  return { previewChecksum: o.previewChecksum, ...(typeof o.requestKey === "string" ? { requestKey: o.requestKey } : {}) };
}

async function recordSent(deps: SendDeps, projectId: string, h: { key: string; payload: { contract: { kind: string } }; category: { categoryKey: string } }, attempt: number | undefined, locale: Locale): Promise<void> {
  await emitEvent(deps.db, {
    name: "operation_hub_send_completed",
    eventKey: `operation_hub_send_completed:${h.key}`,
    projectId,
    properties: { kind: h.payload.contract.kind, attempt: attempt ?? null, category_key: h.category.categoryKey },
    locale,
  });
  await emitEvent(deps.db, { name: "operation_hub_activated", eventKey: `operation_hub_activated:${projectId}`, projectId, locale });
}

export async function sendCrp(deps: SendDeps, actor: CrpActor, categoryId: string, input: SendInput): Promise<SendResultDto> {
  if (!actor.canWrite) throw new CrpError("PRECISION_READ_ONLY");
  const category = await resolveCategory(deps.db, actor.projectId, categoryId);
  // The pack must be confirmed; whether the category is being versioned is checked after the idempotent-answer step.
  const h = await buildHandoff(deps.db, category, deps.now(), { requireCompleted: false });

  if (h.ledger.sendState === "sent") {
    await recordSent(deps, actor.projectId, h, undefined, actor.locale);
    return { state: "sent", clientAction: null, retryable: false, operationHub: await operationHubDto(deps.db, deps.delivery, actor.projectId, actor.locale) };
  }
  if (category.lifecycle !== "completed") throw new CrpError("NOT_READY");
  if (input.previewChecksum !== h.checksum) throw new CrpError("PREVIEW_STALE");
  if (h.ledger.blockedByOther) throw new CrpError("ACTIVATION_PENDING_RETRY_FIRST");

  let result;
  try {
    result = await deps.delivery.send({ projectId: actor.projectId, kind: "crp", packId: h.pack.id, artifactVersion: h.pack.version, payload: h.payload });
  } catch (e) {
    // Nothing is known about the outcome beyond the ledger; the client may simply try again (same key, safe).
    deps.log("error", "precision send failed unexpectedly", { error: describeError(e) });
    throw new CrpError("TEMPORARILY_UNAVAILABLE", { cause: e });
  }

  if (result.state === "blocked") throw new CrpError("ACTIVATION_PENDING_RETRY_FIRST");
  const operationHub = await operationHubDto(deps.db, deps.delivery, actor.projectId, actor.locale).catch(() => ({ state: "hidden" as const, url: null, contact: null }));
  if (result.state === "sent") {
    await recordSent(deps, actor.projectId, h, result.attempt, actor.locale);
    return { state: "sent", clientAction: null, retryable: false, operationHub };
  }
  return {
    state: "failed",
    clientAction: result.clientCategory === "needs_attention" ? "needs_attention" : "try_again_later",
    retryable: result.canRetry === true,
    operationHub,
  };
}
