# PRECISION V1.0 → PUBLIC READY · Checkpoint 3 — Puente de continuidad Premium, gobernado por entitlement

Fecha: 2026-10-15 · Rama `feature/precision-continuity-foundation` · Documento de seguimiento único: `precision-public-ready-evidence-pack-2026-10-15.md` (este checkpoint lo complementa).

**Veredicto.** El puente de continuidad **es real y está probado**: Discovery completado no activa nada; un entitlement válido, de **cualquier** fuente gobernada, promueve el **mismo `project_id`** a Core en la **misma transacción**, de forma idempotente, y Precision se abre solo porque Core lo dice. El andamiaje de pruebas (`h.newProject`) ya no se usa en el camino Discovery → Precision. **Estado para ESTABILIZACIÓN: LISTO por ingeniería; falta el destino** (ver §7).

## 1. Regla congelada, tal como quedó implementada

Discovery completado → resultado sellado existe → (intención de continuar: **no** es disparador) → **entitlement válido** → Core reconoce/promueve el **mismo** `project_id` → acceso a Precision → Precision consume el resultado de Discovery fijado (pin).

- **Una sola función de promoción**: `ensureCoreProjectFromDiscovery` (`backend/src/continuity/discovery-promotion.ts`). Todo productor de entitlement la llama **dentro de su propia transacción**: hoy el grant gobernado (`activateGrantForDiscoveryProject`: complementario, promoción con programa, trial, manual, partner, patrocinado); mañana el pago verificado (antes de `premium_activated`). La fuente es solo una etiqueta (`project_origin.promoted_by_source`); **no existe ruta específica de Stripe**.
- **Misma UUID**: `fa4_project.project_id` es el `project_id` permanente; no hay segundo UUID. `pg_advisory_xact_lock` por proyecto serializa promociones concurrentes; el perdedor encuentra las filas del ganador.
- **Qué se retiene**: `project_origin` (append-only, con trigger): `discovery_result_id` exacto del resultado sellado, versión del contrato (`fa4-precision-context/1`), fuente del entitlement y evidencia de identidad. La BD exige que el resultado pertenezca al proyecto, esté **entregado y sellado**.
- **Qué no se copia ni se lee**: nada del contenido mutable de Discovery ni de YEV. Del lado Discovery solo se publica `getFa4PromotionSource` (estado DELIVERED, resultado sellado, correo/nombre/idioma de identidad, si el correo se verificó por enlace). La empresa sale del **resultado sellado** vía el contrato. El evento de outbox no lleva correo, nombre ni contenido.
- **Se rechaza si**: el proyecto no está DELIVERED; el resultado no se puede leer por el contrato (Precision no podría consumirlo); el `project_id` ya existe en Core con otro origen (error duro, nunca se sobrescribe); el correo ya identifica a una Persona y no hay evidencia de que quien solicita lo controla (falla cerrado, no escribe nada).
- **Identidad (contrato congelado D1/D2)**: Persona por correo normalizado; Empresa — coincidencia **fuerte** (persona verificada ya ACTIVA en una empresa con el mismo nombre normalizado) reutiliza; **probable** (mismo nombre o dominio corporativo, sin membresía) crea empresa `PROVISIONAL` + `company_match_review`, **nunca fusiona**; si no, empresa nueva. La resolución nunca bloquea un entitlement.
- **Pin de versiones**: el proyecto promovido fija las etiquetas de referencia `fa4-public-v1` (publicadas, nunca “current”); el trigger de pin conserva el comportamiento legado intacto para todo proyecto que no sea una promoción.
- **Privilegios**: probado con el rol de runtime de mínimo privilegio (sin DELETE ni DDL); las tablas nuevas heredan los privilegios por defecto de la migración 0014.

## 2. Pruebas de aceptación (BD limpia, `continuity-bridge.int.test.ts`, 7/7)

