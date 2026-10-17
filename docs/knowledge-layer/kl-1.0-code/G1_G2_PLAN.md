# KL 1.0 · Plan ejecutable G1–G2 (diagnóstico y preparación)

Estado: **PREPARADO; ensayo D2 EJECUTADO en instancia desechable (ya destruida); la instancia compartida NO se tocó** (ver §9). Fecha del diagnóstico: 2026-10-16. Alcance observado: proyecto `beeside-dev-508220`, región `northamerica-south1`, con la cuenta `mo@beeside.you` (roles/owner), **solo con lecturas**. No se creó ni cambió ningún recurso. No se leyó ni se mostró ningún valor de secreto; de tres secretos de cadena de conexión se extrajo únicamente el nombre del usuario de base de datos (la contraseña nunca se imprimió).
Staging y producción no existen como proyectos desplegados (los `envs/staging|production` de Terraform son andamios sin aplicar y con bucket de estado sin definir): este plan es para **dev**.

---

## 0. Resumen y limitación material

**Viabilidad.** Crear `beeside_kl` en la instancia existente es técnicamente posible, pero **hoy G1 no se puede dar por cumplido ni asegurar por diseño**. Hay una limitación material que conviene decidir antes de cualquier cambio:

1. **El principal `app` de la plataforma es `beeside_app`, y es a la vez el usuario de runtime del backend, el migrador y dueño de la base `beeside`.** Se creó con la API de Cloud SQL, así que es miembro de `cloudsqlsuperuser` (con CREATEROLE y CREATEDB). La evidencia es doble: `docs/deployment/README.md` §1 lo afirma y el job existente `fa4-staging-prepare` ya crea roles por SQL con esa credencial. El secreto `beeside-dev-database-url` que usa `beeside-dev-backend-api` conecta como `beeside_app` (verificado: solo el nombre de usuario).
   Consecuencia: el mismo proceso que recibirá `kl_app` y `kl_reader_precision` es un miembro de `cloudsqlsuperuser`. El riesgo exacto que CR-KL-002 §8.3 nombra (ADMIN de `cloudsqlsuperuser` sobre roles `kl_*`) es el que hay que descartar con evidencia real.
2. **El ensayo local de E1–E10 no cubre ese riesgo.** `privilege-rehearsal.test.ts` imita a `app` con un rol `NOSUPERUSER NOCREATEROLE`, no con un miembro de `cloudsqlsuperuser`. Su propio encabezado lo dice. Lo comprobado localmente no sustituye nada de G1.
3. **Cómo se crean los roles decide si G1 puede pasar.** CR-KL-002 §8.1 dice "usuarios de Cloud SQL". Si los cinco `kl_*` se crean por la API (Terraform `google_sql_user`), **entran a `cloudsqlsuperuser` automáticamente** (CREATEROLE/CREATEDB: contradice `roles.sql`, que los define `NOCREATEROLE NOCREATEDB`) y pueden quedar administrados por ese grupo. Deben crearse **por SQL** con un aprovisionador de un solo uso, y eliminarse sus membresías/ADMIN después (la base es PostgreSQL 16, donde CREATEROLE ya no administra roles ajenos, y eso favorece el diseño; hay que verificarlo en Cloud SQL, no suponerlo).
4. **Plano IAM compartido (ya aceptado en CR-KL-002 §12, pero conviene dimensionarlo):** quien tenga `cloudsql.users.update` (hoy solo el owner humano) puede restablecer la contraseña de `kl_owner` por la API. Ningún aislamiento a nivel de base lo evita. Además las cuatro Cloud Run Services corren con la **cuenta compute por defecto**, que ya lee `beeside-dev-database-url` y los secretos `fa4-*`; si `kl_app`/`kl_reader_precision` se le conceden, también los leerán `fa4-staging-*`.

**Recomendación.** (a) Ensayar primero el protocolo en una **instancia desechable PostgreSQL 16** (`db-f1-micro`, horas de vida, destruida al terminar) que reproduce la semántica de `cloudsqlsuperuser` sin tocar la instancia compartida. (b) Si E2/E4/E5/E8 pasan allí, ejecutar el mismo procedimiento en la instancia compartida con DB y roles vacíos y repetir E1–E10 antes de cualquier migración. (c) Si alguno falla, **no se debilita nada**: la alternativa es una instancia dedicada `beeside-dev-kl-db` (aislamiento duro: su propio `cloudsqlsuperuser`, `max_connections`, PITR y mantenimiento) o usuarios IAM de base de datos. Es decisión de Plataforma/PO (ver §7).

---

## 1. Estado real de la infraestructura (dev)

