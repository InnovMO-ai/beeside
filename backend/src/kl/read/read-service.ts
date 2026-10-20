import { Pool } from "pg";
import {
  Availability,
  ContextPackageRequest,
  ContextPackageResponse,
  Coverage,
  CoverageReason,
  DemandSignal,
  KL_CONTRACT,
  KL_LIMITS,
  KlApprovedClaim,
  KlDimensions,
  KlLocale,
  KlUnit,
  KnowledgeQueryRequest,
  KnowledgeQueryResponse,
  OpenEditionRequest,
  OpenEditionResult,
  PackageStatusRequest,
  PackageStatusResponse,
  RelatedResource,
  RelatedResourcesRequest,
  UsageBatch,
} from "../contract/kl-v1";
import { claimDigest, clip, isSingleSentence } from "./text";

/**
 * Lado KL de la consulta `kl.v1` (I3). Solo lee las vistas publicadas con el rol `kl_reader_precision` y llama a las
 * funciones de señales. Reglas:
 *  - nunca lanza hacia el turno: siempre responde con `availability` (KL caído ≠ error del turno);
 *  - presupuesto de 250 ms por llamada de lectura; vencido → `degraded` y respuesta vacía;
 *  - sin cliente HTTP en este módulo (lint de frontera web, prueba `retrieval-boundary`);
 *  - `normalizedQuery` se usa para ordenar y se descarta: nunca se persiste ni se registra.
 */
export interface OpenEditionStore {
  open(editionRef: string, locale: KlLocale): Promise<{ filename: string; sha256: string; byteLength: number; stream: () => NodeJS.ReadableStream } | null>;
}

export interface ReadServiceOptions {
  budgetMs?: number;
  /** Almacenamiento de PDF publicados (R3). Sin él, `openEdition` responde `no_current_edition`. */
  editions?: OpenEditionStore;
  /** Observabilidad: recibe la causa de una respuesta degradada o no disponible (nunca el contenido de la consulta). */
  onError?: (error: unknown) => void;
}

class BudgetExceeded extends Error {}

/** El archivo almacenado de una edición publicada no coincide con su huella: incidente, nunca «no hay edición». */
export class EditionIntegrityError extends Error {
  constructor() {
    super("el archivo almacenado no coincide con su huella");
    this.name = "EditionIntegrityError";
  }
}

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const DEGRADING: ReadonlySet<CoverageReason> = new Set<CoverageReason>(["locale_fallback", "validation_expired", "latest_available_only", "series_break"]);

export function packageKeyFor(scope: ContextPackageRequest["scope"]): string {
  const part = scope.stage === "understanding" ? "core" : (scope.categoryKey ?? "core");
  return `pkg.${scope.destinationCountry.toLowerCase()}.${scope.stage}.${part.toLowerCase()}.${scope.locale}`;
}

export class KlReadService {
  private readonly budgetMs: number;

  constructor(
    private readonly reader: Pool,
    private readonly options: ReadServiceOptions = {},
  ) {
    this.budgetMs = options.budgetMs ?? KL_LIMITS.readBudgetMs;
  }

