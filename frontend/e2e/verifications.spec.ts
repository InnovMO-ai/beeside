import fs from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { syncComponents } from "@beeside/fa-public-engine";
import { journeyC, journeyNortica } from "@beeside/fa-public-engine/testing";
import { UI } from "../src/fa4/copy/ui";
import { open, seed } from "./helpers";

/** DSC-27 and DSC-09 — verifications (DSC-09 fixed: one message per country): evidence lists / screenshots are written to docs/fa4/visual (local, git-ignored) and summarised in the traceability doc. */
const OUT = "../docs/fa4/visual/verifications"; fs.mkdirSync(OUT, { recursive: true });
const norm = (t: string | null) => (t ?? "").replace(/\s+/g, " ").trim();
const questions = (page: Page) => page.evaluate(() => {
  const n = (t: string | null) => (t ?? "").replace(/\s+/g, " ").trim();
  return [...document.querySelectorAll("main h1, main .qtitle, main legend.label, main label.label, main .blk > h2")].map((e) => n(e.textContent)).filter(Boolean);
});

async function walk(page: Page, label: string) {
  const screens: Array<{ screen: string; questions: string[] }> = [];
  for (let i = 0; i < 14; i++) {
    if (await page.getByTestId("result-screen").count()) break;
    const qs = await questions(page); const h1 = qs[0] ?? "";
    screens.push({ screen: h1, questions: qs.slice(1) });
    await page.locator(".navbar .btn.primary").click(); await page.waitForTimeout(450);
  }
  await expect(page.getByTestId("result-screen")).toBeVisible({ timeout: 20_000 });
  fs.writeFileSync(`${OUT}/dsc27-${label}.json`, JSON.stringify(screens, null, 2));
  return screens;
}

for (const [label, shortcut] of [["normal", false], ["shortcut", true]] as const) {
  test(`DSC-27 (${label} path) — no question is repeated along the path; ${shortcut ? "what is not marked stays «no indicado»" : "every topic gets its own status question"}`, async ({ page, request }, info) => {
    test.skip(info.project.name !== "desktop-1440" && info.project.name !== "mobile-375", "two viewports are enough for the evidence");
    const a = JSON.parse(JSON.stringify(journeyC("es", "unknown"))); a.knowsNeeds = shortcut;
    if (!shortcut) { a.fronts = {}; }
    await open(page, await seed(request, a, "decision"));
    await expect(page.getByRole("heading", { level: 1, name: UI.decTitle.es })).toBeVisible();
    const screens = await walk(page, `${label}-${info.project.name}`);
    const all = screens.flatMap((s) => [s.screen, ...s.questions]);
    expect(screens.length).toBeGreaterThan(2);
    const dup = all.filter((q, i) => all.indexOf(q) !== i);
    expect(dup, `repeated question text along the ${label} path`).toEqual([]);
    if (shortcut) {
      await expect(page.getByText(new RegExp(`^${UI.notIndicated.es}`)).first()).toBeVisible();                                 // unmarked topics are «no indicado» (D-079)
      await expect(page.getByText(UI.notIndicatedNote.es).first()).toBeVisible();
      for (const bad of ["Ya resuelto", "En marcha"]) expect(norm(await page.getByTestId("result-screen").innerText())).not.toContain(`${bad} ·`);
    }
    await page.screenshot({ path: `${OUT}/dsc27-${label}-yev-${info.project.name}.png`, fullPage: true });
  });
}

