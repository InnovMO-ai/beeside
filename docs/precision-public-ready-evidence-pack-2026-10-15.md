# PRECISION V1.0 — PUBLIC READY · Evidence Pack (checklist único go / no-go)

Fecha: 2026-10-15 · Este es el **único** documento de seguimiento de Public Ready. Se actualiza en sitio; no hay otro tablero. Comando de estado (solo lectura, sin imprimir valores): `npm run public-ready:status`.

**Veredicto actual.** Frente 1 (Discovery → Precision) **PROBADO con salida real de Discovery** y frente 1b (puente de continuidad Premium gobernado por entitlement, mismo `project_id`) **PROBADO** (`precision-v1-public-ready-checkpoint-3-2026-10-15.md`). Los frentes 2–6 están construidos y esperan un insumo que solo tú puedes dar (credenciales, aprobación ZDR, política de retención, contenido). No hay bloqueantes internos de ingeniería. El único frente que además necesita una lectura humana tuya es el 7.

## Resumen go / no-go (en el orden de prioridad que fijaste)

| # | Frente | Estado | Insumo externo requerido | Comando / prueba | Resultado esperado | Evidencia | Bloqueante si falla |
|---|---|---|---|---|---|---|---|
| 1 | Discovery → Precision (contrato canónico `fa4-precision-context/1`) | **PROBADO** | ninguno | `npm run discovery:acceptance` (con `TEST_DATABASE_URL`) | 18/18 verdes | §1 y Anexo A | Una incompatibilidad real del contrato publicado (hoy: ninguna) |
| 1b | Puente de continuidad Premium (entitlement válido → **mismo** `project_id` promovido a Core → Precision) | **PROBADO** | ninguno (fuente simulada/manual; Stripe es solo un productor más) | `npx jest -c jest.integration.config.js --runInBand continuity-bridge` (+ `continuity-runtime-role`, `npm run db:migrate:check`) | A/B/C/D + convergencia + identidad + seguridad en verde | Checkpoint 3 | Un camino que active Precision sin entitlement, o que cree un `project_id` distinto |
| 2 | Modelo real / ZDR | Esperando insumo (ensayo en seco **PASA**) | Aprobación ZDR/privacidad por escrito + endpoint, modelo y llave (por canal seguro) | `npm run rehearsal:real-model` | 0 invariantes rotos; calidad PASS o REVIEW con transcrito | §2 | Un invariante roto con modelo real; o ZDR no aprobado |
| 3 | KSeed / KL de producción | Esperando contenido | *Doing Business in Mexico* + materiales aprobados para las 12 brechas | `onboard-country-guide.ts` / `ingest-knowledge.ts`, luego `kseed-report.ts` | Brechas cubiertas pasan de "no cubierta" a "suficiente"; cero rutas Precision-específicas | §3 | Contenido sin fuente/versión, o riesgo no revisado |
| 4 | Stripe sandbox recurrente | Listo para correrse | Llaves **de prueba** (`sk_test_`), `price_` recurrente, `whsec_`, proyecto elegible, `stripe listen` | `npm run stripe:sandbox-verify -- --i-understand-this-writes-test-data --cancel-check` | Todas las filas PASS; una sola activación; renovación mueve la fecha una vez | §4 | Cualquier fila FAIL |
| 5 | ClickUp / Operation Hub real (incl. `understanding`) | Esperando insumo | `CLICKUP_TOKEN`, workspace y space **de sandbox** | `npx tsx scripts/clickup-sandbox-verify.ts` (con `CLICKUP_SANDBOX_CONFIRM`) | Los 9 criterios PASS; 0 duplicados | §5 | Cualquier criterio FAIL |
| 6 | Retención | Latente por decisión (mecanismo construido, **sin programar**) | 2 decisiones de Legal/privacidad | dry-run de borrado en un proyecto bloqueado | Política aprobada; dry-run lista qué se borraría; nada se borra sin tu orden | §6 | Sin política aprobada el borrado se niega (diseño) |
| 7 | Recorrido humano final / evidencia de release | Construido, no probado con modelo real | Tu lectura humana de los transcritos reales (depende de 2) | `rehearsal-pt.md` + recorrido en `/precision` | Veredicto tuyo sobre los ítems REVIEW | §7 | Tu veredicto |