| Recurso | Hallazgo |
|---|---|
| Cloud SQL | `beeside-dev-canonical-db`, POSTGRES_16, `db-g1-small`, ZONAL, disco 10 GB, IPv4 público sin redes autorizadas, `sslMode TRUSTED_CLIENT_CERTIFICATE_REQUIRED` (solo conector/proxy), PITR activo (7 días), 7 respaldos automáticos (último 2026-10-16 09:00 UTC), sin `databaseFlags` (sin `cloudsql.iam_authentication`), `deletionProtection=false` |
| Bases | `beeside`, `fa4_staging`, `postgres`. **`fa4_staging` no está en Terraform** |
| Usuarios (todos BUILT_IN) | `beeside_app`, `fa4_staging_runtime`, `postgres`. Ningún usuario IAM |
| Cloud Run Services | `beeside-dev-backend-api`, `beeside-dev-frontend-app`, `fa4-staging-backend`, `fa4-staging-web`: todos con la **cuenta compute por defecto** |
| Cloud Run Jobs | `beeside-dev-migrate` y `fa4-staging-prepare`, ambos con `beeside-dev-migration-runner` (la SA del migrador **se comparte con FA4**) |
| Secret Manager | `beeside-dev-db-password`, `-database-url`, `-migration-database-url`, placeholders, `fa4-*`. Acceso por secreto (sin `secretAccessor` a nivel de proyecto): compute SA → `database-url`, `fa4-*`; migration-runner → `migration-database-url` y `fa4-staging-db-runtime-password`. `beeside-dev-db-password` sin enlaces |
| IAM de proyecto | `owner: mo@beeside.you`; `cloudsql.client`: compute SA y migration-runner (a nivel de proyecto, único alcance posible). Sin `editor` |
| Red | `beeside-dev-vpc` + `default`. Sin routers/Cloud NAT, sin políticas de firewall de red. El backend no usa VPC (Cloud SQL por conector `/cloudsql`) |
| Almacenamiento | Buckets: `beeside-dev-508220_cloudbuild` y el de estado de Terraform. **No hay bucket de KL** |
| APIs | Habilitadas: sqladmin, secretmanager, storage, cloudbuild. **Cloud Scheduler no está habilitado** (error `PERMISSION_DENIED` al listar) |
| Artifact Registry | repositorio `beeside-dev` (DOCKER) |
| Herramientas locales | `gcloud`, `terraform`, `cloud-sql-proxy`, `psql` presentes. **Docker/Podman no** |
| Deriva | Terraform no gestiona `fa4_*`, `beeside-dev-database-url` ni `fa4-staging-prepare`. No se ejecutó `terraform plan` (lock de estado); queda como primer paso de G2 con `-lock=false` |

## 2. Credenciales y privilegios actuales (G1.1–G1.2)

| Principal | Uso | Capaz de afectar `beeside_kl`? |
|---|---|---|
| `beeside_app` | Runtime del backend **y** migrador de `beeside`, dueño de `beeside`; miembro de `cloudsqlsuperuser` | **Sí, potencialmente** (CREATEROLE, CREATEDB). Es el principal crítico de E1–E10 |
| `postgres` | Usuario integral de Cloud SQL (también `cloudsqlsuperuser`). Su contraseña no está en Secret Manager | Sí, igual que `beeside_app`. No hay credencial disponible para probarlo (ver decisión D6) |
| `fa4_staging_runtime` | Runtime de FA4, rol creado por SQL | Probablemente no (rol de aplicación), debe probarse |
| Compute SA | Runtime de 4 servicios; `cloudsql.client` + secretos de `database-url`/`fa4-*` | No puede cambiar usuarios de BD (no tiene `cloudsql.admin`); sí abrirá conexiones |
| `beeside-dev-migration-runner` | Jobs `migrate` y `fa4-staging-prepare` | Recibe la credencial de `beeside_app` (migración) |
| `mo@beeside.you` (owner) | Humano | Puede restablecer cualquier contraseña por API y leer todo secreto (alcance IAM aceptado) |

## 3. Local vs. real

