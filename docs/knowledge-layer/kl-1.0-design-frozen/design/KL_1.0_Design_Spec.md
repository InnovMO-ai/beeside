# beeside Knowledge Layer 1.0 · Design Specification (macrobloque 2)

Versión 3 · 16-oct-2026 · Product Owner: Mike · Estado: **resoluciones PO-1 a PO-7 incorporadas (PO-4 a PO-7: paquete editorial Doing Business 2026); para aprobación de cierre de Design** (no iniciar Code hasta su aprobación)

Entrada: `handoff/KL_1.0_Design_Handoff_Pack.md`. Canon que prevalece: Master Spec v1.4 (adenda 16-oct), Canonical Architecture Handoff `kl.v1`, Doing Business México Product Specification. Código de referencia: rama `feature/precision-v2-f5`, commit `a8f8f3e` (lectura con `git show`, sin checkout); Control Center en `feat/fa4-launch-config` (sin diferencias en administración frente a `a8f8f3e`).

Documentos de Design (carpeta `design/`):

| Documento | Contenido |
|---|---|
| `KL_1.0_Design_Spec.md` (este) | Hallazgos, decisiones, modelo de datos, estados, RBAC, PDF, R2, R3, seguridad |
| `KL_1.0_Contratos_kl.v1.md` | Tipos definitivos de `kl.v1`, reglas de servicio, límites de integración, estado público, KL Admin API, roles de BD |
| `KL_1.0_Matriz_Implementacion_Pruebas.md` | Piezas → incremento de Code → pruebas → A01–A10 y AC-01–AC-14; condiciones de habilitación |
| `CR-KL-001_R10_Precision.md` | Change request de R10: propuesta técnica aprobada por el PO, pendiente de revisión y aceptación del responsable de Precision |
| `KL_1.0_Code_Handoff_Pack.md` | Paquete de entrega a Code: alcance, orden, banderas, pruebas y condiciones A/B/C |
| `evidencia/ac10/` · `evidencia/r10/` | Pruebas ejecutadas en Design |
| `DB2026/` | Paquete editorial Doing Business México 2026: evaluación, mapeo pilares ↔ capítulos, trazabilidad de fuentes, componentes, prototipo definitivo y comparativo A/B (histórico) |
| `prototipos/` | PDF de prototipo y fuentes de los prototipos HTML (copia del canvas "KL 1.0 · Design") |

Historial: borrador 1 y versión 2 en `historico/`.

Este documento fija lo que el canon dejó para Design: nombres de campos de `kl.v1`, puerto `knowledge`, afirmaciones aprobadas para R10, esquema `kl`, máquinas de estado, RBAC, renderizado del PDF (R1), validación externa (R2), distribución y verificación (R3) y plan de validación. No reabre decisiones congeladas.

---

## 0. Entendimiento

KL es un módulo interno del backend existente (esquema `kl` en el mismo PostgreSQL) que sirve conocimiento gobernado a Precision por un puerto en proceso, se administra desde el Control Center existente y genera el Producto 01 como fichas y PDF ES/EN. Design debe dejar todo esto especificado al nivel en que Code solo implementa, sin decisiones de producto abiertas, y con los riesgos R1–R8 cerrados o con plan.

## 1. Hallazgos de la revisión crítica

Ninguno invalida la arquitectura congelada. Los tres que requerían decisión del PO quedaron resueltos el 16-oct (sección 3).

| # | Hallazgo | Tipo | Resolución |
|---|---|---|---|
| H1 | El canon usa dos escalas de riesgo que no son la misma: niveles 1/2/3 (spec §6.4, gobiernan **cambios**) y LOW/MEDIUM/HIGH (handoff §6H, riesgo del **contenido** de una unidad, devuelto en `kl.v1`). Una ficha de contexto es MEDIUM, pero su nuevo periodo no es "cambio de método". | Dato canónico | Dos campos distintos: `content_risk` de la unidad (low/medium/high) y `review_level` del cambio (1/2/3) = máximo entre el nivel que exige el contenido y el que exige la clase de cambio; un cambio no clasificable sube, nunca baja. Sección 6.1. |
| H2 | R10 en Precision aprueba una frase si **contiene** el texto de una fuente aprobada (`sentenceNorm.includes(src)`, `country-claims.ts`). Con textos cortos desde KL ("IVA 16 %"), cualquier frase más larga que los contenga pasaría, aunque agregue una afirmación falsa. Hoy no ocurre porque `approvedSources` llega vacío. | Seguridad / confiabilidad | Resuelto con PO-1: contrato de afirmaciones versionadas y CR-KL-001 para Precision. |
| H3 | La identidad de administración tiene un rol por persona (`AdminRole = ADMIN \| SUPERVISOR`, `admin/rbac.ts`). KL necesita roles acumulables y por dominio (KL_REVIEWER + permiso editorial; SPECIALIST_VALIDATOR de "fiscal"). | Implementación | Tabla aditiva `kl.role_grant` sobre `admin_users`; no se toca el rol de plataforma. Sección 7. |
| H4 | Separación de funciones (quien sube no aprueba; quien redacta no valida; editor ≠ aprobador editorial) exige al menos **dos personas internas** con roles KL más validadores. Con una sola persona, KL no puede publicar nada que no sea nivel 1 automático. | Dependencia operativa | Aprobado por el PO: titulares como condición de habilitación operativa. La regla se aplica en base de datos, no solo en UI. |
| H5 | AC-10 ("mismo manifiesto, mismo PDF") choca con que todo renderizador basado en Chromium escribe fecha de creación e identificador aleatorio. | Implementación | Probado en Design: idéntico byte a byte tras normalizar solo las dos fechas (§8.3). Sección 8. |
| H6 | `kl.v1` no distingue "KL no tiene el dato" de "KL no respondió". Si ambas devuelven `not_available`, una caída de KL generaría señales de demanda falsas. | Contrato | Campo `availability` separado de `coverage`; con `availability ≠ ok` Precision no emite demanda. |
| H7 | La agrupación "semántica" de demanda no puede usar texto: la consulta normalizada nunca se guarda (handoff §4). | Dato canónico | Taxonomía controlada de temas (`kl.topic`, p. ej. `logistics.rail.port_hinterland`) que Precision usa para emitir; la agrupación es por dimensiones. |
| H8 | El canon no dice qué hace Precision cuando pide inglés y la ficha solo está aprobada en español, ni si sirve una ficha HIGH con validación vencida. | Regla de negocio | Resuelto con PO-3 (Contratos §3). |
| H9 | El handoff a Precision dice "prevalece la especificación maestra (v1.3)"; la vigente es v1.4. | Editorial | Se reporta a la conversación de Workspace; sin efecto en Design. |
| H10 | El PDF lleva "enlace para verificar la edición vigente", pero KL no es de cara al cliente y no hay publicación abierta (D18, D23). Alguien debe alojar esa verificación. | UX visible | Resuelto con PO-2: página pública mínima de estado (Contratos §5). |

## 2. Decisiones técnicas tomadas en Design

