import { expect, test } from "@playwright/test";
import { journeyNortica } from "@beeside/fa-public-engine/testing";
import { UI } from "../src/fa4/copy/ui";
import { noHorizontalOverflow, open, seed } from "./helpers";

/** Discovery v1.0: no horizontal scrolling on any supported small viewport, on every screen of the real journey (cover → identity → every question → YEV). */
for (const width of [320, 360, 375, 390]) {
  for (const loc of ["es", "en"] as const) {
    test(`no horizontal overflow at ${width}px across the whole journey (${loc})`, async ({ page, request }, info) => {
      test.skip(info.project.name !== "mobile-375", "viewport is set inside the test; run once");
      await page.setViewportSize({ width, height: 740 });
      await page.goto("/fa4"); if (loc === "en") await page.getByRole("button", { name: /English/ }).click();
      await noHorizontalOverflow(page);                                                      // cover
      await page.getByRole("button", { name: UI.coverCta[loc], exact: true }).click(); await noHorizontalOverflow(page);   // identity
      const a = journeyNortica(loc); a.locale = loc;
      await page.close();
      const p = await page.context().newPage(); await p.setViewportSize({ width, height: 740 });
      await open(p, await seed(request, a, "destinations"));
      const screens: string[] = [];
      for (let i = 0; i < 30; i++) {
        await p.waitForTimeout(150);
        if (await p.getByTestId("result-screen").count()) break;
        await noHorizontalOverflow(p);
        screens.push(((await p.locator("h1").first().textContent()) ?? "").slice(0, 40));
        const next = p.getByRole("button", { name: new RegExp(`^(${UI.next[loc]}|${UI.seeResult[loc]})$`) });
        await next.click({ timeout: 5000 }).catch((e) => { throw new Error(`stuck at step ${screens.length}: ${screens.join(' | ')} :: ${String(e).slice(0, 300)}`); });
      }
      await expect(p.getByTestId("result-screen")).toBeVisible(); await noHorizontalOverflow(p);
      expect(screens.length).toBeGreaterThan(4);
    });
  }
}