ICE 2026 no bloquea (se ingiere por la misma ruta cuando exista).

---

## 1. Discovery → Precision — PROBADO

**Qué se consume.** El contrato canónico publicado `fa4-precision-context/1` (`Fa4PrecisionContextV1`, mapper 1.0.0, reglas `fa4-rules/2026-10-14.1`), producido por Discovery a partir del **resultado sellado** (`fa4_result`: instantánea de fuente + instantánea de resolución + `catalog_version` + `rules_version`). Precision lo lee por la función interna publicada `getFa4PrecisionContext(db, project_id, result_id)` — **en proceso, sin HTTP, sin URL**, mediante un adaptador permanente (`Fa4DiscoveryContextReader`, puerto `FaContextReader`). Activación: `PRECISION_FA_CONTEXT_PROVIDER=discovery`.

**Lo que no se toca (garantizado por prueba de arquitectura).** Tablas mutables de Discovery, YEV/PDF, estructuras FA3, artefactos de presentación. El adaptador no lee `answers`, no re-ejecuta reglas, no usa IA.

**Pruebas (todas verdes):** reader conformance ×6, bridge conformance ×8, identidad/procedencia, continuidad sin completar, inmutabilidad, caso portugués de punta a punta.

- Misma `project_id` permanente; el pin nombra el resultado exacto, la versión del contrato, la versión del catálogo y el hash del contexto.
- Cada valor heredado conserva `sourcePinId` + `sourceItemRef` (procedencia Discovery).
- Precision **sabe** lo que Discovery sabe (no lo vuelve a preguntar) pero **no** completa Understanding: antes de que el cliente responda no existe ningún hecho del cliente; el mapa no se puede confirmar solo con Discovery.
- Un resultado sellado es único e inmutable por proyecto (índice único + append-only de Discovery). Una segunda entrega es idempotente; no se puede sellar otro; una revisión futura del mapper sobre el mismo resultado **no reescribe** el pin ni el historial de Precision.

Detalle de lo heredado / profundizado / aprendido / para el especialista y hallazgos: **Anexo A**.

## 2. Modelo real / ZDR — ensayo en UN comando

`npm run rehearsal:real-model` (requiere `TEST_DATABASE_URL`). Reproduce el caso portugués con salida real de Discovery, el Knowledge Layer real (IMCO publicado por su ruta), manifiestos/readiness/Preview reales y el OH simulado, y emite **13 veredictos sobre 11 cualidades**:

| Cualidad | Tipo | Cómo se mide |
|---|---|---|
| No repetir hechos conocidos | INVARIANTE | ningún sondeo reabre lo heredado; ninguna frase pregunta país/producto/duración |
| Comprensión semántica | CALIDAD | la narrativa produce entidad, plantilla mixta, intercompañía/financiamiento, laboral y fiscal |
| Manejo de correcciones | CALIDAD | "me equivoqué: son 80, no 60" reemplaza el valor (procedencia `client_corrected`) |
| Preguntas de proceso | INVARIANTE + CALIDAD | no escriben nada y la pregunta pendiente se retoma; se responden |
| Profundidad material | INVARIANTE | Fiscal no está "lista" sin precios de transferencia / acuerdos |
| Herencia por categoría | INVARIANTE | la categoría profundiza, no reinicia |
| Límites profesionales | CALIDAD | sin consejo ni garantía; pasa al especialista |
| Uso de KSeed/KL | INVARIANTE | respuesta con fuente y referencias trazables |
| Conocimiento ausente | INVARIANTE + CALIDAD | dice el límite, registra la demanda, **no inventa cifras** |
| Profundidad portuguesa | INVARIANTE | hechos/hallazgos/categorías llegan al especialista |
| Limpieza de Preview | INVARIANTE | sin términos internos, ids ni residuos conversacionales |

