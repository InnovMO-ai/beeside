import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openWithCode, scanForbidden, collectStrings, SCRIPT, T } from "./support/live";

/**
 * Smoke of the REAL entry point (backend/src/index.ts, built to dist/index.js) as started by scripts/precision-live-stack.sh:
 * no QA seams at all. Provider selection is by configuration only (scripted model, simulated Operation Hub, fixture entitlement/context).
 *
 *   bash scripts/precision-live-stack.sh up --reset          # starts :18080 (backend) and :14180 (frontend), shows the access path once
 *   PRECISION_REAL_STACK=1 npx playwright test -c playwright.precision-live.config.ts real-stack --project=desktop-light
 *
 * The spec mints its own links with `precision-live-stack.sh seed` (a new one-time link for the same synthetic project) and walks the
 * whole journey through the API, then opens the app in a browser, then checks the internal route, the real rate limits and the log.
 */
test.skip(!process.env.PRECISION_REAL_STACK, "set PRECISION_REAL_STACK=1 with the stack up (scripts/precision-live-stack.sh up)");
test.describe.configure({ mode: "serial" });

const FRONT = `http://localhost:${process.env.PRECISION_REAL_FRONTEND_PORT ?? 14180}`;
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const RUN = process.env.RUN_DIR ?? "/tmp/precision-live";

function newLink(stage: string, reset = false): string {
  const out = execFileSync("bash", [path.join(REPO, "scripts/precision-live-stack.sh"), "seed", `--stage=${stage}`, ...(reset ? ["--reset"] : [])], { encoding: "utf8", env: { ...process.env, NO_PROXY: "", no_proxy: "" } });
  const m = /one-time access path \(shown once\): http:\/\/localhost:\d+(\S+)/.exec(out);
  if (!m) throw new Error("no access path in the seed output");
  return m[1];
}
const codeOf = (p: string) => new URL(`http://x${p}`).searchParams.get("code")!;

