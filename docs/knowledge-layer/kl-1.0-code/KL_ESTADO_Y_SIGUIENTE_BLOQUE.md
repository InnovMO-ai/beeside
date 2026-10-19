# KL 1.0 · Estado real y siguiente macro-bloque (corte 2026-10-19, 17:5x UTC)

## 1. G2 — **NO VERIFICADA todavía (bloqueo: sesión de `gcloud` caducada)**
El 19-oct a las 17:58 UTC `gcloud` respondió `Reauthentication failed` (la reautenticación vence y exige navegador), así que **no se pudo consultar Cloud Scheduler, Cloud Logging, Cloud Storage ni Cloud SQL**. No se afirma nada sobre la exportación del 18-oct 08:30 UTC. Defecto propio hallado y corregido: con `gcloud` roto, `verify-scheduled-export.sh` respondía «aún no ha disparado» (falso negativo); ahora **sale con código 4** («no se pudo consultar») y no declara nada. Para cerrar G2: `gcloud auth login` (cuenta `mo@beeside.you`) y `bash scripts/kl/g2/verify-scheduled-export.sh` (0 = verificada, 1 = falla → `d9-scheduler.sh pause export` y diagnóstico, 3 = no disparó, 4 = sin consulta). Verificaciones adicionales pendientes con la misma sesión: salud del worker desde el viernes (ejecuciones fallidas o reintentadas en ~2 días de ticks cada 5 min) y estado de la instancia.

## 2. Estado verificado hoy sin GCP
- Rama `feat/kl-1.0-code` @ `be4c17c` (= `origin`), 63 commits sobre `main` (`bc3f527`, que **no se ha movido**; 0 commits por detrás, sin archivos en conflicto). `kl-ci` y `kl-preflight` verdes en los últimos tres pushes. Etiquetas de publicación: `kl-publish-dev-7af3765`, `-8f82c58`, `-835d2a2` (esta última es la imagen vigente de worker y migración). Único cambio sin commitear: la corrección del script de verificación (se sube con este documento).
- Último estado conocido de dev (17-oct, 18:05 UTC): instancia dedicada `beeside-dev-kl-db`, KL-0001…0005 migradas, G1 cumplida, X24 hecha, worker y exportación programados y activos, backend de dev con KL cableado y Admin API con Google, primer KL_ADMIN `mo@beeside.you`, CR-KL-003 v1.0 aprobado.
- Rama local sin subir: `fix/admin-analytics-tab-switch-blank-screen` (defecto de la plataforma, 1 commit sobre `main`).

## 3. Clasificación de lo construido (Matriz de implementación I1–I24)
Leyenda: **C** construido y probado en CI local/efímero · **D** integrado y verificado en dev · **R** probado con datos/condiciones reales · **P** pendiente.
| Ítem | Contenido | C | D | R | Nota |
|---|---|---|---|---|---|
| I1 | Esquema, roles, triggers, transiciones | ✔ | ✔ | ✔ | G1/X23/X24 en dev |
| I2 | Repositorio de unidades/versiones | ✔ | ✔ (esquema) | — | sin datos reales |
| I3 | Consulta `kl.v1` (lado KL) | ✔ | parcial | — | vistas listas; sin consumidor real (Precision apagado) |
| I4 | Puerto `knowledge` en Precision | — | — | — | **lo implementa el responsable de Precision**; `PRECISION_KNOWLEDGE_PROVIDER=off` |
| I5 | Paquetes de contexto y manifiesto | ✔ | — | — | |
| I6 | `approvedClaims` tras bandera `false` | ✔ | ✔ (bandera) | — | CR-KL-001 es de Precision |
| I7 | Demanda, señales, grupos | ✔ (API) | — | — | **sin UI** |
| I8 | Canal de carga (validador, CSV, original inmutable) | ✔ | — | — | solo extractor CSV; **sin adaptador GCS** (D8) y sin extractor de PDF |
| I9 | Carga de KSeed | ✔ (**sintética**) | — | — | **KSeed real no cargado** |
| I10 | Source Registry y aprobación | ✔ | ✔ (esquema) | — | |
| I11 | Agente de recolección | **✗** | — | — | no hay manejador de `collect`/`review_now` ni cliente HTTP en KL; requiere G3 |
| I12 | Agente de conocimiento (compilación) | **✗** (el compilador de RAM sí) | — | — | `compile_package` sin manejador |
| I13 | KL Admin (8 espacios) en el Control Center | API ✔ (490 líneas) | API ✔ (`/kl/me` real) | — | **UI de frontend no existe** |
| I14 | `kl.role_grant` y permisos | ✔ | ✔ | ✔ | primer KL_ADMIN real; 1 solo humano |
| I15 | Validación especializada | ✔ | — | — | |
| I16–I17 | Composición, avisos, builder `knowledge_guide` | ✔ | — | — | modelo KL-local (desviación de §8.2 documentada) |
| I18 | Render Chromium determinista | ✔ (macOS y Linux; contenedor = host) | worker corre; **0 renders reales** | — | sin almacén GCS el worker no publica |
| I19 | Controles de publicación y aprobación | ✔ | — | — | requiere **segunda persona** para aprobar |
| I20 | Estado público de edición | ✔ | ✔ (`unknown` real) | — | |
| I21 | Descarga autenticada (lado Precision) | ✔ (lado KL) | — | — | |
| I22, I24 | Tema `db.v3b`, enlaces administrables | ✔ | — | — | |
| I23 | Periodicidad y planificador | ✔ | ✔ (ticks reales) | — | 0 trabajos, sin fuentes |
Escenarios A01–A10: con prueba explícita en CI A02, A03, A04, A06, A08, A09, A10; **sin cubrir** A01 (Portugal→México, exige Precision), A05 (ICE 2026, exige agente I11) y A07 (edición real ES/EN; solo con fixture). Criterios AC-01…AC-13 con prueba en CI (AC-07 y AC-09 por las pruebas de avisos y revocación, sin la etiqueta en el título); **AC-11** (misma cifra en Precision y PDF) y **AC-14** (edición sin intervención técnica con roles reales) **pendientes**; **AC-13** con revisión manual con lector de pantalla pendiente.

