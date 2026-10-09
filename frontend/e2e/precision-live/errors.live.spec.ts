import { expect, test, type Page } from "@playwright/test";
import { Api, ApiRecorder, ctl, facts, seed, shotDir, stats } from "./support/qa";
import { SA_ANSWERS, advisoryConfirmed, logisticsConfirmed, newKey, sendViaApi, turn } from "./support/flows";
import { SCRIPT, T, navTo, checkScreen, clientBubbles, composer, confirmCard, openWithCode, pageText, scanApiBodies, scanForbidden, say, settled, assistantTurns, type Ctx, type Loc } from "./support/live";

/**
 * The error experience (PO mandate section 22), against the real backend. Every case asserts: no lost work, no duplicate business effect,
 * no technical text on screen, and a clear way to recover. Failures are injected per project through the QA server's control port
 * (provider wrappers), never through a product branch.
 */
const RUN = new Set(["desktop-light", "mobile-dark"]);
test.beforeEach(({}, info) => test.skip(!RUN.has(info.project.name), "error experience runs in desktop-light and mobile-dark"));

const RAW = /(UNAUTHENTICATED|TEMPORARILY_UNAVAILABLE|PREVIEW_STALE|ACTIVATION_PENDING|RATE_LIMITED|INVALID_INPUT|NOT_FOUND|Failed to fetch|NetworkError|TypeError|AbortError|ECONN|HTTP \d{3}|\b5\d\d\b|\bstack\b|ModelUnavailable|ai_unavailable)/;
async function noTechnicalText(page: Page, label: string): Promise<void> {
  const text = await pageText(page);
  expect(text, `technical text on ${label}`).not.toMatch(RAW);
  expect(scanForbidden(text), `forbidden text on ${label}`).toEqual([]);
}
const setup = async (page: Page, info: import("@playwright/test").TestInfo, locale: Loc): Promise<Ctx> => {
  const rec = new ApiRecorder(); rec.attach(page);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return { page, rec, dir: shotDir(info, locale), locale, errors };
};
const T2 = { en: { aiTitle: /trouble continuing the conversation/, saved: /Your answer is saved/, retry: /^Try again/, offline: /Connection lost/, notSent: /Not sent yet/ }, es: { aiTitle: /problemas para continuar la conversación/, saved: /Tu respuesta está guardada/, retry: /^Intentar de nuevo/, offline: /Conexión perdida|Se perdió la conexión/, notSent: /Aún no se envió|No se ha enviado/ } } as const;

async function toProductQuestion(page: Page, locale: Loc, code: string): Promise<void> {
  await openWithCode(page, code, locale, "/precision/understanding");
  await expect(page.locator(".pz-confirm")).toBeVisible();
  await confirmCard(page, SCRIPT[locale].yes);
  await confirmCard(page, SCRIPT[locale].yes);
}
const PRODUCT = { en: SCRIPT.en.understanding[0], es: SCRIPT.es.understanding[0] };

for (const locale of ["en", "es"] as const) {
  test(`AI unavailable (${locale}): the answer is kept, the explanation is calm, Try again reuses the same turn and creates no duplicate`, async ({ page }, info) => {
    const c = await setup(page, info, locale);
    const s = await seed("start");
    await toProductQuestion(page, locale, s.code);
    await ctl("POST", "/model", { projectId: s.projectId, fail: 100 });
    await composer(page).fill(PRODUCT[locale]);
    await composer(page).press("Enter");
    const alert = page.getByRole("alert").filter({ hasText: T2[locale].aiTitle });
    await expect(alert).toBeVisible({ timeout: 30_000 });
    await expect(alert).toContainText(T2[locale].saved);
    await expect(clientBubbles(page, PRODUCT[locale])).toHaveCount(1);
    await checkScreen(c, `E1-ai-unavailable`);
    await noTechnicalText(page, "ai unavailable");
    const api = await Api.open(s.projectId, locale);
    const th = (await api.get("/understanding")).body;
    expect(th.pendingTurn?.status, "the server remembers the saved turn").toBe("ai_unavailable");
    // still down: Try again keeps the same state, and does not duplicate the answer
    await alert.getByRole("button", { name: T2[locale].retry }).click();
    await expect(alert).toBeVisible({ timeout: 30_000 });
    await expect(clientBubbles(page, PRODUCT[locale])).toHaveCount(1);
    // back: Try again completes the very same turn
    await ctl("POST", "/model", { projectId: s.projectId, fail: 0 });
    const before = await assistantTurns(page).count();
    await alert.getByRole("button", { name: T2[locale].retry }).click();
    await expect(alert).toBeHidden({ timeout: 30_000 });
    await expect(assistantTurns(page)).not.toHaveCount(before);
    await expect(clientBubbles(page, PRODUCT[locale])).toHaveCount(1);
    const after = (await api.get("/understanding")).body;
    expect(after.turns.filter((t: { role: string; text: string }) => t.role === "client" && t.text === PRODUCT[locale]), "one client turn in the database").toHaveLength(1);
    expect(after.pendingTurn).toBeNull();
    const f = (await facts(s.projectId)).facts.filter((x) => x.field_key === "precision.pa_expansion_product_or_service");
    expect(f, "one fact for the product, no duplicate effect").toHaveLength(1);
    await noTechnicalText(page, "after recovery");
    expect(scanApiBodies(c.rec, { allowSherpa: true })).toEqual([]);
  });
}

