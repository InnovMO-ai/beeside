# G2 · Fase 6 · `kl-bootstrap` (primer KL_ADMIN) y cableado de `KL_DB_URL_APP/READER` en el backend de dev

Estado: **PREPARADO. NADA SE HA EJECUTADO** (ni lecturas de la base principal). Base: `beeside-dev-508220`, KL-0001…0005 migradas en `beeside-dev-kl-db` (Fase 5).

## Resumen y veredicto

| Parte | ¿Se puede ejecutar hoy? |
|---|---|
| **A · kl-bootstrap** (crear el primer KL_ADMIN) | **Sí**, en cuanto el PO indique el correo de un `admin_user` ya existente y habilitado en la base principal de dev. Es una operación a nivel de base de datos: no necesita el backend desplegado. |
| **B · cableado del backend** | **No, tiene tres bloqueos materiales** (ver abajo). Si solo se agregaran `KL_DB_URL_APP/READER`, la revisión nueva **no arrancaría**. |

### Bloqueos de B (hallazgos del código y del servicio real)
1. **El Admin API/Control Center no está habilitado en dev.** `klRuntimeFromEnv` lanza `KL Admin requiere el Admin API del Control Center (ADMIN_API_ENABLED=true)` si hay variables de KL sin Admin API. El servicio `beeside-dev-backend-api` hoy no tiene `ADMIN_API_ENABLED` (variables actuales: `NODE_ENV, FA_API_ENABLED, APP_BASE_URL, ALLOWED_ORIGINS, TRUST_PROXY_HOPS, DEV_LOG_EMAIL_LINKS, SECURITY_HASH_SECRET, DATABASE_URL`). Habilitarlo exige `ADMIN_APP_ORIGIN`, `ADMIN_OIDC_ISSUER/CLIENT_ID/CLIENT_SECRET/REDIRECT_URI` y `ADMIN_SESSION_SECRET` (≥ 32 caracteres): un **proveedor de identidad que `docs/deployment/README.md` §4 declara aún sin elegir** (el único placeholder en Secret Manager es `beeside-dev-sso-client-secret`, sin valor real). Es decisión de Plataforma, no de KL. Sin Admin API nadie puede iniciar sesión para usar KL aunque el bootstrap exista.
2. **La imagen desplegada no contiene KL.** El servicio corre `backend-api:bc3f527…` (= `main`, revisión `beeside-dev-backend-api-00007-gtk`, 100 % del tráfico). La rama está 33 commits adelante y 0 atrás de `main`; fuera de KL difiere solo en 5 archivos compartidos ya aprobados (`backend/Dockerfile`, `backend/package.json`, `package-lock.json`, `backend/src/index.ts`, `backend/src/admin/kl/router.ts`). Cablear implica **desplegar en el servicio compartido de dev una imagen de la rama KL** (`kl-backend:7af37659…`, ya publicada), sin pasar por `main`.
3. **Segunda instancia de Cloud SQL.** El servicio solo monta `beeside-dev-canonical-db`; hay que añadir `beeside-dev-kl-db`.

Otros riesgos de B: ver tabla de riesgos.

---

## A · `kl-bootstrap` (decisión: ejecución por operador, no por job)

CR-KL-002 §5 describe un job dedicado `kl-bootstrap` con dos credenciales (la de `beeside` y `kl_owner`) cuyo acceso se retira al terminar. Hoy la única credencial utilizable de `beeside` es la del runtime del backend, `beeside-dev-database-url`, que es **`beeside_app`**: miembro de `cloudsqlsuperuser` y dueño de la base (hallazgo del ensayo G1). Un job necesitaría un permiso temporal sobre ese secreto **de la plataforma** (modificar su IAM) y, además, el bootstrap **escribe** `admin_audit_event`, por lo que no basta una credencial «de lectura». Por eso se prepara la **variante A1 (recomendada)**: el operador de Plataforma lo ejecuta una vez desde su equipo (`mo@beeside.you` ya puede leer ambos secretos; no se concede ni se retira ningún permiso). La variante A2 (job + permiso temporal) queda descrita como alternativa.

### Precondiciones
- `gcloud auth print-access-token` OK; `cloud-sql-proxy` y `psql` en el equipo; `npm ci` hecho.
- **El PO indica el correo del primer KL_ADMIN** y declara que corresponde a un `admin_user` con `active = true` y `login_enabled = true`, que **no** termina en `@beeside.internal`. El script lo comprueba antes de escribir; no tengo visibilidad de los `admin_user` de dev (no se consultó la base principal).
- Confirmación de que la identidad real de esa persona podrá autenticarse cuando exista el IdP (de lo contrario el KL_ADMIN existirá pero nadie podrá usarlo).