**Dos reglas del ensayo:** un INVARIANTE roto **falla la corrida** con cualquier modelo (no se debilita un invariante de Producto por el comportamiento de un modelo). Las CALIDADES: con el proveedor scripted deben pasar (define el piso determinista); con modelo real se **reportan** y tú lees el transcrito.

- **Hoy:** ensayo en seco con proveedor scripted → **PASS** (13/13). Informe: `rehearsal-pt.md` / `rehearsal-pt.json` en `REHEARSAL_OUT` (por defecto `/tmp/precision-rehearsal-pt`).
- **Con modelo real** (cuando existan insumos), en el equipo donde las variables ya estén cargadas — nunca en chat:
  `PRECISION_REHEARSAL_PROVIDER=gateway PRECISION_MODEL_PROVIDER=gateway PRECISION_UNDERSTANDING_INTERPRETER=model PRECISION_GATEWAY_PRIMARY_ENDPOINT=… PRECISION_GATEWAY_PRIMARY_MODEL=… npm run rehearsal:real-model`
- **Evidencia esperada:** `overall: PASS` o `REVIEW`; `invariants_failed: []`; latencia p50/p95 por turno; transcrito con datos sintéticos. **Propuesta para tu decisión:** umbral p95 ≤ 8 s por turno (se fija tras la primera corrida real).
- **Diagnóstico si falla:** `invariants_failed` y la columna Evidencia dicen qué y dónde; en el log del runtime, `understanding interpreter fell back to rules` cuenta las caídas al respaldo; el reporte nunca incluye credenciales ni texto del proveedor.
- **Re-ejecución / limpieza:** idempotente (proyectos nuevos con ids aleatorios; el documento IMCO sintético se retira al terminar). Usar una BD de pruebas.
- **ZDR:** `PRECISION_UNDERSTANDING_INTERPRETER=model` **permanece apagado** hasta que registres la aprobación ZDR/privacidad.

## 3. Contenido KSeed / KL de producción

Camino único: **fuente → ingesta KL → revisión de riesgo → publicación/versión/procedencia → recuperación por Precision**. No existe ruta Precision-específica.

- *Doing Business in Mexico* (no se espera para el resto): `DATABASE_URL=… npx tsx src/scripts/onboard-country-guide.ts --country MX --title "Doing business in Mexico" --language en --edition 2026 --url <https> --file <pdf>` (idempotente).
- Otras publicaciones: `npx tsx src/scripts/ingest-knowledge.ts --source <id> --title … --edition … --file … --locator <https>` (mismos bytes → "unchanged"; otros bytes → nueva versión que reemplaza).
- Estado y brechas: `npx tsx src/scripts/kseed-report.ts --out kseed-report.md --gaps-out kseed-v1-gaps.md --pack-out kseed-source-request-pack.md`.
- **Listo:** plan de 12 brechas y paquete de solicitud de fuentes (`precision-kseed-v1-gaps-2026-10-15.md`, `precision-kseed-source-request-pack-2026-10-15.md`).
- **Esperado:** cada brecha cubierta cambia de estado en el reporte; la suficiencia por intención de información (KL §8) la juzga; IMCO real: `IMCO_ICE_LIBRO/ANEXO/BOLETAS=… npm run test:integration -- imco-real` → 6/6.
- **Falla si:** falta fuente/versión/procedencia, o el riesgo no está revisado (la publicación se niega por diseño).

## 4. Stripe sandbox recurrente

