import { expect, type APIRequestContext, type Page } from "@playwright/test";
import axeSource from "axe-core";
import type { Answers } from "@beeside/fa-public-engine";

/** Create a project server-side from fixture answers (as if the identity step were done) and return its working-session token. */
export async function seed(request: APIRequestContext, answers: Answers, step: string): Promise<string> {
  const r = await request.post("/api/fa4/sessions", { data: { answers, step } });
  expect(r.ok(), await r.text()).toBeTruthy();
  return ((await r.json()) as { sessionToken: string }).sessionToken;
}
/** Opens /fa4 with this tab's working session (what a returning visitor has after the emailed link is exchanged). */
export async function open(page: Page, token: string) {
  await page.addInitScript((t) => sessionStorage.setItem("beeside.fa4.session", t), token);
  await page.goto("/fa4");
}

export async function noHorizontalOverflow(page: Page) {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(o.sw, `horizontal overflow: scrollWidth ${o.sw} > innerWidth ${o.iw}`).toBeLessThanOrEqual(o.iw);
}
/** Interactive controls must be at least 44×44 CSS px. */
export async function touchTargetsOk(page: Page) {
  const small = await page.evaluate(() => {
    const out: string[] = [];
    document.querySelectorAll<HTMLElement>("button, input:not([type=checkbox]):not([type=radio]), select, textarea").forEach((el) => {
      const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0 || el.closest(".sr-only")) return;
      if (r.height < 43.5 || r.width < 43.5) out.push(`${el.tagName} "${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 30)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
    });
    return out;
  });
  expect(small, `touch targets under 44px: ${small.join(" | ")}`).toEqual([]);
}
export async function axeViolations(page: Page): Promise<string[]> {
  await page.addScriptTag({ content: (axeSource as unknown as { source: string }).source });
  return page.evaluate(async () => {
    // @ts-expect-error injected by addScriptTag
    const r = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa"] } });
    return r.violations.filter((v: { impact: string }) => v.impact === "serious" || v.impact === "critical").map((v: { id: string; nodes: unknown[] }) => `${v.id} (${v.nodes.length})`);
  });
}
export const FORBIDDEN = ["Por confirmar", "Sin servicio hoy", "Snapshot", "radar", "readiness", "SOURCEABLE", "NOT_OFFERED", "UNMAPPED_NEED", "NO_ACTIVE_COVERAGE", "DEVELOPING", "Grant Thornton", "Baker Tilly", "Traxión", "Santander", "MAPFRE", "Garza Ponce", "AMPIP"];
