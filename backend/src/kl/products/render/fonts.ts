import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ASSETS_DIR } from "./assets-dir";
import { FontFamily, composeFlowHtml, loadAssets } from "./compose";
import { BrowserLike, renderPdf } from "./pdf";
import { GuideDocument } from "../guide-model";

/**
 * Verificación de tipografía (condición B7): disponibilidad, licencia (SIL OFL 1.1) y compatibilidad con el Chromium del worker
 * (incrustación, caracteres de español e inglés, PDF etiquetado). Lato solo se usa si pasa; si no, el mismo tema compone con
 * Public Sans (tipografía provisional, misma estructura).
 */
export interface FontVerification {
  family: FontFamily;
  available: boolean;
  licenseOk: boolean;
  compatible: boolean;
  details: string[];
  files: { file: string; sha256: string }[];
}

const DIRS: Record<FontFamily, string> = { lato: "fonts", publicsans: "fonts-fallback" };
const SAMPLE = "Áéíóúüñ ÁÉÍÓÚÜÑ ¿¡ — · € % 0123456789 beeside Knowledge Layer";

export function verifyFontFiles(family: FontFamily): Pick<FontVerification, "available" | "licenseOk" | "files" | "details"> {
  const details: string[] = [];
  let available = true;
  let files: FontVerification["files"] = [];
  try {
    files = loadAssets(family).fontFiles;
    for (const f of files) if (!/^[0-9a-f]{64}$/.test(f.sha256)) available = false;
  } catch (error) {
    available = false;
    details.push(`archivos de fuente no disponibles: ${String(error).slice(0, 120)}`);
  }
  let licenseOk = false;
  try {
    const text = readFileSync(join(ASSETS_DIR, DIRS[family], "LICENSE"), "utf8");
    licenseOk = /SIL OPEN FONT LICENSE Version 1\.1/i.test(text) && /Reserved Font Name|Font Software/i.test(text);
    if (!licenseOk) details.push("la licencia no es SIL OFL 1.1");
  } catch {
    details.push("falta el archivo de licencia");
  }
  return { available, licenseOk, files, details };
}

/** Compatibilidad real con Chromium: se imprime una muestra y se comprueba que la fuente quedó incrustada y que el PDF sale etiquetado. */
export async function verifyFontCompatibility(family: FontFamily, browser: BrowserLike): Promise<{ compatible: boolean; details: string[] }> {
  const details: string[] = [];
  const doc: GuideDocument = {
    kind: "knowledge_guide", product: "sample", locale: "es", status: "PUBLISHED", statusLabel: "",
    edition: { code: "0.0", label: "V0.0", month: "ENERO 2000", monthLong: "enero 2000", country: "MX", dataCutoff: "1 enero 2000" },
    chrome: { left: "beeside", guide: "sample", continued: "(cont.)" }, links: {}, sources: {},
    pages: [{ id: "sample", kind: "body", chrome: true, pillar: "x", blocks: [{ type: "section_header", eyebrow: "A", title: SAMPLE, dek: SAMPLE }, { type: "editorial_note", label: "N", text: SAMPLE }] }],
  };
  const assets = loadAssets(family);
  const r = await renderPdf({ html: composeFlowHtml(doc, assets), paginateJs: assets.paginateJs }, browser);
  const raw = r.pdf.toString("latin1");
  const embedded = /\/FontFile2/.test(raw) && (family === "lato" ? /\+Lato/.test(raw) : /\+Public ?Sans/i.test(raw));
  if (!embedded) details.push("la fuente no quedó incrustada en el PDF");
  const tagged = /\/MarkInfo\s*<<[^>]*\/Marked true/.test(raw) && /\/StructTreeRoot/.test(raw) && /\/Lang \(es\)/.test(raw);
  if (!tagged) details.push("el PDF no salió etiquetado con idioma");
  if (r.blockedRequests.length > 0) details.push("la muestra intentó acceder a la red");
  return { compatible: embedded && tagged && r.blockedRequests.length === 0, details };
}

export async function verifyFontFamily(family: FontFamily, browser: BrowserLike): Promise<FontVerification> {
  const files = verifyFontFiles(family);
  let compat = { compatible: false, details: ["no verificada"] as string[] };
  if (files.available && files.licenseOk) compat = await verifyFontCompatibility(family, browser);
  return { family, available: files.available, licenseOk: files.licenseOk, compatible: compat.compatible, details: [...files.details, ...compat.details], files: files.files };
}

/** Lato si supera las tres pruebas; si no, Public Sans (la alternativa segura aprobada). */
export async function resolveFontFamily(browser: BrowserLike, preferred: FontFamily = "lato"): Promise<{ family: FontFamily; verification: FontVerification; fallbackReason?: string }> {
  const first = await verifyFontFamily(preferred, browser);
  if (first.available && first.licenseOk && first.compatible) return { family: preferred, verification: first };
  const fallback: FontFamily = preferred === "lato" ? "publicsans" : "lato";
  return { family: fallback, verification: await verifyFontFamily(fallback, browser), fallbackReason: first.details.join("; ") };
}

export const sha256Hex = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex");
