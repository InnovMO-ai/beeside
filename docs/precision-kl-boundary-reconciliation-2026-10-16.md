# PRECISION — Reconciliación final del límite con Knowledge Layer + identidad de Admin

Fecha: 2026-10-16 · Rama `feature/precision-continuity-foundation` · Sin despliegue, sin push, sin tocar ni contactar a KL. Fuente: *KL 1.0 → Precision MVP1 · Canonical Architecture Handoff* (estaba en el Escritorio de Mike, no en el Proyecto; la extraje de ahí).

## 1. Reconciliación KL: **CLEAN**

| Principio | Antes | Ahora |
|---|---|---|
| A. Texto literal del cliente | `request({question})` e `interpret(question)` cruzaban a KL | Precision clasifica **localmente** (tema/subtema/tipo/frontera/geografía). KL ya no tiene `interpret()` ni campo `question`. La consulta opcional (`query`) se construye **solo con términos del vocabulario controlado** (máx. 6), nunca con palabras del cliente, y KL no la persiste. |
| B. `project_id` | `recordDemand({projectId, turnKey})` | Referencia **opaca e irreversible**: HMAC-SHA256 con una llave derivada de `SECURITY_HASH_SECRET` (propósito `beeside.kl.v1.demand-reference`), 32 hex. `projectRef` (por proyecto → conteo de proyectos distintos) y `eventRef` (proyecto+turno → solo idempotencia). KL las valida (`/^[0-9a-f]{32}$/`) y rechaza un id crudo. En producción el arranque falla sin un secreto ≥ 32 caracteres. |
| C. `context.candidates` | Estados/criterios del proyecto | Eliminado. Solo dimensiones mínimas: `regions[]` (estados), `finerThanState`, `category`, `service`. |
| D. Forma de solicitud permitida | — | `{jurisdiction, originCountry?, industry?, stage, intent, topics?/topic/subtopic, infoType?, regions?, finerThanState?, category?, service?, query?, language, limit?}`. Sin PII, empresa, cifras, documentos, `project_id` real ni conversación literal. |
| E. Web | Sin red en Precision; único `fetch` en `agent.ts` | Sin cambios y probado: ni Precision ni el servicio de KL abren red; solo el proceso de recolección de KL toca fuentes gobernadas. |

**Frontera profesional:** KL ya no devuelve `boundary`/`interpretation`; Precision la calcula localmente y la aplica sobre la respuesta (cobertura "parcial", razón `professional_judgment`). **Granularidad:** KL emite el hueco `{place}`; el adaptador de Precision lo llena localmente con los lugares que escribió el cliente (nunca se envían).

### Conocimiento inicial (punto 2)
La capa vacía **ya no es un estado válido de producción**:
- `knowledgeReadiness` / `assertKnowledgeReady`: cuenta documentos activos con pasajes por jurisdicción. Un registro de fuentes sin documentos **no** es conocimiento.
- Guard de arranque `PRECISION_REQUIRE_KNOWLEDGE_SEED=true` (+ `PRECISION_REQUIRED_KNOWLEDGE_COUNTRIES`, por defecto MX): el backend de producción no arranca con la capa sin la semilla.
- `scripts/kl-seed.ts`: carga la semilla inicial desde un manifiesto (idempotente; archivos confinados a la carpeta del manifiesto; `--check` de solo lectura; sale con 1 si no está lista).
- Despliegue: fase `seed` (job Cloud Run con el bucket de semilla montado de solo lectura) y smoke S6 (`kl-seed --check`). `not_available` sigue siendo semánticamente válido (país sin conocimiento) y no se reabrió.

### Equivalencias (punto 3)
No existe almacén de equivalencias en Precision ni en KL; se envía `originCountry`. El paquete de contexto/RAM compilado es un entregable de KL MVP1 que no está en el contrato `kl.v1`; **no se creó un segundo almacén permanente**. Cuando KL lo entregue, Precision lo consumirá por el contrato.

### Diferencias no bloqueantes frente al handoff
La señal de demanda no guarda stage/idioma/candidato propuesto (sin cambio de esquema); el contrato aún no incluye operaciones de paquete de contexto/uso (ítems de KL MVP1); el código de industria no se envía.

## 2. Cambios exactos al límite Precision↔KL
- `knowledge-layer/contract.ts`: `Stage`; `KnowledgeRequest` estructurado; eliminados `question`, `context.candidates`, `Interpretation`, `boundary`/`interpretation` de la respuesta, `DemandContext`, `interpret()`; `Limit.granularity` con `{place}`; `recordDemand(refs, signal)`.
- `knowledge-layer/vocabulary.ts` (nuevo, puro): `readQuestion`, `readGeography`, `normalizedQuery`, `BOUNDARY_AREA`.
- `demand.ts`/`pg-repo.ts`: `DemandRefs` + `assertOpaqueRefs`; el repositorio rechaza ids crudos. `service.ts`/`orient.ts`: sin interpretar texto.
- `precision/knowledge-client/adapters.ts` + `demand-refs.ts` (nuevo): clasificación local, solicitud estructurada, referencias HMAC. `precision/api/wiring.ts`: secreto exigido en producción y guard de semilla.
- `readiness.ts`, `scripts/kl-seed.ts`, fase `seed` y smoke S6 en `precision-stabilization.sh`.