test("DSC-09 — screenshots + counts: Mexico / Chile + South Korea / Mexico + Chile + South Korea", async ({ page, request }, info) => {
  test.skip(info.project.name !== "desktop-1440", "evidence once");
  const mk = (isos: string[], same: boolean) => { const a = JSON.parse(JSON.stringify(journeyNortica("es"))); const base = a.components[0];
    a.destinations = { list: isos.map((iso) => ({ iso })), open: false, sameInAll: same }; a.fronts = {};
    a.components = same ? [{ ...base, id: "c1", destinations: isos }] : isos.map((iso) => ({ ...base, id: iso.toLowerCase(), destinations: [iso] }));
    return syncComponents(a); };
  const NO = "beeside aún no cuenta con cobertura activa en este país.";
  const table: Record<string, unknown> = {};
  for (const [name, isos, same] of [["mexico", ["MX"], true], ["chile-corea", ["CL", "KR"], true], ["mexico-chile-corea", ["MX", "CL", "KR"], false]] as const) {
    const p = await page.context().newPage(); const token = await seed(request, mk([...isos], same), "extra");
    await p.addInitScript((t) => { sessionStorage.setItem("beeside.fa4.session", t); sessionStorage.setItem("beeside.fa4.session.at", String(Date.now())); }, token);
    await p.goto("/fa4"); await p.getByRole("button", { name: UI.seeResult.es }).click(); await expect(p.getByTestId("result-screen")).toBeVisible({ timeout: 20_000 });
    const text = await p.getByTestId("result-screen").innerText();
    table[name] = { noCoverageMessages: text.split(NO).length - 1, premiumCta: await p.getByRole("button", { name: "Start Your Expansion" }).count(), premiumBlock: await p.getByTestId("premium-continuation").count() };
    await p.screenshot({ path: `${OUT}/dsc09-${name}.png`, fullPage: true }); await p.close();
  }
  fs.writeFileSync(`${OUT}/dsc09-table.json`, JSON.stringify(table, null, 2)); console.log("DSC09", JSON.stringify(table));
  const t = table as Record<string, { noCoverageMessages: number; premiumCta: number; premiumBlock: number }>;
  expect(t["mexico"]!.noCoverageMessages).toBe(0); expect(t["mexico"]!.premiumCta).toBe(1);                                 // Mexico: states, no coverage message, Premium with value
  expect(t["chile-corea"]!.noCoverageMessages).toBe(2); expect(t["chile-corea"]!.premiumCta).toBe(0);                       // DSC-09: ONE message per country (2 countries → 2)
  expect(t["mexico-chile-corea"]!.noCoverageMessages).toBe(2);                                                              // states only for Mexico; one message for each of the other two
});

/** J-check (condition of help entry J): from the YEV PREVIEW you can go back, edit and regenerate until you send it by e-mail; afterwards the result is closed. Evidence only — no product change. */
test("J-check — preview → «Corregir algo» → edit → regenerate (reflects the edit) → send by e-mail → closed (no edit, server refuses saves)", async ({ page, request }, info) => {
  test.skip(info.project.name !== "desktop-1440" && info.project.name !== "mobile-375", "two viewports are enough");
  await open(page, await seed(request, journeyNortica("es"), "extra"));
  await page.getByRole("button", { name: UI.seeResult.es }).click(); await expect(page.getByTestId("result-screen")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("Querétaro")).toHaveCount(0);
  await page.getByRole("button", { name: UI.fixSomething.es }).click();                                                            // back from the PREVIEW
  await expect(page.getByRole("heading", { level: 1, name: UI.destTitle.es })).toBeVisible();
  await page.getByLabel(`${UI.region.es} — México`).fill("Querétaro");                                                           // edit an answer
  for (let i = 0; i < 14 && !(await page.getByTestId("result-screen").count()); i++) { await page.locator(".navbar .btn.primary").click(); await page.waitForTimeout(500); }
  await expect(page.getByTestId("result-screen")).toBeVisible({ timeout: 20_000 });                                                // regenerate
  await expect(page.getByText("Querétaro").first()).toBeVisible();                                                                  // the preview reflects the correction
  await expect(page.getByRole("button", { name: UI.fixSomething.es })).toBeVisible();                                              // still editable before sending
  await page.getByRole("button", { name: UI.emailResult.es }).click();                                                              // the e-mail IS the delivery (D-156)
  await expect(page.getByText(UI.deliveredNote.es)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: UI.fixSomething.es })).toHaveCount(0);                                             // closed: no edit offered
  const refused = await page.evaluate(async () => {
    const t = sessionStorage.getItem("beeside.fa4.session")!; const h = { "X-Fa4-Session": t, "Content-Type": "application/json" };
    const s = await (await fetch("/api/fa4/session", { headers: h })).json();
    const r = await fetch("/api/fa4/session", { method: "PUT", headers: h, body: JSON.stringify({ answers: s.answers, step: "decision" }) });
    return { status: r.status, body: await r.json() };
  });
  expect(refused.status).toBe(409); expect(refused.body.error).toBe("ALREADY_DELIVERED");                                         // the server refuses any later save
});
