import { expect, test, type Page } from "@playwright/test";
import { Api, ApiRecorder, seed, shotDir, stats } from "./support/qa";
import { SCRIPT, T, checkScreen, clientBubbles, composer, confirmCard, lastAssistant, openWithCode, pick, say, scanApiBodies, scanForbidden, settled, type Ctx, type Loc } from "./support/live";

const h1 = (page: Page) => page.getByRole("heading", { level: 1 });
const pathEnds = (tail: string) => (u: URL) => u.pathname.replace(/\/+$/, "").endsWith(tail);

for (const locale of ["en", "es"] as const satisfies readonly Loc[]) {
  test(`happy path, real backend (${locale}): Cover to Center to Understanding to Service Map to Logistics to CRP to Preview to Send to Sent`, async ({ page }, info) => {
    const t = T[locale];
    const s = SCRIPT[locale];
    const rec = new ApiRecorder();
    rec.attach(page);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/favicon/.test(m.text())) errors.push(m.text()); });
    const c: Ctx = { page, rec, dir: shotDir(info, locale), locale, errors };
    const project = await seed("start");
    const api = await Api.open(project.projectId, locale);

    // ---- Cover (first entry)
    await openWithCode(page, project.code, locale);
    await expect(h1(page)).toHaveText(t.coverH1);
    expect(page.url(), "the one-time code leaves the address bar").not.toContain("code=");
    await checkScreen(c, "01-cover");

    // ---- Center, first visit
    await page.getByRole("button", { name: t.cont }).or(page.getByRole("link", { name: t.cont })).first().click();
    await expect(page).toHaveURL(pathEnds("/precision/center"));
    await expect(h1(page)).toBeVisible();
    await checkScreen(c, "02-center-first-visit");

    // ---- Understanding
    await page.getByRole("link", { name: /^(Start|Empezar)/ }).first().click();
    await expect(page).toHaveURL(pathEnds("/understanding"));
    await expect(page.locator(".pz-confirm")).toBeVisible();
    await expect(page.locator(".pz-turn-assistant").first()).toContainText(locale === "en" ? /uses artificial intelligence/ : /usa inteligencia artificial/);
    await checkScreen(c, "03-understanding-start", { allowSherpa: false });
    await confirmCard(page, s.yes); // objective
    await confirmCard(page, s.yes); // destination
    await checkScreen(c, "04-understanding-product");
    for (const u of s.understanding) await say(page, u);
    const toMap = page.getByRole("link", { name: t.mapCta }).first();
    await expect(toMap).toBeVisible();
    // no percentage anywhere in Understanding
    expect(await page.locator("main, body").first().innerText()).not.toMatch(/\d+\s?%/);
    await checkScreen(c, "05-understanding-ready");

    // ---- My Service Map
    await toMap.click();
    await expect(page).toHaveURL(pathEnds("/service-map"));
    await expect(page.getByRole("button", { name: t.confirmMap })).toBeVisible();
    await checkScreen(c, "06-service-map-draft");
    await page.getByRole("button", { name: t.confirmMap }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await checkScreen(c, "07-service-map-confirm-dialog");
    await dialog.getByRole("button", { name: /^(Confirm|Confirmar)$/ }).click();
    await expect(page.getByRole("status").filter({ hasText: t.mapConfirmed }).first()).toBeVisible();
    await checkScreen(c, "08-service-map-confirmed");

    // ---- Center (map confirmed)
    await page.getByRole("link", { name: locale === "en" ? /Precision Center|Go to Precision Center/ : /Precision Center/ }).first().click();
    await expect(page).toHaveURL(pathEnds("/precision/center"));
    await expect(page.getByRole("link", { name: /(Start|Empezar): (Logistics|Logística)/ })).toBeVisible();
    await checkScreen(c, "09-center-categories");

    // ---- Logistics conversation with process questions inserted mid-way (every canonical question)
    await page.getByRole("link", { name: /(Start|Empezar): (Logistics|Logística)/ }).click();
    await expect(page).toHaveURL(/\/precision\/category\//);
    await expect(page.locator(".pz-turn-assistant").first()).toBeVisible();
    await checkScreen(c, "10-category-start");
    const catId = await api.categoryId();
    const progressBefore = (await api.get(`/categories/${catId}`)).body.progress;
    const pending = (await api.get(`/categories/${catId}`)).body.thread.turns.at(-1).text as string;
    const question = (pending.match(/¿?[^?¿.!]*\?/g) ?? [pending]).pop()!.replace(/^¿/, "").trim();
    for (const [i, q] of s.processQ.entries()) {
      await say(page, q);
      const answer = await lastAssistant(page);
      expect(answer, `process answer ${i} resumes the pending question`).toContain(question.replace(/[?.]$/, "").slice(0, 25));
      expect((await api.get(`/categories/${catId}`)).body.progress, "process questions never move progress").toEqual(progressBefore);
      if (i === 3) await checkScreen(c, "11-category-process-question", { allowSherpa: true });
    }
    const half = Math.ceil(s.logistics.length / 2);
    for (const a of s.logistics.slice(0, half)) await say(page, a);
    await say(page, s.processQ[0]); // a process question in the middle of the lanes, again
    for (const a of s.logistics.slice(half)) await say(page, a);
    await checkScreen(c, "12-category-lanes");
    await pick(page, s.unknown);
    const toCrp = page.getByRole("link", { name: t.reviewSummary }).first();
    await expect(toCrp).toBeVisible();
    await checkScreen(c, "13-category-ready");

    // ---- CRP
    await toCrp.click();
    await expect(page).toHaveURL(pathEnds("/summary"));
    await expect(page.getByRole("button", { name: t.confirmCrp })).toBeVisible();
    await expect(page.getByText(t.pending).first()).toBeVisible();
    await checkScreen(c, "14-crp-review");
    await page.getByRole("button", { name: t.confirmCrp }).click();
    const crpDialog = page.getByRole("dialog");
    await expect(crpDialog).toBeVisible();
    await checkScreen(c, "15-crp-confirm-dialog");
    await crpDialog.getByRole("button", { name: /^(Confirm|Confirmar)$/ }).click();
    await expect(page.getByText(t.crpConfirmed).first()).toBeVisible();
    await checkScreen(c, "16-crp-confirmed");

    // ---- Preview, Send
    await page.getByRole("link", { name: t.preview }).or(page.getByRole("button", { name: t.preview })).first().click();
    await expect(page).toHaveURL(pathEnds("/preview"));
    await expect(page.getByRole("button", { name: t.send })).toBeVisible();
    await checkScreen(c, "17-preview");
    await page.getByRole("button", { name: t.send }).click();
    await expect(page).toHaveURL(pathEnds("/sent"), { timeout: 30_000 });
    await expect(h1(page)).toHaveText(t.sentH1);
    await checkScreen(c, "18-sent");
    const st = await stats(project.projectId);
    expect(st.deliveredKeys, "exactly one delivery").toBe(1);
    expect(st.deliveryByState.delivered).toBe(1);

    // ---- Center reflects it; Operation Hub pending-access, no link, no Sherpa
    await page.getByRole("link", { name: /Precision Center/ }).first().click();
    await expect(page).toHaveURL(pathEnds("/precision/center"));
    await expect(page.getByText(locale === "en" ? /^Sent$/ : /^Enviada$/).filter({ visible: true }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Go to Operation Hub|Ir a Operation Hub/ })).toHaveCount(0);
    await checkScreen(c, "19-center-sent");

    // ---- Help
    await page.getByRole("link", { name: /Help|Ayuda/ }).first().click();
    await checkScreen(c, "20-help");

    // ---- whole-journey scans
    expect(scanApiBodies(rec, { allowSherpa: true }), "forbidden terms in API answers").toEqual([]);
    expect(errors, "no console or page errors").toEqual([]);
    void clientBubbles; void composer; void settled; void scanForbidden;
  });
}
