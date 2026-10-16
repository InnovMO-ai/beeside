# PRECISION — Candidato Privado de Producción · Checkpoint de pre-despliegue

Fecha: 2026-10-16 · Rama `feature/precision-continuity-foundation` · **Nada se desplegó. Ninguna base de datos fue modificada** (las pruebas de migración corrieron en una base local descartable).

**Veredicto.** La ingeniería está lista para el Candidato Privado de Producción: puente de continuidad aceptado, guard de migración probado en el camino real (estado Discovery-RC → 49/49), y los dos puntos UX pendientes están implementados y probados. **Hay un solo bloqueo real y es tuyo**: confirmar/crear el proyecto GCP de producción (§1–§3). Todo lo demás lo ejecuto yo tras la aprobación del gate **PRIVATE PRODUCTION CANDIDATE DEPLOYMENT APPROVAL**.

> Alcance de la verificación: esta sesión no tiene credenciales de `gcloud` ni de GitHub (el token está inválido), así que lo “vivo” de GCP no se pudo leer. “FOUND” significa **encontrado en repo, workflows, IaC, scripts de despliegue y documentos del Proyecto**; el estado vivo se marca **no verificable desde aquí** y se confirma con un solo comando de lectura (§4 y §8, paso 1).

## 1. Topología descubierta

| Elemento | Estado | Evidencia / valor |
|---|---|---|
| Plataforma | **FOUND** | Google Cloud (Cloud Run + Cloud SQL + Secret Manager + Artifact Registry + Cloud Build). |
| Proyecto GCP **dev** | **FOUND** (aplicado) | `beeside-dev-508220` — único entorno realmente aplicado. |
| Proyecto GCP **staging / producción** | **NOT FOUND** | Terraform y workflows existen pero **sin aplicar**; los `GCP_PROJECT_ID` de GitHub están vacíos (los workflows responden “not yet configured”). No hay ID de proyecto en repo ni en el Proyecto. |
| Región | **FOUND** | `northamerica-south1` (Querétaro), en los tres entornos. |
| Servicios Cloud Run (dev) | **FOUND** | Legado público: `backend-api`, `frontend-app`. Discovery interno: `fa4-staging-backend` (privado, `--no-allow-unauthenticated`, min 0/máx 1) y `fa4-staging-web` (detrás de IAP). |
| Cloud SQL | **FOUND** | Instancia `beeside-dev-canonical-db` (dev: `db-g1-small`, ZONAL, sin protección de borrado). BDs: `beeside` (Core/legado) y `fa4_staging` (Discovery staging, datos de prueba). Producción (scaffold): `db-custom-2-7680`, REGIONAL, 35 días de backup, protección de borrado ON. |
| Identidad de migración vs runtime | **FOUND** | Migración: `beeside-dev-migration-runner@…` ejecuta el job “prepare”/migrate con `MIGRATION_DATABASE_URL`. Runtime: rol de login sin DDL, miembro de `beeside_runtime_role` (migración 0014); el servicio **no** recibe `MIGRATION_DATABASE_URL`; arranque en producción exige `DB_PRIVILEGE_CHECK`. Cuenta de build dedicada `fa4-staging-build`; CI: `beeside-dev-ci-deployer` + Workload Identity Federation (`beeside-dev-github-pool`, restringido al repo; en producción solo `refs/heads/main`). |
| Secretos (solo nombres) | **FOUND** | Patrón `<env>-db-runtime-password`, `<env>-hash-secret`, `<env>-database-url`, `beeside-dev-migration-database-url`; SMTP opcional por nombre de secreto. Sin valores en repo ni en este documento. |
| Dominio / ruteo | **PARCIAL** | Solo URLs `*.run.app` deterministas. Dominio de IAP: `domain:beeside.you`. **No hay dominio personalizado mapeado** a ningún servicio → hostname de producción: **REQUIERE MIKE** (solo para abrir la puerta; el candidato privado no lo necesita). |
| Puerta actual | **FOUND** | IAP sobre el servicio web de Discovery staging (`roles/iap.httpsResourceAccessor` a `domain:beeside.you`), `ROBOTS_NOINDEX=true`, web→backend con ID token de Google (`UPSTREAM_AUTH_AUDIENCE`). Los servicios públicos de dev usan `--no-invoker-iam-check` (la política de organización bloquea `allUsers`). |
| Red | **FOUND** | VPC/subred por entorno (módulo `network`, dev `10.10.0.0/20`); Cloud Run ↔ Cloud SQL por conector (`--add-cloudsql-instances`), sin conexión directa desde internet a la BD. |
| Recursos compatibles con producción-candidato | **FOUND (en el scaffold de producción)** | Módulos `cloud-run`, `database` (REGIONAL), `secrets`, `artifact-registry`, `migration-job`; patrón completo de despliegue en `staging/fa4-internal/deploy-gcp.sh`; imágenes backend/web ya construibles (`backend/Dockerfile`, `frontend/Dockerfile`; el mismo servidor estático sirve `/precision` y proxea `/api/*`, incluido `/api/precision`). |

