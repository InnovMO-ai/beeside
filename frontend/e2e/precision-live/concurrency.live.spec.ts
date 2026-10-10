import { expect, test } from "@playwright/test";
import { Api, ctl, facts, seed, stats } from "./support/qa";
import { logisticsConfirmed, newKey } from "./support/flows";
import { SCRIPT, assistantTurns, openWithCode, pageText, settled } from "./support/live";

/**
 * Concurrency (QA step 8), against the real backend and the real database through the production static server.
 * Several requests are fired at the same instant for the same project. Each case asserts: no server error, an
 * explicit answer for every request, and exactly one business effect (one stored turn / one confirmation / one delivery).
 */
test.beforeEach(({}, info) => test.skip(info.project.name !== "desktop-light", "API-level checks do not depend on the viewport"));

const OK_OR_CONFLICT = (s: number) => s === 200 || s === 409;
const lastCard = (th: any) => [...th.turns].reverse().find((t: any) => t.confirmCard)?.confirmCard;
/** Confirm the two inherited-value cards one at a time (the normal route). */
async function passCards(api: Api): Promise<void> {
  for (let i = 0; i < 2; i++) {
    const card = lastCard((await api.get("/understanding")).body);
    const r = await api.post("/understanding/turns", { turnKey: newKey("u"), text: card.confirmLabel, confirm: { token: card.token, intent: "confirm" } });
    expect(r.status).toBe(200);
  }
}

test("parallel turns: the same turn key sent 8 times at once is stored once and answered once", async () => {
  const project = await seed("start");
  const api = await Api.open(project.projectId, "en");
  await passCards(api);
  const turnKey = newKey("same");
  const text = "We make dry packaged food products with a long shelf life, mainly snacks and cereals";
  const rs = await Promise.all(Array.from({ length: 8 }, () => api.post("/understanding/turns", { turnKey, text })));
  expect(rs.map((r) => r.status).filter((s) => s >= 500), "no server error").toEqual([]);
  expect(rs.every((r) => OK_OR_CONFLICT(r.status) || r.status === 202 || r.status === 429)).toBe(true);
  const th = (await api.get("/understanding")).body;
  expect(th.turns.filter((t: { role: string; text: string }) => t.role === "client" && t.text === text), "one client turn in the database").toHaveLength(1);
  const assistantAfter = th.turns.filter((t: { role: string }) => t.role === "assistant").length;
  const again = (await api.get("/understanding")).body;
  expect(again.turns.filter((t: { role: string }) => t.role === "assistant").length, "stable after the burst").toBe(assistantAfter);
  const f = (await facts(project.projectId)).facts.filter((x) => x.field_key === "precision.pa_expansion_product_or_service");
  expect(f.length, "at most one current fact for the product").toBeLessThanOrEqual(1);
});

test("parallel turns: different answers fired at once on one category never produce a server error and the thread stays consistent", async () => {
  const project = await seed("logistics_ready");
  const api = await Api.open(project.projectId, "en");
  const sa = await api.categoryId(/advisory/i);
  const texts = ["Monthly", "Ocean", "Does the plan make commercial sense at our expected volumes?", "Mexico", "Market", "Feasibility report"];
  const rs = await Promise.all(texts.map((text) => api.post(`/categories/${sa}/turns`, { turnKey: newKey("p"), text })));
  expect(rs.map((r) => r.status).filter((s) => s >= 500), "no server error").toEqual([]);
  expect(rs.every((r) => OK_OR_CONFLICT(r.status) || r.status === 429), JSON.stringify(rs.map((r) => r.status))).toBe(true);
  const cat = (await api.get(`/categories/${sa}`)).body;
  const turns: { id: string; role: string }[] = cat.thread.turns;
  const clients = turns.filter((t) => t.role === "client");
  const accepted = rs.filter((r) => r.status === 200).length;
  expect(clients.length, "every accepted turn is stored exactly once").toBe(accepted);
  const ids = turns.map((t) => t.id);
  expect(new Set(ids).size, "no duplicated turn rows").toBe(ids.length);
  // the project still works afterwards
  expect((await api.get("/center")).status).toBe(200);
  expect((await api.get(`/categories/${sa}/crp`)).status).toBe(200);
});

test("parallel Confirm of a CRP: 6 requests with the same key and 6 with different keys give one confirmation", async () => {
  const project = await seed("logistics_ready");
  const api = await Api.open(project.projectId, "en");
  const cat = await api.categoryId();
  const before = (await api.get(`/categories/${cat}/crp`)).body;
  expect(before.state ?? before.crpState ?? before.status).not.toMatch(/confirmed|sent/);
  const same = newKey("c");
  const rs = await Promise.all([
    ...Array.from({ length: 6 }, () => api.post(`/categories/${cat}/crp/confirm`, { requestKey: same })),
    ...Array.from({ length: 6 }, () => api.post(`/categories/${cat}/crp/confirm`, { requestKey: newKey("c") })),
  ]);
  expect(rs.map((r) => r.status).filter((s) => s >= 500), "no server error").toEqual([]);
  expect(rs.every((r) => OK_OR_CONFLICT(r.status)), JSON.stringify(rs.map((r) => r.status))).toBe(true);
  expect(rs.some((r) => r.status === 200)).toBe(true);
  const after = (await api.get(`/categories/${cat}/crp`)).body;
  const versions = new Set(rs.filter((r) => r.status === 200).map((r) => JSON.stringify(r.body.crpVersion ?? r.body.version ?? r.body.crpId ?? r.body.confirmedAt ?? r.body.crpHash ?? "")));
  expect(versions.size, `one confirmed version (saw ${[...versions].join(" | ")})`).toBe(1);
  expect(JSON.stringify(after)).toMatch(/confirmed/i);
});

