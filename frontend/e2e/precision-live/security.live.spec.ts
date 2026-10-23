import { expect, test, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Api, ORIGIN, ctl, facts, seed } from "./support/qa";
import { newKey } from "./support/flows";
import { openWithCode, scanForbidden, collectStrings } from "./support/live";

/**
 * Security and robustness of the live API (through the production static server's /api proxy, real backend, real PostgreSQL).
 * Internal checks: token lifecycle, project isolation, error hygiene, origin guard, headers and CSP, secrets in logs, forbidden terms.
 */
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const TECHNICAL = /(\bat [\w$./<>-]+ \(|\bat \/|node_modules|\.ts:\d+|\.js:\d+|SQLSTATE|syntax error|duplicate key|violates|relation "|column "|pg_|ECONN|stack|TypeError|ReferenceError|Unexpected token|drizzle|express)/i;

async function raw(method: string, url: string, init: { token?: string; body?: string; origin?: string | null; headers?: Record<string, string> } = {}) {
  const r = await fetch(`${ORIGIN}/api/precision${url}`, {
    method,
    headers: {
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
      ...(init.origin === null ? {} : { Origin: init.origin ?? ORIGIN }),
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      "X-Precision-Locale": "en",
      ...(init.headers ?? {}),
    },
    body: init.body,
  });
  const text = await r.text();
  return { status: r.status, text, headers: r.headers };
}
const cleanError = (text: string) => { expect(text, "no technical text in an error").not.toMatch(TECHNICAL); };

test.describe("link and session tokens", () => {
  test("a link works once; reuse, a made-up code and no code answer the same calm way (nothing to enumerate)", async () => {
    const s = await seed("start");
    const exchange = (code: unknown, origin: string | null = ORIGIN) => raw("POST", "/session/exchange", { body: JSON.stringify({ code }), origin });
    const first = await exchange(s.code);
    expect(first.status).toBe(200);
    const token = (JSON.parse(first.text) as { sessionToken: string }).sessionToken;
    expect(token.length).toBeGreaterThan(30);
    const reuse = await exchange(s.code);
    const fake = await exchange("0".repeat(s.code.length));
    const missing = await exchange(undefined);
    const shortCode = await exchange("x");
    expect(reuse.status).toBe(401);
    expect(fake.status).toBe(401);
    expect(reuse.text, "a used and an unknown link are indistinguishable").toBe(fake.text);
    expect([missing.status, shortCode.status].every((x) => x === 401 || x === 400)).toBe(true);
    for (const r of [reuse, fake, missing, shortCode]) cleanError(r.text);
    // the session from the first exchange keeps working: reuse of the link did not break or duplicate it
    expect((await raw("GET", "/center", { token })).status).toBe(200);
  });

  test("an expired link is refused; a revoked session stops working immediately; a session without a token or with a wrong token is refused", async () => {
    const s = await seed("start", { linkTtlMs: 1500 });
    await new Promise((r) => setTimeout(r, 2200));
    const late = await raw("POST", "/session/exchange", { body: JSON.stringify({ code: s.code }) });
    expect(late.status).toBe(401);
    cleanError(late.text);
    const api = await Api.open(s.projectId);
    expect((await api.get("/center")).status).toBe(200);
    await ctl("POST", "/revoke-sessions", { projectId: s.projectId });
    for (const call of [() => api.get("/center"), () => api.get("/understanding"), () => api.post("/understanding/turns", { turnKey: newKey("r"), text: "hola" })]) {
      const r = await call();
      expect(r.status).toBe(401);
      cleanError(JSON.stringify(r.body));
    }
    expect((await facts(s.projectId)).facts.filter((f) => f.field_key.includes("pa_expansion_product_or_service")), "the refused write wrote nothing").toHaveLength(0);
    for (const t of [undefined, "abc", "Bearer", "a".repeat(4000)]) {
      const r = await raw("GET", "/center", t === undefined ? {} : { token: t });
      expect(r.status).toBe(401);
      cleanError(r.text);
    }
  });
});

test.describe("project isolation", () => {
  test("another project's category, CRP, preview and send answer 404, change nothing and leak nothing", async () => {
    const a = await seed("logistics_ready");
    const b = await seed("logistics_ready");
    const apiA = await Api.open(a.projectId);
    const apiB = await Api.open(b.projectId);
    const catA = await apiA.categoryId();
    const catB = await apiB.categoryId();
    expect(catA).not.toBe(catB);
    const bBefore = JSON.stringify((await facts(b.projectId)).facts);
    const bThread = JSON.stringify((await apiB.get(`/categories/${catB}`)).body.thread);
    const attempts: [string, string, unknown?][] = [
      ["GET", `/categories/${catB}`],
      ["POST", `/categories/${catB}/turns`, { turnKey: newKey("x"), text: "Third-party logistics provider" }],
      ["GET", `/categories/${catB}/crp`],
      ["POST", `/categories/${catB}/crp/confirm`, { requestKey: newKey("x") }],
      ["GET", `/categories/${catB}/preview`],
      ["POST", `/categories/${catB}/send`, { previewChecksum: "0".repeat(64) }],
    ];
    for (const [m, url, body] of attempts) {
      const r = await apiA.call(m as "GET" | "POST", url, body);
      expect(r.status, `${m} ${url}`).toBe(404);
      const text = JSON.stringify(r.body);
      cleanError(text);
      expect(text, "the answer does not reveal that the other project exists").not.toContain(b.projectId);
    }
    expect(JSON.stringify((await facts(b.projectId)).facts), "nothing was written to the other project").toBe(bBefore);
    expect(JSON.stringify((await apiB.get(`/categories/${catB}`)).body.thread)).toBe(bThread);
    expect(JSON.stringify((await apiA.get("/center")).body), "own Center never lists the other project's categories").not.toContain(catB);
    // and the own category is fine
    expect((await apiA.get(`/categories/${catA}`)).status).toBe(200);
  });
});

test.describe("error hygiene", () => {
  test("malformed, hostile and oversized requests give calm structured answers without stack traces or driver text", async () => {
    const s = await seed("start");
    const api = await Api.open(s.projectId);
    const tok = api.token;
    const cases: [string, string, string | undefined, number[]][] = [
      ["GET", "/categories/%27%20OR%201%3D1--", undefined, [404]],
      ["GET", "/categories/" + "a".repeat(5000), undefined, [404, 414]],
      ["GET", "/categories/..%2F..%2Fetc%2Fpasswd", undefined, [404]],
      ["GET", "/categories/00000000-0000-4000-8000-000000000000/crp", undefined, [404]],
      ["POST", "/understanding/turns", "{not json", [400]],
      ["POST", "/understanding/turns", JSON.stringify({ turnKey: "abcdefgh1", text: "x".repeat(200_000) }), [400, 413]],
      ["POST", "/understanding/turns", JSON.stringify({ turnKey: "a", text: "hi" }), [400]],
      ["POST", "/understanding/turns", JSON.stringify({ turnKey: "abcdefgh2", text: { $gt: "" } }), [400]],
      ["POST", "/understanding/turns", JSON.stringify({ turnKey: "abcdefgh3", text: "ok", extra: "__proto__" }), [200, 400]],
      ["POST", "/service-map/confirm", JSON.stringify({}), [400, 409, 422]],
      ["GET", "/nope", undefined, [404]],
      ["DELETE", "/center", undefined, [404, 405]],
      ["PUT", "/understanding", "{}", [404, 405]],
    ];
    for (const [m, url, body, ok] of cases) {
      const r = await raw(m, url, { token: tok, ...(body !== undefined ? { body } : {}) });
      expect(ok, `${m} ${url.slice(0, 40)} -> ${r.status}`).toContain(r.status);
      cleanError(r.text);
      expect(r.status).toBeLessThan(500);
      for (const str of collectStrings(safeJson(r.text))) expect(scanForbidden(str)).toEqual([]);
    }
    // the hostile text sent as an answer is stored as plain text and rendered as text: it is never interpreted
    const odd = `<img src=x onerror=alert(1)> '); DROP TABLE fact;-- ${"ñ".repeat(20)}`;
    const r = await api.post("/understanding/turns", { turnKey: newKey("odd"), text: odd });
    expect(r.status).toBeLessThan(500);
    expect((await api.get("/center")).status, "the database is intact").toBe(200);
  });

  test("a state-changing request from another origin is refused by the origin guard, before anything is read or written", async () => {
    const s = await seed("start");
    const api = await Api.open(s.projectId);
    const evil = "http://evil.example";
    const x = await raw("POST", "/session/exchange", { body: JSON.stringify({ code: s.code }), origin: evil });
    expect(x.status).toBe(403);
    const t = await raw("POST", "/understanding/turns", { token: api.token, origin: evil, body: JSON.stringify({ turnKey: newKey("e"), text: "hola" }) });
    expect(t.status).toBe(403);
    cleanError(t.text);
    expect((await api.get("/understanding")).body.turns.filter((u: { role: string }) => u.role === "client")).toHaveLength(0);
    // the link was NOT consumed by the refused exchange
    expect((await raw("POST", "/session/exchange", { body: JSON.stringify({ code: s.code }) })).status).toBe(200);
  });

  test("the internal status route does not exist without the key", async () => {
    for (const headers of [{}, { "X-Precision-Internal-Key": "wrong" }, { Authorization: "Bearer wrong" }]) {
      const r = await raw("GET", "/internal/status", { headers: headers as Record<string, string> });
      expect(r.status).toBe(404);
      cleanError(r.text);
    }
  });
});

test.describe("production headers and CSP", () => {
  test("the static server sends the security headers; the app runs under the real Content-Security-Policy with zero violations", async ({ browser }, info) => {
    const head = await fetch(`${ORIGIN}/precision`);
    const csp = head.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toMatch(/unsafe-eval|script-src[^;]*unsafe-inline|\*/);
    expect(head.headers.get("x-content-type-options")).toBe("nosniff");
    expect(head.headers.get("referrer-policy")).toBe("no-referrer");
    expect(head.headers.get("x-frame-options")).toBe("DENY");
    expect(head.headers.get("cache-control")).toMatch(/no-store|no-cache/);
    const api = await fetch(`${ORIGIN}/api/precision/center`);
    expect(api.headers.get("cache-control"), "API answers are never cached").toMatch(/no-store/);
    expect(api.headers.get("x-powered-by")).toBeNull();

    // Real browser, CSP enforced (no bypass): Cover, Center, Understanding must render and report no violation or console error.
    const ctx = await browser.newContext({ baseURL: ORIGIN, viewport: info.project.use.viewport ?? { width: 1440, height: 900 }, bypassCSP: false });
    const page: Page = await ctx.newPage();
    const problems: string[] = [];
    page.on("console", (m) => { if (m.type() === "error" || /Content Security Policy/i.test(m.text())) problems.push(m.text()); });
    page.on("pageerror", (e) => problems.push(e.message));
    await page.addInitScript(() => document.addEventListener("securitypolicyviolation", (e) => console.error(`CSP violation: ${e.violatedDirective} ${e.blockedURI}`)));
    const s = await seed("start");
    await openWithCode(page, s.code, "en");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.getByRole("button", { name: /^Continue/ }).or(page.getByRole("link", { name: /^Continue/ })).first().click();
    await expect(page).toHaveURL(/\/precision\/center/);
    await page.getByRole("link", { name: /^(Start|Empezar)/ }).first().click();
    await expect(page.locator(".pz-confirm")).toBeVisible();
    expect(problems, "CSP violations or console errors under the production policy").toEqual([]);
    await ctx.close();
  });
});

test.describe("secrets and product hygiene", () => {
  test("tokens and keys never appear in the server logs or the static server log", async () => {
    const s = await seed("start");
    const api = await Api.open(s.projectId);
    await api.get("/center");
    await raw("GET", "/center", { token: "leaktest-" + "z".repeat(30) });
    await new Promise((r) => setTimeout(r, 800));
    const logs = ["/tmp/precision-live/qa-backend.log", "/tmp/precision-live/qa-frontend.log", "/tmp/precision-live/backend.log", "/tmp/precision-live/frontend.log"].filter((f) => fs.existsSync(f));
    test.skip(logs.length === 0, "no server log files on this machine");
    for (const f of logs) {
      const text = fs.readFileSync(f, "utf8");
      expect(text, `${f}: session token`).not.toContain(api.token);
      expect(text, `${f}: link code`).not.toContain(s.code);
      expect(text, `${f}: bad token echo`).not.toContain("leaktest-");
      expect(text, `${f}: bearer header`).not.toMatch(/Bearer\s+[A-Za-z0-9._-]{20,}/);
      expect(text, `${f}: key material`).not.toMatch(/(sk-[A-Za-z0-9]{20,}|api[_-]?key["']?\s*[:=]\s*["']?[A-Za-z0-9]{16,}|postgres:\/\/[^\s"']+:[^\s"'@]+@)/i);
    }
  });

  test("product code (not tests, fixtures or seed) has no demo, presentation or Embassy switches", async () => {
    const roots = ["backend/src/precision", "frontend/src/precision", "frontend/server"];
    const skip = /(__tests__|\.test\.|\.spec\.|[\\/]seed[\\/]|[\\/]fixtures?[\\/]|node_modules)/;
    const re = /embassy|demo_user|presentation_mode|isDemo\b/i;
    const hits: string[] = [];
    const walk = (dir: string): void => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (skip.test(p)) continue;
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx|mjs|js|json|css|html)$/.test(e.name)) fs.readFileSync(p, "utf8").split("\n").forEach((line, i) => { if (re.test(line)) hits.push(`${path.relative(REPO, p)}:${i + 1}`); });
      }
    };
    for (const r of roots) walk(path.join(REPO, r));
    expect(hits).toEqual([]);
  });
});

function safeJson(text: string): unknown { try { return JSON.parse(text); } catch { return {}; } }