## 2. Qué requiere realmente a Mike

Solo lo que no se puede derivar ni crear con las credenciales de esta sesión:

1. **Confirmar el destino** (una línea): “producción = el entorno `production` ya diseñado, en un proyecto GCP propio” (recomendado, §3) — o indicar que `beeside-dev-508220` es el hogar definitivo.
2. **Si es proyecto nuevo**: crear el proyecto y vincular facturación (o darme el ID de uno existente) y el bucket de estado de Terraform; se asignan las variables de GitHub (`GCP_PROJECT_ID`, etc.).
3. **Credenciales de despliegue**: una sesión con `gcloud` autenticado (o WIF listo) para ejecutar los pasos de §8; **los valores de secretos los genero yo con `openssl` dentro de Secret Manager, sin imprimirlos** (no necesitas pasarme ninguno para este candidato).
4. **Consentimiento OAuth/IAP** del proyecto (pantalla de marca) si el proyecto es nuevo.
5. **Hostname público** (p. ej. un subdominio de `beeside.you`) — solo al abrir la puerta.

No necesito de ti: credenciales Stripe/ClickUp sandbox, modelo real/ZDR, PDF final de Doing Business, ICE 2026, los 12 vacíos de KL ni la política final de retención.

## 3. Destino recomendado

**El entorno `production` ya definido en `infra/terraform/envs/production` (proyecto GCP propio, REGIONAL, protección de borrado, WIF solo desde `main`), con Precision y Discovery convergiendo en una sola base de datos por entorno**, y la misma pareja backend/web que ya usa Discovery, publicada **privada detrás de IAP**.

Por qué y por qué no lo otro:

- **No crea una “producción temporal”**: es el mismo despliegue que luego se abre; no hay migración posterior a otro entorno.
- **Reutilizar la infra de Discovery staging tal cual no es seguro como destino final**: vive en el proyecto `dev`, con BD `db-g1-small` ZONAL sin protección de borrado y datos de prueba (`fa4_staging`); convertirla en producción mezclaría datos de prueba con datos reales y degradaría la garantía de recuperación. **Sí se reutiliza lo importante**: el patrón completo (`deploy-gcp.sh`), las imágenes, el servidor web con proxy autenticado, IAP, `ROBOTS_NOINDEX`, el job de preparación y la separación de identidades — parametrizado para `production`.
- **Una sola BD por entorno** es requisito del puente de continuidad (Core + resultados sellados de Discovery bajo el mismo `project_id`): el diario de migraciones de Discovery RC (0000–0023) es idéntico, por hash y fecha, a las primeras 24 de esta rama; esta rama agrega 0024–0048.
- Alternativa si decides que `beeside-dev-508220` es el hogar definitivo: mismo procedimiento, con una BD nueva dentro de la instancia, **y antes endurecer la instancia** (tier, HA, protección de borrado). No lo recomiendo: el nombre, el aislamiento y la facturación de “dev” dejan de coincidir con lo que estás protegiendo.
- Honestidad sobre una incógnita: el repo no dice dónde vivirá Discovery público v1.0. Mi supuesto es el mismo proyecto de producción; si no es así, el costo es solo ajustar el ID, no rediseñar.

## 4. Resultado de seguridad de migración

Guard conservado (`inspectMigrationState` / `migrate.js --check`, comando `npm run db:migrate:check`; el job rechaza hash desconocido, `when` distinto o pendiente anterior al último aplicado). Lectura contra el entorno objetivo: **no ejecutable hoy** (sin credenciales) → el procedimiento es un Cloud Run Job de solo lectura con `--check` como **primer paso del despliegue**, antes de cualquier escritura.

