# PRECISION V2.0 — Borrado de datos personales durante la transición (F1 y F2)

Decisión de Mike (2026-10-17): **F1 opción A** (corregir las guardas con una migración canónica, sin incorporar Discovery al grupo de Precision) y **F2** (la anonimización debe seguir efectiva antes, durante y después del cutover, también tras un rollback hacia `discovery`). Este documento es la fuente única del diseño, del procedimiento y del impacto sobre contratos. Estado: implementado y probado **solo en local**; no se creó clon, no se tocó GCP ni producción, no se ejecutó ninguna migración productiva.

## 1. Numeración canónica

El linaje en `backend/db/migrations` terminaba en `0051_db_domain_registry_integrity` (52 migraciones, 0000–0051; el journal de drizzle coincide). Siguientes números libres: **0052** y **0053**. No se renumeró ni se modificó ninguna migración histórica (las guardas de 0016 y 0023 se **reemplazan** con `CREATE OR REPLACE` en una migración nueva, el mismo patrón que ya usan 0016→0020→0023; una prueba fija que sus textos históricos siguen intactos). El journal y los snapshots (cadena `prevId`) se extendieron; el total pasa a **54**.

| Migración | Qué hace | Qué no hace |
|---|---|---|
| `0052_privacy_guards_runtime_groups` (F1) | `fa4_result_guard` y `fa4_project_delivered_guard` niegan la bandera `fa4.erasure` a miembros directos de `beeside_runtime_role` **o** `beeside_discovery_rw` | no concede nada, no cambia membresías, no toca datos |
| `0053_privacy_erasure_tombstone` (F2) | un proyecto `ANONYMIZED` no puede volver a recibir datos personales de ningún rol: `fa4_project` (correo, respuestas, estado), `fa4_result`, `fa4_demand_signal`, `fa4_contact_request` solo admiten la forma anonimizada (`BV607`) | no borra ni modifica datos, no cambia privilegios; sus triggers se llaman `fa4_tombstone_*` para disparar **después** de las guardas existentes |

## 2. F1 — guardas de privacidad

Causa: el login de Discovery en la base canónica pertenece solo a `beeside_discovery_rw` (no al grupo de Precision, a propósito), y las guardas solo reconocían como aplicación a los miembros de `beeside_runtime_role`; un login de Discovery se trataba como operador y podía abrir la bandera de borrado para reescribir las respuestas de un proyecto **entregado**.

Corrección: el predicado de las dos guardas nombra los dos grupos de aplicación. Se mantiene la pertenencia **directa** (`pg_auth_members`), porque `pg_has_role()` sería verdadero para cualquier dueño o superusuario. Se preservan: aislamiento entre dominios (Discovery no entra al grupo de Precision; una prueba lo verifica), inmutabilidad de proyectos entregados, anonimización legítima (el migrador y `fa4_anonymize_project`, que corre como dueño y no pertenece a ningún grupo) y mínimo privilegio (ningún permiso nuevo).

## 3. F2 — la anonimización sobrevive a la transición

Problema: la sincronización inversa (beeside → discovery) no podía aplicar una anonimización sobre un proyecto entregado en legacy (falla con `BV604`), y las filas que no actualiza (contactos, tokens, resultados sellados) se quedaban con el dato personal en el lado que no ejecutó el borrado. Tras un rollback, legacy habría vuelto a servir datos de una persona que pidió su eliminación.

### 3.1 Cómo cumple los cinco requisitos

