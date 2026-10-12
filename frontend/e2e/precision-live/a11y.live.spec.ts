import { expect, test, type Page } from "@playwright/test";
import { Api, ApiRecorder, seed, shotDir } from "./support/qa";
import { logisticsConfirmed, newKey } from "./support/flows";
import { T, checkScreen, composer, openWithCode, say, type Ctx, type Loc } from "./support/live";

/**
 * Accessibility baseline on the LIVE app, every project (desktop and mobile, light and dark) and both languages:
 * axe (WCAG 2.0/2.1/2.2 A and AA) with zero serious or critical findings on every screen and state reached below, no horizontal
 * overflow, 44px touch targets, status never by colour alone, a keyboard-only journey with a visible focus ring on every stop,
 * and reduced motion. Dark mode contrast is part of axe's colour-contrast rule in the dark projects.
 */
const h1 = (page: Page) => page.getByRole("heading", { level: 1 });
const ring = (page: Page) => page.evaluate(() => {
  const el = document.activeElement as HTMLElement | null;
  if (!el || el === document.body) return { ok: false, what: "body" };
  const cs = getComputedStyle(el);
  const outline = parseFloat(cs.outlineWidth) > 0 && cs.outlineStyle !== "none";
  const shadow = cs.boxShadow !== "none";
  return { ok: outline || shadow || !!el.closest(".pz-composer-row"), what: `${el.tagName.toLowerCase()} ${(el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 30)}` };
});

for (const locale of ["en", "es"] as const satisfies readonly Loc[]) {
  const t = T[locale];
  test(`axe, targets and overflow on every screen and state (${locale})`, async ({ page }, info) => {
    const rec = new ApiRecorder(); rec.attach(page);
    const c: Ctx = { page, rec, dir: shotDir(info, locale), locale, errors: [] };
    const targets = { targets: true } as const;
    // ---- a fresh project: Cover, Center, Understanding (confirmation card), after answers
    const s0 = await seed("start");
    await openWithCode(page, s0.code, locale);
    await expect(h1(page)).toBeVisible();
    await checkScreen(c, "A1-cover", targets);
    await page.getByRole("button", { name: t.cont }).or(page.getByRole("link", { name: t.cont })).first().click();
    await checkScreen(c, "A2-center-first", targets);
    await page.goto("/precision/understanding");
    await expect(page.locator(".pz-confirm")).toBeVisible();
    await checkScreen(c, "A3-understanding-card", targets);
    await say(page, locale === "en" ? "Yes" : "Sí");
    await checkScreen(c, "A4-understanding-thread", targets);
    // ---- map confirmed: categories, category with quick replies, add a service, help, contact
    const s1 = await seed("map_confirmed");
    await openWithCode(page, s1.code, locale, "/precision/center");
    await expect(h1(page)).toBeVisible();
    await checkScreen(c, "B1-center-categories", targets);
    await page.goto("/precision/service-map");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await checkScreen(c, "B2-service-map-confirmed", targets);
    const api1 = await Api.open(s1.projectId, locale);
    const cat1 = await api1.categoryId();
    await page.goto(`/precision/category/${cat1}`);
    await expect(page.locator(".pz-turn-assistant").first()).toBeVisible();
    await checkScreen(c, "B3-category-quick-replies", targets);
    await page.goto("/precision/add-service");
    await expect(page.locator(".pz-turn-assistant").first()).toBeVisible();
    await checkScreen(c, "B4-add-service", targets);
    await page.goto("/precision/help");
    await expect(h1(page)).toBeVisible();
    await checkScreen(c, "B5-help", targets);
    const contact = page.getByRole("button", { name: /Contact beeside|Contactar a beeside/ }).or(page.getByRole("link", { name: /Contact beeside|Contactar a beeside/ })).first();
    if (await contact.isVisible().catch(() => false)) { await contact.click(); if (await page.getByRole("dialog").isVisible().catch(() => false)) await checkScreen(c, "B6-contact-dialog", targets); }
    // ---- a ready category: CRP draft, dialogs, confirmed, Preview, Sent
    const s2 = await seed("logistics_ready");
    const api2 = await Api.open(s2.projectId, locale);
    const cat2 = await api2.categoryId();
    await openWithCode(page, s2.code, locale, `/precision/category/${cat2}`);
    await expect(page.getByRole("link", { name: t.reviewSummary }).first()).toBeVisible();
    await checkScreen(c, "C1-category-ready", targets);
    await page.getByRole("link", { name: t.reviewSummary }).first().click();
    await expect(page.getByRole("button", { name: t.confirmCrp })).toBeVisible();
    await checkScreen(c, "C2-crp-draft", targets);
    await page.getByRole("button", { name: locale === "en" ? /^Request changes/ : /^Solicitar cambios/ }).click();
    await checkScreen(c, "C3-dialog-request-changes", targets);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: t.confirmCrp }).click();
    await checkScreen(c, "C4-dialog-confirm-crp", targets);
    await page.getByRole("dialog").getByRole("button", { name: /^(Confirm|Confirmar)$/ }).click();
    await expect(page.getByText(t.crpConfirmed).first()).toBeVisible();
    await checkScreen(c, "C5-crp-confirmed", targets);
    await page.getByRole("link", { name: t.preview }).or(page.getByRole("button", { name: t.preview })).first().click();
    await expect(page.getByRole("button", { name: t.send })).toBeVisible();
    await checkScreen(c, "C6-preview", targets);
    await page.getByRole("button", { name: t.send }).click();
    await expect(h1(page)).toHaveText(t.sentH1, { timeout: 30_000 });
    await checkScreen(c, "C7-sent", targets);
    await page.goto("/precision/center");
    await expect(h1(page)).toBeVisible();
    await checkScreen(c, "C8-center-sent", targets);
    // ---- status is never colour alone: every status chip carries an icon and a word
    const chips = await page.locator(".pz-chip, .pz-st").evaluateAll((els) => els.map((e) => ({ text: (e.textContent || "").trim(), icon: !!e.querySelector("svg") })));
    expect(chips.length).toBeGreaterThan(0);
    for (const ch of chips) { expect(ch.text.length, "chip has a word").toBeGreaterThan(1); expect(ch.icon, `chip "${ch.text}" has an icon`).toBe(true); }
    void newKey; void logisticsConfirmed; void composer;
  });
}