| ID | Decisión | Por qué |
|---|---|---|
| DD-01 | Módulo `backend/src/kl/` (hermano de `precision/`, nunca dentro), con submódulos `registry`, `ingest`, `repository`, `retrieval`, `ram`, `demand`, `products`, `admin-api`, `agents`. Precision solo ve `kl/contract` (tipos `kl.v1`) y un servicio de lectura inyectado. | Frontera limpia; separable a HTTP sin tocar Precision (T1). |
| DD-02 | Identidad única de unidad: `kl.unit` (estadístico o ficha) con clave semántica estable y versiones enteras; referencia canónica `<unit_key>@<n>`. Un periodo nuevo es una unidad nueva; una corrección es una versión nueva. | Coincide con "nuevo periodo se agrega, corrección = versión" (§6.2) y da un solo espacio de citas para RAM, productos y Precision. |
| DD-03 | Contenido de versión inmutable por trigger (patrón `00xx_*_integrity.sql` ya usado en el repo); el estado cambia solo por transiciones permitidas, cada una con fila en `kl.audit_event`. | "Nada se sobrescribe" impuesto por la base, no por disciplina. |
| DD-04 | Recuperación por metadatos y SQL (índices compuestos por dimensiones), sin base vectorial (T2). Rankings y máximos en SQL sobre la proyección `kl.stat_value`. | Volumen MVP1 pequeño; exactitud determinista medida en ICE 2025. |
| DD-05 | Puerto `knowledge` en `precision/ports/knowledge.ts`, seleccionado por `PRECISION_KNOWLEDGE_PROVIDER = off \| kl` (por defecto `off`), con `IntegrationDescriptor` igual que los otros puertos. `off` = implementación nula: sin afirmaciones ni señales. | Bandera apagada = Precision idéntico a hoy (no regresión). |
| DD-06 | Validación de vigencia del paquete de RAM **en cada turno** (consulta indexada por `package_ref`, < 1 ms en proceso). | El handoff exige invalidación "en el turno siguiente" y A10 "en el acto". |
| DD-07 | Rol de base de datos `kl_reader_precision`: `SELECT` sobre vistas publicadas e `INSERT` solo en `kl.demand_signal` y `kl.usage_daily` (vía función). Rol `kl_agent` para el worker. | Escritura acotada (handoff §10N). |
| DD-08 | Agentes en el worker existente (`worker.ts`, patrón de jobs con `SKIP LOCKED`); salida a Internet solo desde el worker y solo a dominios del Source Registry. El proceso web no tiene cliente HTTP saliente en el módulo `retrieval`. | Frontera web congelada (handoff §10M). |
| DD-09 | Almacenamiento de archivos (originales, evidencia de validación, PDFs) en un bucket privado de objetos con retención; la base guarda clave, tamaño y SHA-256. Adaptador local para pruebas. | Originales inmutables; PDF congelado. |
| DD-10 | Renderizador del PDF: Chromium vía Playwright (ya en `node_modules`, v1.63) ejecutado en el worker al publicar la edición; `ReportDocument` → HTML de impresión → PDF etiquetado con marcadores. Sección 8. | Única alternativa viable que cumple AC-13 sin escribir un generador de PDF. |
| DD-11 | Producto 01 = builder `knowledge_guide` sobre el `ReportDocument` compartido, con bloques nuevos aditivos. Ningún modelo paralelo. | Resolución del PO sobre R1. |
| DD-12 | Validación externa registrada por un responsable interno con "hoja de validación" generada por KL que lleva la huella exacta de la versión. Sección 9. | Resolución del PO sobre R2; liga la firma a una versión concreta. |
| DD-13 | El PDF nunca sale por URL pública ni firmada: Precision lo sirve por su propia ruta autenticada, comprobando el acceso del cliente en cada petición y pidiendo los bytes a KL en proceso. La única superficie pública es el estado de la edición (PO-2). Sección 10. | Resolución del PO sobre R3 y PO-2; sin enlaces reenviables y con revocación inmediata. |
| DD-14 | Clave opaca de proyecto en la señal de demanda: `HMAC-SHA256(project_id)` con secreto que **solo Precision** posee. | KL no puede revertirla aunque lea toda su base. |
| DD-15 | Taxonomía controlada de temas `kl.topic` (dominio.tema.subtema), sembrada desde la matriz del Producto 01 y las 17 categorías. | Agrupación de demanda sin texto (H7). |
| DD-16 | R10 recibe afirmaciones versionadas (`approvedClaims`) y aprueba por igualdad exacta normalizada (CR-KL-001). | PO-1; evidencia en `evidencia/r10`. |
| DD-17 | `verification_id` aleatorio de 128 bits por edición; solo su huella en la base. | PO-2; no predecible y sin rastreo de clientes. |
| DD-18 | Reglas de consumo por riesgo e idioma con `usage: citable \| context_only` y `coverageReasons`. | PO-3. |

## 3. Resoluciones del PO (16-oct-2026) y cómo se incorporan

| Resolución | Qué cambia en Design | Dónde |
|---|---|---|
| **PO-1 · aprobada con ajuste de seguridad** | Se descarta la longitud mínima y la contención como garantía. Contrato de **afirmaciones completas, identificables y versionadas** (`claimId = unit_key@versión#n`, huella normalizada, idioma, autorización y vigencia); R10 aprueba una frase solo si es igual a una afirmación vigente del idioma y registra qué `claimId` aprobó. Comparación de cuatro alternativas, casos negativos y regresión en el change request; evidencia ejecutada: el comparador actual aprueba 6 de 8 negativos y el propuesto ninguno. Precision no se modifica desde Design. | `CR-KL-001_R10_Precision.md`; Contratos §2 |
| **PO-2 · aprobada** | Página pública mínima de estado (vigente, sustituida, revocada) con identificador aleatorio de 128 bits por edición, respuesta única para inexistentes, límite de tasa existente y sin contenido ni datos de cliente. Aviso de revocación con el `Banner` existente de Precision. Descarga solo autenticada desde Precision; sin enlaces públicos ni segunda plataforma. | Contratos §5–§6; prototipos `PUB-Verify`, `PZ-RevocationNotice` |
| **PO-3 · aprobada con precisiones** | LOW/MEDIUM: respaldo en español identificado (`localeFallback`, `usage: context_only`), solo conocimiento consultivo; nunca para fichas normativas. HIGH: sin respaldo de idioma. HIGH con validación vencida: sin afirmaciones ni texto normativo, `partial · validation_expired`, Precision sigue con preguntas seguras. Knowledge Products: sin respaldo, aprobación conjunta ES/EN. | Contratos §3 |
| **Separación de funciones · aprobada** | Doble intervención impuesta en servidor y en base de datos. Design deja roles y concesiones preparados; los titulares son condición de habilitación operativa, no de Design. KL Admin solo para cuentas de beeside. | §7; Matriz §6 |
| **Dirección visual · aprobada** | KL Admin hereda clases y componentes del Control Center (reglas copiadas literalmente de `styles.css`; solo se añaden tonos de estado con valores ya validados). PDF con identidad beeside sobre el sistema compartido de reportes. | Prototipos; §8 |
| **PDF y AC-10** | Prueba de tres niveles ejecutada: contenido, visual y binario. El requisito byte a byte se cumple normalizando solo las fechas del PDF. No se propone cambiar AC-10. | §8.3; `evidencia/ac10` |
| **PO-4 · dirección visual del PDF: opción B** | El PDF v3 en inglés es la referencia editorial y visual; se adopta el tema B (misma estructura, contenido y componentes que v3; mejor medida de línea, KPI con periodo y fuente juntos, tablas compactas, pilar en el encabezado, folio único). A4 vertical, Lato (OFL) incrustada. El tema A queda en histórico. | §8; `DB2026/`; `prototipos/db2026-gen/theme.css` |
| **PO-5 · terminología canónica** | En los bloques fijos de la experiencia beeside se usan los términos canónicos: Category Requirement Pack (CRP), My Service Map y Discovery. Los cambios quedan registrados en el contenido (`editorialChanges`) frente al texto de v3. | `DB2026/` §2 y §7 |
| **PO-6 · periodicidad seleccionable** | Enumerado único `kl.cadence` (semanal, mensual, trimestral, semestral, anual, no actualizar) para productos y publicaciones; Doing Business = semestral. No hay monitoreo diario: el agente solo corre por ciclo o por petición manual. Sustituye los valores de verificación diaria/semanal de la configuración inicial T17. | §5.9; Contratos §8; Matriz |
| **PO-7 · enlace de inicio** | `kl.links.discovery_start = https://beeside.you` mientras el producto esté en estabilización; se cambia en la configuración (nueva versión de `kl.setting_version`) al pasar a producción, sin tocar contenido ni plantillas. | §5.8; `DB2026/` §1 |

