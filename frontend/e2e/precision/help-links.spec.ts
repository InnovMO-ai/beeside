import { expect, test } from "@playwright/test";
import { go } from "./helpers";

// The Help page takes its destinations from the configuration layer (served by the API); the approved values (12 Oct 2026).
test("Help: Help Center, Privacy Policy, Terms and Contact point to the configured destinations", async ({ page }) => {
  await go(page, "/help");
  await expect(page.getByRole("link", { name: /Open the Help Center/ })).toHaveAttribute("href", "https://www.beeside.you/helpcenter");
  await expect(page.getByRole("link", { name: /Privacy Policy/ })).toHaveAttribute("href", "https://www.beeside.you/privacy");
  await expect(page.getByRole("link", { name: /Terms and Conditions/ })).toHaveAttribute("href", "https://beeside.you/termsandconditions");
  await expect(page.getByRole("link", { name: "Send an email" })).toHaveAttribute("href", "mailto:contact@beeside.you");
  await expect(page.locator("a[href*='Policiescommercialnotices']")).toHaveCount(0); // Commercial Notices: consent contexts only
});
