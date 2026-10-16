import { expect, test } from "@playwright/test";
import { UI } from "../src/fa4/copy/ui";
import { DISCOVERY_MODE, PREFIX, ROOT_MOUNT } from "./paths";

/**
 * Canonical routes: /discovery = public Discovery; /ops-control = RESERVED for the Discovery administration surface (blocked, never the legacy Control Center,
 * never a redirect to /admin). Technical paths: /fa4 keeps working (redirects to /discovery/ in the production-style build). In the production-style
 * build (E2E_PREFIX=/discovery) nothing of the legacy apps exists at all.
 */
test.describe("canonical routes", () => {
  test.beforeEach(async ({ page: _p }, info) => { test.skip(info.project.name !== "desktop-1440", "run once"); });
  for (const p of ROOT_MOUNT ? ["/", "/fa4"] : ["/discovery", "/discovery/", "/fa4"]) {
    test(`${p} serves Discovery`, async ({ page }) => {
      await page.goto(p);
      await expect(page.getByRole("button", { name: UI.coverCta.es })).toBeVisible();
      await expect(page.getByText("Discovery", { exact: true }).first()).toBeVisible();
      if (DISCOVERY_MODE) expect(new URL(page.url()).pathname, "canonical public path").toBe(ROOT_MOUNT ? "/" : "/discovery/");
    });
  }
  test("Discovery never links to or mentions the administration routes (cover and identity)", async ({ page }) => {
    await page.goto(ROOT_MOUNT ? "/" : "/discovery");
    for (const step of ["cover", "identity"]) {
      if (step === "identity") await page.getByRole("button", { name: UI.coverCta.es }).click();
      expect(await page.content()).not.toMatch(/ops-control|\/admin\b|Control Center/i);
      expect(await page.locator("a[href]").evaluateAll((as) => as.map((a) => a.getAttribute("href")))).not.toContainEqual(expect.stringMatching(/ops-control|\/admin/));
    }
  });
  for (const p of ["/ops-control", "/ops-control/", "/ops-control/projects/1"]) {
    test(`${p} is reserved: not available, not indexable, never the legacy console or the public app`, async ({ page, request }) => {
      const r = await request.get(p, { maxRedirects: 0 });
      expect(r.status()).toBe(404); expect(r.headers()["x-robots-tag"]).toMatch(/noindex/); expect(r.headers().location).toBeUndefined();
      await page.goto(p);
      await expect(page.locator("body")).not.toContainText(/Control Center|Sign in|Iniciar/);
      await expect(page.getByRole("button", { name: UI.coverCta.es })).toHaveCount(0);
    });
  }
  test("the legacy technical routes do not exist under the Discovery identity (production-style build)", async ({ request }) => {
    test.skip(!DISCOVERY_MODE, "root-built runs keep the legacy routes for internal staging");
    for (const p of [...(ROOT_MOUNT ? [] : ["/"]), "/admin", "/admin/projects", "/resume/x", "/api/fa/links/continue", "/api/admin/auth/login"]) expect((await request.get(p, { maxRedirects: 0 })).status(), p).toBe(404);
  });
  test("the public Discovery page is not marked noindex by the app itself when opened", async ({ request }) => {
    const r = await request.get(ROOT_MOUNT ? "/" : "/discovery/", { maxRedirects: 0 }); expect(r.status()).toBe(200); expect(r.headers()["x-robots-tag"]).toBeUndefined();
  });
});
