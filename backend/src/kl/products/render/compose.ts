import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GuideBlock, GuideDocument } from "../guide-model";
import { ASSETS_DIR } from "./assets-dir";

/**
 * HTML de impresión: FUNCIÓN PURA del documento (sin IA, sin reloj, sin red). El mismo documento produce el mismo HTML byte a byte.
 * La paginación ocurre después, en el navegador (`assets/paginate.js`). Las fuentes y el logotipo viajan incrustados en base64:
 * el render no necesita red.
 */
export type FontFamily = "lato" | "publicsans";

const FACES: Record<FontFamily, { dir: string; faces: [number, string][] }> = {
  lato: { dir: "fonts", faces: [[300, "lato-latin-300-normal.woff2"], [400, "lato-latin-400-normal.woff2"], [700, "lato-latin-700-normal.woff2"], [900, "lato-latin-900-normal.woff2"]] },
  publicsans: { dir: "fonts-fallback", faces: [[300, "public-sans-latin-400-normal.woff2"], [400, "public-sans-latin-400-normal.woff2"], [700, "public-sans-latin-700-normal.woff2"], [900, "public-sans-latin-700-normal.woff2"]] },
};

export interface Assets {
  family: FontFamily;
  fontCss: string;
  fontFiles: { file: string; sha256: string }[];
  lockup: string;
  bee: string;
  themeCss: string;
  paginateJs: string;
}

export function loadAssets(family: FontFamily): Assets {
  const set = FACES[family];
  const read = (rel: string) => readFileSync(join(ASSETS_DIR, rel));
  const files = set.faces.map(([, f]) => ({ file: f, bytes: read(`${set.dir}/${f}`) }));
  return {
    family,
    // Familia interna «Lato» para ambos: el tema no cambia con la tipografía de respaldo (misma estructura, probado).
    fontCss: set.faces.map(([w], i) => `@font-face{font-family:"Lato";font-style:normal;font-weight:${w};src:url(data:font/woff2;base64,${(files[i] as { bytes: Buffer }).bytes.toString("base64")}) format("woff2")}`).join("\n"),
    fontFiles: [...new Map(files.map((f) => [f.file, { file: f.file, sha256: createHash("sha256").update(f.bytes).digest("hex") }])).values()],
    lockup: read("logo_lockup_correct.png").toString("base64"),
    bee: read("bee_lockup.png").toString("base64"),
    themeCss: read("theme.css").toString("utf8"),
    paginateJs: read("paginate.js").toString("utf8"),
  };
}

export const esc = (s: unknown): string => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const attr = (a: string[] | undefined) => esc((a ?? []).join(" "));

function refLink(doc: GuideDocument, id: string): string {
  const s = doc.sources[id];
  // Cada ref del cuerpo resuelve a una entrada del directorio; si no existe es un error de construcción, no un enlace roto.
  if (!s) throw new Error(`ref sin entrada en el directorio de fuentes: ${id}`);
  return `<a class="ref" href="#src-${esc(id)}">[${esc(id)}]</a>`;
}

