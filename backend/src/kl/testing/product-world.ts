import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Pool } from "pg";
import { withAttestation, withServiceAttestation } from "../db/attested-tx";
import { Snapshot } from "../products/builder";
import { LocalObjectStore } from "../ingest/object-store";
import { GuideCopy } from "../products/guide-model";
import { submitEdition } from "../products/manifest";
import { renderEditionJob, RenderJobDeps } from "../products/render/render-edition";
import { BrowserLike } from "../products/render/pdf";
import { klAdmin } from "../service/admin-service";
import { attestedOf, buildWorld, createCardVersion, one, pools, publishStat, run, seedSource, World } from "./world";

/** Producto sintético tipo «Doing Business»: fuentes, estadísticas, fichas (una de riesgo alto validada), bloques fijos y configuración. Todo inventado. */
export interface ProductWorld extends World {
  p: ReturnType<typeof pools>;
  store: LocalObjectStore;
  productKey: string;
  source: { institution: string; publication: string; indicator: string };
  units: { stats: string[]; cards: string[]; obligation: string };
  verifyTemplate: string;
  closeAll(): Promise<void>;
}

export const COPY: Record<"es" | "en", GuideCopy> = {
  es: {
    cover: { titleLight: "Hacer negocios en", titleBold: ["México"], tagline: "Guía sintética de prueba para decidir con datos.", publisher: "beeside · Knowledge Layer" },
    chrome: { left: "beeside&nbsp; / &nbsp;GUÍA", country: "MÉXICO", guide: "Guía sintética" },
    labels: { sources: "Fuentes", notAvailable: "No disponible", keyData: "Datos clave", primarySource: "Fuente primaria", lastValidated: "Última validación", limits: "Alcance", decideWith: "Decidir con", verify: "Verificar esta edición", edition: "Edición", cutoff: "Corte de datos", nextReview: "Próxima revisión programada", changes: "Cambios respecto de la edición anterior", noChanges: "Primera edición.", previewMark: "VISTA PREVIA · NO DISTRIBUIR", permittedUse: "Uso permitido", indicator: "Indicador", value: "Valor", period: "Periodo", source: "Fuente", continued: "(continuación)" },
    months: ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"],
    ctaLinks: { "kl.links.discovery_start": { label: "Empiece aquí", text: "Comience su descubrimiento en" } },
  },
  en: {
    cover: { titleLight: "Doing business in", titleBold: ["Mexico"], tagline: "Synthetic test guide for data-driven decisions.", publisher: "beeside · Knowledge Layer" },
    chrome: { left: "beeside&nbsp; / &nbsp;GUIDE", country: "MEXICO", guide: "Synthetic guide" },
    labels: { sources: "Sources", notAvailable: "Not available", keyData: "Key data", primarySource: "Primary source", lastValidated: "Last validated", limits: "Scope", decideWith: "Decide with", verify: "Verify this edition", edition: "Edition", cutoff: "Data cutoff", nextReview: "Next scheduled review", changes: "Changes since the previous edition", noChanges: "First edition.", previewMark: "PREVIEW · DO NOT DISTRIBUTE", permittedUse: "Permitted use", indicator: "Indicator", value: "Value", period: "Period", source: "Source", continued: "(continued)" },
    months: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    ctaLinks: { "kl.links.discovery_start": { label: "Start here", text: "Begin your discovery at" } },
  },
};

export const LETTER = {
  es: { eyebrow: "CARTA DEL FUNDADOR", paragraphs: ["Texto sintético del prólogo, aprobado y con huella.", "Segundo párrafo sintético."], signature: { name: "Fundadora Sintética", role: "Fundadora" } },
  en: { eyebrow: "FOUNDER'S LETTER", paragraphs: ["Synthetic foreword text, approved and fingerprinted.", "Second synthetic paragraph."], signature: { name: "Synthetic Founder", role: "Founder" } },
};
export const JOURNEY = {
  es: { steps: [{ title: "Descubrir", text: "Paso sintético uno." }, { title: "Decidir", text: "Paso sintético dos." }], cta: "kl.links.discovery_start" },
  en: { steps: [{ title: "Discover", text: "Synthetic step one." }, { title: "Decide", text: "Synthetic step two." }], cta: "kl.links.discovery_start" },
};

