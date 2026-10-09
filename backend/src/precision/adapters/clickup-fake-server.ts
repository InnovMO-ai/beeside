import http from "node:http";
import { AddressInfo } from "node:net";
import { OhFaultInjector } from "./simulator-operation-hub";

/**
 * Local fake of the ClickUp API v2 subset the adapter uses. It is NOT ClickUp: it encodes our reading of the
 * documentation (see docs/f5/clickup-track-status.md) so the adapter can be contract-tested offline, and it can be
 * scripted to fail the ways the real platform can. Response shapes that the public docs do not publish
 * (e.g. the task object) follow what ClickUp is known to return and are listed as ASSUMED in the status document.
 *
 * Subset:
 *   GET    /api/v2/space/:id/folder
 *   POST   /api/v2/space/:id/folder
 *   GET    /api/v2/folder/:id/list
 *   POST   /api/v2/folder/:id/list
 *   GET    /api/v2/list/:id/task          (page size 100, include_closed, zero-based page)
 *   POST   /api/v2/list/:id/task
 *   GET    /api/v2/task/:id
 *   PUT    /api/v2/task/:id               (only used by the sandbox verification script to tamper with a body)
 *   DELETE /api/v2/task/:id
 *   DELETE /api/v2/folder/:id             (sandbox verification cleanup)
 *   GET    /api/v2/team/:id/task          (tags[], space_ids[], include_closed, zero-based page, 100 per page)
 */

interface FakeTask {
  id: string;
  name: string;
  description: string;
  tags: string[];
  listId: string;
  folderId: string;
  spaceId: string;
  createdMs: number;
  seq: number;
  closed: boolean;
  /** Index lag: the task is invisible to search/list GETs until this many such requests were served. */
  hiddenFor: number;
}
interface FakeFolder { id: string; name: string; lists: Array<{ id: string; name: string }> }

export interface FakeRequestInfo { method: string; path: string; query: URLSearchParams; body: unknown; authorization: string | undefined }
type Matcher = (req: FakeRequestInfo) => boolean;
type Action =
  | { kind: "status"; status: number; body?: unknown; headers?: Record<string, string> }
  | { kind: "reset" }
  | { kind: "hang" }
  | { kind: "delay"; ms: number }
  | { kind: "store_then_hang" }
  | { kind: "store_then_reset" }
  | { kind: "store_corrupt" };
interface Fault { match: Matcher; action: Action; remaining: number }

export interface FakeClickUpOptions { token: string; workspaceId: string; spaceId: string; now?: () => number }

const isCreateTask: Matcher = (r) => r.method === "POST" && /^\/api\/v2\/list\/[^/]+\/task$/.test(r.path);
/** The delivery itself (not the PSM overview task the adapter creates first). */
const isCreateArtifact: Matcher = (r) => isCreateTask(r) && !((r.body as { tags?: string[] } | undefined)?.tags ?? []).includes("oh-overview");
const anyRequest: Matcher = () => true;

export class FakeClickUpServer {
  private server?: http.Server;
  private folders: FakeFolder[] = [];
  private tasks: FakeTask[] = [];
  private nextId = 9_000_001;
  private seq = 0;
  private requestCount = 0;
  private faults: Fault[] = [];
  private lagForNewTasks = 0;
  /** Every request seen, in order (assertions on request budgets, auth header, etc.). */
  readonly log: FakeRequestInfo[] = [];
  /** Allow duplicate folder/list names (the docs do not say that ClickUp refuses them: assume it does not). */
  constructor(private readonly opts: FakeClickUpOptions) {}

  async start(): Promise<string> {
    this.server = http.createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((r) => this.server!.listen(0, "127.0.0.1", r));
    return `http://127.0.0.1:${(this.server!.address() as AddressInfo).port}/api/v2`;
  }

  async stop(): Promise<void> {
    this.server?.closeAllConnections();
    await new Promise<void>((r) => (this.server ? this.server.close(() => r()) : r()));
  }

  // ---- inspection ----
  taskCount(opts: { includeOverview?: boolean } = {}): number {
    return this.tasks.filter((t) => opts.includeOverview || !t.tags.includes("oh-overview")).length;
  }
  allTasks(): ReadonlyArray<FakeTask> { return this.tasks; }
  allFolders(): ReadonlyArray<FakeFolder> { return this.folders; }
  /** Simulates a human deleting a list/folder in the ClickUp UI. */
  deleteAllStructure(): void { this.folders = []; this.tasks = []; }
  /** Simulates a human closing a task (the delivery must still be found). */
  closeAllTasks(): void { this.tasks.forEach((t) => (t.closed = true)); }
  /** Simulates a concurrent creator that already created the same folder (race between two processes). */
  injectFolder(name: string): FakeFolder {
    const f = { id: String(this.nextId++), name, lists: [] };
    this.folders.push(f);
    return f;
  }

