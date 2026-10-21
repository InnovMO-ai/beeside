import { expect, test } from "@playwright/test";
import { journeyB, journeyNortica } from "@beeside/fa-public-engine/testing";
import { UI } from "../src/fa4/copy/ui";
import { axeViolations, noHorizontalOverflow, open, seed } from "./helpers";

/** Discovery v1.0 P1 batch (Product-approved, DSC-xx) in a real browser, every viewport. Changes are removals / strings: IDs, saved data and logic are untouched. */

test("DSC-04 — no live echo «Lo que nos cuentas» under the reason field; the text is still saved and reaches the next steps", async ({ page, request }) => {
  await open(page, await seed(request, journeyNortica("es"), "reason"));
  const box = page.getByLabel(UI.reasonWords.es); await expect(box).toBeVisible();
  await box.fill("Texto de prueba del motivo, ficticio.");
  await expect(page.getByText("Lo que nos cuentas")).toHaveCount(0); await expect(page.getByText("What you're telling us")).toHaveCount(0);
  await expect(page.locator(".card.soft .quote")).toHaveCount(0);
  await page.waitForTimeout(900);                                                                                       // autosave (500 ms debounce)
  await page.reload(); await expect(page.getByLabel(UI.reasonWords.es)).toHaveValue("Texto de prueba del motivo, ficticio.");
  await noHorizontalOverflow(page);
});

test("DSC-05 — no visible question numbering anywhere on the thematic screens", async ({ page, request }) => {
  await open(page, await seed(request, journeyNortica("es"), "activators"));
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  const heads = await page.$$eval(".qtitle", (els) => els.map((e) => (e.textContent ?? "").trim()));
  expect(heads.length).toBeGreaterThan(0);
  for (const h of heads) expect(h).not.toMatch(/^\d+\s*\S/);                                                             // no «1», «2»… in front of the question
  await expect(page.locator(".qnum")).toHaveCount(0);
  expect(await page.locator("ol.qlist").count()).toBe(0);
  expect(await axeViolations(page)).toEqual([]);
});

test("DSC-11 — «Aún no he empezado nada» no longer exists on the topics screen (and nothing else changes: statuses are still chosen one by one)", async ({ page, request }) => {
  const a = JSON.parse(JSON.stringify(journeyB("es"))); a.knowsNeeds = false; a.fronts = {};
  await open(page, await seed(request, a, "fronts_status"));
  await expect(page.getByRole("heading", { level: 1, name: UI.topicsTitle.es })).toBeVisible();
  await expect(page.getByRole("button", { name: "Aún no he empezado nada" })).toHaveCount(0);
  await expect(page.getByText("Aún no he empezado nada")).toHaveCount(0); await expect(page.getByText("I haven't started anything yet")).toHaveCount(0);
  await expect(page.getByRole("radio", { name: UI.statuses.pending.es }).first()).toBeVisible();                       // the per-topic status controls remain
});