  // ------------------------------------------------------------------------------------------------ infraestructura
  private async guarded<T>(work: () => Promise<T>, fallback: (availability: Availability) => T): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        work(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new BudgetExceeded()), this.budgetMs);
        }),
      ]);
    } catch (error) {
      this.options.onError?.(error);
      return fallback(error instanceof BudgetExceeded ? "degraded" : "unavailable");
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async rows(text: string, values: unknown[] = []): Promise<Row[]> {
    return (await this.reader.query(text, values)).rows as Row[];
  }

  private async claimsEnabled(): Promise<boolean> {
    const r = await this.rows("SELECT r10_claims_enabled FROM kl.v_flags");
    return r[0]?.r10_claims_enabled === true;
  }

  // ------------------------------------------------------------------------------------------------ 1 · paquete de contexto
  async contextPackage(req: ContextPackageRequest): Promise<ContextPackageResponse> {
    const none = (availability: Availability): ContextPackageResponse => ({ contract: KL_CONTRACT, availability, status: "none" });
    if (!isCountry(req?.scope?.destinationCountry)) return none("ok");
    return this.guarded(async () => {
      const key = packageKeyFor(req.scope);
      const pkgRows = await this.rows("SELECT package_key, version, package_ref, level, manifest, hash, estimated_tokens, created_at FROM kl.v_consumable_package WHERE package_key = $1", [key]);
      const pkg = pkgRows[0];
      if (!pkg) return none("ok");
      if (req.knownPackageRef && req.knownPackageRef === pkg.package_ref) return { contract: KL_CONTRACT, availability: "ok", status: "unchanged", packageRef: pkg.package_ref } as ContextPackageResponse;
      const manifest = pkg.manifest as string[];
      const claimsOn = await this.claimsEnabled();
      const built = await this.unitsFromRefs(manifest, req.scope.locale);
      // Si una pieza del manifiesto ya no es consumible, el paquete no es confiable: Precision consulta directo.
      if (built.units.length !== manifest.length) return none("ok");
      return {
        contract: KL_CONTRACT,
        availability: "ok",
        status: "package",
        package: {
          packageRef: pkg.package_ref,
          hash: pkg.hash,
          level: pkg.level,
          compiledAt: new Date(pkg.created_at).toISOString(),
          estimatedTokens: pkg.estimated_tokens,
          manifest,
          units: built.units,
          approvedClaims: claimsOn ? built.claims : [],
        },
      } as ContextPackageResponse;
    }, none);
  }

  // ------------------------------------------------------------------------------------------------ 1b · validez por turno
  async packageStatus(req: PackageStatusRequest): Promise<PackageStatusResponse> {
    const refs = (req?.packageRefs ?? []).filter((r) => typeof r === "string" && r.length <= 200).slice(0, KL_LIMITS.maxPackageStatusRefs);
    return this.guarded(
      async () => {
        const found = refs.length === 0 ? [] : await this.rows("SELECT package_ref, status FROM kl.v_package_status WHERE package_ref = ANY($1)", [refs]);
        const statuses: Record<string, "valid" | "invalidated"> = {};
        for (const ref of refs) statuses[ref] = "invalidated"; // lo desconocido no es válido
        for (const r of found) statuses[r.package_ref as string] = r.status;
        return { availability: "ok", statuses } as PackageStatusResponse;
      },
      (availability) => ({ availability, statuses: Object.fromEntries(refs.map((r) => [r, "invalidated" as const])) }),
    );
  }

  // ------------------------------------------------------------------------------------------------ 2 · consulta
  async query(req: KnowledgeQueryRequest): Promise<KnowledgeQueryResponse> {
    const empty = (availability: Availability): KnowledgeQueryResponse => ({ contract: KL_CONTRACT, availability, coverage: "not_available", coverageReasons: availability === "ok" ? ["no_unit"] : [], units: [], approvedClaims: [], related: [] });
    const dims = req?.dimensions;
    if (!dims || !isCountry(dims.destinationCountry) || (dims.locale !== "es" && dims.locale !== "en")) return empty("ok");
    return this.guarded(async () => this.runQuery(req, dims), empty);
  }

  private async runQuery(req: KnowledgeQueryRequest, dims: KlDimensions): Promise<KnowledgeQueryResponse> {
    const limit = Math.min(Math.max(Math.trunc(req.limit ?? 5) || 5, 1), KL_LIMITS.maxUnits);
    const indicatorKeys = (req.indicatorKeys ?? []).filter((k) => /^[a-z0-9_]{2,80}$/.test(k)).slice(0, KL_LIMITS.maxIndicatorKeys);
    const queryWords = tokenize((req.normalizedQuery ?? "").slice(0, KL_LIMITS.maxNormalizedQueryChars));

    const [stats, cards, claimsOn] = await Promise.all([this.candidateStats(dims, indicatorKeys, req.aggregate), this.candidateCards(dims, queryWords), this.claimsEnabled()]);
    let ordered: Row[];
    if (req.aggregate) {
      ordered = stats; // ya viene ordenado por el agregado
    } else {
      ordered = [...stats, ...scoreCards(cards, queryWords)];
    }
    // Estadísticas pedidas por clave primero; después las fichas por relevancia.
    const built = this.buildUnits(ordered.slice(0, Math.max(limit * 2, limit)), dims, Boolean(req.aggregate), req.aggregate?.kind === "rank");
    const units = built.units.slice(0, limit);
    const claims = claimsOn ? built.claims.filter((c) => units.some((u) => u.ref === c.unitRef)) : [];

    const fullyCitable = units.some((u) => u.usage === "citable" && !built.degraded.has(u.ref));
    const reasons = new Set<CoverageReason>(built.reasons);
    let coverage: Coverage;
    if (units.length === 0) {
      coverage = "not_available";
      if (reasons.size === 0) reasons.add("no_unit");
    } else if (fullyCitable) {
      coverage = "sufficient";
      reasons.clear();
    } else {
      coverage = "partial";
      if ([...reasons].every((r) => !DEGRADING.has(r))) reasons.add("locale_fallback");
    }
    const response: KnowledgeQueryResponse = {
      contract: KL_CONTRACT,
      availability: "ok",
      coverage,
      coverageReasons: coverage === "sufficient" ? [] : [...reasons],
      units,
      approvedClaims: claims,
      related: [],
    };
    if (coverage !== "sufficient" && dims.topic && dims.informationType) {
      response.demandHint = { topic: dims.topic, informationType: dims.informationType, partialUnitRefs: units.map((u) => u.ref) };
    }
    return response;
  }

  private async candidateStats(dims: KlDimensions, indicatorKeys: string[], aggregate: KnowledgeQueryRequest["aggregate"]): Promise<Row[]> {
    const where = ["country = $1", "is_current_period"];
    const values: unknown[] = [dims.destinationCountry];
    const add = (cond: string, v: unknown) => {
      values.push(v);
      where.push(cond.replace(/\?/g, `$${values.length}`));
    };
    if (aggregate) {
      if (!/^[a-z0-9_]{2,80}$/.test(aggregate.indicatorKey) || aggregate.scope !== "states") return [];
      add("indicator_key = ?", aggregate.indicatorKey);
      where.push("geo_code ~ '^[A-Z]{2}-'");
      where.push("value_status = 'value'");
    } else {
      if (indicatorKeys.length === 0) return []; // sin indicador pedido no se mezclan estadísticas con fichas
      add("indicator_key = ANY(?)", indicatorKeys);
      if (dims.region) {
        values.push(dims.region);
        where.push(`(geo_code = $${values.length} OR region = $${values.length})`);
      }
      if (dims.categoryKey) add("(cardinality(category_keys) = 0 OR ? = ANY(category_keys))", dims.categoryKey);
    }
    let rows = await this.rows(`SELECT * FROM kl.v_consumable_stat WHERE ${where.join(" AND ")} ORDER BY indicator_key, geo_code LIMIT 200`, values);
    if (aggregate) {
      const lowerBetter = rows[0]?.direction === "lower_is_better";
      const ascending = aggregate.kind === "min" ? true : aggregate.kind === "max" ? false : lowerBetter;
      rows = rows.sort((a, b) => (ascending ? 1 : -1) * (Number(a.primary_value_numeric ?? a.value_numeric) - Number(b.primary_value_numeric ?? b.value_numeric)));
      const n = Math.min(Math.max(aggregate.limit ?? 5, 1), KL_LIMITS.maxUnits);
      rows = rows.slice(0, n).map((r, i) => ({ ...r, __ordinal: i + 1, __of: rows.length }));
    }
    return rows;
  }

  private async candidateCards(dims: KlDimensions, queryWords: string[]): Promise<Row[]> {
    const where = ["country = $1"];
    const values: unknown[] = [dims.destinationCountry];
    const add = (cond: string, v: unknown) => {
      values.push(v);
      where.push(cond.replace(/\?/g, `$${values.length}`));
    };
    if (dims.topic) add("(topic_key = ? OR topic_key LIKE ? || '.%')", dims.topic);
    if (dims.categoryKey) add("(cardinality(category_keys) = 0 OR ? = ANY(category_keys))", dims.categoryKey);
    if (dims.serviceId) add("(cardinality(service_ids) = 0 OR ? = ANY(service_ids))", dims.serviceId);
    if (dims.industryKey) add("(cardinality(industry_keys) = 0 OR ? = ANY(industry_keys))", dims.industryKey);
    if (dims.region) add("(region IS NULL OR region = ?)", dims.region);
    if (!dims.topic && queryWords.length === 0 && !dims.categoryKey && !dims.serviceId) return []; // consulta sin criterio: no se vuelca el repositorio
    return this.rows(`SELECT * FROM kl.v_consumable_card WHERE ${where.join(" AND ")} ORDER BY published_at DESC LIMIT 60`, values);
  }

  /** Aplica las reglas de servicio de Contratos kl.v1 §3 (PO-3) y arma los KlUnit. */
  private buildUnits(rows: Row[], dims: KlDimensions, aggregated: boolean, ranked: boolean): { units: KlUnit[]; claims: KlApprovedClaim[]; reasons: Set<CoverageReason>; degraded: Set<string> } {
    const locale = dims.locale;
    const units: KlUnit[] = [];
    const claims: KlApprovedClaim[] = [];
    const reasons = new Set<CoverageReason>();
    const degraded = new Set<string>();
    for (const r of rows) {
      const ref = `${r.unit_key}@${r.version}`;
      const isCard = r.kind === "card";
      const risk = r.content_risk as KlUnit["risk"];
      let usage: KlUnit["usage"] = "citable";
      let localeFallback = false;
      let servedLocale: KlLocale = locale;
      const unitReasons: CoverageReason[] = [];

      if (isCard && locale === "en" && !r.title_en) {
        // Variante en inglés no aprobada: LOW/MEDIUM no normativa se sirve en español como contexto; HIGH o normativa no se entrega.
        if (risk === "high" || r.card_type === "normative") {
          reasons.add("locale_unavailable_high");
          continue;
        }
        localeFallback = true;
        servedLocale = "es";
        usage = "context_only";
        unitReasons.push("locale_fallback");
      }
      const validationExpired = r.validation_state === "expired";
      if (validationExpired) {
        usage = "context_only";
        unitReasons.push("validation_expired");
      }
      if (!isCard && r.latest_available) unitReasons.push("latest_available_only");
      if (!isCard && r.series_break_note && (aggregated || dims.informationType === "comparison")) unitReasons.push("series_break");

      for (const reason of unitReasons) reasons.add(reason);
      if (unitReasons.some((x) => DEGRADING.has(x))) degraded.add(ref);

      const title = isCard ? (servedLocale === "en" ? r.title_en : r.title_es) : `${locale === "en" ? r.indicator_name_en : r.indicator_name_es} · ${r.geo_code} · ${r.period_label}`;
      const limits = (locale === "en" && r.limits_en?.length ? r.limits_en : r.limits_es) as string[];
      const unit: KlUnit = {
        ref,
        unitKey: r.unit_key,
        version: r.version,
        kind: r.kind,
        ...(isCard ? { cardType: r.card_type } : {}),
        title: clip(String(title ?? ""), 200),
        locale: servedLocale,
        localeFallback,
        usage,
        content: {},
        dimensions: { country: r.country, ...(r.region ? { region: r.region } : {}), categoryKeys: r.category_keys ?? [], serviceIds: r.service_ids ?? [], ...(r.topic_key ? { topic: r.topic_key } : {}), industryKeys: r.industry_keys ?? [] },
        provenance: {
          publicationKey: r.publication_key ?? "",
          institution: r.institution_name ?? "",
          publicationTitle: r.publication_title ?? "",
          authorityClass: r.authority_class ?? "D",
          ...(r.locator ? { locator: r.locator } : {}),
          ...(r.primary_ref ? { primaryRef: r.primary_ref } : {}),
          citation: [r.institution_name, r.publication_title, r.locator].filter(Boolean).join(", "),
          permittedUse: r.permitted_use,
        },
        validity: {
          ...(isCard ? {} : { period: { label: r.period_label, start: isoDate(r.period_start), end: isoDate(r.period_end), confidence: r.period_confidence } }),
          ...(r.source_published_at ? { sourcePublishedAt: isoDate(r.source_published_at) } : {}),
          validFrom: new Date(r.valid_from).toISOString(),
          ...(r.valid_to ? { validTo: new Date(r.valid_to).toISOString() } : {}),
          ...(r.next_review_at ? { nextReview: new Date(r.next_review_at).toISOString() } : {}),
          latestAvailable: Boolean(r.latest_available),
          ...(r.series_break_note ? { seriesBreak: r.series_break_note } : {}),
        },
        risk,
        confidence: r.confidence,
        limits: limits ?? [],
        specialist: { required: Boolean(r.specialist_required) || risk === "high", ...(r.specialist_category_key ? { categoryKey: r.specialist_category_key } : {}), ...(validationExpired ? { reason: "validation_expired" } : {}) },
        ...(isCard ? {} : { notes: { ...(r.estimated ? { estimated: true } : {}) } }),
        related: { unitRefs: [], productSections: [], equivalenceSupport: [] },
      };

      // Con validación vencida solo viajan título, límites y especialista (nada normativo ni cifras).
      if (!validationExpired) {
        if (isCard) {
          unit.content.text = clip(String(servedLocale === "en" ? r.body_en : r.body_es), KL_LIMITS.maxTextChars);
        } else {
          // Vista de intermediario (A09): Precision recibe la cifra de la primaria; el intermediario aporta solo su posición con nota.
          const viaPrimary = Boolean(r.primary_ref);
          if (viaPrimary && r.primary_value_status === undefined) continue;
          const status = viaPrimary ? r.primary_value_status : r.value_status;
          const number = viaPrimary ? r.primary_value_numeric : r.value_numeric;
          unit.content.value = {
            number: number === null || number === undefined ? null : Number(number),
            display: String((viaPrimary ? (locale === "en" ? r.primary_display_en : r.primary_display_es) : locale === "en" ? r.display_en : r.display_es) ?? ""),
            unit: String((viaPrimary ? r.primary_unit_label : r.unit_label) ?? ""),
            valueStatus: status,
            ...(r.direction ? { direction: r.direction } : {}),
          };
          const position = ranked && r.__ordinal ? { position: r.__ordinal as number, of: r.__of as number } : r.rank_position ? { position: r.rank_position as number, of: r.rank_of as number } : null;
          if (position) unit.content.rank = { ...position, ...(r.tie_group ? { tieGroupSize: r.tie_group as number } : {}), intermediary: viaPrimary || r.rank_position ? String(r.institution_name) : "KL" };
        }
      }
      units.push(unit);

      if (isCard && usage === "citable" && r.authority_class === "A" && (r.confidence === "specialist_validated" || r.confidence === "reviewed")) {
        const source: string[] = (servedLocale === "en" ? r.claims_en : r.claims_es) ?? [];
        source.forEach((text, i) => {
          if (!isSingleSentence(text)) return;
          claims.push({
            claimId: `${r.unit_key}@${r.version}#${i + 1}`,
            unitRef: ref,
            country: r.country,
            locale: servedLocale,
            text,
            normalizedSha256: claimDigest(text),
            authority: "A",
            authorization: { kind: r.confidence === "specialist_validated" ? "specialist_validated" : "reviewed", ...(r.validation_id ? { validationRef: String(r.validation_id) } : {}), ...(r.validation_expires_at ? { validUntil: new Date(r.validation_expires_at).toISOString() } : {}) },
          });
        });
      }
    }
    return { units, claims, reasons, degraded };
  }

  private async unitsFromRefs(refs: string[], locale: KlLocale): Promise<{ units: KlUnit[]; claims: KlApprovedClaim[] }> {
    const keys = refs.map((r) => r.split("@")[0] as string);
    const [stats, cards] = await Promise.all([
      this.rows("SELECT * FROM kl.v_consumable_stat WHERE unit_key = ANY($1)", [keys]),
      this.rows("SELECT * FROM kl.v_consumable_card WHERE unit_key = ANY($1)", [keys]),
    ]);
    const byRef = new Map<string, Row>();
    for (const r of [...stats, ...cards]) byRef.set(`${r.unit_key}@${r.version}`, r);
    const rows = refs.map((ref) => byRef.get(ref)).filter((r): r is Row => Boolean(r));
    const dims: KlDimensions = { destinationCountry: "MX", stage: "understanding", locale };
    const built = this.buildUnits(rows, dims, false, false);
    return { units: built.units, claims: built.claims };
  }

  // ------------------------------------------------------------------------------------------------ 3 · recursos relacionados
  async relatedResources(req: RelatedResourcesRequest): Promise<RelatedResource[]> {
    if (!req || !isCountry(req.destinationCountry)) return [];
    return this.guarded(
      async () => {
        const rows = await this.rows("SELECT product_key, edition_ref, cutoff_date, manifest FROM kl.v_edition_current WHERE country = $1", [req.destinationCountry]);
        return rows.map((r) => {
          const sections = ((r.manifest?.sections ?? []) as Row[])
            .filter((s) => (!req.categoryKey || (s.categoryKeys ?? []).includes(req.categoryKey)) && (!req.topic || s.topic === req.topic || !s.topic))
            .map((s) => ({ sectionKey: String(s.sectionKey), chapter: String(s.chapter), title: String(req.locale === "en" ? s.titleEn : s.titleEs), unitRefs: (s.unitRefs ?? []) as string[] }));
          return {
            productKey: r.product_key,
            productTitle: String(r.manifest?.productTitle?.[req.locale] ?? r.product_key),
            editionRef: r.edition_ref,
            editionStatus: "current" as const,
            cutoffDate: isoDate(r.cutoff_date),
            locales: ["es", "en"] as ["es", "en"],
            sections,
          };
        });
      },
      () => [],
    );
  }

  // ------------------------------------------------------------------------------------------------ 4 y 5 · demanda y uso
  /** Solo con `availability: "ok"`: una caída o una consulta degradada no crea demanda falsa. */
  async emitDemand(signal: DemandSignal, availability: Availability): Promise<"recorded" | "skipped" | "invalid" | "error"> {
    if (availability !== "ok") return "skipped";
    const clean = pickSignal(signal);
    if (!clean) return "invalid";
    // Lo que no está en la lista blanca se descarta aquí (no cruza la frontera) y solo se cuenta el descarte.
    const discarded = Object.keys(signal).filter((k) => !(SIGNAL_FIELDS as readonly string[]).includes(k)).length;
    try {
      const r = await this.rows("SELECT kl.record_signal($1::jsonb, $2) AS s", [JSON.stringify(clean), discarded]);
      return r[0]?.s === "recorded" ? "recorded" : "invalid";
    } catch {
      return "error";
    }
  }

  async reportUsage(batch: UsageBatch): Promise<number> {
    const items = (batch?.items ?? []).slice(0, KL_LIMITS.maxUsageItems).map((i) => ({ ref: i.ref, stage: i.stage, destinationCountry: i.destinationCountry, categoryKey: i.categoryKey, via: i.via, count: i.count }));
    if (items.length === 0) return 0;
    try {
      const r = await this.rows("SELECT kl.record_usage($1::jsonb) AS n", [JSON.stringify(items)]);
      return Number(r[0]?.n ?? 0);
    } catch {
      return 0;
    }
  }

  // ------------------------------------------------------------------------------------------------ 6 · entrega y estado público
  async openEdition(req: OpenEditionRequest): Promise<OpenEditionResult> {
    if (!this.options.editions || !/^[a-z0-9_]{2,60}$/.test(req?.productKey ?? "") || (req.locale !== "es" && req.locale !== "en")) return { status: "no_current_edition" };
    try {
      const rows = await this.rows("SELECT edition_ref FROM kl.v_edition_current WHERE product_key = $1", [req.productKey]);
      const ref = rows[0]?.edition_ref as string | undefined;
      if (!ref) return { status: "no_current_edition" };
      const file = await this.options.editions.open(ref, req.locale);
      if (!file) return { status: "no_current_edition" };
      await this.rows("SELECT kl.record_distribution($1, $2)", [ref, req.locale]).catch(() => undefined);
      return { status: "ok", editionRef: ref, filename: file.filename, contentType: "application/pdf", sha256: file.sha256, byteLength: file.byteLength, stream: file.stream };
    } catch (error) {
      if (error instanceof EditionIntegrityError) throw error; // se propaga: el llamador responde 500 y registra el incidente
      return { status: "no_current_edition" };
    }
  }

  async editionPublicStatus(verificationId: string): Promise<{ status: "current" | "superseded" | "revoked" | "unknown"; [k: string]: unknown }> {
    try {
      const r = await this.rows("SELECT kl.edition_public_status($1) AS s", [String(verificationId ?? "").slice(0, 64)]);
      return r[0]?.s ?? { status: "unknown" };
    } catch {
      return { status: "unknown" };
    }
  }
}

