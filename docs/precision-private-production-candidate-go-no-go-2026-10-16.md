# PRECISION — Candidato Privado de Producción · Paquete Go / No-Go de pre-despliegue

Fecha: 2026-10-16 · Rama `feature/precision-continuity-foundation` · **No se desplegó nada. Ninguna base de datos real fue tocada.** Pruebas de migración y de arranque: solo en bases locales descartables.

## RESPUESTA FINAL

**PRIVATE PRODUCTION CANDIDATE DEPLOYMENT READY: NO.**

La ingeniería, el guard de migración, la identidad Premium, "beeside Doing Business México" y el tooling de despliegue están listos y probados. Lo que impide desplegar hoy son **dos bloqueos genuinos, ambos fuera del código**:

1. **No existe el entorno de destino ni acceso a él.** No hay ID de proyecto GCP de producción (Terraform sin aplicar; `GCP_PROJECT_ID` vacío) y esta sesión no tiene `gcloud` autenticado. Sin eso no se puede ejecutar el check de migración de solo lectura contra el objetivo, el primer paso obligatorio. → *REQUIERE DECISIÓN DE MIKE* (proyecto + facturación) y *REQUIERE ACCESO* (sesión autenticada).
2. **Reconciliación final de KL pendiente.** El handoff canónico final no está en el Proyecto ni lo recibí; la reconciliación se hace una sola vez contra él. La auditoría previa ya encontró desajustes concretos con los principios A–E (§1). → *REQUIERE a Mike: el documento.*

No bloquean el despliegue (sí la validación integral): la semilla inicial de KL, el proveedor de identidad de Admin, el PDF final, Stripe/ClickUp, modelo real/ZDR, ICE 2026.

> Una desviación a tu número esperado: **el destino canónico ahora es 50 / 50, no 49 / 49.** Tu corrección §5 exige que el tipo PDF salga de metadato gobernado; la tabla `country_resource` no tenía ningún campo de tipo (solo `destination_kind`, `topic`, `section`). La alternativa sin migración era sobrecargar `section`, que es un hack. Agregué la migración **0049**: una columna `resource_type` nula, con CHECK `pdf|web`, aditiva, sin tocar datos. Si prefieres 49/49, es revertirla y aceptar el hack; no lo recomiendo.

## 1. Reconciliación final de KL

**¿Limpia? NO determinable todavía — y hay desajustes concretos ya visibles.** Auditoría previa del código actual contra los principios A–E de tu mensaje (el handoff final es la fuente de verdad; esto NO impone supuestos antiguos, solo muestra dónde chocan):

| Principio | Estado | Detalle exacto |
|---|---|---|
| **A. Rol de KL** | Parcial | KL ya no importa nada de Precision y es un paquete independiente. Pero conoce el `projectId` (ver B) y recibe la categoría/servicio del Service Map de *ese* proyecto (`category`, `service` en `KnowledgeRequest` y en la señal de demanda). |
| **B. Privacidad / minimización** | **DESAJUSTE** | (1) `KnowledgeRequest.question` y `kl.interpret(question)` envían **las palabras literales del cliente** a KL (`adapters.ts`: `request({ intent:"answer_question", question })` y `interpret(i.question)`). (2) `recordDemand({ projectId, turnKey }, …)` envía el **`project_id`** (KL lo reduce a una referencia opaca, pero el valor real cruza). (3) `context.candidates` lleva los estados que el cliente compara (dato de proyecto). Hoy es una llamada en proceso y KL no guarda ni repite el texto, por eso no hay fuga real; **sí contradice el principio** en cuanto KL sea un servicio. |
| **C. Frontera web** | **Limpio** | Precision no hace ninguna llamada de red; el único `fetch` de KL es `agent.ts` (puerto inyectado, solo fuentes aprobadas, no alcanzable desde la conversación). Hay pruebas de frontera. |
| **D. Conocimiento inicial** | **Brecha de despliegue** | El arranque solo siembra el *registro de fuentes*, no contenido. Con la capa vacía Precision queda honesto ("no disponible") pero esa **no debe ser la integración prevista**. El paso de carga de la semilla inicial está en el orden de despliegue (§6, paso 11) y en el smoke test. |
| **E. Equivalencias en RAM** | **No evaluable** | No hay ninguna implementación de equivalencias en el límite KL (las coincidencias en el código son de FA y de manifiestos, no de KL). Necesito el handoff para saber qué es "RAM" y su frontera con la memoria de proyecto. |

