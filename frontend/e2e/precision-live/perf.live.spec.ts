import { expect, test, type Browser, type BrowserContext, type CDPSession, type Page } from "@playwright/test";
import fs from "node:fs";
import { Api, ORIGIN, seed, stats } from "./support/qa";
import { SCRIPT, openWithCode, T } from "./support/live";
import { logisticsConfirmed, newKey, sendViaApi } from "./support/flows";

/**
 * Performance measurements (docs/f5/qa/performance-2026-10-09.md). Run on demand:
 *   PRECISION_PERF=1 PRECISION_LIVE_REUSE=1 npx playwright test -c playwright.precision-live.config.ts perf --project=desktop-light
 * Everything goes through the production static server and its /api proxy to the real backend and PostgreSQL. The model is the scripted
 * (deterministic, in-process) provider and Operation Hub is the simulator, so provider-dependent time is NOT represented here.
 * Results: /tmp/precision-live/perf-results.json
 */
test.skip(!process.env.PRECISION_PERF, "set PRECISION_PERF=1 to run the measurements");
test.setTimeout(600_000);
test.describe.configure({ mode: "serial" });

const OUT = "/tmp/precision-live/perf-results.json";
const results: Record<string, unknown> = {};
const save = () => fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)] : NaN; };
const summary = (xs: number[]) => ({ n: xs.length, min: Math.round(Math.min(...xs)), p50: Math.round(q(xs, 50)), p95: Math.round(q(xs, 95)), max: Math.round(Math.max(...xs)) });

async function throttle(page: Page, kind: "none" | "mobile"): Promise<CDPSession | null> {
  if (kind === "none") return null;
  const cdp = await page.context().newCDPSession(page);
  // "Slow 4G"-like: 1.6 Mbps down, 750 kbps up, 150 ms RTT, and a 4x slower CPU (mid-range phone).
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  return cdp;
}

async function paintMetrics(page: Page) {
  return page.evaluate(() => new Promise<{ fcp: number | null; lcp: number | null; dcl: number; load: number; transferKB: number; requests: number }>((resolve) => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming;
    const fcp = performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null;
    let lcp: number | null = null;
    try { new PerformanceObserver((l) => { const e = l.getEntries().at(-1); if (e) lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true }); } catch { /* unsupported */ }
    setTimeout(() => {
      const res = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
      resolve({ fcp, lcp, dcl: nav.domContentLoadedEventEnd, load: nav.loadEventEnd, transferKB: Math.round((res.reduce((a, r) => a + (r.transferSize || 0), 0) + (nav.transferSize || 0)) / 1024), requests: res.length + 1 });
    }, 300);
  }));
}

/** Full-page load of an authenticated session: time until the first screen content (h1) is visible. */
async function loadOnce(browser: Browser, kind: "none" | "mobile", cold: boolean, viewport: { width: number; height: number }, mobile: boolean) {
  const ctx: BrowserContext = await browser.newContext({ baseURL: ORIGIN, viewport, isMobile: mobile, hasTouch: mobile, bypassCSP: true });
  const page = await ctx.newPage();
  await throttle(page, kind);
  const s = await seed("map_confirmed");
  const t0 = Date.now();
  await openWithCode(page, s.code, "en"); // cold: new context, nothing cached, includes the one-time code exchange
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 60_000 });
  const cover = Date.now() - t0;
  const m1 = await paintMetrics(page);
  await page.getByRole("button", { name: T.en.cont }).or(page.getByRole("link", { name: T.en.cont })).first().click();
  await expect(page).toHaveURL(/\/precision\/center/);
  let warm: { ms: number; m: Awaited<ReturnType<typeof paintMetrics>> } | null = null;
  if (!cold) {
    const t1 = Date.now();
    await page.reload(); // warm: HTTP cache primed, session restored from sessionStorage (no exchange)
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible({ timeout: 60_000 });
    warm = { ms: Date.now() - t1, m: await paintMetrics(page) };
  }
  await ctx.close();
  return { cover, m1, warm };
}

for (const [label, kind, vp, mobile] of [
  ["desktop", "none", { width: 1440, height: 900 }, false],
  ["mobile-throttled", "mobile", { width: 390, height: 844 }, true],
] as const) {
  test(`page load, cold and warm (${label})`, async ({ browser }) => {
    const cold: number[] = [], warm: number[] = [], fcp: number[] = [], lcp: number[] = [], kb: number[] = [];
    let reqs = 0;
    for (let i = 0; i < 5; i++) {
      const r = await loadOnce(browser, kind, false, vp, mobile);
      cold.push(r.cover); if (r.m1.fcp) fcp.push(r.m1.fcp); if (r.m1.lcp) lcp.push(r.m1.lcp); kb.push(r.m1.transferKB); reqs = r.m1.requests;
      if (r.warm) warm.push(r.warm.ms);
    }
    results[`load_${label}`] = { method: "5 runs; cold = new browser context + one-time code exchange until h1 visible; warm = reload of the same context (HTTP cache + stored session)", coldToFirstContentMs: summary(cold), warmReloadMs: summary(warm), fcpMs: summary(fcp), lcpMs: summary(lcp), coldTransferKB: summary(kb), coldRequests: reqs };
    save();
  });
}

