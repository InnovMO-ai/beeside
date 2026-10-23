# KL 1.0 · Contratos técnicos y límites de integración

Design · versión 3 (congelamiento) · 16-oct-2026 · Complementa a `KL_1.0_Design_Spec.md` (v3). Cambios de v3: compuerta de `approvedClaims` mientras CR-KL-001 no esté aceptado (§3), periodicidad y enlaces administrables (§9), manifiesto de edición del producto editorial (§10). Ningún cambio de forma en `kl.v1`. Código de referencia: `feature/precision-v2-f5` @ `a8f8f3e` (Precision) y `feat/fa4-launch-config` (Control Center, sin diferencias en `frontend/src/admin` ni `backend/src/admin` frente a `a8f8f3e`).

Ningún contrato de este documento cambia decisiones congeladas. Los nombres de campos son los que fija Design (el canon los dejaba abiertos).

---

## 1. Superficies y quién las usa

| Superficie | Consumidor | Transporte MVP1 | Autenticación | Escribe |
|---|---|---|---|---|
| `kl.v1` · lectura (paquete, estado de paquete, consulta, recursos relacionados) | Precision (puerto `knowledge`) | En proceso | Rol de BD `kl_reader_precision` | No |
| `kl.v1` · señales (demanda, uso) | Precision | En proceso, sin bloquear el turno | Rol de BD (función `kl.record_signal`) | Solo `kl.demand_signal`, `kl.usage_daily` |
| `kl.v1` · `openEdition` | Ruta autenticada de Precision | En proceso, flujo de bytes | Acceso del cliente verificado por Precision | `kl.distribution_daily` (+1) |
| Estado público de edición | Página pública de la plataforma de cara al cliente | HTTP `GET` | Ninguna (identificador no predecible + límite de tasa) | No |
| KL Admin API | Control Center | HTTP `/api/admin/kl/*` | Sesión OIDC del Control Center + `kl.role_grant` | Sí, con auditoría |
| Agentes | Worker | Jobs del worker | Cuentas de servicio `kl-agent`, `kl-knowledge` | Según rol |

## 2. `kl.v1` · tipos definitivos

Cambios frente al borrador 1: `approvedSources` pasa a `approvedClaims` (PO-1); reglas de idioma y de validación vencida (PO-3); `availability` se mantiene separado de `coverage`; se agregan límites de tamaño y códigos de motivo.

