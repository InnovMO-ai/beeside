import { Logger } from "../security/redact";
import { SOURCE_KEYS, isSourceKey } from "./source-record";
import { AdapterOutcome, DeliveryContext, DestinationAdapter, IntegrationError, ROUTABLE_EVENTS, SourceValue, isRoutableEvent } from "./types";

/**
 * SmartSuite adapter (Phase 12). No credentials and no definitive field mapping exist yet, so:
 *  - the mapping (target application id, which events, which beeside source key feeds which
 *    SmartSuite field id) is configuration, validated here and never invented in code;
 *  - `capture` mode (development) records what would be sent, in memory, and logs counts only;
 *  - `live` mode speaks SmartSuite's REST records API with an API token and account id supplied as
 *    secrets; it is not verified against a real workspace until those exist.
 * Idempotency: one external record per project (its id is kept in integration_external_ref), so a
 * repeated or retried event updates the same record instead of creating another.
 */

export const SMARTSUITE_EVENTS = ROUTABLE_EVENTS.filter((e) => e !== "precision.handoff_package_generated");

export interface SmartSuiteMapping {
  version: 1;
  applicationId: string;
  events: string[];
  /** beeside source key → SmartSuite field id */
  fields: Record<string, string>;
}

const FIELD_ID = /^[A-Za-z0-9_]{1,64}$/;
const APPLICATION_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function validateSmartSuiteMapping(raw: unknown): { mapping: SmartSuiteMapping | null; errors: string[] } {
  const errors: string[] = [];
  const m = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  if (m.version !== 1) errors.push("mapping.version must be 1");
  if (typeof m.applicationId !== "string" || !APPLICATION_ID.test(m.applicationId)) errors.push("mapping.applicationId must be a SmartSuite application (table) id");
  const events = Array.isArray(m.events) ? m.events : [];
  if (events.length === 0) errors.push("mapping.events must list at least one event");
  for (const e of events) if (!isRoutableEvent(e) || !(SMARTSUITE_EVENTS as readonly string[]).includes(e)) errors.push(`mapping.events: ${String(e)} cannot be sent to SmartSuite`);
  const fields = typeof m.fields === "object" && m.fields !== null && !Array.isArray(m.fields) ? (m.fields as Record<string, unknown>) : {};
  if (!("project.id" in fields)) errors.push("mapping.fields must map project.id (the cross-reference to beeside)");
  const seen = new Set<string>();
  for (const [source, target] of Object.entries(fields)) {
    if (!isSourceKey(source)) errors.push(`mapping.fields: unknown source key ${source}`);
    if (typeof target !== "string" || !FIELD_ID.test(target)) errors.push(`mapping.fields.${source} must be a SmartSuite field id`);
    else if (seen.has(target)) errors.push(`mapping.fields: field id ${target} is mapped twice`);
    else seen.add(target);
  }
  if (errors.length > 0) return { mapping: null, errors };
  return { mapping: { version: 1, applicationId: m.applicationId as string, events: events as string[], fields: fields as Record<string, string> }, errors };
}

/** Development only: every source key under its own name, clearly not a real SmartSuite schema. */
export function developmentCaptureMapping(): SmartSuiteMapping {
  return {
    version: 1,
    applicationId: "development_capture",
    events: [...SMARTSUITE_EVENTS],
    fields: Object.fromEntries(SOURCE_KEYS.map((k) => [k, k.replace(/[^A-Za-z0-9]/g, "_")])),
  };
}

export function mapRecord(mapping: SmartSuiteMapping, record: Readonly<Record<string, SourceValue>>): Record<string, SourceValue> {
  const out: Record<string, SourceValue> = {};
  for (const [source, target] of Object.entries(mapping.fields)) out[target] = record[source] ?? null;
  return out;
}

export interface SmartSuiteClient {
  create(applicationId: string, fields: Record<string, SourceValue>): Promise<string>;
  update(applicationId: string, recordId: string, fields: Record<string, SourceValue>): Promise<"updated" | "not_found">;
  remove(applicationId: string, recordId: string): Promise<void>;
}

export class SmartSuiteAdapter implements DestinationAdapter {
  readonly destination = "smartsuite" as const;
  readonly name: string;
  constructor(
    private readonly mapping: SmartSuiteMapping,
    private readonly client: SmartSuiteClient,
    mode: "capture" | "live",
  ) {
    this.name = `smartsuite_${mode}`;
  }

