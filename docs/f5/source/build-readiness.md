# Precision Center V2.0 — Technical Handoff + Build Readiness (paquete consolidado)

**Fecha:** 9 octubre 2026 · **Alcance:** solo PRECISION (FA, OH, Core y Stripe aparecen como contexto, inputs u outputs) · **Fase:** conversión del producto congelado en contrato técnico ejecutable. **No se entra a F5. No se escribió código de producción. No se modificó el Diseño congelado.**
**Documento hermano de:** `claude/precision-identity-continuity-contract-2026-10-07.md`, `claude/precision-operation-hub-integration-contract-2026-10-07.md`, `claude/precision-fa4-to-precision-contract-v0.2-2026-10-06.md`, `claude/precision-f1-additive-migrations-spec-2026-10-07.md`, manifiestos F1 de la ola 1. Los documentos canónicos bloqueados son de escritor único: aquí solo se entregan **deltas propuestos** (Anexo 2), ninguno aplicado.

## 0. Reglas de trabajo aplicadas y fuentes

1. **Buscar antes de proponer.** Cada elemento nuevo está marcado `REUSE` / `EXTEND` / `DERIVE` / `NEW`. Un `NEW` solo aparece tras buscar el equivalente canónico en los documentos del Project **y en el código real**. Los nombres de trabajo de un `NEW` se rotulan *(nombre de trabajo, no canónico)* y los fija el dueño del esquema en F5.
2. **Marcador de fuente ausente.** `SOURCE NOT AVAILABLE — CANNOT CONFIRM` (abreviado **SNA**) cuando una fuente requerida no está disponible. No se inventa sustituto.
3. **Niveles de evidencia usados en este paquete:**
   - **[DOC]** documento del Project (canon congelado o contrato aprobado).
   - **[CÓDIGO]** lectura estática, solo lectura, del repositorio real en el Mac del PO: `~/Developer/beeside`, rama `feat/fa4-launch-config`, HEAD `585d7d2` (árbol limpio salvo `precision-r2-evidence/`). **Limitación:** esa rama contiene FA 4.0 + Core (billing, premium, analytics, outbox), **no** el motor de Precision ni MB4 (esos viven en las ramas rebasadas de R2, que el cierre de R2 declara sin publicar). Lo que digo sobre tablas de Precision proviene de [DOC] y de la evidencia de R2, no de esta rama.
   - **[R2]** evidencia ejecutada de R2 (8 oct) sobre el repositorio real con toolchain nativo.
   - Nada de lo anterior es prueba de comportamiento en producción; ningún nivel de evidencia se promueve aquí.
4. **Fuente no disponible en este espacio de trabajo:** **"Design Proof v3.3"** (el diseño UX/producto congelado). No está en el Project ni en las carpetas conectadas. **SNA.** Consecuencia: todo lo que dependa de su detalle (etiquetas exactas, composición de la vista previa, qué estados ve el cliente) se trabaja con la lista de 17 estados del propio mandato del PO y con el brief V2.0 registrado en memoria, y se marca **"conformidad con Design Proof v3.3: pendiente"** donde corresponde. No adapto el Diseño al código ni el código al Diseño: documento la brecha.
5. **Idioma de las etiquetas:** los nombres canónicos van en inglés tal cual existen; el español describe.

---

## RESUMEN EJECUTIVO

**Veredicto: BLOCKED — TECHNICAL INPUT REQUIRED.**
El producto es construible sobre la arquitectura existente y la mayoría de los contratos ya están cerrados. Lo que impide declarar F5 listo son **cinco entradas concretas**, ninguna de las cuales puedo resolver sin inventar:

| # | Bloqueo | Quién lo resuelve |
|---|---|---|
| B1 | **Design Proof v3.3 no está disponible** (SNA). No puedo certificar que el modelo de estados no cree estados fuera del Diseño ni el contenido de la vista previa. | PO: entregar el archivo o su inventario de estados/pantallas |
| B2 | **Conflicto producto congelado ↔ canon: ¿existe camino a "CRP listo para revisión" con requisitos pendientes?** El canon del 7 oct permite cerrar con `completed_with_pending`; la regla de progreso congelada dice que 100 % = todos los requisitos requeridos aplicables confirmados. | PO (decisión D-1) o Design Proof v3.3 |
| B3 | **Conflicto producto congelado ↔ canon: ¿quién reabre un CRP confirmado?** El brief V2.0 registra "solo el Sherpa reabre"; el canon vigente dice que el Sherpa no tiene canal hacia Precision y que la reapertura es solo del cliente. | PO (decisión D-2) |
| B4 | **Condición técnica de aceptación de Operation Hub** (qué devuelve OH para que Precision pueda marcar *Sent*; idempotencia por clave del lado de OH). Es una compuerta que el PO ya registró como previa a F5 ("formato de entrega a OH"). | Dueño de OH |
| B5 | **CR-04: proyección `client_safe` de `fa4_project.answers`** y obtención del bloque `operations_only`. Compuerta registrada por el PO antes de F5 (activación real). El código confirma el motivo: `answers` y `email` están en la misma fila. | Dueño de FA 4.0 (no se toca FA desde este espacio) |

Con B1–B5 cerrados, el veredicto pasa a **READY FOR F5 BUILD WITH NON-BLOCKING CONTENT DEPENDENCIES**. Lo demás (activos de Cover, etiquetas ES de las 17 categorías, URLs, validación de dominio de manifiestos, copy de espera/error) es contenido o configuración y no bloquea el motor.

**Hallazgos del código que cambian el plan de Stripe (no estaban en los documentos):**
- Ya existe un endpoint **agnóstico de proveedor y firmado** (`POST /api/billing/events`, HMAC `x-beeside-signature` con marca de tiempo, tolerancia 300 s, cuerpo crudo, `idempotency_key` obligatorio) montado solo con `BILLING_EVENTS_ENABLED=true`. El propio código dice "no provider is selected". **No hay ningún adaptador de Stripe.** El adaptador de Stripe es `NEW`, y la lógica de activación (`processSubscriptionEvent`) es `REUSE`.
- `processSubscriptionEvent` ya garantiza una sola activación (bloqueo de fila del proyecto + `subscription_event.idempotency_key` UNIQUE + `subscription_one_open_per_project`) y ya registra el evento de analítica `premium_activated`. **Pero** hoy también (a) exige `project.assessment_state = COMPLETED_LOCKED` de FA 3.0, (b) pone `precision_state = STARTED` y genera el *handoff package* empujado dentro de la misma transacción, y (c) encola el correo `premium_activation_confirmed` dentro de la transacción con `dedupe_key` por `eventId`. Los tres puntos contradicen el contrato aprobado (pull, TX1, welcome tras lectura de contexto) y están listados como deltas de F5.
- `fa4_project` **no tiene** columna de verificación de correo; existe `fa4_continuation_request` ("Continuar con beeside") pero **no** existe ningún registro de checkout previo a la promoción.

---

## A. Product state model

**Convenciones.** *Dueño* = sistema que escribe el estado. *Persistido* = dato guardado; *Derivado* = calculado en lectura, nunca guardado. *Terminal* = no hay transición de salida normal. No se crea ningún estado visible al cliente que no esté en la lista del mandato; las etiquetas visibles son las del brief V2.0 y la Guía de Voz v1 (conformidad con Design Proof v3.3 pendiente, B1).

**Colisión de nombres que hay que respetar (no renombrar):** en el canon, `category_assessment.lifecycle_status = confirmed` significa *"categoría seleccionada, sin trabajo iniciado"* (etiqueta de UI "Not started"). **No** significa "CRP confirmado". Por eso la confirmación del CRP no puede llamarse `confirmed` en ese enum (ver A-10).

| # | Estado / concepto | Nombre canónico | Dueño | Disparador | Transiciones permitidas | Persistido | Derivado | Terminal | Reintento / error |
|---|---|---|---|---|---|---|---|---|---|
| A-1 | Acceso Premium / Precision | Premium: `subscription.status` (`PREMIUM_ACTIVE`/`CANCELLATION_SCHEDULED`/`PREMIUM_INACTIVE`) + `entitlement.premium_access_active`. Precision: `project.precision_state` (`NOT_STARTED`→`STARTED`). Acceso post-Premium: `precision_access_mode` (`FULL`/`READ_ONLY`/`REVOKED`) | **Core** (Premium, entitlement, acceso); Precision lo refleja | Evento verificado de pago (Sección D); fin de Premium; nuevo pago | `PREMIUM_ACTIVE`→`CANCELLATION_SCHEDULED`→`PREMIUM_INACTIVE`; `PREMIUM_INACTIVE`→(nuevo `PREMIUM_ACTIVE` por `premium_reactivated`, misma `project_id`). `precision_state`: una vez `STARTED` no regresa. `FULL`→`READ_ONLY`→`REVOKED`; `READ_ONLY`/`REVOKED`→`FULL` solo con pago confirmado | Sí (todas las columnas existen **[CÓDIGO]**, salvo `precision_access_mode`, `premium_ended_at`, `readonly_until`, `grace_days_applied`, `revoked_at`: **NEW/EXTEND, no construido** **[DOC]**) | "Premium vigente" = `entitlement.premium_access_active` | No (puede reactivarse) | Idempotente por `idempotency_key`; error de regla de negocio → no cambia estado (Sección H) |
| A-2 | Cover, primera entrada | *(sin estado de ciclo de vida)* marca "Cover visto" por `project_id` | Precision | Primera entrada autenticada a Precision del proyecto, con `precision_state = STARTED` | Cover → Precision Center (nunca al revés) | **NEW** *(nombre de trabajo: `precision_cover_seen`)*: `project_id`, `first_seen_at`, `person_id`. No se encontró equivalente canónico en documentos ni en código | "Mostrar Cover" = `no existe marca` | Sí | Escritura idempotente (`INSERT … ON CONFLICT DO NOTHING`). Si falla, se muestra Cover otra vez (falla segura, no bloquea acceso). **Regla literal del PO:** "primera entrada → Cover; después → Center"; la marca se escribe al primer render del Cover (ver D-6 para la alternativa) |
| A-3 | Understanding | `precision_assessment.lifecycle_status`: `not_started` → `in_progress` → `ready_for_confirmation` → `confirmed` | Precision | Primer turno del cliente; sistema marca listo cuando el mapa es confirmable; cliente confirma | `not_started`→`in_progress`; `in_progress`↔`ready_for_confirmation`; `ready_for_confirmation`→`confirmed`; `confirmed`→`in_progress` (solo como mecanismo de nueva versión, Addendum 13 §13.10) | Sí [DOC][R2] | Sin porcentaje (regla V2.0). Pendientes y brechas: calculados | `confirmed` es no terminal solo por versionado | Escritura idempotente; transición ilegal → `BV409` [R2] |
| A-4 | My Service Map — vista viva | *Live PSM* (nombre canónico; cliente: "My Service Map") | Precision | Cualquier cambio de facts/categorías | — (no hay transiciones: es una consulta) | **No** (MB2 §2: nunca una tabla) | Sí: agregación sobre `category_assessment` + `precision_assessment` | — | Siempre reconstruible |
| A-5 | My Service Map — snapshot confirmado | `service_map_snapshot` (inmutable, fechado por `created_at`) | Precision | `precision_assessment_confirm()`; nueva versión por cambio material/Add a Service (`precision_psm_new_version`, M-G) | Cada fila es final; una versión nueva no edita la anterior | Sí [DOC][R2] | "Snapshot vigente" = el más reciente confirmado. Versión visible al cliente: **ninguna** (se conserva internamente; sin números visibles, regla V2.0) | Cada fila sí | Reintento seguro por clave de solicitud (M-G). **Brecha G-3:** ver Sección K |
| A-6 | Trabajo por categoría | `category_assessment.lifecycle_status`: `proposed` → `not_selected` o `confirmed` → `in_progress` → `completed` | Precision | Confirmación del mapa (`proposed`→`confirmed`); cliente empieza a responder; `evaluateReadiness`/cierre | Ver tabla de transiciones MB1 §11. `completed`→`in_progress` solo por solicitud de cambios | Sí [DOC][R2] | Etiquetas de UI: Not started=`confirmed`; In progress=`in_progress`; Completed=`completed` | `not_selected` reversible (Add a Service) | Idempotente; sin pausa guardada (solo `last_client_activity_at`) |
| A-7 | Progreso de categoría | `progress_pct` | Precision | Cada escritura de `fact` | — | **No** (calculado en lectura) | **Sí.** Fórmula congelada (Sección C): confirmados aplicables requeridos ÷ total aplicables requeridos × 100 | — | Recalculable; determinista |
| A-8 | Elementos críticos | *blocking gaps* (`evaluateReadiness().blocking_gaps`) + `critical_decisions[].gates = blocking` sin resolver | Precision | Cambio de facts | Aparece → se resuelve (o reaparece si se contradice) | **No** | **Sí.** Etiqueta existente "Critical information pending" = `in_progress` ∧ `blocking_gaps > 0` (MB1 §17) | — | Eventos `critical_item_created/resolved` se emiten por diferencia dentro de la misma transacción (Sección F) |
| A-9 | CRP en borrador / preparación | Categoría `in_progress` + `readiness` en vivo | Precision | Trabajo de categoría | `in_progress`→(100 %)→"listo para revisión" | No guardado como estado propio | **Derivado:** "CRP listo para revisión" := `progress_pct = 100` ∧ decisiones críticas resueltas ∧ sin contradicción sin reconocer (equivale a `evaluateReadiness().ready`, ver C-4) | — | Si un fact cambia y baja del 100 %, vuelve a borrador (derivado, sin pérdida) |
| A-10 | CRP confirmado / solo lectura | `pack` (CRPack, inmutable) + **confirmación del cliente fechada** | Precision | Cliente pulsa Confirm | Borrador/listo → confirmado. Confirmado → solo lectura; cambio = nueva versión (ver D-2/B3) | `pack` ya existe **[DOC][R2]** (inmutable, guardia). La **confirmación fechada es NEW** *(nombre de trabajo: `crp_confirmation`: `pack_id`, `person_id`, `confirmed_at`, `idempotency_key`; append-only)*: `pack` no puede llevarla porque es inmutable y `category_assessment.lifecycle_status = confirmed` ya significa otra cosa | "CRP confirmado" = existe fila de confirmación para el `pack` vigente | `pack` y su confirmación son finales | Confirmar dos veces el mismo `pack` = no-op (UNIQUE por `pack_id`). **No activa OH** |
| A-11 | Preview before Send | *(sin estado)* | Precision | Cliente abre la vista previa | — | **No.** `DERIVE`: proyección del **mismo constructor** de carga útil del envío (Sección E) | Sí, con `preview_checksum` calculado de fuentes inmutables | — | Se regenera sin efectos; si algo cambió entre vista previa y envío, el envío se rechaza y se re-muestra la vista previa |
| A-12 | Envío a Operation Hub | `oh_delivery.status`: `queued` / `delivered` / `failed` (append-only) | Precision | Cliente pulsa Send | Ver Sección E (`queued`→`delivered`; `queued`→`failed`; reintento) | Sí (**EXTEND** de M-F: ver brecha N-3) | "Not sent" = ninguna fila; "Sent" = fila `delivered` | `delivered` sí | Idempotente por `idempotency_key`; nunca *Sent* sin condición de aceptación (E) |
| A-13 | Activación de Operation Hub | Primer `oh_delivery` `delivered` de un CRP (cualquiera de los cuatro tipos) | Precision registra; **OH/Core** provisionan | Primer envío exitoso | Una sola vez por proyecto | Sí (la fila de `oh_delivery`); el estado del lado de OH es de Core/OH | `first_send_done`, `client_accessible`, `sherpa_assigned` (los recibe de Core; Precision no lee OH) | Sí | Si el primer envío falla no se permite otro CRP distinto hasta que el primero tenga éxito (`ACTIVATION_PENDING_RETRY_FIRST`) |
| A-14 | Add a Service | Conversación (Conversational Workspace) que produce una clasificación y, siempre, una nueva versión del PSM | Precision | Cliente abre "Add a Service" (solo con mapa confirmado) | Clasificación determinista: `out_of_scope` → `strategic_advisory` → `ecosystem_development` → `known_service` → `unmapped_known_category` → `discovery` | `category_assessment` con `category_origin = client_added`; nueva `service_map_snapshot` por `precision_psm_new_version` | Clasificación I1–I6 | No | Serializado por proyecto; clave de solicitud idempotente (M-G) |
| A-15 | Possible New Service | Registro interno: `unmapped_known_category` (hecho `generic_unmapped_needs` en la categoría conocida) o `discovery` (`category_key = new:<slug>` + manifiesto `_generic`) | Precision | Clasificación del paso anterior tras confirmación del cliente | No crea servicio canónico nunca; la IA propone, el cliente confirma | Sí (hechos/categoría) | "Category known" vs "To Review": ver brecha N-7 (el cubo "To Review" no tiene almacenamiento canónico identificado; se deriva de `new:<slug>` sin categoría asignada) | No | Sin efecto sobre el catálogo (solo señal de demanda anónima, sin ruta de escritura hacia Service Explorer) |
| A-16 | Categorías ancladas (pinned) | **SNA** — no existe equivalente canónico en documentos ni en código | Precision | Cliente ancla/desancla | — | **NEW** *(nombre de trabajo)*: por `project_id` + `person_id` + `category_key`. Solo aparece si el cliente ancló algo | — | — | Falla segura: sin ancladas, no se muestra la sección |
| A-17 | Night Shift / idioma / preferencias | Night Shift: arquitectura de tokens ya validada en el Snapshot **[DOC]**; persistencia de preferencia en Precision: **SNA**. Idioma: `fa4_project.locale` (`es`/`en`) **[CÓDIGO]**, `interface_language` en eventos **[CÓDIGO]** | Precision/Core | Cliente cambia tema o idioma | — | Tema: del dispositivo (cliente) por defecto, sin tabla. Idioma: se hereda de `locale` del proyecto. Persistencia por persona **NEW solo si el Diseño lo exige** | — | — | Sin preferencia guardada → valores por defecto; la UI nunca depende de ellas |

