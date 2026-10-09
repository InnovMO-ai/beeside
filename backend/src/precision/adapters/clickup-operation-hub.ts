import { createHash } from "node:crypto";
import { IntegrationDescriptor } from "../ports/integration-descriptor";
import {
  OH_CONTRACT_VERSION,
  OhAccessState,
  OhAcceptance,
  OhExternalReference,
  OhHandoffPayload,
  OhPortError,
  OhVerification,
  OperationHubPort,
  canonicalJson,
  payloadChecksum,
} from "../ports/operation-hub";

/**
 * ClickUp adapter for OperationHubPort (ClickUp API v2).
 *
 * Everything ClickUp-specific lives here: the hierarchy mapping, tags, descriptions, ids, error mapping.
 * Precision only ever sees the port. See docs/f5/clickup-track-status.md for what is verified (against a
 * local fake only) and what still has to be proven against a real ClickUp sandbox.
 *
 * Mapping (flat; nested folders are a Workspace-level option and are NOT relied upon):
 *   Space (config)            = Operation Hub
 *   Folder  "<company> · P-<sha256(project)[0..12]>" = one project (company is carried in the folder name)
 *   List    "Project Overview"            = Project Service Map (one task per PSM version)
 *   List    "<category label>"            = workstream (one task per CRP delivery)
 *   Task                                  = the delivery. Idempotency lives in tags + a marker block in the description.
 *
 * ClickUp has no idempotency header and no API to create Custom Fields, so the delivery identity is stored in
 *   - tag  `oh-<sha256(key)[0..24]>`  (searchable team-wide: GET /team/{id}/task?tags[]=...)
 *   - tag  `ohp-<sha256(project)[0..16]>` (all deliveries of a project)
 *   - description marker block: `key:` + `checksum:` + canonical JSON body (source of truth for read-back).
 * Every publish looks up before it creates, so a create whose response was lost never produces a duplicate.
 */

export interface ClickUpRetryPolicy {
  /** Attempts of the whole publish/verify operation (each attempt re-does lookup-before-create). */
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Longest wait honoured for a rate-limit reset hint; beyond it the call fails with RATE_LIMITED. */
  maxRateLimitWaitMs: number;
  /** Lookups repeated after an unknown-outcome create before concluding the task does not exist (search lag). */
  lookupLagRetries: number;
  lookupLagDelayMs: number;
}

export interface ClickUpAccessSignal {
  clientAccessible: boolean;
  sherpaAssigned: boolean;
  sherpaDisplayName?: string;
}

export interface ClickUpConfig {
  /** e.g. https://api.clickup.com/api/v2 */
  apiBaseUrl: string;
  /** Personal API token (raw `Authorization` header) or OAuth token (see authScheme). Never logged. */
  token: string;
  authScheme?: "raw" | "bearer";
  /** ClickUp "team_id" (a Workspace in current terminology). */
  workspaceId: string;
  /** The Space that is Operation Hub. */
  spaceId: string;
  mode?: "REAL" | "SANDBOX";
  requestTimeoutMs?: number;
  retry?: Partial<ClickUpRetryPolicy>;
  /** Client-side budget; ClickUp allows 100 requests/min/token on lower plans. */
  requestsPerMinute?: number;
  overviewListName?: string;
  /** Pages (100 tasks each) scanned per search before giving up. */
  maxSearchPages?: number;
  /**
   * Explicit signal for "client can enter" / "Sherpa assigned". ClickUp's API cannot tell Precision these things
   * (guest invitations and assignment are Operation Hub processes), so without a signal both stay false.
   */
  accessSignal?: (projectId: string) => Promise<ClickUpAccessSignal>;
  /** Called when the adapter had to resolve a duplicate (diagnostics only). */
  onDuplicate?: (info: { key: string; keptTaskId: string; removedTaskId?: string }) => void;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => number;
}