## 4. Pendientes por naturaleza
**Para la versión comercial (funcionales):** (1) **D8 adaptador de Cloud Storage** y publicación de extremo a extremo; (2) **KL Admin UI** (I13); (3) **agentes I11/I12** + **G3** (control de salida a red) + proveedor del modelo; (4) **KSeed real** y validación factual del contenido (Doing Business México **no se ha publicado**; su contenido factual está pendiente de validación); (5) **integración con Precision** (puerto, AC-11, A01, CR-KL-001); (6) más identidades humanas (separación de funciones; `padmin@beeside.you` sin confirmar); (7) staging y producción según CR-KL-003 (HA regional, Terraform propio por entorno, G1–G4 por entorno).
**Operativos:** alertas de Monitoring (worker/exportación), procesos de fondo del backend con escala a cero (reconciliador y correlación X30), cuenta de servicio propia del backend (D3), X26 empírico, migración de Node 20, `SECURITY_HASH_SECRET` literal y demás hallazgos de Plataforma (PR de la cookie y de Analytics sin llevar a `main`), decisión sobre cuándo y cómo fusionar a `main` (`DEPLOY_DEV_ENABLED=true`).

## 5. Siguiente macro-bloque recomendado: **M1 · Publicación real de extremo a extremo en dev**
**Por qué este y no otro:** reutiliza el 100 % de lo construido (compositor, controles, render determinista, jobs, descarga autenticada, estado público, schedules, worker ya desplegado) y cierra el único hueco que impide que la tubería produzca un producto en la nube; es el prerrequisito común de la UI (I13), de los agentes y de cualquier PDF comercial. Los agentes y G3 son los de mayor riesgo y dependen de decisiones externas; la UI es grande y se beneficia de tener primero una publicación real que mostrar.
**Alcance (acotado, sin nuevas dependencias compartidas):**
1. **`GcsObjectStore`** que implementa la interfaz `ObjectStore` existente con la API JSON de Cloud Storage y el token de la cuenta de servicio del metadato de Cloud Run (sin `@google-cloud/storage`: **sin cambios en `package.json` compartido**); activo con `KL_STORE_BUCKET`; el worker deja de negarse a renderizar en producción cuando existe.
2. **Edición sintética de punta a punta en dev** (producto de prueba, **no** Doing Business México): compone → envía → aprueba → render en el job del worker → almacenamiento en el bucket (con retención) → estado público real → descarga autenticada con sesión real, y **AC-10 sobre la edición real en Cloud Run**.
3. **Observabilidad mínima:** alerta de Monitoring sobre ejecuciones fallidas del worker y de la exportación (decisión de dónde notificar: PO).
4. Cierre de G2 (verificación pendiente) y, si el PO lo decide, instancia mínima con CPU asignada para los procesos de fondo.
**Bloqueo material para el paso «aprueba»:** la separación de funciones impide que quien compone apruebe; hace falta **una segunda identidad humana** real con rol editorial (p. ej. confirmar el titular de `padmin@beeside.you`, aprovisionarlo y asignarle el rol). Sin ella, M1 llega hasta «en aprobación» y se completa en cuanto exista.
**Después (en este orden):** M2 KL Admin UI (I13) · M3 KSeed real + validación de contenido + integración con Precision · M4 agentes + G3 · M5 staging/producción (CR-KL-003).

## 6. Decisiones que necesita el PO
(1) `gcloud auth login` para cerrar G2 hoy. (2) ¿Se autoriza M1 (incluye un cambio de código en KL y un despliegue de imagen de rama por la tubería ya aprobada)? (3) Titular y rol de la segunda identidad humana. (4) Canal de notificación de alertas. (5) ¿Instancia mínima con CPU asignada en el backend de dev? (6) Cuándo llevar a `main` los parches de la plataforma y la rama de KL.
