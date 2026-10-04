import { expect, test } from "@playwright/test";
import { journeyB } from "@beeside/fa-public-engine/testing";
import { seed } from "./helpers";

/** The production Content-Security-Policy (script-src 'self') must not break the FA4 journey or the result. */
test("FA4 runs under the production CSP: no policy violations on the cover or the result", async ({ browser, request, baseURL }) => {
  const context = await browser.newContext({ bypassCSP: false, baseURL });
  const page = await context.newPage();
  const violations: string[] = [];
  page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text()); });
  await page.goto("/fa4");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const token = await seed(request, journeyB("es", "unknown"), "extra");
  await page.addInitScript((t) => sessionStorage.setItem("beeside.fa4.session", t), token);
  await page.goto("/fa4");
  await page.getByRole("button", { name: "Ver mi resultado" }).click();
  await expect(page.getByTestId("result-screen")).toBeVisible({ timeout: 20_000 });
  expect(violations).toEqual([]);
  await context.close();
});