**Notas de integridad del modelo de estados**
- El cliente nunca ve: `proposed`, `not_selected`, `new:<slug>`, `_generic`, "reopen", "Unmapped", "Out of Scope", versiones numéricas, ni "Sherpa" antes de que exista uno asignado [DOC].
- "Sent" en pantalla ⇔ fila `delivered`. No hay estado visible "pendiente de OH" salvo el componente de carga/error ya existente (sin nuevas páginas).
- Premium inactivo no borra nada (contrato OH §G): `READ_ONLY` 90 días configurables → `REVOKED`; el contenido persiste.

---

## B. First Assessment → Precision data contract

**Contrato canónico:** `claude/precision-fa4-to-precision-contract-v0.2-2026-10-06.md` — **v0.2 es el único contrato vigente** (aprobado por el PO el 6 oct, parches posteriores del 7 oct). `FirstAssessmentPrecisionContext` v1 (FA 3.0) está SUPERSEDED. Modelo de integración: **pull por `project_id`** (`context_read`), no push. Precision parte del contexto estructurado de FA, **nunca** de Your Expansion View.

**Hallazgo [CÓDIGO]:** el código actual todavía contiene el camino push de FA 3.0 (`buildPrecisionHandoffPackage`, tabla `precision_handoff_package`, evento de outbox `precision.handoff_package_generated`) dentro de `processSubscriptionEvent`. Está declarado SUPERSEDED y su retiro está decidido en F1 / ejecución en F5. No es una brecha de contrato, es trabajo de F5.

**Límite de lo que puedo afirmar a nivel de campo.** El contrato v0.2 define **bloques** y los vincula con identificadores del Information Model de FA (`I-xx`, `R-xx`). Las llaves exactas dentro de `fa4_project.answers` (JSONB) **no están en el Project**. Lo que sí confirmé en [CÓDIGO]: `fa4_project(project_id, email, locale, step_key, answers jsonb, status IN_PROGRESS|DELIVERED|INELIGIBLE|ANONYMIZED)`, `fa4_result` (modelo renderizado), `fa4_continuation_request(project_id, result_id)`. Por eso la columna "campo de origen" usa el **bloque + ítem del contrato**; el nombre de llave en `answers` queda **SNA** y lo cierra CR-04 (B5).

| Concepto Precision | Bloque / ítem FA de origen (v0.2) | Uso en Precision | Tipo | Req./Opc. | Comportamiento si nulo | Transformación | Fuente de verdad | Persistencia / referencia |
|---|---|---|---|---|---|---|---|---|
| **Project identity** | `package` → `context_read.source_project_id` (= `project_id`); `source_result_id` | Ancla de todo; una instancia Precision por `project_id` | UUID | Req. | Sin él no hay lectura: Precision queda en espera, alerta a Operaciones, **no** se envía el welcome | Ninguna (mismo UUID que `fa4_project.project_id` tras la promoción) | Core (`project.project_id`) | Pin de origen (`context_pin`, **NEW** aditivo F1): `source_system`, `source_project_id`, `source_result_id`, `catalog_version`, `contract_version`, `crosswalk_version`, `read_at` |
| **Company context** (identidad) | `respondent` (I-00, I-01) + `company` (I-02, I-03a) | `LOCKED_CONTEXT` para identidad; `PREFILL_CONFIRM` para sector/tamaño/países | texto / enum / rango | Req. (declarado en FA) | `NOT_ASKED` → se pide en Understanding solo para confirmar/profundizar | Ninguna; `respondent.company` es un **nombre sin distinguir** (no se asume razón social); rango de tamaño solo contexto | **Core `company`** vía `CompanyContextPort` (CR-06 ACEPTADO como contrato); FA solo declara | Facts `company_*` en Precision = **recibos no autoritativos**; nunca copia permanente |
| **Respondent / email** | `respondent` | Identidad del actor | — | — | — | **Email: solo referencia, nunca valor** (§9 del contrato; minimización) | Core `person` | No se almacena el valor en Precision |
| **Expansion objective** | `project` (I-03b…I-14, I-26) + `motive` (I-16, literal) | `PREFILL_CONFIRM`; confirma solo según D-058 | estructurado + literal no confiable | Req. | `NOT_ASKED` → COLLECT IN UNDERSTANDING | El literal pasa por el guard de tres capas, con tope de longitud, como dato | FA (declarado) | Fact con `provenance_stage = client_confirmed` tras confirmar |
| **Destination market** | `topics_by_destination` + `project` (destinos con estado de cobertura del país) → `destinations[]` | No se vuelve a preguntar. Define overlays de país del manifiesto y el Cover | lista `{país ISO-3166-1 alfa-2, estado}` | Req. | Sin destino: no hay overlay; Cover = global | Multi-destino: alcance multi-país o *Project split* (v0.2 §12); la propuesta es determinista, la confirma el cliente | FA (declarado) | `pa_destination_countries` (campo material, "cualquier cambio") |
| **Initial scope / focus** | `needs` (R-05, R-06, I-19): `capabilityId` (49 en catálogo `2026-10-04.v4`) | Se resuelve a categoría/Strategic Advisory/Ecosystem Development/Out of Scope con el **crosswalk v3** | `capabilityId` | Req. | `capabilityId` desconocido → clasificación de escenario, **no** error | Crosswalk fijado por `crosswalk_version`. `operations_only` (ruta, cobertura, estado de capacidad) **nunca** entra al contexto de IA ni a respuestas | FA (identidad de capacidad); destino = Precision | `PSM.selected_services` (alimenta `*_services_in_scope`) |
| **Entry approach** | **No confirmado en v0.2** (el bloque `project` lista actividad, presencia, permanencia, qué tiene en destino; no nombra "enfoque de entrada" como ítem). En FA 3.0 existía `entry_approach_structured`; su equivalente en FA 4.0 es **SNA** | Si FA 4.0 no lo captura: **COLLECT IN UNDERSTANDING** (pedirlo no es "volver a preguntar") | — | — | — | — | — | — |
| **Timing** | `project` (fecha externa) + `precision_starting_point` | `PREFILL_CONFIRM`; señal de "decisiones abiertas" | fecha / ventana | Opc. | `NOT_ASKED` | `pa_time_window` es campo material con regla "desplazamiento de un trimestre o más" | FA (declarado) | Fact |
| **Project state** (decidido / abierto) | `project_state` (R-02) + `precision_starting_point` (R-02, R-08) | Decidido = `PREFILL_CONFIRM`; abierto = punto de partida del PSM | listas | Req. | Vacío = nada decidido | Sin transformación | FA (derivado determinista) | Fact |
| **Support preferences / context** | `support_preferences` (I-23), `context` (I-20…I-25), literales | `PREFILL_CONFIRM` / `CONTEXT_ONLY` | literal no confiable | Opc. | Se ignora | Guard + delimitado como datos | FA | `CONTEXT_ONLY` no se reinterpreta |
| **Personal parallel need** | `personal_parallel_need` (I-15) | Solo `exists` (D-061); no se explora | booleano | Opc. | — | — | FA | — |
| **Delivered view reference** | `delivered_view_reference` | Precision no contradice lo que el cliente vio sin explicarlo | referencia estructurada | Req. | — | **Nunca** se parsea el YEV | FA | **Interna de Precision; no viaja a OH** |
| **Restricted counterparties** | Bloque reservado `NOT_CAPTURED_UPSTREAM` | Precision nunca lo consulta | — | — | — | Literales no confiables, no reenviables a terceros | FA (CR-01 del PO, opción A) | **Compuerta antes del primer piloto con datos reales**, no antes de F5 con datos sintéticos |

**Brechas reales del contrato (solo las que lo son):**
- **B5 / CR-04.** La superficie de lectura debe ser una **vista que proyecta columnas** con rol propio (`precision_fa4_reader`), nunca una concesión sobre tablas: [CÓDIGO] confirma que `email` y `answers` conviven en `fa4_project`, y que `fa4_result.model` es el modelo **renderizado**. Prototipo 10/10 en scratch [DOC]; el dueño de FA debe confirmar la proyección `client_safe` y cómo se obtiene `operations_only` sin el modelo renderizado.
- **Entry approach / nombres de llave:** SNA hasta CR-04. Mientras tanto, "COLLECT IN UNDERSTANDING" aplica solo a lo que el contrato dice explícitamente `NOT_CAPTURED`.
- **Verificación de correo (VERIFY-F5 de la continuidad de identidad):** [CÓDIGO] confirma que `fa4_project` **no tiene** columna de verificación. Las sesiones se obtienen por intercambio de un enlace de un solo uso enviado al correo. Para la regla R-P2 ("reutilizar Person solo si el correo está verificado en este flujo") la recomendación es tratar el intercambio del enlace como prueba de posesión de ese correo. Decisión de Core, no bloqueante (N-12).
- **Sin brechas** en: preguntas duplicadas (D-058 ya prohíbe repreguntar lo válido), tratamiento de literales no confiables, minimización de correo, `operations_only`.

---

## C. Category Requirement Manifest contract

**Fuentes [DOC]:** MB2 §5 y §9 (manifiesto), MB3 (contenido y readiness), manifiestos F1 de la ola 1 (DRAFT-SIN-VALIDAR, validados técnicamente, **no** validados por dominio), validador F1 (`precision-f1-validator-tests-source`). **[R2]** el motor puro `evaluateReadiness` y el validador pasan sus baterías. Lo que sigue es una **auditoría de representabilidad**: ¿puede el manifiesto/motor expresar la regla congelada de progreso sin reglas de negocio supuestas?

### C-1. La regla congelada y su representación