class Real {
  token = "";
  async call(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
    const r = await fetch(`${FRONT}/api/precision${url}`, { method, headers: { "Content-Type": "application/json", Origin: FRONT, "X-Precision-Locale": "en", ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let json: any = text; try { json = JSON.parse(text); } catch { /* text */ }
    return { status: r.status, json, text, headers: r.headers };
  }
}
let n = 0;
const key = (p: string) => `${p}${++n}-${Math.random().toString(36).slice(2, 9)}`;

test("the real entry point serves the whole journey: Understanding, My Service Map, Logistics with process questions, CRP, Preview, Send, Sent", async () => {
  const api = new Real();
  const bodies: string[] = [];
  const link = newLink("start", true);
  const ex = await api.call("POST", "/session/exchange", { code: codeOf(link) });
  expect(ex.status).toBe(200);
  api.token = ex.json.sessionToken;
  const rec = async (p: Promise<{ status: number; json: any; text: string }>) => { const r = await p; bodies.push(r.text); return r; };

  const entry = await rec(api.call("GET", "/entry"));
  expect(entry.status).toBe(200);
  let u = await rec(api.call("GET", "/understanding"));
  const lastCard = (th: any) => [...th.turns].reverse().find((t: any) => t.confirmCard)?.confirmCard;
  for (let i = 0; i < 2; i++) {
    const card = lastCard(u.json);
    const r = await rec(api.call("POST", "/understanding/turns", { turnKey: key("u"), text: card.confirmLabel, confirm: { token: card.token, intent: "confirm" } }));
    expect(r.status).toBe(200);
    u = await rec(api.call("GET", "/understanding"));
  }
  for (const t of SCRIPT.en.understanding) expect((await rec(api.call("POST", "/understanding/turns", { turnKey: key("u"), text: t }))).status).toBe(200);
  expect((await rec(api.call("GET", "/understanding"))).json.understandingState).toBe("ready_to_confirm");
  const sm = await rec(api.call("GET", "/service-map"));
  expect(sm.status).toBe(200);
  const cf = await rec(api.call("POST", "/service-map/confirm", { requestKey: key("m") }));
  expect(cf.status).toBe(200);
  const center = await rec(api.call("GET", "/center"));
  const cat = center.json.categories.find((k: { label: string }) => /logistics/i.test(k.label)).id;
  const before = (await rec(api.call("GET", `/categories/${cat}`))).json.progress;
  for (const q of SCRIPT.en.processQ) {
    const r = await rec(api.call("POST", `/categories/${cat}/turns`, { turnKey: key("p"), text: q }));
    expect(r.json.turns[1].kind).toBe("process_question");
  }
  expect((await rec(api.call("GET", `/categories/${cat}`))).json.progress, "process questions do not move progress").toEqual(before);
  for (const a of SCRIPT.en.logistics) expect((await rec(api.call("POST", `/categories/${cat}/turns`, { turnKey: key("a"), text: a }))).status).toBe(200);
  const last = await rec(api.call("POST", `/categories/${cat}/turns`, { turnKey: key("a"), text: SCRIPT.en.unknown, quickReply: { value: "unknown", intent: "unknown" } }));
  expect(last.status).toBe(200);
  expect((await rec(api.call("GET", `/categories/${cat}/crp`))).status).toBe(200);
  expect((await rec(api.call("POST", `/categories/${cat}/crp/confirm`, { requestKey: key("c") }))).status).toBe(200);
  const pv = await rec(api.call("GET", `/categories/${cat}/preview`));
  expect(pv.status).toBe(200);
  const sends = await Promise.all([1, 2, 3].map(() => api.call("POST", `/categories/${cat}/send`, { previewChecksum: pv.json.previewChecksum })));
  for (const s of sends) bodies.push(s.text);
  expect(sends.map((s) => s.json.state).filter((x) => x === "sent").length).toBeGreaterThanOrEqual(1);
  const after = await rec(api.call("GET", `/categories/${cat}`));
  expect(JSON.stringify(after.json)).toMatch(/sent/);
  const c2 = await rec(api.call("GET", "/center"));
  expect(c2.json.categories.find((k: { id: string }) => k.id === cat).status).toBe("sent");
  // customer-visible strings: no forbidden terms anywhere in the journey (a Sherpa explanation is allowed in process answers)
  const hits: string[] = [];
  for (const b of bodies) { let j: unknown; try { j = JSON.parse(b); } catch { continue; } for (const s of collectStrings(j)) hits.push(...scanForbidden(s, { allowSherpa: true }).map((h) => `${h} in "${s.slice(0, 60)}"`)); }
  expect(hits).toEqual([]);
});

test("the real stack opens in a browser: Cover, Center, Understanding, with the real CSP", async ({ page }) => {
  const link = newLink("start", true);
  const problems: string[] = [];
  page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
  page.on("pageerror", (e) => problems.push(e.message));
  await page.goto(`${FRONT}${link.replace("/precision", "/precision")}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(T.en.coverH1);
  await page.getByRole("button", { name: T.en.cont }).or(page.getByRole("link", { name: T.en.cont })).first().click();
  await expect(page).toHaveURL(/\/precision\/center/);
  await page.getByRole("link", { name: /^Start/ }).first().click();
  await expect(page.locator(".pz-confirm")).toBeVisible();
  await page.screenshot({ path: "/tmp/precision-live-shots/real-stack-understanding.png" });
  expect(problems).toEqual([]);
  void openWithCode;
});

for (const locale of ["en", "es"] as const) {
  test(`the real stack carries the whole journey in the browser (${locale}): Cover, Understanding, My Service Map, Logistics, CRP, Preview, Send once, Sent`, async ({ page }, info) => {
    const { shotDir } = await import("./support/qa");
    const live = await import("./support/live");
    const t = live.T[locale];
    const sc = live.SCRIPT[locale];
    const problems: string[] = [];
    page.on("pageerror", (e) => problems.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/favicon/.test(m.text())) problems.push(m.text()); });
    const dir = shotDir(info, `real-${locale}`);
    const shot = async (n: string) => { await page.waitForLoadState("networkidle").catch(() => undefined); await page.waitForTimeout(500); await page.screenshot({ path: `${dir}/real-${n}.png`, fullPage: false }); };
    const code = codeOf(newLink("start", true));
    await page.addInitScript((l) => { try { localStorage.setItem("beeside.precision.locale", l); } catch { /* blocked */ } }, locale);
    await page.goto(`${FRONT}/precision?code=${encodeURIComponent(code)}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(t.coverH1);
    await shot("01-cover");
    await page.getByRole("button", { name: t.cont }).or(page.getByRole("link", { name: t.cont })).first().click();
    await page.getByRole("link", { name: /^(Start|Empezar)/ }).first().click();
    await expect(page.locator(".pz-confirm")).toBeVisible();
    await live.say(page, locale === "en" ? "Yes" : "Sí");
    await live.confirmCard(page, sc.yes);
    for (const u of sc.understanding) await live.say(page, u);
    await shot("02-understanding");
    await page.getByRole("link", { name: t.mapCta }).first().click();
    await page.getByRole("button", { name: t.confirmMap }).click();
    await page.getByRole("dialog").getByRole("button", { name: /^(Confirm|Confirmar)$/ }).click();
    await expect(page.getByRole("status").filter({ hasText: t.mapConfirmed }).first()).toBeVisible();
    await shot("03-map");
    await page.getByRole("link", { name: /Precision Center/ }).first().click();
    await page.getByRole("link", { name: /(Start|Empezar): (Logistics|Logística)/ }).click();
    await live.say(page, locale === "en" ? "What is a CRP and what happens with this?" : "¿Qué es un CRP y qué va a pasar con esto?");
    await live.say(page, locale === "en" ? "What role does the Sherpa play and when does it appear?" : "¿Qué papel juega el Sherpa y cuándo aparece?");
    for (const a of sc.logistics) await live.say(page, a);
    await live.pick(page, sc.unknown);
    await shot("04-category");
    await page.getByRole("link", { name: t.reviewSummary }).first().click();
    await shot("05-crp");
    await page.getByRole("button", { name: t.confirmCrp }).click();
    await page.getByRole("dialog").getByRole("button", { name: /^(Confirm|Confirmar)$/ }).click();
    await expect(page.getByText(t.crpConfirmed).first()).toBeVisible();
    await page.getByRole("link", { name: t.preview }).or(page.getByRole("button", { name: t.preview })).first().click();
    await shot("06-preview");
    await page.getByRole("button", { name: t.send }).dblclick();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(t.sentH1, { timeout: 30_000 });
    await shot("07-sent");
    expect(live.scanForbidden(await live.pageText(page), { allowSherpa: false })).toEqual([]);
    expect(problems, "no console or page errors").toEqual([]);
  });
}

test("internal status: 404 without the key and with a wrong key; 200 with the key and free of secrets", async () => {
  const keyFile = path.join(RUN, "internal-key");
  const key = fs.readFileSync(keyFile, "utf8").trim();
  const anon = await fetch(`${FRONT}/api/precision/internal/status`);
  expect(anon.status).toBe(404);
  const wrong = await fetch(`${FRONT}/api/precision/internal/status`, { headers: { "X-Precision-Internal-Key": "wrong-key-value" } });
  expect(wrong.status).toBe(404);
  const good = await fetch(`${FRONT}/api/precision/internal/status`, { headers: { "X-Precision-Internal-Key": key } });
  expect(good.status, "the internal key opens the status route").toBe(200);
  const text = await good.text();
  expect(text).not.toContain(key);
  expect(text).not.toMatch(/postgres:\/\/|password|secret|token/i);
  expect(JSON.parse(text)).toBeTruthy();
});

test("real rate limits answer RATE_LIMITED with a friendly message and a wait time; the server log has no secrets", async () => {
  const api = new Real();
  // Turns: 90 per 10 minutes per project. Process questions cost no model call, so they are the cheapest way to reach it.
  const link = newLink("map_confirmed", true);
  const ex = await api.call("POST", "/session/exchange", { code: codeOf(link) });
  api.token = ex.json.sessionToken;
  const center = await api.call("GET", "/center");
  const cat = center.json.categories.find((k: { label: string }) => /logistics/i.test(k.label)).id;
  let limited: Awaited<ReturnType<Real["call"]>> | null = null;
  for (let i = 0; i < 100 && !limited; i++) {
    const r = await api.call("POST", `/categories/${cat}/turns`, { turnKey: key("rl"), text: "What does a Sherpa do?" });
    if (r.status === 429) limited = r;
    else expect(r.status).toBe(200);
  }
  expect(limited, "the per-project turn limit is enforced").not.toBeNull();
  expect(limited!.json.error).toBe("RATE_LIMITED");
  expect(limited!.json.retryable).toBe(true);
  expect(limited!.json.message).toMatch(/[a-z]{3}/i);
  expect(limited!.text).not.toMatch(/at \/|node_modules|SQLSTATE|redis|postgres/i);
  expect(limited!.headers.get("retry-after") ?? String(limited!.json.retryAfterSeconds ?? "")).toMatch(/^\d+$/);
  // The exchange limit (30 per 10 minutes per address) is the last thing this run does: it blocks this address on the stack until restart.
  let ex429: Awaited<ReturnType<Real["call"]>> | null = null;
  const anon = new Real();
  for (let i = 0; i < 40 && !ex429; i++) {
    const r = await anon.call("POST", "/session/exchange", { code: "not-a-real-code-" + i });
    if (r.status === 429) ex429 = r; else expect(r.status).toBe(401);
  }
  expect(ex429, "the exchange limit per address is enforced").not.toBeNull();
  expect(ex429!.json.error).toBe("RATE_LIMITED");
  expect(ex429!.json.message).not.toMatch(/limit|429|throttl/i);

  const logs = [`${RUN}/backend.log`, `${RUN}/frontend.log`].filter((f) => fs.existsSync(f));
  for (const f of logs) {
    const text = fs.readFileSync(f, "utf8");
    expect(text, f).not.toContain(api.token);
    expect(text, f).not.toContain(codeOf(link));
    expect(text, f).not.toContain(fs.readFileSync(path.join(RUN, "internal-key"), "utf8").trim());
    expect(text, f).not.toMatch(/Bearer\s+[A-Za-z0-9._-]{20,}/);
    expect(text, f).not.toMatch(/at\s+\S+\s+\(\/home\//); // no stack frames
  }
});
