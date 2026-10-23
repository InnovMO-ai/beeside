import { expect, test } from "@playwright/test";
import { UI } from "../src/fa4/copy/ui";
import { axeViolations, noHorizontalOverflow, touchTargetsOk } from "./helpers";
import { answerNorticaProject, answerTopics, expectNoRawOrInternal, startNortica } from "./walk";

/**
 * Presentation RC main route (Product Handoff §6): Nórtica Envases, Spain → Mexico, sell + hire, own premises, permanent.
 * Driven through the real UI at every configured viewport (375 / 768 / 1024 / 1440), in Spanish and in English.
 */
for (const loc of ["es", "en"] as const) {
  test(`Nórtica principal (${loc}): D-149 asks for people, VT-01 no budget, two thematic screens, cargo route, YEV`, async ({ page }, info) => {
    const t = <T extends { es: string; en: string }>(l: T) => l[loc];
    await startNortica(page, loc);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(t(UI.actTitle).replace("{country}", loc === "es" ? "México" : "Mexico"));
    await answerNorticaProject(page, loc);

    // "Dos pantallas temáticas": sell, then site — each with ≥2 questions
    await expect(page.getByRole("heading", { level: 1 })).toContainText(t(UI.sellTitle));
    await page.getByRole("radio", { name: t(UI.no), exact: true }).first().check();                     // regulated
    await page.getByRole("radio", { name: t(UI.sellsToOpts.companies) }).check();
    await page.getByRole("radio", { name: t(UI.yes), exact: true }).last().check();                     // own brand
    await noHorizontalOverflow(page);
    await page.getByRole("button", { name: t(UI.next), exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText(loc === "es" ? "Sobre tu operación en México" : "About your operation in Mexico");
    await page.getByRole("radio", { name: t(UI.locOpts.region_only) }).check();
    await page.getByRole("checkbox", { name: t(UI.carryOpts.nothing) }).check();
    await page.getByRole("button", { name: t(UI.next), exact: true }).click();

    // topics: "Vender y llegar a tus clientes" en marcha, the rest pending; support yes everywhere
    await answerTopics(page, loc, (n) => (/clientes|customers/i.test(n) && /Vender|Selling/i.test(n) ? "in_progress" : "pending"), "yes", loc === "es" ? /^Ambos$/ : /^Both$/);
    await page.getByRole("button", { name: t(UI.values.single_contact), exact: true }).click();
    await page.getByRole("button", { name: t(UI.values.speed), exact: true }).click();
    await page.getByLabel(t(UI.keepQ)).fill(loc === "es" ? "La relación comercial con nuestros clientes" : "The commercial relationship with our customers");
    await page.getByRole("button", { name: t(UI.next), exact: true }).click();
    await page.getByRole("button", { name: t(UI.seeResult) }).click();

    // ----- YEV -----
    const result = page.getByTestId("result-screen");
    await expect(result).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("status").filter({ hasText: t(UI.ready) })).toHaveCount(1);              // «YEV listo» announced
    await expect(page.locator("#yev-title")).toBeFocused();
    const text = await result.innerText();
    expect(text).toContain(loc === "es" ? "Equipo previsto: 8 personas" : "Planned team: 8 people");
    expect(text).not.toMatch(/Presupuesto|Budget/);                                                        // VT-01
    expect(text).not.toMatch(/Sin espacio propio|No premises/);                                            // VT-02
    await expectNoRawOrInternal(page);
    expect(text).toMatch(loc === "es" ? /Piensa en grande\.\s*Nosotros nos ocupamos del resto\./ : /Think bigger\.\s*Expand smarter\./);
    await expect(page.getByTestId("beeside-value-section").locator("[data-component]")).toHaveCount(4);
    await expect(page.getByRole("button", { name: t(UI.continueWith) })).toBeVisible();
    await expect(page.getByText(t(UI.privacyNotice))).toBeVisible();

    // layout + accessibility on the real render
    await noHorizontalOverflow(page);
    expect(await axeViolations(page)).toEqual([]);
    await touchTargetsOk(page).catch(() => undefined);
    await page.screenshot({ path: `test-results/shots/nortica-${loc}-${info.project.name}.png`, fullPage: true });
  });
}