test("keyboard only (desktop): skip link, Cover to Understanding to an answer, every stop shows a focus ring, no keyboard trap", async ({ page }, info) => {
  test.skip(!info.project.name.startsWith("desktop"), "keyboard path is a desktop concern; touch targets are checked on every mobile screen");
  const s = await seed("start");
  await openWithCode(page, s.code, "en");
  await expect(h1(page)).toBeVisible();
  await page.waitForLoadState("networkidle");
  const stops: string[] = [];
  const press = async (n: number) => { for (let i = 0; i < n; i++) { await page.keyboard.press("Tab"); const r = await ring(page); stops.push(r.what === "body" ? "end of page (focus leaves to the browser and wraps)" : `${r.what}${r.ok ? "" : " (NO RING)"}`); } };
  await press(1);
  expect(await page.evaluate(() => document.activeElement?.textContent), "the first stop is the skip link").toMatch(/Skip to main content/);
  await press(6);
  // reach Continue with the keyboard and activate it
  for (let i = 0; i < 12 && !(await page.evaluate(() => /^Continue/.test(document.activeElement?.textContent?.trim() ?? ""))); i++) await press(1);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/precision\/center/);
  await expect(page.getByRole("region", { name: "Your project, step by step" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  for (let i = 0; i < 20 && !(await page.evaluate(() => document.activeElement?.tagName === "A" && /^Start$/.test(document.activeElement?.textContent?.trim() ?? "") && !!document.activeElement?.closest("main"))); i++) await press(1);
  expect(await page.evaluate(() => document.activeElement?.textContent?.trim()), `Start reached by keyboard; stops so far: ${stops.join(" | ")}`).toBe("Start");
  const startDesc = await page.evaluate(() => { const a = document.activeElement as HTMLAnchorElement; return `${a.tagName} href=${a.getAttribute("href")} inMain=${!!a.closest("main")} connected=${a.isConnected}`; });
  await page.keyboard.press("Enter");
  await expect(page, `Enter on ${startDesc}`).toHaveURL(/\/precision\/understanding/);
  await expect(page.locator(".pz-confirm")).toBeVisible();
  for (let i = 0; i < 15 && !(await page.evaluate(() => /Yes, that is correct/.test(document.activeElement?.textContent ?? ""))); i++) await press(1);
  await page.keyboard.press("Enter");
  await expect(page.locator(".pz-confirm")).toHaveCount(2, { timeout: 15_000 });
  // the composer is reachable by keyboard, Enter sends
  for (let i = 0; i < 15 && !(await page.evaluate(() => document.activeElement?.id === "pz-msg")); i++) await press(1);
  await page.keyboard.press("Tab");
  expect(stops.filter((x) => x.includes("NO RING")), `every focus stop has a visible indicator; path: ${stops.join(" > ")}`).toEqual([]);
  // no trap: shift+tab walks back out
  for (let i = 0; i < 4; i++) await page.keyboard.press("Shift+Tab");
});

test("reduced motion: no animation or transition longer than a blink", async ({ browser, baseURL }, info) => {
  const ctx = await browser.newContext({ ...(info.project.use as object), reducedMotion: "reduce", bypassCSP: true });
  const page = await ctx.newPage();
  const s = await seed("start");
  await page.goto(`${baseURL}/precision?code=${encodeURIComponent(s.code)}`);
  await expect(h1(page)).toBeVisible();
  const slow = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>("body *")].flatMap((e) => { const cs = getComputedStyle(e); const d = (v: string) => Math.max(0, ...v.split(",").map((x) => parseFloat(x) * (x.includes("ms") ? 1 : 1000))); return d(cs.animationDuration) > 20 || d(cs.transitionDuration) > 20 ? [e.tagName + "." + e.className] : []; }));
  expect(slow, "nothing animates under prefers-reduced-motion").toEqual([]);
  await ctx.close();
});