Decisiones abiertas para el PO: ninguna. Ajustes de consolidación del 16-oct integrados: Public Sans provisional (Lato solo tras verificación), PDF carta como artefacto técnico de AC-10, KL Admin en inglés como decisión provisional, CR-KL-001 con compuerta segura y P7 en dependencias (§4.4, §8.3, §14, §15).

## 4. Contratos de integración (resumen)

El detalle completo, con tipos, reglas de servicio y límites, está en `KL_1.0_Contratos_kl.v1.md`. Resumen:

### 4.1 Topología

```
Precision (proceso web)                          KL (mismo backend, módulo kl/)
  conversation/turn-engine ── KnowledgePort ──►  kl/retrieval (KlReadService)  ── SELECT vistas publicadas
  domain/context-reader     (en proceso)         kl/demand, kl/usage           ── INSERT por función
  ruta de recursos (R3) ─── openEdition() ───►   kl/products/delivery          ── objeto congelado
Plataforma de cara al cliente
  /verificar/<id> ── GET /api/public/editions/<id>/status ── proyección de estado (sin contenido)
Worker (proceso aparte)
  kl/agents/collector  ── HTTPS solo a dominios del Source Registry
  kl/agents/knowledge  ── sin red
  kl/products/render   ── Chromium al publicar una edición
Control Center ── /api/admin/kl/* ── kl/admin-api (sesión OIDC + kl.role_grant)
```

### 4.2 Operaciones `kl.v1`

| Operación | Firma | Notas |
|---|---|---|
| Paquete de contexto | `contextPackage(req) → unchanged \| package \| none` | Lleva `manifest`, `hash`, `units`, `approvedClaims` |
| Validez por turno | `packageStatus({packageRefs})` | ≤ 8 paquetes, una consulta indexada |
| Consulta | `query(req) → coverage, coverageReasons, units, approvedClaims, related` | `availability` separado; ≤ 20 unidades |
| Recursos relacionados | `relatedResources(req) → RelatedResource[]` | Solo edición vigente, siempre ES y EN |
| Señal de demanda | `emitDemand(signal)` | Solo con `availability: ok`; `projectRef` HMAC con secreto de Precision |
| Uso | `reportUsage(batch)` | Sin identificador de proyecto |
| Entrega | `openEdition({productKey, locale})` | Siempre la vigente; flujo de bytes |

### 4.3 Puerto `knowledge`

`precision/ports/knowledge.ts`, seleccionado por `PRECISION_KNOWLEDGE_PROVIDER = off | kl` (por defecto `off`), con `IntegrationDescriptor` (`port: "knowledge"`). Con `off`: `availability: "disabled"`, sin afirmaciones ni señales; Precision idéntico a hoy. Punto de inyección: `domain/context-reader.ts` (`approvedClaims` en lugar del `approvedSources: []` actual, según CR-KL-001).

### 4.4 Afirmaciones aprobadas para R10

**Estado de CR-KL-001:** propuesta técnica aprobada por el PO para revisión y aceptación del responsable de Precision. KL no modifica Precision. Mientras no esté aceptada e implementada, KL entrega `approvedClaims: []` (bandera `kl.r10_claims_enabled = false`, solo KL_ADMIN la cambia y solo con la referencia de aceptación registrada), de modo que R10 conserva su comportamiento seguro actual (`approvedSources` vacío: no aprueba afirmaciones legales por país) y ninguna afirmación de KL puede superar R10 por el comparador de contención.

Cuando esté aceptado, KL emite `approvedClaims` solo desde fichas publicadas con fuente de clase A, una frase por afirmación, sin cifras no referenciadas, variante del idioma aprobada y, si son HIGH, validación especializada vigente sobre esa versión exacta. Precision las acepta por igualdad exacta normalizada y registra el `claimId` en el turno, el CRP y el handoff. Ver CR-KL-001.

### 4.5 Catálogo de servicios

Sin cambios frente al borrador 1: claves validadas contra el catálogo provisional al publicar (AC-12), `catalog_version` por unidad, KL nunca crea servicios (D9, D25).

---

## 5. Modelo de datos · esquema `kl`

PostgreSQL existente, esquema propio `kl`, migraciones a mano en `backend/db/migrations` (pareja `00NN_kl_*.sql` + `00NN_kl_*_integrity.sql`, como el resto del repo), Drizzle para tipos. Todas las tablas llevan `created_at`; las de contenido son de solo inserción salvo la columna de estado, que solo cambia por transición permitida (trigger) con su `kl.audit_event`.

### 5.1 Fuentes (Source Registry)

| Tabla | Campos clave | Notas |
|---|---|---|
| `kl.institution` | `id`, `key` (`inegi`), `name`, `country`, `authority_class` A–D, `kind` (public, multilateral, research, chamber, commercial, beeside, partner) | Comerciales: `kind=commercial` → no aprobable sin excepción. |
| `kl.publication` | `id`, `key` (`inegi.enoe`), `institution_id`, `title`, `jurisdiction`, `topics[]`, `official_url`, `edition_pattern`, `license_text`, `permitted_use` (quote / paraphrase_and_cite / cite_only), `default_content_risk`, `expected_periodicity`, `check_frequency` (`kl.cadence` o `inherit`, §5.9), `next_check_at`, `status`, `owner_user_id`, `matrix_code` (S01–S10 / R1–R34) | Estado: sección 6.4. Configuración administrable versionada en `kl.publication_config_version` (ventana, presupuesto, reintentos, indicadores excluidos, umbrales). |
| `kl.source_exception` | `publication_id`, `scope`, `jurisdiction`, `permitted_use`, `expires_at`, `approved_by` | Excepciones comerciales (A04). Solo KL_ADMIN. |
| `kl.indicator` | `key` (un concepto, una clave: `informalidad_laboral`), `name_es/en`, `unit`, `direction`, `nature` (objective / perception / composite), `primary_publication_id`, `consumable` | Percepción y compuestos: `consumable=false` por defecto (D2, T11). |
| `kl.topic` | `key` (`logistics.rail.port_hinterland`), `parent_key`, `label_es/en`, `category_keys[]` | Taxonomía de demanda y fichas (DD-15). |