```ts
export const KL_CONTRACT = "kl.v1" as const;
export type KlLocale = "es" | "en";
export type KlStage = "understanding" | "precision_by_category";
export type UnitRef = string;   // "<unit_key>@<version>"
export type InformationType = "definition" | "procedure" | "general_requirement" | "statistic" | "comparison" | "equivalence";
export type Coverage = "sufficient" | "partial" | "not_available";
export type Availability = "ok" | "degraded" | "unavailable" | "disabled";
export type ContentRisk = "low" | "medium" | "high";
export type Confidence = "specialist_validated" | "reviewed" | "auto_published";
export type AuthorityClass = "A" | "B" | "C" | "D";

/** Motivos de cobertura parcial o ausente. Precision los usa para decidir el límite, nunca los muestra literal. */
export type CoverageReason =
  | "no_unit"                    // KL no tiene conocimiento publicado
  | "latest_available_only"      // pasó la fecha de la siguiente publicación esperada
  | "locale_fallback"            // LOW/MEDIUM servido en español (PO-3)
  | "locale_unavailable_high"    // HIGH sin variante aprobada en el idioma pedido (PO-3)
  | "validation_expired"         // HIGH con validación especializada vencida (PO-3)
  | "no_central_source"          // p. ej. permisos municipales
  | "series_break";              // comparación a través de una ruptura de serie

export interface KlDimensions {
  destinationCountry: string;    // ISO 3166-1 alfa-2
  originCountry?: string;
  region?: string;               // ISO 3166-2
  industryKey?: string;          // clave canónica de sector de Discovery
  stage: KlStage;
  categoryKey?: string;
  serviceId?: string;
  topic?: string;                // clave de kl.topic
  informationType?: InformationType;
  locale: KlLocale;
}

export interface KlApprovedClaim {           // contrato de CR-KL-001
  claimId: string;               // "<unit_key>@<version>#<n>"
  unitRef: UnitRef;
  country: string;
  locale: KlLocale;
  text: string;                  // una frase según splitSentences de Precision
  normalizedSha256: string;      // sha256(normalizeText(text))
  authority: "A";
  authorization: { kind: "specialist_validated" | "reviewed"; validationRef?: string; validUntil?: string };
}

export interface KlUnit {
  ref: UnitRef; unitKey: string; version: number;
  kind: "statistic" | "card"; cardType?: CardType;
  title: string;
  locale: KlLocale;
  localeFallback: boolean;       // true solo en LOW/MEDIUM servidas en español a una petición en inglés
  usage: "citable" | "context_only";   // context_only: fallback de idioma o HIGH con validación vencida
  content: {
    text?: string;
    value?: { number: number | null; display: string; unit: string; valueStatus: "value" | "not_available"; direction?: "higher_is_better" | "lower_is_better" };
    rank?: { position: number; of: number; tieGroupSize?: number; intermediary: string };
  };
  dimensions: { country: string; region?: string; categoryKeys: string[]; serviceIds: string[]; topic?: string; industryKeys: string[] };
  provenance: { publicationKey: string; institution: string; publicationTitle: string; authorityClass: AuthorityClass; locator?: string; primaryRef?: UnitRef; citation: string; permittedUse: "quote" | "paraphrase_and_cite" | "cite_only" };
  validity: { period?: { label: string; start: string; end: string; confidence: "declared" | "inferred" | "estimated" }; sourcePublishedAt?: string; validFrom: string; validTo?: string; nextReview?: string; latestAvailable: boolean; seriesBreak?: string };
  risk: ContentRisk;
  confidence: Confidence;
  limits: string[];
  specialist: { required: boolean; categoryKey?: string; serviceId?: string; reason?: string };
  notes?: { methodology?: string; estimated?: boolean };
  evidence?: { excerpt: string; locator: string; fileSha256: string };
  related: { unitRefs: UnitRef[]; productSections: string[]; equivalenceSupport: string[] };
}
export type CardType = "country_profile" | "context" | "question_guide" | "diagnostic_trigger" | "local_service_condition" | "service_general" | "normative" | "guidance" | "methodology" | "beeside_process";

// 1 · Paquete de contexto
export interface ContextPackageRequest { contract: "kl.v1"; scope: Pick<KlDimensions, "destinationCountry" | "originCountry" | "stage" | "categoryKey" | "locale">; knownPackageRef?: string }
export type ContextPackageResponse =
  | { contract: "kl.v1"; availability: Availability; status: "unchanged"; packageRef: string }
  | { contract: "kl.v1"; availability: Availability; status: "package"; package: { packageRef: string; hash: string; level: "core" | "stage"; compiledAt: string; estimatedTokens: number; manifest: UnitRef[]; units: KlUnit[]; approvedClaims: KlApprovedClaim[] } }
  | { contract: "kl.v1"; availability: Availability; status: "none" };   // aún no compilado: Precision consulta directo

// 1b · Validez por turno
export interface PackageStatusRequest { packageRefs: string[] }                  // máximo 8
export interface PackageStatusResponse { availability: Availability; statuses: Record<string, "valid" | "invalidated"> }

// 2 · Consulta
export interface KnowledgeQueryRequest {
  contract: "kl.v1";
  dimensions: KlDimensions;
  normalizedQuery?: string;      // ≤ 200 caracteres; nunca se persiste ni se registra
  indicatorKeys?: string[];      // máximo 10
  aggregate?: { kind: "rank" | "max" | "min"; indicatorKey: string; scope: "states"; limit?: number };
  includeEvidence?: boolean;
  limit?: number;                // 1–20, por defecto 5
}
export interface KnowledgeQueryResponse {
  contract: "kl.v1"; availability: Availability;
  coverage: Coverage; coverageReasons: CoverageReason[];
  units: KlUnit[]; approvedClaims: KlApprovedClaim[];
  related: RelatedResource[];
  demandHint?: { topic: string; informationType: InformationType; partialUnitRefs: UnitRef[] };
}

// 3 · Recursos relacionados
export interface RelatedResourcesRequest { contract: "kl.v1"; destinationCountry: string; categoryKey?: string; topic?: string; locale: KlLocale }
export interface RelatedResource {
  productKey: string; productTitle: string;
  editionRef: string;            // "<product_key>@<code>"
  editionStatus: "current";
  cutoffDate: string;
  locales: ["es", "en"];         // siempre ambos: sin fallback en productos (PO-3)
  sections: { sectionKey: string; chapter: string; title: string; unitRefs: UnitRef[] }[];
}

// 4 · Demanda y 5 · Uso (fire-and-forget)
export interface DemandSignal { contract: "kl.v1"; destinationCountry: string; region?: string; topic: string; categoryKey?: string; serviceId?: string; informationType: InformationType; coverage: "absent" | "partial"; partialUnitRefs?: UnitRef[]; stage: KlStage; locale: KlLocale; candidate: "knowledge_candidate" | "specialist_service" | "unclear"; projectRef: string; occurredAt: string }
export interface UsageBatch { contract: "kl.v1"; items: { ref: UnitRef; stage: KlStage; destinationCountry: string; categoryKey?: string; via: "ram" | "query"; count: number }[] }   // máximo 200 items

// 6 · Entrega
export interface OpenEditionRequest { productKey: string; locale: KlLocale }   // siempre la edición vigente
export type OpenEditionResult =
  | { status: "ok"; editionRef: string; filename: string; contentType: "application/pdf"; sha256: string; byteLength: number; stream: () => NodeJS.ReadableStream }
  | { status: "no_current_edition" };
```

