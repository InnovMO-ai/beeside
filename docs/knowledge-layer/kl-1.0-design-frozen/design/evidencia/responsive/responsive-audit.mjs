// Prueba de regresión responsive de KL Admin (Design → Code).
// Prototipo: node responsive-audit.mjs <dirProyecto> <dirSalida> [shots=1]  (sale con código 1 si hay hallazgos).
// En Code: reutilizar `probe` en las pruebas de Playwright de cada ruta de KL Admin con los mismos cuatro anchos.
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PW_MODULE ?? "playwright");
const [dir, out, shots = "1"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const css = readFileSync(`${dir}/kl-control-center.css`, "utf8");
const pages = readdirSync(dir).filter((f) => /^(KL-|PUB-|PZ-).*\.dc\.html$/.test(f)).sort();
const widths = { desktop: 1440, laptop: 1280, tablet: 768, mobile: 390 };
function plain(src) {
  let s = src.replace(/<script src="\.\/support\.js"><\/script>/, "").replace(/<link rel="stylesheet" href="kl-control-center\.css">/, `<style>${css}</style>`);
  s = s.replace(/<script type="text\/x-dc"[\s\S]*?<\/script>/, "").replace(/<\/?x-dc>/g, "").replace(/<\/?helmet>/g, "");
  return s.replace(/src="\/_blob\/[^"]+"/g, 'src="data:image/gif;base64,R0lGODlhAQABAAAAACw="');
}
// Detección: palabras partidas (una palabra en más de una línea), página con scroll horizontal, recortes.
const probe = () => {
  const allowed = (el) => el.closest("code, .kl-id, .admin-code");
  const split = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let n;
  while ((n = walker.nextNode())) {
    const el = n.parentElement;
    if (!el || allowed(el) || el.closest(".visually-hidden")) continue;
    const re = /[\p{L}\p{N}][\p{L}\p{N}·._@-]{3,}/gu; let m;
    while ((m = re.exec(n.data))) {
      range.setStart(n, m.index); range.setEnd(n, m.index + m[0].length);
      const tops = new Set(Array.from(range.getClientRects()).filter((r) => r.width > 0).map((r) => Math.round(r.top)));
      if (tops.size > 1) split.push({ word: m[0], in: el.tagName.toLowerCase() + (el.className ? "." + el.className : "") });
    }
  }
  const narrow = [];
  for (const el of document.querySelectorAll("dd, td, th, p, li, div, span")) {
    const r = el.getBoundingClientRect();
    if (el.textContent.trim().length > 12 && r.width > 0 && r.width < 64 && r.height > 80 && !allowed(el)) narrow.push({ el: el.tagName.toLowerCase() + "." + el.className, w: Math.round(r.width), h: Math.round(r.height) });
  }
  const clipped = [];
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (el.matches(".admin-table-wrap, input, textarea, select")) continue;
    if ((cs.overflowX === "hidden" || cs.overflowX === "clip") && el.scrollWidth > el.clientWidth + 1 && !el.matches(".visually-hidden")) clipped.push(el.tagName.toLowerCase() + "." + el.className);
  }
  const pageScroll = document.documentElement.scrollWidth > window.innerWidth + 1;
  const localScroll = Array.from(document.querySelectorAll(".admin-table-wrap")).filter((w) => w.scrollWidth > w.clientWidth + 1).length;
  return { split: split.slice(0, 8), splitCount: split.length, narrow: narrow.slice(0, 4), narrowCount: narrow.length, clipped, pageScroll, localScroll };
};
const browser = await chromium.launch();
const report = {};
let bad = 0;
for (const f of pages) {
  const html = plain(readFileSync(`${dir}/${f}`, "utf8"));
  report[f] = {};
  for (const [name, w] of Object.entries(widths)) {
    const page = await browser.newPage({ viewport: { width: w, height: 900 } });
    await page.route("**/*", (r) => r.abort());
    await page.setContent(html, { waitUntil: "load" });
    const r = await page.evaluate(probe);
    report[f][name] = r;
    const fail = r.splitCount + r.narrowCount + r.clipped.length + (r.pageScroll ? 1 : 0);
    if (fail) bad++;
    if (shots === "1") await page.screenshot({ path: `${out}/${f.replace(".dc.html", "")}-${name}.png`, fullPage: true });
    await page.close();
  }
}
await browser.close();
writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 1));
const rows = [];
for (const [f, v] of Object.entries(report)) for (const [n, r] of Object.entries(v)) if (r.splitCount || r.narrowCount || r.clipped.length || r.pageScroll) rows.push(`${f} ${n}: split=${r.splitCount} narrow=${r.narrowCount} clipped=${r.clipped.length} pageScroll=${r.pageScroll} e.g. ${JSON.stringify(r.split.slice(0,2))}`);
console.log(rows.join("\n") || "OK: sin hallazgos");
console.log(`views with findings: ${bad} / ${pages.length * Object.keys(widths).length}`);
process.exitCode = bad ? 1 : 0;
