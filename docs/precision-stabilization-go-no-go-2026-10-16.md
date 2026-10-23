# PRECISION — ESTABILIZACIÓN · Paquete Go / No-Go de pre-despliegue

Fecha: 2026-10-16 · Rama `feature/precision-continuity-foundation` · **No se desplegó nada. Ninguna base de datos real fue tocada.** Pruebas de migración y de arranque: solo en bases locales descartables.

## RESPUESTA FINAL

**ESTABILIZACIÓN DEPLOYMENT READY: NO.** (actualizado tras el cierre de KL e identidad de Admin)

La ingeniería está lista y probada (KL limpio, semilla obligatoria, identidad de Admin = Google/IAP existente, migración 50/50, "beeside Doing Business México"). Quedan **solo bloqueos externos**:

1. **Proyecto GCP de producción y acceso** (proyecto + facturación; `gcloud` autenticado). → *REQUIERE DECISIÓN DE MIKE / ACCESO*.
2. **Contenido de la semilla inicial de KL** en un bucket privado con `manifest.json`.
3. **Cliente OAuth Web (Internal, `beeside.you`)**, su secreto en Secret Manager y el correo del primer SUPER_ADMIN.
4. Aprobación del gate **STABILIZATION DEPLOYMENT APPROVAL**.

No bloquean el despliegue (sí la validación integral): PDF final, Stripe/ClickUp, modelo real/ZDR, ICE 2026.

> Destino de migraciones **50 / 50, no 49 / 49**: la 0049 agrega `country_resource.resource_type` (nulo, CHECK `pdf|web`, aditiva) para que el tipo PDF salga de metadato gobernado y no de un hack sobre `section`.

## 1. Reconciliación final de KL — **CLEAN** (actualizado)

Contrastado contra el handoff canónico final y corregido en código: Precision ya no envía texto literal, `project_id` ni `context.candidates` a KL; la demanda usa referencias opacas HMAC irreversibles; sin ruta web; la semilla inicial es obligatoria en producción (guard de arranque + fase `seed` + smoke S6). Detalle, cambios exactos y pruebas: `docs/precision-kl-boundary-reconciliation-2026-10-16.md`.

## 2. Producto / UX

| Ítem | Estado | Verificación |
|---|---|---|
| Identidad Premium | **READY** | `[iniciales] Nombre real de la Persona / PREMIUM`, abajo a la izquierda; escritorio y móvil (cajón), claro/oscuro, sin desborde, axe limpio; PREMIUM desaparece en solo lectura (aceptado). Sin cambios en este bloque. |
| beeside Doing Business México | **READY** | Nombre visible exacto: **`beeside Doing Business México`** (sin "guía"). Botones: **Ver** / **Descargar PDF** (EN: View / Download PDF), sin repetir el nombre en ellos. Texto de la oferta: «tienes a tu disposición «beeside Doing Business México»… No es necesario leerlo para seguir». |
| Tipo PDF por metadato | **READY** | El tipo gobernado (`resource_type`, Admin) decide; una URL firmada, proxied o de CDN sin extensión funciona (probado). Solo un recurso sin tipo declarado cae al inferido por `.pdf` como respaldo. Si el navegador abre su visor en vez de descargar: aceptado. |
| Registro del PDF final | **READY sin código** | Admin (`POST/PUT /precision/country-resources`, `resourceType`) o el script `onboard-country-guide` (`--title "beeside Doing Business México" --type pdf`). El nombre exacto se fija al registrar; el código no lo hardcodea. |

Verificado (actualizado): backend 88 suites / 1.885 pruebas unitarias y 40 suites / 347 de integración en BD limpia; antes 85 / 1.856, integración (admin, KL, acceso, recorrido), frontend 54 + e2e de identidad, `tsc` y `eslint` limpios.

## 3. Infraestructura de destino

Aceptado provisionalmente; no hay estándar de producción distinto en repo ni Proyecto.

