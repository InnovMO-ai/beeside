import { GuideDocument } from "../guide-model";
import { BrowserLike, renderPdf } from "./pdf";
import { composeFlowHtml, loadAssets } from "./compose";
import { editionStamp, normalizePdf } from "./normalize";
import { sha256Hex } from "./fonts";

/**
 * Documento de referencia mínimo y sintético para comprobar el generador de PDF en cualquier entorno (host de CI, contenedor
 * runtime-kl-worker, máquina local) sin base de datos ni red. Lo usan la prueba `r3-smoke-reference` y `scripts/kl/smoke/render-smoke.js`
 * para que la huella del contenedor y la del host salgan exactamente del mismo código y puedan compararse.
 */
export function smokeDocument(): GuideDocument {
  return {
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
  };
}

export interface SmokeRender {
  pdfSha256: string;
  pages: number;
  header: string;
  blockedRequests: string[];
}

/** Compone y renderiza el documento de referencia con la misma tubería que una edición (compose → Chromium → normalización). */
export async function renderSmokeOnce(browser: BrowserLike, options: { html?: (html: string) => string } = {}): Promise<SmokeRender> {
  const assets = loadAssets("lato");
  const flow = composeFlowHtml(smokeDocument(), assets);
  const r = await renderPdf({ html: options.html ? options.html(flow) : flow, paginateJs: assets.paginateJs }, browser);
  const { pdf } = normalizePdf(r.pdf, editionStamp("2026-10-15"), "a".repeat(32));
  return { pdfSha256: sha256Hex(pdf), pages: r.pages, header: pdf.subarray(0, 5).toString("latin1"), blockedRequests: r.blockedRequests };
}

/** Clave de la línea de referencia: motor, versión y plataforma (la huella del PDF depende de las tres). */
export const smokeBaselineKey = (browser: BrowserLike): string => `${process.platform}-${process.arch}-chromium-${browser.version()}-lato`;
