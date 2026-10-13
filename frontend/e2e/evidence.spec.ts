import { test } from "@playwright/test";
import { journeyB, journeyC, journeyNortica, journeyUnknown } from "@beeside/fa-public-engine/testing";
import { UI } from "../src/fa4/copy/ui";
import { open, seed } from "./helpers";

/**
 * Visual evidence of the IMPLEMENTED product (Final Design Delta) at 375 / 768 / 1024 / 1440 in ES and EN.
 * Run: E2E_EVIDENCE=1 npx playwright test evidence   → test-results/evidence/<screen>-<lang>-<viewport>.png
 */
test.skip(!process.env.E2E_EVIDENCE, "evidence capture is opt-in");
for (const loc of ["es", "en"] as const) {
  test(`evidence (${loc})`, async ({ page, request }, info) => {
    const out = (name: string) => `test-results/evidence/${name}-${loc}-${info.project.name}.png`;
    const shot = async (name: string, settle?: () => Promise<unknown>) => { await settle?.(); await page.waitForTimeout(250); await page.screenshot({ path: out(name), fullPage: false }); await page.screenshot({ path: out(`${name}-full`), fullPage: true }); };
    const t = (l: { es: string; en: string }) => l[loc];
    // cover + identity (real UI)
    await page.goto("/fa4");
    if (loc === "en") await page.getByRole("button", { name: /English/ }).click();
    await shot("01-cover");
    await page.getByRole("button", { name: t(UI.coverCta) }).click();
    await shot("02-identity");
    // seeded screens
    const seeded = async (key: string, a: Parameters<typeof seed>[1]) => { const token = await seed(request, a, key); await page.context().clearCookies(); await page.evaluate(() => sessionStorage.clear()); await open(page, token); await page.waitForTimeout(600); };
    await seeded("company", journeyNortica(loc)); await shot("03-company");
    await seeded("destinations", journeyB(loc)); await shot("04-destinations-multi-country-merged");
    await seeded("presence:mx", journeyB(loc)); await shot("05-presence-merged-country-1");
    await seeded("presence:us", journeyB(loc)); await shot("06-presence-merged-last-country-with-D079-question");
    await seeded("decision", journeyNortica(loc)); await shot("07-decision-with-project-size");
    await seeded("fronts_status", journeyNortica(loc)); await shot("08-topics-with-cargo-block");
    await seeded("fronts_mark", { ...journeyC(loc), knowsNeeds: true }); await shot("09-D079-yes-mark-the-topics");
    for (const [name, a] of [["10-yev-nortica", journeyNortica(loc)], ["11-yev-no-lo-se", journeyUnknown(loc)]] as const) {
      await seeded("extra", a);
      await page.getByRole("button", { name: t(UI.seeResult) }).click();
      await page.getByTestId("result-screen").waitFor({ timeout: 20_000 });
      await shot(name);
    }
  });
}