function block(b: GuideBlock, doc: GuideDocument): string {
  switch (b.type) {
    case "guide_cover":
      return `<div class="cover" data-block="cover"><img class="cover-lockup" src="data:image/png;base64,__LOCKUP__" alt="beeside"><hr class="cover-rule" aria-hidden="true"><h1 class="cover-title"><span class="light">${esc(b.titleLight)}</span>${b.titleBold.map((t) => `<span class="bold">${esc(t)}</span>`).join("")}<span class="year">${esc(b.year)}</span></h1><div class="cover-foot"><p class="cover-tagline">${esc(b.tagline)}</p><p class="cover-edition">${esc(b.edition)} <span aria-hidden="true">/</span> ${esc(b.month)}</p><p class="cover-publisher">${esc(b.publisher)}</p></div></div>`;
    case "founder_letter":
      return `<section class="letter" data-block="letter" data-fixed="${esc(b.blockId)}@${esc(b.version)}" data-sha256="${esc(b.sha256)}"><p class="eyebrow">${esc(b.eyebrow)}</p>${b.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("")}<p class="sig-name">${esc(b.signature.name)}</p><p class="sig-role">${esc(b.signature.role)}</p></section>`;
    case "section_header":
      return `<header class="sh" data-block="section_header" data-keep-with-next="true"><p class="eyebrow">${esc(b.eyebrow)}</p><h2>${esc(b.title)}</h2>${b.dek ? `<p class="dek">${esc(b.dek)}</p>` : ""}</header>`;
    case "kpi_row":
      return `<dl class="kpis" data-block="kpi_row">${b.items.map((k) => `<div class="kpi" data-unit="${esc(k.unitRef)}"><dt class="kpi-label">${esc(k.label)}</dt><dd class="kpi-value">${esc(k.value)}</dd><dd class="kpi-src">${esc(k.period)} ${refLink(doc, k.ref)}</dd></div>`).join("")}</dl>`;
    case "labelled_text":
      return `<section class="lt" data-block="labelled_text" data-splittable="paragraphs" data-units="${attr(b.unitRefs)}" data-claims="${attr(b.claimIds)}"><h3 class="label">${esc(b.label)}</h3>${b.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("")}</section>`;
    case "two_columns":
      return `<div class="cols" data-block="two_columns">${b.columns.map((c) => `<section><h3 class="label">${esc(c.label)}</h3><p>${esc(c.text)}</p></section>`).join("")}</div>`;
    case "editorial_note":
      return `<p class="note" data-block="editorial_note" data-units="${attr(b.unitRefs)}">${b.label ? `<span class="note-label">${esc(b.label)} /</span> ` : ""}${esc(b.text)}</p>`;
    case "key_insight":
      return `<aside class="ki" data-block="key_insight" aria-label="${esc(b.label)}"><p class="ki-label">${esc(b.label)}</p><p class="ki-text">${esc(b.text)}</p></aside>`;
    case "matrix_table":
      return `<div class="tbl" data-block="matrix_table" data-splittable="rows"><table><caption>${esc(b.title)}</caption><thead><tr>${b.columns.map((c) => `<th scope="col">${esc(c)}</th>`).join("")}</tr></thead><tbody>${b.rows
        .map((r) => `<tr data-unit="${esc(r.unitRef)}">${r.cells.map((c, i) => (i === 0 ? `<th scope="row">${esc(c)}</th>` : `<td>${esc(c)}</td>`)).join("")}<td>${refLink(doc, r.ref)}</td></tr>`)
        .join("")}</tbody></table></div>`;
    case "journey":
      return `<ol class="journey" data-block="journey" data-fixed="${esc(b.blockId)}@${esc(b.version)}" data-sha256="${esc(b.sha256)}">${b.steps.map((st, i) => `<li class="step"><span class="step-n" aria-hidden="true">${String(i + 1).padStart(2, "0")}</span><div><h3 class="step-title">${esc(st.title)}</h3><p class="step-text">${esc(st.text)}</p></div></li>`).join("")}</ol>`;
    case "timeline":
      return `<ol class="timeline" data-block="timeline" aria-label="${esc(b.title)}">${b.points.map((p) => `<li><span class="tl-year">${esc(p.year)}</span><span>${esc(p.text)}</span></li>`).join("")}</ol>`;
    case "bar_breakdown": {
      const sum = b.segments.reduce((n, s) => n + s.value, 0);
      // La suma se valida: un desglose que no cierra detiene la publicación (no se dibuja un total falso).
      if (Math.abs(sum - b.total) > 1e-9) throw new Error(`bar_breakdown no suma ${b.total} (suma ${sum})`);
      return `<div class="bars" data-block="bar_breakdown"><p class="bars-title">${esc(b.title)}</p>${b.segments.map((s) => `<div class="bar-row"><span>${esc(s.label)}</span><span class="bar-track" aria-hidden="true"><span class="bar-fill" style="width:${Math.max(0, Math.min(100, (s.value / b.total) * 100)).toFixed(2)}%"></span></span><span>${esc(s.display)}</span></div>`).join("")}<p class="bars-legend">${esc(b.legend)}</p></div>`;
    }
    case "cta_link": {
      const l = doc.links[b.linkKey];
      if (!l || !l.href) throw new Error(`cta_link sin enlace configurado: ${b.linkKey}`);
      return `<section class="cta" data-block="cta_link" data-setting="${esc(l.settingKey)}"><h3 class="label">${esc(b.label)}</h3><p class="cta-line"><span class="cta-text">${esc(b.text)}</span> <a class="cta-link" href="${esc(l.href)}">${esc(l.label)}</a></p></section>`;
    }
    case "sources_directory":
      return `<div class="tbl" data-block="sources_directory" data-splittable="rows"><table><caption>${esc(b.title)}</caption><thead><tr><th scope="col">#</th><th scope="col">${esc(b.title)}</th><th scope="col">${esc(doc.locale === "es" ? "Periodos" : "Periods")}</th></tr></thead><tbody>${b.entries
        .map((e) => `<tr id="src-${esc(e.id)}"><th scope="row">${esc(e.id)}</th><td><a class="ref" href="${esc(e.href)}">${esc(e.citation)}</a></td><td>${esc(e.periods.join(", "))}</td></tr>`)
        .join("")}</tbody></table></div>`;
    case "publication_notes":
      return `<dl class="pub-notes" data-block="publication_notes"><h2 class="label">${esc(b.title)}</h2>${b.lines.map((l) => `<dt>${esc(l.label)}</dt><dd>${esc(l.text)}</dd>`).join("")}</dl>`;
    case "edition_stamp":
      return `<p class="stamp" data-block="edition_stamp"><b>${esc(b.editionCode)}</b> · sha256 ${esc(b.manifestSha)}…<br>${esc(b.verifyLabel)}: <a class="stamp-link" href="${esc(b.verifyUrl)}">${esc(b.verifyUrl)}</a></p>`;
  }
}

export function composeFlowHtml(doc: GuideDocument, assets: Assets): string {
  const sections = doc.pages.map((p) => `<section class="src-page" data-id="${esc(p.id)}" data-kind="${esc(p.kind)}" data-chrome="${p.chrome}" data-pillar="${esc(p.pillar ?? "")}">${p.blocks.map((b) => block(b, doc)).join("\n")}</section>`).join("\n");
  const chromeData = {
    left: doc.chrome.left, country: doc.edition.country, version: `${doc.edition.label}&nbsp; / &nbsp;${doc.edition.month}`, guide: doc.chrome.guide, month: doc.edition.monthLong, label: doc.edition.label,
    bee: assets.bee, status: doc.statusLabel, continued: doc.chrome.continued,
  };
  return `<!doctype html><html lang="${esc(doc.locale)}"><head><meta charset="utf-8"><title>${esc(doc.chrome.guide)} | beeside | ${esc(doc.edition.label)}</title>
<style>${assets.fontCss}\n${assets.themeCss}</style></head>
<body data-theme="b"><div id="flow" hidden>${sections.replace("__LOCKUP__", assets.lockup)}</div><main id="book"></main>
<script id="chrome-data" type="application/json">${JSON.stringify(chromeData).replace(/</g, "\\u003c")}</script>
</body></html>`;
}