| Regla congelada del PO | Cómo se representa hoy | Estado |
|---|---|---|
| **Denominador = REQUERIDOS + APLICABLES** | *Requerido* := `requirement_level ∈ {blocking, required, conditional}`. *Aplicable* := `applicability_rule` nula (siempre) o evaluada a verdadero (AST) sobre los hechos vigentes, **más** overlays de país (`add` / `modify` / `deactivate`). Un campo con regla falsa es `NOT_APPLICABLE` **derivado**, nunca un valor guardado | **OK** |
| Opcionales no cuentan | `supporting` e `informational` quedan fuera del denominador y del numerador (también los derivados `generic_has_unmapped_need`) | **OK** |
| Numerador = confirmados | *Confirmado* := `answer_state ∈ {ANSWERED, EXPLICIT_NO, ZERO}`. `UNKNOWN`, `WITHHELD`, `ASSUMED` y `NOT_ASKED` **no** cuentan (MB3 §7) | **OK** — coincide literalmente con "los requisitos requeridos sin resolver no cuentan" |
| La información heredada puede contar si satisface estructuralmente el requisito | `inheritance.mode`: `PREFILL_CONFIRM` → cuenta solo tras confirmación del cliente (`provenance_stage = client_confirmed`, D-058); `CONTEXT_ONLY` → nunca cuenta; `LOCKED_CONTEXT` → cuenta **si** está materializado como hecho `ANSWERED` con procedencia heredada | **BRECHA N-6**: no existe ruta canónica que *materialice* un `LOCKED_CONTEXT` como hecho; hoy solo existe `PREFILL_CONFIRM` en los manifiestos de la ola 1, así que **no tiene efecto en F5 inicial** |
| La criticidad no pondera la matemática | `progress_pct` no usa pesos. La criticidad solo genera *elementos críticos* (A-8) | **OK** |
| La criticidad viene del manifiesto, no de juicio libre de IA | **DERIVE** (sin campo nuevo): elemento crítico := campo `blocking` sin confirmar **o** `critical_decisions[].gates = blocking` sin resolver. Identidad del elemento = `decision_key` si existe; si no, `field_key`. Verificado contra los 8 manifiestos: cada campo `blocking` tiene una decisión de tipo `path` 1:1 (o n:1) y las decisiones `consistency` aportan los casos de contradicción | **OK** con la equivalencia adoptada (N-5) |
| 100 % = todos los requeridos aplicables confirmados; **no** significa ejecución completa; solo habilita revisión del CRP | Ver C-4 | **OK**, con un caso que no cumple (G-C2) |

**Fórmula (supera a MB2 §5, ver Anexo 2 / N-4):**
`progress_pct = floor( 100 × |{r ∈ Aplicables ∩ Requeridos : confirmado(r)}| ÷ |Aplicables ∩ Requeridos| )`
- `floor` (decisión técnica autónoma): nunca muestra 100 % con un requerido pendiente.
- Denominador 0 → `progress_pct` indefinido y **nunca** "listo". En los 8 manifiestos no ocurre (todos tienen ≥ 1 requerido incondicional), pero el motor debe tratarlo.
- Cambios de aplicabilidad (p. ej. Add a Service agrega `generic_unmapped_needs`) cambian el denominador; el porcentaje puede bajar y el CRP "listo" vuelve a borrador (A-9). Es el comportamiento correcto y sin pérdida de datos.
- **Conteo de grupos repetibles (D-5, convención por defecto adoptada):** un `repeatable_group` es **un** requisito (canon MB3 §6: "un arreglo = un hecho"); está confirmado cuando se cumple `min_items` **y** cada ítem tiene confirmados sus subcampos requeridos aplicables. Los ítems no entran individualmente al denominador (evita que agregar un ítem baje el porcentaje de forma errática). Es derivación del canon, no regla nueva; se consulta al PO solo como confirmación (D-5, no bloqueante).

### C-2. Hallazgos transversales (aplican a varias categorías)

| ID | Hallazgo | Evidencia | Clase | Resolución recomendada |
|---|---|---|---|---|
| **G-C1** | `customs_goods_profile.tariff_code` es `conditional` con `applicability_rule: null`; la regla real ("`classification_status = classified`") solo existe en `notes` y el motor la evalúa "por ítem". Es una **regla de negocio escondida fuera del AST**. El AST no tiene predicado local al ítem (solo cuantificadores de grupo: `group_any_item_equals/in/differs`, `group_item_text_matches_any`) | manifiesto comercio exterior + validador | NON-BLOCKING (afecta la confirmación de grupo, D-5) | **EXTEND** AST con un predicado de ámbito de ítem (p. ej. `item_field_equals`) y moverlo al manifiesto, o declarar el campo `supporting`. Dueño: esquema/motor, F5 |
| **G-C2** | `hr_statutory_benefits_decision` exige `hr_statutory_benefits_confirmation = true`. Un `EXPLICIT_NO` cuenta como **confirmado** para el progreso (100 %), pero la decisión crítica queda sin resolver → "100 % con elemento crítico abierto". Es el único caso donde C-4 no se cumple | manifiesto personas | NON-BLOCKING | Cambiar la regla a `field_answered` o añadir campo `*_ack` condicional (patrón de las demás decisiones de consistencia). Edición de manifiesto con validación de dominio |
| **G-C3** | Decisiones `path` que usan `field_asked` sobre un campo **condicional**: `logistics_hazmat_compliance_decision` (si hazmat = true pide `import_export_license_status`, aplicable solo con flujos internacionales); `logistics_operating_model_decision` (si 3PL pide `customs_broker_status`, que se desactiva justo cuando es 3PL). Si `field_asked` es falso para un campo `NOT_APPLICABLE`, la decisión es **irresoluble**. El validador de satisfacibilidad solo cubre cadenas de igualdad conjuntivas ("sound, not complete"): no lo detecta. Semántica de `field_asked` sobre campos inaplicables: **SNA** (el código del motor no está en la rama revisada) | validador + manifiesto logística | NON-BLOCKING, **prueba obligatoria en F5** (T-C3) | Definir en el motor `field_asked(NOT_APPLICABLE) = vacuously true`, o reescribir las reglas. Añadir prueba de alcanzabilidad por rama a F5 |
| **G-C4** | Heurística de contradicción por palabras clave: la lista de logística es **solo en inglés**; la de comercio exterior es bilingüe. Con productos descritos en español ("batería de litio", "inflamable") la contradicción de materiales peligrosos **no se detecta** | manifiesto logística | CONTENT (validación de dominio) | Lista bilingüe y por `locale`. Mientras tanto la detección es una **ayuda determinista, nunca una garantía**; documentar el límite |
| **G-C5** | Valores de enum que expresan "no aplica" **elegidos por el cliente** (`not_applicable`, `not_applicable_no_sg_citizens_prs`, `not_applicable` en estatus de operador autorizado, IMMEX y bono de fin de año). El v2 de logística retiró ese patrón porque `NOT_APPLICABLE` debe ser derivado | manifiestos comercio exterior, personas | NON-BLOCKING | Decisión de autoría con el validador de dominio: o se mantienen como respuestas válidas (cuentan como confirmadas) o se vuelven reglas de aplicabilidad |
| **G-C6** | `hr_statutory_year_end_bonus_status` es `required` incondicional en el manifiesto base pero su semántica es de México (overlay MX lo etiqueta "aguinaldo"). Para cualquier otro destino sin overlay el cliente responde un concepto que quizá no exista | manifiesto personas | CONTENT | Moverlo a overlays por país con validación de dominio, o dejar `not_applicable` como respuesta válida (G-C5) |
| **G-C7** | `operational_pending_items` (p. ej. "Constitutive documents … on file", "Signed carrier contract(s) on file") viven dentro del contenido del CRP. El mandato dice: **no hay sección "Supporting Documents" en el CRP y los documentos no entran a Precision** | los 5 manifiestos operativos | NON-BLOCKING (ver E-5 / D-7) | Los *requisitos de documentación* se conservan como **contexto operativo del proyecto** (grupo 4 del envío, E-3), no como sección del CRP. Delta propuesto en Anexo 2 |
| **G-C8** | Dependencia entre categorías: comercio exterior declara que el estatus de agente aduanal "se captura una vez, en logística". Si el cliente solo seleccionó comercio exterior, ese dato nadie lo pregunta | `shared_status_note` | NON-BLOCKING | Sin efecto en el progreso (no es requerido en comercio exterior). El Sherpa lo ve vía OH; sin cambio |
| **G-C9** | 12 de las 17 categorías **no tienen manifiesto**; se ejecutan sobre `_generic` (`new:<slug>` con `manifest_category_key = _generic`). `banking_finance_insurance` está además explícitamente `NOT_AUTHORED` | Project + ola 1 | CONTENT (dependencia de contenido) — **no bloquea el motor** | Autoría + validación de dominio por categoría (ola 2). Ver fila "sin manifiesto" |
| **G-C10** | Bloque compartido de campos `pa_*` de nivel PA (alcance de proyecto) pendiente en Project Manifest v2; `total_project_headcount_estimate` falta en el JSON del Project Manifest v2 (K5); duplicados conocidos K3 (estatus de entidad ×3, partes relacionadas ×2) | F1 design decisions | NON-BLOCKING | Cerrar en F5 con el validador (check de unicidad de llave y de significado) |
| **G-C11** | `tax_fiscal_year_end` es de tipo `date` pero la etiqueta dice "(month)" | manifiesto fiscal | NON-BLOCKING | Tipo `month` o `date` con ayuda; autoría |

### C-3. Tabla de brechas por categoría

**Columnas:** categoría / requisito / campo-regla existente / semántica requerida / estado / brecha / resolución recomendada. **Estado:** `OK` = representable y semántica clara · `GAP` · `CONTENT` = requiere validación de dominio, no estructural · `SNA`. *Req. incondicionales* = `blocking` + `required` con regla nula; *Cond.* = `conditional`. El denominador real de cada cliente depende de la aplicabilidad evaluada.

#### 1. `logistics` — 20 campos, 4 decisiones · denominador candidato 15 (6 incondicionales + 9 condicionales)

| Requisito | Campo-regla existente | Semántica requerida | Estado | Brecha | Resolución |
|---|---|---|---|---|---|
| Servicios en alcance | `logistics_services_in_scope` (required, `PREFILL_CONFIRM` desde `PSM.selected_services`) | El cliente confirma qué servicios de la categoría están en este frente | OK | — | — |
| Quién opera el día a día | `logistics_operating_responsibility` (**blocking**, enum) + decisión `logistics_operating_model_decision` | Respuesta de ruta; crítico | GAP | G-C3 (`field_asked(customs_broker_status)` bajo 3PL) | Definir semántica `field_asked` vs inaplicable; prueba T-C3 |
| Tipo de producto principal | `logistics_primary_product_type` (required) | Dato del frente | OK | — | — |
| Flujos (lanes) | `logistics_flows` (required, grupo, `min_items` 1; ítems requeridos: país origen/destino, producto, volumen, frecuencia, modo) + decisión `logistics_flows_defined_decision` | ≥ 1 flujo completo | OK | D-5 (conteo de grupo) | Convención por defecto C-1 |
| Almacenamiento dedicado / detalles | `logistics_warehousing_needed` (required) → `…_details` (cond.) | Condicional por sí/no | OK | — | — |
| Materiales peligrosos | `logistics_hazardous_materials_flag` (**blocking**) + `…_hazmat_ack` (cond. por contradicción) + 2 decisiones | Bandera + contradicción detectable | GAP | G-C3 (`field_asked(license_status)` con flujos nacionales) y G-C4 (palabras solo en inglés) | Mismas resoluciones |
| Cadena de frío | `logistics_cold_chain_required` (cond. por tipo de producto) | — | OK | — | — |
| Licencias, agente aduanal, diferimiento de IVA | `…license_status`, `…customs_broker_status`, `…vat_deferment_scheme_interest` (cond. por `group_any_item_differs` origen≠destino) | Solo con flujos internacionales | OK | — | `vat_deferment` se desactiva en US y MX por overlay |
| Inventario / pedidos mensuales | `…inventory_profile`, `…monthly_order_volume` (cond. por servicios) | — | OK | — | — |
| Necesidades fuera de catálogo | `generic_unmapped_needs` (cond.) | Señal `unmapped_known_category` | OK | — | — |
| Overlays | US: +`fda_prior_notice_required`; DE: +`eori_number_status` (**required**); MX/US: ayuda | — | CONTENT | Marcados `CONTENT_VALIDATION_REQUIRED` | Validación de dominio |

#### 2. `international_trade_customs` — 16 campos, 3 decisiones · denominador candidato 10 (6 + 4)

| Requisito | Campo-regla existente | Estado | Brecha | Resolución |
|---|---|---|---|---|
| Servicios en alcance | `customs_services_in_scope` (required, `PREFILL_CONFIRM`) | OK | — | — |
| Dirección del comercio | `customs_trade_direction` (**blocking**) + `customs_trade_scope_decision` | OK | — | — |
| Mercancías | `customs_goods_profile` (required, grupo, min 1) | GAP | G-C1 (`tariff_code` condicional sin regla en AST) | EXTEND AST o degradar |
| Bandera de controles | `customs_restricted_goods_flag` (**blocking**) + `…_ack` (cond.) + 2 decisiones | GAP | Duplicidad semántica con `requires_permit_or_control` por ítem (bandera global vs bandera por mercancía); además `field_asked(operator_registration_status)` es seguro (campo requerido incondicional) | Autoría: elegir una; sin impacto estructural |
| Registro como operador, interés en trato preferencial | `…operator_registration_status`, `…preferential_origin_interest` (required) | OK | `not_applicable` como valor (G-C5) en estatus de operador autorizado (supporting, no cuenta) | — |
| Países de tratados, alcance de revisión de cumplimiento | cond. por interés / por servicios | OK | — | — |
| Overlays MX (+3: IMMEX, PROSEC, padrón de importadores) y US (+1) | todos `conditional`, `CONTENT_VALIDATION_REQUIRED` | CONTENT | Validación de dominio | — |
| Documentos disponibles | `customs_documents_available` (supporting) | OK | Es **información sobre disponibilidad**, no carga de archivos: coherente con "sin mecanismo de carga" | — |

#### 3. `people_payroll_employment` — 18 campos, 3 decisiones · denominador candidato 15 (7 + 8)

| Requisito | Campo-regla existente | Estado | Brecha | Resolución |
|---|---|---|---|---|
| Servicios en alcance | `hr_services_in_scope` | OK | — | — |
| Modelo de contratación | `hr_employment_model` (**blocking**) + `hr_entity_or_eor_decision` (`field_asked(local_entity_status)`, aplicable bajo direct/eor: seguro) | OK | — | — |
| Estatus de entidad local / ack de consistencia | `hr_local_entity_status` (cond.), `hr_entity_consistency_ack` (cond.) + decisión de consistencia | OK | — | — |
| Proveedor de nómina, desglose de población, privacidad de datos, bono de fin de año | required; población = grupo min 1 | GAP | G-C6 (bono de fin de año), G-C5 | Overlay por país / respuesta válida |
| Beneficios estatutarios | `hr_statutory_benefits_confirmation` (**blocking**, booleano) + `hr_statutory_benefits_decision` | **GAP** | **G-C2** (100 % con decisión abierta) | `field_answered` o `*_ack` |
| Sindicato, patrocinio migratorio, reclutamiento, salud ocupacional, traslado de personal | condicionales por población / servicios | OK | — | — |
| Overlays MX (+IMSS required; aguinaldo), SG (+CPF), US (desactiva bono) | — | CONTENT | Validación de dominio | — |