  routes(eventType: string): boolean {
    return this.mapping.events.includes(eventType);
  }

  async deliver({ event, record, externalId }: DeliveryContext): Promise<AdapterOutcome> {
    const app = this.mapping.applicationId;
    if (event.eventType === "retention.project_purged") {
      if (!externalId) return { kind: "skipped", reason: "no_external_record" };
      await this.client.remove(app, externalId);
      return { kind: "deleted" };
    }
    if (!record) return { kind: "skipped", reason: "project_unavailable" };
    const fields = mapRecord(this.mapping, record);
    if (externalId && (await this.client.update(app, externalId, fields)) === "updated") return { kind: "upserted", externalId };
    return { kind: "upserted", externalId: await this.client.create(app, fields) };
  }
}

/** In-memory capture (development and tests): records operations, logs counts only. */
export class CaptureSmartSuiteClient implements SmartSuiteClient {
  readonly operations: Array<{ operation: "create" | "update" | "remove"; applicationId: string; recordId: string; fields?: Record<string, SourceValue> }> = [];
  failNext: Error[] = [];
  private sequence = 0;
  constructor(private readonly log?: Logger) {}
  private record(entry: (typeof this.operations)[number]) {
    const failure = this.failNext.shift();
    if (failure) throw failure;
    this.operations.push(entry);
    this.log?.("info", "smartsuite capture", { operation: entry.operation, fields: entry.fields ? Object.keys(entry.fields).length : 0 });
  }
  async create(applicationId: string, fields: Record<string, SourceValue>) {
    const recordId = `capture-${++this.sequence}`;
    this.record({ operation: "create", applicationId, recordId, fields });
    return recordId;
  }
  async update(applicationId: string, recordId: string, fields: Record<string, SourceValue>) {
    this.record({ operation: "update", applicationId, recordId, fields });
    return "updated" as const;
  }
  async remove(applicationId: string, recordId: string) {
    this.record({ operation: "remove", applicationId, recordId });
  }
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ status: number; ok: boolean; json(): Promise<unknown> }>;

/** SmartSuite REST records API. Errors carry the HTTP status only, never response bodies or headers. */
export class HttpSmartSuiteClient implements SmartSuiteClient {
  constructor(
    private readonly config: { apiToken: string; accountId: string; baseUrl: string; timeoutMs?: number },
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
  ) {}

  private async call(method: string, path: string, body?: unknown) {
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await this.fetchImpl(`${this.config.baseUrl.replace(/\/$/, "")}${path}`, {
        method,
        headers: { Authorization: `Token ${this.config.apiToken}`, "ACCOUNT-ID": this.config.accountId, "Content-Type": "application/json", Accept: "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 10_000),
      });
    } catch {
      throw new IntegrationError("smartsuite request failed (network or timeout)", true);
    }
    return response;
  }

  private fail(operation: string, status: number): never {
    const retryable = status === 408 || status === 429 || status >= 500;
    throw new IntegrationError(`smartsuite ${operation} failed with HTTP ${status}`, retryable);
  }

  async create(applicationId: string, fields: Record<string, SourceValue>) {
    const response = await this.call("POST", `/applications/${encodeURIComponent(applicationId)}/records/`, fields);
    if (!response.ok) this.fail("create", response.status);
    const data = (await response.json().catch(() => ({}))) as { id?: unknown };
    if (typeof data.id !== "string" || data.id.length === 0 || data.id.length > 200) throw new IntegrationError("smartsuite create returned no record id", false);
    return data.id;
  }

  async update(applicationId: string, recordId: string, fields: Record<string, SourceValue>) {
    const response = await this.call("PATCH", `/applications/${encodeURIComponent(applicationId)}/records/${encodeURIComponent(recordId)}/`, fields);
    if (response.status === 404) return "not_found" as const;
    if (!response.ok) this.fail("update", response.status);
    return "updated" as const;
  }

  async remove(applicationId: string, recordId: string) {
    const response = await this.call("DELETE", `/applications/${encodeURIComponent(applicationId)}/records/${encodeURIComponent(recordId)}/`);
    if (response.status === 404) return;
    if (!response.ok) this.fail("delete", response.status);
  }
}