### 5.2 Ingestión

| Tabla | Campos clave | Notas |
|---|---|---|
| `kl.file_object` | `id`, `sha256` (único), `detected_type` (por firma), `byte_length`, `storage_key`, `scan_result`, `uploaded_by`, `purpose` (source_original / validation_evidence / edition_pdf) | Inmutable. Duplicado exacto = misma huella. |
| `kl.ingest_batch` | `id`, `origin` (team / kseed / collector_agent), `publication_id` (nulo → `awaiting_source`), `edition_label`, `source_published_at`, `provenance_url`, `declared_license`, `file_object_id`, `status`, `uploaded_by`, `agent_run_id` | Estados: sección 6.2. |
| `kl.extracted_row` | `batch_id`, `locator`, `raw_label`, `raw_value_text`, `indicator_key`, `geo_code`, `period_*`, `parsed_value`, `classification` (new_period / correction / complement / method_change / conflict / unclassifiable) | El revisor no edita valores: corrige mapeo o pide reextracción (T16). |
| `kl.qa_report` | `batch_id`, `checks` (jsonb: completitud, rangos, unidades, empates, nulos, valor–posición, cruce primaria con tolerancia de redondeo T13, cruce edición previa), `blocking_failures` | Generado, inmutable. DENUE solo se extrae en agregados; ninguna fila de establecimiento se guarda (T14). |
| `kl.agent_run` | `id`, `agent` (collector / knowledge), `publication_id`, `trigger`, `status`, `started_at`, `finished_at`, `outcome` (no_change / new_publication / to_review / failed), `tokens_in/out`, `cost_usd`, `error_code`, `attempt` | Presupuestos por ejecución y mensuales en `kl.setting_version`; corte por bucle. |

### 5.3 Repositorio de conocimiento

| Tabla | Campos clave | Notas |
|---|---|---|
| `kl.unit` | `id`, `unit_key` (único), `kind` (statistic / card), `country`, `region`, `topic_key`, `category_keys[]`, `service_ids[]`, `industry_keys[]`, `catalog_version`, `content_risk`, `product_flag` | Identidad estable. |
| `kl.unit_version` | `id`, `unit_id`, `version` (1..n), `status`, `requires_review` (marca), `supersedes_version_id`, `change_class`, `review_level` (1–3), `origin` (collector / team / kseed / beeside_correction), `batch_id`, `valid_from`, `valid_to`, `next_review_at`, `permitted_use`, `limits_es/en[]`, `specialist_required`, `specialist_category_key`, `authored_by`, `approved_by`, `content_sha256` | Contenido inmutable; `content_sha256` firma la versión exacta (R2). |
| `kl.stat_value` | `unit_version_id` (PK), `indicator_key`, `geo_code`, `period_label`, `period_start`, `period_end`, `period_confidence`, `value_numeric` (nulo si no disponible), `value_status`, `display_es/en`, `unit_label`, `source_published_at`, `locator`, `publication_id`, `primary_unit_version_id` (vistas de intermediario), `rank_position`, `rank_of`, `tie_group`, `series_break_note`, `estimated` | Proyección consultable por dimensiones (DD-04). |
| `kl.card_content` | `unit_version_id` (PK), `card_type`, `title_es`, `body_es`, `claims_es[]` (afirmaciones citables, una frase cada una), `cites` (UnitRef[] de evidencias), `primary_source_publication_id`, `norm_published_at`, `norm_effective_from`, `last_reviewed_at` | Español maestro (D22). |
| `kl.card_locale_variant` | `unit_version_id`, `locale` (en), `title`, `body`, `claims[]`, `status` (draft / in_translation / approved / requires_translation), `reviewed_by`, `approved_at` | Si cambia la maestra, nace otra versión y la variante vuelve a `requires_translation` (FR-03). |
| `kl.unit_link` | `from_version_id`, `to_unit_id`, `kind` (derived_from_primary / complements / methodology / series_continues / supports_equivalence) | |

Vista `kl.v_consumable` (lo único que lee `kl_reader_precision`): última versión `published` no retirada ni vencida, por unidad, con `permitted_use` y filtros aplicados.

KL no calcula indicadores derivados ni recalcula índices (T18): consulta y builder solo ordenan, filtran o toman máximos sobre valores publicados de un mismo indicador y periodo.

### 5.4 Validación especializada

| Tabla | Campos clave |
|---|---|
| `kl.validator` | `id`, `kind` (internal / external), `admin_user_id` (si interno), `display_name`, `organization`, `domains[]`, `engagement_ref`, `status`, `registered_by` |
| `kl.specialist_validation` | `id`, `unit_version_id`, `content_sha256` validado, `locale`, `domain`, `scope_statement`, `verdict` (approved / approved_with_changes_required / rejected), `validator_id`, `recorded_by`, `evidence_file_id`, `validated_at`, `expires_at` (≤ 12 meses), `status` (valid / expired / superseded / revoked_by_reform) |

### 5.5 RAM (contexto compilado)

| Tabla | Campos clave |
|---|---|
| `kl.context_package` | `id`, `package_key` (`pkg.mx.precision_by_category.logistics.es`), `version`, `level`, `scope` (jsonb), `manifest` (UnitRef[]), `hash`, `estimated_tokens`, `budget_tokens`, `status` (active / invalidated / retired), `compiled_by_run_id`, `invalidated_reason` |
| `kl.package_member` | `package_id`, `unit_version_id` (índice para invalidar por pieza) |
| `kl.promotion_policy` | versión de la política: umbrales de uso por ámbito, ventana, presupuestos por nivel, `auto_promotion_enabled` (ADMIN) |
| `kl.promotion_event` | `unit_id`, `package_key`, `action` (promote / retire), `reason` (usage_threshold / budget / status_change / manual), `usage_window_count` |

Regla de compilación: los valores de periodicidad diaria (FIX, tasa objetivo) nunca entran a un paquete; solo se consultan con su fecha (T15). La promoción automática por uso queda apagada hasta que KL_ADMIN la active (post-MVP1 según el handoff §10O); mientras tanto el agente propone y Seed Management aprueba.

### 5.6 Demanda y uso

| Tabla | Campos clave |
|---|---|
| `kl.demand_signal` | todos los campos de `DemandSignal` (sección 4.2), solo inserción |
| `kl.demand_group` | `id`, `group_key` (país + región + tema + categoría + servicio + tipo), `first_seen`, `last_seen`, `signal_count`, `distinct_projects` (por `projectRef`), `status` |
| `kl.demand_decision` | `group_id`, `decision` (CREATE / ENRICH / PARTIAL / MAP / SPECIALIST_ONLY / DEFER / REJECT), `reason`, `decided_by`, `publication_id`, `unit_ids[]`, `requires_admin` |
| `kl.usage_daily` | `day`, `unit_version_id`, `stage`, `country`, `category_key`, `via`, `count` |

### 5.7 Productos