export async function buildProductWorld(): Promise<ProductWorld> {
  const w = await buildWorld();
  const p = pools();
  const store = new LocalObjectStore(fs.mkdtempSync(path.join(os.tmpdir(), "kl-prod-")), { NODE_ENV: "test" });
  const productKey = "doing_business_mx";
  const verifyTemplate = "https://verify.sintetico.example/verificar/[edition-id]";

  // catálogo provisional, enlaces y producto con su configuración
  await run(w, w.admin, ["SELECT kl.register_catalog_entries('provisional-1', 'category', ARRAY['logistics'])"]);
  await run(w, w.admin, ["SELECT kl.set_setting('kl.links.edition_verify', $1::jsonb)", [JSON.stringify(verifyTemplate)]]);
  await run(w, w.admin, ["SELECT kl.create_product($1, 'MX', 'semiannual')", [productKey]]);
  await run(w, w.admin, ["SELECT kl.set_product_config($1, $2::jsonb)", [productKey, JSON.stringify({ fixedBlocks: [{ blockId: "founder_letter", version: "3.0" }, { blockId: "journey", version: "1.0" }, { blockId: "guide_copy", version: "1.0" }], links: ["kl.links.discovery_start", "kl.links.edition_verify"] })]]);

  // bloques fijos: los redacta un editor y los aprueba otra persona con rol editorial
  for (const [blockId, version, content] of [["founder_letter", "3.0", LETTER], ["journey", "1.0", JOURNEY], ["guide_copy", "1.0", COPY]] as const) {
    for (const locale of ["es", "en"] as const) {
      const id = (await one(w, w.editor, "SELECT kl.register_fixed_block($1, $2, $3, $4::jsonb) AS id", [blockId, version, locale, JSON.stringify(content[locale])])).id as string;
      await run(w, w.editorial, ["SELECT kl.approve_fixed_block($1)", [id]]);
    }
  }

  const source = await seedSource(w);
  const stats: string[] = [];
  for (const [i, geo] of (["MX-GUA", "MX-JAL", "MX-NLE"] as const).entries()) {
    const key = `stat.mx.db.${i + 1}`;
    await publishStat(w, { key, indicator: source.indicator, publication: source.publication, geo, value: 30 + i });
    stats.push(key);
  }
  const cards: string[] = [];
  for (const [i, c] of [{ k: "card.mx.db.entrada", title: "Entrada al mercado", body: "Texto sintético sobre la entrada.\n\nSegundo párrafo sintético." }, { k: "card.mx.db.talento", title: "Talento", body: "Texto sintético sobre talento." }].entries()) {
    const { versionId } = await createCardVersion(w, { key: c.k, risk: "medium", cardType: "guidance", topic: `db.${i}`, publication: source.publication, titleEs: c.title, bodyEs: c.body, claimsEs: ["Afirmación sintética uno."], variantEn: { title: `${c.title} EN`, body: `${c.body} (EN)`, claims: ["Synthetic claim one."] } });
    await run(w, w.editor, ["SELECT kl.submit_version($1)", [versionId]]);
    await run(w, w.reviewer, ["SELECT kl.approve_version($1)", [versionId]]);
    await run(w, w.reviewer2, ["SELECT kl.approve_variant($1, 'en')", [versionId]]);
    cards.push(c.k);
  }
  const obligation = "card.mx.db.obligacion";
  const { versionId } = await createCardVersion(w, { key: obligation, risk: "high", cardType: "normative", topic: "db.norma", publication: source.publication, titleEs: "Obligación sintética", bodyEs: "Texto normativo sintético.", claimsEs: ["Obligación sintética única."], variantEn: { title: "Synthetic obligation", body: "Synthetic normative text.", claims: ["Single synthetic obligation."] }, specialistCategory: "legal.mx" });
  await run(w, w.editor, ["SELECT kl.submit_version($1)", [versionId]]);
  await run(w, w.reviewer, ["SELECT kl.approve_version($1)", [versionId]]);
  await run(w, w.reviewer2, ["SELECT kl.approve_variant($1, 'en')", [versionId]]);
  const validator = (await one(w, w.reviewer, "SELECT kl.register_validator('internal', $1, 'Especialista', NULL, ARRAY['legal.mx'], NULL) AS v", [w.specialist.id])).v as string;
  await run(w, w.specialist, ["SELECT kl.record_validation($1, $2, 'es', 'legal.mx', 'alcance sintético', 'approved', NULL, now() - interval '1 day', now() + interval '6 months')", [versionId, validator]]);

  // secciones y composición
  const sec = (sectionKey: string, chapter: string, slot: string, contentType: string, order: number, es: string, en: string) =>
    run(w, w.editor, ["SELECT kl.add_product_section($1, $2, $3, NULL, $4, $5, $6, $7, $8, ARRAY['logistics'], NULL)", [productKey, sectionKey, chapter, slot, order, es, en, contentType]]);
  await sec("ch01.resumen", "01", "key_data", "data", 1, "Resumen del mercado", "Market overview");
  await sec("ch02.entrada", "02", "how_it_works", "guidance", 2, "Entrada", "Entry");
  await sec("ch03.obligaciones", "03", "obligations", "obligation", 3, "Obligaciones", "Obligations");
  for (const [i, k] of stats.entries()) await run(w, w.editor, ["SELECT kl.compose_unit($1, 'ch01.resumen', $2, $3)", [productKey, k, i + 1]]);
  for (const [i, k] of cards.entries()) await run(w, w.editor, ["SELECT kl.compose_unit($1, 'ch02.entrada', $2, $3)", [productKey, k, i + 1]]);
  await run(w, w.editor, ["SELECT kl.compose_unit($1, 'ch03.obligaciones', $2, 1)", [productKey, obligation]]);

  const pw: ProductWorld = { ...w, p, store, productKey, source, units: { stats, cards, obligation }, verifyTemplate, closeAll: async () => { await p.closeAll(); await w.close(); } };
  return pw;
}

