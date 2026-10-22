import { expect, test } from "@playwright/test";
import { journeyNortica } from "@beeside/fa-public-engine/testing";
import { UI } from "../src/fa4/copy/ui";
import { seed } from "./helpers";

/** DSC-01 (regression, test 22 of DSC-36): a tab holding an earlier project never re-opens its answers. Since DSC-36 it shows the continuity screen instead of resuming. */
test("a tab coming back after a long pause never shows the earlier answers: continuity screen, token dropped; a recent reload still resumes", async ({ page, request }) => {
  const token = await seed(request, journeyNortica("es"), "decision");
  // seeded ONCE per tab (like a real session): a reload must not re-seed, otherwise the simulated pause would be overwritten
  await page.addInitScript((t) => { if (sessionStorage.getItem("beeside.fa4.session")) return; sessionStorage.setItem("beeside.fa4.session", t); sessionStorage.setItem("beeside.fa4.session.at", String(Date.now())); }, token);
  await page.goto("/fa4");
  await expect(page.getByRole("heading", { level: 1, name: UI.decTitle.es })).toBeVisible();
  await page.reload(); await expect(page.getByRole("heading", { level: 1, name: UI.decTitle.es })).toBeVisible();          // recent visit → resumed as before
  await page.evaluate(() => sessionStorage.setItem("beeside.fa4.session.at", String(Date.now() - 31 * 60_000)));              // …the same tab, 31 minutes of silence later
  await page.reload();
  await expect(page.getByTestId("idle-continuation")).toBeVisible();                                                           // the continuity screen, not the old project
  await expect(page.getByText(UI.decTitle.es)).toHaveCount(0); await expect(page.getByText("Nórtica")).toHaveCount(0);
  await expect(page.getByTestId("idle-continuation")).toHaveAttribute("data-phase", "sent");                                 // the answer arrived (the token is dropped when it does; a transient failure would keep it to retry)
  expect(await page.evaluate(() => sessionStorage.getItem("beeside.fa4.session"))).toBeNull();
  await page.getByRole("button", { name: UI.idleNewProject.es }).click();
  await page.getByRole("button", { name: UI.coverCta.es, exact: true }).click();
  for (const label of [UI.name.es, UI.email.es]) await expect(page.getByLabel(label)).toHaveValue("");                         // nothing from the earlier project is pre-filled
  await expect(page.getByLabel(UI.company.es, { exact: true })).toHaveValue("");
});
