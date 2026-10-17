import { KlTx } from "../db/attested-tx";
import { DetectedType } from "../ingest/upload-validator";
import { ExtractedRowInput, QaCheck } from "../ingest/csv-extractor";

/**
 * Operaciones de administración de KL sobre una transacción certificada. Cada método es una llamada delgada a una
 * función `kl.*` de la base: la autorización (kl.require), la doble intervención y la auditoría viven en la base.
 */
const one = async <T>(tx: KlTx, text: string, values: unknown[], column: string): Promise<T> => {
  const r = await tx.query(text, values);
  return (r.rows[0] as Record<string, unknown>)[column] as T;
};

export const KL_ROLES = ["KL_ADMIN", "KL_EDITOR", "KL_REVIEWER", "SPECIALIST_VALIDATOR"] as const;
export type KlRole = (typeof KL_ROLES)[number];

export interface CardVersionInput {
  unitKey: string;
  country: string;
  topicKey: string;
  categoryKeys?: string[];
  serviceIds?: string[];
  industryKeys?: string[];
  contentRisk: "low" | "medium" | "high";
  cardType: string;
  titleEs: string;
  bodyEs: string;
  claimsEs?: string[];
  primarySourcePublicationKey?: string | null;
  limitsEs?: string[];
  limitsEn?: string[];
  variantEn?: { title: string; body: string; claims?: string[] } | null;
  permittedUse?: "quote" | "paraphrase_and_cite" | "cite_only";
  nextReviewAt?: string | null;
  validTo?: string | null;
  specialistRequired?: boolean;
}

export const CADENCES = ["weekly", "monthly", "quarterly", "semiannual", "annual", "none"] as const;
export type KlCadence = (typeof CADENCES)[number];
export const FREQUENCIES = [...CADENCES, "inherit"] as const;