## 3. Regresión (resultados reales)
- Unitarias backend: **88 suites / 1.885 pruebas verdes** (antes 85 / 1.856). `tsc --noEmit`, `eslint --max-warnings=0` y `npm run build`: limpios.
- Integración (PostgreSQL local limpio, 50 migraciones): **40 suites / 347 pruebas verdes**; 6 suites omitidas por requerir URLs de runtime/modelo real.
- Las pruebas exactas pedidas:
  1. *Sin pregunta cruda* — `knowledge-boundary-privacy`: «una pregunta cargada de detalle identificable produce una solicitud solo de dimensiones estructuradas»; «KL nunca recibe una pregunta: no hay llamada `interpret` ni argumento de texto»; estático «nunca llama `interpret`, nunca pasa la pregunta ni el project id».
  2. *Sin `project_id` real* — «la señal solo contiene dimensiones controladas y dos referencias de 32 hex»; `kseed-first`: el repositorio rechaza un id crudo.
  3. *Sin candidatos de contexto del proyecto* — «las solicitudes de contexto del proyecto llevan temas y estados, no hechos del proyecto»; las claves del cable ⊂ conjunto permitido (grabadora a nivel de cable: sin PII, nombres, cifras ni lugares).
  4. *Demanda con referencia opaca irreversible* — «el mismo proyecto da la misma referencia…», «es irreversible sin la llave: ningún hash simple o con sal sin llave la reproduce», «se niega con un secreto débil», «la recurrencia por proyectos distintos funciona de punta a punta; un turno reintentado cuenta una vez».
  5. *Recuperación estructurada* — `imco-real` (IMCO real, 6/6): estados, página y fuente citados, celda publicada exacta, guardas de granularidad/autoridad.
  6. *E2E portugués* — `knowledge-layer.int` A: empresa portuguesa, IMCO llega a la conversación solo por el contrato, con fuente; el mapa confirma.
  7. *Parcial / no_available* — `knowledge-layer.int` B (parcial + frontera profesional + señal normalizada sin texto) y C (Chile: no disponible, límite declarado, el diagnóstico continúa, demanda señalada). D: Doing Business México por el mismo contrato.
  8. *Sin ruta web* — frontera: «ningún módulo importa un cliente de red ni llama fetch/WebSearch»; «el Knowledge Agent no es alcanzable desde la conversación ni desde el contrato»; el adaptador no abre red.
  9. *Semilla* — `readiness.test`: capa con fuentes sin conocimiento **no** está lista; lista solo con la semilla publicada; manifiesto válido/ inválido.

## 4. Identidad de Admin: **A — REUTILIZAR la identidad Google/IAP existente**
El inicio de sesión de Admin es OIDC estándar (`admin/oidc.ts`), agnóstico de proveedor, con lista de dominios permitidos; la autorización es la tabla `admin_user` aprovisionada + RBAC (no entra quien no esté aprovisionado). Google es un proveedor OIDC estándar (emisor `https://accounts.google.com`, PKCE S256, `hd`/dominio verificado). Prueba `admin-google-identity.test` (3): solicitud de autorización (code + PKCE + state + nonce), cuenta `beeside.you` con token con forma Google aceptada, y rechazo de todo lo que no sea una cuenta `beeside.you` verificada. **No hay nada que un IdP separado aporte** para ESTABILIZACIÓN (IAP ya limita al dominio; Admin añade su RBAC). No se introduce ningún IdP.

Es solo configuración (fase `admin` del script, con aprobación): ADMIN_API_ENABLED, ADMIN_APP_ORIGIN, ADMIN_OIDC_ISSUER/CLIENT_ID/REDIRECT_URI, ADMIN_ALLOWED_EMAIL_DOMAINS=beeside.you, secretos `ADMIN_OIDC_CLIENT_SECRET` (creado por el operador en Secret Manager) y `ADMIN_SESSION_SECRET` (generado, nunca impreso). **Primer administrador:** `provision-admin` es solo de desarrollo; añadí `scripts/admin-bootstrap.ts`, job de un solo uso y auditado que crea **un** SUPER_ADMIN (dominio permitido, se niega si ya existe uno, no crea credencial; la persona entra con su Google). 3 pruebas (dominio, creación+auditoría+rechazo del segundo, dominio ajeno).

## 5. Bloqueos que quedan (todos externos)
1. **Proyecto GCP de producción y acceso** (proyecto + facturación; sesión `gcloud` autenticada). Sin eso no corre ni el `check` de solo lectura.
2. **Contenido de la semilla inicial** de KL en un bucket privado con `manifest.json` (el mecanismo y el guard están listos y probados con los PDF reales de IMCO).
3. **Cliente OAuth Web (Internal, `beeside.you`)** creado en la consola, su secreto en Secret Manager y el correo del primer SUPER_ADMIN.
4. Aprobación del gate **STABILIZATION DEPLOYMENT APPROVAL**. (Destino de migraciones: **50/50**, por la 0049 `resource_type`, ya señalada.)

**ESTABILIZACIÓN DEPLOYMENT READY: NO** — solo por los bloqueos externos 1–4; no queda trabajo de ingeniería pendiente sin credenciales.
