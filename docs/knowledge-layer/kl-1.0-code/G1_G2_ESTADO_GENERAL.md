# KL 1.0 · Estado general G1–G2 (corte 2026-10-17, ~18:10 UTC; X24 incorporada)

Rama `feat/kl-1.0-code` @ `26d7844` (= `origin`, `kl-ci` y `kl-preflight` verdes; 137 commits sobre `main`; 8 archivos compartidos fuera de KL, todos declarados). Entorno: **solo dev** (`beeside-dev-508220`). Staging y producción no existen para KL.

## 1. Veredicto por puerta (CR-KL-002 §5)
| Puerta | Estado | Fundamento |
|---|---|---|
| **G1 · sin escalada de privilegios hacia `beeside_kl`** | **CUMPLIDA para KL-0001…0005** (aprobada condicionada por el PO; condiciones cumplidas) | En la instancia compartida el protocolo **falló** (cualquier `cloudsqlsuperuser` administra todos los roles). Con la **instancia dedicada** `beeside-dev-kl-db`: E1–E15 limpios antes y después de migrar (35 intentos de escalada, todos fallan; E7 todo `false`; E8 = 0; E9 solo `kl_owner`; E14 = 0). Evidencia en `evidence/G1-*`. Control continuo: **ningún usuario creado por API** en esa instancia (hoy solo `postgres` sin contraseña y roles internos) |
| **G2 · infraestructura** | **CUMPLIDA (con desviaciones declaradas); queda verificar la primera exportación programada (18-oct 08:30 UTC)** | Hecho: base, roles (por SQL, no por Terraform: desviación declarada), secretos y jobs por Terraform (`dev-kl`, 45 recursos, sin deriva), migración aplicada (10/10 con huellas), exportación previa y **programada probada una vez**, plan de reversión. **X24 ejecutada (17-oct): restauración en `beeside_kl_restore` con comparación de 121 elementos — idéntica salvo una restricción equivalente por normalización de paréntesis** (ver `G2_FASE7_WORKER_Y_PRUEBAS.md`). Desviaciones: roles por SQL en lugar de Terraform e instancia dedicada |
| G3 · control de salida a red | **No iniciada** (fuera de alcance: sin agentes ni tráfico externo) | `kl-worker` sin firewall ni NAT; agentes apagados por base y por configuración |
| G4 | No iniciada | — |

## 2. Qué existe hoy (verificado en esta fecha)
- **Datos:** `beeside-dev-kl-db` (PG16, `db-g1-small`, ZONAL, PITR, TLS con certificado de cliente; `max_connections` 50), base `beeside_kl` con KL-0001…0005 (51 tablas, 28 vistas, 116 funciones), `kl.agents_enabled=false`, 0 datos de clientes. Roles `kl_*` sin privilegios especiales; topes `kl_app`/`kl_reader_precision` = 12. Instancia canónica **sin cambios** (`beeside_app`, `fa4_staging_runtime`, `postgres`).
- **Cómputo:** jobs `beeside-dev-kl-migrate` y `beeside-dev-kl-worker` (imágenes `835d2a2…`, publicadas por etiqueta tras 19 controles de humo, render idéntico contenedor↔host); **worker programado cada 5 min** y **exportación diaria 08:30 UTC** (ambos `ENABLED`, en `us-south1` porque Scheduler no existe en Querétaro). Servicio `beeside-dev-backend-api` revisión `00010`: imagen `kl-backend`, **Admin API (Control Center) habilitado con Google** y **KL cableado** (`KL_DB_URL_APP/READER`, proveedor de Precision `off`).
- **Identidad:** `mo@beeside.you` = `admin_user` ADMIN con `auth_subject` enlazado, **primer KL_ADMIN**, acceso real verificado (`/api/admin/kl/me` 200 + auditoría `kl.me.read`).
- **Seguridad de credenciales:** X27 **probada** (la identidad del worker recibe 403 en los secretos de plataforma y de otros roles); X26 **por política** (sin prueba empírica).
- **Calidad:** KL 351/351, backend 402, línea base AC-10 en macOS y Linux (contenido idéntico, Δ ≤ 0,11 pt), `terraform validate/plan` limpios.

## 3. Desviaciones del diseño aprobado — FORMALIZADAS en CR-KL-003 (aprobado por el PO el 17-oct-2026)
> `docs/knowledge-layer/kl-1.0-addenda/CR-KL-003/` (v1.0; reglas C1–C6, anexo AI-1…AI-3 y recomendación a Plataforma). Huella de su `MANIFEST.sha256`: `9e8b2d3693ee5875d463156203d6fd93ff94f543a198376e8c97ded49b34070a`. **No fijado en el preflight** por decisión del PO; CR-KL-002 y los archivos de guarda intactos. Lo siguiente es el texto previo a la aprobación (referencia histórica):
1. **Instancia dedicada** en lugar de la compartida (CR-KL-002 B7/§10/§12 decía «misma instancia; separada diferida»). Decisión del PO (opción A) justificada con evidencia; el CR-KL-002 es inmutable, por lo que debería registrarse como un **addendum nuevo** (p. ej. CR-KL-003), no editando el existente.
2. Roles `kl_*` creados **por SQL** con un aprovisionador de un solo uso (no `google_sql_user`, que los haría `cloudsqlsuperuser`); la IAM de base de datos **no** resuelve el riesgo (probado).
3. Cloud Scheduler en `us-south1`; almacén de desarrollo local en el worker (**sin adaptador GCS**).
4. El backend compartido de dev ahora **despliega una imagen de rama** (`kl-backend`: `main` + KL + 8 archivos compartidos aprobados + 2 correcciones de la plataforma).

