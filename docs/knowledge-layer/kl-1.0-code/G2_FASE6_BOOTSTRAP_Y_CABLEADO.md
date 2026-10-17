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

---

## Parte A EJECUTADA (2026-10-17) · primer KL_ADMIN = mo@beeside.you

Corrección del PO: el administrador principal es **mo@beeside.you**; `contact@beeside.you` es institucional y **no** se aprovisionó. `padmin@beeside.you` queda como posible segundo administrador, **sin aprovisionar** y sin usarse para ningún control de doble intervención (pendiente de confirmar su titular individual y su autenticación).

1. **Aprovisionamiento** en la base principal de dev con el mecanismo de desarrollo del repositorio (`admin:provision --development-only`, con `CONFIG_BOOTSTRAP_ENV=development`; en producción lo haría un ADMIN desde el Control Center): `admin_user` `67e7bb19-ea05-4ac0-bf0c-091cdb1607ff`, **rol ADMIN, `active = true`, `login_enabled = true`**; 1 evento `admin_user.provisioned` (SYSTEM, ALLOWED) en `admin_audit_event`. `admin_user` total = 2 (la identidad técnica `@beeside.internal` y esta).
2. **`--check`:** `admin_user existe=1 activo=true login_habilitado=true`; `KL_ADMIN no revocados=0`.
3. **`--apply`** (con `KL_BOOTSTRAP_CONFIRM`): `{"ok":true,"requestId":"bde136c4-cd38-44a4-82ae-bd85b523eeac"}`; `KL_ADMIN no revocados=1`.
4. **Verificación posterior (solo lectura):** en `beeside_kl`, un único principal humano (`kind = admin_user`, activo) con la concesión `KL_ADMIN` **vigente**, concedida por la cuenta de servicio `kl-bootstrap` (`…00a3`); concesiones vigentes por rol: `KL_ADMIN=1`, `SERVICE_AGENT=1`, `SERVICE_KNOWLEDGE=1`. **Auditoría correlacionada:** `kl.audit_event` (`kl.bootstrap_admin`, actor `kl-bootstrap`) y `admin_audit_event` (`kl.bootstrap_admin`, `SYSTEM`, `ALLOWED`) comparten el mismo `request_id`. El `admin_user_id` de la plataforma coincide con el `principal_id` de KL. Usuarios de `beeside-dev-kl-db` sin cambios (cinco `kl_*` + `postgres`).

**Límites que no se ocultan:**
- **La autenticación no se pudo verificar**: no existe IdP/Admin API en dev (bloqueo B1). `admin_user.auth_subject` queda sin enlazar; la identidad se enlaza en el primer inicio de sesión real. No se crearon sesiones ficticias ni se omitió ningún control.
- **Separación de funciones:** con un solo humano en KL (KL_ADMIN) no pueden ejercerse los controles que exigen una segunda persona (p. ej. «quien compone envía; otra persona con rol editorial aprueba»). Eso queda pendiente de más identidades, no de `padmin@beeside.you` hasta confirmarla.
- Un KL_ADMIN no puede revocarse a sí mismo; si hubiera que deshacer el bootstrap antes de que existan datos reales, el camino es el reinicio descrito arriba (`DROP SCHEMA kl CASCADE` y re-migrar).
- La parte B (cableado del backend) sigue **bloqueada** por B1–B3.

---

## S3 VERIFICADO (2026-10-17, 15:37 UTC) y S4 (cableado de KL) PREPARADO, NO EJECUTADO

### S3 — inicio de sesión real de mo@beeside.you (verificación solo lectura)
- `admin_user mo@beeside.you`: `ADMIN`, `active=true`, `login_enabled=true`, **`auth_subject` enlazado** (identificador de Google de 21 caracteres), `last_login_at = 2026-10-17 15:37:50 UTC`.
- `admin_session`: 1 fila, creada 15:37:50, **vigente hasta 23:37:50 UTC (8 h)**, usuario `mo@beeside.you`, rol `ADMIN`.
- Auditoría: `admin.login · ALLOWED · ADMIN_USER → admin_session · {"role":"ADMIN"}` a las 15:37:50.865 (antes, las 3 filas `DENIED` del fallo original y de mis pruebas de reproducción). La identidad técnica `@beeside.internal` no cambió (sin login). **S3 cumplido; sin sesiones ficticias.**

### Pantalla en blanco al navegar (reportada por el titular)
Los registros del frontend y del backend muestran, tras el login, solo respuestas **200**: `/api/admin/me` (15:37:51), `config/current` y `config/question-bank/versions` (15:38:10–11), `communications/templates` (15:38:17–18) y `analytics/funnel` (15:38:26); después no hay más peticiones. **No hay un solo 4xx/5xx del servidor**, así que el problema está en el navegador: el Control Center (código de la plataforma en `main`) **no tiene un error boundary de React**, de modo que una excepción de render en cualquier vista deja la página en blanco. No lo introducen ni el parche de la cookie (solo afecta al inicio de sesión) ni KL (inerte). Recuperación: recargar `…/admin`; la sesión sigue vigente hasta las 23:37 UTC y volverá a pedir `/api/admin/me`. Si reaparece, abrir Herramientas de desarrollo → Consola y enviar **solo el primer error en rojo** (texto, sin cookies). No se modificó el frontend.

