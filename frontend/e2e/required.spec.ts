import { expect, test, type Page } from "@playwright/test";
import { UI } from "../src/fa4/copy/ui";
import { axeViolations } from "./helpers";

/** Stabilization findings #2 and #3 in a REAL browser: «not decided» vs chosen countries are mutually exclusive; «Continue» never moves on with required answers missing,
 *  says which ones, flags them (aria-invalid) and focuses the first. Optional questions never block. */
const keys = (page: Page) => page.$$eval('[data-req-bad="true"]', (els) => els.map((e) => e.getAttribute("data-req")));
const next = (page: Page, name: string) => page.getByRole("button", { name, exact: true }).click();

test("Destinations: «not decided» is unavailable once countries are chosen, and a click can never wipe the selection; they never coexist", async ({ page }) => {
  await page.goto("/fa4"); await page.getByRole("button", { name: UI.coverCta.es, exact: true }).click();
  await page.getByLabel(UI.name.es).fill("Ana"); await page.getByLabel(UI.company.es, { exact: true }).fill("Acme"); await page.getByLabel(UI.email.es).fill("ana@acme.example");
  await page.getByRole("radio", { name: UI.deciderOpts.me.es }).check(); await page.getByLabel(UI.terms.es).check(); await page.getByLabel(UI.privacy.es).check();
  await next(page, UI.acceptContinue.es);
  await page.getByRole("radio", { name: UI.no.es, exact: true }).check(); await next(page, UI.next.es);              // no business today → destinations
  const open = page.getByLabel(UI.destOpen.es);
  await expect(open).toBeEnabled();
  await page.getByPlaceholder(UI.searchCountry.es).fill("Méx"); await page.getByRole("button", { name: "México", exact: true }).click();
  await expect(open).toBeDisabled();                                                          // countries chosen → option unavailable
  await open.click({ force: true }).catch(() => undefined);                                  // even a forced click changes nothing
  await expect(open).not.toBeChecked(); await expect(page.getByText("México").first()).toBeVisible();
  await expect(page.getByLabel(`${UI.region.es} — México`)).toBeVisible();                     // the selection (and its region field) is intact
  await page.getByRole("button", { name: `${UI.remove.es} México` }).click();                  // remove the country → the option is available again
  await expect(open).toBeEnabled();
  await open.check(); await expect(open).toBeChecked();
  await expect(page.getByPlaceholder(UI.searchCountry.es)).toBeDisabled();                    // «not decided» → the picker is off: they never coexist
});

