import { expect, test } from "@playwright/test";
import { journeyNortica } from "@beeside/fa-public-engine/testing";
import { UI } from "../src/fa4/copy/ui";
import { seed } from "./helpers";

/** DSC-01 in a real browser: the tester's scenario — a tab that still holds an earlier project comes back much later and must not show its answers. */
test("a tab coming back after a long pause starts clean (no pre-filled answers); a recent reload still resumes", async ({ page, request }) => {
  const token = await seed(request, journeyNortica("es"), "decision");
  // seeded ONCE per tab (like a real session): a reload must not re-seed, otherwise the simulated pause would be overwritten
  await page.addInitScript((t) => { if (sessionStorage.getItem("beeside.fa4.session")) return; sessionStorage.setItem("beeside.fa4.session", t); sessionStorage.setItem("beeside.fa4.session.at", String(Date.now())); }, token);
  await page.goto("/fa4");
  await expect(page.getByRole("heading", { name: UI.decTitle.es })).toBeVisible();
  await page.reload(); await expect(page.getByRole("heading", { name: UI.decTitle.es })).toBeVisible();          // recent visit → resumed as before
  await page.evaluate(() => sessionStorage.setItem("beeside.fa4.session.at", String(Date.now() - 31 * 60_000)));      // …the same tab, 31 minutes of silence later
  await page.reload();
  await expect(page.getByRole("button", { name: UI.coverCta.es })).toBeVisible();                                    // the cover, not the old project
  await expect(page.getByText(UI.decTitle.es)).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem("beeside.fa4.session"))).toBeNull();
  await page.getByRole("button", { name: UI.coverCta.es }).click();
  for (const label of [UI.name.es, UI.email.es]) await expect(page.getByLabel(label)).toHaveValue("");               // nothing from the earlier project is pre-filled
  await expect(page.getByLabel(UI.company.es, { exact: true })).toHaveValue("");
});