| # | Prueba | Resultado |
|---|---|---|
| **A** | Discovery completado **sin** entitlement | El resultado existe y se lee por el contrato; **0** filas en `project`, `project_origin`, `entitlement`, `outbox_event`; entitlement = REVOKED; no se puede crear enlace/sesión; sin pin ni instancia. Una `fa4_continuation_request` registrada **no** promueve nada. |
| **B** | Completado + entitlement manual/simulado válido | Mismo `project_id` en Core (`COMPLETED_LOCKED`, pins `fa4-public-v1`); Persona + Empresa + `company_person` OWNER; `project_origin` con el `result_id` exacto y contrato `fa4-precision-context/1`; entitlement FULL; outbox `project.promoted_from_discovery` (sin PII); Precision abre y el **pin** nombra ese `result_id`. |
| **C** | Entitlement duplicado / reintentado / concurrente (6 en paralelo) | 1 proyecto, 1 origen, 1 grant, 1 entitlement, 1 evento de outbox, 1 membresía; Precision abierto 3 veces ⇒ 1 pin y 1 instancia de proyecto; una clave de idempotencia nunca devuelve el grant de otro proyecto. |
| **D** | Entitlement revocado / vencido | Revocación temprana ⇒ `READ_ONLY` (lecturas 200, escrituras `403 PRECISION_READ_ONLY`); pasada la ventana ⇒ `REVOKED` (`403 PRECISION_REVOKED`); vencimiento por fecha ⇒ `READ_ONLY`. La fila `project`, el origen, el pin, la persona y la empresa **no cambian**; un nuevo entitlement **reabre el mismo proyecto** (`created=false`, FULL). Nada se borra ni se recrea. |
| Convergencia | complementario, partner, trial, manual **y un evento de pago** (`premium_activated`) | Misma forma downstream: mismo estado de proyecto, mismas columnas de origen, mismo acceso, mismo evento. El evento de pago pasa por **la misma función**. |
| Identidad | correo existente sin verificar / verificado; empresa probable | Sin verificar ⇒ falla cerrado (`PERSON_UNVERIFIED`), 0 escrituras; con verificación del operador ⇒ se reutiliza Persona y Empresa; empresa probable ⇒ `PROVISIONAL` + revisión, la otra empresa intacta; el entitlement nunca se bloquea. |
| Seguridad | no entregado; id inexistente; id ocupado por otro origen; origen append-only | Todos rechazados; `PROJECT_ID_CONFLICT` no sobrescribe; UPDATE/DELETE de `project_origin` rechazados; inserción contra otro proyecto/resultado rechazada por la BD. |

**Caso portugués de punta a punta con el puente real** (`discovery-real.int.test.ts`, 18/18; `real-model-rehearsal`, modo guionado, PASS): Discovery real → entitlement simulado gobernado → **promoción** → Premium/Contexto → Understanding → categorías → Service Map → Preview → Operation Hub simulado, con `CoreEntitlementProvider` (el proveedor permanente) en lugar del fixture.

**Bajo el rol de runtime** (`continuity-runtime-role.int.test.ts`): 5 activaciones concurrentes ⇒ 1 promoción; origen no reescribible ni borrable; la membresía no se puede borrar.

## 3. Migración 0048 (aditiva; reversión documentada en el propio archivo)

`company.status`/`merged_into_company_id`; `company_person`; `company_match_review`; `project_origin` (+ triggers); etiquetas de referencia `fa4-public-v1` y un actor técnico inactivo que nunca puede iniciar sesión; trigger de pin consciente de la promoción; clasificación en el registro de borrado de privacidad. Probada en BD limpia y de forma incremental sobre una BD con 0000–0046 aplicadas.

## 4. Verificación de estado de migraciones por entorno

Hallazgo técnico: el migrador de drizzle aplica por **marca de tiempo del diario**, no por nombre. Una BD que aplicó la numeración antigua de Precision (0017–0039) **omitiría o desordenaría** migraciones en silencio. Se resolvió con una guarda (sin cambiar datos): `node dist/scripts/migrate.js --check` (`npm run db:migrate:check`) y el **job de migración ahora se niega a aplicar** si detecta un estado inseguro (hash ajeno, marca de tiempo distinta o migración pendiente más antigua que la última aplicada). Pruebas unitarias incluidas.

Evidencia estructural: el diario de Discovery RC (`pr6` / `feat/fa4-launch-config`, 0000–0023) es **idéntico por hash y marca de tiempo** a las primeras 24 migraciones de esta rama. Una BD en estado Discovery RC recibe 0024–0048 de forma incremental y en orden (probado sobre una BD real a 0046 → 49/49, `--check` seguro).

