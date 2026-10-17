# PRECISION V2.0 — Base canónica compartida · Preparativos técnicos (roles por dominio, reinicio sin CASCADE, alineación de ESTABILIZACIÓN)

Fecha: 2026-10-17 · Decisión vigente: **Opción A** (una base PostgreSQL canónica, dominios lógicos, roles de runtime independientes, rol de migración independiente) · Estado: **preparado y probado SOLO en bases locales desechables. Nada desplegado, nada tocado en GCP, sin push, sin merge.**

Complementa `precision-shared-database-phase1-diagnosis-2026-10-17.md` (Fase 1) y `precision-continuity-source-of-truth-2026-10-16.md`.

## 1. Qué se preparó

### 1.1 Rama de Precision `feature/shared-db-domain-roles-prep` (local)

| Pieza | Función |
|---|---|
| Migración **0050** `db_domain_registry` (generada por drizzle) | Tabla de registro: cada tabla pertenece a un dominio (`DISCOVERY`, `PLATFORM`, `PRECISION`) y declara los privilegios (S/I/U/D) que el rol de Discovery puede tener. Tres CHECK: dominio válido, letras de privilegio válidas, las tablas PRECISION no conceden nada. |
| Migración **0051** `db_domain_registry_integrity` (a mano) | Crea el grupo NOLOGIN `beeside_discovery_rw`; registra las 100 tablas (14 DISCOVERY: los `fa4_*`; 1 PLATFORM: `rate_limit_counter`; el resto PRECISION); quita a `beeside_runtime_role` todo permiso de escritura sobre el registro; alta del registro en el registro de privacidad; funciones `db_domain_apply_grants()` (falla cerrado si hay tablas sin dominio o filas obsoletas) y `db_domain_close_precision_on_discovery(login)` (el "contract": se niega mientras el login de Discovery siga en `beeside_runtime_role` o no esté en `beeside_discovery_rw`). |
| `src/db/domain-isolation.ts` | `verifyDomainIsolation` (17 comprobaciones del contrato) y `bindDomainRoles` (aplica, mueve los logins, cierra y verifica). |
| `src/scripts/domain-roles-prepare.ts` | Job de despliegue (credencial de migración): idempotente, imprime solo nombres de comprobaciones; falla si algo difiere. |
| `src/__integration__/domain-isolation.int.test.ts` | 9 pruebas de aislamiento (ver §2). |
| `src/__integration__/fa4-verify.int.test.ts` | La prueba B1 acepta ambos modelos (grupo propio de Discovery en la base compartida; grupo legado en una base dedicada). |
| `infra/deploy/precision-stabilization.sh` | Alineación de ESTABILIZACIÓN (§5). |

Modelo de roles resultante: login de Discovery (`discovery_runtime`) → solo `beeside_discovery_rw` (exactamente lo que dice el registro: 14 tablas + rate limit; sin DELETE/TRUNCATE; sin acceso a ninguna tabla de Precision, ni siquiera por columna; sin EXECUTE sobre funciones SECURITY DEFINER; sin CREATE; no es dueño de nada; sin `cloudsqlsuperuser`). Login de Precision (`beeside_runtime`) → solo `beeside_runtime_role`, **de solo lectura sobre las 14 tablas de Discovery** (Precision nunca escribe `fa4_*`: la promoción lee por `fa4/precision` y `fa4/promotion-source`). Toda tabla nueva queda **cerrada para Discovery** hasta que se registre.

### 1.2 Rama de Discovery aislada `prep/discovery-shared-db-roles` (local, worktree; commit `d75ab7b` sobre `ba20f85`)

- `discovery-prod-prepare.ts`: detecta el modelo; en la base compartida mueve el login a `beeside_discovery_rw`, cierra a Precision y **verifica el contrato**; el modelo legado (24 migraciones) solo con `ALLOW_LEGACY_RUNTIME_GROUP=1`.
- `discovery-stabilization-reset.ts`: **sin TRUNCATE ni CASCADE**. Modo `RESET_MODE=plan` (solo lectura: conteos, dependientes, rechazos). Borra con `DELETE` simples en orden de claves foráneas; **se niega sin borrar nada** si alguna tabla fuera del conjunto de Discovery referencia sus filas (p. ej. `project_origin`) o si existe consentimiento de privacidad de versión real.
- `src/db/domain-isolation.ts`: copia byte a byte idéntica a la de Precision (evita conflicto en un merge futuro).
- Scripts de despliegue (`prepare-database.sh`, `reset-stabilization-data.sh`) con las variables nuevas y el modo plan.
- Pruebas nuevas y B1 adaptada.