| Tabla | Campos clave |
|---|---|
| `kl.product` | `key` (`doing_business_mx`), `kind` (guide), `country`, `master_locale` (es), `locales[]`, `review_periodicity` (`kl.cadence`; Doing Business = `semiannual`), `next_cycle_at`, `template_key`, `theme_key` |
| `kl.product_section` | `product_id`, `section_key` (`ch08.essentials`), `chapter` (`08`), `part`, `slot` (essentials / key_data / how_it_works / obligations / decide_with / sources), `order`, `title_es/en`, `content_type` (data / guidance / obligation / generated), `category_keys[]`, `validation_domain` |
| `kl.composition_item` | `section_id`, `unit_id`, `pinned_version_id`, `order`, `status` (draft / in_review / in_specialist_validation / approved_es / in_translation / approved_en / requires_review) |
| `kl.edition` | `product_id`, `code` (`2026.1`), `status`, `manifest` (jsonb congelado: secciones → UnitRef), `manifest_sha256`, `cutoff_date`, `change_report` (jsonb), `approved_by`, `published_at`, `superseded_by`, `revocation_reason`, `verification_id_sha256` |
| `kl.edition_rendering` | `edition_id`, `locale`, `report_document_sha256`, `print_html_sha256`, `file_object_id`, `pdf_sha256`, `renderer` (`chromium@<versión>`), `rendered_at` |
| `kl.change_notice` | `product_id`, `unit_id`, `from_version_id`, `to_version_id`, `kind` (new_period / correction / reform_detected / validation_expiring / withdrawn), `status` (pending / approved_for_next / dismissed), `decided_by` |
| `kl.distribution_daily` | `edition_id`, `locale`, `day`, `downloads` | Anónimo (sin quién). |

### 5.8 Gobierno

| Tabla | Campos clave |
|---|---|
| `kl.role_grant` | `admin_user_id`, `role` (KL_ADMIN / KL_EDITOR / KL_REVIEWER / SPECIALIST_VALIDATOR), `editorial` (bool, solo KL_REVIEWER), `domains[]` (solo validador), `granted_by`, `granted_at`, `revoked_at` |
| `kl.setting_version` | presupuestos, umbrales, tamaños máximos (50 MB inicial), ventanas, rutas y enlaces configurables; versión inmutable con autor |
| `kl.audit_event` | `id`, `at`, `actor` (usuario o cuenta de servicio), `action`, `entity`, `entity_id`, `from_status`, `to_status`, `reason`, `diff_ref` | Solo inserción; ni ADMIN puede borrar. |

### 5.9 Periodicidad (PO-6)

Un solo enumerado, `kl.cadence`: `weekly` · `monthly` · `quarterly` · `semiannual` · `annual` · `none` (no actualizar). No existe valor diario.

| Dónde | Regla |
|---|---|
| `kl.product.review_periodicity` | Fija el **ciclo del producto**. En cada ciclo el agente recolector revisa una sola vez las publicaciones del manifiesto vigente, genera los `change_notice` y el informe de cambios; si hay cambios aprobados, abre una edición en `composing`. Sin cambios aprobados no hay edición nueva (AC-08). `none`: sin ciclo automático. Doing Business México = `semiannual`. |
| `kl.publication.check_frequency` | Por defecto `inherit`: hereda la periodicidad más frecuente de los productos y paquetes de RAM que usan la publicación; si nadie la usa, `none`. KL_ADMIN puede fijar otro valor del enumerado cuando un documento lo requiera (p. ej. una publicación que alimenta un paquete de Precision). |
| Planificador | Job del worker que calcula `next_check_at` / `next_cycle_at` = último ciclo + periodicidad (calendario de la Ciudad de México). Nada consulta fuentes fuera de esas fechas. |
| Acciones manuales | «Revisar ahora» (KL_EDITOR o KL_ADMIN) sobre una publicación o un producto, y «Edición extraordinaria» (KL_ADMIN). Ambas quedan en `kl.audit_event` con motivo. |
| Notas de la edición | La fecha de la próxima revisión programada se genera del ciclo; nunca se escribe a mano en la portada ni en el texto. |

Consecuencia aceptada: una reforma publicada entre ciclos no se detecta sola. La protección sigue siendo la vigencia de la validación especializada (≤ 12 meses), la revocación de ediciones (PO-2) y la revisión manual cuando se conozca un cambio. La configuración inicial T17 de verificación diaria del DOF y semanal del resto queda sustituida por esta regla.

## 6. Máquinas de estado

### 6.1 Versión de unidad

```
draft ──submit──► in_review ──approve(L2)──────────────────► published ──new version──► superseded
  │                  │      └─approve(L3)─► awaiting_validation ─validation ok─► published
  │                  └─reject─► rejected                  └─validation rejected─► draft (nueva versión)
collector L1 + controles ok ─────────────────────────────► published (auto_published, auditoría por muestreo)
published ──valid_to vencido──► expired        published ──retiro/revocación de fuente──► withdrawn
marca requires_review (no es estado): evidencia citada cambió, validación vencida, reforma detectada, fuente discontinuada
```

`review_level` del cambio = máx(nivel por `content_risk`: low→1, medium→2, high→3 ; nivel por `change_class`: new_period/correction→1, complement/method_change/conflict→2, unclassifiable→máx+1 tope 3). Solo `review_level = 1` con origen `collector` y QA sin fallos se autopublica. Un cambio de método (ICE 2026, A05) siempre ≥ 2 y la serie recalculada entra como unidades nuevas ligadas (`series_continues`), sin empalmar.

### 6.2 Carga (`kl.ingest_batch`)

```
received ─validación de archivo falla─► rejected (no se guarda el archivo; solo el motivo y la huella)
received ─sin fuente aprobada─► awaiting_source ─ADMIN aprueba la fuente─► received
received ─extracción─► extracted ─QA─► in_review ─KL_REVIEWER (≠ uploaded_by)─► approved ─► published
in_review ─reject / reextraer─► rejected | received        published ─nueva carga de la misma edición─► superseded
published ─revocación─► withdrawn (sus versiones → withdrawn; paquetes invalidados)
```

### 6.3 Edición de producto

```
composing ─controles automáticos ok─► in_approval ─aprobación editorial (≠ editor de la edición)─► rendering ─PDF ES y EN ok─► published
published ─siguiente edición publicada─► superseded (archivada)
published ─revisor editorial o KL_ADMIN─► unpublished (archivada, deja de distribuirse)
published ─KL_ADMIN─► revoked (aviso por PO-2)
```

Bloqueos de `in_approval → rendering`: toda pieza `approved_en` y `approved_es`; ninguna `requires_review`; validaciones nivel 3 vigentes (AC-03); uso permitido compatible (AC-06); claves de catálogo válidas (AC-12); sin percepción, partners ni valores diarios (AC-05); conteo de piezas y citas igual por idioma (AC-04). Sin `change_notice` aprobados no se abre edición nueva (AC-08). La revisión que produce esos avisos la dispara el ciclo de `review_periodicity` (§5.9) o una acción manual auditada.

### 6.4 Fuente (`kl.publication`)

```
proposed (agente o editor) ─KL_ADMIN─► approved ─► suspended ─► approved
proposed ─KL_ADMIN─► rejected            approved ─KL_ADMIN─► revoked (A10: unidades withdrawn, paquetes invalidados en el acto)
blocked_pending_verification (p. ej. ATDT) ─verificación + KL_ADMIN─► approved     approved ─sin continuidad─► discontinued (solo historia)
```

