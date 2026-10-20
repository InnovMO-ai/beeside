// Prototipo de Design: renderiza el HTML de impresión con Chromium (Playwright) en un proceso nuevo cada vez.
// Uso: node render-pdf.mjs <report.json> <manifest.json> <assetsDir> <out.pdf> <out.html>
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { loadAssets, renderPrintHtml, footerTemplate } from "./render-html.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_MODULE ?? "playwright");
const [reportPath, manifestPath, assetsDir, outPdf, outHtml] = process.argv.slice(2);

const sha = (b) => createHash("sha256").update(b).digest("hex");
const canonical = (v) => JSON.stringify(v, Object.keys(v).sort ? undefined : undefined);
const manifestSha = sha(canonical(JSON.parse(readFileSync(manifestPath, "utf8"))));
const doc = JSON.parse(readFileSync(reportPath, "utf8").replace("__MANIFEST_SHA256__", manifestSha));
const html = renderPrintHtml(doc, loadAssets(assetsDir));
writeFileSync(outHtml, html);

const browser = await chromium.launch({ args: ["--font-render-hinting=none"] });
try {
  const page = await browser.newPage();
  await page.route("**/*", (route) => route.abort());   // sin red durante el render
  await page.setContent(html, { waitUntil: "load" });
  await page.emulateMedia({ media: "print" });
  await page.evaluate(() => document.fonts.ready);
  const pdf = await page.pdf({
    format: "Letter",
    printBackground: true,
    tagged: true,
    outline: true,
    displayHeaderFooter: true,
    headerTemplate: "<span></span>",
    footerTemplate: footerTemplate(doc),
    margin: { top: "20mm", bottom: "22mm", left: "18mm", right: "18mm" },
  });
  writeFileSync(outPdf, pdf);
  console.log(JSON.stringify({ outPdf, bytes: pdf.length, manifestSha, chromium: browser.version() }));
} finally {
  await browser.close();
}
