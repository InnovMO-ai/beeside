/**
 * Gateway model provider: wraps engine/gateway.ts (chat) and engine/extraction.ts (extractFields).
 *
 * The API key is never read here: `gatewayConfigFromEnv`/`chat` read it from the process environment at call
 * time. Nothing is logged. A provider failure surfaces only as `ModelUnavailableError`; provider text, endpoint
 * names or status codes never leave this file.
 */
import { extractFields, type FieldSpec } from "../../engine/extraction";
import { chat, gatewayConfigFromEnv, GatewayError, isGatewayConfigured, type GatewayConfig, type GatewayDeps } from "../../engine/gateway";
import {
  ModelUnavailableError,
  type ExtractRequest,
  type ExtractResponse,
  type ExtractedValue,
  type ModelProvider,
  type ModelProviderDescriptor,
  type ModelRequest,
  type ModelResponseFor,
  type RouteRequest,
  type RouteResponse,
  type WriteRequest,
  type WriteResponse,
} from "../ports";

export interface GatewayModelOptions {
  config?: GatewayConfig;
  deps?: GatewayDeps;
  env?: Record<string, string | undefined>;
  /** Max completion tokens of the writer (hidden reasoning tokens count against it on some models). */
  writeMaxTokens?: number;
}

/** Removes `<meta>…</meta>` blocks and stray tags / wrapping quotes the model sometimes adds (F4 observation). */
export function cleanModelText(raw: string): string {
  return raw
    .replace(/<meta>[\s\S]*?<\/meta>/gi, "")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/^\s*["“«]+|["”»]+\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const SEP = /\s*[,;|]\s*/;

export class GatewayModelProvider implements ModelProvider {
  private readonly config: GatewayConfig;
  private readonly deps: GatewayDeps;
  private readonly writeMaxTokens: number;

  constructor(options: GatewayModelOptions = {}) {
    this.config = options.config ?? gatewayConfigFromEnv(options.env ?? process.env);
    this.deps = options.deps ?? (options.env ? { env: options.env } : {});
    this.writeMaxTokens = options.writeMaxTokens ?? 1500;
  }

  describe(): ModelProviderDescriptor {
    const configured = isGatewayConfigured(this.config);
    return {
      port: "model_provider",
      implementation: "gateway",
      mode: "REAL",
      verification: "NOT_VERIFIED",
      note: configured
        ? "Gateway chain configured; end-to-end quality unverified until the PO runs the real-provider rehearsal."
        : "Gateway selected but no target configured: every call is reported as unavailable (ai_unavailable).",
    };
  }

  async complete<R extends ModelRequest>(req: R): Promise<ModelResponseFor<R>> {
    switch (req.task) {
      case "extract":
        return (await this.extract(req)) as ModelResponseFor<R>;
      case "write":
        return (await this.write(req)) as ModelResponseFor<R>;
      case "route":
        return (await this.route(req)) as ModelResponseFor<R>;
    }
    throw new Error("unknown task");
  }

  private cfg(timeoutMs: number): GatewayConfig {
    return { ...this.config, timeoutMs };
  }

  private async extract(req: ExtractRequest): Promise<ExtractResponse> {
    const specs: FieldSpec[] = req.specs.map((s) => {
      const labelled = s.enumValues?.length ? ` Allowed values: ${s.enumValues.map((v) => (s.enumLabels?.[v] ? `${v} (${s.enumLabels[v]})` : v)).join(", ")}.` : "";
      switch (s.type) {
        case "multi_enum":
          return { name: s.name, type: "string" as const, description: `${s.description}. Return a comma-separated list of values.${labelled}` };
        case "enum":
          return { name: s.name, type: "enum" as const, description: `${s.description}.${labelled}`, enumValues: s.enumValues ?? [] };
        default:
          return { name: s.name, type: s.type, description: s.description };
      }
    });
    const context = (req.question ? `Question asked to the client: ${req.question}\n` : "") + `Client answer: ${req.clientText}`;
    const result = await extractFields(specs, context, this.cfg(req.timeoutMs), this.deps);
    const unavailable = result.fields.length > 0 && result.fields.every((f) => f.status === "unresolved" && /gateway unavailable/i.test(f.reason ?? ""));
    if (unavailable) {
      const notConfigured = result.fields.every((f) => /no configured model targets/i.test(f.reason ?? ""));
      throw new ModelUnavailableError(notConfigured ? "not_configured" : "exhausted");
    }
    const byName = new Map(req.specs.map((s) => [s.name, s]));
    const fields: ExtractedValue[] = result.fields.map((f) => {
      if (f.status !== "ok") return { name: f.name, status: f.status, value: null, confidence: null, source: null };
      const spec = byName.get(f.name);
      let value: ExtractedValue["value"] = f.value;
      if (spec?.type === "multi_enum" && typeof f.value === "string") value = f.value.split(SEP).map((x) => x.trim()).filter(Boolean);
      return { name: f.name, status: "ok", value, confidence: f.confidence, source: f.source };
    });
    return { task: "extract", fields, physicalCalls: result.attemptedRetry ? 2 : 1 };
  }

  private async write(req: WriteRequest): Promise<WriteResponse> {
    try {
      const out = await chat(
        [
          { role: "system", content: req.system },
          { role: "user", content: req.user },
        ],
        this.cfg(req.timeoutMs),
        { temperature: req.attempt === 1 ? 0.5 : 0.2, maxTokens: this.writeMaxTokens },
        this.deps,
      );
      return { task: "write", text: cleanModelText(out.content), physicalCalls: 1 };
    } catch (err) {
      throw toUnavailable(err);
    }
  }

  private async route(req: RouteRequest): Promise<RouteResponse> {
    const list = req.topics.map((t) => `- ${t.topicKey}: ${t.hint}`).join("\n");
    try {
      const out = await chat(
        [
          {
            role: "system",
            content:
              "You classify a client's message about how a service works. Reply with a JSON array of at most two topic keys from the list that the message asks about, or [] if it asks about none. Reply with the JSON array only.",
          },
          { role: "user", content: `Topics:\n${list}\n\nMessage: ${req.clientText}` },
        ],
        this.cfg(req.timeoutMs),
        { temperature: 0, maxTokens: 200 },
        this.deps,
      );
      const m = out.content.match(/\[[^\]]*\]/);
      const parsed: unknown = m ? JSON.parse(m[0]) : [];
      const allowed = new Set(req.topics.map((t) => t.topicKey));
      const keys = Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === "string" && allowed.has(k)).slice(0, 2) : [];
      return { task: "route", topicKeys: keys, physicalCalls: 1 };
    } catch (err) {
      if (err instanceof SyntaxError) return { task: "route", topicKeys: [], physicalCalls: 1 };
      throw toUnavailable(err);
    }
  }
}

function toUnavailable(err: unknown): ModelUnavailableError {
  if (err instanceof ModelUnavailableError) return err;
  if (err instanceof GatewayError) {
    if (err.kind === "not_configured") return new ModelUnavailableError("not_configured");
    return new ModelUnavailableError(err.attempts.some((a) => a.errorCode === "timeout") ? "timeout" : "exhausted");
  }
  return new ModelUnavailableError("exhausted");
}