| Control | Comprobado localmente | Exige Cloud SQL real |
|---|---|---|
| E1–E10 con rol `app` simple (NOCREATEROLE) | ✅ ensayo local | — |
| E1–E10 con miembro de `cloudsqlsuperuser` | ❌ no reproducible | ✅ (G1, X23) |
| Aislamiento de esquema, funciones, atestación, `NOLOGIN`/LOGIN, límites por rol | ✅ 350 pruebas | Repetir E7/E9 y límites por rol |
| Roles creados por API vs. por SQL, ADMIN heredado de `cloudsqlsuperuser` | ❌ | ✅ |
| `max_connections` real y margen frente a plataformas | ❌ | ✅ (`SHOW max_connections`, sesiones activas) |
| Conector `/cloudsql` (socket Unix) con los pools de KL | ❌ (solo TCP) | ✅ (smoke de `kl-migrate`) |
| Respaldo/restauración (X24), X26, X27, secretos por cuenta | ❌ | ✅ (G2) |
| Imágenes `runtime` y `runtime-kl-worker`, Chromium en contenedor | ❌ (sin Docker) | ✅ builds reales |
| Cloud Scheduler, bucket con retención, GCS como `ObjectStore` | ❌ | ✅ — **y no existe todavía implementación GCS** (solo `LocalObjectStore`; en producción lanza error) |

---

## 4. G1 · Procedimiento de pruebas E1–E10 (X23)

Ejecución: desde el equipo del operador con `cloud-sql-proxy` (la instancia exige conector) y las credenciales de cada principal leídas en memoria; salida guardada en `docs/knowledge-layer/kl-1.0-code/evidence/G1/<fecha>/` (sin contraseñas). Se ejecuta **como `beeside_app`, `fa4_staging_runtime` y `postgres`** (ver D6). **Precondición:** `beeside_kl` y los cinco `kl_*` creados según §5.2 y **sin migrar**. Resultado exigido: todos fallan salvo E7 (`false`), E8 (0 filas), E9 (solo `kl_owner`).

```sql
-- E1 (conexión a la base): \c beeside_kl            → permission denied for database
-- E2  GRANT kl_owner TO CURRENT_USER;  (y kl_app, kl_reader_precision, kl_agent, kl_knowledge)  → error
-- E3  SET ROLE kl_owner;               (cada kl_*)                                               → error
-- E4  ALTER ROLE kl_app PASSWORD 'x';  ALTER ROLE kl_app LOGIN;  DROP ROLE kl_app;  (cada kl_*)   → error
-- E5  CREATE ROLE x_probe IN ROLE kl_owner;  CREATE ROLE x_probe ADMIN kl_owner;                 → error (si algo se creó: DROP ROLE x_probe y registrar FALLO)
-- E6  ALTER DATABASE beeside_kl OWNER TO CURRENT_USER;                                           → error
-- E7  SELECT r, pg_has_role(CURRENT_USER, r, 'MEMBER')
--       FROM unnest(ARRAY['kl_owner','kl_app','kl_reader_precision','kl_agent','kl_knowledge']) r; → todo false (recursivo)
-- E8  SELECT roleid::regrole, member::regrole, grantor::regrole, admin_option, inherit_option, set_option
--       FROM pg_auth_members
--      WHERE roleid::regrole::text LIKE 'kl\_%' AND (member::regrole::text IN ('cloudsqlsuperuser', CURRENT_USER) OR admin_option);
--                                                                                                 → ninguna fila
-- E9  SELECT datname, pg_get_userbyid(datdba) FROM pg_database WHERE datname='beeside_kl';
--     (conectado como kl_owner) SELECT DISTINCT pg_get_userbyid(relowner) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast');
--     más proowner, nspowner, typowner                                                           → solo kl_owner
-- E10 (como cada kl_* ): SELECT * FROM <tabla de beeside>; con la conexión a beeside            → permission denied / not authorized
--     Verificar además CONNECT de PUBLIC en beeside (decisión de Plataforma, D5)
```

**Pruebas adicionales recomendadas (no exigidas por CR-KL-002; barato y relevante):** E11 `DROP DATABASE beeside_kl`; E12 `pg_terminate_backend()` sobre sesiones `kl_*`; E13 `GRANT CONNECT ON DATABASE beeside_kl TO CURRENT_USER`; E14 que ningún `kl_*` sea miembro de `cloudsqlsuperuser` ni tenga `rolcreaterole/rolcreatedb/rolsuper` (`pg_roles`); E15 lectura de `pg_authid`/`pg_shadow` (hashes) denegada.

**Criterio de cierre G1:** evidencia de los tres principales, E1–E10 con el resultado exigido, E14 limpio y el SQL de salida archivado. Hasta entonces **G1 = NO APROBADO**.

## 5. G2 · Preparación de infraestructura