| Elemento | Propuesta | Estado |
|---|---|---|
| Proyecto / entorno | Proyecto GCP **dedicado de producción** (Terraform `envs/production`) | ID: **REQUIERE DECISIÓN DE MIKE** |
| Región | `northamerica-south1` (confirmada por Mike en el Terraform; sin estándar canónico distinto) | FOUND |
| Runtime | Cloud Run: `beeside-production-backend-api` (privado) y `beeside-production-frontend-app` (privado + IAP), min 0 / máx 2, identidad de runtime **dedicada** `beeside-production-runtime` (no la de cómputo por defecto) | Definido en el script |
| Cloud SQL | `beeside-production-canonical-db`: REGIONAL, `db-custom-2-7680`, backups 35 días, protección de borrado, **una BD `beeside`** (Core + Discovery) | Definido en Terraform; en vivo: **REQUIERE ACCESO** |
| Puerta privada | IAP sobre el web, acceso `domain:beeside.you`; backend sin invoker público; el web llama al backend con ID token; `ROBOTS_NOINDEX=true` | Patrón FOUND (Discovery staging) |
| Red / auth | Cloud Run ↔ Cloud SQL por conector (sin IP pública hacia internet para clientes); identidad de migración ≠ runtime; el runtime nunca recibe `MIGRATION_DATABASE_URL` | FOUND |

Hallazgos de la lectura de Terraform/workflows de producción (la razón del script en vez del workflow): (a) el workflow de producción exige despliegue previo en staging y solo hace `gcloud run deploy` de la imagen — no fija variables `PRECISION_*`, secretos, IAP ni la llamada autenticada web→backend; (b) los servicios de Terraform usan la cuenta de cómputo por defecto; (c) IAP no está en Terraform; (d) `prevent_destroy = false` en el módulo de BD ("revisar antes de endurecer producción"; hoy la protección real es `deletion_protection = true` de Cloud SQL). Ninguno cambia la arquitectura; (a)–(c) los resuelve el script, (d) es endurecimiento recomendado antes de abrir.

## 4. Lo que aún se requiere de Mike

**Acceso / credenciales**
- Sesión con `gcloud` autenticado sobre el proyecto de producción (o WIF listo) y, si el proyecto es nuevo, permiso para vincular facturación.
- Cliente OAuth Web **Internal** de Google (`beeside.you`) para Admin (no hay IdP separado: se reutiliza la identidad Google), con su secreto creado por el operador en Secret Manager (`precision-production-admin-oidc-client-secret`) y el correo del primer SUPER_ADMIN. Lo consume la fase `admin`.

**Decisión del dueño**
- Crear (o indicar) el proyecto GCP de producción y su ID.
- Entregar la **semilla inicial de conocimiento** (bucket privado + `manifest.json`); el handoff de KL ya fue reconciliado.
- Aprobar el gate **STABILIZATION DEPLOYMENT APPROVAL** al final.
- Confirmar 50/50 como destino (o pedir 49/49 con el hack).

**Hostname / dominio público (futuro, al abrir la puerta)**
- Subdominio de `beeside.you`, URL legal de privacidad/términos reales, SMTP real y URL de compra: son configuración/build del mismo despliegue, no se necesitan para ESTABILIZACIÓN. Nota: las variables `VITE_*` se hornean en la imagen del web, así que abrir la puerta implica una **nueva revisión** del mismo servicio (mismo entorno, sin migrar datos).

## 5. Seguridad de migración

- **Estado del check en el destino:** *no ejecutado*: no hay destino ni acceso. Es el **paso 1 del orden de despliegue** y es de solo lectura; si `safe:false`, se detiene todo y no se toca la BD.
- **Conteo esperado:** **50 aplicadas, 0 pendientes** (0000–0049).
- **Rutas probadas (BD locales descartables, datos ficticios):** BD vacía → 50; estado Discovery-RC (0000–0023) → `--check` seguro con 25 pendientes → aplicado → 49; 49 → 50 (0049) con `--check` seguro antes y 0 pendientes después. Arranque en modo producción con el rol de runtime de mínimo privilegio, `DB_PRIVILEGE_CHECK` activo y `/health/ready` = `ready` (solo responde listo con todas las migraciones aplicadas).
- **¿Puede el destino recibir migraciones con seguridad?** Sí en cualquiera de los tres estados probados (vacía, RC, 49); **cualquier otro estado → el job aborta antes de escribir**.
- **Plan de respaldo:** (1) la instancia nace con backups automáticos de 35 días (el check exige que estén activos, REGIONAL y protección de borrado); (2) **respaldo bajo demanda inmediatamente antes de migrar** (`backup`), y no se avanza si no queda `SUCCESSFUL`; (3) restauración **por clonado a una instancia nueva** (punto en el tiempo), nunca sobre la instancia viva.
- Ninguna BD compartida se destruye ni recrea sin tu aprobación explícita.

