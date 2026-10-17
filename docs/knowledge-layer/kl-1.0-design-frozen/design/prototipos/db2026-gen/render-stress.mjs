// node render.mjs <outDir>  → paged.html, doc.pdf, p-N.png, report.json (tema definitivo)
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { loadAssets, composeFlowHtml } from "./compose.mjs";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_MODULE ?? "playwright");
const [out] = process.argv.slice(2); const theme = "b";
mkdirSync(out, { recursive: true });
const doc = JSON.parse(readFileSync("content.stress.json", "utf8"));
const css = readFileSync("theme.css", "utf8");
const flow = composeFlowHtml(doc, loadAssets("."), css, theme);
const sha = (b) => createHash("sha256").update(b).digest("hex");
writeFileSync(`${out}/flow.html`, flow);
const browser = await chromium.launch({ args: ["--font-render-hinting=none"] });
try {
  const page = await browser.newPage({ viewport: { width: 794, height: 1123 } });
  await page.route("**/*", (r) => r.abort());
  await page.setContent(flow, { waitUntil: "load" });
  await page.emulateMedia({ media: "print" });
  await page.evaluate(() => document.fonts.ready);
  await page.addScriptTag({ content: readFileSync("paginate.js", "utf8") });
  const report = await page.evaluate(() => window.__paginate());
  const paged = await page.content();
  writeFileSync(`${out}/paged.html`, paged);
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true, tagged: true, outline: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
  writeFileSync(`${out}/doc.pdf`, pdf);
  const els = await page.$$(".page");
  for (let i = 0; i < els.length; i++) await els[i].screenshot({ path: `${out}/p-${i + 1}.png` });
  writeFileSync(`${out}/report.json`, JSON.stringify({ theme, ...report, flowSha: sha(flow), pagedSha: sha(paged), chromium: browser.version() }, null, 1));
  console.log(JSON.stringify({ theme, pages: report.pages, errors: report.errors.length, lint: report.lint.length }));
} finally { await browser.close(); }