### 5.1 Cambios de Terraform a preparar (nuevo módulo `modules/kl-database`, sin tocar los existentes)
- `google_sql_database "beeside_kl"` **creada sin dueño KL aún** (la crea el aprovisionador con `OWNER kl_owner`, ver §5.2). Si Terraform la crea, el dueño inicial sería `cloudsqladmin`/API: se evita con SQL.
- **Sin** `google_sql_user` para los `kl_*` (evita la membresía automática de `cloudsqlsuperuser`). Contraseñas: `random_password` ×5 → un secreto por rol (`beeside-dev-kl-{owner,app,reader,agent,knowledge}-url`, cadena de conexión `/cloudsql`), sin datos de otras plataformas.
- Cuentas de servicio nuevas: `kl-migrate@` (solo `kl-owner-url`), `kl-worker@` (solo `kl-agent-url`, `kl-knowledge-url` + bucket KL), `kl-bootstrap@` (temporal, ver CR §5). `cloudsql.client` a nivel de proyecto (único alcance posible).
- IAM por secreto: la cuenta del backend solo `kl-app-url` y `kl-reader-url` (X26); `kl-worker` sin acceso a `beeside-*` (X27). **Depende de D3**: sin SA propia para el backend, `fa4-staging-*` también podría leerlos.
- Job `beeside-dev-kl-migrate` (imagen `runtime`, comando `node dist/kl/db/migrate-cli.js`), Cloud Run Job `beeside-dev-kl-worker` (imagen `runtime-kl-worker`, 2 GiB, `KL_RENDER_ENABLED=true`, `KL_AGENTS_ENABLED=false`), Cloud Scheduler cada 5 min (requiere habilitar `cloudscheduler.googleapis.com`).
- Bucket privado KL (originales + PDF publicados `kl/editions|previews/…`): retención, versionado, UBLA, y un segundo bucket para exportaciones de `beeside_kl`.
- `PRECISION_KNOWLEDGE_PROVIDER=off`, `KL_AGENTS_ENABLED` ausente/false en todo.
- Fuera de G2 (G3): Cloud NAT, Direct VPC egress y política de firewall; **no** se prepara tráfico externo.

### 5.2 Creación de roles y base (procedimiento por SQL, un solo uso)
1. Crear `kl_provisioner` (usuario de API, vida corta, cloudsqlsuperuser) con contraseña temporal en memoria.
2. Como `kl_provisioner`: ejecutar `db/bootstrap/roles.sql` (ya probado localmente: LOGIN, `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`, límites de conexión y tiempos por rol), luego `CREATE DATABASE beeside_kl OWNER kl_owner`, `ALTER ROLE … PASSWORD` (cada una desde Secret Manager), `REVOKE ALL ON DATABASE beeside_kl FROM PUBLIC`.
3. Retirar el rastro del aprovisionador: `REVOKE`/`DROP OWNED` de cualquier `ADMIN OPTION` que PG16 le haya dado como creador, y **eliminar `kl_provisioner`** (`gcloud sql users delete`).
4. Repetir E1–E10 (G1). Solo con G1 aprobado se ejecuta `kl-migrate` (KL-0001…0005).
5. `GRANT CONNECT` y `REVOKE … PUBLIC` dentro de `beeside_kl` los hace la migración KL-0001 (§8.2).

### 5.3 Respaldo, restauración y rollback
- **Antes de cada migración:** `gcloud sql export sql` de `beeside_kl` al bucket de exportaciones (KL no guarda datos de clientes, D19). Además, exportación diaria programada.
- **Restauración (X24):** `gcloud sql import sql` a `beeside_kl_restore` (base nueva con dueño `kl_owner`), recuento y huellas de tablas contra el origen; Precision resuelve como `unknown` lo faltante. Se prueba una vez en G2.
- **Rollback por etapa:** (i) antes de migrar: `DROP DATABASE beeside_kl` y `DROP ROLE kl_*` (vacíos, sin riesgo para otras plataformas) + borrar secretos/SA/job (Terraform destroy del módulo); (ii) después de migrar: migración correctiva o restauración de la exportación previa; (iii) PITR de instancia **no** se usa para KL salvo desastre, porque revertiría `beeside` y `fa4_staging` (impacto cruzado).
- El módulo nuevo no modifica recursos existentes; `terraform plan` debe mostrar solo adiciones.

### 5.4 Despliegue independiente de `kl-worker`
Imagen `runtime-kl-worker` (`backend/Dockerfile`, ya aprobada) → Cloud Run Job propio con SA `kl-worker@`, sin acceso a `beeside-*`, sin ingreso, `max_retries` bajo, tiempo de ejecución limitado, disparado por Cloud Scheduler. Despliegue **fuera** de `deploy-dev.yml` (que solo conoce API, frontend y `WORKER_SERVICE_NAME`): workflow/paso `kl-deploy` independiente y manual (`workflow_dispatch`), para que un merge a `main` no cambie nada de KL.