1. **Registra y preserva la evidencia.** Cada lado conserva su `fa4_privacy_erasure_log` (solo anexar). Propagar un borrado escribe una fila nueva en el lado atrasado, con la misma función `fa4_anonymize_project` ejecutada por el migrador de ese lado; la razón nombra base de origen, id del borrado original, actor y hora. La sincronización copia luego las filas del log en ambos sentidos (verificación por subconjunto: cada lado puede tener filas que el otro aún no tiene). Para un rollback de emergencia con `beeside` inalcanzable, `ERASURE_EXPORT_MANIFEST` guarda un manifiesto con solo identificadores (modo 0600, SHA-256 verificado al usarlo: un manifiesto alterado se rechaza).
2. **Impide que la sincronización restaure datos.** (a) Puerta en `domain-data-sync` sin variable para saltarla; (b) una fila ya anonimizada del destino nunca se sobrescribe; (c) el tombstone de 0053 lo impone la base aunque la herramienta fallara. Para legacy hay una protección adicional opcional (§4).
3. **Borrados antes, durante y después del cutover.** Antes y durante: se reconcilia antes de cada copia y justo antes del congelamiento. Durante una sincronización: el log del destino queda bloqueado durante su transacción y la comprobación se repite antes del COMMIT; un borrado registrado en el origen mientras corre aborta y deshace (probado, también cuando cae a mitad de la copia). Después: cada borrado en `beeside` se propaga a legacy antes del rollback; tras el rollback, un borrado en legacy se propaga antes de volver a copiar.
4. **Falla de forma segura.** La puerta se niega (código 3, nada escrito) si los lados discrepan, si no puede leer el log o la función de borrado, si el borrado no se puede aplicar (esa transacción se deshace) o si tras aplicarlo no hay convergencia. Un runtime de aplicación no puede propagar (no tiene permiso sobre la función). Un lock no obtenido en 15 s falla rápido.
5. **Legacy protegida.** Por defecto no se modifica el esquema de `discovery`: solo se ejecuta, con su propio migrador, la función de borrado que ya existe; no se escribe nada en legacy desde la sincronización sin pasar por la puerta; el endurecimiento sigue siendo opcional y reversible. Protección adicional **opcional y reversible**: aplicar 0053 a legacy durante la ventana y revertirla con `infra/db/legacy/legacy-erasure-guard-rollback.sql` (solo triggers y una función).

### 3.2 Herramientas

| Herramienta | Uso | Salidas |
|---|---|---|
| `domain-erasure-reconcile` (nueva) | dos lados (`ERASURE_SIDE_A_URL` + `ERASURE_SIDE_B_URL`) o un lado + manifiesto (`ERASURE_MANIFEST_FILE`); `DRY_RUN=yes` mide; real exige `ERASURE_RECONCILE_APPROVED=yes`; `ERASURE_EXPORT_MANIFEST=<archivo>` | 0 convergido · 2 no convergido (medición) · 3 detenido por la puerta · 1 error; imprime solo recuentos y hashes |
| `domain-data-sync` (ampliada) | igual que antes; ahora con la puerta de privacidad y `DOMAIN_SYNC_LOCK_TIMEOUT_MS` | añade el código 3 y el campo `erasure` en el informe |

### 3.3 Procedimiento en la ventana

| Momento | Paso |
|---|---|
| Antes de cada copia | `domain-erasure-reconcile` y luego `domain-data-sync` |
| Congelación de escrituras de Discovery (justo antes del cutover) | reconciliar y sincronizar `discovery → beeside`; los borrados pasan a ejecutarse solo en `beeside` |
| Después del cutover | exportar el manifiesto tras cada lote de borrados |
| Antes de un rollback | reconciliar (dos lados, o manifiesto contra legacy si `beeside` no responde) y solo entonces reabrir Discovery; el replay inverso lo exige |
| Después del rollback | un borrado en legacy se propaga con la misma herramienta antes de volver a copiar |

## 4. Pruebas (todas locales)

