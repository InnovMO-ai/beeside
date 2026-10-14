import { expect, test, type Page } from "@playwright/test";
import axeSource from "axe-core";
import { journeyNortica } from "@beeside/fa-public-engine/testing";
import { UI } from "../src/fa4/copy/ui";
import { open, seed, touchTargetsOk } from "./helpers";

/** Release audit: WCAG 2.1 AA with COLOUR CONTRAST ENABLED (the shared helper disables it) on the core journey, ES and EN, small and large viewports; keyboard + focus visibility. */
async function axeAll(page: Page): Promise<string[]> {
  await page.addScriptTag({ content: (axeSource as unknown as { source: string }).source });
  return page.evaluate(async () => {
    // @ts-expect-error injected
    const r = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } });
    return r.violations.map((v: { id: string; impact: string; nodes: { target: unknown[] }[] }) => `${v.impact}:${v.id} (${v.nodes.length}) ${JSON.stringify(v.nodes[0]?.target)}`);
  });
}
for (const [w, h] of [[320, 740], [375, 812], [768, 1024], [1440, 900]] as const) for (const loc of ["es", "en"] as const) {
  test(`axe incl. colour contrast — cover, question, YEV at ${w}px (${loc})`, async ({ page, request }, info) => {
    test.skip(info.project.name !== "desktop-1440", "viewport is set inside the test; run once");
    await page.setViewportSize({ width: w, height: h });
    await page.goto("/fa4"); if (loc === "en") await page.getByRole("button", { name: /English/ }).click();
    await page.waitForTimeout(400); expect(await axeAll(page), "cover").toEqual([]);
    await open(page, await seed(request, journeyNortica(loc), "decision")); await page.waitForTimeout(600); expect(await axeAll(page), "question").toEqual([]);
    await open(page, await seed(request, journeyNortica(loc), "extra"));
    await page.getByRole("button", { name: new RegExp(`^(${UI.next[loc]}|${UI.seeResult[loc]})$`) }).click();
    await page.getByTestId("result-screen").waitFor(); await page.waitForFunction(() => !!document.querySelector(".res-hero.photo .hero-photo img")); await page.waitForTimeout(500);
    expect(await axeAll(page), "yev").toEqual([]);
    await page.getByRole("button", { name: "Start Your Expansion" }).click(); expect(await axeAll(page), "confirmation").toEqual([]);
  });
}
test("keyboard: a question screen is fully operable by keyboard and the focus ring is visible", async ({ page, request }, info) => {
  test.skip(info.project.name !== "desktop-1440");
  await page.setViewportSize({ width: 390, height: 800 });
  await open(page, await seed(request, journeyNortica("es"), "decision")); await page.waitForTimeout(600);
  const seen: string[] = [];
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press("Tab");
    const f = await page.evaluate(() => { const e = document.activeElement as HTMLElement | null; if (!e || e === document.body) return null; const cs = getComputedStyle(e); const r = e.getBoundingClientRect();
      return { name: (e.getAttribute("aria-label") || e.textContent || e.tagName).trim().slice(0, 30), outline: cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 2, shadow: cs.boxShadow !== "none", visible: r.width > 0 && r.height > 0 }; });
    if (f) { seen.push(f.name); expect(f.visible && (f.outline || f.shadow), `focus indicator on "${f.name}"`).toBeTruthy(); }
  }
  expect(seen.some((n) => n === UI.next.es)).toBeTruthy();                                // Continuar is reachable by Tab
  await touchTargetsOk(page);
});