### 5.5 Builds y smoke tests reales (sin Docker local)
Opciones, de menor a mayor impacto: **(A)** job en `kl-ci.yml` (runner con Docker, sin credenciales de GCP, sin push de imagen): `docker build --target runtime` y `--target runtime-kl-worker`; smoke: API arranca y `/health` responde con KL desconfigurado (el backend se comporta como antes); worker: `node dist/kl/worker/kl-worker.js` con `KL_RENDER_ENABLED=true` genera el PDF de prueba en el contenedor, con red bloqueada, y compara contra la línea base AC-10 de **linux** (hay que añadir la clave `linux-x64-chromium-<ver>-lato`; la actual es `darwin-arm64`). Requiere **push de la rama** (D1). **(B)** Cloud Build ya habilitado (`gcloud builds submit`) hacia Artifact Registry `beeside-dev` solo con etiqueta `kl-g2-<sha>`, sin desplegar: crea artefactos en el proyecto compartido (D2).

### 5.6 Recursos y límites adicionales
- Conexiones previstas de KL: pools backend 3+3, worker 2+2, migrador 1 = **11**; topes por rol 4+8+8+4+4 = **28**. Con `max_instances=3` del backend el pico puede acercarse a 18+. `max_connections` real **sin verificar** (la documentación de Cloud SQL lo deriva de la memoria de `db-g1-small`, 1,7 GB; medirlo con `SHOW`, sumar sesiones de `beeside`, `fa4_staging`). Reducir topes si el margen es menor al 30 %.
- CPU/memoria de `db-g1-small` compartida (núcleo compartido): el planificador y la compilación pueden competir con `beeside`/FA4; se recomienda `db-custom-1-3840` si el margen es bajo (cambio de instancia compartida: decisión de Plataforma).
- Nuevos costos: Cloud Run Job (+2 GiB, 5 min), Scheduler (3 jobs gratuitos), buckets (retención), Secret Manager (5 secretos), instancia desechable de ensayo (horas). Cuantificar en la calculadora antes de aprobar; no se estimó aquí.
- Código aún faltante para G2 (se hace tras la autorización de la fase): implementación `GcsObjectStore` (dependencia `@google-cloud/storage`, a aprobar como cambio compartido), cliente de conexión por socket `/cloudsql` en los pools de KL, clave de línea base de PDF para linux.

## 6. Pasos de ejecución propuestos (cada uno con su rollback)

| # | Paso | Cambia | Rollback | Aprobación |
|---|---|---|---|---|
| 0 | `terraform plan -lock=false` del dev actual (medir deriva) y `SHOW max_connections`/sesiones por proxy en solo lectura | nada | n/a | D4 |
| 1 | Instancia desechable PG16: ensayo de §5.2 y E1–E15 | instancia temporal | `gcloud sql instances delete` | D2 |
| 2 | Decisión go/no-go según resultado de 1 (misma instancia o dedicada) | — | — | PO |
| 3 | Crear bucket(s), SA, secretos, habilitar Scheduler (Terraform módulo nuevo, `plan` solo adiciones) | proyecto dev | `terraform destroy -target` del módulo | PO |
| 4 | Aprovisionar roles + `beeside_kl` vacía (§5.2) y correr E1–E10 como los 3 principales | instancia compartida | `DROP DATABASE beeside_kl; DROP ROLE kl_*` | PO |
| 5 | G1: evidencia archivada y firmada; si falla, parar y escalar | — | paso 4 | PO |
| 6 | Exportación previa + `kl-migrate` (KL-0001…0005) | `beeside_kl` | restauración / migración correctiva | PO |
| 7 | X24 restauración, X26, X27 | `beeside_kl_restore` | `DROP DATABASE` | PO |
| 8 | `kl-bootstrap` (una vez) y retiro de sus accesos | filas KL | migración correctiva | PO |
| 9 | Builds `runtime`/`runtime-kl-worker` + smoke; despliegue del `kl-worker` con agentes **apagados** | Cloud Run Job | borrar job/Scheduler | PO |

## 7. Riesgos de impacto sobre otras plataformas