#### 4. `corporate_legal_admin` — 16 campos, 2 decisiones · denominador candidato 15 (2 + 13)

| Requisito | Campo-regla existente | Estado | Brecha | Resolución |
|---|---|---|---|---|
| Servicios en alcance | `legal_services_in_scope` | OK | — | — |
| Etapa de la entidad | `legal_entity_stage` (**blocking**) + `legal_entity_path_decision` | OK | — | — |
| Forma preferida, domicilio, estructura accionaria | condicionales por etapa | OK | La estructura accionaria captura **tipo y país del titular, rol y %**, **sin nombres** (cumple la regla del PO). Visibilidad `CONFIDENTIAL_ELIGIBLE` | — |
| Frentes por servicio (contratos, traducciones, apostilla, PI) | grupos condicionales + decisión `legal_document_workstreams_defined_decision` (exige ≥ 1 ítem por servicio seleccionado) | OK | La decisión **duplica** los `min_items` de cada grupo (una sola verdad en dos sitios) | Autoría: conservar la decisión nombrada |
| Pendientes operativos | `legal_constitutive_documents_pending`, `legal_source_documents_for_translation_pending` | GAP | G-C7 | Mover a contexto operativo |
| Overlay MX | solo ayuda de forma societaria (`CONTENT_VALIDATION_REQUIRED`) | CONTENT | — | — |

#### 5. `tax_accounting_audit` — 18 campos, 3 decisiones · denominador candidato 17 (6 + 11)

| Requisito | Campo-regla existente | Estado | Brecha | Resolución |
|---|---|---|---|---|
| Servicios en alcance | `tax_services_in_scope` (20 valores) | OK | — | — |
| Registro fiscal local | `tax_registration_status` (**blocking**) + decisión | OK | La decisión es idéntica a `field_answered` del campo (redundante, inocuo) | — |
| Cierre fiscal, marco contable, reporte a matriz | required | GAP | G-C11 (tipo `date`/"month") | Autoría |
| Operaciones con partes relacionadas | `tax_has_intercompany_transactions` (required) → grupo (cond., min 1) + decisión | OK | — | — |
| Precios de transferencia | `…documentation_status` (cond.) y `…_ack` (contradicción) + decisión | OK | — | — |
| Auditoría, créditos/devoluciones, contexto transaccional, preguntas fiscales | condicionales por servicios | OK | — | — |
| Overlays MX (+3), US (+1) | `CONTENT_VALIDATION_REQUIRED` | CONTENT | — | — |

#### 6. `strategic_advisory` — `crp_kind = strategic_advisory`, intake `light`, 2 campos, 1 decisión

| Requisito | Campo-regla existente | Estado | Brecha | Resolución |
|---|---|---|---|---|
| Capacidades de interés | `sa_capabilities` (required, `PREFILL_CONFIRM` desde `PSM.selected_capabilities`; 12 `CAP_SA_*`) | OK | Llave heredada `PSM.selected_capabilities` distinta de `PSM.selected_services` (las demás): confirmar que ambas existen en el contrato PSM | Verificación F5 |
| Estudios o necesidades | `sa_studies` (**blocking**, grupo min 1) + `sa_need_defined_decision` | OK | Subcampos `question` y `subject_detail` con `execution_dependency`; los subcampos llevan `answer_state` propio (D12) | — |

#### 7. `ecosystem_development` — `light`, 1 campo, 1 decisión

| Requisito | Campo-regla existente | Estado | Brecha |
|---|---|---|---|
| Búsquedas/vinculaciones de partners | `ed_engagements` (**blocking**, grupo min 1) + `ed_need_defined_decision` | OK | — (quién ejecuta lo define OH, nunca Precision) |

#### 8. `_generic` (`new:<slug>`) — `new_category_discovery`, 2 campos, 1 decisión

| Requisito | Campo-regla existente | Estado | Brecha |
|---|---|---|---|
| Clasificación confirmada por el cliente | `generic_classification_confirmed` (**blocking**, booleano) | OK | La decisión exige `= true` (misma forma que G-C2, pero aquí es intencional: *confirmation*) |
| Necesidades descritas | `generic_needs` (**blocking**, grupo min 1) | OK | La IA converse y estructura **pero nunca inventa requisitos especializados** (frontera del manifiesto) |

#### 9. Las 12 categorías sin manifiesto

`banking_finance_insurance` (NOT_AUTHORED), `corporate_real_estate`, `industrial_real_estate`, `industrial_infrastructure`, `technology_it`, `automation_security_systems`, `physical_security`, `procurement_supply_chain`, `certifications_quality`, `market_intelligence`, `marketing_communications`, `travel_mobility`.
**Estado:** representables sobre `_generic` (todo requisito estructural es el de la tabla 8); **CONTENT** — sin requisitos de dominio propios, el progreso mide solo "clasificación + necesidades". **Gap:** autoría y validación de dominio de la ola 2. **No bloquea el motor ni el contrato**; sí condiciona la calidad del CRP que reciben OH y el Sherpa para esas categorías (riesgo de producto a informar al PO, no bloqueo técnico).

### C-4. Equivalencia "100 % ⇔ listo para revisión"

`evaluateReadiness().ready` exige: (i) todos los `blocking_gaps` cerrados; (ii) decisiones `blocking` resueltas; (iii) sin `ASSUMED` ni contradicción sin reconocer. Frente a la regla congelada (100 % de requeridos aplicables confirmados):

- Los *gaps bloqueantes* son campos `blocking` sin confirmar ⊂ requeridos. ✔
- Las decisiones `path` se reducen a `field_answered`, `group_min_items` o `field_asked` sobre campos que ya son requeridos. ✔ (salvo G-C2 y la semántica de `field_asked`, G-C3)
- Las decisiones `consistency` exigen el `*_ack` solo cuando la contradicción se activa; el `*_ack` es `conditional` y, **al activarse, entra al denominador** (aplicable) → el porcentaje baja hasta que se responde. ✔
- `ASSUMED` no es confirmado (no cuenta). ✔

**Conclusión:** salvo G-C2 y G-C3, **100 % ⇒ `ready`** y el CRP puede ofrecerse a revisión sin lógica adicional. Con G-C2 el motor mostraría 100 % con un elemento crítico abierto: hasta corregir el manifiesto, el motor debe aplicar `ready = (progress = 100) ∧ (decisiones resueltas)` (regla más estricta, no contradice al PO: 100 % sigue significando "estructuralmente confirmado"). **Esto no resuelve B2**, que es otra pregunta: si existe un camino a "listo para revisión" con requeridos pendientes (`completed_with_pending` del canon del 7 oct).

### C-5. Sin nuevos campos

Este análisis **no propone ningún campo, estado ni llave nueva** de manifiesto: las resoluciones son (a) cambios de autoría sobre llaves existentes, (b) un `EXTEND` del AST (G-C1) y (c) semántica de motor ya existente (`field_asked`).

---

## D. Stripe → Premium / Precision entitlement contract

**Principios.** El pago es una verdad **de Stripe**, no del navegador. La autorización de acceso es una verdad **de Core** (entitlement). Precision solo lee el entitlement. Nada del cliente (redirect, parámetros de URL, página de éxito) activa nada.

### D.1. Lo que ya existe (REUSE) y lo que falta (NEW) — verificado en [CÓDIGO]

| Pieza | Estado | Detalle |
|---|---|---|
| Endpoint de eventos de facturación | **REUSE** (agnóstico) | `POST /api/billing/events`, `express.raw`, HMAC `x-beeside-signature = sha256=` + HMAC-SHA256(secret, `${timestamp}.` + rawBody), `x-beeside-timestamp`, tolerancia 300 s, `BILLING_EVENTS_ENABLED`, `BILLING_WEBHOOK_SECRET`. Campos: `event_type`, `project_id` (UUID), `idempotency_key` (8–200), `occurred_at`, opcionales `provider_reference`, `source`, `current_period_start/end`. **No hay adaptador de Stripe** ("no provider is selected") |
| Activación | **REUSE** | `processSubscriptionEvent`: bloqueo `FOR UPDATE` de `project`, `subscription_event.idempotency_key` UNIQUE, `subscription_one_open_per_project`, evento de analítica `premium_activated`, outbox |
| Adaptadores de checkout | **REUSE/EXTEND** | `checkout.ts` solo tiene Manual y DevSimulated; `premium_activation_request` ya guarda `checkout_adapter` y `checkout_reference` |
| Verificación Stripe (`Stripe-Signature`, `t=…,v1=…`) | **NEW** | Esquema de firma distinto al HMAC propio: **no se puede reutilizar** el verificador de `/api/billing/events` |
| Registro previo al pago (Session creada) | **NEW** *(nombre de trabajo: `premium_checkout`)* | `project_id`, `provider_session_id` UNIQUE, `product_ref`, `amount`, `currency`, `status` (`created`/`pending_async`/`paid`/`failed`/`expired`), `created_at`. Se escribe **antes** de redirigir. `premium_activation_request` se crea en la promoción (después del pago), no puede ser el ancla previa. Índice parcial único: **una sesión abierta por proyecto** |
| Ledger inbound de eventos del proveedor | **NEW** *(nombre de trabajo: `billing_inbound_event`)* | `provider_event_id` UNIQUE, `event_type`, `provider_session_id`, `received_at`, `processed_at`, `outcome`. Cubre eventos sin activación (fallos, reembolsos) y auditoría; la activación sigue anclada en `subscription_event.idempotency_key` |
| Identificadores | **REUSE** | `project_id` (canónico, nunca email) ↔ `client_reference_id` de Stripe; `provider_reference` = id de Session; `checkout_reference` = id de Session |

**Mapeo canónico (no se inventan nombres de identidad):** `Stripe Checkout Session id` → `premium_checkout.provider_session_id` → `project_id` → `company_id`/`person_id` (resueltos por Core al promover, nunca por email) → `subscription` → `entitlement.premium_access_active`. **Si una Session llega sin fila `premium_checkout` o con `client_reference_id` ≠ `premium_checkout.project_id`, no hay mapeo confiable:** no se activa, se registra `NOT_APPLICABLE_NO_MAPPING`, se responde 200 (para no reintentar infinitamente) y se alerta a Operaciones.

### D.2. Creación de la Session (Hosted Checkout)

1. Servidor: valida que el proyecto sea elegible (`fa4.result.delivered`, sin Premium abierto) y que no haya `premium_checkout` abierta → si hay una no expirada se **reutiliza** (misma URL); si no, crea una nueva.
2. Crea la Session en Stripe (clave secreta solo en servidor) con `client_reference_id = project_id`, `metadata.project_id`, precio y producto desde configuración (`product_ref`), `success_url` / `cancel_url` desde configuración.
3. Escribe `premium_checkout` (`created`) en la misma operación que devuelve la URL. Si Stripe falla → error reintentable al cliente; nada se activa.
4. La `success_url` solo muestra el estado leyendo el entitlement; **no lleva ni confía en ningún parámetro** como prueba de pago.

**Modo y vigencia (D-4):** el contrato cubre **pago único** (`mode = payment`) con la vigencia Premium tomada de configuración (`current_period_start/end` calculados por beeside). Modo suscripción añadiría `invoice.paid`, renovaciones y cancelación; **no se inventa** política de renovación. Decisión del PO sobre modo y plazo (D-4, no bloquea el contrato: el adaptador aísla el modo).

### D.3. Webhook de Stripe (un endpoint, cuerpo crudo)

Ruta propia *(nombre de trabajo; el dueño del router la fija)*, `express.raw`, **antes** de cualquier parser JSON.

1. **Verificar firma** `Stripe-Signature` sobre el **cuerpo crudo** con el secreto del endpoint (`STRIPE_WEBHOOK_SECRET`, nuevo, solo entorno), con tolerancia de marca de tiempo del SDK. Inválida → `400`, sin procesar, sin eco, métrica de rechazo. **Nunca** se confía en nada del cuerpo antes de verificar.
2. Registrar en `billing_inbound_event` (`provider_event_id` UNIQUE). Duplicado → `200` sin efecto.
3. Despachar por tipo (tabla D.4).
4. Respuesta: `2xx` solo si el efecto quedó *comprometido* o es deliberadamente no aplicable; `5xx` ante cualquier error transitorio (Stripe reintenta con retroceso exponencial).

### D.4. Eventos y transiciones

| Evento Stripe | Condición verificada | Efecto | Idempotencia |
|---|---|---|---|
| `checkout.session.completed` | Se **recupera la Session** por API; `status = complete`, `mode = payment`, `livemode` coincide con el entorno, `client_reference_id` = `premium_checkout.project_id`, importe/moneda/`product_ref` = valores esperados | `payment_status = paid` → **activar** (D-5). `payment_status = unpaid` (método asíncrono) → `premium_checkout = pending_async`, **sin activar** | `idempotency_key = stripe:checkout.session:{session_id}:paid` — la misma clave sirve a `completed`, `async_payment_succeeded` y la reconciliación |
| `checkout.session.async_payment_succeeded` | Igual; `payment_status = paid` | **activar** | misma clave |
| `checkout.session.async_payment_failed` | Session conocida | `premium_checkout = failed`; **sin activar**; sin revocar nada | por `provider_event_id` |
| `checkout.session.expired` | Session conocida | `premium_checkout = expired` (permite una nueva Session) | por `provider_event_id` |
| `charge.refunded`, `charge.dispute.*`, cancelaciones | — | **Solo registrar y alertar.** **PO POLICY REQUIRED BEFORE AUTOMATIC ENTITLEMENT REVOCATION.** No se revoca ni degrada automáticamente | por `provider_event_id` |
| Cualquier otro | — | `200`, registrado y descartado | — |

Un pago confirmado **sobre un proyecto que ya tiene Premium abierto** (segunda Session pagada, D-3): la clave de idempotencia es distinta pero `subscription_one_open_per_project` impide la segunda activación → resultado `NOT_APPLICABLE_DUPLICATE_PAYMENT` (200) + alerta a Operaciones. **No se reembolsa automáticamente:** requiere política del PO (D-3). Prevención: una sola Session abierta por proyecto (D.2).

