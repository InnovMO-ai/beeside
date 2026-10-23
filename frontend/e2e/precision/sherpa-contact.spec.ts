import { expect, test } from "@playwright/test";
import { expectAccessible, expectNoHorizontalOverflow, go } from "./helpers";

// "Contact my Sherpa" is offered only with a valid direct Sherpa channel; a Sherpa without a channel gets general "Contact beeside";
// no Sherpa assigned gets no contact action beside Operation Hub (general Help stays available). Same on the Center and the Sent page.
const CASES = [
  { locale: "en" as const, sherpa: /^Contact my Sherpa$/, beeside: /^Contact beeside$/, title: "Contact beeside", mail: "Send an email" },
  { locale: "es" as const, sherpa: /^Contactar a mi Sherpa$/, beeside: /^Contactar a beeside$/, title: "Contactar a beeside", mail: "Enviar un correo" },
];

for (const c of CASES) {
  for (const path of ["/center", "/category/logistics/sent"]) {
    test.describe(`${c.locale} ${path}`, () => {
      test("Sherpa assigned, no direct channel: only general Contact beeside (mailto the configured address)", async ({ page }) => {
        await go(page, path, { locale: c.locale, mock: "preset:sent,ohmode:enter,sherpa" });
        await expect(page.getByRole("button", { name: c.beeside })).toBeVisible();
        await expect(page.getByRole("button", { name: c.sherpa })).toHaveCount(0);
        await page.getByRole("button", { name: c.beeside }).click();
        const dialog = page.getByRole("dialog");
        await expect(dialog.getByRole("heading", { name: c.title })).toBeVisible();
        await expect(dialog.getByRole("link", { name: c.mail })).toHaveAttribute("href", "mailto:contact@beeside.you");
        await expect(dialog).not.toContainText(/sherpa/i);
        await expectAccessible(page, `${c.locale} ${path} contact beeside`);
      });

      test("Sherpa assigned with a direct channel: Contact my Sherpa to that channel", async ({ page }) => {
        await go(page, path, { locale: c.locale, mock: "preset:sent,ohmode:enter,sherpachannel" });
        await expect(page.getByRole("button", { name: c.sherpa })).toBeVisible();
        await expect(page.getByRole("button", { name: c.beeside })).toHaveCount(0);
        await page.getByRole("button", { name: c.sherpa }).click();
        await expect(page.getByRole("dialog").getByRole("link", { name: c.mail })).toHaveAttribute("href", "mailto:sherpa.channel@beeside.example");
      });

      test("no Sherpa assigned: no contact action beside Operation Hub", async ({ page }) => {
        await go(page, path, { locale: c.locale, mock: "preset:sent,ohmode:enter" });
        await expect(page.getByRole("button", { name: c.sherpa })).toHaveCount(0);
        await expect(page.getByRole("button", { name: c.beeside })).toHaveCount(0);
        await expectNoHorizontalOverflow(page, `${c.locale} ${path}`);
      });
    });
  }
}

test("phone width: Contact beeside action does not overflow", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await go(page, "/center", { mock: "preset:sent,ohmode:enter,sherpa" });
  await expect(page.getByRole("button", { name: /^Contact beeside$/ })).toBeVisible();
  await expectNoHorizontalOverflow(page, "375");
});