| Requisito de prueba | Dónde |
|---|---|
| Runtime de Discovery sin bypass | integración con el login real (`privacy-guards-canonical`, falla si se restauran las guardas antiguas); cutover C6b; ensayo S4 |
| Runtime de Precision sin bypass | cutover C6b y C5; ensayo S3/S4 (sin privilegio de escritura sobre Discovery) |
| Migrador autorizado con anonimización legítima | integración; cutover C6b, C10, C11, C14, C15 |
| Proyecto entregado protegido | integración (`BV604` aun anonimizado); cutover C6b, C11 |
| Anonimización efectiva | ensayo S4/S6b/S6c (≈20 comprobaciones nombradas); integración; cutover C10–C14 |
| Rollback sin reaparición | cutover C11, C13, C15; ensayo S6c (legacy y beeside siguen anonimizados tras replay y recopia) |
| Aislamiento Discovery / Precision | integración; cutover C14 (Precision-domain sin cambios, Discovery fuera del grupo de Precision) |
| Parada ante fallos críticos | ensayo: cualquier FAIL detiene antes de DROP (S6b y S6c con `crit_gate`); drills de defecto: guardas antiguas → HALT en S4, sin tombstone → HALT en S6c |

Resultados: jest unitario **100 suites / 2094 pruebas** (más las nuevas), `tsc` y `eslint` limpios; integración completa en base nueva de 54 migraciones **40 suites / 350 pruebas**, más las suites con rol de runtime real (`fa4-verify` 29, `fa4-rc-runtime`, `fa4-v1-delivery`, `continuity-runtime-role` con login de Precision, `discovery-stabilization-reset`, `discovery-prod-prepare`, `domain-isolation`) y la nueva `privacy-guards-canonical` (5); simulador PG16: aprovisionamiento **27/27**, cutover **150/150**, ensayo SQL **204/204**.

## 5. Impacto sobre contratos existentes

| Contrato | Impacto |
|---|---|
| `fa4-precision-context/1` | ninguno: Precision sigue leyendo Discovery por el contrato versionado y sin escribirlo; no cambia ninguna columna ni tabla de Discovery |
| `db_domain_registry` y `db_domain_apply_grants()` | ninguno: 0052 y 0053 no crean tablas (la función sigue fallando cerrada ante una tabla sin dominio); las 100 tablas y sus privilegios no cambian |
| Contrato de aislamiento de 17 puntos (`domain-roles-prepare`) | ninguno: 17/17 en aprovisionamiento y en el ensayo; sin cambio de roles, membresías ni GRANT |
| Registro de privacidad (`privacy_erasure_registry`) | ninguno |
| Códigos de error | nuevo `BV607`; `BV601`, `BV603`, `BV604`, `BV605`, `BV606` conservan su significado y su orden de disparo (una prueba de integración lo fija) |
| Linaje y verificación de migraciones | 52 → **54**; `migrate --check`, los mensajes `expected=` de `precision-stabilization.sh` y el ensayo ahora esperan 54. Un build de Discovery contra una base de 54 sigue "listo" (`aplicadas >= esperadas`) |
| Discovery (espejo) | debe espejar las mismas dos migraciones, con los mismos números, en su linaje antes de que su build deba migrar; sin ellas sigue funcionando contra una base de 54 |
| `domain-data-sync` | comportamiento nuevo y deliberado: se niega mientras haya discrepancias de borrado (antes habría copiado o fallado a mitad); informe con `erasure`; código de salida 3 |
| Knowledge Layer y sus contratos | no se tocan (ninguna tabla, función ni archivo de KL en el cambio) |
| Producción / GCP | no se tocan; nada de esto se ha aplicado fuera de la simulación local |

## 6. Estado go / no-go del ensayo real en clon

- Hallazgos F1 y F2: **resueltos en el linaje y probados localmente**; el ensayo SQL ya no necesita SQL propuesto.
- El ensayo real **sigue sin autorizarse**: faltan las tres autorizaciones (crear el clon con tope de 5 USD / 8 h, modificar y borrar solo el clon, leer `discovery-db` para el preflight) y publicar la rama de corrección (el runbook clona desde GitHub). ESTABILIZACIÓN sigue **NO-GO** (puertas GN3, GN4, GN5, GN9, GN10 abiertas).
- Qué cambia para el clon: el ensayo ahora migra a 54, incluye S6c y exige que F2 pase antes de cualquier DROP.
