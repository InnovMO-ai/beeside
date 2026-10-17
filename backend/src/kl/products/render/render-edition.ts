import { createHash, randomBytes } from "node:crypto";
import { Pool } from "pg";
import { withServiceAttestation } from "../../db/attested-tx";
import { ObjectStore } from "../../ingest/object-store";
import { GuideBuildError, Snapshot, buildKnowledgeGuide } from "../builder";
import { GuideCopy, GuideDocument, GuideLocale, GuideStatus } from "../guide-model";
import { FontFamily, composeFlowHtml, loadAssets } from "./compose";
import { sha256Hex, verifyFontFamily } from "./fonts";
import { editionStamp, normalizePdf } from "./normalize";
import { BrowserLike, PdfResult, RenderError, renderPdf } from "./pdf";

/**
 * Generación de las dos versiones (ES y EN) de una edición. `renderGuidePdfs` es el núcleo reproducible y no toca la base:
 * mismo snapshot + mismos datos de edición + misma versión de Chromium ⇒ mismo PDF normalizado byte a byte (AC-10).
 * `renderEditionJob` lo orquesta para el worker (render en `kl-worker`, sin red, una vez por edición e idioma, al publicar).
 */
export interface GuideArtifact {
  locale: GuideLocale;
  document: GuideDocument;
  documentSha256: string;
  printHtmlSha256: string;
  pdf: Buffer;
  pdfSha256: string;
  pages: number;
  pagedHtml: string;
  blockedRequests: string[];
  chromium: string;
  pagePng?: Buffer[];
}

export function copyFor(snap: Snapshot, locale: GuideLocale): GuideCopy {
  const fb = snap.fixedBlocks.find((b) => b.blockId === "guide_copy" && b.locale === locale);
  const declared = snap.manifest.fixedBlocks.find((b) => b.blockId === "guide_copy");
  if (!fb || !declared || declared[locale === "es" ? "sha256_es" : "sha256_en"] !== fb.sha256) throw new GuideBuildError("guide_copy", `falta la copia editorial aprobada (guide_copy) en ${locale}`);
  return fb.content as unknown as GuideCopy;
}

/** Identificador público de verificación: 128 bits aleatorios en base32 sin relleno (26 caracteres). */
export function newVerificationId(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  const bytes = randomBytes(16);
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return out;
}

export async function renderGuidePdfs(
  snap: Snapshot,
  options: { status: GuideStatus; verificationId?: string; family: FontFamily; browser: BrowserLike; screenshots?: boolean },
): Promise<GuideArtifact[]> {
  const assets = loadAssets(options.family);
  const out: GuideArtifact[] = [];
  for (const locale of ["es", "en"] as const) {
    const document = buildKnowledgeGuide(snap, { locale, copy: copyFor(snap, locale), status: options.status, ...(options.verificationId ? { verificationId: options.verificationId } : {}) });
    const html = composeFlowHtml(document, assets);
    const r: PdfResult = await renderPdf({ html, paginateJs: assets.paginateJs, ...(options.screenshots ? { screenshots: true } : {}) }, options.browser);
    // La fecha de la edición (corte de datos) y la huella del manifiesto fijan los campos volátiles del PDF.
    const { pdf } = normalizePdf(r.pdf, editionStamp(snap.edition.cutoffDate), snap.edition.manifestSha256.slice(0, 32));
    out.push({
      locale, document, documentSha256: sha256Hex(JSON.stringify(document)), printHtmlSha256: sha256Hex(r.pagedHtml), pdf, pdfSha256: sha256Hex(pdf), pages: r.pages,
      pagedHtml: r.pagedHtml, blockedRequests: r.blockedRequests, chromium: r.chromium, ...(r.pagePng ? { pagePng: r.pagePng } : {}),
    });
  }
  return out;
}

export interface RenderJobDeps {
  knowledge: Pool;
  store: ObjectStore;
  browser: BrowserLike;
}

export type RenderJobResult = { kind: "final"; editionId: string; verificationId: string } | { kind: "preview"; editionId: string } | { kind: "skipped"; reason: string };