- **Preparación** (equipo del PO; las variables viven en el entorno, nunca en chat/repo/logs): `DATABASE_URL` (BD sandbox migrada), `APP_BASE_URL`, `STRIPE_SECRET_KEY=sk_test_…` (las `sk_live_` se rechazan), `STRIPE_PRICE_ID` (recurrente), `STRIPE_BILLING_MODE=subscription`, `STRIPE_WEBHOOK_SECRET` (de `stripe listen --print-secret`), `STRIPE_SUCCESS_URL`, `STRIPE_CANCEL_URL`, `VERIFY_PROJECT_ID` (proyecto elegible que nunca entró a Premium). En otra terminal: `stripe listen --forward-to localhost:4242/api/billing/stripe/webhook`.
- **Comando:** `npm run stripe:sandbox-verify -- --i-understand-this-writes-test-data --cancel-check [--duplicate-payment] [--refund-check]`.
- **Evidencia esperada:** tabla de filas PASS: llave de prueba y precio recurrente activo; sesión de Checkout creada por el adaptador real; pago con tarjeta de prueba → webhook firmado activa Premium **una sola vez**; la misma conciliación no activa dos veces; cancelar al final del periodo → `CANCELLATION_SCHEDULED` con acceso intacto y reanudar → `PREMIUM_ACTIVE`. Renovación: avanzar un *test clock* un periodo y re-conciliar → fecha pagada hasta se mueve una vez.
- **Idempotencia:** el propio script re-ve el mismo pago por conciliación (segundo canal) y exige 0 activaciones nuevas; `--duplicate-payment` exige `NOT_APPLICABLE_DUPLICATE_PAYMENT` y una sola suscripción.
- **Diagnóstico si falla:** la fila FAIL trae detalle sin secretos; revisar `stripe listen` (secreto del webhook), modo de facturación, y que el proyecto sea elegible. Supuestos aún por confirmar en sandbox: `trial_end` ≥ 48 h (el adaptador usa 49 h) y `subscription_details.metadata.project_id` en eventos de factura.
- **Limpieza / re-ejecución:** todo ocurre en modo test; usar otro `VERIFY_PROJECT_ID` o una BD sandbox nueva; cancelar la suscripción de prueba en el Dashboard.

## 5. ClickUp / Operation Hub real

- **Preparación:** `CLICKUP_TOKEN` (usuario de PRUEBA), `CLICKUP_WORKSPACE_ID`, `CLICKUP_SPACE_ID` (space de sandbox), `CLICKUP_SANDBOX_CONFIRM=I_AM_USING_A_TEST_SPACE`, opcional `CLICKUP_PRODUCTION_IDS` (la corrida se niega si coincide).
- **Comando:** `cd backend && npx tsx scripts/clickup-sandbox-verify.ts` (`CLICKUP_SANDBOX_SELFTEST=1` prueba el script contra el fake local: prueba el script, **no** ClickUp).
- **Evidencia esperada:** los 9 criterios en PASS (aceptación con `acceptedAt` + versión de contrato; referencia estable; creación idempotente: 3 publicaciones simultáneas de 2 procesos → 1 tarea y 1 carpeta; búsqueda por clave y etiquetas; *checksum* idéntico y detección de alteración; reintentos/429). El bloque `understanding` viaja en el paquete y se relee íntegro. Las filas MANUAL no son prueba.
- **Idempotencia:** el criterio 3 es exactamente eso. Una segunda corrida con la misma clave devuelve la misma referencia (`replayed`).
- **Diagnóstico si falla:** código de `OhPortError` y HTTP en la fila; revisar permisos del token en el space y límites de tasa (`CLICKUP_BURST=1` provoca un 429 real; apagado por defecto).
- **Limpieza / re-ejecución:** crea una carpeta por corrida y la borra al terminar; `CLICKUP_KEEP=1` la conserva para inspección. Re-ejecutable sin residuos.

## 6. Retención — latente; lo que necesito que decidas (sin leer código)

