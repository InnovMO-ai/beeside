/**
 * Precision Engine — Gateway (Engine-Build Macroblock 1).
 *
 * Vendor-, domain- and scope-agnostic LLM gateway. Normalizes chat requests into a
 * single shape, tries an ordered chain of (provider, model) targets with a
 * per-attempt timeout, and returns either a usable response or a typed
 * chain-exhaustion error carrying every attempt's failure reason. This module has
 * no business, persistence, or category logic, and no conversation loop — those
 * live in modules built on top of this one (not part of this macroblock).
 *
 * New beeside implementation, written from the documented behavioral contract in
 * claude/beeside-ai-engine-architecture-validation-2026-10-01.md and
 * claude/precision-architecture-consultation-response-2026-10-01.md. This is not a
 * port or copy of any prior system.
 *
 * CORRECTION (2026-10-06, Canon Patch #4): an earlier version of this comment said
 * the AFP 3.0 (beta) source code was not available. That was false: the beta source
 * exists and is auditable. It was reviewed statically in Gate R1 (see
 * claude/precision-gate-r1-beta-reuse-matrix-2026-10-06.md); this module is still a
 * new implementation, to be ADAPTED with beta patterns per that matrix. Two
 * historical documents —
 * claude/precision-macroblock1-engine-infrastructure-completion-2026-10-02.md and
 * claude/precision-canonical-registry-2026-10-02.md — describe a gateway.ts that
 * was never actually built (forensically invalidated by the Master Contract's
 * Addendum 7); nothing in this file was derived from their claimed exports.
 */

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  /** Per-attempt timeout in milliseconds. Overrides GatewayConfig.timeoutMs when set. */
  timeoutMs?: number;
}

export type GatewayErrorCode =
  | "timeout"
  | "http_error"
  | "network_error"
  | "invalid_response"
  | "not_configured";

export interface GatewayAttempt {
  provider: string;
  model: string;
  errorCode: GatewayErrorCode;
  message: string;
}

export type GatewayErrorKind = "not_configured" | "chain_exhausted";

/** Thrown only when no usable response could be produced. Never thrown on a usable response. */
export class GatewayError extends Error {
  readonly kind: GatewayErrorKind;
  readonly attempts: GatewayAttempt[];

  constructor(kind: GatewayErrorKind, message: string, attempts: GatewayAttempt[] = []) {
    super(message);
    this.name = "GatewayError";
    this.kind = kind;
    this.attempts = attempts;
  }
}

export interface ChatResult {
  content: string;
  provider: string;
  model: string;
  /** Failed attempts that preceded the usable response, if any (empty when the first target succeeded). */
  attempts: GatewayAttempt[];
}

export interface ModelTarget {
  provider: string;
  model: string;
  endpoint: string;
  apiKeyEnvVar: string;
}

export interface GatewayConfig {
  /** Ordered fallback chain; the first target with a present API key and a usable response wins. */
  chain: ModelTarget[];
  timeoutMs: number;
}

/** Dependency-injected fetch, matching the house pattern in backend/src/integrations/smartsuite.ts. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }
) => Promise<{ status: number; ok: boolean; json(): Promise<unknown>; text?: () => Promise<string> }>;

export interface GatewayDeps {
  fetchImpl?: FetchLike;
  env?: Record<string, string | undefined>;
}

const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Builds a GatewayConfig from environment variables. Provider names are kept generic
 * (primary/secondary/tertiary) on purpose — this module must not hardcode a vendor's
 * name or a specific model family. A target is only included in the chain when its
 * model, endpoint, and API key are all present; this is how a target is "not
 * configured" rather than attempted and failed.
 */