### 6.5 Grupo de demanda y paquete de RAM

- Demanda: `open → decided(decision) → incorporating → closed`; `DEFER` reabre si llegan señales nuevas tras la fecha indicada; `REJECT` cierra.
- Paquete: `compiling → active → invalidated` (cambio de estado de una pieza del manifiesto) → nueva versión `active`. Mientras no hay versión activa, Precision consulta KL directo.

## 7. RBAC y separación de funciones

| Permiso | KL_ADMIN | KL_REVIEWER | KL_REVIEWER + editorial | KL_EDITOR | SPECIALIST_VALIDATOR | SUPERVISOR |
|---|---|---|---|---|---|---|
| Leer KL Admin | ✓ | ✓ | ✓ | ✓ | solo su cola | ✓ |
| Proponer fuente | ✓ | ✓ | ✓ | ✓ | | |
| Aprobar, suspender, revocar fuente; excepciones | ✓ | | | | | |
| Subir carga / redactar ficha | | | | ✓ | | |
| Aprobar carga o ficha nivel 2 | | ✓ | ✓ | | | |
| Validar nivel 3 (su dominio) / registrar validación externa | | registra externa | registra externa | | valida | |
| Decidir demanda | ✓ (si fuente o costo) | ✓ | ✓ | | | |
| Aprobar cambio de producto y edición; despublicar | | | ✓ | | | |
| Revocar edición | ✓ | | | | | |
| Proponer conocimiento de respaldo para equivalencias de la RAM | | | | ✓ | | |
| Políticas, presupuestos, promoción automática de RAM, roles KL | ✓ | | | | | |

- KL_ADMIN es el rol ADMIN del canon (v1.4 §10) con nombre propio para no confundirlo con el ADMIN de plataforma: es una concesión explícita, no se hereda; la concesión inicial al PO va por migración y queda auditada. SUPERVISOR de plataforma = lectura de KL.
- Triggers de integridad: `approved_by ≠ authored_by` (versión), `approved_by ≠ uploaded_by` (carga), `recorded_by ≠ authored_by` y validador ≠ autor (validación), aprobador editorial ≠ quien compuso la edición. Una persona con varios roles no puede usarlos sobre su propio trabajo.
- Cuentas de servicio: `kl-agent` (solo `review_level = 1` de fuentes aprobadas) y `kl-knowledge` (solo lee publicado y escribe paquetes, promociones y grupos de demanda).
- KL Admin vive en el Control Center (`/admin/kl/...`), con la misma sesión OIDC limitada a dominios de beeside (T5). Ninguna identidad externa entra (R2).

---
- Titulares: no se nombran en Design; asignarlos es condición de habilitación operativa (resolución del PO).

## 8. R1 · PDF sobre el sistema de reportes compartido

### 8.1 Alternativas evaluadas

| Alternativa | AC-10 (determinismo) | AC-13 (etiquetado, navegable) | Dependencias | Veredicto |
|---|---|---|---|---|
| A · Chromium vía Playwright: `ReportDocument` → HTML de impresión → `page.pdf({ tagged: true, outline: true })` | Sí, con normalización de fecha e ID (8.3) | Sí: Chromium genera PDF etiquetado y marcadores desde los encabezados | `playwright-core` 1.63 ya en el lockfile (hoy de desarrollo); binario Chromium en la imagen del worker | **Recomendada** |
| B · Generador PDF propio sin dependencias | Sí | No en tiempo razonable (estructura de etiquetas, fuentes, tablas) | Ninguna | Descartada |
| C · Servicio de conversión aparte (contenedor tipo Gotenberg) | Igual que A | Igual que A | Infraestructura nueva | Reservada si la imagen del worker no admite Chromium |
| D · Impresión desde el navegador del usuario | No | No controlable | Ninguna | Descartada |

El bloqueo documentado en `report-model.ts` es del registro npm en el entorno de desarrollo; la compilación de producción (`npm ci` con el lockfile) no depende de él. Verificación en Code R3: que el pipeline de imagen instale Chromium (paquete del sistema o imagen base de Playwright) solo en el worker. El renderizado ocurre una vez por edición y por idioma, al publicar; ninguna petición del cliente renderiza.

### 8.2 Extensiones aditivas al modelo compartido

Ninguna cambia los bloques existentes; Discovery sigue igual.

```ts
// reports/report-model.ts — adiciones
kind: ... | "knowledge_guide";

export interface ReportSection {
  id: string;
  blocks: ReportBlock[];
  pageBreakBefore?: boolean;
  /** NUEVO, opcional: encabezado y nivel para el índice navegable y los marcadores del PDF. */
  heading?: { text: string; level: 1 | 2 | 3; number?: string };
}

/** Marca visible de tipo de contenido (Product Spec §6): el lector ve dato, orientación u obligación. */
export type ContentTypeMark = "data" | "guidance" | "obligation";

export interface ReportGuideCoverBlock {          // sin empresa: la guía no es de un cliente
  type: "guide_cover"; eyebrow: string; title: string; subtitle: string;
  editionLabel: string; publishedOn: string; currentAsOf: string; locale: string;
}
export interface ReportTocBlock { type: "toc"; title: string }   // el renderizador lo llena desde `heading`
export interface ReportDataTableBlock {
  type: "data_table"; mark: "data"; title: string; caption?: string;
  columns: { key: string; label: string; align?: "start" | "end" }[];
  rows: {
    cells: Record<string, string>;                // valores ya formateados por idioma
    citation: { unitRef: string; source: string; period: string; sourcePublishedOn: string; noteNumbers?: number[] };
  }[];
  notAvailableLabel: string;                       // "No disponible" — nunca cero
}
export interface ReportGuidanceBlock {
  type: "guidance"; mark: "guidance"; title?: string; paragraphs: string[];
  lastReviewedOn: string; unitRefs: string[];
}
export interface ReportObligationBlock {
  type: "obligation"; mark: "obligation"; title: string; paragraphs: string[];
  primarySource: { citation: string; publishedOn: string; effectiveFrom: string };
  lastValidatedOn: string; unitRefs: string[];   // el validador nunca aparece (Product Spec §7)
}
export interface ReportDecideWithBlock {
  type: "decide_with"; title: string; limits: string[];
  categories: { key: string; label: string }[];  // claves válidas del catálogo, sin partners (AC-12)
}
export interface ReportPartialCoverageBlock { type: "partial_coverage"; title: string; text: string }  // R7: límite que no parece error
export interface ReportNotesBlock { type: "notes"; title: string; notes: { number: number; text: string }[] }
export interface ReportSourcesBlock {               // capítulo 12, generado del manifiesto
  type: "sources"; title: string;
  sources: { citation: string; publication: string; periods: string[]; consultedOn: string; attribution?: string; permittedUse: string }[];
  method: string[]; changesFromPrevious: string[];
}
export interface ReportEditionStampBlock {
  type: "edition_stamp"; editionCode: string; manifestSha256: string; verifyLabel: string; verifyUrl: string;
}
export interface ReportPageChrome {                // pie de página repetido
  footerLeft: string; notAdviceLabel: string; verifyUrl: string;
}
// ReportDocument gana `chrome?: ReportPageChrome` (opcional).
```

