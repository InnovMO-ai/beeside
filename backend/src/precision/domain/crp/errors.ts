/**
 * CRP domain errors. A `CrpError` carries the API error code, its HTTP status and whether repeating the SAME request can
 * help. The customer-facing message is built from the code and the request locale only: it never contains technical
 * detail (the original cause, when any, stays on `cause` for the server log).
 */
import type { ApiErrorDto, Locale } from "../../api/dto";
import { errorMessage } from "./copy";

export type CrpErrorCode = ApiErrorDto["error"];

export const HTTP_STATUS: Readonly<Record<CrpErrorCode, number>> = {
  UNAUTHENTICATED: 401,
  PRECISION_READ_ONLY: 403,
  PRECISION_REVOKED: 403,
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  CONFLICT: 409,
  PREVIEW_STALE: 409,
  ACTIVATION_PENDING_RETRY_FIRST: 409,
  NOT_READY: 409,
  RATE_LIMITED: 429,
  TEMPORARILY_UNAVAILABLE: 503,
};

const RETRYABLE: Readonly<Record<CrpErrorCode, boolean>> = {
  UNAUTHENTICATED: false,
  PRECISION_READ_ONLY: false,
  PRECISION_REVOKED: false,
  NOT_FOUND: false,
  INVALID_INPUT: false,
  CONFLICT: false,
  PREVIEW_STALE: false,
  ACTIVATION_PENDING_RETRY_FIRST: false,
  NOT_READY: false,
  RATE_LIMITED: true,
  TEMPORARILY_UNAVAILABLE: true,
};

export class CrpError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  readonly detail?: string;
  constructor(readonly code: CrpErrorCode, options: { cause?: unknown; detail?: string } = {}) {
    super(code);
    this.name = "CrpError";
    this.status = HTTP_STATUS[code];
    this.retryable = RETRYABLE[code];
    if (options.detail) this.detail = options.detail;
    if (options.cause !== undefined) (this as { cause?: unknown }).cause = options.cause;
  }
  toDto(locale: Locale): ApiErrorDto {
    return { error: this.code, message: errorMessage(this.code, locale, this.detail), retryable: this.retryable };
  }
}
