import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { ctl } from "./support/qa";
import { logisticsConfirmed, sendViaApi } from "./support/flows";
import { openWithCode, scanForbidden, pageText, T } from "./support/live";

/**
 * Contact action beside Operation Hub on the real stack. The platform here is the simulator, which provides no direct Sherpa channel
 * (the real hub's channel is not defined yet), so a project with an assigned Sherpa must get general "Contact beeside" and never
 * "Contact my Sherpa". The Operation Hub link is a configuration row of the QA database (the Center only offers "enter" with a link).
 */
test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop-light", "one viewport is enough; the mock suite covers every viewport"));

const DB = process.env.QA_DATABASE_URL ?? `postgres://beeside:beeside@localhost:5432/${process.env.QA_DB ?? "beeside_qa"}`;
function ensureHubLink(): void {
  execFileSync("psql", [DB, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-c",
    `INSERT INTO precision_config (key, locale, value) SELECT 'operation_hub_url', '*', '"https://hub.example.test/enter"'::jsonb WHERE NOT EXISTS (SELECT 1 FROM precision_config WHERE key = 'operation_hub_url' AND locale = '*' AND is_active)`]);
}

test("API: Sherpa assigned without a direct channel -> Contact beeside; no Sherpa -> no contact action; pending -> nothing", async () => {
  ensureHubLink();
  const { project, api, catId } = await logisticsConfirmed();
  await sendViaApi(api, catId);
  const hub = async (mode: string) => { await ctl("POST", "/oh/access", { projectId: project.projectId, mode }); return (await api.get("/center")).body.operationHub; };

  expect(await hub("pending")).toMatchObject({ state: "pending_access", url: null, contact: null });
  expect(await hub("accessible_without_sherpa")).toMatchObject({ state: "enter", contact: null });
  expect(await hub("accessible_with_sherpa")).toMatchObject({ state: "enter", contact: { kind: "beeside", email: "contact@beeside.you" } });
});

for (const locale of ["en", "es"] as const) {
  test(`browser (${locale}): the Center offers Contact beeside, to the configured address, and never Contact my Sherpa`, async ({ page }) => {
    ensureHubLink();
    const { project, api, catId } = await logisticsConfirmed(locale);
    await sendViaApi(api, catId);
    await ctl("POST", "/oh/access", { projectId: project.projectId, mode: "accessible_with_sherpa" });
    const { code } = await ctl<{ code: string }>("POST", "/link", { projectId: project.projectId });
    await openWithCode(page, code, locale);
    await page.getByRole("button", { name: T[locale].cont }).click(); // the cover is shown once per project
    const beeside = page.getByRole("button", { name: locale === "en" ? /^Contact beeside$/ : /^Contactar a beeside$/ });
    await expect(beeside).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: /Sherpa/ })).toHaveCount(0);
    await beeside.click();
    await expect(page.getByRole("dialog").getByRole("link", { name: locale === "en" ? "Send an email" : "Enviar un correo" })).toHaveAttribute("href", "mailto:contact@beeside.you");
    await page.keyboard.press("Escape");
    expect(scanForbidden(await pageText(page))).toEqual([]);
  });
}