| Riesgo | Nivel | Mitigación |
|---|---|---|
| Agotar `max_connections` o CPU de la instancia compartida y degradar Discovery/Precision/FA4 | Medio | Topes por rol, medición previa, `statement_timeout`, tier |
| Mantenimiento/reinicio de instancia afecta a KL y viceversa (incluido activar `cloudsql.iam_authentication`, que reinicia) | Medio | Ventana acordada; no activar el flag sin D7 |
| Un error en el aprovisionamiento deja roles/privilegios en la instancia compartida | Alto si no se ensaya | Paso 1 (instancia desechable) y paso 4 con base vacía |
| `beeside_app` (cloudsqlsuperuser) puede escalar sobre `kl_*` | **Alto, abierto** | G1 real; si falla E2/E4/E5/E8 → instancia dedicada o IAM auth, sin debilitar |
| Compute SA compartida da acceso a `fa4-*` a credenciales de KL | Medio | SA propia del backend (D3) |
| `kl-migrate` o `kl-worker` reutilizan la SA `migration-runner` | Alto | SA nuevas, nunca la compartida |
| Deriva de Terraform (recursos `fa4_*` fuera de estado) causa un `apply` destructivo | Medio | `plan` previo, módulo nuevo aislado, sin `apply` global |
| PITR/restauración de instancia revierte otras plataformas | Medio | Respaldo lógico propio de `beeside_kl` |
| Imagen del worker (Chromium) sin validar | Medio | Paso 9 / §5.5; no declarar producción |
| Objeto de almacenamiento GCS no implementado | Bloqueante de G2 | Cambio de código a aprobar |

## 8. Decisiones y aprobaciones que necesita el PO

| ID | Decisión |
|---|---|
| D1 | Autorizar **push** de `feat/kl-1.0-code` para ejecutar los builds y smoke tests en CI (§5.5-A), sin credenciales de GCP |
| D2 | Autorizar la **instancia PG16 desechable** de ensayo (creación y destrucción) y, de preferirse, Cloud Build con etiqueta `kl-g2-*` (§5.5-B) |
| D3 | Crear una **cuenta de servicio propia** para `beeside-dev-backend-api` (hoy compute por defecto, compartida con FA4). Cambia un servicio existente |
| D4 | Autorizar lecturas de apoyo: `terraform plan -lock=false` y conexión de solo lectura por proxy (`SHOW max_connections`, `pg_stat_activity`) a `beeside_app` |
| D5 | Plataforma: revocar `CONNECT` de PUBLIC en `beeside` y `fa4_staging` (E10) |
| D6 | Cómo probar como `postgres`: restablecer temporalmente su contraseña (modifica la instancia) o aceptar la equivalencia con `beeside_app` documentada |
| D7 | Si G1 falla: instancia dedicada `beeside-dev-kl-db` **o** usuarios IAM de base de datos (requiere reiniciar la instancia compartida) |
| D8 | Aprobar el cambio compartido para `@google-cloud/storage` y el `GcsObjectStore` |
| D9 | Habilitar `cloudscheduler.googleapis.com` en dev |
| D10 | Aceptar `db-g1-small` si hay margen de conexiones, o cambiar de tier |

Sin ninguna de estas aprobaciones no se ejecuta nada. **No declaro G1 aprobado ni G2 listo.**

---

## 9. Resultado del ensayo D2 (2026-10-16)

Instancia desechable `g1-rehearsal-kl` (PG16, `db-f1-micro`, ENTERPRISE) en `beeside-dev-508220`; reproduce la semántica de usuarios por API/`cloudsqlsuperuser`. Se imitó el estado de la compartida (`beeside_app` por API, `postgres`, `fa4_staging_runtime` por SQL, bases `beeside`/`fa4_staging`) y se aprovisionó KL según §5.2 (roles por SQL con `roles.sql`, `beeside_kl` con dueño `kl_owner`, aprovisionador sin ADMIN residual). Contraseñas aleatorias en memoria, jamás impresas y borradas; la instancia fue **eliminada** y `gcloud sql instances list` solo muestra `beeside-dev-canonical-db`. Evidencia: `evidence/G1-rehearsal-2026-10-16/`. Las E se ejecutaron contra roles `kl_*` aprovisionados y una base `beeside_kl` con esquema `kl` simulado (sin las migraciones KL-0001…0005).