test("Required answers: every screen explains what is missing, focuses the first one and does not advance; optional ones never block", async ({ page }) => {
  await page.goto("/fa4"); await page.getByRole("button", { name: UI.coverCta.es, exact: true }).click();
  const alert = page.getByRole("alert").filter({ hasText: UI.reqSummary.es });
  // identity
  await next(page, UI.acceptContinue.es);
  expect(await keys(page)).toEqual(["identity.name", "identity.company", "identity.email", "identity.decider", "identity.terms", "identity.privacy"]);
  await expect(alert).toBeVisible(); await expect(alert).toContainText(UI.name.es);
  await expect(page.getByLabel(UI.name.es)).toBeFocused(); await expect(page.getByLabel(UI.name.es)).toHaveAttribute("aria-invalid", "true");
  expect(await axeViolations(page)).toEqual([]);
  await page.getByLabel(UI.name.es).fill("Ana");                                              // fixing one clears just that one, live
  expect(await keys(page)).not.toContain("identity.name");
  await page.getByLabel(UI.company.es, { exact: true }).fill("Acme"); await page.getByLabel(UI.email.es).fill("ana@acme.example");
  await page.getByRole("radio", { name: UI.deciderOpts.me.es }).check(); await page.getByLabel(UI.terms.es).check();
  await next(page, UI.acceptContinue.es); expect(await keys(page)).toEqual(["identity.privacy"]);   // role and marketing are optional: not asked
  await page.getByLabel(UI.privacy.es).check(); await next(page, UI.acceptContinue.es);
  // company
  await next(page, UI.next.es); expect(await keys(page)).toEqual(["company.hasBiz"]);
  await page.getByRole("radio", { name: UI.yes.es, exact: true }).check(); await next(page, UI.next.es);
  expect(await keys(page)).toEqual(["company.sector", "company.size", "company.operatesIn"]); await expect(page.getByLabel(UI.sector.es)).toBeFocused();
  await page.getByLabel(UI.sector.es).fill("Software"); await page.getByRole("radio", { name: "51–250" }).check();
  await page.getByPlaceholder(UI.searchCountry.es).fill("Espa"); await page.getByRole("button", { name: "España", exact: true }).click(); await next(page, UI.next.es);
  // destinations
  await next(page, UI.next.es); expect(await keys(page)).toEqual(["dest.list"]);
  await page.getByPlaceholder(UI.searchCountry.es).fill("Méx"); await page.getByRole("button", { name: "México", exact: true }).click(); await next(page, UI.next.es);
  // activity
  await next(page, UI.next.es); expect(await keys(page)).toEqual(["act.acts"]);
  await page.getByRole("checkbox", { name: UI.acts.sell.es, exact: true }).check(); await page.getByRole("checkbox", { name: UI.acts.hire.es, exact: true }).check();
  await next(page, UI.next.es); expect(await keys(page)).toEqual(["act.with"]);
  await page.getByRole("checkbox", { name: UI.withs.goods.es, exact: true }).check(); await next(page, UI.next.es);
  // presence (+ the optional clarity question must NOT block)
  await next(page, UI.next.es); expect(await keys(page)).toEqual(["pres.how", "pres.perm", "pres.exist"]);
  await page.getByRole("radio", { name: UI.pres.own_physical.es, exact: true }).first().check();
  await page.getByRole("radio", { name: UI.permOpts.permanent.es, exact: true }).last().check();
  await page.getByRole("radio", { name: UI.exist.nothing.es, exact: true }).check(); await next(page, UI.next.es);
  // reason
  await next(page, UI.next.es); expect(await keys(page)).toEqual(["reason"]);
  await page.getByRole("checkbox", { name: UI.reasons.growth.es }).check(); await next(page, UI.next.es);
  // decision (+ optional: dependsOn, deadline date, project size)
  await next(page, UI.next.es); expect(await keys(page)).toEqual(["dec.state", "dec.start", "dec.ext"]);
  await page.getByRole("radio", { name: UI.dec.decided.es }).check(); await next(page, UI.next.es); expect(await keys(page)).toEqual(["dec.start", "dec.ext"]);
  await page.getByRole("radio", { name: UI.starts["6m"].es }).check(); await page.getByRole("radio", { name: UI.no.es, exact: true }).check(); await next(page, UI.next.es);
  // activators: the questions on the screen are required
  await expect(page.getByTestId("flow-length")).toBeAttached();
  const k0 = await page.locator("[data-req]").evaluateAll((els) => els.map((e) => e.getAttribute("data-req")));
  expect(k0.length).toBeGreaterThan(0);
  await next(page, UI.next.es); expect((await keys(page)).length).toBe(k0.length);
  await expect(page.getByRole("alert").filter({ hasText: UI.reqSummary.es })).toBeVisible();
});

for (const loc of ["es", "en"] as const) {
  test(`Support screen (${loc}): no extra «in your words» field; the approved question #34 appears exactly once; the single open question stays on «Algo más»`, async ({ page, request }) => {
    const { journeyNortica } = await import("@beeside/fa-public-engine/testing");
    const { seed, open } = await import("./helpers");
    await open(page, await seed(request, journeyNortica(loc), "support_values"));
    await expect(page.getByRole("heading", { name: UI.valuesTitle[loc] })).toBeVisible();
    await expect(page.getByText(loc === "es" ? "En tus palabras (opcional)" : "In your own words (optional)")).toHaveCount(0);
    await expect(page.getByText(UI.keepQ[loc])).toHaveCount(1);
    await expect(page.getByRole("textbox")).toHaveCount(1);                                     // only the #34 field is left on this screen
    await page.getByRole("button", { name: UI.next[loc], exact: true }).click();
    await expect(page.getByLabel(UI.descr[loc])).toBeVisible();                                 // «Algo más» keeps its open question
  });
}
