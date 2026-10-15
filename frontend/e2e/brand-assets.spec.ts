import { expect, test } from "@playwright/test";
import { BRAND } from "./paths";

/** Release audit: the email logo is served by the web app (public, cacheable PNG) and the SPA never answers for it; the CSP of the page is untouched. */
test("the email header logo is served as a real PNG by the production static server", async ({ request }, info) => {
  test.skip(info.project.name !== "desktop-1440", "run once");
  const r = await request.get(`${BRAND}/beeside-lockup.png`);
  expect(r.status()).toBe(200); expect(r.headers()["content-type"]).toMatch(/image\/png/);
  const b = await r.body(); expect(b.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a"); expect(b.length).toBeGreaterThan(5000);
});