| Entorno | ¿Migraciones antiguas de Precision presentes? | Evidencia | Acción requerida |
|---|---|---|---|
| GCP dev, BD `beeside` (Cloud SQL `beeside-dev-canonical-db`) | **NO** (por construcción) · en vivo: **DESCONOCIDO** — no tengo credenciales GCP en esta sesión | `deploy-dev.yml` solo despliega desde `main`; `main` = `bc3f527`, 0000–0016, **sin** migraciones de Precision | Ninguna. Antes del primer despliegue: `npm run db:migrate:check` (solo lectura). Si saliera inseguro, **no tocar** y avisar: hay que decidir si hay datos que conservar. |
| GCP dev, BD `fa4_staging` (Discovery staging interno) | **NO** (por construcción) · en vivo: **DESCONOCIDO** | Se despliega desde la rama de Discovery (0000–0023), idéntica por hash+tiempo a esta rama | Ninguna: `migrate` aplica 0024–0048 incrementalmente. Mismo `--check` previo. |
| Staging (Terraform `envs/staging`) | **NO** — no existe despliegue | `deploy-staging.yml`: “blocked pending GCP setup” (`GCP_PROJECT_ID` vacío) | Aprovisionar (ver §7). Nace limpio con el orden correcto. |
| Producción (Terraform `envs/production`) | **NO** — no existe despliegue | `deploy-production.yml`: bloqueado hasta la configuración de GCP y la firma go/no-go de la Fase 15 | Aprovisionar (ver §7). Nace limpio. |
| Sandbox local de esta sesión (BD desechables, datos ficticios) | 29 de 37 tenían numeración antigua (sin Discovery 0017–0023; marcas de tiempo de Precision distintas) | `drizzle.__drizzle_migrations` vs diario actual | **Ejecutado**: eliminadas las 29 obsoletas (datos ficticios, entorno propio y desechable); quedan `dc1–dc7` y las 6 creadas hoy `br1–br6` (49/49 limpias) (prefijo idéntico, se actualizan incrementalmente; `dc1` se actualizó y verificó). |

**Regla para cualquier BD compartida con datos**: nunca recrear sin aprobación; solo `--check`. Para una BD de pruebas con datos ficticios, la acción más rápida y segura es `DROP DATABASE` + crear + migrar (segundos).

## 5. Regresión (BD limpia, rama completa)

`tsc` limpio · `eslint` limpio · unitarias 84 suites / 1.851 pruebas · integración PG 38 suites / 338 pruebas (6 suites se omiten por requerir rol de runtime o archivos IMCO; las de rol de runtime se corrieron aparte y pasan: `fa4-rc-runtime` 5/5, `fa4-verify` 29/29, `fa4-v1-delivery` 16/16, `continuity-runtime-role` 1/1) · ensayo de modelo (guionado) PASS · `drizzle-kit check` limpio. IMCO real no se re-ejecutó (no depende del cambio; los archivos no están en esta sesión).

## 6. Lo que queda explícitamente fuera (no es trabajo nuevo de producto)

- **Stripe** sigue separado. Para el sandbox faltan 4 puntos de enganche que llaman a **la misma** `ensureCoreProjectFromDiscovery` (creación del checkout para un proyecto de Discovery, comprobación “proyecto conocido” del webhook, `apply` y `apply-subscription`/reconciliación). No hay camino alterno; la prueba de convergencia con un evento de pago ya pasa por la misma función.
- Fuentes con programa (`promotion`, `sponsored`) usan la misma activación con `programId` (gobernanza existente); no se re-probó cada programa aquí.
- El correo de bienvenida y Operation Hub consumen `project.promoted_from_discovery` desde el outbox (asíncrono); sus consumidores reales pertenecen a sus frentes.

## 7. ¿Podemos pasar al despliegue dESTABILIZACIÓN?

**Ingeniería: sí.** Contrato de Discovery conectado, promoción gobernada por entitlement real, estado de migraciones seguro (y con guarda para evitar que un mal estado se aplique en silencio), regresión verde, rol de runtime probado.

**Destino: no existe todavía.** Producción y staging están definidos en Terraform pero **no aprovisionados** (los workflows se detienen en “not yet configured”). Para desplegar donde Precision vivirá definitivamente, sin una segunda migración después, necesito de ti (por canal seguro, nunca en chat/repo): proyecto GCP y región de producción, instancia Cloud SQL y usuarios (`migration` y `runtime`), secretos, dominio, y la firma de go/no-go de la Fase 15. Con eso el orden es: `db:migrate:check` → job de migración → backend con `PRECISION_API_ENABLED=true`, `PRECISION_FA_CONTEXT_PROVIDER=discovery`, `PRECISION_ENTITLEMENT_PROVIDER=core` → acceso **cerrado** (IAP/basic-auth) → validación integral → abrir la puerta.
