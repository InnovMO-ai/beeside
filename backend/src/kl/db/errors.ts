/** Errores de dominio de KL: la base los señala con SQLSTATE propios (BV4xx/BV6xx) y aquí se traducen. */
export type KlErrorCode = "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "INVALID" | "IMMUTABLE" | "UNAVAILABLE" | "IDENTITY_MISMATCH" | "UNAUTHENTICATED" | "REJECTED";

export class KlError extends Error {
  constructor(
    readonly code: KlErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "KlError";
  }

  get status(): number {
    return { FORBIDDEN: 403, NOT_FOUND: 404, CONFLICT: 409, INVALID: 422, IMMUTABLE: 409, UNAVAILABLE: 503, IDENTITY_MISMATCH: 403, UNAUTHENTICATED: 401, REJECTED: 422 }[this.code];
  }
}

const SQLSTATE_TO_CODE: Record<string, KlErrorCode> = { BV403: "FORBIDDEN", BV404: "NOT_FOUND", BV409: "CONFLICT", BV422: "INVALID", BV601: "IMMUTABLE" };

/** Traduce un error de pg a KlError; los demás se devuelven tal cual. Una caída de conexión es UNAVAILABLE. */
export function translateDbError(error: unknown): unknown {
  const e = error as { code?: string; message?: string; errno?: string };
  if (e?.code && SQLSTATE_TO_CODE[e.code]) return new KlError(SQLSTATE_TO_CODE[e.code] as KlErrorCode, publicMessage(e.message));
  if (e?.code === "42501") return new KlError("FORBIDDEN", "permission denied");
  if (e?.code === "23505") return new KlError("CONFLICT", "duplicate");
  if (e?.code === "23503" || e?.code === "23514" || e?.code === "22P02" || e?.code === "22007" || e?.code === "22008") return new KlError("INVALID", "invalid input");
  if (isConnectionFailure(e)) return new KlError("UNAVAILABLE", "knowledge layer database unavailable");
  return error;
}

/** Quita el prefijo «BVnnn:» del mensaje que escribe la base. */
function publicMessage(message: string | undefined): string {
  return (message ?? "").replace(/^BV\d{3}:\s*/, "").slice(0, 200);
}

export function isConnectionFailure(e: { code?: string; message?: string } | undefined): boolean {
  if (!e) return false;
  if (e.code && /^(08|57P0|53300|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EPIPE)/.test(e.code)) return true;
  return /Connection terminated|connect ECONNREFUSED|timeout exceeded when trying to connect|the database system is (starting|shutting)/i.test(e.message ?? "");
}
