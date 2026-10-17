import { createHash } from "node:crypto";

/**
 * Validación del canal de carga (I8, A08): el tipo se detecta por la firma del archivo, nunca por su nombre, y el
 * contenido activo se rechaza ANTES de guardar. Con un archivo rechazado solo queda el motivo y la huella.
 * Límite honesto: sin antimalware (B8) esto no sustituye al escáner; por eso en producción sin escáner la carga se rechaza.
 */
export type DetectedType = "csv" | "json" | "xlsx" | "pdf" | "docx" | "txt" | "zip";

export type UploadDecision =
  | { ok: true; type: DetectedType; sha256: string; byteLength: number }
  | { ok: false; reason: UploadRejection; sha256: string; byteLength: number };

export type UploadRejection =
  | "empty"
  | "too_large"
  | "executable"
  | "macro_enabled_office"
  | "active_content_pdf"
  | "embedded_objects"
  | "active_content_text"
  | "unsupported_type"
  | "invalid_text_encoding"
  | "invalid_json"
  | "formula_injection"
  | "scanner_unavailable"
  | "infected";

export const sha256OfBytes = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

const PDF_ACTIVE = /\/(JavaScript|JS|Launch|OpenAction|AA|EmbeddedFile|EmbeddedFiles|RichMedia|XFA|SubmitForm|ImportData)\b/;

function listZipNames(bytes: Uint8Array): string[] {
  // Directorio central: firma 0x02014b50; el nombre sigue a la cabecera de 46 bytes.
  const buf = Buffer.from(bytes);
  const names: string[] = [];
  let i = 0;
  while ((i = buf.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), i)) !== -1) {
    if (i + 46 > buf.length) break;
    const nameLen = buf.readUInt16LE(i + 28);
    const extraLen = buf.readUInt16LE(i + 30);
    const commentLen = buf.readUInt16LE(i + 32);
    names.push(buf.subarray(i + 46, i + 46 + nameLen).toString("utf8"));
    i += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

function decodePdfNames(raw: string): string {
  // Los nombres PDF admiten escapes #xx (/J#61vaScript): se decodifican antes de buscar.
  return raw.replace(/#([0-9a-fA-F]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16)));
}

export function validateUpload(bytes: Uint8Array, options: { maxBytes: number }): UploadDecision {
  const sha256 = sha256OfBytes(bytes);
  const byteLength = bytes.length;
  const reject = (reason: UploadRejection): UploadDecision => ({ ok: false, reason, sha256, byteLength });
  if (byteLength === 0) return reject("empty");
  if (byteLength > options.maxBytes) return reject("too_large");
  const head = Buffer.from(bytes.subarray(0, 8));

  if ((head[0] === 0x4d && head[1] === 0x5a) || head.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) || head.subarray(0, 2).toString("latin1") === "#!" || head.subarray(0, 4).equals(Buffer.from([0xca, 0xfe, 0xba, 0xbe]))) {
    return reject("executable");
  }

  if (head.subarray(0, 5).toString("latin1") === "%PDF-") {
    const decoded = decodePdfNames(Buffer.from(bytes).toString("latin1"));
    return PDF_ACTIVE.test(decoded) ? reject("active_content_pdf") : { ok: true, type: "pdf", sha256, byteLength };
  }

  if (head.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    const names = listZipNames(bytes).map((n) => n.toLowerCase());
    if (names.some((n) => n.endsWith("vbaproject.bin") || n.includes("/macros/") || n.endsWith(".xlsm") || n.includes("vbadata"))) return reject("macro_enabled_office");
    if (names.some((n) => n.includes("/embeddings/") || n.includes("oleobject") || n.includes("/activex/") || n.includes("externallinks/"))) return reject("embedded_objects");
    if (names.includes("xl/workbook.xml")) return { ok: true, type: "xlsx", sha256, byteLength };
    if (names.includes("word/document.xml")) return { ok: true, type: "docx", sha256, byteLength };
    return reject("unsupported_type");
  }

  // Texto: UTF-8 estricto, sin NUL.
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return reject("unsupported_type");
  }
  if (text.includes("\u0000")) return reject("invalid_text_encoding");
  const trimmed = text.replace(/^\uFEFF/, "").trimStart();
  if (/^<\s*(script|html|!doctype|\?php)/i.test(trimmed)) return reject("active_content_pdf" as UploadRejection) && reject("unsupported_type");
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      JSON.parse(trimmed);
      return { ok: true, type: "json", sha256, byteLength };
    } catch {
      return reject("invalid_json");
    }
  }
  const firstLine = trimmed.split(/\r?\n/, 1)[0] ?? "";
  if (/[,;\t]/.test(firstLine)) {
    // Inyección de fórmulas: una celda que empieza con = o @ se interpretaría como fórmula en una hoja de cálculo.
    if (/(^|[,;\t\n])\s*"?[=@]/.test(text)) return reject("formula_injection");
    return { ok: true, type: "csv", sha256, byteLength };
  }
  return { ok: true, type: "txt", sha256, byteLength };
}

// ----------------------------------------------------------------------------------------------------- escáner (B8)
export type ScanOutcome = "clean" | "infected" | "unavailable";
export interface ScanAdapter {
  scan(bytes: Uint8Array): Promise<ScanOutcome>;
}

/** Solo desarrollo y CI: archivos sintéticos. En producción no existe «sin escáner» (B8): la carga se rechaza. */
export class DevNoScan implements ScanAdapter {
  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}
  async scan(): Promise<ScanOutcome> {
    return this.env.NODE_ENV === "production" ? "unavailable" : "clean";
  }
  get resultLabel(): "not_required_dev" {
    return "not_required_dev";
  }
}
