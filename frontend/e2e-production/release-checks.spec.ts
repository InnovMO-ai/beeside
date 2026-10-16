import { expect, test, type Page } from "@playwright/test";
import { UI } from "../src/fa4/copy/ui";
import { journeyNortica } from "@beeside/fa-public-engine/testing";

/** Stabilization block checks on the REAL closed URL (A–F). Fictitious data only. Creates at most 3 projects per run (the session-creation limit is 10 per 10 min per address). */
const USER = process.env.PROD_GATE_USER ?? ""; const PASS = process.env.PROD_GATE_PASSWORD ?? "";
test.use({ httpCredentials: USER ? { username: USER, password: PASS, send: "always" } : undefined });
const keys = (page: Page) => page.$$eval('[data-req-bad="true"]', (els) => els.map((e) => e.getAttribute("data-req")));

test("A·B·C·D — heading, required answers, country selection, Stabilization button (real URL, ES)", async ({ page }, info) => {
  test.skip(!USER, "no gate credentials supplied");
  await page.goto("/");
  await page.getByRole("button", { name: UI.coverCta.es }).click();
  const dlg = page.getByTestId("stabilization-notice"); await expect(dlg).toBeVisible();
  const b = await page.getByRole("button", { name: UI.stabConfirm.es }).boundingBox(); const d = await dlg.boundingBox();      // D
  expect(b!.height).toBeLessThanOrEqual(52); expect(b!.width).toBeLessThanOrEqual(Math.max(260, d!.width * 0.6));
  await page.getByRole("button", { name: UI.stabConfirm.es }).click();
  if (info.project.name !== "desktop-1440") return;                                                                             // the rest creates a project: once
  await expect(page.getByRole("heading", { name: "Cuéntanos un poco sobre ti." })).toBeVisible();                              // A
  await expect(page.getByText("Sin cuenta ni contraseña.")).toBeVisible();
  await page.getByRole("button", { name: UI.acceptContinue.es }).click();                                                      // B
  expect(await keys(page)).toEqual(["identity.name", "identity.company", "identity.email", "identity.decider", "identity.terms", "identity.privacy"]);
  await expect(page.getByRole("alert").filter({ hasText: "Para continuar, completa:" })).toBeVisible();
  await expect(page.getByText("Falta responder esto para continuar.").first()).toBeVisible();
  await expect(page.getByLabel(UI.name.es)).toBeFocused(); await expect(page.getByLabel(UI.name.es)).toHaveAttribute("aria-invalid", "true");
  await page.getByLabel(UI.name.es).fill("Prueba Ficticia"); await page.getByLabel(UI.company.es, { exact: true }).fill("Empresa Ficticia (prueba)");
  await page.getByLabel(UI.email.es).fill(`prueba.ficticia.${Date.now()}@empresa-ficticia.example`);
  await page.getByRole("radio", { name: UI.deciderOpts.me.es }).check(); await page.getByLabel(UI.terms.es).check();
  await page.getByRole("button", { name: UI.acceptContinue.es }).click(); expect(await keys(page)).toEqual(["identity.privacy"]);
  await page.getByLabel(UI.privacy.es).check(); await page.getByRole("button", { name: UI.acceptContinue.es }).click();
  await page.getByRole("radio", { name: UI.no.es, exact: true }).check(); await page.getByRole("button", { name: UI.next.es, exact: true }).click();   // company → destinations
  await page.getByRole("button", { name: UI.next.es, exact: true }).click(); expect(await keys(page)).toEqual(["dest.list"]);
  const open = page.getByLabel(UI.destOpen.es); await expect(open).toBeEnabled();                                              // C
  await page.getByPlaceholder(UI.searchCountry.es).fill("Méx"); await page.getByRole("button", { name: "México", exact: true }).click();
  await expect(open).toBeDisabled(); await open.click({ force: true }).catch(() => undefined);
  await expect(open).not.toBeChecked(); await expect(page.getByLabel(`${UI.region.es} — México`)).toBeVisible();
  await page.getByRole("button", { name: `${UI.remove.es} México` }).click(); await expect(open).toBeEnabled();
  await open.check(); await expect(page.getByPlaceholder(UI.searchCountry.es)).toBeDisabled();
});

for (const loc of ["es", "en"] as const) {
  test(`E·F — support screen (${loc}) on the real URL: no «in your words» field; question #34 exactly once`, async ({ page, request }, info) => {
    test.skip(!USER || info.project.name !== "desktop-1440", "needs gate credentials; desktop only (project creation)");
    const a = JSON.parse(JSON.stringify(journeyNortica(loc))); a.identity.email = `prueba.ficticia.${Date.now()}@empresa-ficticia.example`;
    const s = await request.post("/api/fa4/sessions", { data: { answers: a, step: "support_values" } }); expect(s.ok()).toBeTruthy();
    await page.addInitScript((t) => { sessionStorage.setItem("beeside.fa4.session", t); sessionStorage.setItem("beeside.fa4.stabilization-ack", "1"); }, (await s.json()).sessionToken as string);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: UI.valuesTitle[loc] })).toBeVisible();
    await expect(page.getByText(loc === "es" ? "En tus palabras (opcional)" : "In your own words (optional)")).toHaveCount(0);   // E
    await expect(page.getByText(UI.keepQ[loc])).toHaveCount(1);                                                                    // F
    await expect(page.getByRole("textbox")).toHaveCount(1);
  });
}
