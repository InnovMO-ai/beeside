# M1 · Publicación de extremo a extremo en dev — estado (2026-10-19)

Autorizado por el PO: GcsObjectStore, edición sintética de punta a punta y alertas; «detente en el paso de aprobación si falta la segunda identidad».

## Hecho y verificado en la nube
| Pieza | Resultado |
|---|---|
| **`GcsObjectStore`** (`backend/src/kl/ingest/gcs-object-store.ts`) | API JSON de Cloud Storage con el token de metadatos de Cloud Run: **sin dependencias nuevas, sin cambios en archivos compartidos**. Escritura solo-creación (`ifGenerationMatch=0`), idempotente por huella, conflicto si la llave existe con otro contenido, reintentos acotados, tiempo límite, llaves validadas, sin registrar tokens. 7 pruebas (KL: **358/358**) |
| Elección por entorno (`objectStoreFromEnv`) | Con `KL_STORE_BUCKET` → Cloud Storage; sin él, almacén local **solo fuera de producción**; en producción sin bucket se niega a arrancar. Cableado en `kl-worker` (deja de rechazar `KL_RENDER_ENABLED` en producción) y en el backend (`store` para la vista previa de administración) |
| IAM del bucket | El backend (cuenta compute) lee **solo `kl/editions/` y `kl/previews/`** (condición IAM; nunca `kl/objects/`), el worker crea y lee; 1 recurso Terraform reemplazado, sin deriva |
| Imágenes | `kl-publish-dev-5bac293` (19 controles de humo): `kl-backend:5bac293c…` y `kl-worker:5bac293c…`; backend de dev en la revisión **`00011-krl`** (rollback: `00010-5q2`), con `KL_STORE_BUCKET`; verificación pública OK (`/health`, `/health/ready`, 401 sin sesión, estado público `unknown`, login → Google) |
| **Prueba real dentro de Cloud Run (identidad del worker)** | Ejecución `beeside-dev-kl-worker-5trnr`: almacén `gcs`; Chromium 153.0.8010.12 renderiza el documento de referencia (3 páginas) con **huella `62b5a150…f942` idéntica a la línea base de AC-10** (host de CI = contenedor = Cloud Run); `putKeyed` → `get` de **315.878 bytes con la misma huella**; segunda escritura idempotente; **sobrescritura con otro contenido rechazada (`conflict`)**; objeto inexistente → `not_found`. Queda `kl/previews/smoke_m1/20261019/es.pdf` (308 KiB) en el bucket, bajo la retención de 30 días |
| **Alertas** (`modules/kl-alerting`, 5 recursos, sin deriva) | Canal de correo `<correo-del-PO>` y 4 políticas: (1) ejecución del worker fallida, (2) más de 2 intentos fallidos en 30 min (el reintento los oculta), (3) el worker **sin ejecuciones 20 min** (schedule pausado o roto), (4) error de Cloud Scheduler en los schedules de KL. **No probadas disparándolas** (exigiría provocar un fallo). Límite documentado: no hay alerta de «sin exportación diaria» (Monitoring limita las ventanas por debajo de 24 h y alertaría cada día); lo cubren la alerta (4) y `verify-scheduled-export.sh` |

## No realizado: la edición sintética de punta a punta (bloqueos materiales)
1. **No hay forma legítima de cargar contenido en dev.** La API de KL Admin (`/api/admin/kl`) no expone la carga de unidades/fuentes/KSeed (I8, I9, I13 sin UI); el KSeed solo existe sintético para pruebas. Sin unidades publicadas no hay qué componer.
2. **Separación de funciones:** quien compone no aprueba y los textos fijos y las ediciones exigen **otra persona** con rol editorial. Hoy hay **un solo humano** (`<correo-del-PO>`, KL_ADMIN). `<cuenta-admin-plataforma>` sigue sin confirmarse.
3. **Sin cliente autenticado para las escrituras:** no hay UI de KL Admin; las escrituras necesitan la cookie de sesión y la cabecera `x-beeside-admin`, y no se crean sesiones ficticias.
4. **Sembrar contenido sintético como `kl_owner` sería irreversible** (tablas de solo inserción, auditoría y triggers): solo podría deshacerse reiniciando el esquema (`DROP SCHEMA kl CASCADE` y re-migrar), aceptable antes de datos reales pero **decisión del PO**.
**Opciones para continuar M1 (decisión del PO):** (a) esperar a M2 (KL Admin UI + carga) y la segunda identidad, y hacer entonces la edición real; (b) sembrar un conjunto sintético con un cargador operado por KL en una base de ensayo `beeside_kl_e2e` (nueva base en la instancia dedicada, con una ventana de usuario privilegiado como en X24) para ejercitar compone → aprueba → render → GCS → estado público → descarga **sin tocar `beeside_kl`**, con los dos «humanos» simulados por principales de prueba (sin sesiones reales: sería una prueba de integración de infraestructura, no de gobierno); (c) un cliente de consola de navegador para que `mo` ejecute las escrituras con su sesión real (sigue faltando la segunda persona).

## Pendiente verificable en cuanto exista una edición real
La lectura de `kl/previews/` por el backend (IAM ya aplicado, no probado con un objeto real porque la ruta exige una edición), el render por el job de una edición real y la descarga autenticada de una edición publicada por el consumidor (Precision).

## Ensayo de punta a punta en la nube (opción b, 19-oct-2026)

Autorizado por el PO: base de ensayo `beeside_kl_e2e` en la instancia dedicada, principales de prueba, sin tocar `beeside_kl`. Script: `scripts/kl/m1/e2e-cloud.sh` (`E2E_CONFIRM=yes`); cargador: `backend/src/kl/testing/cloud-e2e.ts`.

**Resultado: verificado.**
- Ventana privilegiada de ~11 s (usuario de API temporal creó la base con dueño `kl_owner`, se eliminó antes de migrar); el borrado posterior de la base lo hizo `kl_owner`, sin segunda ventana.
- Migración KL-0001…0005 aplicada (10/10) con `expectedDatabase` explícito (el CLI de producción sigue exigiendo `beeside_kl`).
- Mundo sintético con personas de prueba distintas (admin, editores, revisores, revisor editorial, especialista); edición `2026.10` del producto `e2e_synthetic` compuesta y aprobada por otra persona.
- Job `beeside-dev-kl-worker` de Cloud Run apuntado a la base de ensayo: Chromium renderizó ES y EN, `GcsObjectStore` escribió `kl/editions/e2e_synthetic/2026.10/{es,en}/<sha>.pdf` (356 346 B y 356 125 B); edición `published`, job `succeeded`, hash de cada objeto leído del bucket = `pdf_sha256` registrado, ambos con cabecera `%PDF-`.
- Limpieza: base de ensayo eliminada, sin usuarios temporales, `beeside_kl` y los schedulers sin cambios.

**Límites declarados:** no se verificó el estado público ni la descarga autenticada vía backend (el backend sigue apuntando a `beeside_kl`; probarlo exigiría reapuntarlo, un cambio de servicio compartido que no se hizo). Los dos PDF quedan en el bucket 30 días (versionado + retención). La base de ensayo ya no existe; repetir es un solo comando.
