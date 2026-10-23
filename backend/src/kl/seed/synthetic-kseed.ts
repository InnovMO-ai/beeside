import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { AttestedPrincipal, withAttestation } from "../db/attested-tx";
import { extractCsv, runQa } from "../ingest/csv-extractor";
import { ObjectStore } from "../ingest/object-store";
import { ScanAdapter, validateUpload } from "../ingest/upload-validator";
import { klAdmin } from "../service/admin-service";

/**
 * KSeed SINTÉTICO (I9): datos inventados para desarrollo y pruebas. Ejecuta el flujo real del canal de carga
 * (validación de archivo, original inmutable, extracción con localizador, QA, revisión por una persona distinta de
 * quien sube, publicación) y publica fichas con su variante en inglés. Nada de esto contiene datos reales ni de clientes.
 */
export interface SeedActors {
  /** Propone fuentes y sube cargas (KL_EDITOR). */
  editor: AttestedPrincipal;
  /** Revisa y aprueba cargas y fichas (KL_REVIEWER, distinto del editor). */
  reviewer: AttestedPrincipal;
  /** Aprueba la fuente (KL_ADMIN). */
  admin: AttestedPrincipal;
}

export interface SeedDeps {
  app: Pool;
  store: ObjectStore;
  scan: ScanAdapter;
  actors: SeedActors;
  maxBytes?: number;
}

export const SYNTHETIC = {
  institution: "sint.instituto",
  publication: "sint.instituto.encuesta_empleo",
  indicator: "informalidad_laboral_sint",
  period: { label: "2026-T1", start: "2026-01-01", end: "2026-03-31" },
  states: { "MX-GUA": 41.2, "MX-JAL": 36.8, "MX-NLE": 28.4, "MX-QUE": 33.1, "MX-CHH": 30.7, "MX-YUC": 52.9 } as Record<string, number>,
} as const;

export function syntheticCsv(): string {
  const lines = ["indicator_key,geo_code,period_label,period_start,period_end,value,label"];
  for (const [geo, value] of Object.entries(SYNTHETIC.states)) {
    lines.push(`${SYNTHETIC.indicator},${geo},${SYNTHETIC.period.label},${SYNTHETIC.period.start},${SYNTHETIC.period.end},${value},Informalidad laboral (sintético)`);
  }
  return `${lines.join("\n")}\n`;
}

const as = <T>(deps: SeedDeps, who: AttestedPrincipal, fn: Parameters<typeof withAttestation<T>>[3]) => withAttestation(deps.app, who, randomUUID(), fn);

export interface SeedResult {
  batchId: string;
  statVersions: number;
  cards: string[];
}

