// Prototipo de Design (no es código de producto): ReportDocument "knowledge_guide" → HTML de impresión.
// Función pura: mismo documento + mismos assets → mismo HTML, byte a byte. Sin reloj, sin red, sin aleatoriedad.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const MARK = { data: "Dato", guidance: "Orientación", obligation: "Obligación general" };

export function loadAssets(dir) {
  const b64 = (f) => readFileSync(join(dir, f)).toString("base64");
  return {
    fonts: [
      ["Open Sans", 400, "open-sans-latin-400-normal.woff2"],
      ["Open Sans", 600, "open-sans-latin-600-normal.woff2"],
      ["Public Sans", 400, "public-sans-latin-400-normal.woff2"],
      ["Public Sans", 600, "public-sans-latin-600-normal.woff2"],
      ["Public Sans", 700, "public-sans-latin-700-normal.woff2"],
    ].map(([family, weight, file]) => ({ family, weight, data: b64(file) })),
    logo: b64("beeside-logo.png"),
  };
}

function mark(m) {
  return m ? `<p class="mark" data-mark="${m}">${esc(MARK[m])}</p>` : "";
}

function block(b, doc) {
  switch (b.type) {
    case "guide_cover":
      return `<header class="cover">
<img class="cover-logo" src="data:image/png;base64,__LOGO__" alt="beeside">
<p class="eyebrow">${esc(b.eyebrow)}</p>
<h1 class="cover-title">${esc(b.title)}</h1>
<p class="cover-sub">${esc(b.subtitle)}</p>
<dl class="cover-meta"><div><dt>Edición</dt><dd>${esc(b.editionLabel)}</dd></div><div><dt>Publicada</dt><dd>${esc(b.publishedOn)}</dd></div><div><dt>Información vigente al</dt><dd>${esc(b.currentAsOf)}</dd></div><div><dt>Idioma</dt><dd>${esc(b.locale)}</dd></div></dl>
</header>`;
    case "toc": {
      const items = doc.sections.filter((s) => s.heading && s.id !== "toc").map((s) =>
        `<li class="toc-l${s.heading.level}"><a href="#${esc(s.id)}">${s.heading.number ? `<span class="num">${esc(s.heading.number)}</span> ` : ""}${esc(s.heading.text)}</a></li>`).join("");
      return `<nav aria-label="${esc(b.title)}"><ol class="toc">${items}</ol></nav>`;
    }
    case "points":
      return `<section class="blk"><h3>${esc(b.title)}</h3><p>${esc(b.intro)}</p><ul class="points">${b.points.map((p) => `<li>${esc(p)}</li>`).join("")}</ul></section>`;
    case "callout":
      return `<aside class="callout"><p class="callout-title">${esc(b.title)}</p><p>${esc(b.text)}</p></aside>`;
    case "guidance":
      return `<section class="blk" data-type="guidance">${mark(b.mark)}${b.title ? `<h3>${esc(b.title)}</h3>` : ""}${b.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("")}<p class="meta">Última revisión: ${esc(b.lastReviewedOn)} · ${b.unitRefs.map(esc).join(", ")}</p></section>`;
    case "obligation":
      return `<section class="blk" data-type="obligation">${mark(b.mark)}<h3>${esc(b.title)}</h3>${b.paragraphs.map((p) => `<p>${esc(p)}</p>`).join("")}<p class="meta">${esc(b.primarySource.citation)} · publicado ${esc(b.primarySource.publishedOn)} · vigente desde ${esc(b.primarySource.effectiveFrom)} · última validación ${esc(b.lastValidatedOn)}</p></section>`;
    case "partial_coverage":
      return `<aside class="partial"><p class="callout-title">${esc(b.title)}</p><p>${esc(b.text)}</p></aside>`;
    case "decide_with":
      return `<section class="blk decide"><h3>${esc(b.title)}</h3><ul class="points">${b.limits.map((l) => `<li>${esc(l)}</li>`).join("")}</ul><p class="meta">Categorías de servicio de beeside: ${b.categories.map((c) => esc(c.label)).join(" · ")}</p></section>`;
    case "data_table": {
      const head = b.columns.map((c) => `<th scope="col"${c.align === "end" ? ' class="num"' : ""}>${esc(c.label)}</th>`).join("") + `<th scope="col">Cita</th>`;
      const rows = b.rows.map((r) => `<tr>${b.columns.map((c, i) => {
        const v = esc(r.cells[c.key] ?? b.notAvailableLabel);
        const cls = c.align === "end" ? ' class="num"' : "";
        return i === 0 ? `<th scope="row"${cls}>${v}</th>` : `<td${cls}>${v}</td>`;
      }).join("")}<td class="cite">${esc(r.citation.source)}; publicado ${esc(r.citation.sourcePublishedOn)}${r.citation.noteNumbers ? ` <sup>${r.citation.noteNumbers.join(",")}</sup>` : ""}<br><code>${esc(r.citation.unitRef)}</code></td></tr>`).join("");
      return `<section class="blk" data-type="data">${mark(b.mark)}<table><caption><span class="cap-title">${esc(b.title)}</span>${b.caption ? `<span class="cap-text">${esc(b.caption)}</span>` : ""}</caption><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></section>`;
    }
    case "notes":
      return `<section class="blk notes"><h3>${esc(b.title)}</h3><ol>${b.notes.map((n) => `<li value="${n.number}">${esc(n.text)}</li>`).join("")}</ol></section>`;
    case "sources":
      return `<section class="blk"><h3>${esc(b.title)}</h3><table><caption class="visually-hidden">${esc(b.title)}</caption><thead><tr><th scope="col">Fuente</th><th scope="col">Publicación</th><th scope="col">Periodos</th><th scope="col">Uso permitido y atribución</th></tr></thead><tbody>${b.sources.map((s) => `<tr><th scope="row">${esc(s.citation)}</th><td>${esc(s.publication)}</td><td>${s.periods.map(esc).join(", ")}</td><td>${esc(s.permittedUse)}. ${esc(s.attribution ?? "")}</td></tr>`).join("")}</tbody></table><h3>Método y limitaciones</h3><ul class="points">${b.method.map((m) => `<li>${esc(m)}</li>`).join("")}</ul><h3>Cambios frente a la edición anterior</h3><ul class="points">${b.changesFromPrevious.map((m) => `<li>${esc(m)}</li>`).join("")}</ul></section>`;
    case "edition_stamp":
      return `<section class="stamp"><p><strong>Edición ${esc(b.editionCode)}</strong></p><p>Huella del manifiesto: <code>${esc(b.manifestSha256)}</code></p><p>${esc(b.verifyLabel)}: ${esc(b.verifyUrl)}</p></section>`;
    default:
      throw new Error(`bloque desconocido: ${b.type}`);
  }
}

