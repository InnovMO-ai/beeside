// Extrae texto, marcadores y metadatos de un PDF con pdf.js (solo pruebas; se ejecuta como proceso aparte).
// Uso: node pdf-text.mjs <ruta a pdfjs-dist/legacy/build/pdf.mjs> <archivo.pdf>
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const [pdfjsPath, file] = process.argv.slice(2);
const pdfjs = await import(pathToFileURL(pdfjsPath).href);
const data = new Uint8Array(readFileSync(file));
const doc = await pdfjs.getDocument({ data, useSystemFonts: false, isEvalSupported: false, disableFontFace: true }).promise;
const pages = [];
for (let i = 1; i <= doc.numPages; i++) {
  const page = await doc.getPage(i);
  const tc = await page.getTextContent();
  const view = page.view;
  pages.push({ text: tc.items.map((it) => it.str).join(" ").replace(/\s+/g, " ").trim(), width: view[2], height: view[3] });
}
const outline = (await doc.getOutline()) ?? [];
const meta = await doc.getMetadata().catch(() => ({ info: {} }));
console.log(JSON.stringify({ numPages: doc.numPages, pages, outline: outline.map((o) => o.title), info: meta.info ?? {} }));