El borrado (`privacy_erase_project`) **existe y está probado, pero no está programado ni se ejecuta solo**. Se niega por diseño si no hay política aprobada, si el proyecto no está bloqueado desde hace suficiente tiempo, o si hay una suscripción pagada vigente. Se corre primero en *dry-run*, en una sola transacción, con registro append-only y seguimientos externos (OH/ClickUp).

**Decisiones que necesito (Legal/privacidad), solo dos campos de política:**

| Campo | Qué decide | Valores | Qué pasa con cada valor |
|---|---|---|---|
| `min_days_after_block` | Cuántos días debe llevar **bloqueado** un proyecto antes de poder borrarse | entero 0–3650 | 0 = en cuanto esté bloqueado; 90 = tres meses de ventana para reclamaciones/reactivación |
| `retain_legal_acceptance` | Si la **evidencia de aceptación de términos** se conserva tras el borrado | sí / no | sí = se conserva la evidencia legal de los términos aceptados (mínimo de datos); no = también se borra |

Tres puntos que quedan **registrados, no decididos por mí** (para que los confirmes junto con la política): (1) el registro de **consentimiento de marketing** de Discovery es un libro append-only sin correo ni nombre, que se conserva como evidencia de la decisión; (2) el **evento** de producto de Discovery no contiene datos personales; (3) los datos de contacto de Discovery se anonimizan con su propio mecanismo. Cuando decidas los dos campos, se inserta la política aprobada (lo hace un administrador) y corro el *dry-run* sobre un proyecto bloqueado de pruebas.

## 7. Recorrido humano final / evidencia de release

Entregable: `rehearsal-pt.md` de la corrida real (§2) + tu recorrido en `/precision` con el caso portugués. Criterio: tú das el veredicto sobre los ítems REVIEW; ningún invariante roto. Cierra con esta checklist actualizada y el commit de release.

---

## Anexo A — Integración real con Discovery: resultado, hallazgos y desviaciones

### Caso portugués con salida REAL de Discovery (Discovery → Premium → Contexto → Understanding → categorías → Service Map → Preview → OH simulado)

- **Heredado de Discovery (con procedencia):** destino México; origen Portugal; sector; producto/servicio; objetivo; plazo ("en los próximos 6 meses"); duración (30 meses); modelo de plantilla (a través de un tercero); necesidades de catálogo: constitución y estructura, impuestos, reclutamiento, nómina y obligaciones laborales, seguros empresariales.
- **Profundizado por Precision (no estaba en Discovery):** forma de la entidad, actividad local, estructura de financiamiento, plantilla total y reparto directo/subcontratado, prestaciones, ingresos, volumen de facturas, proveedores, inventario, operaciones intercompañía; en Fiscal: registro, marco contable, reporte a la matriz, transacciones intercompañía, precios de transferencia (17 turnos de Understanding + 6 preguntas de categoría).
- **Aprendido de nuevo:** 13 datos del cliente, con procedencia `client_stated` / `client_corrected` (p. ej. el cliente corrigió "a través de un tercero" a "parte directos y parte por un tercero").
- **Quedó para el especialista:** 9 hallazgos en el paquete a OH y 14 elementos en 6 categorías; lo que el cliente respondió "todavía no lo sé" viaja como pendiente, no como hecho.

### Hallazgos de la integración (los 4 se corrigieron salvo indicación)

