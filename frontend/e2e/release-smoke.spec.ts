import { expect, test, type Page } from "@playwright/test";
import { journeyA, journeyB, journeyNortica } from "@beeside/fa-public-engine/testing";
import type { Answers } from "@beeside/fa-public-engine";
import { UI } from "../src/fa4/copy/ui";
import { noHorizontalOverflow, open, seed } from "./helpers";

/**
 * Release smoke (runs against the local production-built stack; point baseURL / E2E_BASIC_AUTH at staging to run it there):
 * destination-aware next step (one / many / open), no-premium scenario, delivered lock for both delivery paths, naming, legal links, canvas, brand lines.
 */
const BAD_NAME = /First Assessment|FIRST ASSESSMENT|(^|[^A-Za-z0-9_/-])FA4?([^A-Za-z0-9_/-]|$)/;
const result = async (page: Page, request: Parameters<typeof seed>[0], a: Answers) => {
  await open(page, await seed(request, a, "extra"));
  await page.getByRole("button", { name: new RegExp(`^(${UI.next[a.locale]}|${UI.seeResult[a.locale]})$`) }).click();
  await page.getByTestId("result-screen").waitFor();
};
const openDest = (): Answers => { const a = journeyNortica("es"); a.destinations = { list: [], open: true, sameInAll: true }; a.components = a.components.map((c) => ({ ...c, destinations: [] })); return a; };

