import { expect, test, type Page } from "@playwright/test";
import { UI } from "../src/fa4/copy/ui";
import { axeViolations, noHorizontalOverflow } from "./helpers";

/** Stabilization notice + personal e-mail warning in a REAL browser (native modal: focus trap, inert page, keyboard) at every viewport. Closed test is simulated through the runtime config. */
const closed = async (page: Page) => page.route("**/config.json", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ closedTest: true, label: "PRUEBA CONTROLADA · datos ficticios · no comercial" }) }));

for (const loc of ["es", "en"] as const) {
  test(`Stabilization notice (${loc}): modal after the cover, blocks the page, keyboard-only, cannot be dismissed, then the journey continues`, async ({ page }) => {
    await closed(page);
    await page.goto("/fa4"); if (loc === "en") await page.getByRole("button", { name: /English/ }).click();
    await expect(page.getByTestId("stabilization-notice")).toHaveCount(0);                    // the cover is unchanged
    await page.getByRole("button", { name: UI.coverCta[loc], exact: true }).click();
    const dlg = page.getByTestId("stabilization-notice");
    await expect(dlg).toBeVisible(); await expect(dlg.getByRole("heading", { name: UI.stabTitle[loc] })).toBeVisible();
    expect(await dlg.evaluate((d: HTMLDialogElement) => d.matches(":modal"))).toBe(true);
    await expect(page.getByRole("button", { name: UI.stabConfirm[loc] })).toBeFocused();       // initial focus on the only action
    // the page behind cannot be used: a click on the form field is intercepted by the modal
    await expect(page.getByLabel(UI.name[loc]).click({ timeout: 1500, trial: true })).rejects.toThrow();
    // keyboard: focus can only ever land in the dialog (or leave to the browser itself) — never on the page behind it
    for (let i = 0; i < 4; i++) { await page.keyboard.press("Tab"); expect(await page.evaluate(() => { const a = document.activeElement; return !a || a === document.body || !!a.closest("dialog"); })).toBe(true); }
    await page.keyboard.press("Escape"); await expect(dlg).toBeVisible();
    const box = await page.getByRole("button", { name: UI.stabConfirm[loc] }).boundingBox(); const dbox = await dlg.boundingBox();   // finding #5: a normal-size button, not a full-width bar
    expect(box!.height).toBeLessThanOrEqual(52); expect(box!.width).toBeLessThanOrEqual(Math.max(260, dbox!.width * 0.6));
    expect(await axeViolations(page)).toEqual([]); await noHorizontalOverflow(page);
    await page.getByRole("button", { name: UI.stabConfirm[loc] }).focus(); await page.keyboard.press("Enter");
    await expect(dlg).toHaveCount(0);
    await page.getByLabel(UI.name[loc]).fill("Ana");                                          // usable now
    await page.reload(); await expect(page.getByTestId("stabilization-notice")).toHaveCount(0);   // confirmed for this browser session
  });
}

test("outside Stabilization (the open product) the notice never appears", async ({ page }) => {
  await page.route("**/config.json", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ closedTest: false, label: null }) }));
  await page.goto("/fa4"); await page.getByRole("button", { name: UI.coverCta.es, exact: true }).click(); await expect(page.getByLabel(UI.name.es)).toBeVisible();
  await expect(page.getByTestId("stabilization-notice")).toHaveCount(0); await expect(page.getByRole("note")).toHaveCount(0);
});

async function fillIdentity(page: Page, loc: "es" | "en", email: string) {
  await page.getByLabel(UI.name[loc]).fill("Ana"); await page.getByLabel(UI.company[loc], { exact: true }).fill("Acme"); await page.getByLabel(UI.email[loc]).fill(email);
  await page.getByRole("radio", { name: UI.deciderOpts.me[loc] }).check(); await page.getByLabel(UI.terms[loc]).check(); await page.getByLabel(UI.privacy[loc]).check();
}
for (const loc of ["es", "en"] as const) {
  test(`Personal e-mail warning (${loc}): advisory — keyboard, use another / continue, corporate passes`, async ({ page }) => {
    await page.goto("/fa4"); if (loc === "en") await page.getByRole("button", { name: /English/ }).click();
    await page.getByRole("button", { name: UI.coverCta[loc], exact: true }).click();
    await fillIdentity(page, loc, "ana@gmail.com");
    await page.getByRole("button", { name: UI.acceptContinue[loc] }).click();
    const dlg = page.getByTestId("personal-email-warning"); await expect(dlg).toBeVisible();
    await expect(dlg.getByRole("heading", { name: UI.personalEmailTitle[loc] })).toBeVisible(); await expect(dlg.getByText(UI.personalEmailBody[loc])).toBeVisible();
    await expect(page.getByRole("button", { name: UI.personalEmailOther[loc] })).toBeFocused();
    expect(await axeViolations(page)).toEqual([]); await noHorizontalOverflow(page);
    await page.keyboard.press("Escape"); await expect(dlg).toHaveCount(0);                    // Escape = use another
    await expect(page.getByLabel(UI.email[loc])).toBeFocused();
    await page.getByLabel(UI.email[loc]).fill("ana@empresa.example");                           // corporate: no warning
    await page.getByRole("button", { name: UI.acceptContinue[loc] }).click();
    await expect(page.getByRole("heading", { name: UI.hasBiz[loc] })).toBeVisible(); await expect(page.getByTestId("personal-email-warning")).toHaveCount(0);
  });
  test(`Personal e-mail (${loc}) is never rejected: «${loc === "es" ? "Continuar con este correo" : "Continue with this email"}» goes on, and the warning is not repeated for the same address`, async ({ page }) => {
    await page.goto("/fa4"); if (loc === "en") await page.getByRole("button", { name: /English/ }).click();
    await page.getByRole("button", { name: UI.coverCta[loc], exact: true }).click();
    await fillIdentity(page, loc, "ana@outlook.com");
    await page.getByRole("button", { name: UI.acceptContinue[loc] }).click();
    await page.getByRole("button", { name: UI.personalEmailKeep[loc] }).click();
    await expect(page.getByRole("heading", { name: UI.hasBiz[loc] })).toBeVisible();
    await page.getByRole("button", { name: UI.back[loc], exact: true }).click();              // back to identity and forward again: same address, no second warning
    await page.getByRole("button", { name: UI.acceptContinue[loc] }).click();
    await expect(page.getByRole("heading", { name: UI.hasBiz[loc] })).toBeVisible(); await expect(page.getByTestId("personal-email-warning")).toHaveCount(0);
  });
}