### D.5. Activación — orden exacto (primera activación válida)

Una sola transacción **TX1** (`processSubscriptionEvent`, bloqueo del `project`) cubre 1–5:

| # | Paso del mandato | Implementación | Dónde |
|---|---|---|---|
| 1 | Asociar el pago al proyecto/cuenta | `premium_checkout.status = paid`; `premium_activation_request.checkout_adapter = 'stripe'`, `checkout_reference = session_id` | TX1 |
| 2 | Persistir estado de pago/activación | `subscription_event` (clave UNIQUE) | TX1 |
| 3 | Activar Premium del proyecto | `subscription` (`PREMIUM_ACTIVE`) + `entitlement.premium_access_active` | TX1 |
| 4 | Habilitar Precision | evento de outbox `premium.activated` comprometido en TX1; el consumidor aprovisiona la instancia (única por `project_id`) fuera de TX1 | TX1 + asíncrono idempotente |
| 5 | Registrar el evento de activación | `premium_activated` (convención de analítica existente) | TX1 |
| 6 | Correo de bienvenida Premium (onboarding de beeside; el recibo de Stripe **no** lo sustituye) | `precision.context.read` (pull por `project_id`) → **solo si la lectura tuvo éxito** se encola el correo; `dedupe_key = welcome:{project_id}` | asíncrono |
| 7 | CTA de Precision en el correo disponible | el enlace conduce a una ruta autenticada; **el acceso lo decide el entitlement, no el correo** | — |
| 8 | Primera entrada → Cover | marca "Cover visto" ausente (A-2) | Precision |
| 9 | Entradas posteriores → Precision Center | marca presente | Precision |

Cambios requeridos respecto al código actual (trabajo de F5, ver N-9/N-10): (a) la precondición `assessment_state = COMPLETED_LOCKED` de FA 3.0 se sustituye por la de FA 4.0 (resultado entregado); (b) retirar el *handoff package* empujado y `precision_state = STARTED` dentro de TX1; (c) el correo `premium_activation_confirmed` pasa de "en la transacción, `dedupe_key` por `eventId`" a "tras la lectura de contexto, `welcome:{project_id}`".

### D.6. Escenarios exigidos

| Escenario | Comportamiento |
|---|---|
| **Éxito inmediato** | Stripe emite `completed` (`paid`) → webhook activa → el cliente regresa a `success_url` y encuentra entitlement activo |
| **Éxito retrasado** (método asíncrono) | `completed` con `unpaid` → `pending_async` (sin activar); al llegar `async_payment_succeeded` → activa con la misma clave. La página de éxito muestra el componente de espera ya existente (copy: **CONTENT**, Design Proof v3.3 no disponible) |
| **Fallo** | `async_payment_failed` / Session no pagada → no se activa; `failed`; el cliente puede iniciar una nueva Session |
| **Fallo retrasado** | Igual que fallo; el estado previo fue `pending_async` |
| **Evento duplicado** | `provider_event_id` UNIQUE → 200 sin efecto; la clave de activación evita doble activación aun con IDs distintos |
| **Session duplicada** | Una abierta por proyecto; si dos se pagan, la segunda no activa (D-3) |
| **Webhook retrasado** | El cliente puede volver antes; la página lee el entitlement. Una **reconciliación** (trabajo programado y también solicitable por el servidor para el `premium_checkout` del propio cliente autenticado) recupera la Session en Stripe y ejecuta **la misma función idempotente**. El resultado sale de Stripe, nunca del navegador |
| **Webhook no disponible** | Respuesta `5xx` → Stripe reintenta durante días; la reconciliación cubre cualquier hueco; Stripe permite reenviar desde su panel |
| **Paga y nunca regresa** | La activación es independiente del retorno: entitlement + correo de bienvenida salen igual; el CTA del correo sirve cuando el cliente quiera |
| **Regresa antes de que termine el webhook** | Igual que "webhook retrasado": estado de espera existente, sin activar desde la página |

### D.7. Reembolsos, disputas, cancelación, reversa

**No existe política aprobada.** Se registran y alertan; **no se revoca ni degrada automáticamente.** La regla vigente de fin de Premium (OH contract §G: 90 días solo lectura configurables → revocación; reactivación automática por nuevo pago) aplica al *fin de vigencia*, no a un reembolso/contracargo. **PO POLICY REQUIRED BEFORE AUTOMATIC ENTITLEMENT REVOCATION** (D-3).

### D.8. Seguridad y cumplimiento

Secretos solo en entorno; claves restringidas; registros sin PII (solo IDs técnicos, como `fa_journey_event`); el cuerpo crudo no se persiste más allá del necesario; respuesta de error genérica; límite de tasa y alertas por ráfaga de firmas inválidas; nunca se registra el contenido de tarjeta (no llega a beeside con Hosted Checkout).

---

## E. Precision → Operation Hub handoff contract

**Fuente canónica:** `claude/precision-operation-hub-integration-contract-2026-10-07.md` (v1.2: reglas A, L.2 y L.3 son canon de Precision; C–E son interfaz **asumida** sobre Core/OH, no decididas aquí). Este documento no modifica OH: pide a su dueño lo que Precision necesita (B4).

### E-1. Secuencia congelada y estados

`Confirm CRP` → `Preview before Send` → `Send to Operation Hub` → `Sent`.
**Confirmar no envía.** Solo *Send* crea una entrega. Confirmar el MSM nunca activa OH.

| Estado visible | Derivación (sin estado nuevo) |
|---|---|
| **Not sent** | no existe fila en `oh_delivery` para esa clave |
| **Sending / pending** | última fila `queued` (con arrendamiento vigente) y ninguna `delivered` |
| **Accepted / Sent** | existe fila `delivered` (condición de aceptación E-4 cumplida) |
| **Failed — retryable** | última fila `failed` y ninguna `delivered` |

Esto es una **proyección** de `oh_delivery` (append-only: `queued` / `delivered` / `failed`). No se crean páginas nuevas: se usan los componentes de carga/error del Diseño (conformidad con Design Proof v3.3 pendiente, B1).

### E-2. Idempotencia y auditoría

- **Clave canónica estable:** `{project_id}:{kind}:{artefact}:{version}` — para un CRP: `{project_id}:crp:{crp_id}:{crp_version}`; primer envío: `kind = first_send`. No incluye hora, intento ni `delivery_id`.
- **Brecha N-3 (EXTEND de M-F):** `UNIQUE(idempotency_key, status)` impide registrar un segundo `queued`/`failed` tras un reintento. Se añade `attempt` (entero) → `UNIQUE(idempotency_key, attempt, status)` **y** índice único parcial `(idempotency_key) WHERE status = 'delivered'`. Así hay a lo sumo una entrega aceptada por clave y todos los intentos quedan auditados.
- **Auditoría:** cada fila guarda `person_id` (quién pulsó Send; **solo auditoría, no viaja**), `attempt`, `payload_checksum`, `preview_checksum`, `error_code`, marcas de tiempo, `oh_contract_version`.

### E-3. Carga útil: lista blanca explícita (cuatro grupos autorizados)

Un único **constructor de carga útil** produce el *business payload* y los *technical metadata* por separado. Es la fuente de **Preview y de Send** (mismo código, mismas entradas).

| Grupo del mandato | Qué contiene (negocio) | Llaves canónicas L.2 | Fuente |
|---|---|---|---|
| **1. Identidad / contexto del proyecto** | Destinos, objetivos y contexto confirmados del proyecto | `project_context.psm` {objectives, destinations, dependencies} · nombre visible del proyecto: **SNA en L.2** (si Core lo expone como contexto permitido se añade; delta en Anexo 2) | Hechos confirmados del PSM vigente |
| **2. Snapshot de MSM confirmado** | **Solo** el snapshot confirmado vigente (`service_map_snapshot`), nunca la vista viva | `project_context.psm` {categories, …} | `service_map_snapshot` más reciente confirmado |
| **3. CRP confirmado** | Contenido estructurado del CRP confirmado por el cliente | `artifact.structured`, `workstream` {category_label, crp_kind} | `pack` + `crp_confirmation` |
| **4. Contexto permitido de empresa/proyecto** | Campos permitidos del Company Context (con estados de verificación) y **requisitos operativos** (p. ej. necesidad de documentación) | `company_context` {revision_id, campos permitidos, estados de verificación, items_to_confirm}; requisitos operativos: nueva sub-llave propuesta *(Anexo 2)* | Core (CCIR); manifiesto (`operational_pending_items` reubicados) |

**Metadatos técnicos (nunca son contenido de negocio):** `contract` {oh_contract_version, delivery_id, idempotency_key, kind, sent_at}; `identity` {company_id, project_id}; `workstream_id`, `category_key` (asociación de categoría), `crp_id`, `crp_version`; `provenance` {psm_version, psm_confirmed_at, crp_version, crp_created_at}; checksums; estado de entrega.

**Nunca viaja** (lista de denegación comprobable por prueba): historial de conversación, prompts y razonamiento; **nombres de personas** (respondiente, accionistas, directivos, firmantes; coherente con el bloqueo del PO y la ZDR); email; `person_id`; YEV y toda procedencia FA (`delivered_view_reference`, `source_result_id`); `operations_only` no permitido; datos de otros proyectos; binarios/documentos. Cualquier llave no incluida en la lista blanca se descarta (lista blanca, no lista negra). Otro `kind` → `UNSUPPORTED_KIND`.

**Riesgo residual (R-1, a informar al PO):** los campos de texto libre pueden contener nombres que el propio cliente escriba aunque Precision **no los pida**. Mitigación: ninguna pregunta solicita nombres; pase de redacción de contrapartes restringidas sobre texto libre; la vista previa muestra exactamente lo que viaja. No existe detección determinista de nombres propios; no se promete.

**Documentos.** Precision **no** almacena documentos, no hay mecanismo de carga y no se añade sección "Supporting Documents" al CRP. La *necesidad* de documentación se conserva como **requisito operativo** (grupo 4) para ejecución en OH; el documento mismo vive en OH. **Hallazgo G-C7:** hoy esas necesidades están dentro del contenido del CRP (`operational_pending_items`), y la lista blanca L.2 no tiene una llave para ellas. Delta propuesto: reubicarlas en `project_context` como requisitos operativos y mostrarlas en el bloque correspondiente de la vista previa (D-7).

### E-4. Vista previa y condición de aceptación

**Vista previa = proyección del mismo constructor.** Se calcula `preview_checksum` = checksum de la **serialización canónica** (orden de llaves estable, p. ej. RFC 8785) del *business payload* + metadatos técnicos estables (excluye `delivery_id`, `sent_at`, `attempt`). `Send` incluye `preview_checksum`; el servidor **reconstruye** la carga y compara. Si difiere (algo cambió entre vista previa y envío) → `409 PREVIEW_STALE` y se vuelve a mostrar la vista previa. Con esto **no puede viajar un cuerpo oculto distinto al Preview.**

**Condición técnica de aceptación (para marcar *Sent*)** — **todas**:
1. OH respondió éxito con una referencia (`oh_reference`: id de artefacto/tarea) para la **misma** `idempotency_key`.
2. La **lectura de vuelta** de OH devuelve un checksum **igual** al `payload_checksum` calculado por Precision.
3. Precision comprometió la fila `delivered` en una transacción.

Cualquier otra cosa (timeout, 5xx, éxito sin referencia, checksum distinto) → **no es *Sent*.** Ver E-6.

**Lo que se necesita del dueño de OH (B4):** (a) forma de la respuesta de aceptación con `oh_reference`; (b) **alta idempotente por clave** que devuelva la misma referencia ante repetición; (c) consulta/lectura de vuelta por clave; (d) taxonomía de errores reintentables (timeouts, 5xx, 429) vs terminales (`IDENTITY_MISMATCH`, `UNSUPPORTED_KIND`, validación); (e) límite de latencia para fijar timeouts. El contrato v1.2 ya **asume** (c) como "checksum de lectura de vuelta" y los reintentos idempotentes, pero los marca **[VERIFICAR F5]** y no define la forma. Mientras tanto, Precision se construye contra un **puerto** (`OperationHubPort`) con un simulador (el modelo de referencia pasa 43/43).

### E-5. Envío (algoritmo)

1. Autorización: sesión del cliente + entitlement `FULL` (si no, `PRECISION_READ_ONLY`); precondición: existe `crp_confirmation` del `pack`; si el primer envío no tiene éxito, no se permite otro CRP distinto (`ACTIVATION_PENDING_RETRY_FIRST`).
2. Construir carga; comparar `preview_checksum` (E-4).
3. Si ya existe `delivered` para la clave → devolver ese resultado (idempotente). Si hay `queued` con arrendamiento vigente → devolver "pendiente".
4. Insertar `queued` (`attempt` = siguiente) y **encolar el trabajo**; el trabajo corre en servidor independiente de la conexión HTTP del cliente.
5. Llamar a OH con la clave de idempotencia; evaluar la condición de aceptación; escribir `delivered` o `failed` (`error_code`, `retryable`).
6. El cliente consulta el estado (E-1); **Retry** reutiliza la misma clave con `attempt + 1`.

### E-6. Matriz de fallos

| Situación | Comportamiento |
|---|---|
| **Éxito** | `delivered` (una sola fila por clave) → estado *Sent* |
| **Timeout** | Resultado **desconocido**: nunca *Sent*. El trabajo consulta primero a OH por la clave; si OH ya la aceptó → verifica checksum → `delivered`; si no → `failed` retryable con retroceso configurable |
| **Error de OH** | Reintentable (5xx/429/red) → `failed` retryable, reintentos automáticos con tope configurable y luego botón de reintento del cliente + alerta a Operaciones. Terminal (validación, identidad) → `failed` no reintentable + alerta; nunca se reintenta a ciegas |
| **Aceptado pero el cliente perdió la conexión** | El trabajo es de servidor: termina y registra `delivered`; al recargar el cliente ve *Sent*. Si el proceso cayó tras la aceptación de OH y antes de escribir: el barrido de `queued` vencidos reintenta con la misma clave y OH devuelve la misma referencia (requiere B4-b) |
| **Doble recepción** | Doble clic o doble solicitud: misma clave → índice único parcial de `delivered` + chequeo previo → una sola entrega. Doble recepción **en OH**: depende de la alta idempotente de OH (B4-b); sin ella pueden duplicarse tareas y es un riesgo conocido, por eso es bloqueante |
| **Envío posterior fallido** | Nunca degrada OH ni el estado ya `delivered` del primer envío |
| **Cambio entre vista previa y envío** | `409 PREVIEW_STALE`, nueva vista previa |
| **Entitlement vence durante el envío** | Se evalúa al iniciar; un envío ya en curso concluye; los nuevos se rechazan (`PRECISION_READ_ONLY`) |

