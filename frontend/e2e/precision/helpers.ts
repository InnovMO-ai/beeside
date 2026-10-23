import { expect, type Locator, type Page, type TestInfo } from "@playwright/test";
import axeSource from "axe-core";
import fs from "node:fs";

export const SHOTS = "/tmp/precision-shots";

/** Opens a Precision screen against the in-memory server. `mock` is the address switch list (see mock/mockTransport.ts). */
export async function go(page: Page, path: string, opts: { mock?: string; locale?: "en" | "es" } = {}) {
  const locale = opts.locale ?? "en";
  await page.addInitScript((l) => { try { if (!localStorage.getItem("beeside.precision.locale")) localStorage.setItem("beeside.precision.locale", l); } catch { /* blocked storage */ } }, locale);
  const mock = ["latency:0", opts.mock].filter(Boolean).join(",");
  await page.goto(`/precision${path}${path.includes("?") ? "&" : "?"}code=demo&mock=${mock}`);
}

export const h1 = (page: Page) => page.getByRole("heading", { level: 1 });

export async function axeSeriousOrCritical(page: Page): Promise<string[]> {
  await page.addScriptTag({ content: (axeSource as unknown as { source: string }).source });
  return page.evaluate(async () => {
    // @ts-expect-error injected by addScriptTag
    const r = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } });
    return r.violations
      .filter((v: { impact: string }) => v.impact === "serious" || v.impact === "critical")
      .map((v: { id: string; nodes: { target: unknown[] }[] }) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => String(n.target[0])).join(" ; ")}`);
  });
}
export async function expectAccessible(page: Page, label: string) {
  const v = await axeSeriousOrCritical(page);
  expect(v, `axe serious/critical on ${label}`).toEqual([]);
}

export async function expectNoHorizontalOverflow(page: Page, label = "") {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(o.sw, `horizontal overflow ${label}: scrollWidth ${o.sw} > innerWidth ${o.iw}`).toBeLessThanOrEqual(o.iw);
}

/** Every visible control meets the 44x44 target (inline text links inside a paragraph are exempt under WCAG 2.2 inline exception). */
export async function expectTargets44(page: Page, label = "") {
  const small = await page.evaluate(() => {
    const out: string[] = [];
    document.querySelectorAll<HTMLElement>("button, input:not([type=checkbox]):not([type=radio]), select, textarea, [role=button], a.pz-btn, summary").forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || el.closest("[hidden], [inert]")) return;
      // Conversation pills and the round send button are 36px on desktop (Design Proof) with a ::after that extends the pointer target to 44px; they are 44-48px on mobile.
      if (window.innerWidth >= 900 && el.matches(".pz-pill, .pz-quickbtn, .pz-send")) return;
      if (r.height < 43.5 || r.width < 43.5) out.push(`${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
    });
    return out;
  });
  expect(small, `targets under 44px ${label}: ${small.join(" | ")}`).toEqual([]);
}

