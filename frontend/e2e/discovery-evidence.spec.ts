import { test } from "@playwright/test";
import fs from "node:fs";
import { journeyNortica } from "@beeside/fa-public-engine/testing";
import { UI } from "../src/fa4/copy/ui";
import { open, seed } from "./helpers";

/** Opt-in visual evidence (E2E_EVIDENCE_DIR): cover, question screen, YEV hero, editorial section, Value of Continuing, CTA and its confirmation, at 375 / 768 / 1440. */
const OUT = process.env.E2E_EVIDENCE_DIR ?? "";
test.skip(!OUT, "evidence capture is opt-in");
for (const [w, h] of [[375, 812], [768, 1024], [1440, 900]] as const) {
  test(`discovery evidence ${w}`, async ({ page, request }, info) => {
    test.skip(info.project.name !== "desktop-1440", "run once");
    fs.mkdirSync(OUT, { recursive: true });
    await page.setViewportSize({ width: w, height: h });
    await page.goto("/fa4"); await page.waitForTimeout(500); await page.screenshot({ path: `${OUT}/cover-${w}.png` });
    await open(page, await seed(request, journeyNortica("es"), "decision")); await page.waitForTimeout(700); await page.screenshot({ path: `${OUT}/question-${w}.png` });
    await open(page, await seed(request, journeyNortica("es"), "extra"));
    await page.getByRole("button", { name: new RegExp(`^(${UI.next.es}|${UI.seeResult.es})$`) }).click();
    await page.getByTestId("result-screen").waitFor();
    await page.locator(".editorial-photo").scrollIntoViewIfNeeded(); await page.waitForTimeout(500); await page.screenshot({ path: `${OUT}/editorial-${w}.png` });
    await page.locator("[data-testid=premium-continuation]").scrollIntoViewIfNeeded(); await page.screenshot({ path: `${OUT}/cta-${w}.png` });
    await page.getByRole("button", { name: "Start Your Expansion" }).click(); await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/cta-confirmation-${w}.png` });
  });
}
