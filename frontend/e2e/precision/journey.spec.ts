import { expect, test } from "@playwright/test";
import { checkScreen, drive, go, h1, loadTiming, pathEnds, recordTiming } from "./helpers";

/**
 * The whole customer path, from the first-entry cover to the send confirmation, in one go.
 * It runs in the four projects (desktop and mobile, light and dark); accessibility, overflow, copy and 44px targets are checked at every stop.
 */
test("happy path: Cover to Center to Understanding to Service Map to Category to CRP to Preview to Send to confirmation", async ({ page }, info) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|404/.test(m.text())) errors.push(m.text()); });

  const t0 = Date.now();
  await go(page, "", { mock: "turn:120" });
  await expect(h1(page)).toHaveText(/Your project, defined with precision/);
  recordTiming(info, "cover_interactive_ms", Date.now() - t0);
  const timing = await loadTiming(page);
  recordTiming(info, "cover_fcp_ms", timing.fcp);
  recordTiming(info, "cover_dom_content_loaded_ms", timing.domContentLoaded);
  expect(page.url(), "the one-time code leaves the address bar").not.toContain("code=");
  await checkScreen(page, "cover");

  const step = async (name: string, fn: () => Promise<void>) => { const s = Date.now(); await fn(); recordTiming(info, name, Date.now() - s); };

  await step("nav_cover_to_center_ms", async () => {
    await page.getByRole("button", { name: /^Continue/ }).or(page.getByRole("link", { name: /^Continue/ })).first().click();
    await expect(page).toHaveURL(pathEnds("/precision/center"));
    await expect(page.getByRole("link", { name: /^Start/ }).first()).toBeVisible();
  });
  await expect(h1(page)).toBeVisible();
  await checkScreen(page, "center (first visit)");

  // Understanding
  await step("nav_center_to_understanding_ms", async () => {
    await page.getByRole("link", { name: /^Start|Begin|Continue/ }).first().click();
    await expect(page).toHaveURL(pathEnds("/understanding"));
    await expect(page.getByRole("log")).toBeVisible();
    await expect(page.getByRole("button", { name: "Yes, that is right" })).toBeVisible();
  });
  await checkScreen(page, "understanding");
  const toMap = page.getByRole("link", { name: /Review My Service Map/ }).or(page.getByRole("button", { name: /Review My Service Map/ })).first();
  await drive(page, toMap);
  await checkScreen(page, "understanding (complete)");

  // My Service Map
  await step("nav_understanding_to_map_ms", async () => {
    await toMap.click();
    await expect(page).toHaveURL(pathEnds("/service-map"));
    await expect(page.getByRole("button", { name: /^Confirm My Service Map/ })).toBeVisible();
  });
  await checkScreen(page, "my service map");
  await page.getByRole("button", { name: /^Confirm My Service Map/ }).click();
  const dialog = page.getByRole("dialog");
  if (await dialog.isVisible().catch(() => false)) {
    await checkScreen(page, "confirm my service map dialog");
    await dialog.getByRole("button", { name: /^Confirm/ }).click();
  }
  await expect(page.getByText(/Your map is confirmed|My Service Map confirmed|confirmed/i).first()).toBeVisible();
  await checkScreen(page, "my service map (confirmed)");

  // Back to the Center, then the first category
  await page.getByRole("link", { name: /Precision Center/ }).or(page.getByRole("button", { name: /Go to Precision Center/ })).first().click();
  await expect(page).toHaveURL(pathEnds("/precision/center"));
  await expect(page.getByRole("link", { name: /Start|Continue/ }).filter({ hasText: /Logistics/ }).first()).toBeVisible();
  await checkScreen(page, "center (map confirmed)");
  await page.getByRole("link", { name: /Logistics/ }).filter({ hasText: /Start|Continue|Open/ }).first().click();
  await expect(page).toHaveURL(pathEnds("/category/logistics"));

  // Category conversation
  const toCrp = page.getByRole("link", { name: /Review summary/ }).or(page.getByRole("button", { name: /Review summary/ })).first();
  await drive(page, toCrp, { idkAt: 3 });
  await checkScreen(page, "category conversation (complete)");

  // CRP
  await step("nav_category_to_crp_ms", async () => {
    await toCrp.click();
    await expect(page).toHaveURL(pathEnds("/summary"));
    await expect(page.getByRole("button", { name: /^Confirm CRP/ })).toBeVisible();
  });
  await expect(page.getByText(/Pending Information/)).toBeVisible();
  await checkScreen(page, "crp");
  await page.getByRole("button", { name: /^Confirm CRP/ }).click();
  const crpDialog = page.getByRole("dialog");
  await expect(crpDialog).toBeVisible();
  await checkScreen(page, "confirm crp dialog");
  await crpDialog.getByRole("button", { name: /^Confirm$/ }).click();
  await expect(page.getByText(/CRP confirmed/).first()).toBeVisible();
  await checkScreen(page, "crp (confirmed)");

  // Preview, then send
  await step("nav_crp_to_preview_ms", async () => {
    await page.getByRole("link", { name: /Preview/ }).or(page.getByRole("button", { name: /Preview/ })).first().click();
    await expect(page).toHaveURL(pathEnds("/preview"));
    await expect(page.getByRole("button", { name: /^Send to Operation Hub/ })).toBeVisible();
  });
  await checkScreen(page, "preview before send");
  await page.getByRole("button", { name: /^Send to Operation Hub/ }).click();
  await step("send_to_confirmation_ms", async () => {
    await expect(page).toHaveURL(pathEnds("/sent"), { timeout: 20000 });
    await expect(h1(page)).toHaveText(/Sent to Operation Hub/);
  });
  await checkScreen(page, "sent");

  // The Center reflects it
  await page.getByRole("link", { name: /Back to Precision Center|Go to Precision Center/ }).first().click();
  await expect(page).toHaveURL(pathEnds("/center"));
  await expect(page.getByText(/^Sent$/).filter({ visible: true }).first()).toBeVisible();
  await checkScreen(page, "center (sent)");

  expect(errors, "no console errors or page errors during the journey").toEqual([]);
});