  // ---- fault scripting ----
  fail(match: Matcher, action: Action, times = 1): void { this.faults.push({ match, action, remaining: times }); }
  /** Tasks created from now on stay invisible to the next `n` search/list GET requests (search-after-write lag). */
  lagSearches(n: number): void { this.lagForNewTasks = n; }
  /** Ends the lag: hidden tasks become visible and new tasks are indexed immediately. */
  endLag(): void { this.lagForNewTasks = 0; this.tasks.forEach((t) => (t.hiddenFor = 0)); }
  clearFaults(): void { this.faults = []; this.lagForNewTasks = 0; }

  /** Adapter-facing OhFaultInjector. `times` = how many consecutive requests fail (match the adapter's attempt count). */
  injector(times = 1): OhFaultInjector {
    return {
      timeoutAfterStore: () => this.fail(isCreateArtifact, { kind: "store_then_hang" }, times),
      unavailableBeforeStore: () => this.fail(isCreateArtifact, { kind: "status", status: 503, body: { err: "Service unavailable", ECODE: "SVC_001" } }, times),
      rateLimitNext: () => this.fail(anyRequest, { kind: "status", status: 429, body: { err: "Rate limit reached", ECODE: "APP_002" }, headers: { "X-RateLimit-Limit": "100", "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": String(Math.floor(this.now() / 1000) + 1) } }, times),
      rejectNext: () => this.fail(isCreateArtifact, { kind: "status", status: 400, body: { err: "Invalid request", ECODE: "INPUT_001" } }, times),
      corruptNext: () => this.fail(isCreateArtifact, { kind: "store_corrupt" }, times),
      authFailureNext: () => this.fail(anyRequest, { kind: "status", status: 401, body: { err: "Token invalid", ECODE: "OAUTH_025" } }, times),
    };
  }

  matchers = { isCreateTask, isCreateArtifact, anyRequest, isTaskSearch: ((r) => r.method === "GET" && /\/team\/[^/]+\/task$/.test(r.path)) as Matcher, isGetTask: ((r) => r.method === "GET" && /\/task\/[^/]+$/.test(r.path)) as Matcher };

  private now(): number { return (this.opts.now ?? Date.now)(); }

