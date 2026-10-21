import { expect, test, request as pwRequest } from "@playwright/test";
import tls from "node:tls";
import { journeyNewBusiness, journeyNortica } from "@beeside/fa-public-engine/testing";

const URL_ = process.env.PROD_URL ?? "https://discovery.beeside.you";
const USER = process.env.PROD_GATE_USER ?? ""; const PASS = process.env.PROD_GATE_PASSWORD ?? "";
const auth = { username: USER, password: PASS, send: "always" as const };   // the API answers 401 WITHOUT a challenge (no browser popup), so credentials must be sent up front
const host = new URL(URL_).hostname;

test.describe("edge: certificate, redirects, gate, reserved routes (no backend needed)", () => {
  test.beforeEach(async ({}, info) => { test.skip(info.project.name !== "desktop-1440", "run once"); });
  test("valid managed certificate for the hostname", async () => {
    const cert = await new Promise<tls.PeerCertificate>((res, rej) => { const s = tls.connect(443, host, { servername: host }, () => { const c = s.getPeerCertificate(); const ok = s.authorized; s.end(); ok ? res(c) : rej(new Error("certificate not trusted")); }); s.on("error", rej); });
    expect(cert.subjectaltname ?? "").toContain(`DNS:${host}`); expect(new Date(cert.valid_to).getTime()).toBeGreaterThan(Date.now() + 7 * 86400_000);
  });
  test("http redirects to https; the Wix redirect from the main site points here", async ({ request }) => {
    const r = await request.get(`http://${host}/`, { maxRedirects: 0 }); expect([301, 308]).toContain(r.status()); expect(r.headers().location).toMatch(new RegExp(`^https://${host.replace(/\./g, "\\.")}(:443)?/$`));
    const w = await request.get("https://beeside.you/discovery", { maxRedirects: 0 }); expect([301, 308]).toContain(w.status()); expect(w.headers().location).toMatch(new RegExp(`^https://${host.replace(/\./g, "\\.")}/?$`));
  });
  test("the app is CLOSED: pages and API answer 401 without credentials (no popup for the API); health, robots, config and brand files are public", async () => {
    const ctx = await pwRequest.newContext({ baseURL: URL_ });
    const page = await ctx.get("/", { maxRedirects: 0 }); expect(page.status()).toBe(401); expect(page.headers()["www-authenticate"]).toMatch(/Basic/);
    const api = await ctx.get("/api/fa4/catalog"); expect(api.status()).toBe(401); expect(api.headers()["www-authenticate"]).toBeUndefined();
    expect((await ctx.get("/assets/index.js")).status()).toBe(401);
    const h = await ctx.get("/health"); expect(h.status()).toBe(200); expect(await h.json()).toMatchObject({ gate: "basic", closedTest: true });
    expect(await (await ctx.get("/config.json")).json()).toMatchObject({ closedTest: true });
    const png = await ctx.get("/brand/beeside-lockup.png"); expect(png.status()).toBe(200); expect(png.headers()["content-type"]).toBe("image/png");
    expect(await (await ctx.get("/robots.txt")).text()).toContain("Disallow: /");
    expect((await ctx.get("/", { maxRedirects: 0 })).headers()["x-robots-tag"]).toMatch(/noindex/);
    await ctx.dispose();
  });
  test("wrong credentials never pass", async () => {
    const ctx = await pwRequest.newContext({ baseURL: URL_, httpCredentials: { username: USER || "x", password: "definitely-wrong-password-123" } });
    expect((await ctx.get("/")).status()).toBe(401); await ctx.dispose();
  });
  test("/ops-control is reserved (404, noindex) with and without credentials; legacy routes and APIs do not exist; /fa4 redirects", async () => {
    for (const creds of [undefined, auth]) {
      const ctx = await pwRequest.newContext({ baseURL: URL_, ...(creds ? { httpCredentials: creds } : {}) });
      for (const p of ["/ops-control", "/ops-control/", "/ops-control/projects/1"]) { const r = await ctx.get(p, { maxRedirects: 0 }); expect(r.status(), p).toBe(404); expect(r.headers()["x-robots-tag"]).toMatch(/noindex/); expect(r.headers().location).toBeUndefined(); expect(await r.text()).not.toMatch(/Control Center/i); }
      // closed: an unauthenticated visitor learns nothing (401 everywhere on the app host); with the gate open to the team these routes do not exist (404)
      for (const p of ["/admin", "/admin/projects", "/resume/x", "/api/fa/links/continue", "/api/admin/auth/login", "/api/billing/x"]) expect((await ctx.get(p, { maxRedirects: 0 })).status(), p).toBe(creds ? 404 : 401);
      const f = await ctx.get("/fa4", { maxRedirects: 0 }); expect(f.status()).toBe(308); expect(f.headers().location).toBe("/");
      await ctx.dispose();
    }
  });
});

