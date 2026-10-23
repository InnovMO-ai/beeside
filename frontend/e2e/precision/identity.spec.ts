import { expect, test } from "@playwright/test";
import { checkScreen, expectNoHorizontalOverflow, go } from "./helpers";

/** Premium identity at the bottom-left of the workspace: desktop (always visible in the sidebar) and mobile (inside the drawer). */
test("identity block: [initials] Person name / PREMIUM, compact, no overflow", async ({ page }, info) => {
  await go(page, "/center", { mock: "preset:mapConfirmed" });
  const mobile = info.project.name.startsWith("mobile");
  if (mobile) await page.getByRole("button", { name: /open menu/i }).click();
  const block = page.getByRole("group", { name: "Your account" });
  await expect(block).toBeVisible();
  await expect(block).toContainText("Mariana Torres");
  await expect(block).toContainText("PREMIUM");
  await expect(block.locator(".pz-avatar")).toHaveText("MT");
  const box = (await block.boundingBox())!;
  const vp = page.viewportSize()!;
  expect(box.x).toBeLessThan(40);                    // left edge
  expect(box.y + box.height).toBeGreaterThan(vp.height - 140); // bottom area (above only the mobile Help/tools row)
  expect(box.height).toBeLessThan(80);               // compact
  if (!mobile) await expect(page.locator(".pz-side")).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await page.screenshot({ path: `test-results/identity-${info.project.name}.png` });
  if (!mobile) await checkScreen(page, "identity");
});