  // ---- http ----
  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://fake");
    const raw = await new Promise<string>((resolve) => {
      let b = "";
      req.on("data", (c) => (b += c));
      req.on("end", () => resolve(b));
    });
    let body: unknown;
    try { body = raw ? JSON.parse(raw) : undefined; } catch { body = undefined; }
    const info: FakeRequestInfo = { method: req.method ?? "GET", path: url.pathname, query: url.searchParams, body, authorization: req.headers.authorization };
    this.log.push(info);
    this.requestCount += 1;
    const send = (status: number, payload: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "Content-Type": "application/json", ...headers });
      res.end(JSON.stringify(payload));
    };

    if (info.authorization !== this.opts.token) return send(401, { err: "Token invalid", ECODE: "OAUTH_025" });

    const fault = this.faults.find((f) => f.remaining > 0 && f.match(info));
    if (fault) {
      fault.remaining -= 1;
      const a = fault.action;
      if (a.kind === "status") return send(a.status, a.body ?? {}, a.headers);
      if (a.kind === "reset") return void req.socket.destroy();
      if (a.kind === "hang") return; // never answered; the client's timeout fires
      if (a.kind === "delay") await new Promise((r) => setTimeout(r, a.ms));
      if (a.kind === "store_then_hang") { this.createTask(info, false); return; }
      if (a.kind === "store_then_reset") { this.createTask(info, false); return void req.socket.destroy(); }
      if (a.kind === "store_corrupt") {
        const t = this.createTask(info, true);
        return send(200, this.render(t));
      }
    }

    try {
      this.route(info, send);
    } catch (e) {
      send(500, { err: String(e), ECODE: "SVC_500" });
    }
  }

  private route(info: FakeRequestInfo, send: (s: number, b: unknown) => void): void {
    const { method, path, query } = info;
    let m: RegExpExecArray | null;
    const spaceOk = (id: string) => id === this.opts.spaceId;
    if ((m = /^\/api\/v2\/space\/([^/]+)\/folder$/.exec(path))) {
      if (!spaceOk(m[1]!)) return send(404, { err: "Space not found", ECODE: "SPACE_001" });
      if (method === "GET") return send(200, { folders: this.folders });
      if (method === "POST") {
        const name = (info.body as { name?: string } | undefined)?.name;
        if (!name) return send(400, { err: "name required", ECODE: "INPUT_001" });
        const f: FakeFolder = { id: String(this.nextId++), name, lists: [] };
        this.folders.push(f);
        return send(200, { id: f.id, name: f.name });
      }
    }
    if ((m = /^\/api\/v2\/folder\/([^/]+)\/list$/.exec(path))) {
      const f = this.folders.find((x) => x.id === m![1]);
      if (!f) return send(404, { err: "Folder not found", ECODE: "FOLDER_001" });
      if (method === "GET") return send(200, { lists: f.lists });
      if (method === "POST") {
        const name = (info.body as { name?: string } | undefined)?.name;
        if (!name) return send(400, { err: "name required", ECODE: "INPUT_001" });
        const l = { id: String(this.nextId++), name };
        f.lists.push(l);
        return send(200, l);
      }
    }
    if ((m = /^\/api\/v2\/list\/([^/]+)\/task$/.exec(path))) {
      const listId = m[1]!;
      if (!this.findList(listId)) return send(404, { err: "List not found", ECODE: "LIST_001" });
      if (method === "GET") {
        const page = Number(query.get("page") ?? "0");
        const all = this.tasks.filter((t) => t.listId === listId && (query.get("include_closed") === "true" || !t.closed)).filter((t) => this.visible(t));
        this.consumeLag();
        return send(200, { tasks: all.slice(page * 100, page * 100 + 100).map((t) => this.render(t)) });
      }
      if (method === "POST") {
        const b = info.body as { name?: string; description?: string } | undefined;
        if (!b?.name) return send(400, { err: "name required", ECODE: "INPUT_001" });
        return send(200, this.render(this.createTask(info, false)));
      }
    }
    if ((m = /^\/api\/v2\/task\/([^/]+)$/.exec(path))) {
      const idx = this.tasks.findIndex((t) => t.id === m![1]);
      if (idx < 0) return send(404, { err: "Task not found", ECODE: "ITEM_013" });
      if (method === "GET") return send(200, this.render(this.tasks[idx]!));
      if (method === "DELETE") { this.tasks.splice(idx, 1); return send(200, {}); }
      if (method === "PUT") {
        const b = (info.body ?? {}) as { name?: string; description?: string };
        const t = this.tasks[idx]!;
        if (b.name !== undefined) t.name = b.name;
        if (b.description !== undefined) t.description = b.description;
        return send(200, this.render(t));
      }
    }
    if ((m = /^\/api\/v2\/folder\/([^/]+)$/.exec(path)) && method === "DELETE") {
      const f = this.folders.find((x) => x.id === m![1]);
      if (!f) return send(404, { err: "Folder not found", ECODE: "FOLDER_001" });
      const listIds = new Set(f.lists.map((l) => l.id));
      this.tasks = this.tasks.filter((t) => !listIds.has(t.listId));
      this.folders = this.folders.filter((x) => x !== f);
      return send(200, {});
    }
    if ((m = /^\/api\/v2\/team\/([^/]+)\/task$/.exec(path)) && method === "GET") {
      if (m[1] !== this.opts.workspaceId) return send(404, { err: "Team not found", ECODE: "TEAM_001" });
      const tags = query.getAll("tags[]");
      const spaces = query.getAll("space_ids[]");
      const page = Number(query.get("page") ?? "0");
      const all = this.tasks
        .filter((t) => (!tags.length || tags.every((g) => t.tags.includes(g))) && (!spaces.length || spaces.includes(t.spaceId)))
        .filter((t) => query.get("include_closed") === "true" || !t.closed)
        .filter((t) => this.visible(t));
      this.consumeLag();
      return send(200, { tasks: all.slice(page * 100, page * 100 + 100).map((t) => this.render(t)) });
    }
    send(404, { err: "Route not found", ECODE: "APP_001" });
  }

  private visible(t: FakeTask): boolean { return t.hiddenFor <= 0; }
  /** Called after serving a search/list GET: each such request ages the lag of every hidden task. */
  private consumeLag(): void { this.tasks.forEach((t) => { if (t.hiddenFor > 0) t.hiddenFor -= 1; }); }

  private findList(id: string): { folder: FakeFolder } | undefined {
    const folder = this.folders.find((f) => f.lists.some((l) => l.id === id));
    return folder ? { folder } : undefined;
  }

  private createTask(info: FakeRequestInfo, corrupt: boolean): FakeTask {
    const listId = /\/list\/([^/]+)\/task$/.exec(info.path)![1]!;
    const found = this.findList(listId);
    const b = info.body as { name: string; description?: string; tags?: string[] };
    const description = corrupt ? (b.description ?? "").replace(/"note":"[^"]*"/, '"note":"altered"').replace(/\n---\n([\s\S]{20})/, "\n---\n$1\u0000").replace(/"requirements"/, '"requirement"') : (b.description ?? "");
    const t: FakeTask = {
      id: `86${(this.nextId++).toString(36)}`,
      name: b.name,
      description,
      tags: (b.tags ?? []).map((x) => x.toLowerCase()),
      listId,
      folderId: found?.folder.id ?? "",
      spaceId: this.opts.spaceId,
      createdMs: this.now(),
      seq: ++this.seq,
      closed: false,
      hiddenFor: this.lagForNewTasks,
    };
    this.tasks.push(t);
    return t;
  }

  private render(t: FakeTask): unknown {
    return {
      id: t.id,
      name: t.name,
      description: t.description,
      text_content: t.description,
      date_created: String(t.createdMs + t.seq), // distinct, monotone creation stamps
      url: `https://app.example.invalid/t/${t.id}`,
      tags: t.tags.map((name) => ({ name })),
      list: { id: t.listId },
      folder: { id: t.folderId },
      space: { id: t.spaceId },
    };
  }
}