Builder: `reports/knowledge-guide-report.ts` → función pura `buildKnowledgeGuideReport(manifest, units, copy, locale, generatedAt)`. No lee base de datos ni reloj; recibe las versiones fijadas por el manifiesto. Las cifras salen de `stat_value.display_<locale>`; el builder nunca formatea ni calcula números nuevos (AC-01).

### 8.3 Determinismo (AC-10) · evidencia

Se distinguen tres niveles y se probaron los tres sobre un prototipo del pipeline (`design/evidencia/ac10`, reproducible con `run-ac10.sh`):

| Nivel | Qué se compara | Resultado |
|---|---|---|
| Reproducibilidad del contenido | Huella del `ReportDocument`, huella del HTML de impresión, texto extraído del PDF | Idénticos |
| Equivalencia visual | Las 7 páginas rasterizadas | Idénticas |
| Determinismo binario | Bytes del PDF | Sin normalizar difieren solo `/CreationDate` y `/ModDate` (Chromium no escribe `/ID`). Normalizando esas dos fechas a la de la edición, idénticos byte a byte |
| Control negativo | Cambiar una posición de 2 a 3 | La huella y el texto cambian |

Entorno de la prueba: Chromium 141 (Playwright 1.56 del entorno de Design; el repo trae 1.63), carta (prueba inicial; repetida en A4 con el tema definitivo y paginación dinámica en `DB2026/`), `tagged: true`, `outline: true`, fuentes Open Sans y Public Sans tomadas del propio repo, red bloqueada durante el render.

Estrategia: el PDF se renderiza una vez al publicar y se guarda congelado con su huella; CI vuelve a renderizar el mismo manifiesto con la misma versión de Chromium y exige igualdad binaria normalizada. Un cambio de versión de Chromium no altera ediciones publicadas (están congeladas); solo exige regenerar la línea de referencia de CI. No hace falta proponer cambiar AC-10.

Tipografía del PDF: **Public Sans se mantiene como tipografía provisional** del sistema de reportes; no se incorpora Work Sans. El tema de Doing Business (PO-4) está diseñado sobre Lato, la familia de la referencia v3, y Lato solo se incorpora tras su verificación: disponibilidad (`@fontsource/lato@5.1.0`, npm), licencia (SIL OFL 1.1, archivo incluido) y compatibilidad (Chromium 141: incrustación, PDF etiquetado, determinismo y paginación sin hallazgos) quedaron verificadas en Design; Code repite la verificación en la imagen del worker antes de activarla (condición B). Si no se cumple, el mismo tema compone con Public Sans sin cambiar estructura (probado en `DB2026/`). Paginación dinámica en el navegador antes de imprimir: los bloques que no caben pasan de página, las tablas se parten por filas con encabezado repetido y un bloque indivisible que no cabe en una página vacía detiene la publicación; un lint rechaza recortes y desbordes (`DB2026/` §4).

### 8.4 Accesibilidad (AC-13)

Etiquetado de Chromium + HTML semántico (`h1–h3`, `table` con `th scope`, `lang` por documento, texto alternativo de la marca), índice navegable desde `heading`, contraste ≥ 4.5:1, texto corrido ≥ 10 pt (tablas ≥ 9 pt; notas y pies ≥ 7.4 pt, como en v3). Validación automática con un verificador PDF/UA en CI (herramienta a elegir en Code; si no hay ninguna instalable, revisión manual documentada con lector de pantalla).

## 9. R2 · Validación especializada externa

Resolución del PO: KL Admin solo para cuentas de beeside; un responsable interno registra la validación con evidencia verificable.

1. **Registro del validador** (`kl.validator`): KL_ADMIN da de alta al especialista externo con nombre, organización, dominios y referencia del encargo. Datos mínimos; nunca aparece en el PDF.
2. **Hoja de validación**: desde la ficha en `awaiting_validation`, el KL_REVIEWER genera un PDF con clave, versión, código de verificación (12 primeros caracteres de `content_sha256`), texto ES (o EN para la revisión bilingüe), enunciados citables, fuentes primarias y la declaración de alcance.
3. **Respuesta del especialista**: devuelve la hoja firmada (firma electrónica o autógrafa escaneada) o un correo desde su dominio profesional que cite el código; el correo se exporta a PDF.
4. **Registro** (`kl.specialist_validation`): un KL_REVIEWER distinto del autor sube la evidencia (mismo filtro de archivos de la sección 6.2), elige validador, dominio, alcance y veredicto, y **teclea el código de verificación que aparece en la evidencia**; si no coincide con la versión, el sistema rechaza. Así una firma nunca se aplica a otra versión.
5. **Vigencia**: `expires_at` = mínimo entre 12 meses y la detección de una reforma en el DOF del dominio (R8). Al vencer: marca `requires_review`, fuera de la siguiente edición (Product Spec §7), regla de consumo según PO-3. Overview y Knowledge Products muestran vencimientos a 60 y 30 días.
6. **Validador interno** con rol SPECIALIST_VALIDATOR: valida en la aplicación sobre la misma versión; el registro es el mismo sin archivo de evidencia.
7. **Auditoría**: quién registró, cuándo, qué versión, qué evidencia (huella). La evidencia es inmutable.

Por qué no cuentas de beeside asignadas a externos: crea identidades que el equipo no controla dentro del Control Center y mezcla gobierno de acceso con validación; la evidencia firmada cubre el caso con menos superficie.

## 10. R3 · Distribución, verificación y revocación del PDF

- **Generación:** al aprobar la edición, el worker renderiza ES y EN (§8), normaliza, calcula `pdf_sha256` y guarda.
- **Almacenamiento:** bucket privado (GCS, como el resto de la plataforma en GCP) sin acceso público, con retención por objeto; clave `kl/editions/<product>/<code>/<locale>/<pdf_sha256>.pdf`. La base guarda huella, tamaño y versión del renderizador.
- **Acceso:** sin URL pública ni firmada. Precision sirve el archivo por su ruta autenticada, verificando sesión y acceso al proyecto en cada petición, y pide los bytes a KL en proceso (`openEdition`). El enlace apunta al producto, no a la edición: siempre entrega la vigente.
- **Caducidad:** la autoridad es la sesión del cliente, que caduca con las reglas de Precision; no existen enlaces reenviables.
- **Verificación pública (PO-2):** cada edición tiene un `verification_id` aleatorio de 128 bits impreso en el PDF; la página `/verificar/<id>` de la plataforma de cara al cliente muestra solo vigente, sustituida, revocada o no reconocido (Contratos §5). Reutiliza backend, límite de tasa y página de sistema existentes.
- **Revocación:** KL_ADMIN revoca → la edición queda `revoked`, la siguiente descarga ya no la entrega, la página pública lo muestra, y Precision muestra el aviso dentro del espacio del cliente que la recibió (registro propio de Precision). Despublicar deja de distribuir sin aviso intrusivo.
- **Versionado:** `2026.1`, `2026.2`; la anterior queda archivada; ES y EN siempre juntos.
- **Conteo:** descargas anónimas por edición, idioma y día; KL no sabe quién descarga.

## 11. Seguridad