export function gatewayConfigFromEnv(env: Record<string, string | undefined> = process.env): GatewayConfig {
  const candidates: ModelTarget[] = [
    {
      provider: "primary",
      model: env.PRECISION_GATEWAY_PRIMARY_MODEL ?? "",
      endpoint: env.PRECISION_GATEWAY_PRIMARY_ENDPOINT ?? "",
      apiKeyEnvVar: "PRECISION_GATEWAY_PRIMARY_API_KEY",
    },
    {
      provider: "secondary",
      model: env.PRECISION_GATEWAY_SECONDARY_MODEL ?? "",
      endpoint: env.PRECISION_GATEWAY_SECONDARY_ENDPOINT ?? "",
      apiKeyEnvVar: "PRECISION_GATEWAY_SECONDARY_API_KEY",
    },
    {
      provider: "tertiary",
      model: env.PRECISION_GATEWAY_TERTIARY_MODEL ?? "",
      endpoint: env.PRECISION_GATEWAY_TERTIARY_ENDPOINT ?? "",
      apiKeyEnvVar: "PRECISION_GATEWAY_TERTIARY_API_KEY",
    },
  ];
  const chain = candidates.filter((c) => c.model !== "" && c.endpoint !== "" && Boolean(env[c.apiKeyEnvVar]));
  const timeoutMs = Number(env.PRECISION_GATEWAY_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;
  return { chain, timeoutMs };
}

export function isGatewayConfigured(config: GatewayConfig): boolean {
  return config.chain.length > 0;
}

/** Best-effort extraction tolerant of minor response-shape differences across chat-completion providers. */
function extractContent(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const choices = (body as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first: unknown = choices[0];
  if (typeof first !== "object" || first === null) return null;
  const message = (first as Record<string, unknown>).message;
  if (typeof message !== "object" || message === null) return null;
  const content = (message as Record<string, unknown>).content;
  return typeof content === "string" && content.length > 0 ? content : null;
}

type AttemptOutcome = { ok: true; content: string } | { ok: false; attempt: GatewayAttempt };

/**
 * Model parameter policy (F4 finding, F5 fix): some models reject `temperature` outright (HTTP 400, "deprecated for this
 * model"). A model that is known to (static family rule, or listed in PRECISION_GATEWAY_OMIT_TEMPERATURE, comma-separated)
 * is called without it; any other model that answers 400 mentioning temperature is retried once without it and remembered
 * for the life of the process. Nothing about the provider response is kept or surfaced.
 */
const OMIT_TEMPERATURE_FAMILY = /^claude-(?:sonnet|opus|haiku|fable)-5/;
const learnedNoTemperature = new Set<string>();
export function omitsTemperature(model: string, env: Record<string, string | undefined> = process.env): boolean {
  if (OMIT_TEMPERATURE_FAMILY.test(model) || learnedNoTemperature.has(model)) return true;
  return (env.PRECISION_GATEWAY_OMIT_TEMPERATURE ?? "").split(",").map((m) => m.trim()).filter(Boolean).includes(model);
}
/** Test seam: forget what was learned at run time. */
export function resetLearnedModelParams(): void { learnedNoTemperature.clear(); }

async function post(target: ModelTarget, messages: ChatMessage[], options: ChatOptions, timeoutMs: number, fetchImpl: FetchLike, apiKey: string, withTemperature: boolean) {
  return fetchImpl(target.endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: target.model,
      messages,
      ...(withTemperature && options.temperature !== undefined ? { temperature: options.temperature } : {}),
      max_tokens: options.maxTokens,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
}

async function callOne(
  target: ModelTarget,
  messages: ChatMessage[],
  options: ChatOptions,
  defaultTimeoutMs: number,
  fetchImpl: FetchLike,
  apiKey: string,
  env: Record<string, string | undefined> = process.env
): Promise<AttemptOutcome> {
  try {
    const timeoutMs = options.timeoutMs ?? defaultTimeoutMs;
    let res = await post(target, messages, options, timeoutMs, fetchImpl, apiKey, !omitsTemperature(target.model, env));
    if (res.status === 400 && options.temperature !== undefined && !omitsTemperature(target.model, env)) {
      const detail = res.text ? await res.text().catch(() => "") : "";
      if (/temperature/i.test(detail)) {
        learnedNoTemperature.add(target.model);
        res = await post(target, messages, options, timeoutMs, fetchImpl, apiKey, false);
      } else {
        return { ok: false, attempt: { provider: target.provider, model: target.model, errorCode: "http_error", message: "HTTP 400" } };
      }
    }
    if (!res.ok) {
      return {
        ok: false,
        attempt: { provider: target.provider, model: target.model, errorCode: "http_error", message: `HTTP ${res.status}` },
      };
    }
    const body = await res.json();
    const content = extractContent(body);
    if (content === null) {
      return {
        ok: false,
        attempt: {
          provider: target.provider,
          model: target.model,
          errorCode: "invalid_response",
          message: "Response body did not contain a usable message.",
        },
      };
    }
    return { ok: true, content };
  } catch (err) {
    const isTimeout = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    return {
      ok: false,
      attempt: {
        provider: target.provider,
        model: target.model,
        errorCode: isTimeout ? "timeout" : "network_error",
        message: err instanceof Error ? err.message : String(err),
      },
    };
  }
}

/**
 * Sends a chat request through the configured fallback chain, returning the first
 * usable response. Throws GatewayError("not_configured") when the chain is empty,
 * or GatewayError("chain_exhausted") when every configured target failed — the
 * error carries every attempt so a caller can distinguish "no targets configured"
 * from "all targets tried and failed" (graceful degradation is the caller's choice,
 * not this module's).
 */
export async function chat(
  messages: ChatMessage[],
  config: GatewayConfig,
  options: ChatOptions = {},
  deps: GatewayDeps = {}
): Promise<ChatResult> {
  if (!isGatewayConfigured(config)) {
    throw new GatewayError("not_configured", "Gateway has no configured model targets.");
  }
  const fetchImpl = deps.fetchImpl ?? (fetch as unknown as FetchLike);
  const env = deps.env ?? process.env;
  const attempts: GatewayAttempt[] = [];

  for (const target of config.chain) {
    const apiKey = env[target.apiKeyEnvVar];
    if (!apiKey) {
      attempts.push({
        provider: target.provider,
        model: target.model,
        errorCode: "not_configured",
        message: `Missing API key in ${target.apiKeyEnvVar}.`,
      });
      continue;
    }
    const outcome = await callOne(target, messages, options, config.timeoutMs, fetchImpl, apiKey, env);
    if (outcome.ok) {
      return { content: outcome.content, provider: target.provider, model: target.model, attempts };
    }
    attempts.push(outcome.attempt);
  }

  throw new GatewayError("chain_exhausted", "All configured gateway targets failed.", attempts);
}

/**
 * Convenience wrapper over chat() for callers that expect a JSON-shaped reply.
 * A usable chat response that is not valid JSON is still treated as chain
 * exhaustion (it is not usable to the caller), with the parse failure appended
 * to the attempts list for diagnosis.
 */
export async function chatJSON<T = unknown>(
  messages: ChatMessage[],
  config: GatewayConfig,
  options: ChatOptions = {},
  deps: GatewayDeps = {}
): Promise<{ data: T; provider: string; model: string; attempts: GatewayAttempt[] }> {
  const result = await chat(messages, config, options, deps);
  try {
    const data = JSON.parse(result.content) as T;
    return { data, provider: result.provider, model: result.model, attempts: result.attempts };
  } catch (err) {
    throw new GatewayError(
      "chain_exhausted",
      `Gateway returned a usable response but it was not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      [
        ...result.attempts,
        {
          provider: result.provider,
          model: result.model,
          errorCode: "invalid_response",
          message: "Response content was not valid JSON.",
        },
      ]
    );
  }
}