### E-7. Activación de Operation Hub y enlace

- **Solo después del primer envío exitoso** (`delivered`) se marca OH como activo para el proyecto (`first_send_done`) y se emite el evento `operation_hub_activated` (una vez por proyecto).
- **Enlace genérico "Go to Operation Hub"**: URL desde configuración (`operation_hub_url`, no hardcodeada). La regla congelada del producto lo expone tras el primer envío exitoso; el contrato v1.2 §F lo liga a `client_accessible` (que requiere Sherpa asignado, Opción A). **Brecha D-8** (no bloqueante): recomendación = seguir el producto congelado (visible tras el primer *delivered*) y mostrar el aviso de "enviado, aún no accesible" ya existente (`pendingNotice`) mientras OH lo reporte; "Contact my Sherpa" sigue siendo `first_send_done ∧ client_accessible ∧ sherpa_assigned`.
- **Los CRPs posteriores** se envían al **mismo** proyecto de OH (`project_id` constante; un `workstream` por categoría). No se vuelve a "activar".
- La ayuda general (Help / FAQ / Contact beeside) permanece visible en todo estado; no depende de OH.


---

## F. Analytics / event contract

**Validación de la arquitectura existente [CÓDIGO].**
- `fa_journey_event` (escrita por `recordJourneyEvent`): nombres en snake_case, **solo IDs técnicos, sin PII**, whitelist de eventos permitidos desde el cliente (`CLIENT_EVENT_TYPES`) y **sin llave de deduplicación**. Es una tabla **de FA**: no se extiende desde este espacio.
- `premium_activated`: ya lo emite Core dentro de TX1 con la idempotencia de la suscripción. **REUSE**: Precision no lo vuelve a emitir.
- `outbox_event`: transporte de eventos de dominio entre sistemas, no un almacén de analítica.
- Canal de consumo (BI/herramienta externa): **SNA** — no se identificó exportación en el código revisado. El contrato no presupone destino.

**Decisión (N-11).** La convención de nombres (snake_case) y la regla "solo IDs, sin PII" se **reutilizan**. Precision escribe en una tabla **propia** *(nombre de trabajo: `precision_journey_event`)* con `event_key` **UNIQUE** y `INSERT … ON CONFLICT DO NOTHING`, **en la misma transacción** que el cambio de estado que la origina. Resultado: exactamente una vez por construcción, sin emisión desde el cliente, y si la transacción revierte no existe el evento.

**Sobre común:** `event_name`, `event_key` (dedup), `project_id`, `company_id`, `occurred_at` (UTC, servidor), `interface_language`, `source_system = precision`, `person_id` (opcional, solo auditoría), propiedades. Nunca texto libre, nombres, correo, ni contenido del cliente. Sin interfaz de Analytics.

| # | Evento | Disparador (servidor) | IDs requeridos | Propiedades | Fuente | Dedup (`event_key`) |
|---|---|---|---|---|---|---|
| 1 | `precision_started` | `project.precision_state` `NOT_STARTED → STARTED` | `project_id` | — | Precision | `precision_started:{project_id}` |
| 2 | `understanding_started` | `precision_assessment` `not_started → in_progress` | `project_id` | — | Precision | `understanding_started:{project_id}` |
| 3 | `understanding_resumed` | Primer turno del cliente tras un hueco de inactividad > umbral configurable (`analytics.resume_gap_minutes`) con el assessment en `in_progress`/`ready_for_confirmation` | `project_id` | `gap_minutes` (entero) | Precision | `understanding_resumed:{project_id}:{epoch(last_client_activity_at previo)}` |
| 4 | `my_service_map_ready` | Assessment `→ ready_for_confirmation` | `project_id` | `psm_cycle` | Precision | `…ready:{project_id}:{psm_cycle}` (`psm_cycle` = nº de snapshots confirmados + 1) |
| 5 | `my_service_map_confirmed` | Inserción de `service_map_snapshot` | `project_id`, `snapshot_id` | `category_count` | Precision | `…confirmed:{snapshot_id}` |
| 6 | `category_started` | `category_assessment` `confirmed → in_progress` (primera vez) | `project_id`, `category_assessment_id` | `category_key`, `category_origin` | Precision | `category_started:{category_assessment_id}` |
| 7 | `category_progress_changed` | Una escritura de hecho cambia `progress_pct` derivado (antes ≠ después, calculado en la misma transacción) | `project_id`, `category_assessment_id`, `fact_id` | `category_key`, `from_pct`, `to_pct` | Precision | `…:{category_assessment_id}:{fact_id}` |
| 8 | `critical_item_created` | Aparece un elemento crítico (campo `blocking` o decisión `blocking` sin resolver; diferencia antes/después) | + `item_key` | `category_key`, `item_kind` (`field`/`path`/`consistency`/`confirmation`) | Precision | `…:{category_assessment_id}:{item_key}:{fact_id causante}` |
| 9 | `critical_item_resolved` | Un elemento crítico deja de estar abierto | + `item_key` | ídem | Precision | ídem |
| 10 | `add_service_started` | Se abre "Add a Service" (con mapa confirmado) | `project_id`, `request_key` | — | Precision | `…:{project_id}:{request_key}` |
| 11 | `add_service_completed` | `precision_psm_new_version` completado | `project_id`, `request_key`, `snapshot_id` | `classification` (I1–I6), `category_key` | Precision | `…:{request_key}` |
| 12 | `possible_new_service_detected` | Clasificación `unmapped_known_category` o `discovery` confirmada por el cliente | `project_id`, `request_key` | `classification` | Precision | `…:{request_key}` |
| 13 | `possible_new_service_category_proposed` | Precision propone categoría para el servicio nuevo | `project_id`, `request_key` | `proposed_category_key` (o `none` si incierta) | Precision | `…:{request_key}:{proposed_category_key}` |
| 14 | `crp_ready_for_review` | Cruce `no listo → listo` (progreso 100 % y decisiones resueltas) | `project_id`, `category_assessment_id`, `fact_id` | `category_key` | Precision | `…:{category_assessment_id}:{fact_id}` |
| 15 | `crp_change_requested` | El cliente pide cambios desde la revisión (vuelve a la categoría) | `project_id`, `category_assessment_id`, `pack_id` | `category_key` | Precision | `…:{pack_id}` |
| 16 | `crp_confirmed` | Inserción de `crp_confirmation` | `project_id`, `pack_id` | `category_key`, `crp_version` | Precision | `…:{pack_id}` |
| 17 | `handoff_previewed` | Se genera una vista previa (solo si el `preview_checksum` es nuevo) | `project_id`, `pack_id` | `kind` | Precision | `…:{project_id}:{preview_checksum}` |
| 18 | `operation_hub_send_completed` | Fila `delivered` en `oh_delivery` | `project_id`, `delivery_id` | `kind`, `attempt` | Precision | `…:{idempotency_key}` |
| 19 | `operation_hub_activated` | Primer `delivered` del proyecto | `project_id`, `delivery_id` | — | Precision | `operation_hub_activated:{project_id}` |
| 20 | `premium_activated` (**existente**) | TX1 de activación | `project_id`, `subscription_id` | — | **Core** (REUSE) | ligado a `subscription_event.idempotency_key` |

Notas: (a) no se añaden eventos de fallo de envío o de pago a este catálogo; esos fallos viven en `oh_delivery`, `billing_inbound_event` y alertas operativas; (b) ningún evento lleva el contenido de las respuestas; (c) la ZDR no se ve afectada (la analítica no incluye contenido de cliente).

---

## G. Configuration dependencies

**Patrón existente (REUSE).** Los valores operativos que deben cambiar sin release no se hardcodean (OH contract §J, regla única, probada con escaneo estático y P06). Ya existen "config bundles" (`backend/db/config-bundles/…`) y variables de entorno (URLs de términos y privacidad, `BILLING_WEBHOOK_SECRET`, `BILLING_EVENTS_ENABLED`). **El esquema final de almacenamiento y la UI de Admin no se deciden aquí** (Precision Admin está detenido por el PO): este contrato define **llaves, forma, resolución y respaldo**, listos para Admin (las escrituras entran por un proceso controlado hasta que Admin exista).

**Campos de auditoría comunes** a toda fila de configuración: `created_at/by`, `updated_at/by`, `version`, `change_reason`, `is_active`. Histórico append-only.

| Clave / entidad | Propósito | Existe | Resolución y respaldo |
|---|---|---|---|
| **Cover assets** *(nombre de trabajo: `precision_cover_asset`)* | `country_code` (ISO-3166-1 alfa-2) → `asset_ref`, `is_active`, `focal_point {x,y ∈ [0,1]}`, recorte/proporción por punto de quiebre (móvil/tablet/escritorio), `alt_text` por idioma. Fila global con `country_code` = comodín | NEW | País del destino **proviene de FA** (`destinations[]`, estado confirmado). Un solo destino = principal. Varios destinos sin bandera de principal → **imagen global** (FA v0.2 no define destino principal; no se pregunta antes del Cover). Sin activo, destino no soportado, activo inactivo o sin destino confirmado → global. Sin global → composición neutra de marca (token de diseño, no imagen). **Nunca** se hardcodea la imagen temporal México/España |
| `operation_hub_url` | Enlace genérico "Go to Operation Hub" | NEW | Por idioma y entorno. Faltante/inactivo → el enlace **no se muestra** y se alerta (nunca un enlace roto). Visible según D-8 |
| `help_center_url` | Help / FAQ | NEW | Por idioma y entorno. Faltante → "Contact beeside" sigue disponible (la ayuda general nunca desaparece) |
| `terms_url`, `privacy_url` | Términos y privacidad | Existen como variables de entorno | EXTEND a por idioma/entorno con auditoría. La validación al desplegar **falla** en producción si faltan |
| Destinos por idioma/entorno | Resolución `locale` → valor; sin valor para el idioma → idioma por defecto del proyecto | NEW (regla) | `fa4_project.locale` (`es`/`en`) |
| **Etiquetas de categoría** (`category_label`) por idioma | Contenido/configuración **ligado a los mismos `category_key`** (los IDs no cambian) | Borradores en manifiestos | Respaldo: etiqueta EN → nunca se muestra el `category_key` crudo. Las etiquetas ES de los manifiestos son **borradores no aprobados**: CONTENT, no bloquea |
| Premium: `product_ref`, importe esperado, moneda, plazo (días), `success_url`/`cancel_url` | Verificación del pago y vigencia | NEW | Por entorno. Importe/moneda/producto sirven para validar la Session recuperada (D.4) |
| Secretos (clave API de Stripe, `STRIPE_WEBHOOK_SECRET`) | — | NEW | Solo entorno / gestor de secretos; **nunca** en tablas de configuración ni en logs |
| `precision.readonly_grace_days` (90) | Solo lectura al terminar Premium | Definido en contrato | Se instantánea al iniciar (`grace_days_applied`) |
| Envío a OH: reintentos máximos, retroceso, `timeoutMs`, arrendamiento de `queued` | Política de entrega | NEW | Sin literales en código |
| Reconciliación de pagos: intervalo y antigüedad mínima | — | NEW | — |
| `analytics.resume_gap_minutes` | Umbral de `understanding_resumed` | NEW | — |
| Rutas de notificación interna, remitente/reply-to | Alertas operativas y soporte | Definido en contrato §J | — |

---

## H. Error / retry / idempotency rules

**Reglas generales.** (1) Todo efecto externo o repetible lleva una clave de idempotencia **estable** (nunca hora/intento). (2) La idempotencia se impone en **base de datos** (UNIQUE / bloqueo de fila), no solo en código. (3) Un error nunca deja a Precision en un estado visible que el Diseño no define. (4) Un error posterior a un pago confirmado **nunca revierte la activación** de Premium. (5) Los reintentos usan retroceso exponencial con tope configurable y terminan en alerta operativa.

| Operación | Clave / ancla | Error → comportamiento | Reintento |
|---|---|---|---|
| Webhook de Stripe | `provider_event_id` UNIQUE | Firma inválida → 400 sin efecto. Transitorio → 5xx. Duplicado → 200 sin efecto | Reintentos de Stripe (días) + reconciliación |
| Activación Premium (TX1) | `subscription_event.idempotency_key`, `subscription_one_open_per_project`, bloqueo de `project` | Regla de negocio no aplicable (sin mapeo, pago duplicado, importe distinto) → 200 + registro + alerta, **sin cambios**. Error técnico → 5xx y rollback total | Seguro por clave |
| Lectura de contexto (`precision.context.read`) | por `project_id` (pull) | Falla → **no se envía el correo de bienvenida**, la activación **se conserva**, alerta | Retroceso exponencial; al éxito, un solo correo |
| Correo de bienvenida | `welcome:{project_id}` (UNIQUE en `fa4_email_delivery`/outbox de correo) | Falla de envío → estados de entrega existentes | Reintento del outbox |
| Aprovisionamiento de la instancia Precision | `precision_instance_one_pa_per_project` | Duplicado → no-op | Idempotente |
| Marca de Cover | `INSERT … ON CONFLICT DO NOTHING` por `project_id` | Falla → se vuelve a mostrar el Cover; nunca bloquea el acceso | — |
| Nueva versión de PSM / Add a Service | `request_key` (M-G), serializado por proyecto | Reintento con la misma clave → mismo resultado | Seguro |
| Cierre de categoría | `category_assessment_complete()` atómico | Todo o nada | Seguro |
| Confirmación de CRP | UNIQUE por `pack_id` (`crp_confirmation`) | Repetida → no-op | Seguro |
| Vista previa | sin efectos | — | — |
| Envío a OH | `{project_id}:{kind}:{artefact}:{version}` + `attempt` | Ver E-6 | Mismo key, `attempt + 1`; barrido de `queued` vencidos |
| Analítica | `event_key` UNIQUE, misma transacción | Rollback → no hay evento | — |
| Lectura de configuración | respaldo por clave | Faltante → respaldo definido (G); nunca error de usuario | — |
| Guardia de IA | `timeoutMs` acotado | Fallo → *fail-open acotado* según el diseño de la guardia | Acotado |