test("parallel Send: 10 simultaneous sends of the same preview produce exactly one delivery and one call to the platform", async () => {
  const { project, api, catId } = await logisticsConfirmed();
  const pv = (await api.get(`/categories/${catId}/preview`)).body;
  await ctl("POST", "/oh/slow", { projectId: project.projectId, ms: 400 });
  const rs = await Promise.all(Array.from({ length: 10 }, () => api.post(`/categories/${catId}/send`, { previewChecksum: pv.previewChecksum })));
  expect(rs.map((r) => r.status).filter((s) => s >= 500), "no server error").toEqual([]);
  expect(rs.every((r) => OK_OR_CONFLICT(r.status) || r.status === 202), JSON.stringify(rs.map((r) => r.status))).toBe(true);
  const st = await stats(project.projectId);
  expect(st.deliveredKeys, "one delivered key").toBe(1);
  expect(st.deliveryByState.delivered ?? 0, "one delivered row").toBe(1);
  expect(st.publishCalls, "one call to the platform").toBe(1);
  // (platformStored is a global counter of the shared simulator, so it is not asserted when other projects run in parallel)
  const c = (await api.get("/center")).body;
  expect(c.categories.find((k: { id: string }) => k.id === catId).status).toBe("sent");
});

test("parallel Confirm of an inherited-value card: the same token 6 times at once changes the thread once", async () => {
  const project = await seed("start");
  const api = await Api.open(project.projectId, "en");
  const card = lastCard((await api.get("/understanding")).body);
  const turnKeys = Array.from({ length: 6 }, () => newKey("u"));
  const rs = await Promise.all(turnKeys.map((turnKey) => api.post("/understanding/turns", { turnKey, text: card.confirmLabel, confirm: { token: card.token, intent: "confirm" } })));
  expect(rs.map((r) => r.status).filter((s) => s >= 500), "no server error").toEqual([]);
  // the card token is single-use: one request is accepted, the others are refused with a plain, retry-free message (never a 5xx, never a second effect)
  expect(rs.filter((r) => r.status === 200).length, JSON.stringify(rs.map((r) => r.status))).toBe(1);
  for (const r of rs.filter((x) => x.status !== 200)) expect(r.status === 400 || r.status === 409).toBe(true);
  for (const r of rs.filter((x) => x.status !== 200)) expect(r.body.retryable).toBe(false);
  const th = (await api.get("/understanding")).body;
  const next = lastCard(th);
  expect(next?.token, "the thread moved to the next card exactly once, not past it").not.toBe(card.token);
  const confirmedTurns = th.turns.filter((t: { role: string; text: string }) => t.role === "client" && t.text.startsWith(card.confirmLabel.replace(/\.$/, "")));
  expect(confirmedTurns.length, "one stored confirmation for that card").toBe(1);
});

test("parallel confirm of My Service Map from two sessions, six requests: one confirmation, the rest refused or repeated", async () => {
  const project = await seed("start");
  const a = await Api.open(project.projectId, "en");
  const b = await Api.open(project.projectId, "en");
  await passCards(a);
  for (const t of SCRIPT.en.understanding) expect((await a.post("/understanding/turns", { turnKey: newKey("u"), text: t })).status).toBe(200);
  expect((await a.get("/understanding")).body.understandingState).toBe("ready_to_confirm");
  const rs = await Promise.all([a, b, a, b, a, b].map((x) => x.post("/service-map/confirm", { requestKey: newKey("m") })));
  expect(rs.map((r) => r.status).filter((s) => s >= 500), "no server error").toEqual([]);
  expect(rs.every((r) => OK_OR_CONFLICT(r.status)), JSON.stringify(rs.map((r) => r.status))).toBe(true);
  expect(rs.some((r) => r.status === 200)).toBe(true);
  const map = (await a.get("/service-map")).body;
  expect(JSON.stringify(map)).toMatch(/confirmed/i);
  const center = (await a.get("/center")).body;
  expect(center.categories.length, "categories created once, not once per request").toBe(new Set(center.categories.map((k: { id: string }) => k.id)).size);
  const labels = center.categories.map((k: { label: string }) => k.label);
  expect(new Set(labels).size, `no duplicated category: ${labels.join(", ")}`).toBe(labels.length);
});

test("double click on a confirmation card in the browser: one confirmation, no error shown, the thread moves on once", async ({ page }) => {
  const project = await seed("start");
  await openWithCode(page, project.code, "en", "/precision/understanding");
  await expect(page.locator(".pz-confirm")).toBeVisible();
  const before = await assistantTurns(page).count();
  await page.locator(".pz-confirm").last().getByRole("button", { name: SCRIPT.en.yes }).dblclick();
  await expect(assistantTurns(page)).not.toHaveCount(before, { timeout: 30_000 });
  await settled(page);
  expect(await assistantTurns(page).count(), "exactly one new assistant turn").toBe(before + 1);
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(await pageText(page)).not.toMatch(/could not read that request|INVALID_INPUT/);
  const api = await Api.open(project.projectId, "en");
  const th = (await api.get("/understanding")).body;
  expect(th.turns.filter((t: { role: string; text: string }) => t.role === "client" && /^Yes, that is correct/.test(t.text))).toHaveLength(1);
});