**Corrección mínima recomendada** (se aplica en la única reconciliación, ajustada a las dimensiones del contrato final): Precision clasifica **localmente** (su intérprete ya produce tema/subtema/tipo) y llama a KL **solo con dimensiones estructuradas**; se elimina `question` del cruce y se retira `interpret(question)` del camino; la señal de demanda lleva solo dimensiones controladas y un token opaco de recurrencia generado por Precision (no el `project_id`). No la implemento antes del handoff porque qué dimensiones son válidas las define ese documento.

## 2. Producto / UX

| Ítem | Estado | Verificación |
|---|---|---|
| Identidad Premium | **READY** | `[iniciales] Nombre real de la Persona / PREMIUM`, abajo a la izquierda; escritorio y móvil (cajón), claro/oscuro, sin desborde, axe limpio; PREMIUM desaparece en solo lectura (aceptado). Sin cambios en este bloque. |
| beeside Doing Business México | **READY** | Nombre visible exacto: **`beeside Doing Business México`** (sin "guía"). Botones: **Ver** / **Descargar PDF** (EN: View / Download PDF), sin repetir el nombre en ellos. Texto de la oferta: «tienes a tu disposición «beeside Doing Business México»… No es necesario leerlo para seguir». |
| Tipo PDF por metadato | **READY** | El tipo gobernado (`resource_type`, Admin) decide; una URL firmada, proxied o de CDN sin extensión funciona (probado). Solo un recurso sin tipo declarado cae al inferido por `.pdf` como respaldo. Si el navegador abre su visor en vez de descargar: aceptado. |
| Registro del PDF final | **READY sin código** | Admin (`POST/PUT /precision/country-resources`, `resourceType`) o el script `onboard-country-guide` (`--title "beeside Doing Business México" --type pdf`). El nombre exacto se fija al registrar; el código no lo hardcodea. |

Verificado: backend 85 suites / 1.856 pruebas, integración (admin, KL, acceso, recorrido), frontend 54 + e2e de identidad, `tsc` y `eslint` limpios.

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
- *(Para validar, no para desplegar)* cliente OAuth del proveedor de identidad de Admin (recomendado: Google Workspace, restringido a `beeside.you`), entregado por canal seguro; yo lo guardo en Secret Manager. Sin Admin no se pueden emitir entitlements/enlaces de prueba ni registrar el PDF por Admin.

**Decisión del dueño**
- Crear (o indicar) el proyecto GCP de producción y su ID.
- Entregar el **handoff final de KL** y la **semilla inicial de conocimiento** (D).
- Aprobar el gate **PRIVATE PRODUCTION CANDIDATE DEPLOYMENT APPROVAL** al final.
- Confirmar 50/50 como destino (o pedir 49/49 con el hack).

**Hostname / dominio público (futuro, al abrir la puerta)**
- Subdominio de `beeside.you`, URL legal de privacidad/términos reales, SMTP real y URL de compra: son configuración/build del mismo despliegue, no se necesitan para el candidato privado. Nota: las variables `VITE_*` se hornean en la imagen del web, así que abrir la puerta implica una **nueva revisión** del mismo servicio (mismo entorno, sin migrar datos).

## 5. Seguridad de migración