**Trabajo de F5 conocido (no son brechas de contrato):** corregir el falso positivo del lint T-1 ("de una"); cambiar `timeoutMs` de la guardia (latencia p50 7,1 s / p95 11 s sobre el presupuesto de 6 s); retirar `handoff_ready` y el *handoff package* empujado; precondición `COMPLETED_LOCKED` de FA 3.0 → FA 4.0.

---

## I. Build dependency map

Orden de construcción. Las cadenas independientes pueden ir en paralelo. `⛔Bn` = depende de un bloqueo abierto.

| Etapa | Qué | Depende de | Paralelo con |
|---|---|---|---|
| **0. Condiciones de entrada** | Publicar las ramas del motor (engine foundation, MB4 rebasado); ZDR resuelta **antes de datos reales de cliente** (puerta dura, no de F5 con datos sintéticos); corregir T-1 | Cierre R2 (8 oct) | — |
| **1. Esquema aditivo** | M-A…M-H ya especificadas + `crp_confirmation`, `precision_cover_seen`, `precision_journey_event`, `oh_delivery.attempt` + índice parcial, `premium_checkout`, `billing_inbound_event`, estado de acceso de entitlement (`precision_access_mode`…), tablas de configuración | 0 | — |
| **2. Configuración** | Llaves y resolución (G), validación de despliegue | 1 | 3, 4 |
| **3. Pago (Core)** | Adaptador Stripe: creación de Session, webhook, reconciliación; retirar push; bienvenida tras lectura de contexto; precondición FA 4.0 | 1, 2, D-4, cuenta/keys/producto/precio en Stripe (externos) | 4, 5 |
| **4. Contexto FA→Precision** | Vista `client_safe` + rol lector, `context_read`, `context_pin` | ⛔B5 (CR-04) | 3, 5 |
| **5. Motor** | Cargador/validador de manifiestos, `evaluateReadiness` con la fórmula de progreso, elementos críticos derivados, máquina de estados | 1 | 3, 4 |
| **6. Understanding → MSM** | Turnos, vista viva, snapshot inmutable | 4, 5, ⛔B1 | — |
| **7. Categorías y CRP** | Trabajo por categoría, progreso, críticos, CRP listo/confirmado/solo lectura, solicitud de cambios | 5, 6, ⛔B2, ⛔B3 | 8 |
| **8. Add a Service / Possible New Service** | Clasificación determinista, nueva versión de PSM | 6 | 7 |
| **9. Vista previa y envío a OH** | Constructor de carga, lista blanca, `preview_checksum`, puerto `OperationHubPort`, trabajos, activación | 7, ⛔B4, D-7, D-8 | 10 |
| **10. Analítica** | `precision_journey_event` + emisión transaccional | 1; eventos de 6–9 | 9 |
| **11. Cover y Center** | Resolución de Cover, primera entrada | 2, 3, ⛔B1 | 6–9 |
| **12. Integración UI ↔ Diseño** | Conformidad con Design Proof v3.3 pantalla por pantalla | ⛔B1 | — |
| **13. Verificación** | Matriz J completa, escaneos estáticos, carga/concurrencia, latencia | todo | — |

Ruta crítica: **1 → 5 → 6 → 7 → 9 → 13**, con B1, B2, B3, B4 y B5 como compuertas externas.

---

## J. Test matrix

**Nivel:** U = unidad · I = integración (BD real) · E = extremo a extremo · S = seguridad/estático · C = concurrencia. `[⛔Bn]` = su resultado definitivo depende de un bloqueo abierto (se puede escribir con simulador).

**PAYMENT**

| ID | Caso | Nivel | Resultado esperado |
|---|---|---|---|
| PAY-01 | `completed` con `paid` | I/E | Premium activo una vez: 1 `subscription_event`, 1 entitlement, 1 `premium_activated`, 1 bienvenida |
| PAY-02 | Webhook duplicado (mismo `provider_event_id`) | I | 200, sin filas nuevas, sin segundo correo ni evento |
| PAY-03 | `completed` y luego `async_payment_succeeded` de la misma Session | I | Una sola activación (misma clave) |
| PAY-04 | Dos eventos con IDs distintos para la misma Session | I | Una sola activación |
| PAY-05 | `async_payment_failed` | I | Sin activación, `failed`, sin correo |
| PAY-06 | `completed` con `unpaid` y luego éxito | I | Pendiente sin activar; activa solo al éxito |
| PAY-07 | El cliente nunca regresa | E | Entitlement activo y bienvenida enviada |
| PAY-08 | El cliente regresa antes del webhook | E | Componente de espera; **la página no activa**; activo tras el webhook |
| PAY-09 | Firma inválida | S | 400, sin ledger, sin cambios |
| PAY-10 | Cuerpo alterado / parseado antes de verificar | S | Rechazo (se verifica sobre cuerpo crudo) |
| PAY-11 | Repetición con marca de tiempo vieja | S | Rechazo |
| PAY-12 | Session sin fila `premium_checkout` | I | `NOT_APPLICABLE_NO_MAPPING`, sin activar, alerta |
| PAY-13 | `client_reference_id` ≠ proyecto registrado | I | Sin activar, alerta |
| PAY-14 | Importe / moneda / producto distintos | I | Sin activar, alerta |
| PAY-15 | `livemode` distinto del entorno | I | Sin activar |
| PAY-16 | Webhook + reconciliación + reentrega en paralelo (N hilos) | C | Exactamente 1 activación, 1 proyecto, 1 instancia, 1 correo, 1 evento |
| PAY-17 | Segunda Session pagada del mismo proyecto | I | `NOT_APPLICABLE_DUPLICATE_PAYMENT`, sin segundo entitlement, alerta |
| PAY-18 | Reembolso / disputa | I | Registrado y alertado; entitlement intacto |
| PAY-19 | 5xx transitorio y reintento | I | Una sola activación |
| PAY-20 | Falla la lectura de contexto tras el pago | I | Premium se conserva; sin correo; reintento con retroceso; al éxito, un correo |
| PAY-21 | La página de éxito no contiene lógica de activación | S | Inspección estática de rutas |

**FIRST ENTRY / COVER**

| ID | Caso | Nivel | Esperado |
|---|---|---|---|
| ENT-01 | Primera entrada autenticada | E | Cover; marca escrita |
| ENT-02 | Segunda entrada | E | Precision Center |
| ENT-03 | Falla la escritura de la marca | I | Cover de nuevo; sin bloqueo |
| ENT-04 | Sin entitlement / en solo lectura | I | Acceso denegado / Center en solo lectura |
| ENT-05 | CTA del correo sin pago confirmado | S | Sin acceso |
| COV-01 | Destino con activo activo | I | Ese activo |
| COV-02 | Destino sin activo | I | Global |
| COV-03 | Destino no soportado | I | Global |
| COV-04 | Varios destinos sin principal / sin destino confirmado | I | Global |
| COV-05 | Activo inactivo | I | Global |
| COV-06 | Punto focal y recorte en tres puntos de quiebre | E | Respetados |
| COV-07 | Sin imagen de país en el código | S | Escaneo estático |
| COV-08 | Sin global | I | Composición neutra, sin error |

**FA → PRECISION**

| ID | Caso | Nivel | Esperado |
|---|---|---|---|
| FAP-01 | Valores heredados | I/E | Se muestran para confirmar; no se repreguntan |
| FAP-02 | Valor no capturado (`NOT_CAPTURED`) | E | Se recoge en Understanding |
| FAP-03 | Contradicción FA ↔ cliente | E | Corregible; procedencia registrada; FA intacto |
| FAP-04 | Lectura solo por `project_id` | S | El correo nunca es selector |
| FAP-05 | Rol lector no puede leer `email` ni `answers` completo `[⛔B5]` | S | Denegado |
| FAP-06 | `capabilityId` desconocido | U | Clasificación de escenario, sin error |
| FAP-07 | `operations_only` | S | Nunca llega al contexto de IA ni a respuestas |
| FAP-08 | Pin de origen | I | `context_pin` con versiones |

**UNDERSTANDING / MSM**

| ID | Caso | Nivel | Esperado |
|---|---|---|---|
| UND-01 | Categorías antes de confirmar el MSM | E | Ocultas |
| UND-02 | Mapa listo | I | `ready_for_confirmation` |
| UND-03 | Corrección antes de confirmar | E | La vista viva se actualiza |
| UND-04 | Actualización después de confirmar | I | Nueva versión del PSM |
| UND-05 | Retomar tras hueco | I | `understanding_resumed` una vez |
| UND-06 | Sin porcentajes en Understanding | E | Ninguno visible |
| MSM-01 | Confirmación crea snapshot inmutable | I | UPDATE/DELETE bloqueados |
| MSM-02 | La vista viva sigue cambiando | I | Sí |
| MSM-03 | "Confirmar cambios" opcional | E | Nuevo snapshot |
| MSM-04 | Cambios sin confirmar | I | Excluidos de la carga a OH |
| MSM-05 | Números de versión | E | No visibles |
| MSM-06 | Doble clic en confirmar | C | Un solo snapshot |

**CATEGORY**

| ID | Caso | Nivel | Esperado |
|---|---|---|---|
| CAT-01 | Denominador = requeridos ∧ aplicables (fixtures por manifiesto) | U | Coincide con la hoja de cálculo de referencia |
| CAT-02 | Campos opcionales | U | No alteran el porcentaje |
| CAT-03 | `UNKNOWN`/`WITHHELD`/`ASSUMED` | U | No cuentan |
| CAT-04 | Heredado confirmado cuenta; `CONTEXT_ONLY` no | U | Según C-1 |
| CAT-05 | Cambio de aplicabilidad | U | Cambia el denominador |
| CAT-06 | Elemento crítico se crea y se resuelve | I | Eventos 8 y 9 |
| CAT-07 | La criticidad no pondera | U | Mismo % con distinta criticidad |
| CAT-08 | 100 % → listo; 99,9 % → no listo (`floor`) | U | Correcto |
| CAT-09 | Denominador 0 | U | Nunca listo |
| CAT-10 | 100 % no implica ejecución ni OH | E | Ninguna acción automática |
| CAT-11 | Conteo de grupos (D-5) | U | Según C-1 |
| CAT-12 | Contradicción activa el `*_ack` | U | Entra al denominador |
| CAT-13 | Satisfacibilidad de cada decisión por rama (G-C3, `field_asked` inaplicable) | U | Resoluble en toda rama |
| CAT-14 | Caso personas (G-C2): 100 % con decisión abierta | U | No listo |
| CAT-15 | Recalculo determinista e idempotente | U | Mismo resultado |
| CAT-16 | Dos escrituras de hechos simultáneas | C | Porcentaje consistente |

**ADD A SERVICE**

| ID | Caso | Nivel | Esperado |
|---|---|---|---|
| ADD-01 | Servicio conocido | I | `client_added`, nueva versión |
| ADD-02 | Possible New Service con categoría conocida | I | `unmapped_known_category`: entra `generic_unmapped_needs` en esa categoría |
| ADD-03 | Possible New Service con categoría incierta | I | `new:<slug>` + `_generic`; "To Review" `[N-7]` |
| ADD-04 | Actualización en vivo del MSM | E | Refleja el cambio |
| ADD-05 | Orden de clasificación | U | out_of_scope → strategic_advisory → ecosystem_development → known_service → unmapped_known_category → discovery |
| ADD-06 | Doble solicitud | C | Una sola versión (clave de solicitud) |
| ADD-07 | Sin ruta de escritura al catálogo | S | Verificado |

**CRP**

| ID | Caso | Nivel | Esperado |
|---|---|---|---|
| CRP-01 | Solicitar cambios | E | Vuelve a la categoría |
| CRP-02 | CRP confirmado | I | Solo lectura (sin API de escritura) |
| CRP-03 | Confirmar solo | I | Sin `oh_delivery` ni activación de OH |
| CRP-04 | Confirmar dos veces | C | Una sola confirmación |
| CRP-05 | `pack` inmutable | I | UPDATE/DELETE bloqueados |
| CRP-06 | Cambiar un hecho tras "listo" | I | Vuelve a borrador sin pérdida |
| CRP-07 | Reapertura de un CRP confirmado `[⛔B3]` | I | Según D-2 |

**HANDOFF**

| ID | Caso | Nivel | Esperado |
|---|---|---|---|
| HOF-01 | La vista previa coincide con la carga saliente | I | Checksums iguales (byte a byte) |
| HOF-02 | Algo cambió entre vista previa y envío | I | 409 `PREVIEW_STALE` |
| HOF-03 | Envío exitoso | I/E | Una fila `delivered` |
| HOF-04 | Envío duplicado (doble clic / paralelo) | C | Una entrega, un trabajo en OH `[⛔B4]` |
| HOF-05 | Fallo recuperable | I | `failed` → reintento con la misma clave → `delivered` |
| HOF-06 | Timeout | I | Nunca *Sent*; consulta por clave antes de reenviar |
| HOF-07 | Aceptado pero el cliente perdió la conexión | E | *Sent* al recargar |
| HOF-08 | Caída entre aceptación de OH y escritura | I | El barrido recupera sin duplicar `[⛔B4]` |
| HOF-09 | Primer envío exitoso | E | OH activo; enlace `operation_hub_url` (D-8); un fallo no lo activa |
| HOF-10 | Segundo CRP | I | Mismo proyecto de OH; sin reactivación |
| HOF-11 | Primer envío fallido bloquea otro CRP | I | `ACTIVATION_PENDING_RETRY_FIRST` |
| HOF-12 | Lista blanca / denegación | S | Llave desconocida descartada; sin conversación, nombres, correo, `person_id`, YEV ni procedencia FA |
| HOF-13 | MSM enviado | I | Solo el snapshot confirmado |
| HOF-14 | Separación negocio / metadatos técnicos | U | Vista previa muestra solo negocio |
| HOF-15 | Checksum de lectura de vuelta distinto | I | No es *Sent* |
| HOF-16 | Solo lectura | I | Envío rechazado |
| HOF-17 | `UNSUPPORTED_KIND`, `IDENTITY_MISMATCH` | I | Error terminal, sin reintento ciego |
| HOF-18 | Estados Not sent / pending / Sent / Failed | U | Derivación de E-1 |