## 3. Reglas de servicio (PO-3 incluido)

| Caso | `usage` | `approvedClaims` | `coverage` · motivo |
|---|---|---|---|
| Unidad publicada, variante del idioma aprobada, validación vigente si es HIGH | `citable` | Sí (solo enunciados de fuente A) | `sufficient` |
| LOW o MEDIUM, petición en inglés, solo español aprobado, y la unidad no es normativa | `context_only`, `localeFallback: true` | No | `partial` · `locale_fallback` |
| HIGH sin variante aprobada en el idioma pedido | No se entrega | No | `partial` o `not_available` · `locale_unavailable_high` |
| HIGH con validación especializada vencida | `context_only`, sin `content.text` normativo; solo título, límites y especialista | No | `partial` · `validation_expired` |
| Pasada la siguiente publicación esperada | `citable` con `latestAvailable: true` | Sí, si aplica | `partial` · `latest_available_only` |
| Knowledge Products | Nunca hay fallback: una edición solo existe con ES y EN aprobados | — | — |

**Compuerta de CR-KL-001.** Las filas que dicen "Sí" en la columna `approvedClaims` aplican solo con `kl.r10_claims_enabled = true`. Valor por defecto `false`: KL responde `approvedClaims: []` en todos los casos, sin cambiar `usage` ni `coverage`. KL_ADMIN solo puede activarla registrando la referencia de aceptación del responsable de Precision (auditada). Así R10 conserva su comportamiento actual y seguro mientras el CR no se acepte.

Con `context_only` Precision puede usar la unidad para orientar sus preguntas, pero no puede citarla como conocimiento vigente ni autorizado, y R10 no tiene enunciados que aprobar. La conversación sigue con preguntas seguras y señal de especialista.

## 4. Límites de integración

| Límite | Valor | Por qué |
|---|---|---|
| Presupuesto por llamada de lectura | 250 ms; vencido → `availability: "degraded"` y respuesta vacía | KL caído no bloquea Precision |
| Validez de paquete por turno | 1 consulta indexada, ≤ 8 paquetes | Invalidación "en el turno siguiente" |
| Tamaño de respuesta | ≤ 20 unidades; `text` ≤ 1,200 caracteres por unidad; evidencia ≤ 800 | Contexto acotado; el documento original nunca viaja |
| `normalizedQuery` | ≤ 200 caracteres; se descarta tras recuperar | Minimización (D19) |
| Señales | Lista blanca de campos; campos extra se descartan y solo se cuenta el descarte | Nada del cliente entra por error |
| Errores | Nunca excepción hacia el turno; siempre `availability` | Resiliencia |
| Demanda | Solo con `availability: "ok"` | Una caída no crea demanda falsa |
| Versionado del contrato | `contract: "kl.v1"`; campos nuevos solo opcionales; un cambio incompatible es `kl.v2` con convivencia | Exponible por HTTP sin romper Precision |
| Bandera | `PRECISION_KNOWLEDGE_PROVIDER = off` por defecto | Paridad total apagado |

## 5. Estado público de edición (PO-2)

Reutiliza infraestructura existente: el backend Express (`app.use`), el límite de tasa por dirección en PostgreSQL (`security/rate-limit.ts`), las cabeceras de seguridad y la aplicación web de cara al cliente con su `BareShell` de Precision para páginas de sistema.

- **Identificador:** al publicar una edición se genera `verification_id` = 128 bits aleatorios (CSPRNG) en base32 sin relleno (26 caracteres). Uno por edición, no por cliente: no permite rastrear quién recibió qué. Se guarda solo su `sha256` en `kl.edition`; el valor se imprime en el PDF.
- **Ruta web:** `/verificar/<id>` (y `/verify/<id>`) en la aplicación de cara al cliente; sin sesión.
- **API:** `GET /api/public/editions/<id>/status` montada en el backend existente, con `rateLimit(limiter, RATE_LIMITS.editionVerifyAddress)` (propuesto: 60 por 10 minutos por dirección, como `linkTokenAddress`).
- **Respuesta (única forma):** `{ "status": "current" | "superseded" | "revoked" | "unknown", "editionCode"?: string, "publishedOn"?: string, "currentEditionCode"?: string, "revokedOn"?: string }`. `unknown` para identificador inexistente o malformado, con el mismo tiempo de respuesta. Sin contenido, sin enlaces de descarga, sin datos de cliente, sin registro de quién consulta (los registros de acceso del servidor se tratan con la redacción existente).
- **Frontera:** la ruta pertenece a la plataforma de cara al cliente y lee una proyección de estado mediante el módulo KL en proceso, igual que Precision. KL sigue sin interfaz de cliente (D18).

