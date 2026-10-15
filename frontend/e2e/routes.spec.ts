import { expect, test } from "@playwright/test";
import { UI } from "../src/fa4/copy/ui";

/** Canonical production routes: /discovery = public Discovery, /ops-control = internal administration. Technical paths (/fa4, /admin) keep working; the public app never links to the admin route. */
test.describe("canonical routes", () => {
  test.beforeEach(async ({ page: _p }, info) => { test.skip(info.project.name !== "desktop-1440", "run once"); });
  for (const p of ["/discovery", "/discovery/", "/fa4"]) {
    test(`${p} serves Discovery`, async ({ page }) => {
      await page.goto(p);
      await expect(page.getByRole("button", { name: UI.coverCta.es })).toBeVisible();
      await expect(page.getByText("Discovery", { exact: true }).first()).toBeVisible();
    });
  }
  test("Discovery never links to or mentions the administration route (cover and identity)", async ({ page }) => {
    await page.goto("/discovery");
    for (const step of ["cover", "identity"]) {
      if (step === "identity") await page.getByRole("button", { name: UI.coverCta.es }).click();
      const html = await page.content();
      expect(html).not.toMatch(/ops-control|\/admin\b|Control Center/i);
      expect(await page.locator("a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href")))).not.toContainEqual(expect.stringMatching(/ops-control|\/admin/));
    }
  });
  for (const p of ["/ops-control", "/admin"]) {
    test(`${p} serves the Control Center sign-in (never the public app), not indexable`, async ({ page, request }) => {
      const r = await request.get(p); expect(r.headers()["x-robots-tag"]).toMatch(/noindex/);
      await page.goto(p);
      await expect(page.getByText(/Control Center/).first()).toBeVisible();          // sign-in, or «not available» where the admin API is disabled (FA4-only environments)
      await expect(page.getByRole("button", { name: UI.coverCta.es })).toHaveCount(0);   // never the public app
      const signIn = page.getByRole("link", { name: "Sign in" });
      if (await signIn.count()) await expect(signIn).toHaveAttribute("href", new RegExp(`returnTo=${encodeURIComponent(p)}`));
    });
  }
  test("the public Discovery page is not marked noindex by the app itself in production builds", async ({ request }) => {
    const r = await request.get("/discovery"); expect(r.headers()["x-robots-tag"]).toBeUndefined();
  });
});
