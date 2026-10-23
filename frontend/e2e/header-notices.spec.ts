import { expect, test } from "@playwright/test";
import { journeyNortica } from "@beeside/fa-public-engine/testing";
import { UI } from "../src/fa4/copy/ui";
import { noHorizontalOverflow, open, seed } from "./helpers";

test("header breathing room: logo row, progress line and title are visibly separated (every viewport)", async ({ page, request }) => {
  await open(page, await seed(request, journeyNortica("es"), "decision")); await page.waitForTimeout(500);
  const g = await page.evaluate(() => {
    const r = (s: string) => document.querySelector(s)!.getBoundingClientRect();
    const logo = r(".topbar"), prog = r(".progress"), h1 = r("h1");
    return { logoToProgress: prog.top - document.querySelector(".topbar .logo")!.getBoundingClientRect().bottom, progressToTitle: h1.top - prog.bottom, topbarH: logo.height };
  });
  if (process.env.E2E_EVIDENCE_DIR) await page.screenshot({ path: `${process.env.E2E_EVIDENCE_DIR}/header-${test.info().project.name}.png`, clip: { x: 0, y: 0, width: page.viewportSize()!.width, height: 420 } });
  expect(g.logoToProgress, "logo → progress").toBeGreaterThanOrEqual(14);
  expect(g.progressToTitle, "progress → title").toBeGreaterThanOrEqual(26);
  await noHorizontalOverflow(page);
});

test("a failed background save shows a notice that closes by itself and never blocks Continue", async ({ page, request }) => {
  await open(page, await seed(request, journeyNortica("es"), "decision")); await page.waitForTimeout(500);
  await page.route("**/api/fa4/session", (route) => (route.request().method() === "PUT" ? route.abort() : route.continue()));
  await page.getByRole("radio", { name: UI.dec.exploring.es }).check();               // any edit triggers the autosave
  const toast = page.locator(".toast");
  await expect(toast).toBeVisible({ timeout: 5000 });
  const nav = await page.getByRole("button", { name: UI.next.es, exact: true }).boundingBox(); const t = await toast.boundingBox();
  expect(t!.y + t!.height, "the notice floats above the action bar, never over it").toBeLessThanOrEqual(nav!.y + 1);
  await expect(page.getByRole("button", { name: UI.next.es, exact: true })).toBeEnabled();
  await toast.click(); await expect(toast).toHaveCount(0);                              // a click closes it
  await page.getByRole("radio", { name: UI.dec.decided.es }).check();
  await expect(toast).toBeVisible({ timeout: 5000 }); await expect(toast).toHaveCount(0, { timeout: 9000 });   // …and it also closes by itself
});