## 4. Cambios en componentes compartidos (todos con aprobación expresa del PO)
`backend/Dockerfile` (etapas + base fijada por digest), `backend/package.json` y `package-lock.json` (`playwright-core` fijada), `backend/src/index.ts` (montaje de KL y ruta pública), `backend/src/admin/kl/router.ts` (API de KL Admin), y la **excepción de S3**: `admin-session.ts`, `admin-router.ts`, `admin-cookies.test.ts` (cookie de estado de login `SameSite=Lax`). En GCP: Artifact Registry (imágenes `kl-*`), 2 secretos nuevos/uno poblado (`beeside-dev-admin-session-secret`, `beeside-dev-sso-client-secret`) con `secretAccessor` para la cuenta compute, API de Scheduler y rol `klExportOnlyDev`, cliente OAuth de Google, y las revisiones `00008–00010` del backend. **`kl-preflight` marca 13 elementos «REVISAR»** (declarados y aprobados; solo informativos).

## 5. Pendientes reales
**A · Cierre de G2**
1. ~~X24 restauración~~ **HECHA** (17-oct, 18:05 UTC).
2. **Primera exportación programada:** 18-oct 08:30 UTC; verificar objeto/versión y que la operación la emite `beeside-dev-kl-scheduler@…`. Si falla: pausar y reportar.

**B · Riesgos abiertos del entorno actual (no bloquean G2, sí la fiabilidad)**
3. **Procesos de fondo de KL en el backend** (reconciliador de identidades cada 5 min, correlación de auditoría diaria — X30) **no son fiables**: el servicio escala a cero y estrangula CPU. Requiere instancia mínima con CPU siempre asignada (decisión de Plataforma/coste) o moverlos a un job.
4. **Sin alertas:** una racha de fallos del worker o de la exportación solo se vería en los registros.
5. **Adaptador GCS (D8):** el worker en producción se niega a renderizar; en dev el almacén local es efímero → **no se pueden publicar ediciones** todavía.
6. **Cuenta compute compartida con `fa4-*` (D3):** podrían leer `kl_app`/`kl_reader_precision` y los secretos del Control Center. Cuenta de servicio propia del backend, no hecha.
7. **X26 sin prueba empírica** (sin TokenCreator; decisión del PO si se hace con una sonda como cuenta compute).
8. **Separación de funciones no ejercitable:** hay un solo humano (KL_ADMIN); `padmin@beeside.you` sigue sin aprovisionar hasta confirmar titular y autenticación.
9. **Node 20 fuera de soporte** (base fijada por digest): migrar a Node 22 LTS en un cambio aparte.
10. **AC-13** (accesibilidad del PDF): revisión manual con lector de pantalla pendiente; no hay validador PDF/UA.

**C · Defectos de la plataforma hallados (no de KL), con propuesta lista**
11. Cookie de estado de login `SameSite=Strict` (ya corregida solo en la rama KL y desplegada en dev) → **llevar a `main`**: parche en `docs/…/patches/admin-login-cookie-samesite-lax.patch`.
12. Analytics en blanco al cambiar de pestaña: rama local `fix/admin-analytics-tab-switch-blank-screen` (1 commit sobre `main`, 105/105), **no subida**.
13. `SECURITY_HASH_SECRET` como variable literal en el servicio; `beeside_app` (runtime = migrador = `cloudsqlsuperuser`) con avisos de privilegios; el Control Center sin *error boundary*.

**D · Fuera de G1–G2 pero necesario para la integración**
14. **Fusión a `main`:** `DEPLOY_DEV_ENABLED=true` → un merge dispara `deploy-dev.yml` (reconstruye backend y frontend); decisión explícita y coordinada con Plataforma.
15. Staging/producción para KL (Terraform y proyectos; `envs/staging|production` son andamios sin aplicar), G3 (salida a red) antes de cualquier agente, integración con Precision (`PRECISION_KNOWLEDGE_PROVIDER=off`), UI de KL Admin (hoy solo API), contenido factual de Doing Business México **sin validar** (no se publicó ninguna edición), costo real (estimación ≈ 31–40 USD/mes **sin verificar** contra la calculadora).

## 6. Control rápido (pausa, rollback y estado)
| Acción | Comando |
|---|---|
| Pausar worker y exportación | `D9_CONFIRM=yes bash scripts/kl/g2/d9-scheduler.sh pause` |
| Quitar KL del backend | `gcloud run services update-traffic beeside-dev-backend-api --region northamerica-south1 --project beeside-dev-508220 --to-revisions beeside-dev-backend-api-00009-cm2=100` (sin KL, con Admin API) o `…00007-gtk=100` (sin Admin API) |
| Estado de los schedules y de la deriva | `bash scripts/kl/g2/d9-scheduler.sh verify` |
| Comprobar aislamiento de la instancia | miembros de `cloudsqlsuperuser` solo `postgres` y `cloudsql*`; vigilar en auditoría `cloudsql.users.create/update` |
| Verificar KL de extremo a extremo | abrir `/api/admin/kl/me` con sesión; `scripts/kl/preflight.sh --gate` |

## 7. Decisiones que necesita el PO
(1) ¿Se verifica mañana la primera exportación programada y se da G2 por cerrada? (2) ~~¿Se formaliza la instancia dedicada en un addendum (CR-KL-003)?~~ **Hecho (aprobado 17-oct-2026).** (3) Procesos de fondo: ¿instancia mínima con CPU asignada o job? (4) ¿Cuenta de servicio propia del backend (D3)? (5) ¿X26 empírico? (6) ¿Quién lleva a `main` los dos parches de la plataforma y cuándo se fusiona la rama (impacto de `deploy-dev`)? (7) Prioridad de D8 (GCS) frente a staging/producción y G3.