### Comandos (un solo uso)
```bash
# 1) solo lectura: elegibilidad y ausencia de otro KL_ADMIN
bash scripts/kl/g2/bootstrap-admin.sh --check persona@dominio.com
# esperado: "admin_user existe=1 activo=true login_habilitado=true" y "KL_ADMIN no revocados=0"

# 2) escritura (requiere repetir el correo como confirmación)
KL_BOOTSTRAP_CONFIRM=persona@dominio.com bash scripts/kl/g2/bootstrap-admin.sh --apply persona@dominio.com
# esperado: {"ok":true,"requestId":"…"}, "KL_ADMIN no revocados=1", "admin_audit_event kl.bootstrap_admin=1"
```
El script abre dos proxies, arma las cadenas en memoria (nunca las imprime), usa `kl_owner` para `kl.bootstrap_admin` (se niega si ya hay KL_ADMIN) y registra `admin_audit_event` (`actor_type = SYSTEM`) con el mismo `request_id`. Lo que escribe: **1 principal + 1 concesión + 1 evento de auditoría en `beeside_kl`** y **1 fila en `admin_audit_event` de la base principal de dev** (único dato que toca la plataforma; es el diseño de B4/B5). Validado hasta ahora solo en sintaxis y en la reescritura de la cadena de conexión con datos sintéticos; la lógica de `bootstrapAdmin` está cubierta por las pruebas de KL.

### Riesgos y rollback de A
| Riesgo | Mitigación / rollback |
|---|---|
| Correo equivocado → KL_ADMIN para la persona incorrecta; **un KL_ADMIN no puede revocarse a sí mismo** y el job se niega a repetirse | Antes de datos reales el reinicio es limpio: conectar como `kl_owner` por proxy, `DROP SCHEMA kl CASCADE`, ejecutar de nuevo el job de migración (KL-0001…0005) y repetir el bootstrap. La fila de `admin_audit_event` es de solo inserción y permanece (queda como rastro). Una vez haya datos reales ya no es aceptable: por eso `--check` y la confirmación doble |
| Falla entre el commit en KL y la escritura en la base principal (no son atómicas) | El job diario de correlación de auditoría lo reporta por `request_id`; el script imprime el `requestId`. Reintentar el registro manualmente solo con autorización |
| Uso de la credencial `beeside_app` (privilegiada) desde el equipo del operador | Solo SELECT en `admin_user` y un INSERT de auditoría; sin escribir a disco; sesión del operador ya autorizada. Mejora de fondo: login de bootstrap con rol mínimo (requiere crear un rol en la instancia compartida: cambio de Plataforma, no de KL) |
| El IdP no existe (bloqueo B1) | El KL_ADMIN existe pero sin acceso; no hay riesgo de seguridad, solo de utilidad |

**A2 (alternativa, no recomendada):** Terraform en `dev-kl` crea `beeside-dev-kl-bootstrap` (SA + job con `kl-owner-url` y `beeside-dev-database-url`), con un `secretAccessor` **temporal sobre el secreto de la plataforma**, y su retiro posterior; modifica el IAM de un recurso de otra plataforma.

---

## B · Cableado del backend de dev (CONDICIONADO a los tres bloqueos)

### Cuando B1–B3 estén resueltos: comandos exactos
```bash
P=beeside-dev-508220; R=northamerica-south1; SVC=beeside-dev-backend-api
FULL=7af37659a4b68285c36d8498b8ed9d7151f83115          # o el SHA vigente de la rama, ya publicado con kl-publish-dev-*
REG=$R-docker.pkg.dev/$P/beeside-dev
gcloud run services describe $SVC --region $R --project $P --format='value(status.latestReadyRevisionName)'   # guardar: hoy beeside-dev-backend-api-00007-gtk

# una sola revisión con imagen + instancia + secretos + variables
gcloud run services update $SVC --region $R --project $P \
  --image $REG/kl-backend:$FULL \
  --add-cloudsql-instances $P:$R:beeside-dev-kl-db \
  --update-secrets KL_DB_URL_APP=beeside-dev-kl-app-url:latest,KL_DB_URL_READER=beeside-dev-kl-reader-precision-url:latest \
  --update-env-vars PRECISION_KNOWLEDGE_PROVIDER=off,ADMIN_API_ENABLED=true,<variables ADMIN_* y secretos del IdP que defina Plataforma>
```
El backend se niega a arrancar si encuentra `KL_DB_URL_AGENT/KNOWLEDGE/OWNER` o `PRECISION_KNOWLEDGE_PROVIDER` distinto de `off`: no se pasa ninguno. Las cuentas ya están preparadas por Terraform: la cuenta del backend (compute por defecto) solo puede leer `kl-app-url` y `kl-reader-precision-url` (X26) y los PDF publicados `kl/editions/`.

### Verificación (solo lectura y llamadas anónimas)
- `GET /health` 200 y `/health/ready` 200.
- `GET /api/public/editions/abcdefghijklmnopqrstuvwxyz/status` → `200 {"status":"unknown"}` (montada) y sin cabeceras con detalles.
- `GET /api/admin/kl/...` sin sesión → 401/403 (nunca 200).
- Logs: arranque de `startReconciler` y de la correlación de auditoría sin errores; sin credenciales en el log.
- `SELECT usename, count(*) FROM pg_stat_activity WHERE datname='beeside_kl' GROUP BY 1` (como `kl_owner` por proxy): conexiones de `kl_app` y `kl_reader_precision` dentro de los topes.
- Tras la verificación, repetir la comprobación de miembros de `cloudsqlsuperuser` (sin cambios esperados).

