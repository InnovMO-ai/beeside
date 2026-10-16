import { expect, test } from "@playwright/test";
import { journeyA, journeyB, journeyNortica } from "@beeside/fa-public-engine/testing";
import { UI } from "../src/fa4/copy/ui";
import { axeViolations, noHorizontalOverflow, open, seed, touchTargetsOk } from "./helpers";

/** Final Design Delta: merged screens, multi-country, sticky action bar, header, compatibility of saved steps. */
const vp = (page: import("@playwright/test").Page) => page.viewportSize()!;
const desktop = (page: import("@playwright/test").Page) => vp(page).width >= 1024;

test("Multi-country: destinations + «same project?» is ONE screen; presence per country carries 3 questions; the clarity question only on the last", async ({ page }) => {
  await page.goto("/fa4");
  await page.getByRole("button", { name: UI.coverCta.es }).click();
  await page.getByLabel(UI.name.es).fill("Miguel"); await page.getByLabel(UI.company.es, { exact: true }).fill("InnOv"); await page.getByLabel(UI.email.es).fill("mo@innov.example");
  await page.getByRole("radio", { name: UI.deciderOpts.me.es }).check(); await page.getByLabel(UI.terms.es).check(); await page.getByLabel(UI.privacy.es).check();
  await page.getByRole("button", { name: UI.acceptContinue.es }).click();
  await page.getByRole("radio", { name: "Sí", exact: true }).check(); await page.getByLabel(UI.sector.es).fill("desarrollo de proyectos tecnológicos");
  await page.getByRole("radio", { name: "11–50" }).check();
  await page.getByPlaceholder(UI.searchCountry.es).fill("Méx"); await page.getByRole("button", { name: "México", exact: true }).click();
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  for (const [q, n] of [["Ind", "India"], ["Espa", "España"]]) { await page.getByPlaceholder(UI.searchCountry.es).fill(q!); await page.getByRole("button", { name: n!, exact: true }).click(); }
  // the merged block appears with 2+ destinations and gates Continuar (as the old step did)
  await expect(page.getByRole("heading", { name: UI.sameTitle.es })).toBeVisible();
  await page.getByRole("button", { name: "Continuar", exact: true }).click();                  // gates Continuar: it does not move on and says what is missing
  await expect(page.getByRole("heading", { name: UI.sameTitle.es })).toBeVisible(); await expect(page.getByRole("alert").filter({ hasText: UI.reqSummary.es })).toBeVisible();
  await page.getByRole("radio", { name: UI.sameNo.es }).check();
  await expect(page.getByRole("button", { name: "Continuar", exact: true })).toBeEnabled();
  await noHorizontalOverflow(page);
  await page.getByRole("button", { name: "Continuar", exact: true }).click();
  // one component per country: India first, then España — each with presence + permanence + «today» on ONE screen
  for (const [country, last] of [["India", false], ["España", true]] as const) {
    await page.getByRole("checkbox", { name: UI.acts.sell.es, exact: true }).check();
    await page.getByRole("checkbox", { name: UI.withs.goods.es, exact: true }).check();
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(country);
    for (const q of [`¿Tu proyecto en ${country} será permanente o temporal?`, `¿Qué actividad o presencia tienes hoy en ${country}?`])
      await expect(page.getByRole("group", { name: q })).toBeVisible();                    // fieldset + legend name the country
    await expect(page.getByTestId("clarity-question")).toHaveCount(last ? 1 : 0);
    await page.getByRole("radio", { name: UI.pres.remote.es, exact: true }).first().check();
    await page.getByRole("radio", { name: UI.permOpts.permanent.es, exact: true }).last().check();
    await page.getByRole("radio", { name: UI.exist.nothing.es, exact: true }).check();
    await noHorizontalOverflow(page); expect(await axeViolations(page)).toEqual([]);
    await page.getByRole("button", { name: "Continuar", exact: true }).click();
  }
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(UI.reasonTitle.es);      // no checkpoint in between
  await expect(page.locator("body")).not.toContainText("esto es lo que entendemos");
});