function section(s, doc) {
  const h = s.heading;
  const tag = h ? `h${h.level}` : null;
  const head = h && s.id !== "toc"
    ? `<${tag} id="${esc(s.id)}">${h.number ? `<span class="num">${esc(h.number)}</span> ` : ""}${esc(h.text)}</${tag}>`
    : h ? `<h1 id="${esc(s.id)}">${esc(h.text)}</h1>` : "";
  return `<section class="sec${s.pageBreakBefore ? " pb" : ""}"${h ? ` aria-labelledby="${esc(s.id)}"` : ""}>${head}${s.blocks.map((b) => block(b, doc)).join("\n")}</section>`;
}

export function renderPrintHtml(doc, assets) {
  const faces = assets.fonts.map((f) => `@font-face{font-family:"${f.family}";font-weight:${f.weight};font-style:normal;src:url(data:font/woff2;base64,${f.data}) format("woff2")}`).join("\n");
  const css = `${faces}
@page{size:Letter;margin:20mm 18mm 22mm}
html{font-family:"Open Sans",sans-serif;font-size:10.5pt;line-height:1.5;color:#00303F}
body{margin:0}
h1,h2,h3{font-family:"Public Sans",sans-serif;color:#2E0879;line-height:1.2;break-after:avoid}
h1{font-size:22pt;font-weight:700;margin:0 0 10pt;letter-spacing:-.01em}
h2{font-size:15pt;font-weight:700;margin:14pt 0 8pt}
h3{font-size:11.5pt;font-weight:600;margin:10pt 0 4pt}
h1 .num,h2 .num{color:#7357C1;margin-right:4pt}
.pb{break-before:page}
.cover{height:212mm;box-sizing:border-box;display:flex;flex-direction:column;justify-content:flex-end;padding:0 0 10mm;border-bottom:3pt solid #2E0879}
.cover-logo{width:46mm;height:auto;margin-bottom:auto}
.eyebrow{font-family:"Public Sans",sans-serif;font-weight:600;font-size:8.5pt;letter-spacing:.18em;color:#5B3EA8;margin:0 0 6pt}
.cover-title{font-size:32pt;margin:0 0 6pt}
.cover-sub{font-size:13pt;color:#194C5C;margin:0 0 16pt}
.cover-meta{display:grid;grid-template-columns:1fr 1fr;gap:6pt 16pt;margin:0}
.cover-meta dt{font-size:8pt;color:#4A6B77;text-transform:uppercase;letter-spacing:.08em}
.cover-meta dd{margin:0;font-weight:600}
.toc{list-style:none;padding:0;margin:0}
.toc li{padding:5pt 0;border-bottom:.5pt solid #DAD6EE}
.toc a{color:#00303F;text-decoration:none}
.toc .num{color:#7357C1;font-weight:600}
.toc-l2{padding-left:14pt!important;font-size:9.5pt}
.blk{margin:0 0 12pt;break-inside:avoid-page}
.mark{display:inline-block;margin:0 0 4pt;padding:1pt 6pt;border:.75pt solid #7357C1;border-radius:8pt;font-family:"Public Sans",sans-serif;font-size:7.5pt;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#2E0879}
.mark[data-mark="obligation"]{background:#2E0879;color:#fff;border-color:#2E0879}
.mark[data-mark="guidance"]{background:#F1F1FA}
.meta{font-size:8pt;color:#4A6B77}
.points{padding-left:14pt;margin:4pt 0}
.points li{margin:2pt 0}
.callout,.partial{margin:10pt 0;padding:8pt 10pt;border-radius:4pt;background:#F1F1FA;break-inside:avoid}
.partial{background:#fff;border:.75pt dashed #7357C1}
.callout-title{font-family:"Public Sans",sans-serif;font-weight:600;color:#2E0879;margin:0 0 2pt}
.callout p,.partial p{margin:0}
table{width:100%;border-collapse:collapse;font-size:8.8pt}
caption{text-align:left;margin-bottom:4pt}
.cap-title{display:block;font-family:"Public Sans",sans-serif;font-weight:600;font-size:11pt;color:#2E0879}
.cap-text{display:block;font-size:8.3pt;color:#4A6B77}
th,td{text-align:left;vertical-align:top;padding:4pt 5pt;border-bottom:.5pt solid #DAD6EE}
thead th{font-family:"Public Sans",sans-serif;font-size:7.8pt;color:#4A6B77;text-transform:uppercase;letter-spacing:.05em;border-bottom:1pt solid #2E0879}
tbody th{font-weight:600}
.num{text-align:right;font-variant-numeric:tabular-nums}
.cite{font-size:7.6pt;color:#4A6B77;width:34%}
code{font-family:"Public Sans",sans-serif;font-size:7.2pt;color:#5B3EA8;overflow-wrap:anywhere}
.notes ol{padding-left:14pt;font-size:8.5pt}
.stamp{margin-top:18pt;padding-top:8pt;border-top:1pt solid #2E0879;font-size:8.5pt}
.stamp p{margin:2pt 0}
.visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}`;
  const body = doc.sections.map((s) => section(s, doc)).join("\n");
  return `<!doctype html><html lang="${esc(doc.locale)}"><head><meta charset="utf-8"><title>${esc(doc.sections[0].blocks[0].title)}</title><style>${css}</style></head><body>${body.replace("__LOGO__", assets.logo)}</body></html>`;
}

export function footerTemplate(doc) {
  const c = doc.chrome;
  return `<div style="font-family:'Open Sans',sans-serif;font-size:7pt;color:#4A6B77;width:100%;padding:0 18mm;display:flex;justify-content:space-between"><span>${esc(c.footerLeft)} · ${esc(c.notAdviceLabel)}</span><span>Pág. <span class="pageNumber"></span> de <span class="totalPages"></span></span></div>`;
}