// ---------------------------------------------------------------------------------------------------- utilidades
const isCountry = (v: unknown): v is string => typeof v === "string" && /^[A-Z]{2}$/.test(v);

function isoDate(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v ?? "").slice(0, 10);
}

function tokenize(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3);
}

/** Relevancia por coincidencia de palabras; sin consulta se conserva el orden por recencia. El texto de la consulta se descarta aquí. */
function scoreCards(cards: Row[], words: string[]): Row[] {
  if (words.length === 0) return cards;
  const scored = cards.map((c) => {
    const hay = tokenize(`${c.title_es} ${c.body_es} ${c.title_en ?? ""}`);
    const score = words.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0);
    return { c, score };
  });
  return scored.sort((a, b) => b.score - a.score).filter((s) => s.score > 0 || words.length === 0).map((s) => s.c);
}

const SIGNAL_FIELDS = ["contract", "destinationCountry", "region", "topic", "categoryKey", "serviceId", "informationType", "coverage", "partialUnitRefs", "stage", "locale", "candidate", "projectRef", "occurredAt"] as const;

/** Lista blanca de campos de la señal: nada del cliente cruza (D19). */
function pickSignal(signal: DemandSignal): Record<string, unknown> | null {
  if (!signal || typeof signal !== "object") return null;
  const out: Record<string, unknown> = {};
  for (const key of SIGNAL_FIELDS) {
    const value = (signal as unknown as Record<string, unknown>)[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}
