import type { ApiErrorDto, Locale } from "./dto";

/** A request as the typed client builds it. Both the real network and the in-memory adapter implement `Transport`. */
export interface TransportRequest {
  method: "GET" | "POST";
  path: string;
  headers: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal;
}
export interface TransportResponse { status: number; body: unknown }
export type Transport = (req: TransportRequest) => Promise<TransportResponse>;

/** Everything the UI knows about a failed call. Never carries raw server text into the interface. */
export class ApiFailure extends Error {
  constructor(
    readonly kind: "network" | "http",
    readonly status: number,
    readonly code: ApiErrorDto["error"] | "UNKNOWN",
    readonly retryable: boolean,
  ) {
    super(code);
  }
  get isConnection(): boolean { return this.kind === "network" || this.status === 502 || this.status === 503 || this.status === 504; }
}

export const liveTransport: Transport = async (req) => {
  let response: Response;
  try {
    response = await fetch(req.path, {
      method: req.method,
      headers: req.headers,
      body: req.body === undefined ? undefined : JSON.stringify(req.body),
      signal: req.signal,
      credentials: "same-origin",
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e;
    throw new ApiFailure("network", 0, "UNKNOWN", true);
  }
  const type = response.headers.get("Content-Type") ?? "";
  // A static host answering with HTML means the API is not there: treat it as unavailable, never as content.
  if (!type.includes("application/json")) return { status: response.ok ? 503 : response.status, body: null };
  const body: unknown = await response.json().catch(() => null);
  return { status: response.status, body };
};

export const LOCALE_HEADER = "X-Precision-Locale";
export type { Locale };