### S4 — cableado de KL en `beeside-dev-backend-api` (script: `scripts/kl/g2/s4-wire-backend.sh`)
Los bloqueos B1 (Admin API/IdP) y B2 (imagen con KL) **ya están resueltos**: el servicio corre `kl-backend:8f82c58…` (revisión `00009-cm2`) con el Admin API activo. Queda B3 (adjuntar `beeside-dev-kl-db`) y las variables de KL.
- **Plan (probado, solo lectura):** imagen `kl-backend` ✔; `ADMIN_API_ENABLED` definido ✔; sin `KL_DB_URL_*` ni variables prohibidas ✔; la cuenta del backend puede leer `beeside-dev-kl-app-url` y `beeside-dev-kl-reader-precision-url` y ambos tienen versión habilitada ✔; `beeside-dev-kl-db` RUNNABLE ✔; revisión de rollback `beeside-dev-backend-api-00009-cm2`.
- **Comando:** `S4_CONFIRM=yes bash scripts/kl/g2/s4-wire-backend.sh apply` → una revisión nueva con `--add-cloudsql-instances …:beeside-dev-kl-db`, `KL_DB_URL_APP` y `KL_DB_URL_READER` por referencia a Secret Manager y `PRECISION_KNOWLEDGE_PROVIDER=off`. Verifica (por el origen del navegador): `/health` y `/health/ready` 200; `/api/admin/me` y `/api/admin/kl/me` sin sesión **401**; `/api/public/editions/<id>/status` → `{"status":"unknown"}` con `Cache-Control: no-store`; el login sigue redirigiendo a Google. **Si algo falla: rollback automático** a `00009-cm2`.
- **Comprobación autenticada (la hace el titular):** abrir `https://beeside-dev-frontend-app-amwsj4v5uq-pv.a.run.app/api/admin/kl/me` con la sesión abierta; esperado `{"email":"mo@beeside.you","platformRole":"ADMIN","klRoles":[{"role":"KL_ADMIN",…}]}`. Después KL verifica en solo lectura las conexiones de `kl_app` / `kl_reader_precision` y la correlación de auditoría.

#### Capacidad (medida en solo lectura en `beeside-dev-kl-db`)
`max_connections = 50` (3 reservadas), 3 sesiones activas ahora; topes por rol: `kl_owner=4, kl_app=8, kl_reader_precision=8, kl_agent=4, kl_knowledge=4` (suma 28). Los pools del backend son 3 + 3 por instancia y el servicio escala hasta 3 instancias → **9 conexiones por rol frente a un tope de 8** en el peor caso. Opción recomendada **W0** (antes de S4): subir `kl_app` y `kl_reader_precision` a **12** (suma 36 ≤ 47 disponibles) con una ventana corta de un usuario de API temporal, igual que en la Fase 4, y reflejar los topes en `roles.sql`. Si se decide no hacerlo, el riesgo solo aparece a escala máxima (errores «too many connections for role» en KL, no en la plataforma).

#### Limitación importante: los procesos de fondo de KL en el backend
`startBackground` arranca el **reconciliador de identidades (cada 5 min)** y la **correlación de auditoría (cada 24 h)** con `setInterval` dentro del proceso del backend. El servicio tiene `minScale=0` y CPU asignada solo durante las peticiones: con escala a cero esos procesos **no corren de forma fiable** (la instancia se apaga y el CPU se estrangula entre peticiones). Para que funcionen se necesita al menos una instancia con CPU siempre asignada (cambio de configuración y coste del servicio compartido: decisión de Plataforma) o moverlos a un job programado (otro diseño). No impide el cableado ni las lecturas/escrituras de KL Admin, pero la **desactivación de identidades por reconciliación y el informe diario de correlación (X30) no se darían por cumplidos en dev** hasta resolverlo.

#### Riesgos y rollback de S4
Una revisión nueva del servicio compartido (rollback inmediato a `00009-cm2`); si la revisión no arranca no recibe tráfico; deriva de Terraform en `envs/dev` (el módulo `cloud-run` no ignora el volumen de Cloud SQL: un `terraform apply` posterior quitaría `beeside-dev-kl-db`; hoy dev se despliega con `gcloud`); la cuenta compute compartida con `fa4-*` podría leer `kl_app`/`kl_reader_precision` (D3 abierta). Retirar el cableado: `gcloud run services update beeside-dev-backend-api --remove-secrets KL_DB_URL_APP,KL_DB_URL_READER --remove-env-vars PRECISION_KNOWLEDGE_PROVIDER --remove-cloudsql-instances <instancia KL>`.

**Qué necesito:** tu autorización expresa de S4 (y de W0 si lo quieres), y una decisión sobre la limitación de los procesos de fondo.