## 6. Orden de despliegue (exacto y seguro)

Script: `infra/deploy/precision-stabilization.sh` (+ `cloudbuild-precision-stabilization.yaml`). **Probado solo en `DRY_RUN`** (imprime cada comando; sintaxis verificada; los pasos que escriben se niegan a ejecutarse sin `APPROVAL=STABILIZATION_DEPLOYMENT_APPROVAL`). No se ha ejecutado contra GCP; la primera ejecución real puede requerir ajustes menores (p. ej. permisos de Cloud Build en un proyecto nuevo).

0. *(Mike)* Proyecto creado + `terraform apply` de `envs/production` (red, Artifact Registry, Cloud SQL REGIONAL con protección, módulos de Cloud Run, job de migración, WIF) — **crea recursos facturables**.
1. `build` — imágenes `backend-api` y `frontend-app` con etiqueta = commit (no toca datos ni servicios).
2. `check` — **solo lectura**: identidad, proyecto, endurecimiento de la instancia, y `migrate.js --check` contra la BD objetivo. `safe:false` ⇒ **STOP**.
3. `backup` — respaldo bajo demanda; verificar `SUCCESSFUL`.
4. `migrate` — aplica con la identidad de migración (el job se niega si el estado no es seguro) y verifica 50/50, 0 pendientes.
5. `prepare` — cuenta de runtime dedicada; secretos generados dentro de Secret Manager **sin imprimir valores**; rol LOGIN de runtime (job `runtime-role-prepare`: no superusuario, sin DDL, sin propiedad, sin escritura en el registro de migraciones; verifica y falla si no).
6. `deploy` — backend **privado** (`--no-allow-unauthenticated`, sin `MIGRATION_DATABASE_URL`, `PRECISION_API_ENABLED`, entitlement `core`, contexto `discovery`, intérprete `rules`, modelo `scripted`, OH `simulator`, `TRUST_PROXY_HOPS=2`, publicación de manifiestos y registro de fuentes de KL al arrancar); web **privado + IAP**.
7. Verificar que el backend arrancó con el chequeo de privilegios del rol de runtime (`/health/ready`).
8. `smoke` — pruebas §7.
9. Registrar el recurso `beeside Doing Business México` por Admin/script cuando llegue el PDF (no bloquea).
10. Entregar la URL **solo por canal interno**.
- Orden efectivo: `build → check → backup → migrate → prepare → seed → deploy → admin → baseline → smoke`. `baseline` — respaldo etiquetado *clean baseline* después de seed+admin y antes de cualquier dato ficticio; `audit` (solo lectura, `REQUIRE_CLEAN=1` para el tránsito a PRODUCCIÓN) verifica que no queden datos ficticios de clientes/proyectos. `seed` — carga la semilla inicial de KL (job con el bucket montado de solo lectura; falla si algún país requerido queda sin conocimiento). El backend arranca con `PRECISION_REQUIRE_KNOWLEDGE_SEED=true`: **no existe el estado "KL vacío" en producción**.
`admin` (después de `deploy`) — configura el inicio de sesión del Control Center con Google (OIDC), secretos en Secret Manager y el job de primer SUPER_ADMIN (único, auditado). Debe ejecutarse **después de cada `deploy`** (que reemplaza variables). Smoke S6 = `kl-seed --check`.

## 7. Smoke test post-despliegue