test("navigation between screens (client-side, desktop)", async ({ browser }) => {
  const ctx = await browser.newContext({ baseURL: ORIGIN, viewport: { width: 1440, height: 900 }, bypassCSP: true });
  const page = await ctx.newPage();
  const project = await logisticsConfirmed();
  const s = await seed("logistics_ready");
  await openWithCode(page, s.code, "en");
  await page.getByRole("button", { name: T.en.cont }).or(page.getByRole("link", { name: T.en.cont })).first().click();
  await expect(page).toHaveURL(/\/precision\/center/);
  const timeClick = async (click: () => Promise<void>, ready: () => Promise<void>): Promise<number> => { const t = Date.now(); await click(); await ready(); return Date.now() - t; };
  const nav = page.getByRole("navigation");
  const legs: Record<string, number[]> = { "Center to Understanding": [], "Understanding to Center": [], "Center to category (Logistics)": [], "category to Center": [], "category to Service Map": [] };
  void project;
  for (let i = 0; i < 6; i++) {
    legs["Center to Understanding"].push(await timeClick(() => nav.getByRole("link", { name: /Precision Understanding/ }).click(), () => expect(page.locator(".pz-turn-assistant").first()).toBeVisible()));
    legs["Understanding to Center"].push(await timeClick(() => nav.getByRole("link", { name: /Precision Center/ }).click(), () => expect(page.getByRole("heading", { level: 1 })).toBeVisible()));
    legs["Center to category (Logistics)"].push(await timeClick(() => nav.getByRole("link", { name: /Logistics/ }).first().click(), () => expect(page.locator(".pz-turn-assistant").first()).toBeVisible()));
    legs["category to Center"].push(await timeClick(() => nav.getByRole("link", { name: /Precision Center/ }).click(), () => expect(page.getByRole("heading", { level: 1 })).toBeVisible()));
  }
  results.navigation = { method: "6 rounds, click until the destination content is visible (data fetched and rendered); desktop; scripted provider", ...Object.fromEntries(Object.entries(legs).filter(([, v]) => v.length).map(([k, v]) => [k, summary(v)])) };
  await ctx.close();
  save();
});

test("conversation round-trip over 50+ turns (server time through the proxy and direct)", async () => {
  const through: number[] = [], direct: number[] = [], processQ: number[] = [], answers: number[] = [];
  const BACKEND = `http://127.0.0.1:${process.env.PRECISION_LIVE_BACKEND_PORT ?? 18081}`;
  for (let round = 0; round < 3; round++) {
    const s = await seed("map_confirmed");
    const api = await Api.open(s.projectId, "en");
    const cat = await api.categoryId();
    const exchangeDirect = await fetch(`${BACKEND}/api/precision/session/exchange`, { method: "POST", headers: { "Content-Type": "application/json", Origin: ORIGIN }, body: JSON.stringify({ code: (await (await fetch(`http://127.0.0.1:${process.env.PRECISION_LIVE_CONTROL_PORT ?? 18082}/link`, { method: "POST", headers: { "X-QA-Key": process.env.QA_CONTROL_KEY ?? "qa-loopback-control-key-0001", "Content-Type": "application/json" }, body: JSON.stringify({ projectId: s.projectId }) })).json()).code }) });
    const directToken = ((await exchangeDirect.json()) as { sessionToken: string }).sessionToken;
    const turns = [...SCRIPT.en.processQ.slice(0, 3), ...SCRIPT.en.logistics.slice(0, 5), SCRIPT.en.processQ[3], ...SCRIPT.en.logistics.slice(5), SCRIPT.en.processQ[4], SCRIPT.en.processQ[5]];
    for (const [i, text] of turns.entries()) {
      const isProcess = SCRIPT.en.processQ.includes(text as never);
      const useDirect = i % 4 === 3;
      const t0 = performance.now();
      const r = useDirect
        ? await fetch(`${BACKEND}/api/precision/categories/${cat}/turns`, { method: "POST", headers: { Authorization: `Bearer ${directToken}`, "Content-Type": "application/json", Origin: ORIGIN, "X-Precision-Locale": "en" }, body: JSON.stringify({ turnKey: newKey("pf"), text }) })
        : await fetch(`${ORIGIN}/api/precision/categories/${cat}/turns`, { method: "POST", headers: { Authorization: `Bearer ${api.token}`, "Content-Type": "application/json", Origin: ORIGIN, "X-Precision-Locale": "en" }, body: JSON.stringify({ turnKey: newKey("pf"), text }) });
      await r.text();
      const ms = performance.now() - t0;
      expect(r.status).toBe(200);
      (useDirect ? direct : through).push(ms);
      (isProcess ? processQ : answers).push(ms);
    }
  }
  const all = [...through, ...direct];
  results.conversation = {
    method: "3 fresh Logistics conversations, 17 turns each (11 answers + 6 process questions, 51 turns); each turn = one POST /categories/:id/turns, wall time of the whole request; every 4th turn straight to the backend port, the rest through the static server /api proxy; scripted model, so model latency is ~0",
    allTurnsMs: summary(all), throughProxyMs: summary(through), directToBackendMs: summary(direct), answersMs: summary(answers), processQuestionsMs: summary(processQ),
  };
  save();
});