### Rollback de B
```bash
gcloud run services update-traffic $SVC --region $R --project $P --to-revisions beeside-dev-backend-api-00007-gtk=100
gcloud run services update $SVC --region $R --project $P --remove-secrets KL_DB_URL_APP,KL_DB_URL_READER \
  --remove-cloudsql-instances $P:$R:beeside-dev-kl-db --remove-env-vars PRECISION_KNOWLEDGE_PROVIDER
```
Si la revisión nueva no arranca, Cloud Run **no** le envía tráfico y la revisión previa sigue sirviendo; no hay interrupción para Discovery/Precision/FA4.

### Riesgos de B
| Riesgo | Detalle / mitigación |
|---|---|
| Backend compartido: se despliega una imagen de rama | Contiene `main` + KL + 5 archivos compartidos aprobados. Cualquier cambio de plataforma posterior en `main` no está incluido. Hacer **merge a `main` no es neutro**: `DEPLOY_DEV_ENABLED=true` dispara `deploy-dev.yml` automáticamente |
| Faltan variables del IdP | La revisión no arranca (`ADMIN_API_ENABLED requires …`). Sin tráfico a la revisión nueva; rollback sin efecto |
| **Deriva de Terraform en `envs/dev`** | El módulo `cloud-run` declara el volumen de Cloud SQL con una sola instancia y no ignora `volumes`: un `terraform apply` posterior en `envs/dev` quitaría `beeside-dev-kl-db` del servicio. Propuesta (cambio compartido, requiere aprobación): variable `extra_cloudsql_instances` en el módulo y `ignore_changes` correspondiente. Hoy dev se despliega con `gcloud`, no con `apply` |
| **Topes de conexión** | Pools del backend: 3 + 3 por instancia de Cloud Run, hasta 3 instancias → 9 conexiones por rol frente a `CONNECTION LIMIT 8` de `kl_app` y de `kl_reader_precision`. Se alcanza solo con escala máxima, pero fallaría con «too many connections for role». Opciones: subir ambos topes a 12 (requiere un usuario con CREATEROLE: ventana temporal tipo Fase 4) o reducir el pool. `max_connections` real de `beeside-dev-kl-db` sin medir (`SHOW max_connections` como `kl_owner`, pendiente) |
| Bucle de fondo en el proceso compartido | `startBackground` arranca el reconciliador de identidades y la correlación de auditoría contra ambas bases desde el backend de plataforma |
| Cold start y memoria | Servicio de 512 MiB, escala a cero: la primera petición tras inactividad abre pools de ambas bases |
| Cuenta compute compartida con `fa4-*` | `fa4-staging-*` podría leer `kl_app`/`kl_reader_precision` (sin escalada en BD, pero con acceso de aplicación): decisión D3 (cuenta de servicio propia del backend), abierta |

---

## Qué necesito de ti
1. **Para A:** el correo del primer KL_ADMIN (y que existe como `admin_user` activo con login habilitado), y tu autorización expresa de `--check` y, si es elegible, de `--apply`.
2. **Para B:** una decisión de Plataforma sobre B1 (habilitar el Admin API y el IdP en dev), aprobación del despliegue de una imagen de rama en el servicio compartido (B2), la variante para B3/deriva y los topes de conexión. **No recomiendo ejecutar B hasta resolver B1**; A sí puede hacerse antes.

---

## Resultado del `--check` (2026-10-17) · BLOQUEADO, no se ejecutó `--apply`
`bash scripts/kl/g2/bootstrap-admin.sh --check contact@beeside.you` (solo lectura; cuenta `mo@beeside.you`, proyecto `beeside-dev-508220`):
- `admin_user existe=0 activo=false login_habilitado=false` → **`contact@beeside.you` no existe como `admin_user`** en la base principal de dev.
- `KL_ADMIN no revocados=0` (nadie tiene KL_ADMIN todavía).
Diagnóstico adicional (solo conteos, sin correos): `admin_user total=1, activos=1, con_login=0, elegibles=0, técnicas(@beeside.internal)=1, del dominio beeside.you=0`. **El único `admin_user` de dev es una identidad técnica `@beeside.internal` sin login; no hay ningún administrador humano aprovisionado.** El bootstrap se rechazaría (`not_found`) por diseño, y no se creó ninguna identidad ni se sustituyó el correo.

**Desbloqueo (decisión de Plataforma/PO):** aprovisionar a `contact@beeside.you` como `admin_user` de dev (`active = true`, `login_enabled = true`, rol `ADMIN`). Camino existente solo-desarrollo: `CONFIG_BOOTSTRAP_ENV=development npm run admin:provision --workspace=backend -- --development-only --email contact@beeside.you --role ADMIN` contra la base principal de dev (escribe 1 fila en `admin_user` y 1 en `admin_audit_event` en una base compartida). En producción esto lo hace un ADMIN desde el Control Center, no un script. Luego se repite `--check` y, si es satisfactorio, `--apply`. Recordatorio: sin IdP/Admin API (bloqueo B1) esa persona no podrá iniciar sesión aunque el KL_ADMIN exista.