**Automáticas (`smoke`)**
- S1 acceso anónimo al web ⇒ 302/401/403, nunca 200. S2 backend anónimo ⇒ 401/403. S3 `/api/precision/*` anónimo ⇒ 302/401/403.
- S4 `/health/ready` del backend con ID token del invocador ⇒ `{"status":"ready"}`.
- S5 `--check` ⇒ `applied=50 · pending=[] · safe=true`.

**Producto (a través de IAP, con una cuenta interna)**
- P1 `/precision` carga y no es accesible sin IAP. P2 un proyecto de prueba **con entitlement FULL** (Discovery sellado → entitlement → mismo `project_id` en Core) abre Precision con enlace de un solo uso; sin entitlement no abre.
- P3 Portada → Center; identidad real + PREMIUM abajo a la izquierda (escritorio y móvil); revocado/solo lectura se comporta según lo congelado.
- P4 Understanding responde con el intérprete de reglas; My Service Map → categoría → CRP → Preview (OH simulado).
- P5 Si KL tiene semilla: una pregunta de México responde con fuente y sin obligaciones; si no, queda marcado **NO PASA (KL vacío)**.
- P6 `beeside Doing Business México`: si está registrado, aparece una vez, opcional, con **Ver / Descargar PDF**; nunca obligatorio.
- P7 Negativos: sin lectura de tablas mutables de Discovery/YEV; logs sin secretos ni datos personales; el backend no responde a nadie sin identidad.

## 8. Rollback

| Qué | Reversible | Cómo |
|---|---|---|
| Imagen/código | Sí | Revisión anterior de Cloud Run (`update-traffic`). Primer despliegue: sin revisión previa ⇒ retirar el acceso IAP (cierra la puerta) o borrar los dos servicios. |
| Configuración / variables | Sí | Nueva revisión con la configuración anterior. |
| Puerta | Sí | Quitar `iap.httpsResourceAccessor` cierra todo acceso al instante. |
| Secretos | Sí | Deshabilitar/rotar versiones. |
| Migraciones 0048/0049 | **No se "des-aplican"** | Son aditivas: el código anterior las ignora, así que **no hace falta revertir la BD para revertir la app**. Si hiciera falta recuperar datos: clonar a instancia nueva desde el respaldo previo a `migrate`. |
| Rol de runtime / cuenta de servicio | Sí | Eliminables; sin efecto en datos. |
| Proyecto, facturación, instancia con protección de borrado | **No fácilmente** | Ver §9. |

## 9. Acciones irreversibles o de alto riesgo (requieren aprobación explícita)

- Gate **STABILIZATION DEPLOYMENT APPROVAL** (el script se niega a ejecutar `backup`/`migrate`/`prepare`/`deploy` sin él).
- Crear el proyecto/facturación y `terraform apply` de producción.
- Primera aplicación de migraciones sobre la BD de destino (forward-only; mitigada por `check` + respaldo + clonado).
- Cualquier recreación o borrado de una BD/instancia compartida: **no se hace sin aprobación explícita**; una BD local descartable no equivale a aprobación.
- Abrir la puerta más adelante (quitar IAP / invocación pública / hostname) y retirar `FA4_ENV=staging` con legales y SMTP reales: decisión separada.

## Evidencia de este bloque

- Commits locales (sin push): `c4563c3` (nombre exacto, tipo PDF gobernado, migración 0049, job de rol de runtime) y el de tooling/documento de este paquete.
- Cambios de código: 0049 + esquema/repositorio/contrato/Admin/router del recurso; texto de oferta sin "guía"; etiquetas Ver/Descargar PDF; `runtime-role-prepare` (verificado localmente: crea el rol, es idempotente, rechaza nombres reservados, el rol no puede crear objetos); `precision-stabilization.sh` y su cloudbuild; la etiqueta de "Fase 15" en el workflow de producción reemplazada por el nombre del gate.
- Pruebas: backend 85 suites verdes; integración de recurso (tipo gobernado, URL firmada sin extensión ⇒ PDF; `.pdf` declarado web ⇒ web); Admin valida `resourceType`; arranque local en modo producción como rol de mínimo privilegio con Precision montado (401 sin sesión) y `/health/ready` = `ready`.
