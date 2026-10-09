/**
 * Precision API errors. Every non-2xx answer is an `ApiErrorDto`: a stable code, a short localized sentence and a
 * `retryable` flag. Nothing that reaches a client contains a stack, a driver message, an SQL fragment or an identifier.
 */
import { FaError } from "../../fa/services/errors";
import { ConversationInputError } from "../conversation/types";
import type { ApiErrorDto, Locale } from "./dto";

export type ApiErrorCode = ApiErrorDto["error"];

export const ERROR_STATUS: Readonly<Record<ApiErrorCode, number>> = {
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
  TEMPORARILY_UNAVAILABLE: 500,
};

const MESSAGES: Readonly<Record<ApiErrorCode, Record<Locale, string>>> = {
  UNAUTHENTICATED: { en: "This link is no longer valid. Request a new one to continue.", es: "Este enlace ya no es válido. Solicita uno nuevo para continuar." },
  PRECISION_READ_ONLY: { en: "You can review your information, but changes are not available right now.", es: "Puedes consultar tu información, pero por ahora no se pueden hacer cambios." },
  PRECISION_REVOKED: { en: "Access to Precision is not available right now.", es: "El acceso a Precision no está disponible por ahora." },
  NOT_FOUND: { en: "We could not find what you were looking for.", es: "No encontramos lo que buscabas." },
  INVALID_INPUT: { en: "We could not read that request. Check it and try again.", es: "No pudimos leer esa solicitud. Revísala e inténtalo de nuevo." },
  CONFLICT: { en: "This is not available in the current state of your project.", es: "Esto no está disponible en el estado actual de tu proyecto." },
  PREVIEW_STALE: { en: "Something changed since you opened the preview. Review it again before sending.", es: "Algo cambió desde que abriste la vista previa. Revísala de nuevo antes de enviar." },
  ACTIVATION_PENDING_RETRY_FIRST: { en: "Your first send needs to be completed before another one.", es: "Tu primer envío debe completarse antes de enviar otro." },
  NOT_READY: { en: "This step is not ready yet.", es: "Este paso todavía no está listo." },
  RATE_LIMITED: { en: "Too many requests. Wait a moment and try again.", es: "Hay demasiadas solicitudes. Espera un momento e inténtalo de nuevo." },
  TEMPORARILY_UNAVAILABLE: { en: "This is temporarily unavailable. Your information is saved; try again in a moment.", es: "Esto no está disponible por el momento. Tu información está guardada; inténtalo de nuevo en un momento." },
};

export class ApiError extends Error {
  readonly status: number;
  constructor(
    readonly code: ApiErrorCode,
    readonly retryable: boolean = code === "TEMPORARILY_UNAVAILABLE" || code === "RATE_LIMITED",
    readonly extra: { support?: ApiErrorDto["support"]; retryAfterSeconds?: number } = {},
  ) {
    super(code);
    this.name = "ApiError";
    this.status = ERROR_STATUS[code];
  }
}

export const apiError = (code: ApiErrorCode, retryable?: boolean): ApiError => new ApiError(code, retryable);

function pgCode(err: unknown): string | undefined {
  return typeof err === "object" && err !== null && typeof (err as { code?: unknown }).code === "string" ? (err as { code: string }).code : undefined;
}

/** Turns anything thrown into the one error a client may see. Unknown errors are generic by construction. */
export function classifyError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof ConversationInputError) return new ApiError(err.code === "NOT_WRITABLE" ? "CONFLICT" : "INVALID_INPUT");
  if (err instanceof FaError) {
    if (err.code === "NOT_FOUND") return new ApiError("NOT_FOUND");
    if (err.code === "INVALID_INPUT") return new ApiError("INVALID_INPUT");
    if (err.code === "NOT_APPLICABLE" || err.code === "LOCKED" || err.code === "ALREADY_SUBMITTED") return new ApiError("CONFLICT");
    return new ApiError("TEMPORARILY_UNAVAILABLE");
  }
  const code = pgCode(err);
  if (code === "BV409") return new ApiError("CONFLICT");
  if (code === "BV404") return new ApiError("NOT_FOUND");
  if (code === "22P02" || code === "22003") return new ApiError("INVALID_INPUT"); // malformed uuid / numeric from user input
  const type = typeof err === "object" && err !== null ? (err as { type?: unknown }).type : undefined;
  if (type === "entity.too.large" || type === "entity.parse.failed" || type === "charset.unsupported" || type === "encoding.unsupported") return new ApiError("INVALID_INPUT", false);
  return new ApiError("TEMPORARILY_UNAVAILABLE", true);
}

export function errorBody(err: ApiError, locale: Locale): ApiErrorDto {
  return {
    error: err.code,
    message: MESSAGES[err.code][locale],
    retryable: err.retryable,
    ...(err.extra.support ? { support: err.extra.support } : {}),
  };
}
