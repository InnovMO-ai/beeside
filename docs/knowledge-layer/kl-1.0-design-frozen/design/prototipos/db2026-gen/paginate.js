// Paginación determinista en el navegador (prototipo de Design).
// Reglas: nunca reducir texto ni superponer; un bloque que no cabe pasa a la página siguiente;
// las tablas se parten por filas repitiendo el encabezado; un bloque indivisible que no cabe en una página vacía es un ERROR (falla cerrada).
window.__paginate = function () {
  const chrome = JSON.parse(document.getElementById("chrome-data").textContent);
  const book = document.getElementById("book");
  const errors = [];
  let pageNo = 0;

  function newPage(src) {
    pageNo += 1;
    const page = document.createElement("div");
    page.className = "page" + (src.dataset.chrome === "true" ? "" : " page-bare");
    page.dataset.src = src.dataset.id;
    if (src.dataset.chrome === "true") {
      const head = document.createElement("div");
      head.className = "run-head";
      head.setAttribute("aria-hidden", "true");
      head.innerHTML = `<span class="rh-left">${chrome.left}</span><span class="rh-pillar">${src.dataset.pillar}</span><span class="rh-right">${chrome.country}&nbsp; / &nbsp;${String(pageNo).padStart(2, "0")}</span>`;
      page.appendChild(head);
    }
    const body = document.createElement("div");
    body.className = "page-body";
    page.appendChild(body);
    if (src.dataset.chrome === "true") {
      const foot = document.createElement("div");
      foot.className = "run-foot";
      foot.setAttribute("aria-hidden", "true");
      foot.innerHTML = `<span>${chrome.version}</span><img class="foot-bee" alt="" src="data:image/png;base64,${chrome.bee}"><span>${String(pageNo).padStart(2, "0")}</span>`;
      page.appendChild(foot);
    }
    const proto = document.createElement("div");
    proto.className = "proto-mark";
    proto.setAttribute("aria-hidden", "true");
    proto.textContent = chrome.status;
    page.appendChild(proto);
    book.appendChild(page);
    return body;
  }
  const overflows = (body) => body.scrollHeight > body.clientHeight + 0.5;

  for (const src of Array.from(document.querySelectorAll("#flow > .src-page"))) {
    let body = newPage(src);
    const blocks = Array.from(src.children);
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i].cloneNode(true);
      body.appendChild(b);
      if (!overflows(body)) continue;
      body.removeChild(b);
      if (b.dataset.splittable === "rows") {
        // tabla: llenar fila por fila; continuar en páginas nuevas con el encabezado repetido
        const rows = Array.from(b.querySelectorAll("tbody > tr"));
        let part = b.cloneNode(true); part.querySelector("tbody").innerHTML = "";
        body.appendChild(part);
        for (const r of rows) {
          part.querySelector("tbody").appendChild(r.cloneNode(true));
          if (overflows(body)) {
            part.querySelector("tbody").lastChild.remove();
            if (!part.querySelector("tbody").children.length) body.removeChild(part);
            body = newPage(src);
            part = b.cloneNode(true); part.querySelector("tbody").innerHTML = "";
            const cap = part.querySelector("caption"); if (cap) cap.textContent += " (continued)";
            body.appendChild(part);
            part.querySelector("tbody").appendChild(r.cloneNode(true));
            if (overflows(body)) errors.push({ page: pageNo, block: "matrix_table row", reason: "row taller than a page" });
          }
        }
        continue;
      }
      // keep-with-next: un encabezado de sección no queda solo al pie
      const prev = body.lastElementChild;
      body = newPage(src);
      if (prev && prev.dataset.keepWithNext === "true") { body.appendChild(prev); }
      body.appendChild(b);
      if (overflows(body)) errors.push({ page: pageNo, block: b.dataset.block, reason: "block taller than an empty page" });
    }
  }
  document.getElementById("flow").remove();
  // lint: desbordes horizontales y textos recortados dentro de cada página
  const lint = [];
  for (const page of document.querySelectorAll(".page")) {
    const pr = page.getBoundingClientRect();
    for (const el of page.querySelectorAll(".page-body *")) {
      const r = el.getBoundingClientRect();
      if (r.width && (r.right > pr.right - 1 || r.left < pr.left + 1)) lint.push({ page: page.dataset.src, el: el.tagName + "." + el.className, issue: "outside page" });
      if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== "visible") lint.push({ page: page.dataset.src, el: el.tagName, issue: "clipped" });
    }
    const body = page.querySelector(".page-body");
    if (overflows(body)) lint.push({ page: page.dataset.src, issue: "body overflow" });
  }
  return { pages: pageNo, errors, lint };
};
