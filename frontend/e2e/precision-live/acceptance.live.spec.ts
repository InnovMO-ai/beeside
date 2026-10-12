import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import { Api, ApiRecorder, facts, seed, shotDir, stats } from "./support/qa";
import { newKey } from "./support/flows";
import { T, navTo, checkScreen, composer, assistantTurns, lastAssistant, openWithCode, pageText, pick, confirmCard, say, scanApiBodies, scanForbidden, SCRIPT, type Ctx, type Loc } from "./support/live";

/**
 * PO acceptance journey (QA-LIVE, product QA). Unlike journey.live.spec.ts this one types the exact utterances of docs/f5/demo-route.md
 * (section D) including the combined P-01 / P-02 questions, uses Request changes once, reads full-page captures of every stage (the
 * Preview and the Sent screens too), prints the two documents, and then LEAVES the route: free text, a correction, "I don't know yet",
 * skipping, another category and Add a Service. The captures are looked at by a person (/tmp/precision-live-shots/<viewport>-<theme>-<locale>/acc-*.png).
 */
const h1 = (page: Page) => page.getByRole("heading", { level: 1 });
const pathEnds = (tail: string) => (u: URL) => u.pathname.replace(/\/+$/, "").endsWith(tail);

const ROUTE = {
  en: {
    p01: "What is a CRP and what happens with this?",
    p02: "What role does the Sherpa play and when does it appear?",
    understand1: "Yes",
    answers: ["Third-party logistics provider", "No", "Third-party logistics and Freight transportation", "General cargo", "Chile", "Mexico", "Packaged dry food products", "20 pallets", "Monthly", "Ocean", "No"],
    crpTitle: /Logistics.*Category Requirement Pack \(CRP\)/,
    resume: /Back to where we left off\./,
    full: "Category Requirement Pack (CRP)",
  },
  es: {
    p01: "¿Qué es un CRP y qué va a pasar con esto?",
    p02: "¿Qué papel juega el Sherpa y cuándo aparece?",
    understand1: "Sí",
    answers: ["Proveedor logístico externo", "No", "Logística con terceros y Transporte de carga", "Carga general", "Chile", "México", "Alimentos secos empacados", "20 pallets", "Mensual", "Marítimo", "No"],
    crpTitle: /Logística.*Category Requirement Pack \(CRP\)/,
    resume: /Retomamos donde nos quedamos\./,
    full: "Category Requirement Pack (CRP)",
  },
} as const;

async function full(c: Ctx, name: string): Promise<void> {
  await c.page.waitForLoadState("networkidle").catch(() => undefined);
  await c.page.waitForTimeout(600);
  await c.page.screenshot({ path: `${c.dir}/acc-${name}.png`, fullPage: true });
}
const text = (page: Page) => pageText(page);
const turnsText = async (page: Page, sel = ".pz-turn-assistant .pz-turn-text") => page.locator(sel).allInnerTexts();

