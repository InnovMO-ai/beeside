export type FaErrorCode =
  | "INVALID_INPUT"
  | "UNAUTHENTICATED"
  | "NOT_FOUND"
  | "NOT_APPLICABLE"
  | "INCOMPLETE"
  | "LOCKED"
  | "ACCESS_EXPIRED"
  | "NOT_RECOVERABLE"
  | "NOT_READY";

const STATUS: Record<FaErrorCode, number> = {
  INVALID_INPUT: 400,
  UNAUTHENTICATED: 401,
  NOT_FOUND: 404,
  NOT_APPLICABLE: 409,
  INCOMPLETE: 409,
  LOCKED: 409,
  ACCESS_EXPIRED: 410,
  NOT_RECOVERABLE: 410,
  NOT_READY: 503,
};

/** Client-safe error: the message never contains personal data or internal identifiers. */
export class FaError extends Error {
  readonly status: number;
  constructor(
    readonly code: FaErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "FaError";
    this.status = STATUS[code];
  }
}