Se verificó la rama activa de Discovery antes de tocar nada: la rama `feat/fa4-launch-config` (`ba20f85`) no se modificó; el trabajo está en una rama local nueva y en un worktree aparte, sin remoto, de modo que no puede pisar trabajo paralelo.

## 2. Pruebas ejecutadas y resultados (todo en bases locales desechables, cada suite de runtime en una base nueva)

| Verificación | Resultado |
|---|---|
| Precision: `tsc`, `eslint --max-warnings=0`, `npm run build` | 0 errores |
| Precision: unit | 90 suites · 1 901 pruebas pasan (8 omitidas) |
| Precision: integración completa en base nueva de 52 migraciones | 40 suites pasan · 350 pruebas pasan · 63 omitidas (las que requieren login de runtime) |
| Aislamiento por dominio (`domain-isolation.int.test.ts`) | 9/9: registro = privacidad; idempotencia; Discovery recibe 42501 en toda tabla de Precision; no puede borrar/truncar/crear/ejecutar el borrado de privacidad; sí hace su trabajo; Precision solo-lectura en Discovery; el contract se niega hasta mover el login; tabla nueva cerrada y `apply` se niega hasta registrarla; la verificación detecta manipulación |
| Job `domain-roles-prepare` de extremo a extremo | 17/17 comprobaciones ok |
| Runtime de Precision con login de Precision (`continuity-runtime-role`) tras el contract | 1/1 |
| Suites FA4 de runtime (verify 29, rc-runtime 5, v1-delivery 16 en Precision / 26 en Discovery) con el login propio de Discovery | todas pasan, en esquema legado (24) y compartido (52) |
| Las mismas suites FA4 con el login de Precision | fallan (26/29): **es el resultado esperado**; confirma que Precision no puede escribir Discovery |
| Discovery (rama aislada): `tsc`, `eslint`, unit | 0 errores · 24 suites / 400 pruebas |
| Discovery: prepare + reset | legado 8 pasan (3 omitidas) · compartido 9 pasan (2 omitidas) |
| Actualización en sitio 50→52 | segura (guarda ok), estructura y roles ok |
| Actualización en sitio 24→52 **con datos** (32 proyectos, 26 resultados, 64 aceptaciones, 159 eventos, 125 entidades de catálogo) | conteos idénticos antes y después; `domain-roles-prepare` 17/17; el plan de reinicio ve `project_origin` como dependiente |

Hallazgos corregidos durante las pruebas: `has_sequence_privilege` evaluado antes del filtro (se envolvió en CASE), formato de las claves de `rate_limit_counter`, la prueba legada de prepare no es válida en el esquema compartido (se acota con `TEST_SHARED_DOMAIN_SCHEMA`). Preexistentes (sin relación): `fa-core`/`fa-lifecycle` del módulo FA legado fallan en la rama de Discovery antes de cualquier cambio.

## 3. Impacto en Discovery

- **Hoy (producción): ninguno.** Nada se desplegó. La base de Discovery sigue con 24 migraciones y el grupo legado.
- **Cuando se apruebe:** el login de Discovery pierde acceso a todo lo que no sea suyo (incluidos `admin_user`, `entitlement`, Stripe, conocimiento) y gana un grupo propio con exactamente 14 tablas + rate limit. El código de Discovery **no cambia** (el test de runtime lo demuestra); cambia el job `prepare` y la herramienta de reinicio.
- **Orden obligatorio (expand → move → contract):** migrar (crea grupo y registro; no corta a nadie) → job `prepare` (mueve el login) → contract (cierra la escritura de Precision en tablas de Discovery). La función de contract lo impone a nivel de base de datos.
- **Rollback del contract:** `GRANT INSERT, UPDATE ON <tablas de Discovery> TO beeside_runtime_role;`.
- Un build de Discovery contra una base de 52 migraciones sigue "listo" (`aplicadas >= esperadas`).
- La base existente de 24 migraciones requiere `ALLOW_LEGACY_RUNTIME_GROUP=1` mientras no se una al linaje compartido; no hay forma de que el job la deje en el modelo compartido por accidente.

## 4. Confirmación de Mike: CLOSED TEST con datos de prueba, y plan de transición

Confirmado por Mike (2026-10-17): el CLOSED TEST lo usó solo el equipo interno, sin empresas ni invitados externos. Los registros actuales se consideran **datos de prueba**. Eso permite una base canónica limpia, pero **no se elimina ningún registro y no se modifica producción sin autorización**; el inventario de GCP y BD sigue siendo el insumo obligatorio (el consentimiento por versión y los dominios de correo darán la evidencia).

### 4.1 Qué se debe conservar aunque los registros sean de prueba