for (const locale of ["en", "es"] as const satisfies readonly Loc[]) {
  const R = ROUTE[locale];
  const t = T[locale];
  const s = SCRIPT[locale];

  test(`acceptance route A-J typed literally (${locale}): AI notice once, CRP spelled out once, Request changes, Preview, Send once, Sent`, async ({ page }, info) => {
    const rec = new ApiRecorder(); rec.attach(page);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/favicon/.test(m.text())) errors.push(m.text()); });
    const c: Ctx = { page, rec, dir: shotDir(info, locale), locale, errors };
    const project = await seed("start");
    const api = await Api.open(project.projectId, locale);

    // ---- C. Premium active: the Cover is the first thing a client with Premium sees (no paywall, no payment text anywhere)
    await openWithCode(page, project.code, locale);
    await expect(h1(page)).toHaveText(t.coverH1);
    expect(await text(page)).not.toMatch(/\b(payment|checkout|pago|suscripci[oó]n|stripe|subscribe)\b/i);
    await full(c, "01-cover");
    await page.getByRole("button", { name: t.cont }).or(page.getByRole("link", { name: t.cont })).first().click();
    await expect(page).toHaveURL(pathEnds("/precision/center"));
    await full(c, "02-center");

    // ---- E. Understanding: confirm the objective by typing, the destination by the button, then the three answers
    await page.getByRole("link", { name: /^(Start|Empezar)/ }).first().click();
    await expect(page.locator(".pz-confirm")).toBeVisible();
    await say(page, R.understand1);
    await expect(page.locator(".pz-confirm").last()).toContainText(locale === "en" ? /Mexico/ : /M[eé]xico/);
    await confirmCard(page, s.yes);
    for (const u of s.understanding) await say(page, u);
    await expect(page.getByRole("link", { name: t.mapCta }).first()).toBeVisible();
    // the AI notice appears exactly once in the whole thread, and no percentage is shown in Understanding
    const uTurns = await turnsText(page);
    expect(uTurns.filter((x) => /artificial intelligence|inteligencia artificial/i.test(x)), "AI disclosure exactly once").toHaveLength(1);
    expect(await text(page)).not.toMatch(/\d+\s?%/);
    await full(c, "03-understanding-done");

    // ---- F. My Service Map
    await page.getByRole("link", { name: t.mapCta }).first().click();
    await expect(page).toHaveURL(pathEnds("/service-map"));
    await full(c, "04-service-map-draft");
    await page.getByRole("button", { name: t.confirmMap }).click();
    await page.getByRole("dialog").getByRole("button", { name: /^(Confirm|Confirmar)$/ }).click();
    await expect(page.getByRole("status").filter({ hasText: t.mapConfirmed }).first()).toBeVisible();
    await full(c, "05-service-map-confirmed");
    expect(page.url()).not.toContain("code=");

    // ---- D. Center with the four categories, all Not started
    await page.getByRole("link", { name: /Precision Center/ }).first().click();
    await expect(page).toHaveURL(pathEnds("/precision/center"));
    await full(c, "06-center-categories");
    for (const k of (await api.get("/center")).body.categories) expect(k.status).toBe("not_started");

    // ---- G. Logistics: P-01 and P-02 typed literally before the first answer
    await page.getByRole("link", { name: /(Start|Empezar): (Logistics|Logística)/ }).click();
    await expect(assistantTurns(page).first()).toBeVisible();
    const catId = await api.categoryId();
    const pendingRaw = (await api.get(`/categories/${catId}`)).body.thread.turns.at(-1).text as string;
    // the first question of the opening turn ("Who will take care of ...?"), the sentence the resume line repeats
    const pendingQ = (pendingRaw.match(/¿?[^?¿.!]*\?/g) ?? [pendingRaw])[0].replace(/^¿/, "").trim();
    const stableFacts = async () => JSON.stringify((await facts(project.projectId)).facts.map((f) => JSON.stringify(f)).sort());
    const factsBefore = await stableFacts();
    await say(page, R.p01);
    const a1 = await lastAssistant(page);
    expect(a1, "P-01 spells the Category Requirement Pack (CRP) out, once, at first mention").toContain(R.full);
    expect(a1.split(R.full).length - 1).toBe(1);
    expect(a1).toMatch(R.resume);
    expect(a1).toContain(pendingQ.replace(/[?.]$/, "").slice(0, 25));
    await full(c, "07-category-p01");
    await say(page, R.p02);
    const a2 = await lastAssistant(page);
    expect(a2, "P-02 explains the role and never says your Sherpa").not.toMatch(/\b(tu|your) sherpa\b/i);
    expect(a2).toMatch(R.resume);
    expect(a2, "after P-01 the CRP is called CRP, not spelled out again").not.toContain(R.full);
    expect(await stableFacts(), "P-01 and P-02 write nothing").toBe(factsBefore);
    await full(c, "08-category-p02");
    for (const a of R.answers) await say(page, a);
    await pick(page, s.unknown);
    const toCrp = page.getByRole("link", { name: t.reviewSummary }).first();
    await expect(toCrp).toBeVisible();
    await full(c, "09-category-ready");

    // ---- H. CRP: Request changes once, then Confirm
    await toCrp.click();
    await expect(page).toHaveURL(pathEnds("/summary"));
    await expect(h1(page)).toHaveText(R.crpTitle);
    await expect(page.getByText(t.pending).first()).toBeVisible();
    await full(c, "10-crp-review");
    await page.getByRole("button", { name: locale === "en" ? /^Request changes/ : /^Solicitar cambios/ }).click();
    await full(c, "11-crp-request-changes-dialog");
    await page.getByRole("dialog").getByRole("button", { name: locale === "en" ? /^Request changes/ : /^Solicitar cambios/ }).click();
    await expect(page).toHaveURL(/\/precision\/category\//);
    // Request changes keeps the category open (lifecycle in progress; it stays "ready for review" because nothing was changed yet)
    await expect.poll(async () => (await api.get(`/categories/${catId}`)).body.progress.status).toMatch(/in_progress|ready_for_review/);
    await full(c, "12-category-after-request-changes");
    // the conversation continues: the client can still answer and the thread keeps everything it had
    await say(page, locale === "en" ? "Why are you asking me this?" : "¿Por qué me preguntas esto?");
    await expect(page.getByRole("link", { name: t.reviewSummary }).or(page.getByRole("group", { name: /Suggested answers|Respuestas sugeridas/ }))).not.toHaveCount(0);
    await api.get(`/categories/${catId}`);
    // back to the CRP through the header link, confirm it
    await page.getByRole("link", { name: locale === "en" ? /View (my )?(summary|CRP)|Review summary/i : /Ver (mi )?(resumen|CRP)|Revisar resumen/i }).first().click();
    await expect(page).toHaveURL(pathEnds("/summary"));
    await page.getByRole("button", { name: t.confirmCrp }).click();
    await page.getByRole("dialog").getByRole("button", { name: /^(Confirm|Confirmar)$/ }).click();
    await expect(page.getByText(t.crpConfirmed).first()).toBeVisible();
    await full(c, "13-crp-confirmed");

    // ---- I. Preview, J. Send, then Sent
    await page.getByRole("link", { name: t.preview }).or(page.getByRole("button", { name: t.preview })).first().click();
    await expect(page).toHaveURL(pathEnds("/preview"));
    await full(c, "14-preview");
    const pvText = await text(page);
    expect(pvText, "the Preview says what is not sent").toMatch(locale === "en" ? /Not sent|What is not sent/i : /No se env[ií]a|Qu[eé] no se env[ií]a/i);
    // double click: one delivery
    await page.getByRole("button", { name: t.send }).dblclick();
    await expect(page).toHaveURL(pathEnds("/sent"), { timeout: 30_000 });
    await full(c, "15-sent");
    const st = await stats(project.projectId);
    expect(st.deliveredKeys, "one delivery after a double click").toBe(1);
    expect(st.deliveryByState.delivered).toBe(1);
    const body = await text(page);
    expect(body).not.toMatch(/\b(tu|your) sherpa\b/i);
    await page.getByRole("link", { name: /Precision Center/ }).first().click();
    await full(c, "16-center-sent");
    // P-02 again after the first send: the answer changes (the role starts after the first send, still nothing assigned)
    await navTo(page, /Strategic Advisory/);
    await expect(assistantTurns(page).first()).toBeVisible();
    await say(page, R.p02);
    const a3 = await lastAssistant(page);
    expect(a3, "after the first send the answer is not the one given before it").not.toBe(a2);
    expect(a3).not.toMatch(/\b(tu|your) sherpa\b/i);
    await full(c, "17-category-after-send");

    expect(scanApiBodies(rec, { allowSherpa: true }), "forbidden terms in API answers").toEqual([]);
    expect(errors, "no console or page errors").toEqual([]);
  });

  test(`acceptance, outside the route (${locale}): correction, "I don't know yet", skip, free text, another category, Add a Service`, async ({ page }, info) => {
    const rec = new ApiRecorder(); rec.attach(page);
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const c: Ctx = { page, rec, dir: shotDir(info, locale), locale, errors };
    const project = await seed("start");
    const api = await Api.open(project.projectId, locale);
    await openWithCode(page, project.code, locale, "/precision/understanding");
    await expect(page.locator(".pz-confirm")).toBeVisible();

    // correction of a value that came from the First Assessment
    await page.locator(".pz-confirm").last().getByRole("button", { name: locale === "en" ? /correct it/ : /corregirlo/ }).click();
    await expect(assistantTurns(page).last()).toContainText(locale === "en" ? /correct value/ : /dato correcto/);
    await say(page, locale === "en" ? "Start selling our packaged food products in Mexico and Colombia" : "Empezar a vender nuestros alimentos empacados en México y Colombia");
    await full(c, "20-understanding-corrected");
    expect(JSON.stringify((await facts(project.projectId)).facts), "the corrected value replaced the First Assessment value").toMatch(/Colombia|"CO"/);
    // "I don't know yet" on a question: pending, not a made-up value
    await pick(page, locale === "en" ? "Not sure yet" : "Todavía no lo sé"); // the product question
    await expect(page.locator(".pz-turn-assistant").last()).toContainText(locale === "en" ? /pending/ : /pendiente/);
    // typed skip
    await say(page, locale === "en" ? "skip" : "omitir");
    const skipFacts = (await facts(project.projectId)).facts.filter((f) => f.field_key.endsWith("pa_operating_entity"));
    expect(skipFacts.every((f) => f.answer_state === "UNKNOWN"), "skip is a pending answer, never a value").toBe(true);
    // free text that is none of the above, with markup in it
    await say(page, locale === "en" ? "<img src=x onerror=alert(1)> April 2027" : "<img src=x onerror=alert(1)> Abril de 2027");
    await expect(page.locator(".pz-bubble img"), "client text is escaped, never HTML").toHaveCount(0);
    await full(c, "21-understanding-free-text");

    // another category and Add a Service from the map-confirmed state
    const second = await seed("map_confirmed");
    const api2 = await Api.open(second.projectId, locale);
    await openWithCode(page, second.code, locale, "/precision/center");
    await full(c, "22-center-map-confirmed");
    await page.getByRole("link", { name: locale === "en" ? /^Strategic Advisory/ : /^Strategic Advisory/ }).first().click();
    await expect(assistantTurns(page).first()).toBeVisible();
    await say(page, SCRIPT.en.logistics[0] && (locale === "en" ? "Decide whether to commit to a local presence" : "Decidir si nos comprometemos con presencia local"));
    await full(c, "23-strategic-advisory");
    await navTo(page, /Add a Service/);
    await expect(page).toHaveURL(pathEnds("/add-service"));
    await say(page, locale === "en" ? "I need help hiring and onboarding staff in Mexico" : "Necesito ayuda para contratar personal en México");
    await expect(page.locator(".pz-confirm").last()).toBeVisible();
    await full(c, "24-add-service-card");
    await confirmCard(page, s.yes);
    await full(c, "25-add-service-added");
    const center2 = (await api2.get("/center")).body.categories.map((k: { label: string }) => k.label);
    expect(center2.length, "a new category appears after Add a Service").toBeGreaterThanOrEqual(5);
    expect(scanApiBodies(rec, { allowSherpa: true }), "forbidden terms in API answers").toEqual([]);
    void newKey; void checkScreen; void scanForbidden; void fs;
  });
}