for (const loc of ["es", "en"] as const) {
  test(`DSC-06 (${loc}) — «Detalles adicionales» section: stage label, title, «Otros detalles (opcional)»; no «Algo más» left in the UI`, async ({ page, request }) => {
    await open(page, await seed(request, journeyNortica(loc), "support_values"));
    await expect(page.getByRole("heading", { level: 1, name: UI.valuesTitle[loc] })).toBeVisible();
    await page.getByRole("button", { name: UI.next[loc], exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: loc === "es" ? "¿Hay algo más de tu proyecto que nos quieras contar?" : "Is there anything else about your project you'd like to tell us?" })).toBeVisible();
    await expect(page.getByLabel(loc === "es" ? "Otros detalles (opcional)" : "Other details (optional)")).toBeVisible();
    await expect(page.getByText(UI.extraLead[loc])).toBeVisible();                                                           // «Nada depende de este paso.» stays
    const body = await page.locator("body").innerText();
    expect(body).toContain(loc === "es" ? "Detalles adicionales" : "Additional details");                                  // eyebrow + stage label
    expect(body).not.toMatch(/Algo más|Anything else/);
    await noHorizontalOverflow(page);
  });
  test(`DSC-22 (${loc}) — help under «what will you sell, produce or buy»; the three options are unchanged`, async ({ page, request }) => {
    await open(page, await seed(request, journeyNortica(loc), "activity:c1"));
    await expect(page.getByText(loc === "es" ? "Bienes físicos incluye productos terminados, materias primas y equipos." : "Physical goods include finished products, raw materials and equipment.")).toBeVisible();
    for (const o of [UI.withs.goods[loc], UI.withs.services[loc], UI.withs.digital[loc]]) await expect(page.getByRole("checkbox", { name: o, exact: true })).toBeVisible();
    await expect(page.getByRole("checkbox")).toHaveCount(6 + 3);                                                              // 6 activities + the same 3 classes
  });
  test(`DSC-23 (${loc}) — role: example placeholder and help, still optional free text`, async ({ page }) => {
    await page.goto("/fa4"); if (loc === "en") await page.getByRole("button", { name: /English/ }).click();
    await page.getByRole("button", { name: UI.coverCta[loc] }).click();
    const role = page.getByLabel(UI.role[loc]);
    await expect(role).toHaveAttribute("placeholder", loc === "es" ? "Por ejemplo: director general, asesor externo" : "For example: CEO, external advisor");
    await expect(page.getByText(loc === "es" ? "Puedes indicar más de uno." : "You can list more than one.")).toBeVisible();
    await role.fill("Fundadora, asesora externa"); await expect(role).toHaveValue("Fundadora, asesora externa");           // free text, more than one allowed
  });
  test(`DSC-28 (${loc}) — personal need is an optional Yes / No (same boolean): Yes → true, No → false, left empty → false`, async ({ page, request }) => {
    await open(page, await seed(request, journeyNortica(loc), "extra"));
    const q = page.getByRole("group", { name: UI.personal[loc] });
    await expect(q).toBeVisible(); await expect(q.getByText(UI.personalHelp[loc])).toBeVisible();
    await expect(q.getByRole("radio")).toHaveCount(2); await expect(q.getByRole("radio", { checked: true })).toHaveCount(0);   // empty by default: nothing pre-selected
    await expect(q.getByRole("checkbox")).toHaveCount(0);
    await q.getByRole("radio", { name: UI.yes[loc], exact: true }).check(); await page.waitForTimeout(900);
    await page.reload(); await expect(page.getByRole("group", { name: UI.personal[loc] }).getByRole("radio", { name: UI.yes[loc], exact: true })).toBeChecked();   // saved true
    await page.getByRole("group", { name: UI.personal[loc] }).getByRole("radio", { name: UI.no[loc], exact: true }).check();
    await expect(page.getByRole("group", { name: UI.personal[loc] }).getByRole("radio", { name: UI.no[loc], exact: true })).toBeChecked(); await page.waitForTimeout(900);
    await page.reload(); await expect(page.getByRole("group", { name: UI.personal[loc] }).getByRole("radio", { checked: true })).toHaveCount(0);   // false: the boolean cannot tell «No» from empty, nothing is pre-selected
  });
}

test("DSC-14 — Stabilization notice: 15 px compact text; no focus ring when opened by a click, ring visible with the keyboard; still accessible", async ({ page }, info) => {
  await page.route("**/config.json", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ closedTest: true, label: "PRUEBA CONTROLADA · datos ficticios · no comercial" }) }));
  await page.goto("/fa4"); await page.getByRole("button", { name: UI.coverCta.es }).click();                                  // opened with the mouse
  const dlg = page.getByTestId("stabilization-notice"); await expect(dlg).toBeVisible();
  const btn = page.getByRole("button", { name: UI.stabConfirm.es }); await expect(btn).toBeFocused();
  const sizes = await dlg.locator(".sheet-body p").evaluateAll((ps) => ps.map((p) => parseFloat(getComputedStyle(p).fontSize)));
  for (const f of sizes) expect(f).toBeGreaterThanOrEqual(15), expect(f).toBeLessThanOrEqual(16);
  const ring = () => btn.evaluate((e) => { const s = getComputedStyle(e); return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) }; });
  expect((await ring()).style === "none" || (await ring()).width === 0).toBe(true);                                         // no ring on a mouse open
  await page.keyboard.press("Shift"); await expect(btn).toBeFocused();                                                      // any key: keyboard modality (Tab would leave the single control)
  const r = await ring(); expect(r.style).not.toBe("none"); expect(r.width).toBeGreaterThanOrEqual(2);                      // keyboard → visible focus ring (WCAG 2.4.7)
  expect(await axeViolations(page)).toEqual([]); await noHorizontalOverflow(page);
  const box = await dlg.boundingBox(); expect(box!.height).toBeLessThanOrEqual(page.viewportSize()!.height - 16);          // fits without clipping
  void info;
});