Prueba equivalente ejecutada ahora en una BD local descartable construida con el **estado exacto de Discovery RC (0000–0023)**:

| Paso | Resultado |
|---|---|
| `--check` sobre estado RC | `expected 49 · applied 24 · pending 25 (0024…0048) · safe: true` |
| Aplicar | `migrations applied: 49`, sin errores; 0048 aplica sin tocar datos existentes (aditivo: `project_origin`, `company_person`, `company_match_review`, columnas de `company`) |
| `--check` posterior | `applied 49 · pending [] · safe: true` |
| Pruebas con rol de runtime de mínimo privilegio | verdes (continuidad, 7/7) |

- **Ruta esperada**: BD vacía → 0000–0048 completo; BD en estado Discovery-RC → 0024–0048 incremental. **¿0048 aplica con seguridad?** Sí, en ambos caminos. **¿Hace falta recrear?** No, mientras `--check` diga `safe: true`; si dijera lo contrario (hash/numeración distintos) el job aborta sin escribir y la recomendación sería **recrear solo si los datos son ficticios/internos y con tu aprobación**: no se destruye ningún entorno compartido sin ella.

## 5. UX — Recurso “Doing Business” (estado: **implementado y probado**)

- **Ya existía** (aceptado): recurso de país configurable por Admin (`country_resource`, URL https; nada hardcodeado), ofrecido **una vez, en contexto**, nunca obligatorio.
- **Agregado**: la oferta muestra el título (“Doing Business in Mexico”) con **“Ver guía”** y **“Descargar PDF”** (EN/ES). El formato (`pdf`|`web`) se **deriva de la URL configurada** (https cuyo path termina en `.pdf`); una guía web solo muestra “Ver guía”. Enlaces reales (`target=_blank`, `noopener`), accesibles. Si la guía no está activa o el destino no es https: mensaje “ya no está disponible” y **la conversación nunca se bloquea**.
- **Sin migración, sin tocar el contrato de KL.** Cuando llegue el PDF final: se registra su URL en Admin (guía país + `onboard-country-guide`); **no requiere rediseño ni despliegue de código**.
- Límite conocido: el PDF debe estar en una URL https que termine en `.pdf`; con un host de terceros el navegador lo abre/descarga según su visor (el atributo `download` solo fuerza descarga si el PDF está en el mismo origen). Si prefieres descarga forzada, la solución es servirlo desde nuestro propio origen — decisión posterior, no bloquea.

## 6. UX — Identidad del usuario Premium (estado: **implementada y probada**)

- Abajo a la izquierda del workspace: **[iniciales] Nombre de la persona / PREMIUM**. El nombre sale de la **Persona real** (`project.responsible_person_id` → `preferred_name` o `nombre + apellido`), nunca hardcodeado; si no hay nombre usable, no se muestra el bloque (sin marcador falso).
- Etiqueta **PREMIUM** (nunca “Plus”) solo mientras el entitlement está FULL; en solo lectura se conserva el nombre y desaparece la etiqueta (el banner ya explica el fin del plan).
- Escritorio: fijo al pie de la barra lateral. Móvil: al pie del cajón, encima de Ayuda/idioma. Compacto (<80 px), sin menú de cuenta en MVP1. Verificado en escritorio 1440×900 y móvil 390×844, claro/oscuro, sin desborde horizontal y con auditoría de accesibilidad (axe). Capturas: `identity-desktop-light.png`, `identity-mobile-light.png`.
- Pruebas: unidad (iniciales Unicode, nombre preferido/compuesto), integración con BD (FULL ⇒ `premium:true`, READ_ONLY ⇒ `false`), frontend y e2e.

## 7. Enfoque de la puerta privada

Precision vive en su ubicación final y **no es pública**: servicio web de Cloud Run con `--no-allow-unauthenticated` + **IAP** (acceso solo `domain:beeside.you` o la lista que indiques), backend privado (solo el web con ID token), `ROBOTS_NOINDEX=true`, sin dominio personalizado ni enlace en navegación pública, URL **no distribuida**. Los testers internos entran por IAP **y además** necesitan un enlace de un solo uso de Precision emitido por Admin para un proyecto con entitlement válido (el acceso de Precision sigue gobernado por Core). Reutiliza la puerta existente de Discovery (mismo mecanismo, mismo gate), sin código nuevo.