for (const loc of ["es", "en"] as const) {
  test(`one defined destination → «${loc === "es" ? "Concretar tu expansión en México" : "Define your expansion in Mexico"}»; canvas, brand line, CTA, naming (${loc})`, async ({ page, request }, info) => {
    test.skip(info.project.name !== "desktop-1440", "run once");
    await result(page, request, journeyNortica(loc));
    await expect(page.getByRole("heading", { level: 2, name: loc === "es" ? "Concretar tu expansión en México" : "Define your expansion in Mexico" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start Your Expansion" })).toBeVisible();
    await expect(page.getByTestId("beeside-value-section")).toContainText(loc === "es" ? "Piensa en grande." : "Think bigger.");
    await expect(page.getByTestId("value-comparison")).toBeVisible();
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(246, 242, 239)");
    expect(await page.locator("body").innerText()).not.toMatch(BAD_NAME);
    expect(await page.locator("body").innerText()).not.toMatch(/Expande tu negocio\. No tu carga|Not your workload|radar|ola de activaci|activation wave/i);
    await expect(page.getByText(loc === "es" ? "La información que nos compartiste no se comparte con proveedores en esta etapa." : "The information you shared with us is not shared with providers at this stage.")).toBeVisible();
    await noHorizontalOverflow(page);
  });
}
test("several destinations → target-markets title", async ({ page, request }, info) => {
  test.skip(info.project.name !== "desktop-1440", "run once");
  await result(page, request, journeyB("es", "unknown"));
  await expect(page.getByRole("heading", { level: 2, name: "Concretar tu expansión en tus mercados objetivo" })).toBeVisible();
});
test("open / undefined destination → generic title", async ({ page, request }, info) => {
  test.skip(info.project.name !== "desktop-1440", "run once");
  await result(page, request, openDest());
  const h = page.getByRole("heading", { level: 2, name: /Concretar tu expansión|Define your expansion/ });
  if (await h.count()) await expect(h).toHaveText("Concretar tu expansión");
  else await expect(page.getByTestId("premium-continuation")).toBeVisible();     // no Premium value for an undefined market: no CTA, no title (D-050)
});
test("no-premium scenario: no CTA, understanding is the deliverable, email option remains", async ({ page, request }, info) => {
  test.skip(info.project.name !== "desktop-1440", "run once");
  const a = journeyA("es"); a.destinations = { list: [{ iso: "JP" }], open: false, sameInAll: true }; a.components = [{ ...a.components[0]!, destinations: ["JP"] }];
  await result(page, request, a);
  await expect(page.getByRole("button", { name: "Start Your Expansion" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: UI.emailResult.es })).toBeVisible();
});
test("legal links: Terms / Privacy / Help are the canonical pages and open in a new tab", async ({ page, request }, info) => {
  test.skip(info.project.name !== "desktop-1440", "run once");
  await result(page, request, journeyNortica("es"));
  const hrefs = await page.locator("a[href^='http']").evaluateAll((as) => as.map((a) => [a.textContent?.trim(), (a as HTMLAnchorElement).href, a.getAttribute("target"), a.getAttribute("rel")]));
  const by = (re: RegExp) => hrefs.find((h) => re.test(String(h[0])));
  expect(by(/Términos/)?.[1]).toBe("https://beeside.you/termsandconditions"); expect(by(/Privacidad/)?.[1]).toBe("https://www.beeside.you/privacy");
  expect(hrefs.some((h) => h[1] === "https://www.beeside.you/helpcenter")).toBeTruthy();
  for (const h of hrefs) { expect(h[2]).toBe("_blank"); expect(String(h[3])).toMatch(/noopener/); }
});

test("Start Your Expansion delivers once, locks editing, survives reload; «Corregir algo» is gone", async ({ page, request }, info) => {
  test.skip(info.project.name !== "desktop-1440", "run once");
  const a = journeyNortica("es"); const token = await seed(request, a, "extra");
  await open(page, token);
  await page.getByRole("button", { name: new RegExp(`^(${UI.next.es}|${UI.seeResult.es})$`) }).click(); await page.getByTestId("result-screen").waitFor();
  await expect(page.getByRole("button", { name: UI.fixSomething.es })).toBeVisible();                 // preview: editable
  expect((await request.get("/api/fa4/session/result", { headers: { "X-Fa4-Session": token } })).status()).toBe(404);   // …and nothing delivered yet
  await page.getByRole("button", { name: "Start Your Expansion" }).click(); await page.getByRole("button", { name: UI.confirmYes.es }).click();
  await expect(page.getByText(/tu beeside Sherpa revisará/i)).toBeVisible();
  await expect(page.getByRole("button", { name: UI.fixSomething.es })).toHaveCount(0);
  const sealed = await request.get("/api/fa4/session/result", { headers: { "X-Fa4-Session": token } }); expect(sealed.status()).toBe(200); expect((await sealed.json()).delivered).toBe(true);
  expect((await request.put("/api/fa4/session", { headers: { "X-Fa4-Session": token }, data: { answers: a, step: "decision" } })).status()).toBe(409);
  expect((await request.post("/api/fa4/session/result", { headers: { "X-Fa4-Session": token }, data: {} })).status()).toBe(409);
  await page.reload(); await page.getByTestId("result-screen").waitFor(); await expect(page.getByRole("button", { name: UI.fixSomething.es })).toHaveCount(0);
  await expect(page.getByText(UI.deliveredNote.es)).toBeVisible();
});
test("email-result delivers once and locks editing as well", async ({ page, request }, info) => {
  test.skip(info.project.name !== "desktop-1440", "run once");
  const a = journeyNortica("es"); a.identity.email = `smoke.${Date.now()}@example.test`; const token = await seed(request, a, "extra");
  await open(page, token);
  await page.getByRole("button", { name: new RegExp(`^(${UI.next.es}|${UI.seeResult.es})$`) }).click(); await page.getByTestId("result-screen").waitFor();
  await page.getByRole("button", { name: UI.emailResult.es }).click();
  await expect(page.getByText(/Te enviamos tu Your Expansion View a/)).toBeVisible();
  await expect(page.getByRole("button", { name: UI.fixSomething.es })).toHaveCount(0);
  expect((await request.put("/api/fa4/session", { headers: { "X-Fa4-Session": token }, data: { answers: a, step: "decision" } })).status()).toBe(409);
});