test("waiting states and reload during processing: honest staged copy, resume through the saved turn, one answer, one effect", async ({ page }, info) => {
  const c = await setup(page, info, "en");
  const s = await seed("start");
  await toProductQuestion(page, "en", s.code);
  await ctl("POST", "/model", { projectId: s.projectId, slowMs: 15_000 });
  await composer(page).fill(PRODUCT.en);
  await composer(page).press("Enter");
  await expect(clientBubbles(page, PRODUCT.en)).toHaveCount(1);       // appears immediately
  const wait = page.locator(".pz-wait");
  await expect(wait).toBeVisible();
  const first = await wait.innerText();
  expect(first).not.toMatch(/%|seconds|segundos|\d+ s\b/);           // no percentages, no promised durations
  await expect.poll(async () => (await wait.innerText()).trim(), { timeout: 12_000, message: "the waiting copy moves through honest stages" }).not.toBe(first.trim());
  expect(await wait.innerText()).not.toMatch(/%|seconds|segundos|\d+ s\b/);
  await checkScreen(c, "E2-waiting", { idle: false });
  await page.reload();
  // the answer was saved: after the reload it is resumed under the same turn key and completes once
  await ctl("POST", "/model", { projectId: s.projectId, slowMs: 0 });
  await expect(assistantTurns(page).last()).toContainText(/company|entity|empresa/i, { timeout: 40_000 });
  await settled(page);
  await expect(clientBubbles(page, PRODUCT.en)).toHaveCount(1);
  const api = await Api.open(s.projectId);
  const th = (await api.get("/understanding")).body;
  expect(th.turns.filter((t: { role: string; text: string }) => t.role === "client" && t.text === PRODUCT.en)).toHaveLength(1);
  expect(th.pendingTurn).toBeNull();
  expect((await facts(s.projectId)).facts.filter((x) => x.field_key === "precision.pa_expansion_product_or_service")).toHaveLength(1);
  await noTechnicalText(page, "after reload");
});

test("a long wait says the answer is saved (more than 15 seconds), then completes", async ({ page }, info) => {
  test.setTimeout(120_000);
  const c = await setup(page, info, "en");
  const s = await seed("start");
  await toProductQuestion(page, "en", s.code);
  await ctl("POST", "/model", { projectId: s.projectId, slowMs: 9000 }); // two model calls per turn
  await composer(page).fill(PRODUCT.en);
  await composer(page).press("Enter");
  await expect(page.getByText(/Preparing the next question/).first()).toBeVisible({ timeout: 12_000 });
  await expect(page.getByText(/taking longer than usual\. Your answer is saved/)).toBeVisible({ timeout: 20_000 });
  await checkScreen(c, "E3-long-wait", { idle: false });
  await ctl("POST", "/model", { projectId: s.projectId, slowMs: 0 });
  await settled(page);
  await expect(clientBubbles(page, PRODUCT.en)).toHaveCount(1);
});