- **Estado del check en el destino:** *no ejecutado*: no hay destino ni acceso. Es el **paso 1 del orden de despliegue** y es de solo lectura; si `safe:false`, se detiene todo y no se toca la BD.
- **Conteo esperado:** **50 aplicadas, 0 pendientes** (0000–0049).
- **Rutas probadas (BD locales descartables, datos ficticios):** BD vacía → 50; estado Discovery-RC (0000–0023) → `--check` seguro con 25 pendientes → aplicado → 49; 49 → 50 (0049) con `--check` seguro antes y 0 pendientes después. Arranque en modo producción con el rol de runtime de mínimo privilegio, `DB_PRIVILEGE_CHECK` activo y `/health/ready` = `ready` (solo responde listo con todas las migraciones aplicadas).
- **¿Puede el destino recibir migraciones con seguridad?** Sí en cualquiera de los tres estados probados (vacía, RC, 49); **cualquier otro estado → el job aborta antes de escribir**.
- **Plan de respaldo:** (1) la instancia nace con backups automáticos de 35 días (el check exige que estén activos, REGIONAL y protección de borrado); (2) **respaldo bajo demanda inmediatamente antes de migrar** (`backup`), y no se avanza si no queda `SUCCESSFUL`; (3) restauración **por clonado a una instancia nueva** (punto en el tiempo), nunca sobre la instancia viva.
- Ninguna BD compartida se destruye ni recrea sin tu aprobación explícita.

## 6. Orden de despliegue (exacto y seguro)

Script: `infra/deploy/precision-private-candidate.sh` (+ `cloudbuild-precision-candidate.yaml`). **Probado solo en `DRY_RUN`** (imprime cada comando; sintaxis verificada; los pasos que escriben se niegan a ejecutarse sin `APPROVAL=PRIVATE_PRODUCTION_CANDIDATE_DEPLOYMENT_APPROVAL`). No se ha ejecutado contra GCP; la primera ejecución real puede requerir ajustes menores (p. ej. permisos de Cloud Build en un proyecto nuevo).

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
11. **Cargar la semilla inicial de KL** (`ingest-knowledge`) y comprobar cobertura de México > 0 *(requiere la semilla; sin ella, el candidato queda en estado honesto "KL sin contenido", no en el estado previsto)*.

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

- Gate **PRIVATE PRODUCTION CANDIDATE DEPLOYMENT APPROVAL** (el script se niega a ejecutar `backup`/`migrate`/`prepare`/`deploy` sin él).
- Crear el proyecto/facturación y `terraform apply` de producción.
- Primera aplicación de migraciones sobre la BD de destino (forward-only; mitigada por `check` + respaldo + clonado).
- Cualquier recreación o borrado de una BD/instancia compartida: **no se hace sin aprobación explícita**; una BD local descartable no equivale a aprobación.
- Abrir la puerta más adelante (quitar IAP / invocación pública / hostname) y retirar `FA4_ENV=staging` con legales y SMTP reales: decisión separada.

## Evidencia de este bloque

- Commits locales (sin push): `c4563c3` (nombre exacto, tipo PDF gobernado, migración 0049, job de rol de runtime) y el de tooling/documento de este paquete.
- Cambios de código: 0049 + esquema/repositorio/contrato/Admin/router del recurso; texto de oferta sin "guía"; etiquetas Ver/Descargar PDF; `runtime-role-prepare` (verificado localmente: crea el rol, es idempotente, rechaza nombres reservados, el rol no puede crear objetos); `precision-private-candidate.sh` y su cloudbuild; la etiqueta de "Fase 15" en el workflow de producción reemplazada por el nombre del gate.
- Pruebas: backend 85 suites verdes; integración de recurso (tipo gobernado, URL firmada sin extensión ⇒ PDF; `.pdf` declarado web ⇒ web); Admin valida `resourceType`; arranque local en modo producción como rol de mínimo privilegio con Precision montado (401 sin sesión) y `/health/ready` = `ready`.
