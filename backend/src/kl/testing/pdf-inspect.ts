import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** Inspección de PDF con pdf.js instalado FUERA del repo (herramienta de pruebas); sin él, las comprobaciones que lo exigen se omiten con aviso. */
export interface PdfInspection {
  numPages: number;
  pages: { text: string; width: number; height: number }[];
  outline: string[];
  info: Record<string, unknown>;
}

export function pdfjsPath(): string | null {
  const candidates = [process.env.KL_PDFJS, path.join(os.homedir(), "Developer", "beeside-kl-tools", "node_modules", "pdfjs-dist", "legacy", "build", "pdf.mjs")].filter((p): p is string => Boolean(p));
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

export function inspectPdf(pdf: Buffer): PdfInspection | null {
  const lib = pdfjsPath();
  if (!lib) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kl-pdf-"));
  const file = path.join(dir, "doc.pdf");
  fs.writeFileSync(file, pdf);
  try {
    const out = execFileSync(process.execPath, [path.join(__dirname, "pdf-text.mjs"), lib, file], { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
    return JSON.parse(out) as PdfInspection;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
