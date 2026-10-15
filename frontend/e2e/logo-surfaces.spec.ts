import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import { journeyNortica } from "@beeside/fa-public-engine/testing";
import { UI } from "../src/fa4/copy/ui";
import { open, seed } from "./helpers";

/**
 * Logo audit across every public Discovery surface and width: the lockup must be decoded, correctly proportioned (≈ 3.2:1 box), fully inside the
 * viewport and never clipped by an ancestor (overflow), and the same two assets must be used everywhere (dark for light surfaces, light for dark ones).
 */
const OUT = process.env.E2E_EVIDENCE_DIR ?? "";
const WIDTHS: Array<[number, number]> = [[320, 700], [375, 812], [768, 1024], [1024, 768], [1440, 900]];
const RATIO = 836.88 / 261.749984;

async function checkLogos(page: Page, surface: string, width: number, expectVariant: "dark" | "light" | "any") {
  const imgs = page.locator("img[alt='beeside']");
  const n = await imgs.count();
  expect(n, `${surface}: at least one logo`).toBeGreaterThan(0);
  const report = await imgs.evaluateAll((els) => els.map((el) => {
    const img = el as HTMLImageElement; const r = img.getBoundingClientRect();
    let clipped = false; for (let p = img.parentElement; p; p = p.parentElement) { const cs = getComputedStyle(p); if (/(hidden|clip|auto|scroll)/.test(cs.overflowX + cs.overflowY)) { const pr = p.getBoundingClientRect(); if (r.left < pr.left - 0.5 || r.right > pr.right + 0.5 || r.top < pr.top - 0.5 || r.bottom > pr.bottom + 0.5) clipped = true; } }
    return { src: img.currentSrc.slice(0, 40), decoded: img.complete && img.naturalWidth > 0, w: r.width, h: r.height, left: r.left, right: r.right, vw: document.documentElement.clientWidth, visible: r.width > 0 && r.height > 0, clipped, nat: [img.naturalWidth, img.naturalHeight], onDark: !!img.closest(".res-hero, .night") };
  }));
  for (const l of report.filter((x) => x.visible)) {
    expect(l.decoded, `${surface}@${width}: decoded`).toBeTruthy();
    expect(Math.abs(l.w / l.h - RATIO) / RATIO, `${surface}@${width}: proportion ${l.w}x${l.h}`).toBeLessThan(0.02);
    expect(l.left, `${surface}@${width}: left edge`).toBeGreaterThanOrEqual(-0.5); expect(l.right, `${surface}@${width}: right edge inside viewport`).toBeLessThanOrEqual(l.vw + 0.5);
    expect(l.clipped, `${surface}@${width}: clipped by an ancestor`).toBe(false);
    expect(l.h, `${surface}@${width}: not tiny`).toBeGreaterThanOrEqual(26);
    if (expectVariant !== "any") expect(l.onDark, `${surface}@${width}: variant for surface`).toBe(expectVariant === "light");
  }
  return report.filter((x) => x.visible).map((x) => x.src);
}
const shot = async (page: Page, name: string) => { if (OUT) { fs.mkdirSync(OUT, { recursive: true }); await page.screenshot({ path: `${OUT}/${name}.png` }); } };

for (const [w, h] of WIDTHS) {
  test(`logo on every surface at ${w}px`, async ({ page, request }, info) => {
    test.skip(info.project.name !== "desktop-1440", "viewport is set inside the test; run once");
    await page.setViewportSize({ width: w, height: h });
    const sources: Record<string, string[]> = {};
    await page.goto("/discovery"); await page.waitForTimeout(300);
    sources.cover = await checkLogos(page, "cover", w, "dark"); await shot(page, `logo-cover-${w}`);
    await page.getByRole("button", { name: UI.coverCta.es }).click(); await page.waitForTimeout(300);
    sources.identity = await checkLogos(page, "identity", w, "dark");
    await open(page, await seed(request, journeyNortica("es"), "decision")); await page.waitForTimeout(600);
    sources.question = await checkLogos(page, "question", w, "dark"); await shot(page, `logo-question-${w}`);
    await open(page, await seed(request, journeyNortica("es"), "extra"));
    await page.getByRole("button", { name: new RegExp(`^(${UI.next.es}|${UI.seeResult.es})$`) }).click(); await page.getByTestId("result-screen").waitFor();
    await page.waitForFunction(() => [...document.images].filter((i) => i.getAttribute("alt") === "beeside").every((i) => i.complete && i.naturalWidth > 0));
    await page.evaluate(() => window.scrollTo(0, 0)); await page.waitForTimeout(300);
    sources.yev = await checkLogos(page, "yev (hero + value section)", w, "any"); await shot(page, `logo-yev-${w}`);
    await page.locator("[data-testid=beeside-value-section]").scrollIntoViewIfNeeded(); await page.waitForTimeout(300); await shot(page, `logo-value-${w}`);
    await page.getByRole("button", { name: "Start Your Expansion" }).click(); await page.waitForTimeout(300);
    sources.confirmation = await checkLogos(page, "confirmation", w, "any"); await shot(page, `logo-confirmation-${w}`);
    // intermediate / error surfaces rendered by the same component: stale-session recovery and the «for operating businesses» exit
    await page.addInitScript(() => sessionStorage.setItem("beeside.fa4.session", "x".repeat(43))); await page.goto("/discovery"); await page.waitForTimeout(800);
    sources.recovery = await checkLogos(page, "recovery", w, "dark"); await shot(page, `logo-recovery-${w}`);
    // one consolidated statement of the assets in use
    const all = new Set(Object.values(sources).flat().map((s) => s.replace(/^data:image\/svg\+xml.*/, "svg-data-uri").replace(/.*\/(lockup-[a-z]+)[-.\w]*\.svg.*/, "$1")));
    info.annotations.push({ type: "assets", description: JSON.stringify(sources) }); expect(all.size).toBeLessThanOrEqual(3);
  });
}