**Abrir después = mismo despliegue**: quitar IAP del servicio web y permitir invocación pública con `--no-invoker-iam-check` (la política de organización veta `allUsers`, como ya hace dev), mapear el hostname y retirar `ROBOTS_NOINDEX`. No hay migración de datos ni redeploy a otro entorno; es un cambio de configuración reversible (volver a activar IAP).

## 8. Pasos exactos de despliegue (tras aprobación)

1. **Lectura**: confirmar proyecto/región/instancia y ejecutar el job de solo lectura `migrate.js --check` contra la BD objetivo; abortar si `safe: false`.
2. Habilitar APIs (`run`, `sqladmin`, `secretmanager`, `artifactregistry`, `cloudbuild`, `iap`) y, si el proyecto es nuevo, `terraform apply` del entorno `production` (red, Artifact Registry, Cloud SQL REGIONAL con protección de borrado, módulos de Cloud Run, WIF).
3. Secretos en Secret Manager (generados dentro, **sin imprimir**): contraseña del rol de runtime, `SECURITY_HASH_SECRET`, `DATABASE_URL` del runtime, `PRECISION_INTERNAL_KEY` (opcional); IAM mínimo (`secretAccessor` solo para la cuenta de runtime).
4. Construir las imágenes con la cuenta de build dedicada (Cloud Build) y etiqueta = commit.
5. **Job “prepare”** como cuenta de migración: crear/ajustar BD y rol de runtime (miembro de `beeside_runtime_role`), `migrate.js` (0000–0048 o 0024–0048), publicar manifiestos y registrar fuentes de KL una vez (en producción la publicación en arranque está apagada por defecto; se hace aquí).
6. Backend privado: `PRECISION_API_ENABLED=true`, `PRECISION_ENTITLEMENT_PROVIDER=core`, `PRECISION_FA_CONTEXT_PROVIDER=discovery`, `PRECISION_UNDERSTANDING_INTERPRETER=rules` (modelo real apagado hasta ZDR), `PRECISION_OH_PROVIDER` y proveedores de pago/ClickUp en simulado, `TRUST_PROXY_HOPS=2`, `DB_PRIVILEGE_CHECK`, sin `MIGRATION_DATABASE_URL`.
7. Web: `API_UPSTREAM_URL`, `UPSTREAM_AUTH_AUDIENCE`, `ROBOTS_NOINDEX=true`, privado; **IAP** + `iap.httpsResourceAccessor` al miembro acordado.
8. Verificación en el destino: `/health/ready` listo (49/49), puerta cerrada (acceso anónimo rechazado), sesión de Precision con proyecto de prueba, identidad Premium y guía país visibles, 0 referencias a Discovery mutable.
9. Entregar a Mike la URL **solo por canal interno** y la guía de validación del look & feel.

## 9. Irreversible / requiere aprobación

- **Aprobación del gate PRIVATE PRODUCTION CANDIDATE DEPLOYMENT APPROVAL** (único gate; sin términos adicionales).
- Crear el proyecto/facturación y aplicar Terraform (crea recursos facturables; la instancia con protección de borrado queda difícil de retirar).
- Primera aplicación de migraciones sobre la BD de destino (aditivas, pero las migraciones no se “des-aplican”; se mitiga con el `--check` previo y copia de seguridad antes del paso 5).
- Cualquier recreación o borrado de una BD/instancia compartida: **no se hace sin aprobación explícita**.
- Apertura posterior de la puerta (quitar IAP / acceso público): decisión separada.

## Estado del Knowledge Layer

Sin cambios: ni rediseño ni rutas nuevas. La guía país usa la ruta ya aceptada (`openResource`), sin tocar contrato ni esquema. Queda lista la **reconciliación del contrato canónico final de KL** antes del despliegue (revisión del contrato publicado vs. el cliente de Precision; sin nuevas rutas de conocimiento) y no bloquea este candidato.

## Evidencia de este bloque

- Commits `25073fd` (guía + identidad) y el de e2e; sin push.
- Backend: 48 suites (1373 pruebas) verdes; integración (acceso, KL, recorrido) verde; `tsc` y `eslint` limpios.
- Frontend: 54 pruebas de Precision verdes; e2e de identidad 4/4 (escritorio/móvil × claro/oscuro).
- Migración: ruta Discovery-RC → 49/49 probada con `--check` antes y después.