test("CRP view, category switch, Preview and Send (API round trips and screen times)", async ({ browser }) => {
  const crp: number[] = [], crpConfirm: number[] = [], preview: number[] = [], sendMs: number[] = [], center: number[] = [], catGet: number[] = [], sm: number[] = [];
  const timed = async (arr: number[], f: () => Promise<{ status: number }>) => { const t = performance.now(); const r = await f(); arr.push(performance.now() - t); expect(r.status).toBeLessThan(300); };
  for (let i = 0; i < 12; i++) {
    const p = await seed("logistics_ready");
    const api = await Api.open(p.projectId, "en");
    const cat = await api.categoryId();
    await timed(center, () => api.get("/center"));
    await timed(catGet, () => api.get(`/categories/${cat}`));
    await timed(crp, () => api.get(`/categories/${cat}/crp`));
    await timed(crpConfirm, () => api.post(`/categories/${cat}/crp/confirm`, { requestKey: newKey("c") }));
    await timed(preview, () => api.get(`/categories/${cat}/preview`));
    const pv = await api.get(`/categories/${cat}/preview`);
    await timed(sendMs, () => api.post(`/categories/${cat}/send`, { previewChecksum: pv.body.previewChecksum }));
    await timed(sm, () => api.get("/service-map"));
    expect((await stats(p.projectId)).deliveredKeys).toBe(1);
  }
  results.api_round_trips = { method: "12 fresh projects at logistics_ready; each call timed end to end through the static server /api proxy", center: summary(center), categoryOpen: summary(catGet), crpView: summary(crp), crpConfirm: summary(crpConfirm), previewGeneration: summary(preview), sendToOperationHub: summary(sendMs), serviceMap: summary(sm) };

  // Screen times in the browser (desktop): CRP view, Preview and Send until the Sent screen is visible.
  const ctx = await browser.newContext({ baseURL: ORIGIN, viewport: { width: 1440, height: 900 }, bypassCSP: true });
  const page = await ctx.newPage();
  const crpScreen: number[] = [], previewScreen: number[] = [], sendScreen: number[] = [], switchScreen: number[] = [];
  for (let i = 0; i < 4; i++) {
    const s = await seed("logistics_ready");
    const api = await Api.open(s.projectId, "en");
    const cat = await api.categoryId();
    await openWithCode(page, s.code, "en", `/precision/category/${cat}`);
    await expect(page.locator(".pz-turn-assistant").first()).toBeVisible();
    let t = Date.now();
    await page.goto(`/precision/category/${cat}/summary`);
    await expect(page.getByRole("button", { name: T.en.confirmCrp })).toBeVisible();
    crpScreen.push(Date.now() - t);
    await page.getByRole("button", { name: T.en.confirmCrp }).click();
    await page.getByRole("dialog").getByRole("button", { name: /^Confirm$/ }).click();
    await expect(page.getByText(T.en.crpConfirmed).first()).toBeVisible();
    t = Date.now();
    await page.getByRole("link", { name: T.en.preview }).or(page.getByRole("button", { name: T.en.preview })).first().click();
    await expect(page.getByRole("button", { name: T.en.send })).toBeVisible();
    previewScreen.push(Date.now() - t);
    t = Date.now();
    await page.getByRole("button", { name: T.en.send }).click();
    await expect(page.getByRole("heading", { level: 1, name: T.en.sentH1 })).toBeVisible({ timeout: 30_000 });
    sendScreen.push(Date.now() - t);
    t = Date.now();
    await page.getByRole("link", { name: /Precision Center/ }).first().click();
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    switchScreen.push(Date.now() - t);
  }
  results.screens = { method: "4 fresh projects, desktop; click or navigation until the destination is visible", crpScreenFromReloadMs: summary(crpScreen), previewScreenMs: summary(previewScreen), sendUntilSentScreenMs: summary(sendScreen), sentToCenterMs: summary(switchScreen) };
  await ctx.close();
  save();
});