test("Single destination: no «same project?» block", async ({ page }) => {
  await page.goto("/fa4"); await page.getByRole("button", { name: UI.coverCta.es }).click();
  await page.getByLabel(UI.name.es).fill("A"); await page.getByLabel(UI.company.es, { exact: true }).fill("B"); await page.getByLabel(UI.email.es).fill("a@b.example");
  await page.getByRole("radio", { name: UI.deciderOpts.me.es }).check(); await page.getByLabel(UI.terms.es).check(); await page.getByLabel(UI.privacy.es).check();
  await page.getByRole("button", { name: UI.acceptContinue.es }).click();
  await page.getByRole("radio", { name: "Sí", exact: true }).check(); await page.getByLabel(UI.sector.es).fill("x"); await page.getByRole("radio", { name: "11–50" }).check();
  await page.getByPlaceholder(UI.searchCountry.es).fill("Espa"); await page.getByRole("button", { name: "España", exact: true }).click(); await page.getByRole("button", { name: "Continuar", exact: true }).click();
  await page.getByPlaceholder(UI.searchCountry.es).fill("Méx"); await page.getByRole("button", { name: "México", exact: true }).click();
  await expect(page.getByRole("heading", { name: UI.sameTitle.es })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Continuar", exact: true })).toBeEnabled();
});

test("Sticky action bar, header and density at this viewport", async ({ page, request }, info) => {
  const token = await seed(request, journeyNortica(), "company");
  await open(page, token);
  await expect(page.getByRole("heading", { name: UI.hasBiz.es })).toBeVisible();
  const nav = page.locator(".navbar");
  const box = async () => (await nav.boundingBox())!;
  const inView = async () => { const b = await box(); return b.y >= 0 && b.y + b.height <= vp(page).height + 1; };
  expect(await inView()).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 99999)); expect(await inView()).toBe(true);        // sticky: always reachable
  // «Guardar y seguir después»: in the action bar on desktop, in the header below 1024
  const inNav = await nav.getByRole("button", { name: UI.saveLater.es }).isVisible();
  const inHeader = await page.locator(".topbar").getByRole("button", { name: UI.saveLater.es }).isVisible();
  expect(inNav).toBe(desktop(page)); expect(inHeader).toBe(!desktop(page));
  // Help + Talk stay reachable (links on desktop, «?» menu below 1024)
  if (desktop(page)) { await expect(page.locator(".topbar").getByRole("link", { name: /Necesito ayuda/ })).toBeVisible(); await expect(page.locator(".topbar").getByRole("button", { name: UI.talk.es })).toBeVisible(); }
  else await expect(page.locator(".topbar").getByRole("button", { name: UI.menu.es })).toBeVisible();
  // progress names never overflow their cell
  const bad = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>(".progress .stage-names span, .progress .labels span")].filter((e) => e.scrollWidth > e.clientWidth + 1).length);
  expect(bad).toBe(0);
  await noHorizontalOverflow(page); await touchTargetsOk(page); expect(await axeViolations(page)).toEqual([]);
  if (desktop(page)) {                                                                              // density goal: a normal desktop screen needs no scroll
    const h = await page.evaluate(() => ({ s: document.documentElement.scrollHeight, i: window.innerHeight }));
    expect(h.s, `company screen taller than the viewport: ${h.s} > ${h.i}`).toBeLessThanOrEqual(h.i + 2);
  }
  await page.screenshot({ path: `test-results/shots/company-${info.project.name}.png`, fullPage: true });
});

test("The panel has no decorative circles; the YEV carries no form chrome and keeps Help / Talk at its foot", async ({ page, request }) => {
  const token = await seed(request, journeyNortica(), "extra");
  await open(page, token);
  await page.getByRole("button", { name: UI.seeResult.es }).click();
  await expect(page.getByTestId("result-screen")).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".res-actions, .top-actions, .navbar, .progress")).toHaveCount(0);
  const foot = page.locator(".res-footer");
  await expect(foot.getByRole("link", { name: /Necesito ayuda/ })).toHaveAttribute("href", "https://www.beeside.you/helpcenter");
  await foot.getByRole("button", { name: UI.talk.es }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: UI.talkTitle.es })).toBeVisible();
  const circles = await page.evaluate(() => [...document.querySelectorAll(".deco")].map((e) => getComputedStyle(e, "::before").display + getComputedStyle(e, "::after").display));
  for (const c of circles) expect(c).toBe("nonenone");
});

test("Saved steps of merged/removed screens land on the surviving screen (resume compatibility)", async ({ page, request }) => {
  const cases: Array<[string, RegExp]> = [
    ["reflection", /¿Ya tienes claro qué necesitas para avanzar\?/], ["existing:c1", /¿Qué actividad o presencia tienes hoy en/], ["same_in_all", /¿A qué país o países/],
    ["scale", new RegExp(UI.decTitle.es.replace(/[?¿]/g, "."))], ["cargo_route", /Estos son los temas|¿En qué temas|Marca los temas/],
  ];
  for (const [key, expected] of cases) {
    const token = await seed(request, journeyNortica(), key);
    await page.context().clearCookies(); await page.evaluate(() => sessionStorage.clear()).catch(() => undefined);
    await open(page, token);
    await expect(page.locator("main")).toContainText(expected, { timeout: 15_000 });
  }
});

test("Journey B (two countries, shared project): sanity of the merged flow with seeded data", async ({ page, request }) => {
  const token = await seed(request, journeyB("es"), "presence:us");
  await open(page, token);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Estados Unidos");
  await expect(page.getByTestId("clarity-question")).toBeVisible();                              // last project screen
  const a = journeyA(); void a;
});
