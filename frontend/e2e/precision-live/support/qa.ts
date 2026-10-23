import type { Page, TestInfo } from "@playwright/test";
import fs from "node:fs";

/** Loopback control port of the QA server (see backend/scripts/precision-qa-server.ts). Per-project failure seams and seeding. */
const CONTROL = `http://127.0.0.1:${process.env.PRECISION_LIVE_CONTROL_PORT ?? 18082}`;
const KEY = process.env.QA_CONTROL_KEY ?? "qa-loopback-control-key-0001";
export const ORIGIN = `http://localhost:${process.env.PRECISION_LIVE_FRONTEND_PORT ?? 14181}`;
export const SHOTS = "/tmp/precision-live-shots";

export async function ctl<T = Record<string, unknown>>(method: "GET" | "POST", path: string, body?: Record<string, unknown>): Promise<T> {
  const url = method === "GET" && body ? `${CONTROL}${path}?${new URLSearchParams(body as Record<string, string>)}` : `${CONTROL}${path}`;
  const r = await fetch(url, { method, headers: { "X-QA-Key": KEY, "Content-Type": "application/json" }, body: method === "POST" ? JSON.stringify(body ?? {}) : undefined });
  const j = (await r.json()) as T;
  if (!r.ok) throw new Error(`control ${path} -> ${r.status} ${JSON.stringify(j)}`);
  return j;
}

export interface Seeded { projectId: string; code: string; categories: { categoryKey: string; categoryId: string }[] }
export type Stage = "start" | "map_confirmed" | "logistics_ready";
/** A brand-new synthetic Northwind project (new row set, new one-time link). */
export async function seed(stage: Stage = "start", opts: { linkTtlMs?: number } = {}): Promise<Seeded> {
  return ctl<Seeded>("POST", "/seed", { stage, ...opts });
}
export const stats = (projectId: string) => ctl<{ deliveryByState: Record<string, number>; deliveredKeys: number; deliveryRows: number; publishCalls: number; platformStored: number; modelCalls: number }>("GET", "/stats", { projectId });
export const facts = (projectId: string) => ctl<{ facts: { field_key: string; value: unknown; answer_state: string }[] }>("GET", "/facts", { projectId });

/** Direct API access as the browser would have it (a second session of the same project, minted from a fresh one-time link). */
export class Api {
  constructor(readonly token: string, readonly locale: "en" | "es" = "en") {}
  static async open(projectId: string, locale: "en" | "es" = "en"): Promise<Api> {
    const { code } = await ctl<{ code: string }>("POST", "/link", { projectId });
    const r = await fetch(`${ORIGIN}/api/precision/session/exchange`, { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN }, body: JSON.stringify({ code }) });
    if (!r.ok) throw new Error(`exchange ${r.status}`);
    return new Api(((await r.json()) as { sessionToken: string }).sessionToken, locale);
  }
  async call<T = any>(method: "GET" | "POST", path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; body: T; headers: Headers }> {
    const r = await fetch(`${ORIGIN}/api/precision${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, "X-Precision-Locale": this.locale, Origin: ORIGIN, ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await r.text();
    let parsed: unknown = text;
    try { parsed = JSON.parse(text); } catch { /* keep text */ }
    return { status: r.status, body: parsed as T, headers: r.headers };
  }
  get = <T = any>(path: string) => this.call<T>("GET", path);
  post = <T = any>(path: string, body: unknown = {}) => this.call<T>("POST", path, body);
  /** Logistics category card (by label) from the Center. */
  async categoryId(label: RegExp = /logistics|log[ií]stica/i): Promise<string> {
    const c = await this.get("/center");
    return c.body.categories.find((k: { label: string }) => label.test(k.label)).id;
  }
}

/** Records every /api/precision answer of a page (for the forbidden-term scan of the whole journey). */
export class ApiRecorder {
  readonly bodies: { method: string; url: string; status: number; text: string; reqText: string }[] = [];
  readonly requests: { method: string; path: string; status: number }[] = [];
  attach(page: Page): void {
    page.on("response", async (r) => {
      const u = new URL(r.url());
      if (!u.pathname.startsWith("/api/precision/")) return;
      try {
        const text = await r.text();
        const req = r.request();
        this.bodies.push({ method: req.method(), url: u.pathname, status: r.status(), text, reqText: req.postData() ?? "" });
        this.requests.push({ method: req.method(), path: u.pathname, status: r.status() });
      } catch { /* aborted by navigation */ }
    });
  }
}

export function shotDir(info: TestInfo, locale: string): string {
  const dir = `${SHOTS}/${info.project.name.replace("-", "-")}-${locale}`;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
