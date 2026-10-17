#!/usr/bin/env node
/* Smoke del generador de PDF dentro de la imagen runtime-kl-worker (CR-KL-002 B6, X19, AC-10 portable).
 * Sin base de datos ni red: construye un documento sintético mínimo, lo compone y lo renderiza con el Chromium de la imagen.
 * Comprueba: Chromium arranca; la tipografía fijada (Lato) se verifica; el PDF es válido; dos renders son idénticos byte a byte
 * (determinismo en esta plataforma); una petición de red se aborta y se registra (X19). Imprime un JSON con las huellas, que sirve
 * para registrar la línea base de esta plataforma en ac10-baseline.json (con aprobación). Sale con código ≠ 0 si algo falla.
 * Uso: node render-smoke.js   (cwd = /repo/backend; KL_DIST cambia la ruta de dist; KL_ASSETS_DIR la de los assets) */
const path = require("node:path");
const crypto = require("node:crypto");
const dist = process.env.KL_DIST || path.resolve(process.cwd(), "dist");
const req = (p) => require(path.join(dist, "kl", "products", p));
const { launchChromium, renderPdf } = req("render/pdf");
const { composeFlowHtml, loadAssets } = req("render/compose");
const { resolveFontFamily, sha256Hex } = req("render/fonts");
const { normalizePdf, editionStamp } = req("render/normalize");

const doc = () => ({
  kind: "knowledge_guide", product: "smoke", locale: "es",
  edition: { code: "0.0", label: "Smoke 0.0", month: "oct 2026", monthLong: "octubre 2026", country: "MX", dataCutoff: "2026-10-15" },
  status: "PREVIEW", statusLabel: "SMOKE", chrome: { left: "beeside", guide: "Smoke", continued: "continúa" }, links: {}, sources: {},
  pages: [
    { id: "cover", kind: "cover", chrome: false, blocks: [{ type: "guide_cover", titleLight: "Smoke", titleBold: ["test"], year: "2026", tagline: "sintético", edition: "0.0", month: "oct 2026", publisher: "beeside" }] },
    { id: "body", kind: "body", chrome: true, pillar: "smoke", blocks: [
      { type: "section_header", eyebrow: "01", title: "Prueba", dek: "Documento sintético" },
      { type: "labelled_text", label: "Texto", paragraphs: ["Párrafo de prueba con acentos: áéíóú ñ."], unitRefs: [], claimIds: [] },
    ] },
    { id: "stamp", kind: "generated", chrome: true, blocks: [{ type: "edition_stamp", editionCode: "0.0", manifestSha: "a".repeat(64), verifyLabel: "Verificar", verifyUrl: "https://verify.example/x" }] },
  ],
});

const fail = (m) => { process.stderr.write(`SMOKE FAIL: ${m}\n`); process.exit(1); };

(async () => {
  const browser = await launchChromium();
  try {
    const { family, verification } = await resolveFontFamily(browser, "lato");
    if (family !== "lato" || !verification.compatible) fail(`la tipografía fijada no se verificó (${family}: ${(verification.details || []).join("; ")})`);
    const assets = loadAssets("lato");
    const once = async (html) => {
      const r = await renderPdf({ html: html ?? composeFlowHtml(doc(), assets), paginateJs: assets.paginateJs }, browser);
      const { pdf } = normalizePdf(r.pdf, editionStamp("2026-10-15"), "a".repeat(32));
      return { sha: sha256Hex(pdf), pages: r.pages, head: pdf.subarray(0, 5).toString("latin1"), blocked: r.blockedRequests };
    };
    const a = await once(), b = await once();
    if (a.head !== "%PDF-") fail("el archivo no es un PDF");
    if (a.pages < 2) fail(`páginas inesperadas: ${a.pages}`);
    if (a.sha !== b.sha) fail(`dos renders consecutivos difieren (${a.sha} vs ${b.sha})`);
    if (a.blocked.length !== 0) fail(`el render normal intentó red: ${a.blocked.join(",")}`);
    // X19: una dependencia remota se aborta, se registra y no hace fallar el render.
    const html = composeFlowHtml(doc(), assets).replace("</head>", '<link rel="stylesheet" href="https://example.invalid/remote.css"></head>');
    const c = await once(html);
    if (!c.blocked.some((u) => u.includes("example.invalid"))) fail("la petición remota no fue bloqueada/registrada (X19)");
    process.stdout.write(JSON.stringify({ ok: true, chromium: browser.version(), platform: `${process.platform}-${process.arch}`, family, pages: a.pages, pdfSha256: a.sha, deterministic: true, networkBlocked: c.blocked }) + "\n");
  } finally {
    await browser.close();
  }
})().catch((e) => fail(e && e.stack ? e.stack : String(e)));