**DOCUMENTS**

| ID | Caso | Nivel | Esperado |
|---|---|---|---|
| DOC-01 | Sin mecanismo de carga | S | Inventario de rutas/UI sin carga de archivos |
| DOC-02 | El requisito de documentación se conserva | I | Viaja en el grupo 4 |
| DOC-03 | Sin binarios en Precision | S | 0 columnas `bytea`/`oid` |
| DOC-04 | Sin sección "Supporting Documents" en el CRP | E | Ausente |
| DOC-05 | Vista previa ↔ carga | I | Se muestra si y solo si viaja |

**ANALYTICS / CONFIG / SEGURIDAD**

| ID | Caso | Nivel | Esperado |
|---|---|---|---|
| ANA-01 | Los 19 eventos propios | I | Uno por disparador |
| ANA-02 | Repetición de transición | C | Sin duplicado |
| ANA-03 | Sin PII ni texto libre | S | Verificado |
| ANA-04 | Rollback | I | Sin evento |
| ANA-05 | `premium_activated` | I | Una vez |
| CFG-01 | URL faltante o inactiva | I | Respaldo definido; sin enlaces rotos |
| CFG-02 | Resolución idioma/entorno | U | Correcta |
| CFG-03 | Etiquetas ES sobre los mismos IDs | U | Respaldo EN |
| CFG-04 | Sin literales operativos en código | S | Escaneo estático |
| CFG-05 | Cambio sin release | I | Efectivo |
| CFG-06 | Auditoría | I | Metadatos escritos |
| SEC-01 | Aislamiento entre proyectos (RLS o equivalente) | S | Sin lectura cruzada |
| SEC-02 | Entitlement en cada ruta | S | Aplicado en servidor |
| SEC-03 | Limitación de tasa de webhook y de envíos | S | Activa |
| SEC-04 | Puerta ZDR | S | Sin contenido real de cliente a motor de IA sin ZDR |
| SEC-05 | Latencia de la guardia (p95 ≤ presupuesto) | I | Cumple tras cambiar `timeoutMs` |

**RESPONSIVE / NIGHT SHIFT**

| ID | Caso | Nivel | Esperado |
|---|---|---|---|
| RSP-01 | Cover, Center, categoría, vista previa en móvil / tablet / escritorio `[⛔B1]` | E | Comportamiento congelado intacto |
| RSP-02 | Night Shift | E | Tokens del Diseño |
| RSP-03 | Cambio de idioma | E | Etiquetas y destinos por idioma |
| RSP-04 | Ningún estado visible al cliente fuera del Design Proof `[⛔B1]` | E | Inventario sin extras |
| RSP-05 | Accesibilidad básica (contraste, foco, teclado) | E | Cumple |

---

## K. Remaining blockers and gap report

### K-1. BLOCKING (5)

| ID | Qué falta | Por qué bloquea | Dueño | Criterio de cierre |
|---|---|---|---|---|
| **B1** | **Design Proof v3.3**: SNA en el Project y en las carpetas conectadas | Sin él no puedo certificar "no se crean estados fuera del Diseño", la composición de la vista previa ni las etiquetas visibles. No se reconstruye ni se infiere | PO | Entregar el archivo (o su inventario de pantallas/estados/copy) y correr RSP-04 |
| **B2** | Conflicto producto ↔ canon: ¿hay camino a "CRP listo para revisión" con requeridos pendientes? | Cambia la máquina de estados y la regla de `ready` | PO | Decisión D-1 |
| **B3** | Conflicto producto ↔ canon: ¿quién reabre un CRP confirmado? | Define si existe un canal de reapertura y quién lo usa | PO | Decisión D-2 |
| **B4** | Condición de aceptación y alta idempotente de OH | Sin ella no se puede cumplir "nunca *Sent* sin aceptación" ni garantizar "sin duplicados en OH" | Dueño de OH | Entregar (a)–(e) de E-4 |
| **B5** | CR-04: proyección `client_safe` de `fa4_project.answers` y obtención de `operations_only` | Sin la vista y el rol, Precision no puede leer FA sin acceso a `email`/`answers` completos | Dueño de FA 4.0 (no se toca FA aquí) | Vista confirmada + prototipo de permisos |

### K-2. NON-BLOCKING

| ID | Hallazgo | Resolución |
|---|---|---|
| N-1 | La confirmación del CRP necesita un registro propio append-only *(`crp_confirmation`)*: `pack` es inmutable | NEW en F5 |
| N-2 | Colisión de nombre: `category_assessment.lifecycle_status = confirmed` ≠ "CRP confirmado" | No renombrar; documentar (Anexo 2) |
| N-3 | `oh_delivery`: `UNIQUE(idempotency_key, status)` impide reintentos | EXTEND con `attempt` |
| N-4 | La fórmula de progreso congelada reemplaza a MB2 §5 | Delta documental |
| N-5 | Elemento crítico := campo `blocking` ∨ decisión `blocking` | DERIVE, sin campo nuevo |
| N-6 | `LOCKED_CONTEXT` sin ruta de materialización | Sin efecto en la ola 1 |
| N-7 | El cubo "To Review" no tiene almacenamiento canónico identificado | Derivar de `new:<slug>` sin categoría asignada |
| N-8 | `premium_checkout` (registro previo al pago) | NEW |
| N-9 | Bienvenida: del código actual (en TX1, `dedupe_key` por `eventId`) a H7 | Cambio de F5 |
| N-10 | Retirar *handoff package* empujado, `handoff_ready` y la precondición `COMPLETED_LOCKED` de FA 3.0 | Cambio de F5 |
| N-11 | Tabla de analítica de Precision | NEW |
| N-12 | `person_id` solo auditoría; sin columna de correo verificado en `fa4_project` (el intercambio del enlace de un solo uso se toma como prueba de posesión) | Decisión de Core |
| N-14 | Duplicados de manifiesto (K3, K5) | Validador, F5 |
| N-15 | `billing_inbound_event` (ledger de eventos del proveedor) | NEW |
| G-C1…G-C11 | Hallazgos de manifiestos (sección C-2) | Autoría / motor |
| RLS | Recomendación: adoptar aislamiento por proyecto como defensa en profundidad (el solapamiento con las políticas existentes no se re-midió aquí) | F5 |
| R-1 | Texto libre puede contener nombres que el cliente escriba | Mitigación en E-3; sin detección determinista |
| — | T-1 (lint), `timeoutMs` y latencia de la guardia, ramas sin publicar, código de MB4 no presente en la rama revisada | Trabajo de F5 / condición de entrada |

### K-3. CONTENT / CONFIG (no bloquean si nada se hardcodea)

Activos de Cover por país · etiquetas ES aprobadas de las 17 categorías (N-13: 12 sin manifiesto) · URLs (`operation_hub_url`, `help_center_url`, `terms_url`, `privacy_url`) · copy del correo de bienvenida Premium y de los estados de espera/error · importe, moneda y plazo de Premium · validación de dominio de los 8 manifiestos y sus overlays · listas de palabras clave bilingües (G-C4) · manifiestos de la ola 2.

### K-4. PO DECISIONS REQUIRED

| ID | Pregunta | Opciones | Recomendación | Efecto si no se decide |
|---|---|---|---|---|
| **D-1** (B2) | ¿Existe camino a "listo para revisión" con requeridos pendientes? | A. No: solo 100 % (regla congelada); `completed_with_pending` sale del camino del cliente. B. Sí: se conserva `completed_with_pending` (añadiría un estado visible que el Diseño que conozco no define) | **A**: coincide con la regla congelada y con "sin estados nuevos"; las aclaraciones posteriores ocurren en OH tras el envío | Bloquea la máquina de estados del CRP |
| **D-2** (B3) | ¿Quién reabre un CRP confirmado? | A. Solo el Sherpa (requiere un canal OH→Precision que hoy no existe y está fuera de alcance). B. El cliente (nueva versión). C. En V2.0 no hay reapertura; solo lectura hasta definir el canal | **C**: respeta "confirmado = solo lectura" y la frontera Sherpa/OH; deja un punto de extensión | Bloquea la prueba CRP-07 y la API de escritura |
| D-3 | ¿Reembolso de pagos duplicados y política de revocación por reembolso/disputa? | A. Manual por Operaciones. B. Automático | **A** (y sin revocación automática: *PO POLICY REQUIRED BEFORE AUTOMATIC ENTITLEMENT REVOCATION*) | Se alerta; nada se automatiza |
| D-4 | Modo de compra y plazo de Premium | A. Pago único con plazo configurado. B. Suscripción | **A**: el contrato OH asume pagos discretos que reactivan | El adaptador aísla el modo; no bloquea |
| D-5 | Conteo de grupos repetibles | A. Un requisito por grupo (canon). B. Por ítem | **A** | Se adopta A por defecto |
| D-6 | Cuándo se marca "Cover visto" | A. Al primer render (literal). B. Al salir del Cover | **A** | Se adopta A |
| D-7 | ¿Los requisitos de documentación se muestran en la vista previa? | A. Sí, en el bloque de contexto operativo. B. No viajan | **A**: sin ellos OH pierde información de ejecución; sigue sin haber sección de documentos en el CRP | Se adopta A |
| D-8 | Visibilidad del enlace "Go to Operation Hub" | A. Tras el primer envío exitoso (producto congelado). B. Cuando OH reporta acceso (canon §F) | **A**, con el aviso "enviado, aún no accesible" ya existente | Se adopta A |

---

## L. Final Build Readiness verdict

### L-1. Estado de los contratos

| Contrato | Estado |
|---|---|
| Manifest (§C) | **Representable.** Regla de progreso congelada expresable sin campos nuevos; 11 hallazgos no bloqueantes; depende de B2 |
| FA → Precision (§B) | **Definido (v0.2).** Cierra con B5 (CR-04) |
| Stripe → Premium (§D) | **Definido.** Sin bloqueo propio; requiere D-4 y configuración externa de Stripe |
| Precision → OH (§E) | **Definido hasta el puerto.** Cierra con B4 (y D-2, D-8) |
| Analytics / Config (§F, §G) | **Definidos.** Sin bloqueo |

### L-2. Las cinco entradas (§18)

1. **Semántica de manifiestos** — técnica. 2. **FA → Precision** — técnica (B5). 3. **Stripe → Premium** — técnica. 4. **Precision → OH** — técnica (B4). 5. **Activos de Cover por país y etiquetas ES aprobadas** — **contenido/configuración, no bloquea**: nada del contrato está cableado alrededor de ellos (resolución por configuración con respaldo global).

### L-3. Veredicto

# BLOCKED — TECHNICAL INPUT REQUIRED

Cinco entradas técnicas concretas (B1–B5). Al cerrarlas, el veredicto pasa a **READY FOR F5 BUILD WITH NON-BLOCKING CONTENT DEPENDENCIES**. No se entró a F5, no se escribió código de producción y no se modificó el Diseño congelado.

---

## Anexo 1 — Evidencia consultada

**[DOC]** `precision-fa4-to-precision-contract-v0.2` · `precision-identity-continuity-contract` · `precision-operation-hub-integration-contract` (v1.2) · `precision-f1-additive-migrations-spec` · `precision-f1-prototype-sql-pack` · manifiestos F1 de la ola 1 (logística, comercio exterior, personas, corporativo/legal, fiscal, strategic_advisory, ecosystem_development, `_generic`) · `precision-f1-wave1-manifests-package` · `precision-f1-validator-tests-source` · MB1, MB2, MB3 · `precision-assessment-master-contract` · `beeside-canonical-registry` · `precision-gate-r2-closure` · `precision-gate-d-board` · `precision-gt-structural-validation` · `precision-f2-voice-review-package` · `fa4-precision-starter-package-review`.
**[CÓDIGO]** (solo lectura; `~/Developer/beeside`, rama `feat/fa4-launch-config`, HEAD `585d7d2`) `backend/src/premium/{billing-router,checkout,subscription-events,premium-service,operation-hub}.ts` · `db/schema/{subscription,fa4}.ts` · `src/fa/services/analytics.ts` · `src/fa4/routes.ts` · `src/index.ts`.
**Documentación externa:** Stripe — webhooks y cumplimiento de Checkout (`checkout.session.completed`, `async_payment_succeeded`, `async_payment_failed`, verificación de `Stripe-Signature` sobre cuerpo crudo, recuperación de la Session, idempotencia, reintentos).
**SNA:** Design Proof v3.3.

## Anexo 2 — Deltas propuestos a documentos canónicos (ninguno aplicado)

| # | Documento (escritor único) | Hoy | Cambio propuesto | Depende de |
|---|---|---|---|---|
| Δ1 | MB2 §5 | Fórmula previa de progreso | Fórmula C-1 (`floor`, requeridos ∧ aplicables ∧ confirmados) | — |
| Δ2 | M-F (`oh_delivery`) | `UNIQUE(idempotency_key, status)` | Añadir `attempt`, `UNIQUE(idempotency_key, attempt, status)` e índice único parcial de `delivered` | — |
| Δ3 | Identity/Continuity (H7) | Bienvenida tras lectura de contexto | Anotar que la ruta Stripe llega a la misma TX1; registro previo `premium_checkout`; bienvenida `welcome:{project_id}` | — |
| Δ4 | OH contract §F | `goToOperationHub = client_accessible` | `= first_send_done`; aviso "pendiente" mientras no sea accesible | D-8 |
| Δ5 | OH contract L.2 | Sin llave para requisitos operativos; sin nombre visible del proyecto | Añadir sub-llave de requisitos operativos en `project_context`; ampliar la lista de denegación a nombres de personas | D-7 |
| Δ6 | Project Manifest v2 | Bloque `pa_*` compartido pendiente; falta `total_project_headcount_estimate` | Completar | — |
| Δ7 | Manifiestos / motor | G-C1…G-C11 | Predicado de ámbito de ítem; `field_asked` vacuamente verdadero para inaplicables; reubicar `operational_pending_items`; corregir G-C2 y G-C11 | validación de dominio |
| Δ8 | Master / Registry | `completed_with_pending` en el camino del cliente; nombre `confirmed` | Retirar del camino del cliente; nota de colisión; registrar `crp_confirmation` | D-1 |