test("lost connection: the answer stays on screen as not sent yet, the app says so calmly, retries, and the answer is processed once", async ({ page, context }, info) => {
  const c = await setup(page, info, "en");
  const s = await seed("start");
  await toProductQuestion(page, "en", s.code);
  await context.setOffline(true);
  await composer(page).fill(PRODUCT.en);
  await composer(page).press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: T2.en.offline })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/Your answers are saved/).first()).toBeVisible();
  await expect(page.locator(".pz-turn-warn").first()).toBeVisible(); // the "not sent yet" marker (wording belongs to the copy)
  await expect(clientBubbles(page, PRODUCT.en)).toHaveCount(1);
  await checkScreen(c, "E4-offline");
  await noTechnicalText(page, "offline");
  await context.setOffline(false);
  await page.getByRole("button", { name: /Try now/ }).first().click();
  await expect(assistantTurns(page).last()).toContainText(/company|entity/i, { timeout: 30_000 });
  await expect(clientBubbles(page, PRODUCT.en)).toHaveCount(1);
  const api = await Api.open(s.projectId);
  expect((await api.get("/understanding")).body.turns.filter((t: { role: string; text: string }) => t.role === "client" && t.text === PRODUCT.en)).toHaveLength(1);
  await expect(page.getByRole("alert").filter({ hasText: T2.en.offline })).toHaveCount(0);
});

test("lost connection while a page loads: the shell stays and the app retries by itself when the connection is back", async ({ page, context }, info) => {
  const c = await setup(page, info, "en");
  const s = await seed("map_confirmed");
  await openWithCode(page, s.code, "en");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.getByRole("button", { name: T.en.cont }).or(page.getByRole("link", { name: T.en.cont })).first().click();
  await expect(page).toHaveURL(/\/precision\/center/);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await context.setOffline(true);
  await navTo(page, /^My Service Map$/);
  await expect(page.getByRole("alert").filter({ hasText: T2.en.offline })).toBeVisible({ timeout: 15_000 });
  await checkScreen(c, "E5-offline-load");
  await context.setOffline(false);
  await page.getByRole("button", { name: /Try now/ }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: /My Service Map/ })).toBeVisible({ timeout: 20_000 });
});

test("First Assessment context unavailable: the opening is not created without the inherited values; the client can retry and recovers it", async ({ page }, info) => {
  const c = await setup(page, info, "en");
  const s = await seed("start");
  await ctl("POST", "/fa", { projectId: s.projectId, always: true });
  await openWithCode(page, s.code, "en");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();          // Cover still opens (no destination to show)
  await checkScreen(c, "E6-fa-down-cover");
  await page.goto("/precision/understanding");
  await expect(page.getByText(/couldn't load this conversation|couldn't load this/i).first()).toBeVisible({ timeout: 20_000 });
  await checkScreen(c, "E6-fa-down-understanding");
  await noTechnicalText(page, "fa down");
  const api = await Api.open(s.projectId);
  expect(await ctl("GET", "/facts", { projectId: s.projectId })).toEqual({ facts: [] });   // nothing was written
  await ctl("POST", "/clear", { projectId: s.projectId });
  await page.getByRole("button", { name: /Try again/ }).click();
  await expect(page.locator(".pz-confirm")).toBeVisible({ timeout: 20_000 });    // the inherited objective is offered for confirmation
  await expect(page.locator(".pz-confirm")).toContainText(/Start selling our packaged food products/);
  void api;
});

test("entitlement READ_ONLY: everything can be reviewed, nothing can be changed, no payment language, and a write that arrives late is refused calmly", async ({ page }, info) => {
  const c = await setup(page, info, "en");
  const s = await seed("logistics_ready");
  await ctl("POST", "/entitlement", { projectId: s.projectId, mode: "READ_ONLY", readonlyUntil: new Date(Date.now() + 20 * 86400_000).toISOString() });
  await openWithCode(page, s.code, "en");
  await page.getByRole("button", { name: T.en.cont }).or(page.getByRole("link", { name: T.en.cont })).first().click();
  await expect(page.getByText(/You can review your information/).first()).toBeVisible();
  await checkScreen(c, "E7-read-only-center");
  const logistics = s.categories.find((x) => x.categoryKey === "logistics")!.categoryId;
  await page.goto(`/precision/category/${logistics}`);
  await expect(page.getByText(/read-only/i).first()).toBeVisible();
  await expect(composer(page)).toHaveCount(0);
  await checkScreen(c, "E7-read-only-category");
  await page.goto(`/precision/category/${logistics}/summary`);
  await expect(page.getByRole("button", { name: T.en.confirmCrp })).toHaveCount(0);
  await checkScreen(c, "E7-read-only-crp");
  const txt = await pageText(page);
  expect(txt, "no payment or checkout language").not.toMatch(/\b(payment|checkout|subscribe|billing|invoice|Stripe|pagar|pago)\b/i);
  // a write made by an older tab is refused with the friendly read-only copy, never a raw error
  const api = await Api.open(s.projectId);
  const r = await api.post(`/categories/${logistics}/turns`, { turnKey: newKey("t"), text: "Monthly" });
  expect(r.status).toBe(403);
  expect(r.body.error).toBe("PRECISION_READ_ONLY");
  expect(r.body.message).toMatch(/review your information|consultar tu información/);
  expect((await facts(s.projectId)).facts.length, "nothing was written").toBeGreaterThan(0);
});

