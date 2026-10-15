import { expect, test } from "@playwright/test";
import fs from "node:fs";
import { journeyNortica } from "@beeside/fa-public-engine/testing";
import { UI } from "../src/fa4/copy/ui";
import { axeViolations, noHorizontalOverflow, open, seed } from "./helpers";

/** Discovery v1.0 — YEV Hero + Value of Continuing at every approved breakpoint: no overflow, photo decoded and undistorted, canvas = warm paper, white functional surfaces stay white. */
const OUT = process.env.E2E_EVIDENCE_DIR ?? "";
for (const [w, h] of [[375, 812], [768, 1024], [1024, 768], [1200, 800], [1440, 900], [1680, 1000], [1920, 1080]] as const) {
  test(`YEV hero and continue-zone at ${w}px`, async ({ page, request }, info) => {
    test.skip(info.project.name !== "desktop-1440", "viewport is set inside the test; run once");
    await page.setViewportSize({ width: w, height: h });
    await open(page, await seed(request, journeyNortica("es"), "extra"));
    await page.getByRole("button", { name: new RegExp(`^(${UI.next.es}|${UI.seeResult.es})$`) }).click();
    await expect(page.getByTestId("result-screen")).toBeVisible();
    await page.waitForFunction(() => { const i = document.querySelector<HTMLImageElement>(".res-hero.photo .hero-photo img"); return !!i && i.complete && i.naturalWidth > 0; });
    await noHorizontalOverflow(page);
    const m = await page.evaluate(() => {
      const img = document.querySelector<HTMLImageElement>(".res-hero.photo .hero-photo img");
      const r = img?.getBoundingClientRect(); const bg = getComputedStyle(document.body).backgroundColor;
      const card = document.querySelector<HTMLElement>(".vc-card"); const field = getComputedStyle(card ?? document.body).backgroundColor;
      const hero = document.querySelector(".res-hero.photo")!.getBoundingClientRect(); const cover = !!r && r.left <= hero.left + 1 && r.top <= hero.top + 1 && r.right >= hero.right - 1 && r.bottom >= hero.bottom - 1;
      const scale = img && r ? Math.max(r.width / img.naturalWidth, r.height / img.naturalHeight) : 0; const ratioErr = img && r ? Math.abs(r.width / r.height - img.naturalWidth / img.naturalHeight) / (img.naturalWidth / img.naturalHeight) : 1;
      return { cover, scale, ratioErr, hasImg: !!img, natural: img ? [img.naturalWidth, img.naturalHeight] : null, shown: r ? [Math.round(r.width), Math.round(r.height)] : null, fit: img ? getComputedStyle(img).objectFit : null, src: img?.currentSrc.split("/").pop(), bg, card: field };
    });
    expect(m.hasImg, "photographic hero present").toBeTruthy(); expect(m.natural![0]).toBeGreaterThan(0);
    expect(m.fit, "cropped by object-fit (never stretched or zoomed)").toBe("cover");
    if (w >= 900) expect(m.cover, "photo fully covers the Hero box").toBeTruthy();
    expect(m.natural![0], "decoded source is the real asset").toBeGreaterThanOrEqual(w <= 767 ? 1000 : 2000);
    expect(m.scale, "never enlarged beyond its pixels at 1× (no pixelation)").toBeLessThanOrEqual(w <= 767 ? 1.0 : 1.0);
    expect(m.bg).toBe("rgb(246, 242, 239)"); expect(m.card).toBe("rgb(255, 255, 255)");      // #F6F2EF canvas · white comparison card
    expect(await axeViolations(page)).toEqual([]);
    if (OUT) { fs.mkdirSync(OUT, { recursive: true }); await page.screenshot({ path: `${OUT}/yev-hero-${w}.png` });
      await page.locator(".continue-zone").first().scrollIntoViewIfNeeded(); await page.screenshot({ path: `${OUT}/value-of-continuing-${w}.png`, fullPage: false }); }
    info.annotations.push({ type: "hero", description: `${w}px ${JSON.stringify(m)}` });
  });
}