## 6. Descarga autenticada y aviso de revocación (Precision)

- Ruta de Precision `GET /precision/api/projects/:projectId/resources/:productKey?locale=es|en`: verifica sesión y `accessPermits(mode, "read")`, llama a `openEdition`, responde `Content-Disposition: attachment`, `Cache-Control: private, no-store`.
- Precision guarda en la memoria del proyecto `{ productKey, editionRef, locale, deliveredAt }` (dato de Precision, nunca va a KL).
- Al cargar el espacio del cliente, Precision compara su `editionRef` entregado con la edición vigente; si el estado es `revoked` muestra el `Banner` existente con tono `note` (prototipo `PZ-RevocationNotice`). Sustituida no genera aviso intrusivo: solo se muestra la edición nueva.
- Ubicación del acceso a la guía dentro de Precision: la decide el responsable de Precision; el prototipo usa una entrada "Recursos" solo como ejemplo.

## 7. KL Admin API (Control Center)

- Montaje: `app.use("/api/admin/kl", …)` dentro del router de administración existente, con la misma sesión, origen y límite de tasa (`adminSession`).
- Autorización: `can(role, permission)` del Control Center para lectura (SUPERVISOR) más `klCan(grants, klPermission)` sobre `kl.role_grant`; ambas se verifican en servidor en cada petición.
- Separación de funciones: además del control en servidor, triggers en base de datos rechazan aprobar lo propio.
- Interfaz: nueva entrada "Knowledge" en la navegación del Control Center y pestañas (`admin-tabs`) para los 8 espacios, con los componentes y clases existentes (`admin-table`, `admin-card`, `admin-kv`, `admin-badge`, `button`). Las únicas adiciones de estilo son tonos de estado con los valores ya validados en `styles.css`.

## 8. Roles de base de datos

| Rol | Permisos |
|---|---|
| `kl_owner` | Migraciones |
| `kl_app` | Servicio de KL Admin y lógica de dominio (transiciones vía funciones) |
| `kl_reader_precision` | `SELECT` en `kl.v_consumable_*`, `kl.v_package_status`, `kl.v_edition_current`; `EXECUTE` en `kl.record_signal`, `kl.record_usage`, `kl.record_distribution` |
| `kl_agent` | Inserción de cargas, extracciones y versiones de nivel 1 de fuentes aprobadas; sin `UPDATE` de contenido |
| `kl_knowledge` | Lectura de publicado; escritura de paquetes, promociones y grupos de demanda |

## 9. Periodicidad y enlaces administrables (PO-6, PO-7)

```ts
export type KlCadence = "weekly" | "monthly" | "quarterly" | "semiannual" | "annual" | "none";
// kl.product.review_periodicity: KlCadence          (Doing Business México = "semiannual")
// kl.publication.check_frequency: KlCadence | "inherit"  (por defecto "inherit")
```

- No existe valor diario. El planificador del worker solo ejecuta el agente en `next_cycle_at` / `next_check_at` o por acción manual auditada («Revisar ahora», «Edición extraordinaria»).
- KL Admin API: `PATCH /api/admin/kl/products/:key { reviewPeriodicity }` y `PATCH /api/admin/kl/publications/:key { checkFrequency }`, solo KL_ADMIN; cada cambio crea versión de configuración y evento de auditoría. `POST …/check-now` (KL_EDITOR o KL_ADMIN) y `POST …/products/:key/extraordinary-edition` (KL_ADMIN).
- Enlaces: `kl.setting_version.links` = `{ "kl.links.discovery_start": "https://beeside.you", "kl.links.edition_verify": "<ruta de PO-2>" }`. Cambiar un enlace crea versión de configuración; la edición en composición toma el valor vigente y lo congela en su manifiesto; las ediciones publicadas no cambian.

## 10. Manifiesto de edición del producto editorial

Además de lo definido en la Spec §5.7, el manifiesto congelado de cada edición incluye: `theme` (`db.v3b`), `fonts` (familia, pesos y huellas de archivo), `links` resueltos, `fixedBlocks` (`founder_letter@3.0`, `journey@<versión>`, con huella del texto aprobado) y, por bloque, `claimIds[]` y `refs[]`. Un bloque de cifra o norma sin `claimIds` aprobados bloquea `in_approval → rendering`. La composición no usa IA: el HTML de impresión es una función pura del manifiesto.