test("entitlement changes while the page is open: the next write is refused, the screen switches to read-only, nothing breaks", async ({ page }, info) => {
  const c = await setup(page, info, "en");
  const s = await seed("start");
  await toProductQuestion(page, "en", s.code);
  await ctl("POST", "/entitlement", { projectId: s.projectId, mode: "READ_ONLY" });
  await composer(page).fill(PRODUCT.en);
  await composer(page).press("Enter");
  await expect(page.getByText(/read-only/i).first()).toBeVisible({ timeout: 20_000 });
  await noTechnicalText(page, "read only late");
  await checkScreen(c, "E8-read-only-late");
  expect((await facts(s.projectId)).facts.filter((x) => x.field_key === "precision.pa_expansion_product_or_service")).toHaveLength(0);
});

test("entitlement REVOKED: a calm access-ended page, no data", async ({ page }, info) => {
  const c = await setup(page, info, "en");
  const s = await seed("map_confirmed");
  await ctl("POST", "/entitlement", { projectId: s.projectId, mode: "REVOKED" });
  await openWithCode(page, s.code, "en");
  await expect(page.getByText(/access to Precision ended/i)).toBeVisible({ timeout: 20_000 });
  await checkScreen(c, "E9-revoked");
  expect(await pageText(page)).not.toMatch(/Northwind|Logistics|Mexico/);
  await noTechnicalText(page, "revoked");
});