export const klAdmin = {
  // ---- R2 · periodicidad, acciones manuales y gobierno
  createProduct: (tx: KlTx, key: string, country: string, cadence: KlCadence = "semiannual") => one<string>(tx, "SELECT kl.create_product($1, $2, $3::kl.cadence) AS v", [key, country, cadence], "v"),
  setProductPeriodicity: (tx: KlTx, key: string, cadence: KlCadence, reason?: string) => one<string>(tx, "SELECT kl.set_product_periodicity($1, $2::kl.cadence, $3) AS v", [key, cadence, reason ?? null], "v"),
  setPublicationFrequency: (tx: KlTx, key: string, frequency: (typeof FREQUENCIES)[number], reason?: string) => one<string | null>(tx, "SELECT kl.set_publication_frequency($1, $2, $3) AS v", [key, frequency, reason ?? null], "v"),
  setRamCadence: (tx: KlTx, cadence: KlCadence, reason?: string) => one<number>(tx, "SELECT kl.set_ram_cadence($1::kl.cadence, $2) AS v", [cadence, reason ?? null], "v"),
  checkNow: (tx: KlTx, target: "publication" | "product", key: string, reason: string) => one<string[]>(tx, "SELECT kl.check_now($1, $2, $3) AS v", [target, key, reason], "v"),
  extraordinaryEdition: (tx: KlTx, productKey: string, reasonCode: string, reason: string) => one<string>(tx, "SELECT kl.extraordinary_edition($1, $2, $3) AS v", [productKey, reasonCode, reason], "v"),
  registerValidator: (tx: KlTx, v: { kind: "internal" | "external"; adminUserId: string | null; displayName: string; organization: string | null; domains: string[]; engagementRef: string | null }) =>
    one<string>(tx, "SELECT kl.register_validator($1, $2, $3, $4, $5, $6) AS v", [v.kind, v.adminUserId, v.displayName, v.organization, v.domains, v.engagementRef], "v"),
  setValidatorStatus: async (tx: KlTx, id: string, status: "active" | "inactive", reason?: string) => void (await tx.query("SELECT kl.set_validator_status($1, $2, $3)", [id, status, reason ?? null])),
  recordValidation: (tx: KlTx, r: { versionId: string; validatorId: string; locale: "es" | "en"; domain: string; scopeStatement: string; verdict: "approved" | "approved_with_changes_required" | "rejected"; validatedAt: string; expiresAt: string }) =>
    one<string>(tx, "SELECT kl.record_validation($1, $2, $3, $4, $5, $6, NULL, $7, $8) AS v", [r.versionId, r.validatorId, r.locale, r.domain, r.scopeStatement, r.verdict, r.validatedAt, r.expiresAt], "v"),
  // ---- R3 · Knowledge Products
  registerCatalogEntries: (tx: KlTx, version: string, kind: "category" | "service" | "industry", keys: string[]) => one<number>(tx, "SELECT kl.register_catalog_entries($1, $2, $3) AS v", [version, kind, keys], "v"),
  addPrivateTerm: (tx: KlTx, term: string, kind: "client" | "partner") => one<string>(tx, "SELECT kl.add_private_term($1, $2) AS v", [term, kind], "v"),
  setProductConfig: (tx: KlTx, productKey: string, config: { fixedBlocks: { blockId: string; version: string }[]; links: string[] }) => one<number>(tx, "SELECT kl.set_product_config($1, $2::jsonb) AS v", [productKey, JSON.stringify(config)], "v"),
  registerFixedBlock: (tx: KlTx, blockId: string, version: string, locale: "es" | "en", content: object) => one<string>(tx, "SELECT kl.register_fixed_block($1, $2, $3, $4::jsonb) AS v", [blockId, version, locale, JSON.stringify(content)], "v"),
  approveFixedBlock: async (tx: KlTx, id: string) => void (await tx.query("SELECT kl.approve_fixed_block($1)", [id])),
  addSection: (tx: KlTx, s: { productKey: string; sectionKey: string; chapter: string; part: string | null; slot: string; sort: number; titleEs: string; titleEn: string; contentType: string; categoryKeys?: string[]; validationDomain?: string | null }) =>
    one<string>(tx, "SELECT kl.add_product_section($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) AS v", [s.productKey, s.sectionKey, s.chapter, s.part, s.slot, s.sort, s.titleEs, s.titleEn, s.contentType, s.categoryKeys ?? [], s.validationDomain ?? null], "v"),
  composeUnit: (tx: KlTx, productKey: string, sectionKey: string, unitKey: string, sort: number) => one<string>(tx, "SELECT kl.compose_unit($1, $2, $3, $4) AS v", [productKey, sectionKey, unitKey, sort], "v"),
  decideChangeNotice: async (tx: KlTx, id: string, decision: "approved_for_next" | "dismissed", reason?: string) => void (await tx.query("SELECT kl.decide_change_notice($1, $2, $3)", [id, decision, reason ?? null])),
  openEdition: (tx: KlTx, productKey: string, code: string, cutoff: string) => one<string>(tx, "SELECT kl.open_edition($1, $2, $3::date) AS v", [productKey, code, cutoff], "v"),
  refreshPins: (tx: KlTx, editionId: string) => one<number>(tx, "SELECT kl.refresh_pins($1) AS v", [editionId], "v"),
  returnEdition: async (tx: KlTx, editionId: string, reason: string) => void (await tx.query("SELECT kl.return_edition_to_composing($1, $2)", [editionId, reason])),
  approveEdition: (tx: KlTx, editionId: string) => one<string>(tx, "SELECT kl.approve_edition($1) AS v", [editionId], "v"),
  requestPreview: (tx: KlTx, editionId: string) => one<string>(tx, "SELECT kl.request_preview($1) AS v", [editionId], "v"),
  unpublishEdition: async (tx: KlTx, editionId: string, reason: string) => void (await tx.query("SELECT kl.unpublish_edition($1, $2)", [editionId, reason])),
  revokeEdition: async (tx: KlTx, editionId: string, reason: string) => void (await tx.query("SELECT kl.revoke_edition($1, $2)", [editionId, reason])),
  editionControls: async (tx: KlTx, editionId: string) => (await tx.query<{ code: string; ok: boolean; detail: string }>("SELECT code, ok, detail FROM kl.edition_controls($1)", [editionId])).rows,
  beginCorrelationRun: async (tx: KlTx) => void (await tx.query("SELECT kl.begin_correlation_run()")),

  proposeInstitution: (tx: KlTx, i: { key: string; name: string; country: string; authorityClass: "A" | "B" | "C" | "D"; kind: string }) =>
    one<string>(tx, "SELECT kl.propose_institution($1, $2, $3, $4, $5) AS v", [i.key, i.name, i.country, i.authorityClass, i.kind], "v"),
  proposePublication: (tx: KlTx, p: { key: string; institutionKey: string; title: string; jurisdiction: string; topics?: string[]; officialUrl: string; permittedUse: string; defaultContentRisk: string; matrixCode?: string }) =>
    one<string>(tx, "SELECT kl.propose_publication($1, $2, $3, $4, $5, $6, $7, $8, $9) AS v", [p.key, p.institutionKey, p.title, p.jurisdiction, p.topics ?? [], p.officialUrl, p.permittedUse, p.defaultContentRisk, p.matrixCode ?? null], "v"),
  registerIndicator: (tx: KlTx, i: { key: string; nameEs: string; nameEn: string; unit: string; direction: "higher_is_better" | "lower_is_better" | null; nature: "objective" | "perception" | "composite"; publicationKey: string | null; consumable: boolean }) =>
    one<string>(tx, "SELECT kl.register_indicator($1, $2, $3, $4, $5, $6, $7, $8) AS v", [i.key, i.nameEs, i.nameEn, i.unit, i.direction, i.nature, i.publicationKey, i.consumable], "v"),
  /** Crea la unidad (ficha) y su primera versión en draft; devuelve el id de versión. */
  async createCardVersion(tx: KlTx, c: CardVersionInput): Promise<string> {
    await tx.query("SELECT kl.create_unit($1, 'card', $2, NULL, $3, $4, $5, $6, 'provisional-1', $7)", [c.unitKey, c.country, c.topicKey, c.categoryKeys ?? [], c.serviceIds ?? [], c.industryKeys ?? [], c.contentRisk]);
    const content = { card_type: c.cardType, title_es: c.titleEs, body_es: c.bodyEs, claims_es: c.claimsEs ?? [], primary_source_publication_key: c.primarySourcePublicationKey ?? null };
    return one<string>(
      tx,
      "SELECT kl.create_version($1, 'kseed', NULL, 'new_period', $2, $3, $4, now(), $5, $6, $7, NULL, $8::jsonb, $9::jsonb) AS v",
      [c.unitKey, c.permittedUse ?? "paraphrase_and_cite", c.limitsEs ?? [], c.limitsEn ?? [], c.validTo ?? null, c.nextReviewAt ?? null, c.specialistRequired ?? false, JSON.stringify(content), c.variantEn ? JSON.stringify(c.variantEn) : null],
      "v",
    );
  },
  submitVersion: (tx: KlTx, versionId: string) => one<number>(tx, "SELECT kl.submit_version($1) AS v", [versionId], "v"),
  approveVersion: (tx: KlTx, versionId: string, reason?: string) => one<string>(tx, "SELECT kl.approve_version($1, $2) AS v", [versionId, reason ?? null], "v"),
  rejectVersion: async (tx: KlTx, versionId: string, reason: string) => void (await tx.query("SELECT kl.reject_version($1, $2)", [versionId, reason])),
  approveVariant: async (tx: KlTx, versionId: string) => void (await tx.query("SELECT kl.approve_variant($1, 'en')", [versionId])),

  grantRole: (tx: KlTx, input: { adminUserId: string; email: string; role: KlRole; editorial?: boolean; domains?: string[] }) =>
    one<string>(tx, "SELECT kl.grant_role($1, $2, $3, $4, $5) AS v", [input.adminUserId, input.email, input.role, input.editorial ?? false, input.domains ?? []], "v"),
  revokeRole: async (tx: KlTx, grantId: string, reason?: string) => void (await tx.query("SELECT kl.revoke_role($1, $2)", [grantId, reason ?? null])),
  enqueueJob: (tx: KlTx, kind: string, payload: Record<string, unknown> = {}) => one<string>(tx, "SELECT kl.enqueue_job($1, $2::jsonb) AS v", [kind, JSON.stringify(payload)], "v"),
  decidePublication: (tx: KlTx, key: string, decision: string, reason?: string) => one<string>(tx, "SELECT kl.decide_publication($1, $2, $3) AS v", [key, decision, reason ?? null], "v"),
  withdrawUnit: (tx: KlTx, unitKey: string, reason: string) => one<number>(tx, "SELECT kl.withdraw_unit($1, $2) AS v", [unitKey, reason], "v"),
  /**
   * Activar la compuerta de afirmaciones exige la referencia de aceptación de CR-KL-001. Sin ella la base rechaza y deja el
   * evento de auditoría; por eso NO se lanza una excepción aquí (revertiría la auditoría): el llamador confirma y responde 422.
   */
  async setR10Claims(tx: KlTx, enabled: boolean, acceptanceRef: string | null): Promise<{ ok: true } | { ok: false; reason: string }> {
    const status = await one<string>(tx, "SELECT kl.set_r10_claims($1, $2) AS v", [enabled, acceptanceRef], "v");
    return status === "ok" ? { ok: true } : { ok: false, reason: status };
  },

  registerFile: (tx: KlTx, f: { sha256: string; type: DetectedType; byteLength: number; storageKey: string; scanResult: "clean" | "not_required_dev" | "pending" }) =>
    one<string>(tx, "SELECT kl.register_file_object($1, $2, $3, $4, $5, 'source_original') AS v", [f.sha256, f.type, f.byteLength, f.storageKey, f.scanResult], "v"),
  rejectUpload: (tx: KlTx, origin: "team" | "kseed" | "collector_agent", sha256: string, reason: string, publicationKey?: string) =>
    one<string>(tx, "SELECT kl.reject_upload($1, $2, $3, $4) AS v", [origin, sha256, reason, publicationKey ?? null], "v"),
  createBatch: (tx: KlTx, b: { origin: "team" | "kseed" | "collector_agent"; publicationKey: string | null; editionLabel: string; sourcePublishedAt: string | null; provenanceUrl: string | null; declaredLicense: string | null; fileObjectId: string }) =>
    one<string>(tx, "SELECT kl.create_ingest_batch($1, $2, $3, $4, $5, $6, $7) AS v", [b.origin, b.publicationKey, b.editionLabel, b.sourcePublishedAt, b.provenanceUrl, b.declaredLicense, b.fileObjectId], "v"),
  addExtractedRows: (tx: KlTx, batchId: string, rows: ExtractedRowInput[]) => one<number>(tx, "SELECT kl.add_extracted_rows($1, $2::jsonb) AS v", [batchId, JSON.stringify(rows)], "v"),
  setQa: (tx: KlTx, batchId: string, checks: QaCheck[], blockingFailures: number) => one<string>(tx, "SELECT kl.set_qa_report($1, $2::jsonb, $3) AS v", [batchId, JSON.stringify(checks), blockingFailures], "v"),
  reviewBatch: (tx: KlTx, batchId: string, approve: boolean, reason?: string) => one<string>(tx, "SELECT kl.review_batch($1, $2, $3) AS v", [batchId, approve, reason ?? null], "v"),
  publishBatch: (tx: KlTx, batchId: string) => one<number>(tx, "SELECT kl.publish_batch($1) AS v", [batchId], "v"),
};
