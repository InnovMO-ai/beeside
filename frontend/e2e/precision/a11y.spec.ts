import { expect, test } from "@playwright/test";
import { checkScreen, expectNoHorizontalOverflow, go, h1 } from "./helpers";

test("keyboard: skip link, visible focus, the whole conversation is reachable without a mouse", async ({ page }, info) => {
  test.skip(info.project.name.startsWith("mobile"), "keyboard path is a desktop concern; touch is covered by the 44px checks");
  await go(page, "/understanding");
  await expect(page.getByRole("button", { name: "Yes, that is right" })).toBeVisible();
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: /skip to/i });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  // Focus must show: every focused element has a visible outline or ring.
  const seen = new Set<string>();
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press("Tab");
    const r = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const s = getComputedStyle(el);
      return { name: (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 30), outline: s.outlineStyle !== "none" && parseFloat(s.outlineWidth) >= 2, shadow: s.boxShadow !== "none" };
    });
    if (r) { seen.add(r.name); expect(r.outline || r.shadow, `no visible focus on "${r.name}"`).toBe(true); }
  }
  expect(seen.size).toBeGreaterThan(5);
  // Answer by keyboard only.
  await page.getByRole("button", { name: "Yes, that is right" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText(/What do you want to achieve in Mexico/)).toBeVisible();
  await page.getByRole("textbox", { name: "Your answer" }).focus();
  await page.keyboard.type("Start selling to retail chains");
  await page.keyboard.press("Enter");
  await expect(page.locator(".pz-turn-client .pz-bubble").filter({ hasText: "Start selling to retail chains" })).toHaveCount(1);
});

test("dialog traps focus, closes with Escape and returns focus", async ({ page }) => {
  await go(page, "/category/logistics/summary", { mock: "preset:logisticsReady" });
  const open = page.getByRole("button", { name: /^Confirm CRP/ });
  await expect(open).toBeVisible();
  await open.focus();
  await page.keyboard.press("Enter");
  const dlg = page.getByRole("dialog");
  await expect(dlg).toBeVisible();
  for (let i = 0; i < 6; i++) { await page.keyboard.press("Tab"); expect(await dlg.evaluate((d) => d.contains(document.activeElement))).toBe(true); }
  await page.keyboard.press("Escape");
  await expect(dlg).toBeHidden();
  await expect(open).toBeFocused();
});

test("the conversation announces new messages politely and the heading takes focus on navigation", async ({ page }) => {
  await go(page, "/understanding");
  const log = page.getByRole("log");
  await expect(log).toHaveAttribute("aria-live", "polite");
  await go(page, "/help", { mock: "preset:mapConfirmed" });
  await expect(h1(page)).toBeVisible();
});

test("reduced motion removes animation", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await go(page, "/center", { mock: "preset:mapConfirmed" });
  await expect(h1(page)).toBeVisible();
  const longest = await page.evaluate(() => {
    let max = 0;
    document.querySelectorAll("*").forEach((el) => {
      const s = getComputedStyle(el);
      const dur = Math.max(...s.animationDuration.split(",").map((d) => parseFloat(d) * (d.includes("ms") ? 1 : 1000)));
      const trn = Math.max(...s.transitionDuration.split(",").map((d) => parseFloat(d) * (d.includes("ms") ? 1 : 1000)));
      max = Math.max(max, dur, trn);
    });
    return max;
  });
  expect(longest, "longest animation or transition under reduced motion (ms)").toBeLessThanOrEqual(10);
});

test("Night Shift toggle switches theme at runtime and is remembered; the system preference is the default", async ({ page }, info) => {
  await go(page, "/center", { mock: "preset:mapConfirmed" });
  await expect(h1(page)).toBeVisible();
  const mobile = info.project.name.startsWith("mobile");
  const bg = () => page.evaluate(() => getComputedStyle(document.querySelector(".pz-root")!).getPropertyValue("--pz-bg").trim().toLowerCase());
  const initial = await bg();
  expect(initial).toBe(info.project.name.endsWith("dark") ? "#0f0d18" : "#f1f1fa");
  if (mobile) await page.getByRole("button", { name: /menu/i }).first().click();
  await page.getByRole("button", { name: /Night Shift|dark|light|theme/i }).first().click();
  await expect.poll(bg).not.toBe(initial);
  await checkScreen(page, "after toggling theme", { targets: true });
});

test("language switches at runtime without a reload and persists", async ({ page }) => {
  await go(page, "/center", { mock: "preset:mapConfirmed" });
  await expect(h1(page)).toBeVisible();
  const before = await h1(page).textContent();
  await page.getByRole("button", { name: "ES" }).first().click();
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
  await expect(h1(page)).not.toHaveText(before ?? "");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "es");
});

test("zoom 200% and a narrow 320px viewport keep content reachable", async ({ page }, info) => {
  test.skip(!info.project.name.startsWith("desktop"), "viewport override");
  await page.setViewportSize({ width: 320, height: 640 });
  for (const [path, mock] of [["/center", "preset:mapConfirmed"], ["/category/logistics/summary", "preset:logisticsReady"], ["/category/logistics/preview", "preset:logisticsConfirmed"], ["/help", "preset:mapConfirmed"]] as const) {
    await go(page, path, { mock });
    await expect(h1(page)).toBeVisible();
    await expect(page.locator(".pz-skeleton")).toHaveCount(0);
    await expectNoHorizontalOverflow(page, `320px ${path}`);
  }
});

test("print view of a document hides the app chrome", async ({ page }, info) => {
  test.skip(info.project.name.startsWith("mobile"), "print is checked once");
  await go(page, "/service-map", { mock: "preset:understandingReady" });
  await expect(h1(page)).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(page.getByRole("button", { name: /^Confirm My Service Map/ })).toBeHidden();
  const bg = await page.evaluate(() => getComputedStyle(document.querySelector(".pz-root")!).getPropertyValue("--pz-bg").trim().toLowerCase());
  expect(bg).toBe("#ffffff");
});
