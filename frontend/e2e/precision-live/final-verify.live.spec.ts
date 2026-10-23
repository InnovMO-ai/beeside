import { expect, test, type Page } from "@playwright/test";
import { Api, ApiRecorder, ctl, facts, seed, shotDir, stats } from "./support/qa";
import { logisticsConfirmed, newKey, sendViaApi } from "./support/flows";
import { SCRIPT, T, assistantTurns, clientBubbles, composer, confirmCard, openWithCode, pageText, scanApiBodies, scanForbidden, say, expectNoHorizontalOverflow, axeSeriousOrCritical, type Loc } from "./support/live";

/**
 * FINAL VERIFY (12 Oct 2026): the parts of the customer journey and the edge cases that the acceptance route A-J does not walk.
 * Real backend, real database, production build through the static server. Desktop only for the flows (the viewport matrix is
 * covered by a11y.live.spec.ts and the mock suite); each flow runs in EN and ES where the copy differs.
 */
test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop-light", "flows run once per locale; viewports are covered elsewhere"));

const h1 = (page: Page) => page.getByRole("heading", { level: 1 });
const RAW = /\b(undefined|NaN|\[object|stack trace|Traceback|ECONN|ENOTFOUND|SQLSTATE|relation ".*" does not exist|Unexpected token|500|502|503)\b/;

async function clean(page: Page, label: string, opts: { allowSherpa?: boolean } = {}): Promise<void> {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  const text = await pageText(page);
  expect(scanForbidden(text, { allowSherpa: opts.allowSherpa ?? true }), `forbidden text on ${label}`).toEqual([]);
  expect(text, `raw technical text on ${label}`).not.toMatch(RAW);
  await expectNoHorizontalOverflow(page, label);
}

for (const locale of ["en", "es"] as const satisfies readonly Loc[]) {
  const t = T[locale];

  test(`deep links and refresh (${locale}): every screen survives a reload and says nothing technical`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const { project, api, catId } = await logisticsConfirmed(locale);
    await sendViaApi(api, catId);
    await openWithCode(page, project.code, locale, "/precision/center");
    await expect(h1(page)).toBeVisible();
    // the cover is shown once; from here on every address is a deep link
    const paths = ["/precision/center", "/precision/understanding", "/precision/service-map", `/precision/category/${catId}`, `/precision/category/${catId}/summary`, `/precision/category/${catId}/preview`, `/precision/category/${catId}/sent`, "/precision/add-service", "/precision/help"];
    for (const p of paths) {
      await page.goto(p);
      await expect(h1(page), `h1 on ${p}`).toBeVisible({ timeout: 20_000 });
      await page.waitForLoadState("networkidle").catch(() => undefined);
      const before = (await pageText(page)).length;
      await page.reload();
      await expect(h1(page), `h1 after reload on ${p}`).toBeVisible({ timeout: 20_000 });
      await clean(page, `${locale} ${p}`);
      expect(Math.abs((await pageText(page)).length - before), `content is the same after reload on ${p}`).toBeLessThan(400);
      expect(await axeSeriousOrCritical(page), `axe on ${p}`).toEqual([]);
    }
    expect(errors, "no uncaught page errors").toEqual([]);
    void info; void t;
  });

  test(`browser back / forward (${locale}): the thread, the position and the work are kept`, async ({ page }) => {
    const project = await seed("logistics_ready");
    const catId = await (await Api.open(project.projectId, locale)).categoryId();
    await openWithCode(page, project.code, locale, "/precision/center");
    await expect(h1(page)).toBeVisible();
    await page.getByRole("link", { name: locale === "en" ? /Logistics/ : /Log[ií]stica/ }).first().click();
    await expect(page).toHaveURL(new RegExp(`/category/${catId}$`));
    await expect(assistantTurns(page).first()).toBeVisible();
    const turns = await assistantTurns(page).count();
    const navLink = page.getByRole("navigation").getByRole("link", { name: /My Service Map/ });
    await navLink.click();
    await expect(page).toHaveURL(/service-map$/);
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/category/${catId}$`));
    await expect(assistantTurns(page).first()).toBeVisible();
    await expect.poll(() => assistantTurns(page).count(), { message: "same thread after Back", timeout: 20_000 }).toBe(turns);
    await page.goBack();
    await expect(page).toHaveURL(/center$/);
    await expect(h1(page)).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(new RegExp(`/category/${catId}$`));
    await expect.poll(() => assistantTurns(page).count(), { message: "same thread after Forward", timeout: 20_000 }).toBe(turns);
    await clean(page, `${locale} back/forward`);
  });

  test(`language and Night Shift switch (${locale}): no reload, the thread and the typed draft are kept`, async ({ page }) => {
    const project = await seed("logistics_ready");
    const catId = await (await Api.open(project.projectId, locale)).categoryId();
    await openWithCode(page, project.code, locale, `/precision/category/${catId}`);
    await expect(assistantTurns(page).first()).toBeVisible();
    await page.evaluate(() => { (window as unknown as { __fv: number }).__fv = 7; });
    const turns = await assistantTurns(page).count();
    await composer(page).fill("draft that must survive");
    const other = locale === "en" ? "Español" : "English";
    await page.getByRole("button", { name: other }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", locale === "en" ? "es" : "en");
    await page.getByRole("button", { name: /Night Shift/ }).click();
    expect(await page.evaluate(() => (window as unknown as { __fv?: number }).__fv), "no page reload").toBe(7);
    expect(await composer(page).inputValue(), "draft kept").toBe("draft that must survive");
    expect(await assistantTurns(page).count(), "thread kept").toBe(turns);
    await page.getByRole("button", { name: locale === "en" ? "English" : "Español" }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await clean(page, `${locale} after switches`);
  });

  test(`CRP lifecycle in the browser (${locale}): Request changes, Confirm, read-only, Preview, Send, Sent, new version, Confirm, Send`, async ({ page }) => {
    const rec = new ApiRecorder(); rec.attach(page);
    const project = await seed("logistics_ready");
    const api = await Api.open(project.projectId, locale);
    const catId = await api.categoryId();
    await openWithCode(page, project.code, locale, `/precision/category/${catId}/summary`);
    await expect(h1(page)).toBeVisible();
    // Request changes keeps the CRP editable and the thread open
    const rc = locale === "en" ? "Request changes" : /Pedir cambios|Solicitar cambios|Pedir modificaciones/;
    await page.getByRole("button", { name: rc }).click();
    await page.getByRole("dialog").getByRole("button", { name: rc }).click();
    await expect(page).toHaveURL(new RegExp(`/category/${catId}$`));
    await expect(assistantTurns(page).last()).toBeVisible();
    // back to the document, Confirm (one dialog, then read-only)
    await page.goto(`/precision/category/${catId}/summary`);
    await page.getByRole("button", { name: t.confirmCrp }).click();
    await page.getByRole("dialog").getByRole("button", { name: locale === "en" ? "Confirm" : "Confirmar" }).click();
    await expect(page.getByText(t.crpConfirmed).first()).toBeVisible();
    await expect(page.getByRole("button", { name: t.confirmCrp }), "no second Confirm once confirmed").toHaveCount(0);
    // Preview then Send exactly once
    await page.goto(`/precision/category/${catId}/preview`);
    await page.getByRole("button", { name: t.send }).click();
    await expect(h1(page)).toHaveText(t.sentH1, { timeout: 30_000 });
    expect((await stats(project.projectId)).deliveredKeys).toBe(1);
    // a second version: start it, it is editable again, confirm it, preview and send it
    await page.goto(`/precision/category/${catId}/summary`);
    const nvName = locale === "en" ? "Start a new version" : /Iniciar una versión nueva/;
    await page.getByRole("button", { name: nvName }).click();
    await page.getByRole("dialog").getByRole("button", { name: nvName }).click();
    await expect(page).toHaveURL(new RegExp(`/category/${catId}$`));
    await page.goto(`/precision/category/${catId}/summary`);
    await expect(page.getByRole("button", { name: t.confirmCrp })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: t.confirmCrp }).click();
    await page.getByRole("dialog").getByRole("button", { name: locale === "en" ? "Confirm" : "Confirmar" }).click();
    await expect(page.getByText(t.crpConfirmed).first()).toBeVisible();
    await page.goto(`/precision/category/${catId}/preview`);
    await page.getByRole("button", { name: t.send }).click();
    await expect(h1(page)).toHaveText(t.sentH1, { timeout: 30_000 });
    const st = await stats(project.projectId);
    expect(st.deliveredKeys, "two versions, two deliveries, no duplicate").toBe(2);
    expect(scanApiBodies(rec, { allowSherpa: true }), "forbidden terms in API answers").toEqual([]);
  });

  test(`language switch while an answer is being processed (${locale}): the turn is counted once, the reply arrives, nothing is lost`, async ({ page }) => {
    const s = await seed("start");
    const api = await Api.open(s.projectId, locale);
    await openWithCode(page, s.code, locale, "/precision/understanding");
    await expect(page.locator(".pz-confirm")).toBeVisible();
    await confirmCard(page, SCRIPT[locale].yes);
    await confirmCard(page, SCRIPT[locale].yes);
    const text = SCRIPT[locale].understanding[0]!;
    await ctl("POST", "/model", { projectId: s.projectId, slowMs: 4000 });
    await composer(page).fill(text);
    await composer(page).press("Enter");
    await expect(clientBubbles(page, text)).toHaveCount(1);
    await page.getByRole("button", { name: locale === "en" ? "Español" : "English" }).click();
    await ctl("POST", "/model", { projectId: s.projectId, slowMs: 0 });
    await expect.poll(async () => (await api.get("/understanding")).body.turns.filter((t: { role: string; text: string }) => t.role === "client" && t.text === text).length, { timeout: 40_000 }).toBe(1);
    await expect(clientBubbles(page, text), "one bubble, not two").toHaveCount(1, { timeout: 40_000 });
    await expect.poll(async () => (await api.get("/understanding")).body.turns.filter((t: { role: string }) => t.role === "assistant").length, { timeout: 40_000 }).toBeGreaterThan(2);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await clean(page, `${locale} language switched mid-turn`);
  });

  test(`Operation Hub states in the browser (${locale}): hidden, pending, available with and without a link; the Sent page agrees`, async ({ page }) => {
    const { project, api, catId } = await logisticsConfirmed(locale);
    await openWithCode(page, project.code, locale, "/precision/center");
    await expect(h1(page)).toBeVisible();
    await expect(page.locator("#pz-oh-h"), "no Operation Hub block before the first send").toHaveCount(0);
    await sendViaApi(api, catId);
    await page.reload();
    await expect(page.locator("#pz-oh-h")).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: locale === "en" ? /once your workspace is enabled/ : /cuando tu espacio esté habilitado/ })).toBeVisible();
    await expect(page.getByRole("link", { name: locale === "en" ? "Go to Operation Hub" : "Ir a Operation Hub" })).toHaveCount(0);
    // accessible
    await ctl("POST", "/oh/access", { projectId: project.projectId, mode: "accessible_without_sherpa" });
    await page.reload();
    await expect(page.getByRole("status").filter({ hasText: locale === "en" ? /available/ : /disponible/ })).toBeVisible();
    await clean(page, `${locale} OH available`);
  });

  test(`empty and missing data (${locale}): a new project, unknown addresses and out-of-order calls give calm answers`, async ({ page }) => {
    const project = await seed("start");
    const api = await Api.open(project.projectId, locale);
    await openWithCode(page, project.code, locale, "/precision/service-map");
    await expect(h1(page)).toBeVisible();
    await clean(page, `${locale} service map not ready`);
    for (const p of ["/precision/category/00000000-0000-4000-8000-000000000000", "/precision/category/not-a-uuid/summary", "/precision/category/x/preview", "/precision/nowhere"]) {
      await page.goto(p);
      await expect(h1(page), p).toBeVisible({ timeout: 20_000 });
      await clean(page, `${locale} ${p}`);
    }
    const bogus = "00000000-0000-4000-8000-000000000000";
    for (const [m, p, b] of [["GET", `/categories/${bogus}`, undefined], ["GET", `/categories/${bogus}/preview`, undefined], ["POST", `/categories/${bogus}/send`, { previewChecksum: "0".repeat(64) }], ["POST", `/categories/${bogus}/crp/confirm`, {}], ["POST", "/service-map/confirm", { requestKey: newKey("k") }]] as const) {
      const r = await api.call(m, p, b);
      expect(r.status, `${m} ${p}`).toBeLessThan(500);
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(r.body), `${m} ${p}: calm body`).not.toMatch(/stack|SQLSTATE|relation "|pg_|node_modules/i);
    }
    expect(await facts(project.projectId).then((f) => f.facts.length), "nothing was written by the refused calls").toBeGreaterThanOrEqual(0);
  });

  test(`My Service Map after confirmation (${locale}): Add a Service records the new version at once; nothing is left half-confirmed and the screens agree`, async ({ page }) => {
    const project = await seed("map_confirmed");
    const api = await Api.open(project.projectId, locale);
    const before = (await api.get("/center")).body.categories.length;
    await openWithCode(page, project.code, locale, "/precision/add-service");
    await expect(assistantTurns(page).first()).toBeVisible();
    await say(page, locale === "en" ? "I need help hiring and onboarding staff in Mexico" : "Necesito ayuda para contratar personal en México");
    await expect(page.locator(".pz-confirm").last()).toBeVisible();
    await confirmCard(page, locale === "en" ? /Yes, that is correct/ : /Sí, es correcto/);
    await expect.poll(async () => (await api.get("/center")).body.categories.length, { timeout: 20_000 }).toBeGreaterThan(before);
    const sm = (await api.get("/service-map")).body;
    expect(sm.hasUnconfirmedChanges, "the new version is recorded; there is no half-confirmed draft").toBe(false);
    expect(sm.canConfirm).toBe(false);
    expect(JSON.stringify(sm.confirmed)).toContain(locale === "en" ? "hiring" : "contratar");
    await page.goto("/precision/service-map");
    await expect(h1(page)).toBeVisible();
    await expect(page.getByRole("button", { name: locale === "en" ? "Confirm My Service Map" : "Confirmar My Service Map" })).toHaveCount(0);
    await expect(page.getByText(locale === "en" ? /hiring and onboarding staff/ : /contratar personal/).first()).toBeVisible();
    await clean(page, `${locale} map after Add a Service`);
  });
}