const DEFAULT_RETRY: ClickUpRetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 8000,
  maxRateLimitWaitMs: 30_000,
  lookupLagRetries: 3,
  lookupLagDelayMs: 1000,
};

export const CLICKUP_MARKER = "beeside-oh/1";
export const TAG_OVERVIEW = "oh-overview";

interface CuTag { name: string }
interface CuTask {
  id: string;
  name?: string;
  description?: string;
  text_content?: string;
  date_created?: string | number;
  url?: string;
  tags?: CuTag[];
  list?: { id: string };
  folder?: { id: string };
}
interface CuFolder { id: string; name: string; lists?: Array<{ id: string; name: string }> }

interface Structure {
  folderId: string;
  lists: Map<string, string>; // normalised list name -> id
}

interface Marker {
  key: string;
  checksum: string;
  kind: string;
  body: string;
}

const sha = (s: string): string => createHash("sha256").update(s).digest("hex");
export const keyTag = (key: string): string => `oh-${sha(key).slice(0, 24)}`;
export const projectTag = (projectId: string): string => `ohp-${sha(projectId).slice(0, 16)}`;
const projectRef = (projectId: string): string => `P-${sha(projectId).slice(0, 12)}`;
export { projectRef as clickUpProjectRef };
const normName = (s: string): string => s.trim().replace(/\s+/g, " ").toLowerCase();
const cleanLabel = (s: unknown, fallback: string, max = 60): string => {
  const t = typeof s === "string" ? s.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim() : "";
  return (t || fallback).slice(0, max);
};
/** Smaller numeric id first; used to pick one canonical object when concurrent creators raced. */
function idCompare(a: string, b: string): number {
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
    const x = BigInt(a), y = BigInt(b);
    return x < y ? -1 : x > y ? 1 : 0;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

export function buildDescription(key: string, kind: string, body: string, checksum: string): string {
  return `${CLICKUP_MARKER}\nkey: ${key}\nchecksum: ${checksum}\nkind: ${kind}\n---\n${body}`;
}

export function parseMarker(description: string | undefined): Marker | undefined {
  if (!description) return undefined;
  const normalised = description.replace(/\r\n/g, "\n");
  const m = /^beeside-oh\/1\nkey: (.+)\nchecksum: ([0-9a-f]{64})\nkind: ([a-z_]+)\n---\n([\s\S]*)$/.exec(normalised);
  if (!m) return undefined;
  return { key: m[1]!, checksum: m[2]!, kind: m[3]!, body: m[4]! };
}

/** Checksum of what is actually stored: recomputed from the stored canonical body, not trusted from the marker. */
function storedChecksum(marker: Marker): string {
  try {
    return sha(canonicalJson(JSON.parse(marker.body)));
  } catch {
    return "unparseable";
  }
}

class Mutex {
  private tail: Promise<void> = Promise.resolve();
  async run<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((r) => (release = r));
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

export class ClickUpOperationHub implements OperationHubPort {
  private readonly cfg: Required<Pick<ClickUpConfig, "apiBaseUrl" | "token" | "workspaceId" | "spaceId">> & ClickUpConfig;
  private readonly retry: ClickUpRetryPolicy;
  private readonly doFetch: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;
  private readonly now: () => number;
  private readonly timeoutMs: number;
  private readonly maxPages: number;
  private readonly overviewName: string;
  private readonly mutexes = new Map<string, Mutex>();
  private readonly structures = new Map<string, Structure>();
  private readonly provisioned = new Set<string>();
  private readonly hints = new Map<string, string>(); // key -> task id (lookup accelerator, never the truth)
  private readonly sent: number[] = [];

  constructor(config: ClickUpConfig) {
    for (const k of ["apiBaseUrl", "token", "workspaceId", "spaceId"] as const) {
      if (!config[k]) throw new Error(`ClickUp configuration is missing ${k}`);
    }
    this.cfg = config as ClickUpOperationHub["cfg"];
    this.retry = { ...DEFAULT_RETRY, ...(config.retry ?? {}) };
    this.doFetch = config.fetch ?? fetch;
    this.sleep = config.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.random = config.random ?? Math.random;
    this.now = config.now ?? Date.now;
    this.timeoutMs = config.requestTimeoutMs ?? 15_000;
    this.maxPages = config.maxSearchPages ?? 20;
    this.overviewName = config.overviewListName ?? "Project Overview";
  }

  describe(): IntegrationDescriptor {
    return {
      port: "operation_hub",
      implementation: "clickup",
      mode: this.cfg.mode ?? "REAL",
      verification: "NOT_VERIFIED",
      note: "ClickUp adapter, contract-tested against a local fake only; real-platform activation gate not yet proven.",
    };
  }

  // ------------------------------------------------------------------ port

  async publish(payload: OhHandoffPayload): Promise<OhAcceptance> {
    const kind = payload.contract.kind;
    if (!["first_send", "crp", "psm_update"].includes(kind)) {
      throw new OhPortError("UNSUPPORTED_KIND", `kind ${String(kind)} is not supported`);
    }
    const projectId = payload.identity.project_id;
    const sentChecksum = payloadChecksum(payload);
    const state = { suspectCreated: false };
    return this.mutex(projectId).run(() => this.withRetry(() => this.publishOnce(payload, sentChecksum, state)));
  }

  async verify(idempotencyKey: string): Promise<OhVerification> {
    return this.withRetry(async () => {
      const hinted = this.hints.get(idempotencyKey);
      let task: CuTask | undefined;
      if (hinted) task = await this.getTask(hinted).catch((e: unknown) => (e instanceof OhPortError && e.code === "AUTH" ? Promise.reject(e) : undefined));
      if (!task || parseMarker(task.description)?.key !== idempotencyKey) {
        const found = await this.searchTasks({ tags: [keyTag(idempotencyKey)] });
        task = found.find((t) => parseMarker(t.description)?.key === idempotencyKey);
      }
      if (!task) return { found: false };
      const marker = parseMarker(task.description);
      return { found: true, reference: this.refFromTask(task), checksum: marker ? storedChecksum(marker) : "unparseable" };
    });
  }

  async accessState(projectId: string): Promise<OhAccessState> {
    const provisioned = await this.isProvisioned(projectId);
    if (!provisioned) return { provisioned: false, clientAccessible: false, sherpaAssigned: false };
    const signal = this.cfg.accessSignal ? await this.cfg.accessSignal(projectId) : undefined;
    const clientAccessible = signal?.clientAccessible === true;
    const sherpaAssigned = clientAccessible && signal?.sherpaAssigned === true;
    return {
      provisioned: true,
      clientAccessible,
      sherpaAssigned,
      ...(sherpaAssigned && signal?.sherpaDisplayName ? { sherpaDisplayName: signal.sherpaDisplayName } : {}),
    };
  }

  // ------------------------------------------------------------------ publish pipeline

  private async publishOnce(payload: OhHandoffPayload, sentChecksum: string, state: { suspectCreated: boolean }): Promise<OhAcceptance> {
    const projectId = payload.identity.project_id;
    const key = payload.contract.idempotency_key;
    const kind = payload.contract.kind;
    const structure = await this.ensureStructure(payload);

    // One search of the project's deliveries: identity check, existing delivery, overview presence.
    let projectTasks = await this.searchTasks({ tags: [projectTag(projectId)] });
    this.assertIdentity(projectTasks, payload.identity.company_id);

    if (kind !== "psm_update") await this.ensureOverview(payload, structure, projectTasks);

    const listName = kind === "psm_update" ? this.overviewName : cleanLabel(payload.workstream.category_label, "Workstream");
    const listId = structure.lists.get(normName(listName))!;

    let existing = this.findByKey(projectTasks, key);
    if (!existing) existing = (await this.searchTasks({ tags: [keyTag(key)] })).find((t) => parseMarker(t.description)?.key === key);
    if (!existing) existing = (await this.scanList(listId)).find((t) => parseMarker(t.description)?.key === key);
    if (!existing && state.suspectCreated) {
      for (let i = 0; i < this.retry.lookupLagRetries && !existing; i++) {
        await this.sleep(this.retry.lookupLagDelayMs);
        existing = (await this.searchTasks({ tags: [keyTag(key)] })).find((t) => parseMarker(t.description)?.key === key)
          ?? (await this.scanList(listId)).find((t) => parseMarker(t.description)?.key === key);
      }
    }

    if (existing) {
      const marker = parseMarker(existing.description)!;
      if (marker.checksum !== sentChecksum) {
        throw new OhPortError("REJECTED_VALIDATION", "idempotency key already used with different content", { outcomeUnknown: false });
      }
      return this.accept(existing, structure, key, sentChecksum, true, projectId);
    }

    const name = kind === "psm_update"
      ? `Project Service Map v${payload.provenance.psm_version}`
      : `${cleanLabel(payload.workstream.category_label, "Workstream")} · CRP v${payload.artifact.crp_version}`;
    const body = canonicalJson({ ...payload, contract: stripSentAt(payload.contract) });
    state.suspectCreated = true; // from here on, an unknown outcome may mean the task exists
    const created = await this.createTask(listId, {
      name,
      description: buildDescription(key, kind, body, sentChecksum),
      tags: [keyTag(key), projectTag(projectId), `oh-${kind.replace("_", "-")}`],
    });

    // Read back what the platform actually stored.
    const stored = await this.getTask(created.id);
    const marker = parseMarker(stored.description);
    if (!marker || marker.key !== key || storedChecksum(marker) !== sentChecksum) {
      await this.deleteTask(created.id).catch(() => undefined); // our own corrupt creation; leave the key clean for a later retry
      throw new OhPortError("CHECKSUM_MISMATCH", "platform stored different content", { outcomeUnknown: false });
    }

    // Duplicate sweep: a concurrent creator (other process / lagged lookup) may have created the same key.
    const same = (await this.searchTasks({ tags: [keyTag(key)] })).filter((t) => parseMarker(t.description)?.key === key);
    if (same.length > 1) {
      const canonical = [...same].sort(taskOrder)[0]!;
      if (canonical.id !== created.id) {
        await this.deleteTask(created.id).catch(() => undefined);
        this.cfg.onDuplicate?.({ key, keptTaskId: canonical.id, removedTaskId: created.id });
        return this.accept(canonical, structure, key, sentChecksum, true, projectId);
      }
      this.cfg.onDuplicate?.({ key, keptTaskId: canonical.id });
    }
    return this.accept(stored, structure, key, sentChecksum, false, projectId);
  }

  private accept(task: CuTask, structure: Structure | undefined, key: string, sentChecksum: string, replayed: boolean, projectId: string): OhAcceptance {
    const marker = parseMarker(task.description);
    const checksum = marker ? storedChecksum(marker) : "unparseable";
    if (checksum !== sentChecksum) throw new OhPortError("CHECKSUM_MISMATCH", "platform stored different content", { outcomeUnknown: false });
    this.hints.set(key, task.id);
    this.provisioned.add(projectId);
    return {
      reference: this.refFromTask(task, structure),
      checksum,
      contractVersion: OH_CONTRACT_VERSION,
      acceptedAt: this.createdAt(task),
      replayed,
    };
  }

  private refFromTask(task: CuTask, structure?: Structure): OhExternalReference {
    const folder = task.folder?.id ?? structure?.folderId;
    const list = task.list?.id;
    return {
      artifactId: task.id,
      taskId: task.id,
      ...(folder || list ? { locationId: [folder, list].filter(Boolean).join("/") } : {}),
      ...(task.url ? { secureReference: task.url } : {}),
    };
  }

  private createdAt(task: CuTask): string {
    const ms = Number(task.date_created);
    return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : new Date(this.now()).toISOString();
  }

  private findByKey(tasks: CuTask[], key: string): CuTask | undefined {
    const matches = tasks.filter((t) => parseMarker(t.description)?.key === key);
    return matches.sort(taskOrder)[0];
  }

  /** The project must not already belong to another company in Operation Hub. */
  private assertIdentity(projectTasks: CuTask[], companyId: string): void {
    for (const t of projectTasks) {
      const m = parseMarker(t.description);
      if (!m) continue;
      try {
        const existing = (JSON.parse(m.body) as { identity?: { company_id?: string } }).identity?.company_id;
        if (existing && existing !== companyId) throw new OhPortError("IDENTITY_MISMATCH", "company does not match project", { outcomeUnknown: false });
      } catch (e) {
        if (e instanceof OhPortError) throw e;
      }
    }
  }

  /** PSM overview task for the PSM version the CRP was built on (find-or-create, idempotent by internal key). */
  private async ensureOverview(payload: OhHandoffPayload, structure: Structure, projectTasks: CuTask[]): Promise<void> {
    const projectId = payload.identity.project_id;
    const key = `${projectId}:psm-overview:${payload.provenance.psm_version}`;
    if (this.findByKey(projectTasks, key)) return;
    const listId = structure.lists.get(normName(this.overviewName))!;
    const lagged = (await this.searchTasks({ tags: [keyTag(key)] })).find((t) => parseMarker(t.description)?.key === key)
      ?? (await this.scanList(listId)).find((t) => parseMarker(t.description)?.key === key);
    if (lagged) return;
    const body = canonicalJson({
      identity: payload.identity,
      company_context: payload.company_context,
      project_context: payload.project_context,
      psm_version: payload.provenance.psm_version,
    });
    await this.createTask(listId, {
      name: `Project Service Map v${payload.provenance.psm_version}`,
      description: buildDescription(key, "psm_overview", body, sha(body)),
      tags: [keyTag(key), projectTag(projectId), TAG_OVERVIEW],
    });
  }

  private async isProvisioned(projectId: string): Promise<boolean> {
    if (this.provisioned.has(projectId)) return true;
    const tasks = await this.withRetry(() => this.searchTasks({ tags: [projectTag(projectId)] }));
    const yes = tasks.some((t) => {
      const m = parseMarker(t.description);
      return m !== undefined && m.kind !== "psm_overview";
    });
    if (yes) this.provisioned.add(projectId);
    return yes;
  }

  // ------------------------------------------------------------------ structure (idempotent find-or-create)

  private async ensureStructure(payload: OhHandoffPayload): Promise<Structure> {
    const projectId = payload.identity.project_id;
    const wantedLists = [this.overviewName];
    if (payload.contract.kind !== "psm_update") wantedLists.push(cleanLabel(payload.workstream.category_label, "Workstream"));
    let structure = this.structures.get(projectId);
    if (structure && wantedLists.every((n) => structure!.lists.has(normName(n)))) return structure;

    const ref = projectRef(projectId);
    let folder = await this.findFolder(ref);
    if (!folder) {
      const company = cleanLabel((payload.company_context as { display_name?: unknown }).display_name, "Company", 50);
      await this.api<CuFolder>("POST", `/space/${this.cfg.spaceId}/folder`, { body: { name: `${company} · ${ref}` }, structure: true });
      folder = await this.findFolder(ref); // re-read: pick the canonical (lowest id) folder if another creator raced us
      if (!folder) throw new OhPortError("UNAVAILABLE", "folder not visible after creation", { outcomeUnknown: false });
    }
    structure = { folderId: folder.id, lists: new Map() };
    for (const l of await this.listsOf(folder)) this.addList(structure, l);
    for (const name of wantedLists) {
      if (structure.lists.has(normName(name))) continue;
      await this.api("POST", `/folder/${folder.id}/list`, { body: { name }, structure: true });
      structure.lists.clear();
      for (const l of await this.listsOf(folder, true)) this.addList(structure, l);
      if (!structure.lists.has(normName(name))) throw new OhPortError("UNAVAILABLE", "list not visible after creation", { outcomeUnknown: false });
    }
    this.structures.set(projectId, structure);
    return structure;
  }

  private addList(s: Structure, l: { id: string; name: string }): void {
    const k = normName(l.name);
    const cur = s.lists.get(k);
    if (!cur || idCompare(l.id, cur) < 0) s.lists.set(k, l.id);
  }

  private async findFolder(ref: string): Promise<CuFolder | undefined> {
    const res = await this.api<{ folders?: CuFolder[] }>("GET", `/space/${this.cfg.spaceId}/folder`, { query: { archived: "false" }, structure: true });
    return (res.folders ?? []).filter((f) => f.name.includes(ref)).sort((a, b) => idCompare(a.id, b.id))[0];
  }

  private async listsOf(folder: CuFolder, forceFetch = false): Promise<Array<{ id: string; name: string }>> {
    if (!forceFetch && folder.lists) return folder.lists;
    const res = await this.api<{ lists?: Array<{ id: string; name: string }> }>("GET", `/folder/${folder.id}/list`, { query: { archived: "false" }, structure: true });
    return res.lists ?? [];
  }

  // ------------------------------------------------------------------ tasks

  private async createTask(listId: string, body: { name: string; description: string; tags: string[] }): Promise<CuTask> {
    const task = await this.api<CuTask>("POST", `/list/${listId}/task`, { body, structure: false, unsafeToRetryBlindly: true });
    if (!task?.id) throw new OhPortError("UNKNOWN", "task creation returned no id", { outcomeUnknown: true });
    return task;
  }

  private async getTask(id: string): Promise<CuTask> {
    return this.api<CuTask>("GET", `/task/${encodeURIComponent(id)}`, {});
  }

  private async deleteTask(id: string): Promise<void> {
    await this.api("DELETE", `/task/${encodeURIComponent(id)}`, {});
  }

  /** Team-wide search restricted to the Operation Hub space. Closed tasks are included on purpose (a finished task is still the delivery). */
  private async searchTasks(opts: { tags: string[] }): Promise<CuTask[]> {
    const out: CuTask[] = [];
    for (let page = 0; page < this.maxPages; page++) {
      const query: Record<string, string | string[]> = {
        "tags[]": opts.tags,
        "space_ids[]": [this.cfg.spaceId],
        include_closed: "true",
        subtasks: "true",
        page: String(page),
      };
      const res = await this.api<{ tasks?: CuTask[] }>("GET", `/team/${this.cfg.workspaceId}/task`, { query });
      const tasks = res.tasks ?? [];
      out.push(...tasks);
      if (tasks.length < 100) return out;
    }
    throw new OhPortError("UNAVAILABLE", "search exceeded the page budget", { outcomeUnknown: false });
  }

  /** Fallback when tag search does not return the delivery (tags not applied / index lag): scan the list itself. */
  private async scanList(listId: string): Promise<CuTask[]> {
    const out: CuTask[] = [];
    for (let page = 0; page < this.maxPages; page++) {
      const res = await this.api<{ tasks?: CuTask[] }>("GET", `/list/${listId}/task`, {
        query: { page: String(page), include_closed: "true", subtasks: "true", archived: "false" },
      });
      const tasks = res.tasks ?? [];
      out.push(...tasks);
      if (tasks.length < 100) return out;
    }
    throw new OhPortError("UNAVAILABLE", "list scan exceeded the page budget", { outcomeUnknown: false });
  }

  // ------------------------------------------------------------------ http

  private mutex(projectId: string): Mutex {
    let m = this.mutexes.get(projectId);
    if (!m) this.mutexes.set(projectId, (m = new Mutex()));
    return m;
  }

  /** Client-side pacing so a burst does not burn the token's per-minute budget. */
  private async throttle(): Promise<void> {
    const limit = this.cfg.requestsPerMinute ?? 90;
    for (;;) {
      const t = this.now();
      while (this.sent.length && t - this.sent[0]! >= 60_000) this.sent.shift();
      if (this.sent.length < limit) {
        this.sent.push(t);
        return;
      }
      await this.sleep(Math.max(50, 60_000 - (t - this.sent[0]!)));
    }
  }

  private async api<T = unknown>(
    method: "GET" | "POST" | "DELETE",
    path: string,
    opts: { query?: Record<string, string | string[]>; body?: unknown; structure?: boolean; unsafeToRetryBlindly?: boolean },
  ): Promise<T> {
    await this.throttle();
    const url = new URL(this.cfg.apiBaseUrl.replace(/\/$/, "") + path);
    for (const [k, v] of Object.entries(opts.query ?? {})) for (const item of Array.isArray(v) ? v : [v]) url.searchParams.append(k, item);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const isWrite = method !== "GET";
    let res: Response;
    try {
      res = await this.doFetch(url, {
        method,
        signal: controller.signal,
        headers: {
          Authorization: this.cfg.authScheme === "bearer" ? `Bearer ${this.cfg.token}` : this.cfg.token,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      });
    } catch (e) {
      clearTimeout(timer);
      throw this.mapNetworkError(e, isWrite);
    }
    let text: string;
    try {
      text = await res.text();
    } catch (e) {
      clearTimeout(timer);
      throw this.mapNetworkError(e, isWrite);
    }
    clearTimeout(timer);
    if (res.ok) {
      if (text === "") return {} as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new OhPortError("UNKNOWN", "platform returned a non-JSON success body", { outcomeUnknown: isWrite });
      }
    }
    throw this.mapHttpError(res, text, opts.structure === true);
  }

  private mapNetworkError(e: unknown, isWrite: boolean): OhPortError {
    const err = e as { name?: string; code?: string; cause?: { code?: string } };
    const code = err.code ?? err.cause?.code;
    if (err.name === "AbortError" || err.name === "TimeoutError") {
      // The request may have been processed: outcome unknown for writes; reads are harmless to repeat.
      return new OhPortError("TIMEOUT", "platform did not answer in time", { outcomeUnknown: isWrite });
    }
    const notSent = code === "ENOTFOUND" || code === "ECONNREFUSED" || code === "EAI_AGAIN";
    return new OhPortError("UNAVAILABLE", `network failure${code ? ` (${code})` : ""}`, { outcomeUnknown: isWrite && !notSent });
  }

  private mapHttpError(res: Response, text: string, structure: boolean): OhPortError & { retryAfterMs?: number } {
    const status = res.status;
    let ecode = "";
    try {
      ecode = String((JSON.parse(text) as { ECODE?: string }).ECODE ?? "").slice(0, 40);
    } catch { /* body is not JSON */ }
    const suffix = `HTTP ${status}${ecode ? ` ${ecode}` : ""}`; // never include the body or the token
    if (status === 401 || status === 403) return new OhPortError("AUTH", `credentials or permissions rejected (${suffix})`, { outcomeUnknown: false });
    if (status === 429) {
      const err = new OhPortError("RATE_LIMITED", `rate limited (${suffix})`, { outcomeUnknown: false }) as OhPortError & { retryAfterMs?: number };
      const ra = Number(res.headers.get("retry-after"));
      const reset = Number(res.headers.get("x-ratelimit-reset"));
      if (Number.isFinite(ra) && ra > 0) err.retryAfterMs = ra * 1000;
      else if (Number.isFinite(reset) && reset > 0) err.retryAfterMs = Math.max(0, (reset > 1e12 ? reset : reset * 1000) - this.now());
      return err;
    }
    if (status === 408) return new OhPortError("TIMEOUT", `platform timed out (${suffix})`, { outcomeUnknown: true });
    if (status >= 500) return new OhPortError("UNAVAILABLE", `platform error (${suffix})`, { outcomeUnknown: true });
    if (status === 404) {
      // A configured Space/Workspace that does not exist is a configuration problem. A list/folder/task we resolved a moment
      // ago and that vanished (deleted by a human) is transient: forget the cache and let the retry rebuild it.
      if (structure) return new OhPortError("AUTH", `configured workspace/space not found or not accessible (${suffix})`, { outcomeUnknown: false });
      this.structures.clear();
      return new OhPortError("UNAVAILABLE", `resource disappeared (${suffix})`, { outcomeUnknown: false });
    }
    if (status === 409 || status === 423 || status === 425) return new OhPortError("UNAVAILABLE", `temporary conflict (${suffix})`, { outcomeUnknown: false });
    if (status === 400 || status === 413 || status === 422) return new OhPortError("REJECTED_VALIDATION", `payload refused (${suffix})`, { outcomeUnknown: false });
    return new OhPortError("UNKNOWN", `unexpected response (${suffix})`, { outcomeUnknown: false });
  }

  /** Bounded exponential backoff with full jitter; honours the rate-limit reset hint within `maxRateLimitWaitMs`. */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let attempt = 0;
    for (;;) {
      try {
        return await fn();
      } catch (e) {
        attempt += 1;
        if (!(e instanceof OhPortError) || !e.retryable || attempt >= this.retry.maxAttempts) throw e;
        const exp = Math.min(this.retry.maxDelayMs, this.retry.baseDelayMs * 2 ** (attempt - 1));
        let delay = Math.floor(this.random() * exp);
        const hint = (e as { retryAfterMs?: number }).retryAfterMs;
        if (e.code === "RATE_LIMITED") {
          if (hint !== undefined && hint > this.retry.maxRateLimitWaitMs) throw e;
          delay = Math.max(delay, hint ?? 0);
        }
        await this.sleep(delay);
      }
    }
  }
}

function stripSentAt(contract: OhHandoffPayload["contract"]): Omit<OhHandoffPayload["contract"], "sent_at"> {
  const { sent_at: _s, ...rest } = contract;
  return rest;
}

/** Oldest first, id as tiebreak: every contender picks the same canonical task. */
function taskOrder(a: CuTask, b: CuTask): number {
  const da = Number(a.date_created ?? 0), db = Number(b.date_created ?? 0);
  return da !== db ? da - db : idCompare(a.id, b.id);
}

/** Builds the adapter configuration from the environment. The token is read here and nowhere else; it is never logged. */
export function clickUpConfigFromEnv(env: NodeJS.ProcessEnv = process.env): ClickUpConfig {
  const need = (k: string): string => {
    const v = env[k];
    if (!v) throw new Error(`${k} is required when PRECISION_OH_PROVIDER=clickup`);
    return v;
  };
  const mode = env.CLICKUP_MODE ?? "REAL";
  if (mode !== "REAL" && mode !== "SANDBOX") throw new Error('CLICKUP_MODE must be "REAL" or "SANDBOX"');
  const timeout = env.CLICKUP_REQUEST_TIMEOUT_MS ? Number(env.CLICKUP_REQUEST_TIMEOUT_MS) : undefined;
  if (timeout !== undefined && !(timeout > 0)) throw new Error("CLICKUP_REQUEST_TIMEOUT_MS must be a positive number");
  return {
    apiBaseUrl: env.CLICKUP_API_BASE ?? "https://api.clickup.com/api/v2",
    token: need("CLICKUP_TOKEN"),
    workspaceId: need("CLICKUP_WORKSPACE_ID"),
    spaceId: need("CLICKUP_SPACE_ID"),
    mode,
    ...(timeout !== undefined ? { requestTimeoutMs: timeout } : {}),
  };
}