/** Text the person can see, to scan for forbidden terms and raw errors. */
export async function visibleText(page: Page): Promise<string> {
  return page.evaluate(() => document.body.innerText);
}
const RAW = /\b(undefined|NaN|\[object|Traceback|TypeError|UNAUTHENTICATED|TEMPORARILY_UNAVAILABLE|PREVIEW_STALE|ACTIVATION_PENDING_RETRY_FIRST|HTTP \d{3}|stack)\b/;
const TERMS = /(\bClickUp\b|\bPSM\b|\bMSM\b|\bCCIR\b|\blisto\b|\blista\b|\bready\b|\bvalidated\b|[!¡])/i;
export async function expectCleanCopy(page: Page, label: string) {
  const t = await visibleText(page);
  expect(t, `raw error text on ${label}`).not.toMatch(RAW);
  expect(t, `forbidden term on ${label}`).not.toMatch(TERMS);
}

/** Checks a screen the way every state is checked: accessible, no overflow, clean copy, 44px targets. */
export async function checkScreen(page: Page, label: string, opts: { targets?: boolean } = {}) {
  await expectAccessible(page, label);
  await expectNoHorizontalOverflow(page, label);
  await expectCleanCopy(page, label);
  if (opts.targets !== false) await expectTargets44(page, label);
}

/**
 * Answers the conversation the way a person would until `done` is visible: confirms what Precision understood,
 * picks suggested answers, writes free text when there are none, and says "I don't know yet" once (to produce a pending item).
 */
export async function drive(page: Page, done: Locator, opts: { idkAt?: number; maxTurns?: number } = {}) {
  const maxTurns = opts.maxTurns ?? 30;
  const log = page.getByRole("log");
  for (let turn = 0; turn < maxTurns; turn++) {
    if (await done.isVisible()) return;
    const before = await log.locator(":scope > *").count();
    const confirm = page.getByRole("button", { name: /^(Yes, that is right|Confirm)/ }).first();
    const group = page.getByRole("group", { name: /Suggested answers/i });
    const composer = page.getByRole("textbox", { name: /Your answer/i });
    await expect(composer.or(done).first()).toBeVisible();
    if (await done.isVisible()) return;
    if (await confirm.isVisible().catch(() => false)) {
      await confirm.click();
    } else if (await group.isVisible().catch(() => false)) {
      const idk = group.getByRole("button", { name: /I don't know/i });
      const options = group.getByRole("button");
      if (opts.idkAt === turn && (await idk.count())) await idk.click();
      else {
        const labels = await options.allInnerTexts();
        let i = labels.findIndex((l) => /Continue with pending/i.test(l)); // the way out of the final review
        if (i < 0) i = labels.findIndex((l) => !/know/i.test(l));
        await options.nth(Math.max(i, 0)).click();
      }
    } else {
      await composer.fill("Finished goods to Mexico, shipped by sea in dry containers.");
      await composer.press("Enter");
    }
    await expect.poll(async () => (await done.isVisible()) || (await log.locator(":scope > *").count()) > before, { timeout: 15000 }).toBe(true);
  }
  throw new Error("conversation did not reach its end");
}

export function recordTiming(info: TestInfo, name: string, ms: number) {
  fs.mkdirSync(`${SHOTS}/timings`, { recursive: true });
  const f = `${SHOTS}/timings/${info.project.name}.json`;
  let cur: Record<string, number> = {};
  try { cur = JSON.parse(fs.readFileSync(f, "utf8")); } catch { /* first write */ }
  cur[name] = Math.round(ms);
  fs.writeFileSync(f, JSON.stringify(cur, null, 1));
}

/** Navigation timing of the page that was just loaded. */
export async function loadTiming(page: Page) {
  return page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const paint = Object.fromEntries(performance.getEntriesByType("paint").map((p) => [p.name, p.startTime]));
    const lcp = new Promise<number>((res) => {
      try { new PerformanceObserver((l) => { const e = l.getEntries(); res(e[e.length - 1].startTime); }).observe({ type: "largest-contentful-paint", buffered: true }); setTimeout(() => res(-1), 1500); } catch { res(-1); }
    });
    return lcp.then((l) => ({ domContentLoaded: nav?.domContentLoadedEventEnd ?? 0, load: nav?.loadEventEnd ?? 0, fcp: paint["first-contentful-paint"] ?? 0, lcp: l }));
  });
}

/** For toHaveURL: the path ends with `tail` whatever the query string carries (the mock switches stay in the address). */
export const pathEnds = (tail: string) => (u: URL) => u.pathname.replace(/\/+$/, "").endsWith(tail);

declare global {
  interface Window {
    /** Test-only controls of the in-memory server; they exist only in builds made with VITE_PRECISION_API_MODE=mock. */
    __PRECISION_MOCK__?: {
      inject: (kind: string, count?: number) => void;
      stats: () => { sendCalls: number; turnCalls: number; requests: number };
      setAccess: (mode: string) => void;
    };
  }
}