test.describe("sending to Operation Hub", () => {
  const sendBtn = (page: Page) => page.getByRole("button", { name: T.en.send });
  const openPreview = async (page: Page, code: string, catId: string) => { await openWithCode(page, code, "en", `/precision/category/${catId}/preview`); await expect(sendBtn(page)).toBeEnabled({ timeout: 20_000 }); };

  test("outage: friendly failure, nothing lost, nothing marked Sent; Try again sends exactly once", async ({ page }, info) => {
    test.setTimeout(120_000);
    const c = await setup(page, info, "en");
    const { project, catId } = await logisticsConfirmed();
    await openPreview(page, project.code, catId);
    await ctl("POST", "/oh/fault", { projectId: project.projectId, kind: "unavailable", count: 3 });
    await sendBtn(page).click();
    const failed = page.getByRole("alert").filter({ hasText: /couldn't complete the send/i });
    await expect(failed).toBeVisible({ timeout: 40_000 });
    await expect(failed).toContainText(/nothing was lost/i);
    await expect(page).not.toHaveURL(/\/sent$/);
    await checkScreen(c, "E10-send-failed");
    await noTechnicalText(page, "send failed");
    let st = await stats(project.projectId);
    expect(st.deliveredKeys, "nothing delivered yet").toBe(0);
    // the Center never says Sent
    const api = await Api.open(project.projectId);
    const center = (await api.get("/center")).body;
    expect(center.categories.find((k: { id: string }) => k.id === catId).sendState).toBe("failed");
    expect(center.operationHub.state).toBe("hidden");
    await failed.getByRole("button", { name: /^Try again/ }).click();
    await expect(page).toHaveURL(/\/sent$/, { timeout: 40_000 });
    st = await stats(project.projectId);
    expect(st.deliveredKeys, "exactly one delivery after the retry").toBe(1);
    expect(st.deliveryByState.delivered).toBe(1);
    await checkScreen(c, "E10-sent-after-retry");
  });

  test("the platform stored it but the answer was lost: the read-back confirms it, Sent only after acceptance, one delivery", async ({ page }, info) => {
    const c = await setup(page, info, "en");
    const { project, catId } = await logisticsConfirmed();
    await openPreview(page, project.code, catId);
    await ctl("POST", "/oh/fault", { projectId: project.projectId, kind: "timeout_after_store", count: 1 });
    await sendBtn(page).click();
    await expect(page).toHaveURL(/\/sent$/, { timeout: 40_000 });
    const st = await stats(project.projectId);
    expect(st.deliveredKeys).toBe(1);
    expect(st.publishCalls, "never published a second time").toBe(1);
    await checkScreen(c, "E11-sent-after-timeout");
  });

  for (const kind of ["reject", "corrupt"] as const) {
    test(`platform refuses (${kind}): needs-attention message without Try again, survives a reload, never Sent`, async ({ page }, info) => {
      const c = await setup(page, info, "en");
      const { project, catId } = await logisticsConfirmed();
      await openPreview(page, project.code, catId);
      await ctl("POST", "/oh/fault", { projectId: project.projectId, kind, count: 1 });
      await sendBtn(page).click();
      const failed = page.getByRole("alert").filter({ hasText: /couldn't complete the send/i });
      await expect(failed).toBeVisible({ timeout: 40_000 });
      await expect(failed).toContainText(/needs to look at this/i);
      await expect(failed.getByRole("button", { name: /^Try again/ })).toHaveCount(0);
      await expect(failed.getByRole("button", { name: /Contact beeside/ })).toBeVisible();
      await checkScreen(c, `E12-${kind}`);
      await page.reload();
      const again = page.getByRole("alert").filter({ hasText: /couldn't complete the send/i });
      await expect(again).toBeVisible({ timeout: 20_000 });
      await expect(again).toContainText(/needs to look at this/i);
      await expect(again.getByRole("button", { name: /^Try again/ })).toHaveCount(0);
      expect((await stats(project.projectId)).deliveredKeys).toBe(0);
      await noTechnicalText(page, kind);
    });
  }

  test("stale preview: the pack changes after the preview was opened; Send is refused with an explanation, the preview is refreshed and sends once", async ({ page }, info) => {
    const c = await setup(page, info, "en");
    const { project, api, catId } = await logisticsConfirmed();
    const sa = await advisoryConfirmed(api, catId);
    await openPreview(page, project.code, sa);
    // in "another tab": start a new version, change an answer, confirm again
    expect((await api.post(`/categories/${sa}/crp/new-version`, {})).status).toBe(200);
    await turn(api, sa, "Whether to set up a local company next year");
    expect((await api.post(`/categories/${sa}/crp/confirm`, { requestKey: newKey("c") })).status).toBe(200);
    await sendBtn(page).click();
    const alert = page.getByRole("alert").filter({ hasText: /Something changed after you opened this preview/ });
    await expect(alert).toBeVisible({ timeout: 20_000 });
    await checkScreen(c, "E13-stale-preview");
    await noTechnicalText(page, "stale");
    expect((await stats(project.projectId)).deliveredKeys, "only the first category was delivered").toBe(1);
    await expect(sendBtn(page)).toBeEnabled();
    await sendBtn(page).click();
    await expect(page).toHaveURL(/\/sent$/, { timeout: 40_000 });
    expect((await stats(project.projectId)).deliveredKeys, "the refreshed preview was delivered once").toBe(2);
  });

  test("duplicate click: a double click and a burst of parallel requests produce exactly one delivery", async ({ page }, info) => {
    const c = await setup(page, info, "en");
    const { project, api, catId } = await logisticsConfirmed();
    await openPreview(page, project.code, catId);
    await ctl("POST", "/oh/slow", { projectId: project.projectId, ms: 800 });
    await sendBtn(page).dblclick();
    await expect(page).toHaveURL(/\/sent$/, { timeout: 40_000 });
    // a burst of retries of the same send (a client that lost the answer): the same result, never another delivery
    const pv = (await api.get(`/categories/${catId}/preview`)).body;
    const burst = await Promise.all(Array.from({ length: 6 }, () => api.post(`/categories/${catId}/send`, { previewChecksum: pv.previewChecksum })));
    expect(burst.every((r) => r.status === 200 || r.status === 409)).toBe(true);
    const st = await stats(project.projectId);
    expect(st.deliveredKeys).toBe(1);
    expect(st.deliveryByState.delivered).toBe(1);
    expect(st.publishCalls).toBe(1);
    await checkScreen(c, "E14-sent-once");
  });

  test("the first send failed: another category cannot be sent until it succeeds, with a clear way back", async ({ page }, info) => {
    test.setTimeout(150_000);
    const c = await setup(page, info, "en");
    const { project, api, catId } = await logisticsConfirmed();
    // first send fails for good (non-retryable)
    await ctl("POST", "/oh/fault", { projectId: project.projectId, kind: "reject", count: 1 });
    const pv = (await api.get(`/categories/${catId}/preview`)).body;
    const first = await api.post(`/categories/${catId}/send`, { previewChecksum: pv.previewChecksum });
    expect(first.body.state).toBe("failed");
    const sa = await api.categoryId(/advisory/i);
    for (const a of SA_ANSWERS) await turn(api, sa, a);
    expect((await api.post(`/categories/${sa}/crp/confirm`, { requestKey: newKey("c") })).status).toBe(200);
    await openPreview(page, project.code, sa).catch(() => undefined);
    await page.goto(`/precision/category/${sa}/preview`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const btn = sendBtn(page);
    if (await btn.isEnabled().catch(() => false)) {
      await btn.click();
      await expect(page.getByText(/first send is still pending/i)).toBeVisible({ timeout: 30_000 });
    } else {
      await expect(page.getByText(/can't be sent right now|first send/i).first()).toBeVisible();
    }
    await checkScreen(c, "E15-first-send-required");
    await noTechnicalText(page, "first send required");
    expect((await stats(project.projectId)).deliveredKeys).toBe(0);
  });
});

test.describe("link and session", () => {
  test("a used link, an unknown link and a missing link each show the same calm page; nothing technical, no hint of which", async ({ page, browser }, info) => {
    const c = await setup(page, info, "en");
    const s = await seed("start");
    await openWithCode(page, s.code, "en");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    // the same link again, in a clean context (no session)
    const ctx2 = await browser.newContext({ baseURL: `http://localhost:${process.env.PRECISION_LIVE_FRONTEND_PORT ?? 14181}`, bypassCSP: true });
    const p2 = await ctx2.newPage();
    await openWithCode(p2, s.code, "en");
    await expect(p2.getByText(/This link can't be used/)).toBeVisible({ timeout: 20_000 });
    const c2: Ctx = { ...c, page: p2 };
    await checkScreen(c2, "E16-link-used");
    await noTechnicalText(p2, "used link");
    const p3 = await ctx2.newPage();
    await openWithCode(p3, "A".repeat(43), "en");
    await expect(p3.getByText(/This link can't be used/)).toBeVisible({ timeout: 20_000 });
    const p4 = await ctx2.newPage();
    await p4.goto("/precision");
    await expect(p4.getByText(/Open Precision from your email/)).toBeVisible();
    await checkScreen({ ...c, page: p4 }, "E16-link-missing");
    await ctx2.close();
  });

  test("an expired link and a revoked session end on the same calm page", async ({ page, browser }, info) => {
    const c = await setup(page, info, "en");
    const short = await seed("start", { linkTtlMs: 1500 });
    await new Promise((r) => setTimeout(r, 2200));
    await openWithCode(page, short.code, "en");
    await expect(page.getByText(/This link can't be used/)).toBeVisible({ timeout: 20_000 });
    const s = await seed("map_confirmed");
    const p2 = await browser.newPage({ baseURL: `http://localhost:${process.env.PRECISION_LIVE_FRONTEND_PORT ?? 14181}`, bypassCSP: true });
    await openWithCode(p2, s.code, "en");
    await expect(p2.getByRole("heading", { level: 1 })).toBeVisible();
    await p2.getByRole("button", { name: T.en.cont }).or(p2.getByRole("link", { name: T.en.cont })).first().click();
    await expect(p2).toHaveURL(/\/precision\/center/);
    await ctl("POST", "/revoke-sessions", { projectId: s.projectId });
    await navTo(p2, /Precision Understanding/);
    await expect(p2.getByText(/This link can't be used/)).toBeVisible({ timeout: 20_000 });
    await checkScreen({ ...c, page: p2 }, "E17-session-revoked");
    await p2.close();
  });

  test("a session that expired asks for a new link instead of failing", async ({ page }, info) => {
    const c = await setup(page, info, "en");
    const s = await seed("map_confirmed");
    // The browser receives a genuine session that lives for a few seconds (same token lifecycle, expiry decided by the server).
    const short = await ctl<{ sessionToken: string; expiresAt: string }>("POST", "/short-session", { projectId: s.projectId, ttlMs: 6000 });
    await page.route("**/api/precision/session/exchange", (route) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(short) }));
    await openWithCode(page, s.code, "en");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.getByRole("button", { name: T.en.cont }).or(page.getByRole("link", { name: T.en.cont })).first().click();
    await expect(page).toHaveURL(/\/precision\/center/);
    await page.waitForTimeout(Math.max(0, new Date(short.expiresAt).getTime() - Date.now()) + 1500);
    await navTo(page, /Precision Understanding/);
    await expect(page.getByText(/This link can't be used/)).toBeVisible({ timeout: 20_000 });
    await checkScreen(c, "E18-session-expired");
  });
});

void say; void SCRIPT; void sendViaApi;