1. **Catálogo** `fa4_catalog_version / entity / change` (en la prueba local: 125 entidades) y su historial: es contenido del producto. Si el inventario muestra que solo existe la semilla, se regenera con el seed; si hay versiones publicadas distintas de la semilla, se exportan.
2. **Esquema y diario de migraciones** (huellas en la Fase 1, Q10).
3. **Configuración operativa de GCP:** instancia `discovery-db` (HA, PITR, retención, protección contra borrado, TLS), roles/usuarios (`discovery_migrate`, `discovery_runtime`), cuentas de servicio por rol, secretos (nombres y versiones; los valores no se exportan), jobs (`migrate`, `prepare`, `seed`), repositorio de imágenes, IP global reservada, LB/certificado/DNS de `discovery.beeside.you`, políticas de alertas y la excepción de política de organización.
4. **Ajustes del CLOSED TEST:** marcador de versión legal `CLOSED-TEST-NOT-LEGAL`, credencial/puerta de acceso y accesos de revisores, dominios permitidos (`beeside.you`).
5. **Configuración a nivel de base de datos:** flags, extensiones, grants por defecto (Q09 del inventario).
6. **Respaldos:** los automáticos (diarios ×14, PITR 7 días) más un **respaldo bajo demanda inmediatamente antes de cualquier paso con escritura en producción** y, si se decide limpiar, una exportación lógica del catálogo. Ninguno se borra.

### 4.2 Qué NO se hace todavía

No se borra ninguna fila (la herramienta de reinicio queda preparada, en modo plan, pero no se ejecuta); no se migra producción; no se cambian permisos en la base real; no se despliega.

### 4.3 Camino propuesto para la transición (cada paso requiere tu autorización)

1. Tú ejecutas el inventario (solo lectura, §6) y compartes el reporte.
2. Con el inventario: elegir estrategia de base (recomendada **B**):
   - **A. Actualización en sitio** de `discovery` 24→52 con los datos de prueba (probada con datos; conserva todo).
   - **B. Base nueva `beeside` dentro de la misma instancia**, migrada desde cero con el migrador de Precision, catálogo sembrado, roles por dominio aplicados; Discovery apunta a ella cambiando una versión del secreto; la base `discovery` actual queda **congelada e intacta** como respaldo y marcha atrás. Es limpia, reversible y no borra nada.
   - **C. Proyecto nuevo `beeside-production`**: segunda instancia HA y rehacer LB/DNS; no recomendada.
3. Respaldo bajo demanda verificado → migración → `prepare` (Discovery) → `domain-roles-prepare` → verificación → recién entonces despliegue.
4. Borrado de datos de prueba: decisión posterior y separada, con `RESET_MODE=plan` revisado por ti.

## 5. Alineación técnica de ESTABILIZACIÓN (`infra/deploy/precision-stabilization.sh`; no ejecutado)

- Nuevo paso en `prepare`: job `domain-roles-prepare` (credencial de migración) con `DISCOVERY_RUNTIME_LOGIN` y `PRECISION_RUNTIME_LOGIN`. Sin `DISCOVERY_RUNTIME_LOGIN` se **omite con aviso** (correcto solo mientras Discovery no esté conectado a la base).
- `FA4_API_ENABLED=false` en el backend de Precision (antes `true`, `FA4_ENV=staging`, `FA4_EMAIL_TRANSPORT=log`): Discovery es su propio servicio; con el contract aplicado, un API de Discovery dentro de Precision fallaría por permisos y rompería el límite del dominio.
- Mensajes de verificación `expected/applied` 50 → 52.
- Se mantienen las compuertas: `APPROVAL=STABILIZATION_DEPLOYMENT_APPROVAL`, `DRY_RUN=1`, backend privado, migrador único.
- Pendiente de decisión (§8): proyecto/instancia/nombre de base objetivo (los valores por defecto del script siguen siendo `beeside-production-canonical-db` / `beeside`).
- `docs/precision-stabilization-go-no-go-2026-10-16.md` aún menciona `applied=50` en el smoke S5: se actualizará cuando se fije la versión final de migraciones.

## 6. Inventario GCP: qué toca cada modo y procedimiento mínimo y seguro

Script v2: `discovery-inventory-readonly.sh` (SHA-256 `b64800222460887bcc4b6301eda9033d14ce601f0c9ef9dfeaa1ccb2aa228c83`).

