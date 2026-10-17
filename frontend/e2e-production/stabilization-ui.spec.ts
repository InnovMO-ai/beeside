import { expect, test, type Page } from "@playwright/test";
import { UI } from "../src/fa4/copy/ui";

/** Stabilization notice and personal-e-mail warning on the REAL closed URL (ES/EN). Fictitious data only; nothing here sends an e-mail, so it raises no 5xx. */
const USER = process.env.PROD_GATE_USER ?? ""; const PASS = process.env.PROD_GATE_PASSWORD ?? "";
test.use({ httpCredentials: USER ? { username: USER, password: PASS, send: "always" } : undefined });

async function toIdentity(page: Page, loc: "es" | "en") {
  await page.goto("/");
  if (loc === "en") await page.getByRole("button", { name: /English/ }).click();
  await expect(page.getByTestId("stabilization-notice")).toHaveCount(0);                              // cover unchanged
  await page.getByRole("button", { name: UI.coverCta[loc] }).click();
  const dlg = page.getByTestId("stabilization-notice"); await expect(dlg).toBeVisible();
  await expect(dlg.getByRole("heading", { name: UI.stabTitle[loc] })).toBeVisible();
  await expect(page.getByLabel(UI.name[loc]).click({ timeout: 1500, trial: true })).rejects.toThrow();  // cannot continue before confirming
  await page.keyboard.press("Escape"); await expect(dlg).toBeVisible();
  await page.getByRole("button", { name: UI.stabConfirm[loc] }).click(); await expect(dlg).toHaveCount(0);
}
async function fillIdentity(page: Page, loc: "es" | "en", email: string) {
  await page.getByLabel(UI.name[loc]).fill("Prueba Ficticia"); await page.getByLabel(UI.company[loc], { exact: true }).fill("Empresa Ficticia (prueba)"); await page.getByLabel(UI.email[loc]).fill(email);
  await page.getByRole("radio", { name: UI.deciderOpts.me[loc] }).check(); await page.getByLabel(UI.terms[loc]).check(); await page.getByLabel(UI.privacy[loc]).check();
}
for (const loc of ["es", "en"] as const) {
  test(`real URL (${loc}): Stabilization modal; personal e-mail warns and can continue after confirming; corporate passes without a warning`, async ({ page }, info) => {
    test.skip(!USER || info.project.name !== "desktop-1440", "needs gate credentials; desktop only (the session-creation limit is 10 per 10 min per address)");
    await toIdentity(page, loc);
    await fillIdentity(page, loc, "prueba.ficticia@gmail.com");
    await page.getByRole("button", { name: UI.acceptContinue[loc] }).click();
    const w = page.getByTestId("personal-email-warning"); await expect(w).toBeVisible();
    await expect(w.getByRole("heading", { name: UI.personalEmailTitle[loc] })).toBeVisible(); await expect(w.getByText(UI.personalEmailBody[loc])).toBeVisible();
    await page.getByRole("button", { name: UI.personalEmailKeep[loc] }).click();                   // personal can continue after confirming
    await expect(page.getByRole("heading", { name: UI.hasBiz[loc] })).toBeVisible();
    await page.getByRole("button", { name: UI.back[loc], exact: true }).click();
    await page.getByLabel(UI.email[loc]).fill("prueba.ficticia@empresa-ficticia.example");        // corporate: no warning
    await page.getByRole("button", { name: UI.acceptContinue[loc] }).click();
    await expect(page.getByRole("heading", { name: UI.hasBiz[loc] })).toBeVisible(); await expect(page.getByTestId("personal-email-warning")).toHaveCount(0);
  });
}