| Principal | E1 | E2 GRANT | E3 SET ROLE | E4 ALTER/DROP | E5 CREATE ROLE | E6 OWNER | E7 | E8 | E11 DROP DB | E12 terminar sesiones | E14 | E15 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `beeside_app` (API, `cloudsqlsuperuser`) | falla ✅ | **ÉXITO ❌** | **ÉXITO ❌** | **ÉXITO ❌** (PASSWORD, NOLOGIN) | **ÉXITO ❌** | **ÉXITO ❌** | **todo true ❌** | **5 filas ❌** | **ÉXITO ❌** | n/c | 0 ✅ | falla ✅ |
| `postgres` (`cloudsqlsuperuser`) | — | **ÉXITO ❌** | no concluyente: `SET ROLE kl_app` falló porque solo se concedió `kl_owner` (el `GRANT kl_owner TO postgres` tuvo éxito, y se revirtió) | **ÉXITO ❌** | — | — | — | — | — | **2 sesiones terminadas ❌** | — | — |
| `fa4_staging_runtime` (rol simple por SQL) | falla ✅ | falla ✅ | falla ✅ | falla ✅ | falla ✅ | falla ✅ | todo false ✅ | 0 ✅ | falla ✅ | sin efecto ✅ | 0 ✅ | falla ✅ |
| `beeside_app` **degradado** (`REVOKE cloudsqlsuperuser`, `NOCREATEROLE NOCREATEDB`) | falla ✅ | falla ✅ | falla ✅ | falla ✅ | falla ✅ | falla ✅ | todo false ✅ | 0 ✅ | falla ✅ | falla ✅ (necesita `pg_signal_backend`) | 0 ✅ | falla ✅ |

Además: E9 → solo `kl_owner` (más `pg_database_owner`, rol predefinido de PG para el esquema `public`; aceptable, documentar); E10 → los cinco `kl_*` reciben `permission denied` al leer una tabla de `beeside`; la degradación de `beeside_app` conserva su acceso a sus propias tablas y DDL. Controles: un rol creado **por la API** (`kl_provisioner`) también fue tomado por `beeside_app` (`GRANT` a sí mismo, `ALTER ROLE … PASSWORD`, `SET ROLE`), y un usuario **IAM** de base de datos (cuenta de servicio) también fue manipulado por `postgres` (`GRANT`, `SET ROLE`, `ALTER ROLE NOLOGIN`, `DROP ROLE` con éxito).

### Conclusiones
1. **G1 FALLA en el estado actual de la plataforma.** Cualquier miembro de `cloudsqlsuperuser` administra por completo todo rol no superusuario de la instancia, sea creado por API, por SQL o IAM, sin ADMIN explícito en `pg_auth_members` (E8 sí lo detecta para `beeside_app` por haberse concedido a sí mismo). Esto contradice el supuesto de CR-KL-002 §8.3 y cierra las dos vías que el addendum sugería primero: **crear los roles por SQL no basta, y la autenticación IAM tampoco** (la propia §8.3 mencionaba IAM; queda descartada como remedio *por sí sola*).
2. Los principales que hoy son `cloudsqlsuperuser`: `beeside_app` (runtime del backend **y** migrador), `postgres` y, por construcción, cualquier usuario creado por API. **El backend en ejecución corre como uno de ellos.**
3. Un principal ajeno que **no** sea `cloudsqlsuperuser` queda aislado; también `beeside_app` después de degradarlo, con E1–E15 limpios.

### Opciones (decisión del PO/Plataforma)
| | Opción | Efecto | Costo/impacto |
|---|---|---|---|
| **A** | **Instancia dedicada `beeside-dev-kl-db`** (recomendada) | Los únicos `cloudsqlsuperuser` son los de KL; aislamiento duro (también `max_connections`, PITR, mantenimiento). Ningún cambio en `beeside_app` ni en FA4 | Nueva instancia (no dimensionado aquí); contradice la decisión MVP1 "una instancia", pero es lo que CR-KL-002 §12 dejó como alternativa diferida |
| **B** | Misma instancia + **degradar** `beeside_app` a rol simple (`REVOKE cloudsqlsuperuser`, `NOCREATEROLE NOCREATEDB`) y tratar `postgres` y los usuarios de API como inertes (contraseña no registrada, restablecible solo por IAM) | G1 pasa para los principales de la plataforma; sigue siendo un ajuste a una instancia viva de otras plataformas. `fa4-staging-prepare` usa `beeside_app` para `CREATE ROLE`: se rompería. Cualquier futuro usuario creado por API volvería a romper el aislamiento | Cambio en Discovery/Precision/FA4 (modificación de entorno compartido) |
| **C** | Misma instancia sin cambios | **No permitido**: G1 no se cumple y CR-KL-002 prohíbe habilitar KL | — |

**Recomendación: A.** B es viable técnicamente (ensayado), pero deja a KL dependiendo de una disciplina operativa sobre usuarios de otras plataformas y de que nadie cree otro usuario por API en la instancia compartida. En A el procedimiento de §5.2 y E1–E15 se mantiene idéntico; solo cambia el destino y se simplifica D5/D6 (no hay otros principales: solo `postgres` de la nueva instancia, a no registrar).

