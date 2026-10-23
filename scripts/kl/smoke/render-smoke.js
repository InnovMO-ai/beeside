#!/usr/bin/env node
/* Smoke del generador de PDF dentro de la imagen runtime-kl-worker (CR-KL-002 B6, X19, AC-10).
 * Sin base de datos ni red: renderiza el documento de referencia (dist/kl/products/render/smoke.js, el mismo que usa la prueba del host) con el
 * Chromium de la imagen. Comprueba: Chromium arranca; la tipografía fijada (Lato) se verifica; el PDF es válido; dos renders son idénticos
 * (determinismo); una petición de red se aborta y se registra (X19); y, si se indica KL_SMOKE_BASELINE, que la huella COINCIDE con la del host
 * registrada en ac10-smoke-baseline.json (con KL_SMOKE_REQUIRE_BASELINE=1 su ausencia o diferencia es un fallo).
 * Imprime un JSON con las huellas. Sale con código ≠ 0 si algo falla.
 * Uso: node render-smoke.js   (cwd = /repo/backend; KL_DIST cambia la ruta de dist; KL_ASSETS_DIR la de los assets) */
const fs = require("node:fs");
const path = require("node:path");
const dist = process.env.KL_DIST || path.resolve(process.cwd(), "dist");
const req = (p) => require(path.join(dist, "kl", "products", p));
const { launchChromium } = req("render/pdf");
const { resolveFontFamily } = req("render/fonts");
const { renderSmokeOnce, smokeBaselineKey } = req("render/smoke");

const fail = (m) => { process.stderr.write(`SMOKE FAIL: ${m}\n`); process.exit(1); };

(async () => {
  const browser = await launchChromium();
  try {
    const { family, verification } = await resolveFontFamily(browser, "lato");
    if (family !== "lato" || !verification.compatible) fail(`la tipografía fijada no se verificó (${family}: ${(verification.details || []).join("; ")})`);
    const a = await renderSmokeOnce(browser), b = await renderSmokeOnce(browser);
    if (a.header !== "%PDF-") fail("el archivo no es un PDF");
    if (a.pages < 2) fail(`páginas inesperadas: ${a.pages}`);
    if (a.pdfSha256 !== b.pdfSha256) fail(`dos renders consecutivos difieren (${a.pdfSha256} vs ${b.pdfSha256})`);
    if (a.blockedRequests.length !== 0) fail(`el render normal intentó red: ${a.blockedRequests.join(",")}`);
    // X19: una dependencia remota se aborta, se registra y no hace fallar el render.
    const c = await renderSmokeOnce(browser, { html: (h) => h.replace("</head>", '<link rel="stylesheet" href="https://example.invalid/remote.css"></head>') });
    if (!c.blockedRequests.some((u) => u.includes("example.invalid"))) fail("la petición remota no fue bloqueada/registrada (X19)");
    const key = smokeBaselineKey(browser);
    let versusHost = "sin-linea-base";
    if (process.env.KL_SMOKE_BASELINE) {
      const baseline = fs.existsSync(process.env.KL_SMOKE_BASELINE) ? JSON.parse(fs.readFileSync(process.env.KL_SMOKE_BASELINE, "utf8")) : {};
      const ref = baseline[key];
      if (ref) {
        versusHost = ref.pdfSha256 === a.pdfSha256 && ref.pages === a.pages ? "coincide" : "DIFIERE";
        if (versusHost === "DIFIERE") process.stderr.write(`SMOKE: la huella del contenedor (${a.pdfSha256}) difiere de la del host (${ref.pdfSha256}) para ${key}\n`);
      }
    }
    if (process.env.KL_SMOKE_REQUIRE_BASELINE === "1" && versusHost !== "coincide") fail(`huella frente al host: ${versusHost} (${key})`);
    process.stdout.write(JSON.stringify({ ok: true, chromium: browser.version(), platform: `${process.platform}-${process.arch}`, key, family, pages: a.pages, pdfSha256: a.pdfSha256, deterministic: true, versusHost, networkBlocked: c.blockedRequests }) + "\n");
  } finally {
    await browser.close();
  }
})().catch((e) => fail(e && e.stack ? e.stack : String(e)));