- **Frontera web**: el modelo de Precision sin herramientas web; `kl/retrieval` sin cliente HTTP (regla de lint que prohíbe importar `http`, `https`, `undici`, `fetch` en ese módulo); salida a Internet solo del worker y solo a dominios aprobados (lista derivada de `kl.publication.official_url`); prueba que falla si una conversación genera tráfico saliente no permitido.
- **Minimización**: validador de DTO con lista blanca de campos y longitudes; `normalizedQuery` nunca llega a logs ni a base (redacción en `security/redact.ts`); prueba que envía un DTO con nombre de empresa y verifica que no aparece en ninguna tabla `kl.*`.
- **Archivos**: tipo por firma; solo PDF, DOCX, XLSX, CSV; 50 MB; rechazo de cifrados, macros (XLSM, DOCM, `vbaProject.bin`) y PDF con `/JavaScript`, `/OpenAction`, `/Launch`, `/EmbeddedFile`, `/RichMedia`, `/XFA`; límite de descompresión de OOXML (tamaño total y número de entradas); antimalware (servicio a elegir en Code; sin él, las cargas quedan en `received` y no avanzan); fórmulas leídas como valores cacheados; CSV UTF-8 con delimitador declarado (A08).
- **Inyección**: todo contenido extraído es dato; la extracción con IA (solo PDF) corre sin herramientas ni red, con esquema de salida fijo y validación del esquema; los textos de fuentes nunca se concatenan a instrucciones del agente.
- **Licencias**: `permitted_use` se aplica al publicar y al componer; `cite_only` no reproduce texto (AC-06).
- **Presupuestos**: por ejecución y mensual; reintentos acotados (3 con espera creciente); corte si una fuente produce más de N cambios por ejecución (bucle o cambio de formato) → `to_review`.
- **Revocación propagada**: una transacción marca versiones `withdrawn`, invalida paquetes por `kl.package_member` y crea `change_notice` en productos.

## 12. Plan de validación

La matriz completa (piezas, incrementos, pruebas, A01–A10, AC-01–AC-14, línea base y condiciones de habilitación) está en `KL_1.0_Matriz_Implementacion_Pruebas.md`. Evidencias ya obtenidas en Design: AC-10 (tres niveles) y R10 (comparador actual frente al propuesto).

## 13. Clasificación

| Elemento | Negocio | Dato canónico | Implementación | UI |
|---|---|---|---|---|
| Ningún dato del cliente a KL; demanda anónima | ✓ | | | |
| `content_risk` vs `review_level` | | ✓ | | |
| `UnitRef = key@n`; periodo nuevo = unidad nueva | | ✓ | | |
| Fechas separadas (periodo, publicación, vigencia, actualización) | | ✓ | | |
| Taxonomía `kl.topic` | | ✓ | | |
| Afirmaciones versionadas para R10 | | ✓ | | |
| Reglas de idioma y validación vencida (PO-3, aprobadas) | ✓ | | | |
| R10 por igualdad exacta (PO-1, CR-KL-001) | | ✓ | ✓ (lo implementa Precision) | |
| Página de estado de edición (PO-2, aprobada) | ✓ | | | ✓ |
| Esquema `kl`, triggers, vistas, roles de BD | | | ✓ | |
| Puerto `knowledge` con bandera | | | ✓ | |
| Chromium vía Playwright; normalización de PDF | | | ✓ | |
| Bloques nuevos del `ReportDocument` | | | ✓ | |
| Hoja de validación con código | | | ✓ | |
| KL Admin dentro del Control Center | | | | ✓ |
| Marcas dato / orientación / obligación en el PDF | ✓ (Product Spec §6) | | | ✓ |

## 14. Prototipos y siguientes pasos

**Prototipos navegables** (canvas "KL 1.0 · Design", página "Prototipos KL Admin"; botón Play):

| Pantalla | Qué demuestra |
|---|---|
| 01 Overview | Estado, pendientes con responsable, publicaciones esperadas reales, validaciones y consumo |
| 02 Source Registry · 02a Aprobar fuente | Matriz S01–S10 real; aprobación de KL_ADMIN con verificaciones obligatorias |
| 03 Agent Operations · 03a Cambio de método | Cola de revisión humana; caso A05 con la comparación real de Nuevo León |
| 04 Repository · 04a Nueva carga · 04b Revisión · 04c Unidad | Validación previa al guardado (A08), informe de QA real de ICE 2025, doble intervención, versiones e invalidación |
| 05 Demand · 05a Decidir | Grupos anónimos; decisiones con motivo; las que implican fuente o costo pasan a KL_ADMIN |
| 06 Seed Management | Paquetes, presupuestos, política de promoción (apagada) |
| 07 Products · 07a Aprobación de edición · 07b Validación externa | 12 capítulos con su nivel; controles bloqueantes con su estado real; registro R2 con código de verificación |
| 08 Governance & Settings | Roles por asignar como condición de habilitación; configuración inicial T17; auditoría |
| Verificación pública · Aviso en Precision | PO-2 en ES/EN y sus cuatro estados; banner de Precision |

Datos: Source Registry de trabajo e ICE 2025 extraído (candidato, no publicado); lo que no existe aún aparece entre [corchetes]. La interfaz de KL Admin está en inglés porque el Control Center lo está (**decisión provisional**, revisable sin cambio de contrato); el contenido, en español.

**Corrección responsive (16-oct-2026, previa al congelamiento).** En Review (04b) y Editorial approval (07a) los valores del panel lateral se partían letra por letra. Causa raíz: la regla copiada del Control Center `.admin-kv div { grid-template-columns: minmax(9rem, 14rem) 1fr }` con `overflow-wrap: anywhere` en el valor, que reduce su ancho mínimo a un carácter en paneles de ~18rem. Corregido en la hoja de KL (PARTE 3) con reflujo por contenedor, anchos mínimos legibles, corte arbitrario solo en identificadores y scroll local en tablas; revisadas las 18 pantallas a 1440/1280/768/390 px: de 24 vistas con hallazgos a 0, sin cambio de contenido, reglas, roles ni contratos. Evidencia y prueba de regresión en `evidencia/responsive/`. La hoja del Control Center fuera de KL no se modifica.

**Puntos de presentación:** el formato carta corresponde únicamente al prototipo anterior, conservado como artefacto técnico de AC-10 (`evidencia/ac10/AC10_artefacto_tecnico_carta.pdf`), que no es referencia editorial aprobada. La referencia editorial de Doing Business México es el PDF v3 en A4 vertical (PO-4). Idioma de KL Admin: inglés, provisional.

**Siguiente paso:** congelamiento de Design y Code Handoff Pack (`KL_1.0_Code_Handoff_Pack.md`). Code puede empezar en aislamiento con datos sintéticos y fuentes desactivadas cuando se cumplan las condiciones del grupo A; las funciones sensibles quedan apagadas hasta cumplir sus condiciones B y C.

## 15. Dependencias y condiciones de habilitación

Ver `KL_1.0_Matriz_Implementacion_Pruebas.md` §6, reclasificada en tres grupos: **A** bloqueantes reales para iniciar Code o ejecutar una migración; **B** dependencias para implementar o habilitar funciones concretas (incluidas P5, P7 especificación de la RAM en Precision, aceptación de CR-KL-001 y verificación de Lato en el worker); **C** condiciones de operación y publicación (titulares, validadores, derechos y licencias, verificación de fuentes). Ninguna bloquea el cierre de Design.
