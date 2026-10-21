import { expect, test } from "@playwright/test";
import { journeyB, journeyNortica } from "@beeside/fa-public-engine/testing";
import { UI } from "../src/fa4/copy/ui";
import { axeViolations, noHorizontalOverflow, open, seed } from "./helpers";

/** Discovery v1.0 P1 batch (Product-approved, DSC-xx) in a real browser, every viewport. Changes are removals / strings: IDs, saved data and logic are untouched. */

test("DSC-04 — no live echo «Lo que nos cuentas» under the reason field; the text is still saved and reaches the next steps", async ({ page, request }) => {
  await open(page, await seed(request, journeyNortica("es"), "reason"));
  const box = page.getByLabel(UI.reasonWords.es); await expect(box).toBeVisible();
  await box.fill("Texto de prueba del motivo, ficticio.");
  await expect(page.getByText("Lo que nos cuentas")).toHaveCount(0); await expect(page.getByText("What you're telling us")).toHaveCount(0);
  await expect(page.locator(".card.soft .quote")).toHaveCount(0);
  await page.waitForTimeout(900);                                                                                       // autosave (500 ms debounce)
  await page.reload(); await expect(page.getByLabel(UI.reasonWords.es)).toHaveValue("Texto de prueba del motivo, ficticio.");
  await noHorizontalOverflow(page);
});

test("DSC-05 — no visible question numbering anywhere on the thematic screens", async ({ page, request }) => {
  await open(page, await seed(request, journeyNortica("es"), "activators"));
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const heads = await page.$$eval(".qtitle", (els) => els.map((e) => (e.textContent ?? "").trim()));
  expect(heads.length).toBeGreaterThan(0);
  for (const h of heads) expect(h).not.toMatch(/^\d+\s*\S/);                                                             // no «1», «2»… in front of the question
  await expect(page.locator(".qnum")).toHaveCount(0);
  expect(await page.locator("ol.qlist").count()).toBe(0);
  expect(await axeViolations(page)).toEqual([]);
});

test("DSC-11 — «Aún no he empezado nada» no longer exists on the topics screen (and nothing else changes: statuses are still chosen one by one)", async ({ page, request }) => {
  const a = JSON.parse(JSON.stringify(journeyB("es"))); a.knowsNeeds = false; a.fronts = {};
  await open(page, await seed(request, a, "fronts_status"));
  await expect(page.getByRole("heading", { level: 1, name: UI.topicsTitle.es })).toBeVisible();
  await expect(page.getByRole("button", { name: "Aún no he empezado nada" })).toHaveCount(0);
  await expect(page.getByText("Aún no he empezado nada")).toHaveCount(0); await expect(page.getByText("I haven't started anything yet")).toHaveCount(0);
  await expect(page.getByRole("radio", { name: UI.statuses.pending.es }).first()).toBeVisible();                       // the per-topic status controls remain
});