const fail = async (deps: RenderJobDeps, editionId: string, code: string) => {
  await withServiceAttestation(deps.knowledge, (tx) => tx.query("SELECT kl.fail_rendering($1, $2)", [editionId, code])).catch(() => undefined);
};

export async function renderEditionJob(deps: RenderJobDeps, editionId: string, kind: "final" | "preview", options: { verificationId?: string } = {}): Promise<RenderJobResult> {
  const snapshot = await withServiceAttestation(deps.knowledge, async (tx) => {
    try {
      return (await tx.query<{ s: Snapshot }>("SELECT kl.edition_snapshot($1) AS s", [editionId])).rows[0]?.s ?? null;
    } catch {
      return null; // la edición ya no está en un estado renderizable (p. ej. otro intento la publicó o volvió a composición)
    }
  });
  if (!snapshot) return { kind: "skipped", reason: "edition_not_renderable" };
  if (kind === "final" && snapshot.edition.status !== "rendering") return { kind: "skipped", reason: "edition_not_rendering" };
  if (kind === "preview" && snapshot.edition.status !== "in_approval") return { kind: "skipped", reason: "edition_not_in_approval" };

  const verificationId = kind === "final" ? (options.verificationId ?? newVerificationId()) : undefined;
  let artifacts: GuideArtifact[];
  try {
    // La tipografía la fija el manifiesto congelado: si no supera la verificación en este worker NO se cambia en silencio, se detiene.
    const family = snapshot.manifest.fonts.family;
    const fontCheck = await verifyFontFamily(family, deps.browser);
    if (!(fontCheck.available && fontCheck.licenseOk && fontCheck.compatible)) throw new RenderError("renderer_unavailable", `la tipografía ${family} no supera la verificación: ${fontCheck.details.join("; ")}`);
    artifacts = await renderGuidePdfs(snapshot, { status: kind === "final" ? "PUBLISHED" : "PREVIEW", ...(verificationId ? { verificationId } : {}), family, browser: deps.browser });
    if (kind === "final" && artifacts.some((a) => a.blockedRequests.length > 0)) throw new RenderError("network_attempt", "el render intentó acceder a la red");
  } catch (error) {
    const code = error instanceof RenderError ? error.code : error instanceof GuideBuildError ? `build_${error.code}`.slice(0, 60) : "render_failed";
    if (kind === "final") await fail(deps, editionId, code);
    throw error;
  }

  const product = snapshot.edition.productKey;
  const code = snapshot.edition.code;
  if (kind === "final") {
    const renderings: Record<string, unknown>[] = [];
    for (const a of artifacts) {
      const key = `kl/editions/${product}/${code}/${a.locale}/${a.pdfSha256}.pdf`;
      await deps.store.putKeyed(key, a.pdfSha256, a.pdf);
      renderings.push({ locale: a.locale, report_document_sha256: a.documentSha256, print_html_sha256: a.printHtmlSha256, pdf_sha256: a.pdfSha256, byte_length: a.pdf.length, storage_key: key, renderer: `chromium@${a.chromium}` });
    }
    try {
      await withServiceAttestation(deps.knowledge, (tx) => tx.query("SELECT kl.complete_rendering($1, $2, $3::jsonb)", [editionId, createHash("sha256").update(verificationId as string).digest("hex"), JSON.stringify(renderings)]));
    } catch (error) {
      await fail(deps, editionId, "publish_refused");
      throw error;
    }
    return { kind: "final", editionId, verificationId: verificationId as string };
  }
  for (const a of artifacts) {
    const key = `kl/previews/p${editionId.replace(/-/g, "")}/${a.locale}/${a.pdfSha256}.pdf`;
    await deps.store.putKeyed(key, a.pdfSha256, a.pdf);
    await withServiceAttestation(deps.knowledge, (tx) => tx.query("SELECT kl.complete_preview($1, $2, $3, $4, $5)", [editionId, a.locale, a.pdfSha256, a.pdf.length, key]));
  }
  return { kind: "preview", editionId };
}