/** Abre y envía a aprobación (la edición queda en `in_approval` con su manifiesto congelado). */
export async function composeAndSubmit(pw: ProductWorld, code: string, cutoff = "2026-10-15", family: "lato" | "publicsans" = "lato"): Promise<string> {
  const editionId = (await one(pw, pw.editor, "SELECT kl.open_edition($1, $2, $3::date) AS id", [pw.productKey, code, cutoff])).id as string;
  await withAttestation(pw.p.app, attestedOf(pw.editor), randomUUID(), (tx) => submitEdition(tx, editionId, family));
  return editionId;
}

export async function snapshotOf(pw: ProductWorld, editionId: string): Promise<Snapshot> {
  return withServiceAttestation(pw.p.knowledge, async (tx) => (await tx.query<{ s: Snapshot }>("SELECT kl.edition_snapshot($1) AS s", [editionId])).rows[0]?.s as Snapshot);
}

/** Abre, envía y aprueba una edición con personas distintas (compone el editor; aprueba el revisor editorial). */
export async function composeAndApprove(pw: ProductWorld, code: string, cutoff = "2026-10-15", family: "lato" | "publicsans" = "lato"): Promise<{ editionId: string; renderJobId: string }> {
  const editionId = (await one(pw, pw.editor, "SELECT kl.open_edition($1, $2, $3::date) AS id", [pw.productKey, code, cutoff])).id as string;
  await withAttestation(pw.p.app, attestedOf(pw.editor), randomUUID(), (tx) => submitEdition(tx, editionId, family));
  const renderJobId = await withAttestation(pw.p.app, attestedOf(pw.editorial), randomUUID(), (tx) => klAdmin.approveEdition(tx, editionId));
  return { editionId, renderJobId };
}

export const renderDeps = (pw: ProductWorld, browser: BrowserLike): RenderJobDeps => ({ knowledge: pw.p.knowledge, store: pw.store, browser });
export { renderEditionJob };
export type { Pool };