| Modo | Clase | Qué hace |
|---|---|---|
| `PART=A` | **Solo lectura** | Únicamente `gcloud … describe/list` y `get-iam-policy`. No crea, cambia ni borra. |
| `PART=B MODE=proxy` | **Solo lectura**, con **una lectura auditada** | Lee el **valor** del secreto `discovery-db-url` (credencial de runtime) a la memoria del shell — Secret Manager registra el acceso —, abre un túnel local con Cloud SQL Auth Proxy (autorizado por IAM; no modifica redes autorizadas) y ejecuta solo `SELECT` en sesión de solo lectura. El valor no se imprime ni se escribe a disco. |
| `PART=B MODE=url` | **Solo lectura** | Mismos `SELECT` con una URL que tú aportas; no contacta GCP. |
| `PART=B MODE=job` | **CREA recursos** | Crea y borra un job temporal de Cloud Run; exige `CONFIRM_CREATE_JOB=yes`. **No usar** para este inventario. |
| `gcloud sql connect` | **Modifica producción** | Añade tu IP a las redes autorizadas. No está en el script y no debe usarse. |

**Qué puede contener `report.txt`:** direcciones de correo de personas y cuentas de servicio en la política IAM (en v2 las de personas se enmascaran con `REDACT=1`, por defecto); ID/número de proyecto y estado de facturación; correos de cuentas de servicio; **nombres** de secretos (nunca valores); nombres de repos y buckets; la IP pública del balanceador; nombres de usuarios SQL; etiquetas/imágenes de jobs y servicios; y de la BD, solo conteos, fechas, estados, versiones de consentimiento, huellas estructurales y nombres de roles. No contiene valores de secretos, contraseñas, ni correos/nombres/mensajes/respuestas/tokens de la base. `proxy.log` queda aparte del reporte.

**Procedimiento mínimo (en tu Terminal; ninguna credencial en el chat):**

1. `gcloud auth list` y `gcloud config get-value project` para confirmar la cuenta (debe ser lector del proyecto).
2. `DRY_RUN=1 bash discovery-inventory-readonly.sh` — imprime cada comando clasificado [READ] / [SECRET-READ] / [CREATE] y no ejecuta nada.
3. `PART=A bash discovery-inventory-readonly.sh` — infraestructura, 100 % lectura. Revisa `report.txt`.
4. `PART=B MODE=proxy bash discovery-inventory-readonly.sh` — datos (requiere `psql` y `cloud-sql-proxy`); si no te sientes cómodo con la lectura del secreto, usa `MODE=url` con una URL de solo lectura que prepares tú.
5. Comparte `report.txt` (o la Parte B) — está enmascarado.

## 7. Estado de repositorios

| Repositorio / rama | Estado |
|---|---|
| Remoto: `main` `bc3f527`, `feat/fa4-launch-config` `ba20f85`, rama de Precision `f86da48` | Sin cambios (se verifica con `git ls-remote` al cierre) |
| Local Precision `feature/shared-db-domain-roles-prep` | Commit local sobre `f86da48`; sin push |
| Local Discovery `prep/discovery-shared-db-roles` | Commit local `d75ab7b` sobre `ba20f85`; worktree aparte; sin push ni merge |
| Respaldo verificable | `git bundle` de ambas ramas con SHA-256, copia en Downloads |

## 8. Pendientes para ESTABILIZACIÓN

1. Resultado del inventario real y decisión de estrategia (A/B/C).
2. Fijar proyecto/instancia/nombre de base y nombres de cuentas de servicio para el despliegue compartido; redimensionar instancia y alinear retención (Discovery 14 días vs 35 previstos).
3. Reconciliación de código Discovery↔Precision (23 vs 83 commits; conflictos solo en `frontend/server/static-server.mjs` y `frontend/src/main.tsx`) antes de un pipeline único.
4. Incorporar `domain-roles-prepare` y el verificador a CI (suites de Discovery contra el esquema más reciente con su login propio).
5. Política de restauración por proyecto (una restauración PITR rebobina ambos productos).
6. Actualizar `go-no-go` (S5 = 52) y el runbook de Discovery (`ALLOW_LEGACY_RUNTIME_GROUP`, modo plan del reinicio).
7. Verificar en producción que ningún servicio de Precision quede con `allUsers` (excepción de política de organización del proyecto de Discovery).

## 9. Decisiones que requieren tu autorización

1. **Estrategia de base** (A en sitio / B base nueva `beeside` en la instancia, recomendada / C proyecto nuevo) — tras el inventario.
2. **Respaldo bajo demanda en producción** (acción de escritura en GCP) antes de cualquier paso siguiente.
3. **Publicación de las dos ramas locales** como ramas nuevas e independientes (no son ramas compartidas) para revisión; hoy están solo en local y en bundles verificados. Ningún merge.
4. **Migración y `prepare` en producción** (después de 1 y 2, en el orden de §3).
5. **Redimensionamiento/retención de la instancia.**
6. **Plan de reconciliación de código** Discovery↔Precision.
7. **Borrado de datos de prueba**: no ahora; decisión posterior con el plan de reinicio revisado.