export async function loadSyntheticKseed(deps: SeedDeps): Promise<SeedResult> {
  const { actors } = deps;
  const maxBytes = deps.maxBytes ?? 50 * 1024 * 1024;

  // Fuente y indicador (nada se activa solo: la fuente la aprueba KL_ADMIN).
  await as(deps, actors.editor, async (tx) => {
    await klAdmin.proposeInstitution(tx, { key: SYNTHETIC.institution, name: "Instituto Sintético de Estadística", country: "MX", authorityClass: "A", kind: "public" });
    await klAdmin.proposePublication(tx, {
      key: SYNTHETIC.publication, institutionKey: SYNTHETIC.institution, title: "Encuesta sintética de empleo", jurisdiction: "MX", topics: ["labor"],
      officialUrl: "https://datos.sintetico.example/empleo", permittedUse: "paraphrase_and_cite", defaultContentRisk: "low",
    });
  });
  await as(deps, actors.admin, (tx) => klAdmin.decidePublication(tx, SYNTHETIC.publication, "approve", "KSeed sintético"));
  await as(deps, actors.editor, (tx) =>
    klAdmin.registerIndicator(tx, { key: SYNTHETIC.indicator, nameEs: "Informalidad laboral (sintético)", nameEn: "Labour informality (synthetic)", unit: "%", direction: "lower_is_better", nature: "objective", publicationKey: SYNTHETIC.publication, consumable: true }),
  );

  // Canal de carga: validar, guardar el original inmutable, extraer, QA.
  const bytes = Buffer.from(syntheticCsv(), "utf8");
  const decision = validateUpload(bytes, { maxBytes });
  if (!decision.ok) throw new Error(`el KSeed sintético fue rechazado: ${decision.reason}`);
  if ((await deps.scan.scan(bytes)) !== "clean") throw new Error("escáner no disponible");
  const storageKey = await deps.store.put(decision.sha256, bytes);
  const { rows, missingColumns } = extractCsv(bytes.toString("utf8"));
  if (missingColumns.length > 0) throw new Error(`columnas faltantes: ${missingColumns.join(", ")}`);
  const qa = runQa(rows, { knownIndicators: new Set([SYNTHETIC.indicator]), percentIndicators: new Set([SYNTHETIC.indicator]) });

  const batchId = await as(deps, actors.editor, async (tx) => {
    const fileId = await klAdmin.registerFile(tx, { sha256: decision.sha256, type: decision.type, byteLength: decision.byteLength, storageKey, scanResult: "not_required_dev" });
    const id = await klAdmin.createBatch(tx, { origin: "kseed", publicationKey: SYNTHETIC.publication, editionLabel: SYNTHETIC.period.label, sourcePublishedAt: "2026-04-15", provenanceUrl: "https://datos.sintetico.example/empleo", declaredLicense: "uso sintético", fileObjectId: fileId });
    await klAdmin.addExtractedRows(tx, id, rows);
    const state = await klAdmin.setQa(tx, id, qa.checks, qa.blockingFailures);
    if (state !== "in_review") throw new Error(`la carga no pasó QA (${qa.blockingFailures} fallas bloqueantes)`);
    return id;
  });

  // Revisión por una persona distinta de quien subió, y publicación.
  await as(deps, actors.reviewer, async (tx) => {
    await klAdmin.reviewBatch(tx, batchId, true, "KSeed sintético");
  });
  const statVersions = await as(deps, actors.reviewer, (tx) => klAdmin.publishBatch(tx, batchId));

  // Fichas sintéticas con variante en inglés.
  const cards: string[] = [];
  const card = async (c: Parameters<typeof klAdmin.createCardVersion>[1]) => {
    const versionId = await as(deps, actors.editor, async (tx) => {
      const id = await klAdmin.createCardVersion(tx, c);
      await klAdmin.submitVersion(tx, id);
      return id;
    });
    await as(deps, actors.reviewer, async (tx) => {
      await klAdmin.approveVersion(tx, versionId);
      if (c.variantEn) await klAdmin.approveVariant(tx, versionId);
    });
    cards.push(c.unitKey);
  };
  await card({
    unitKey: "card.mx.sint.perfil-pais", country: "MX", topicKey: "country.profile", contentRisk: "low", cardType: "country_profile",
    titleEs: "México · perfil sintético del país", bodyEs: "Ficha sintética de contexto general. No describe requisitos ni cifras reales.",
    claimsEs: [], limitsEs: ["Contenido sintético de prueba."], limitsEn: ["Synthetic test content."],
    variantEn: { title: "Mexico · synthetic country profile", body: "Synthetic general context card. It describes no real requirements or figures." },
  });
  await card({
    unitKey: "card.mx.sint.puerto-contexto", country: "MX", topicKey: "logistics.port.synthetic", categoryKeys: ["logistics"], contentRisk: "medium", cardType: "context",
    titleEs: "Puerto sintético · contexto", bodyEs: "Ficha de contexto sintética sobre un puerto inventado. No incluye rutas, costos ni tiempos.",
    primarySourcePublicationKey: SYNTHETIC.publication,
    limitsEs: ["No incluye rutas, costos ni tiempos."], limitsEn: ["It includes no routes, costs or times."],
    variantEn: { title: "Synthetic port · context", body: "Synthetic context card about an invented port. It includes no routes, costs or times." },
  });
  return { batchId, statVersions, cards };
}
