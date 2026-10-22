import { expect, test, type Page } from "@playwright/test";
import { journeyNortica } from "@beeside/fa-public-engine/testing";
import { UI } from "../src/fa4/copy/ui";
import { axeViolations, noHorizontalOverflow, open, seed } from "./helpers";

/** DSC-40 (hero crops, heights, title) + verification B (destination card) at 375 / 768 / 1024 / 1440, ES and EN. */
const WIDTHS = [[375, 812], [768, 1024], [1024, 768], [1440, 900]] as const;
async function yev(page: Page, request: Parameters<typeof seed>[0], loc: "es" | "en") {
  await open(page, await seed(request, journeyNortica(loc), "extra"));
  await page.getByRole("button", { name: UI.seeResult[loc] }).click(); await expect(page.getByTestId("result-screen")).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(() => { const i = document.querySelector<HTMLImageElement>(".res-hero.photo .hero-photo img"); return !!i && i.complete && i.naturalWidth > 0; });
}
for (const loc of ["es", "en"] as const) for (const [w, h] of WIDTHS) {
  test(`DSC-40 · YEV hero (${loc}) at ${w}px: towers crop, approved heights, title, destination card fits`, async ({ page, request }, info) => {
    test.skip(info.project.name !== "desktop-1440", "the viewport is set inside the test; run once");
    await page.setViewportSize({ width: w, height: h }); await yev(page, request, loc);
    const m = await page.evaluate(() => {
      const img = document.querySelector<HTMLImageElement>(".res-hero.photo .hero-photo img")!; const h1 = document.querySelector<HTMLElement>(".res-hero.photo h1")!;
      const hero = document.querySelector<HTMLElement>(".res-hero.photo")!; const gl = document.querySelector<HTMLElement>(".res-hero.photo .glance")!;
      const cs = getComputedStyle(h1); const lh = parseFloat(cs.lineHeight); const r1 = h1.getBoundingClientRect(); const rg = gl.getBoundingClientRect();
      return { src: img.currentSrc, natural: [img.naturalWidth, img.naturalHeight], fit: getComputedStyle(img).objectFit, pos: getComputedStyle(img).objectPosition, heroH: hero.getBoundingClientRect().height,
        fs: parseFloat(cs.fontSize), lines: Math.round(r1.height / lh), h1Bottom: r1.bottom, h1Right: r1.right, glTop: rg.top, glLeft: rg.left, glRight: rg.right, vw: window.innerWidth };
    });
    expect(m.src).toMatch(/yev-hero-torres-(wide|mobile)/); expect(m.src).not.toMatch(/hero-architecture/);
    expect(w < 768 ? m.src.includes("mobile") : m.src.includes("wide")).toBe(true);
    expect(m.natural).toEqual(w < 768 ? [1100, 1000] : [2600, 1144]);
    expect(m.fit).toBe("cover"); expect(m.pos).toBe("50% 50%");
    if (w >= 1024) { expect(m.fs).toBeGreaterThanOrEqual(56); expect(m.fs).toBeLessThanOrEqual(80); }
    else if (w >= 768) expect(m.fs).toBe(50); else { expect(m.fs).toBe(32); }
    expect(m.lines, "title in two lines (natural wrap)").toBe(2);
    // verification B: the destination card still fits (inside the viewport, clear of the title text)
    expect(m.glLeft).toBeGreaterThanOrEqual(0); expect(m.glRight).toBeLessThanOrEqual(m.vw + 1); if (w >= 900) expect(m.glLeft, "side by side: the card never overlaps the title").toBeGreaterThanOrEqual(m.h1Right - 2); else expect(m.glTop, "stacked: the card starts below the title").toBeGreaterThanOrEqual(m.h1Bottom - 2);
    await noHorizontalOverflow(page); expect(await axeViolations(page)).toEqual([]);
    await page.screenshot({ path: `../docs/fa4/visual/verifications/dsc40-yev-${loc}-${w}.png` });
  });
}
