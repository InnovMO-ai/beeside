// Prototipo de Design (no es código de producto).
// Contenido estructurado y versionado → HTML de flujo (función pura) → paginación determinista en Chromium → A4.
// Los mismos bloques se pintan con dos temas (dirección definitiva: tema B, elegido por el PO el 16-oct-2026; A queda en histórico). Nada de IA en la composición.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Tipografía: Lato (tema de la referencia v3) solo si su verificación pasó; si no, Public Sans provisional con la misma estructura.
const FACES = {
  lato: { dir: "fonts", faces: [[300, "lato-latin-300-normal.woff2"], [400, "lato-latin-400-normal.woff2"], [700, "lato-latin-700-normal.woff2"], [900, "lato-latin-900-normal.woff2"]] },
  publicsans: { dir: "fonts-fallback", faces: [[300, "public-sans-latin-400-normal.woff2"], [400, "public-sans-latin-400-normal.woff2"], [700, "public-sans-latin-700-normal.woff2"], [900, "public-sans-latin-700-normal.woff2"]] },
};
export function loadAssets(dir, family = process.env.KL_PDF_FONT ?? "lato") {
  const b64 = (f) => readFileSync(join(dir, f)).toString("base64");
  const set = FACES[family];
  if (!set) throw new Error("unknown font family " + family);
  return {
    family,
    fonts: set.faces.map(([w, f]) => `@font-face{font-family:"Lato";font-style:normal;font-weight:${w};src:url(data:font/woff2;base64,${b64(set.dir + "/" + f)}) format("woff2")}`).join("\n"),
    lockup: b64("logo_lockup_correct.png"),
    bee: b64("bee_lockup.png"),
  };
}

const ref = (doc, id) => {
  const s = doc.sources[id];
  return s ? `<a class="ref" href="${esc(s.href)}">[${esc(id)}]</a>` : `[${esc(id)}]`;
};

function block(b, doc) {
  switch (b.type) {
    case "guide_cover":
      return `<div class="cover" data-block="cover">
<img class="cover-lockup" src="data:image/png;base64,__LOCKUP__" alt="beeside"><hr class="cover-rule" aria-hidden="true">
<h1 class="cover-title"><span class="light">${esc(b.titleLight)}</span>${b.titleBold.map((t) => `<span class="bold">${esc(t)}</span>`).join("")}<span class="year">${esc(b.year)}</span></h1>
<div class="cover-foot"><p class="cover-tagline">${esc(b.tagline)}</p><p class="cover-edition">${esc(b.edition)} <span aria-hidden="true">/</span> ${esc(b.month)}</p><p class="cover-publisher">${esc(b.publisher)}</p></div>
</div>`;
    case "founder_letter":
      return `<section class="letter" data-block="letter" data-fixed="true"><p class="eyebrow accent">${esc(b.eyebrow)}</p>${b.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("")}<p class="sig-name">${esc(b.signature.name)}</p><p class="sig-role">${esc(b.signature.role)}</p></section>`;
    case "section_header":
      return `<header class="sh" data-block="section_header" data-keep-with-next="true"><p class="eyebrow">${esc(b.eyebrow)}</p><h2>${esc(b.title)}</h2><p class="dek">${esc(b.dek)}</p></header>`;
    case "kpi_row":
      return `<dl class="kpis" data-block="kpi_row">${b.items.map((k) => `<div class="kpi"><dt class="kpi-label">${esc(k.label)}</dt><dd class="kpi-value">${esc(k.value)}</dd><dd class="kpi-src">${esc(k.period)} ${ref(doc, k.ref)}</dd></div>`).join("")}</dl>`;
    case "labelled_text":
      return `<section class="lt" data-block="labelled_text"><h3 class="label">${esc(b.label)}</h3>${b.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("")}</section>`;
    case "two_columns":
      return `<div class="cols" data-block="two_columns">${b.columns.map((c) => `<section><h3 class="label">${esc(c.label)}</h3><p>${esc(c.text)}</p></section>`).join("")}</div>`;
    case "editorial_note":
      return `<p class="note" data-block="editorial_note">${b.label ? `<span class="note-label">${esc(b.label)} /</span> ` : ""}${esc(b.text)}</p>`;
    case "key_insight":
      return `<aside class="ki" data-block="key_insight" aria-label="${esc(b.label)}"><p class="ki-label">${esc(b.label)}</p><p class="ki-text">${esc(b.text)}</p></aside>`;
    case "matrix_table":
      return `<div class="tbl" data-block="matrix_table" data-splittable="rows"><table><caption>${esc(b.title)}</caption><thead><tr>${b.columns.map((c) => `<th scope="col">${esc(c)}</th>`).join("")}</tr></thead><tbody>${b.rows.map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${esc(c)}</th>` : `<td>${esc(c)}</td>`)).join("")}</tr>`).join("")}</tbody></table></div>`;
    case "journey":
      return `<ol class="journey" data-block="journey">${b.steps.map((st, i) => `<li class="step"><span class="step-n" aria-hidden="true">${String(i + 1).padStart(2, "0")}</span><div><h3 class="step-title">${esc(st.title)}</h3><p class="step-text">${esc(st.text)}</p></div></li>`).join("")}</ol>`;
    case "cta_link": {
      const l = doc.config.links[b.linkKey];
      if (!l || !l.href) throw new Error("cta_link without configured link: " + b.linkKey);
      return `<section class="cta" data-block="cta_link" data-setting="${esc(l.settingKey)}"><h3 class="label">${esc(b.label)}</h3><p class="cta-line"><span class="cta-text">${esc(b.text)}</span> <a class="cta-link" href="${esc(l.href)}">${esc(l.label)}</a></p></section>`;
    }
    default:
      throw new Error("unknown block " + b.type);
  }
}

// Una "sección" del contenido = una o más páginas físicas. La paginación decide cuántas.
export function composeFlowHtml(doc, assets, themeCss, theme) {
  const sections = doc.pages.map((p) => `<section class="src-page" data-id="${esc(p.id)}" data-kind="${esc(p.kind)}" data-chrome="${p.chrome}" data-pillar="${esc(p.pillar ?? "")}">${p.blocks.map((b) => block(b, doc)).join("\n")}</section>`).join("\n");
  const chrome = { left: "beeside&nbsp; / &nbsp;DOING BUSINESS", country: doc.edition.country, version: `${doc.edition.label}&nbsp; / &nbsp;${doc.edition.month}`, guide: "Doing Business Mexico 2026", month: doc.edition.monthLong, label: doc.edition.label };
  return `<!doctype html><html lang="${esc(doc.edition.locale)}"><head><meta charset="utf-8"><title>Doing Business Mexico 2026 | beeside | Version ${esc(doc.edition.code)}</title>
<style>${assets.fonts}\n${themeCss}</style></head>
<body data-theme="${esc(theme)}"><div id="flow" hidden>${sections.replace("__LOCKUP__", assets.lockup)}</div><main id="book"></main>
<script id="chrome-data" type="application/json">${JSON.stringify({ ...chrome, bee: assets.bee, status: doc.status })}</script>
</body></html>`;
}