test.describe("browser journey on the real URL (fictitious data)", () => {
  test.use({ httpCredentials: auth });
  test("YEV renders with the photographic hero; «Start Your Expansion» is NOT offered (no purchase destination: fail-closed); e-mail delivery locks the project; no overflow", async ({ page, request }) => {
    test.skip(!USER, "no gate credentials supplied");
    const cat = await request.get("/api/fa4/catalog"); test.skip(cat.status() !== 200, "backend not reachable yet");
    const a = JSON.parse(JSON.stringify(journeyNortica("es"))); a.identity.email = `contact+smoke-ui-${Date.now()}@beeside.you`;
    const s = await request.post("/api/fa4/sessions", { data: { answers: a, step: "extra" } }); const token = (await s.json()).sessionToken as string;
    await page.addInitScript((t) => { if (sessionStorage.getItem("beeside.fa4.session")) return; sessionStorage.setItem("beeside.fa4.session", t); sessionStorage.setItem("beeside.fa4.session.at", String(Date.now())); }, token);
    await page.goto("/");
    await expect(page.getByTestId("stabilization-notice")).toBeVisible();   // Stabilization notice: must be confirmed before anything else
    await page.getByRole("button", { name: "Entendido, continuar" }).click();
    await page.getByRole("button", { name: /Ver mi resultado|See my result/ }).click();
    await expect(page.getByTestId("result-screen")).toBeVisible({ timeout: 30_000 });
    await page.waitForFunction(() => { const i = document.querySelector<HTMLImageElement>(".res-hero.photo .hero-photo img"); return !!i && i.complete && i.naturalWidth > 0; });
    await expect(page.getByRole("note")).toContainText("PRUEBA CONTROLADA");
    await expect(page.getByRole("button", { name: "Start Your Expansion" })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.getByRole("button", { name: /Recibir este resultado por email/ }).click();
    await expect(page.getByText(/Te enviamos tu Your Expansion View a/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: "Corregir algo" })).toHaveCount(0);
  });
});

test.describe("closed app behind the gate", () => {
  test.use({ httpCredentials: auth });
  test("cover loads for the team with the closed-test ribbon, the official logo and no administration link", async ({ page }) => {
    test.skip(!USER, "no gate credentials supplied");
    await page.goto("/");
    // every asset must load from the real public path (a base-path mistake shows up here as a blank page)
    const failed: string[] = []; page.on("response", (r) => { if (r.status() >= 400 && /\/assets\//.test(r.url())) failed.push(`${r.status()} ${r.url()}`); });
    await page.reload(); expect(failed).toEqual([]);
    await expect(page.getByRole("note")).toContainText("PRUEBA CONTROLADA");
    const cat = await page.request.get("/api/fa4/catalog");
    if (cat.status() === 200) await expect(page.getByRole("button", { name: /Comenzar|Start/ })).toBeVisible();
    else await expect(page.getByRole("alert")).toBeVisible();                           // backend not up: the app says so honestly (no blank page)
    expect(await page.content()).not.toMatch(/ops-control|\/admin\b|Control Center/i);
    if (cat.status() === 200) { const logo = page.locator("img[alt='beeside']").first(); await expect(logo).toBeVisible(); expect(await logo.evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0); }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
  test("full journey with FICTITIOUS data (new business and operating business, e-mail inside the allowed test domain), preview → delivery, closed afterwards", async ({ page, request }, info) => {
    test.skip(!USER || info.project.name !== "desktop-1440", "needs gate credentials; run once");
    const cat = await request.get("/api/fa4/catalog"); test.skip(cat.status() !== 200, `backend not reachable through the edge yet (${cat.status()})`);
    for (const [name, base] of [["new", journeyNewBusiness("es")], ["operating", journeyNortica("es")]] as const) {
      const a = JSON.parse(JSON.stringify(base)); a.identity.email = `contact+smoke-${name}-${Date.now()}@beeside.you`;   // plus-addressing lands in the shared mailbox: real SMTP is exercised, no outsider is mailed a.identity.name = "Prueba Ficticia"; a.identity.company = "Empresa Ficticia (prueba)";
      const s = await request.post("/api/fa4/sessions", { data: { answers: a, step: "extra" } }); expect(s.status(), name).toBe(201); const token = (await s.json()).sessionToken as string; const H = { "X-Fa4-Session": token };
      const pv = await request.post("/api/fa4/session/result", { headers: H, data: {} }); expect(pv.status()).toBe(200); expect((await pv.json()).preview).toBe(true);
      expect((await request.get("/api/fa4/session/result", { headers: H })).status()).toBe(404);                  // a preview delivers nothing
      const d = await request.post("/api/fa4/session/result/email", { headers: H, data: { previewToken: (await pv.json()).previewToken } }); expect(d.status(), `${name}: the e-mail was accepted by the real SMTP server (state sent)`).toBe(200);
      const got = await request.get("/api/fa4/session/result", { headers: H }); expect((await got.json()).delivered).toBe(true);
      const st = await request.get("/api/fa4/session/email-status?kind=result", { headers: H }); expect((await st.json()).state).toBe("sent");
      expect((await request.put("/api/fa4/session", { headers: H, data: { answers: a, step: "decision" } })).status(), name).toBe(409);   // delivered = closed
    }
    // NOTE: "a destination outside the allowed test domains is never mailed" (502 EMAIL_NOT_SENT) is covered by integration/staging only: against the real environment it would raise a false 5xx alert on every run.
    const mode = await request.get("/api/fa4/legal-mode"); expect(await mode.json()).toEqual({ legalMode: "closed-test" });
  });
});