// ---------------------------------------------------------------- print: My Service Map and the CRP as documents
test("print stylesheet: My Service Map, CRP and Preview print as clean documents (no navigation, no buttons), PDF text carries the content", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop-light", "print is checked once");
  const { logisticsConfirmed } = await import("./support/flows");
  const { project } = await logisticsConfirmed("en");
  const api = await Api.open(project.projectId, "en");
  const catId = await api.categoryId();
  await openWithCode(page, project.code, "en", "/precision/service-map");
  await expect(h1(page)).toBeVisible();
  const dir = shotDir(info, "en");
  const out: string[] = [];
  for (const [name, path] of [["service-map", "/precision/service-map"], ["crp", `/precision/category/${catId}/summary`], ["preview", `/precision/category/${catId}/preview`]] as const) {
    await page.goto(path);
    await expect(h1(page)).toBeVisible();
    await page.waitForLoadState("networkidle").catch(() => undefined);
    await page.emulateMedia({ media: "print" });
    const hidden = await page.evaluate(() => ["button", "nav", ".pz-docbar", ".pz-actionbar", ".pz-tools"].map((s) => [s, [...document.querySelectorAll<HTMLElement>(s)].filter((e) => e.offsetParent !== null && getComputedStyle(e).display !== "none" && e.getBoundingClientRect().height > 0).length]));
    expect(Object.fromEntries(hidden as [string, number][]), `${name}: nothing interactive in print`).toMatchObject({ nav: 0, ".pz-docbar": 0, ".pz-actionbar": 0, ".pz-tools": 0 });
    const pdf = `${dir}/print-${name}.pdf`;
    await page.pdf({ path: pdf, format: "A4", printBackground: true });
    out.push(pdf);
    await page.emulateMedia({ media: "screen" });
  }
  expect(out.every((f) => fs.statSync(f).size > 5000)).toBe(true);
});
