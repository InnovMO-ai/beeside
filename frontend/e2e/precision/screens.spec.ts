import { expect, test } from "@playwright/test";
import fs from "node:fs";
import { checkScreen, expectCleanCopy, go, h1, SHOTS } from "./helpers";

/**
 * Every main screen and system state, in English and Spanish, in whichever project (viewport and colour scheme) is running.
 * Each is checked (axe serious/critical, no horizontal overflow, 44px targets, no raw errors or forbidden terms) and photographed to
 * /tmp/precision-shots/<viewport>-<scheme>-<locale>/<screen>.png for the visual review.
 */
const SCREENS: { name: string; path: string; mock?: string; ready: RegExp | null; full?: boolean }[] = [
  { name: "cover", path: "", ready: null },
  { name: "center-first-visit", path: "/center", ready: null },
  { name: "understanding", path: "/understanding", ready: null },
  { name: "center-map-ready", path: "/center", mock: "preset:understandingReady", ready: null },
  { name: "service-map", path: "/service-map", mock: "preset:understandingReady", ready: null, full: true },
  { name: "center-categories", path: "/center", mock: "preset:mapConfirmed", ready: null },
  { name: "category", path: "/category/logistics", mock: "preset:logisticsReady", ready: null },
  { name: "crp", path: "/category/logistics/summary", mock: "preset:logisticsReady", ready: null, full: true },
  { name: "preview", path: "/category/logistics/preview", mock: "preset:logisticsConfirmed", ready: null, full: true },
  { name: "sent", path: "/category/logistics/sent", mock: "preset:sent,sherpa,ohmode:enter", ready: null },
  { name: "center-sent", path: "/center", mock: "preset:sent,ohmode:enter,sherpa", ready: null },
  { name: "help", path: "/help", mock: "preset:mapConfirmed", ready: null },
  { name: "add-service", path: "/add-service", mock: "preset:mapConfirmed", ready: null },
  { name: "read-only", path: "/center", mock: "preset:mapConfirmed,access:read_only", ready: null },
  { name: "revoked", path: "/center", mock: "access:revoked", ready: null },
  { name: "not-found", path: "/nope", mock: "preset:mapConfirmed", ready: null },
];

const dirOf = (project: string, locale: string) => {
  const [vp, scheme] = project.split("-");
  return `${SHOTS}/${vp}-${scheme}-${locale}`;
};

for (const locale of ["en", "es"] as const) {
  test.describe(`screens (${locale})`, () => {
    for (const s of SCREENS) {
      test(`${s.name}`, async ({ page }, info) => {
        await go(page, s.path, { mock: s.mock, locale });
        await expect(h1(page)).toBeVisible();
        await expect(page.locator(".pz-skeleton, [aria-busy='true']:not(button)")).toHaveCount(0, { timeout: 10000 });
        await expect(h1(page)).not.toHaveText(/…$/);
        await page.waitForTimeout(250); // entrance animations
        await expect(page.locator("html")).toHaveAttribute("lang", locale);
        const dir = dirOf(info.project.name, locale);
        fs.mkdirSync(dir, { recursive: true });
        await page.screenshot({ path: `${dir}/${s.name}.png`, fullPage: !!s.full });
        await checkScreen(page, `${s.name} (${locale})`);
      });
    }

    test("link pages: missing and invalid", async ({ page }, info) => {
      const dir = dirOf(info.project.name, locale);
      fs.mkdirSync(dir, { recursive: true });
      await page.addInitScript((l) => localStorage.setItem("beeside.precision.locale", l), locale);
      await page.goto("/precision/center");
      await expect(h1(page)).toBeVisible();
      await page.screenshot({ path: `${dir}/link-missing.png` });
      await checkScreen(page, `link missing (${locale})`);
      await page.goto("/precision/center?code=expired&mock=latency:0");
      await expect(h1(page)).toHaveText(locale === "en" ? /can't be used/ : /no se puede usar/);
      await page.screenshot({ path: `${dir}/link-invalid.png` });
      await checkScreen(page, `link invalid (${locale})`);
      await expectCleanCopy(page, "link invalid");
    });

    test("confirm dialogs and the mobile menu", async ({ page }, info) => {
      const dir = dirOf(info.project.name, locale);
      fs.mkdirSync(dir, { recursive: true });
      await go(page, "/category/logistics/summary", { mock: "preset:logisticsReady", locale });
      await expect(h1(page)).toBeVisible();
      await page.getByRole("button", { name: /^(Confirm CRP|Confirmar CRP)/ }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.screenshot({ path: `${dir}/dialog-confirm-crp.png` });
      await checkScreen(page, `confirm crp dialog (${locale})`);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toBeHidden();
      if (info.project.name.startsWith("mobile")) {
        await go(page, "/center", { mock: "preset:mapConfirmed", locale });
        await page.getByRole("button", { name: /menu|menú/i }).first().click();
        await expect(page.getByRole("dialog")).toBeVisible();
        await page.screenshot({ path: `${dir}/mobile-menu.png` });
        await checkScreen(page, `mobile menu (${locale})`);
      }
    });
  });
}
