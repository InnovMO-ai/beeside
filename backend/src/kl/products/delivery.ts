import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { Request, RequestHandler, Router } from "express";
import { Pool } from "pg";
import { ObjectStore } from "../ingest/object-store";
import { KlLocale } from "../contract/kl-v1";
import { EditionIntegrityError, OpenEditionStore, KlReadService } from "../read/read-service";
export { EditionIntegrityError };
import { RateLimitPolicy, RateLimiter, rateLimit } from "../../security/rate-limit";
import { KlError } from "../db/errors";

/**
 * Distribución controlada de ediciones PUBLICADAS (Design Spec §10). No existe URL pública ni firmada: el archivo solo sale por una ruta
 * autenticada del consumidor (Precision: sesión + acceso al proyecto en cada petición), que pide los bytes a KL en proceso
 * (`openEdition`). Solo se sirve la edición vigente; ES y EN siempre juntos; KL no sabe quién descarga (conteo anónimo por día).
 */
export class ObjectStoreEditionStore implements OpenEditionStore {
  constructor(
    private readonly reader: Pool,
    private readonly store: ObjectStore,
  ) {}

  async open(editionRef: string, locale: KlLocale) {
    const r = await this.reader.query<{ storage_key: string; pdf_sha256: string; byte_length: string; filename: string }>(
      "SELECT storage_key, pdf_sha256, byte_length, filename FROM kl.v_edition_file WHERE edition_ref = $1 AND locale = $2",
      [editionRef, locale],
    );
    const row = r.rows[0];
    if (!row) return null;
    const bytes = await this.store.get(row.storage_key);
    // La edición publicada está congelada: lo que se entrega debe coincidir con la huella registrada.
    if (createHash("sha256").update(bytes).digest("hex") !== row.pdf_sha256 || bytes.length !== Number(row.byte_length)) throw new EditionIntegrityError();
    return { filename: row.filename, sha256: row.pdf_sha256, byteLength: bytes.length, stream: () => Readable.from(bytes) };
  }
}

export type DownloadAuth = "ok" | "unauthenticated" | "forbidden";

/**
 * Manejador de la ruta autenticada de descarga que monta el consumidor (Precision, I21) en
 * `/…/resources/:productKey?locale=es|en`. KL no decide quién puede descargar: lo decide `authorize`, que el consumidor implementa con
 * su sesión y el acceso al proyecto, y se evalúa en CADA petición.
 */
export function createEditionDownloadHandler(read: KlReadService, options: { authorize: (req: Request) => Promise<DownloadAuth>; log?: (message: string) => void }): RequestHandler {
  return (req, res, next) => {
    void (async () => {
      const auth = await options.authorize(req);
      if (auth !== "ok") {
        res.status(auth === "unauthenticated" ? 401 : 403).json({ error: auth === "unauthenticated" ? "UNAUTHENTICATED" : "FORBIDDEN" });
        return;
      }
      const productKey = String(req.params.productKey ?? "");
      const locale = req.query.locale === "en" ? "en" : req.query.locale === "es" ? "es" : null;
      if (!locale || !/^[a-z0-9_]{2,60}$/.test(productKey)) {
        res.status(400).json({ error: "INVALID_REQUEST" });
        return;
      }
      let result;
      try {
        result = await read.openEdition({ productKey, locale });
      } catch (error) {
        options.log?.(error instanceof EditionIntegrityError ? "kl.edition.integrity_failure" : "kl.edition.open_failed");
        res.status(500).json({ error: "UNAVAILABLE" });
        return;
      }
      if (result.status !== "ok") {
        res.status(404).json({ error: "NO_CURRENT_EDITION" });
        return;
      }
      res.set({
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${result.filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
        "Content-Length": String(result.byteLength),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Edition-Ref": result.editionRef,
      });
      result.stream().pipe(res);
    })().catch(next);
  };
}

/** Verificación pública (PO-2): solo el estado de la edición, sin contenido, enlaces ni datos de cliente. Misma forma para lo desconocido. */
export const EDITION_VERIFY_POLICY: RateLimitPolicy = { name: "kl_edition_verify_address", limit: 60, windowSeconds: 600 };

export function createPublicEditionRouter(read: KlReadService, security: { limiter?: RateLimiter } = {}): Router {
  const router = Router();
  router.get("/:id/status", rateLimit(security.limiter, EDITION_VERIFY_POLICY), (req, res, next) => {
    void (async () => {
      res.set({ "Cache-Control": "no-store", "X-Robots-Tag": "noindex", "X-Content-Type-Options": "nosniff" });
      try {
        res.json(await read.editionPublicStatus(String(req.params.id ?? "")));
      } catch (error) {
        // Una falla de infraestructura NO se presenta como «unknown»: 503 genérico (sin detalle interno) y reintento sugerido.
        if (error instanceof KlError && error.code === "UNAVAILABLE") {
          res.set("Retry-After", "30");
          res.status(503).json({ error: "UNAVAILABLE" });
          return;
        }
        throw error;
      }
    })().catch(next);
  });
  return router;
}