1. **Texto libre de Discovery aparecía como "servicio" en My Service Map** (el sector y el motivo del cliente salían como etiquetas de servicio). Solo aparece con salida real (los fixtures eran cortos). Corregido en el origen: el texto libre alimenta hechos/conceptos, **nunca** crea una necesidad; las necesidades de Discovery son las capacidades estructuradas. Prueba de regresión añadida.
2. **Un mensaje que solo contiene preguntas se leía como respuesta** ("¿Qué régimen fiscal me conviene? ¿Me garantizan…?" resolvía un conflicto pendiente y registraba un dato "Sin respuesta clara"). Lo encontró el ensayo de modelo real en el camino determinista. Corregido: un mensaje solo de preguntas es una pregunta; no escribe nada y la pregunta pendiente se retoma. Pruebas añadidas.
3. **Registro de borrado sin clasificar tres tablas de Discovery** (`fa4_contact_request`, `fa4_event`, `fa4_marketing_consent`): la guardia "una tabla nueva no puede escapar al borrado" lo detectó al unir las ramas. Migración 0047 las clasifica según el mecanismo documentado de Discovery (no cambia comportamiento ni datos).
4. **Numeración de migraciones:** Discovery desplegó 0017–0023; las de Precision (antes 0017–0039) se renumeraron 0024–0046 y sus marcas de tiempo del *journal* se ordenaron después de las de Discovery. Un entorno (de desarrollo o de pruebas) que ya aplicó la numeración antigua de Precision debe **recrearse** (Drizzle aplica por fecha, no por nombre); **antes de desplegar, confirmar que ningún entorno compartido aplicó esa numeración antigua** (no tengo visibilidad de los entornos desplegados). Una BD nueva migra limpia (48 migraciones).

### Desviaciones y brechas honestas (no son incompatibilidades del contrato de Discovery)

- **El modelo publicado de Discovery sella UN resultado por proyecto** (índice único + append-only): "un re-run que produce otro resultado del mismo proyecto" no existe en el contrato real. La lógica de reemplazo de pines de Precision se conserva como capacidad defensiva y se prueba con el lector fixture; las dos pruebas de re-ejecución de la suite con el lector real no aplican (se omiten por diseño). Un cliente que reinicia Discovery obtiene **otro** `project_id`.
- **El pin es por resultado** (`unique(project_id, source_result_id)`): si Discovery revisa su *mapper* sobre el mismo resultado, el pin existente sigue describiendo exactamente lo que Precision consumió (no se reescribe). Los proyectos nuevos fijan la versión nueva. Es el comportamiento deseado; queda registrado.
- **Prioridad:** Discovery solo expone la marca `critical`; Precision la mapea a `high` y deja el resto sin prioridad (no inventa `medium`). La prioridad del Service Map sigue saliendo de las palabras del cliente.
- **Core — CERRADO en el Checkpoint 3.** La promoción de `fa4_project` a `project` de Core con el **mismo UUID**, gobernada por entitlement (Persona/Empresa/`company_person`, idempotente, con el `result_id` exacto retenido), ya está implementada y probada; el andamio de pruebas (`h.newProject` + derecho de fixture) **ya no se usa** en el camino Discovery → Precision. Ver `precision-v1-public-ready-checkpoint-3-2026-10-15.md`.

### Regresión (BD limpia, antes de este commit)

| Comprobación | Resultado |
|---|---|
| `tsc --noEmit` / `eslint` | limpios |
| Unitarias (jest) | 83 suites · 1849 pasan · 8 omitidas (gated) |
| Integración PostgreSQL, BD nueva migrada (48 migraciones) | 38 suites · 337 pasan · 5 omitidas (gated: ensayo de modelo real ×2, runtime-role de Discovery ×3) |
| Discovery propio con rol de runtime de mínimo privilegio (`fa4-v1-delivery`, `fa4-rc-runtime`, `fa4-verify`) | PASAN (`fa4-verify` 29/29 en BD propia; las tres comparten datos *committed* y exigen BD dedicada: juntas en una misma BD una prueba de señales de demanda depende del orden) |
| IMCO real (ICE 2025: libro, anexo, boletas) | 6/6 |
| Guardia de arquitectura Discovery (sin tablas mutables, sin YEV, sin FA3) | verde |
| Registro de borrado (cada tabla clasificada) | verde tras la migración 0047 |
| `drizzle-kit check` / BD nueva | consistente / 48 aplicadas |
| Ensayo de modelo real, en seco (scripted) | PASS · 13/13 |