### Pendientes tras el ensayo
- E12 en el principal simple se verificó con sesión activa solo para `beeside_app` degradado; para `fa4_staging_runtime` quedó sin sesión activa (resultado "sin efecto" no es concluyente, pero PostgreSQL exige `pg_signal_backend`, que ese rol no tiene).
- La prueba se hizo antes de KL-0001: repetir E1–E15 en el destino real tras la migración, porque KL-0001 concede CONNECT y define las ACL finales.
- No ensayado: conector `/cloudsql` con los pools de KL, `max_connections` real de `db-g1-small` y X24/X26/X27.

---

## 10. Opción A aprobada: módulo Terraform y costo (preparado, NO aplicado)

Decisión del PO (2026-10-16): **instancia dedicada `beeside-dev-kl-db`**. Preparado sin ejecutar: `infra/terraform/modules/kl-database`, `modules/kl-runtime`, `envs/dev-kl` (raíz propia con estado propio, prefijo `dev-kl`; no modifica `envs/dev|staging|production`) y `envs/dev-kl/RUNBOOK.md` (fases 0–6 con rollback).

**Verificado offline:** `terraform validate` OK; `terraform plan` contra un estado local vacío (en copia temporal, con solo lecturas de datos): **38 recursos a crear, 0 a cambiar, 0 a destruir** (48 con `provisioner_enabled` y `scheduler_enabled`). No se creó ni cambió nada en GCP en esta fase.

**Contenido:** instancia PG16 ENTERPRISE (`db-g1-small`, ZONAL, 10 GB, PITR + 7 respaldos, `deletion_protection=true`, TLS con certificado de cliente), sin `google_sql_user` para los `kl_*` (se crean por SQL), 5 secretos de conexión por rol (`/cloudsql`, base `beeside_kl`), aprovisionador de un solo uso conmutable, 3 cuentas de servicio nuevas (`migrate`, `worker`, `scheduler`), acceso por secreto (migrate→owner; worker→agent+knowledge; backend→app+reader), 2 buckets privados (almacén con retención de 30 días no bloqueada, exportaciones con versiones), jobs `migrate` y `worker` (agentes apagados, `PRECISION_KNOWLEDGE_PROVIDER=off`), y schedules opcionales **pausados**. Reutiliza solo hechos del proyecto (cuenta compute, cuenta de CI).

**Cambios respecto a lo supuesto antes:** D5 y D6 dejan de ser necesarias (no hay otros principales en la instancia dedicada); D3 (SA propia del backend) sigue abierta: el backend actual comparte cuenta con `fa4-*`, que podrían leer `kl_app`/`kl_reader_precision` (sin escalada de BD, pero con acceso de aplicación). D7 queda resuelta con A.

### Estimación de costo (mensual, dev, USD, orden de magnitud)
Las fuentes de precios oficiales no se pudieron consultar de forma automática (la API de facturación no está habilitada en el proyecto y no se habilitó; la página de precios no se puede extraer). Las cifras salen de un agregador público y de tarifas generales: **confirmar en la calculadora de Google Cloud antes de aprobar**.

| Concepto | Estimación | Nota |
|---|---|---|
| Instancia `db-g1-small` | ≈ 28 | Cifra de agregador para `northamerica-south1` (tabla MySQL; no verificada para PostgreSQL). Núcleo compartido |
| Disco 10 GB SSD + respaldos/PITR | ≈ 2–4 | Datos mínimos (KL no guarda datos de clientes) |
| Secret Manager (6 secretos) | < 1 | |
| Almacenamiento (2 buckets, pocos GB) | < 1 | |
| Cloud Run jobs | ≈ 0–5 | `worker` cada 5 min (288 ejecuciones/día) de pocos segundos; probablemente dentro del nivel gratuito. Chromium en 2 GiB |
| Cloud Scheduler | 0 | 3 trabajos entran en el nivel gratuito por cuenta de facturación |
| **Total** | **≈ 31–40** | Mayormente la instancia. Es costo **incremental** sobre la instancia canónica existente |

Palanca: `db-f1-micro` (variable `tier`) cuesta una fracción, pero su `max_connections` y memoria son menores; los topes de conexión de KL (28 entre los cinco roles) deben revisarse antes de usarla. Para staging/producción habrá que dimensionar aparte (`db-custom-*`, REGIONAL).

### Pendiente de aprobación antes de ejecutar (Fase 0 en adelante)
D3 (SA del backend), D8 (`GcsObjectStore` y su dependencia), D9 (habilitar Cloud Scheduler) y autorización expresa de cada fase del RUNBOOK. Los archivos de `infra/` son componentes compartidos: quedan declarados en `scripts/kl/shared-changes.txt` como **preparados, sin autorización de aplicar**.
