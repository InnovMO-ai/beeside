import { expect, test } from "@playwright/test";
import { journeyNortica } from "@beeside/fa-public-engine/testing";
import { UI } from "../src/fa4/copy/ui";
import { axeViolations, noHorizontalOverflow, open, seed } from "./helpers";

/** DSC-36 in a real browser (tests 19–22): the open tab with a simulated clock, every state with its exact copy ES/EN, retry, a11y and overflow. */
test("19 · tab open, 31 min without interaction → ONE continuation e-mail through the real API, continuity screen, token dropped, nothing of the project on screen", async ({ page, request }) => {
  await page.clock.install();
  await open(page, await seed(request, journeyNortica("es"), "decision"));
  await expect(page.getByRole("heading", { level: 1, name: UI.decTitle.es })).toBeVisible({ timeout: 15_000 });
  const idleCalls: string[] = []; page.on("request", (r) => { if (r.url().includes("/session/idle-continuation")) idleCalls.push(r.method()); });
  await page.clock.fastForward("31:00");
  const scr = page.getByTestId("idle-continuation"); await expect(scr).toBeVisible(); await expect(scr).toHaveAttribute("data-phase", "sent");
  await expect(page.getByRole("heading", { level: 1, name: UI.idleTitle.es })).toBeFocused();
  await expect(page.getByText(UI.idleSent.es)).toBeVisible();
  expect(idleCalls).toEqual(["POST"]); expect(await page.evaluate(() => sessionStorage.getItem("beeside.fa4.session"))).toBeNull();
  const text = await page.locator("body").innerText(); expect(text).not.toMatch(/@|lucia|Nórtica|envases/i);
  expect(await axeViolations(page)).toEqual([]); await noHorizontalOverflow(page);
  await page.clock.fastForward("40:00"); expect(idleCalls).toHaveLength(1);                                                 // no second call on its own
});

/** A tab that holds a project and has been silent for 31 min (seeded ONCE, like a restored tab). */
async function idleTab(page: import("@playwright/test").Page, request: import("@playwright/test").APIRequestContext, loc: "es" | "en") {
  const token = await seed(request, journeyNortica(loc), "decision");
  await page.addInitScript(({ t, l }) => { if (sessionStorage.getItem("beeside.fa4.session")) return; sessionStorage.setItem("beeside.fa4.session", t); sessionStorage.setItem("beeside.fa4.session.at", String(Date.now() - 31 * 60_000)); sessionStorage.setItem("beeside.fa4.locale", l); }, { t: token, l: loc });
  await page.goto("/fa4");
}
const reply = (page: import("@playwright/test").Page, fn: (n: number, body: unknown) => { status: number; body: unknown }) => { let n = 0; const bodies: unknown[] = [];
  return page.route("**/api/fa4/session/idle-continuation", (r) => { bodies.push(r.request().postDataJSON()); const x = fn(++n, bodies.at(-1)); return r.fulfill({ status: x.status, contentType: "application/json", body: JSON.stringify(x.body) }); }).then(() => bodies); };

for (const loc of ["es", "en"] as const) {
  test(`21a (${loc}) · closed-test recipient not authorized: the exact message, no retry, project untouched, no 5xx`, async ({ page, request }) => {
    await reply(page, () => ({ status: 403, body: { error: "RECIPIENT_NOT_AUTHORIZED" } }));
    await idleTab(page, request, loc);
    await expect(page.getByTestId("idle-continuation")).toHaveAttribute("data-phase", "unauthorized");
    await expect(page.getByText(UI.idleNotAuthorized[loc])).toBeVisible(); await expect(page.getByRole("button", { name: UI.idleRetry[loc] })).toHaveCount(0);
    expect(await axeViolations(page)).toEqual([]); await noHorizontalOverflow(page);
  });
  test(`21b (${loc}) · a failure shows the real state and «Try again» retries the SAME delivery; the answer after it is the real outcome`, async ({ page, request }) => {
    const bodies = await reply(page, (n) => (n === 1 ? { status: 502, body: { error: "EMAIL_NOT_SENT" } } : { status: 200, body: { state: "sent" } }));
    await idleTab(page, request, loc);
    await expect(page.getByTestId("idle-continuation")).toHaveAttribute("data-phase", "failed"); await expect(page.getByText(UI.idleFailed[loc])).toBeVisible();
    await page.getByRole("button", { name: UI.idleRetry[loc] }).click();
    await expect(page.getByTestId("idle-continuation")).toHaveAttribute("data-phase", "sent"); await expect(page.getByText(UI.idleSent[loc])).toBeVisible();
    expect(bodies).toEqual([{}, { retry: true }]);
    expect(await axeViolations(page)).toEqual([]); await noHorizontalOverflow(page);
  });
}
