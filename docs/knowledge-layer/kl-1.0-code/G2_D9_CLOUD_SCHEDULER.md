# G2 · D9 · Cloud Scheduler para KL en dev (worker cada 5 min, creado en pausa) — PREPARADO, NO EJECUTADO

Base: `kl-worker:835d2a2…` publicado, ciclo ejecutado a mano con éxito (agentes apagados, 0 trabajos), Terraform de `envs/dev-kl` sin deriva. Todo por el módulo propio de KL; nada toca otras plataformas. Script: `scripts/kl/g2/d9-scheduler.sh` (probado en `plan`; se niega a cambiar algo sin `D9_CONFIRM=yes`).

## Hallazgo que cambió el diseño
**Cloud Scheduler no está disponible en `northamerica-south1` (Querétaro)**; la página oficial de ubicaciones solo lista, en Norteamérica, `northamerica-northeast1/2` y `us-central1/east1/east4/south1/west1/west2/west3/west4`. El módulo usaba la región del proyecto y el `apply` habría fallado. Corregido: variable `scheduler_region` con valor por omisión **`us-south1` (Dallas, la soportada más cercana)**. Es solo la ubicación de la definición del schedule; los destinos son APIs HTTPS (Cloud Run Admin y Cloud SQL Admin) y el worker sigue corriendo en `northamerica-south1`. Implicación de residencia: los metadatos del schedule (nombre, cron, URL de la API) viven en EE. UU.; no contienen datos.

## Qué se crea (plan verificado: **6 altas, 0 cambios, 0 destrucciones**; sin D9 el plan queda en 0 cambios)
| # | Recurso | Detalle |
|---|---|---|
| 1 | `google_project_service.scheduler` | habilita `cloudscheduler.googleapis.com` en `beeside-dev-508220` (cambio de proyecto compartido, aditivo; `disable_on_destroy=false`) |
| 2 | `google_cloud_scheduler_job.worker_tick` | `beeside-dev-kl-worker-tick`, `*/5 * * * *` UTC, **`paused=true`**, `POST https://run.googleapis.com/v2/projects/beeside-dev-508220/locations/northamerica-south1/jobs/beeside-dev-kl-worker:run` con token OAuth de `beeside-dev-kl-scheduler@` |
| 3 | `google_cloud_scheduler_job.daily_export` | `beeside-dev-kl-daily-export`, `30 8 * * *` UTC, **`paused=true`**, `POST …/sql/v1/projects/…/instances/beeside-dev-kl-db/export` hacia `gs://beeside-dev-508220-beeside-dev-kl-exports/daily/beeside_kl.sql.gz` (el bucket está versionado: la historia se conserva) |
| 4 | `google_cloud_run_v2_job_iam_member.scheduler_runs_worker` | `roles/run.invoker` para `beeside-dev-kl-scheduler@` **solo sobre el job `beeside-dev-kl-worker`** |
| 5 | `google_project_iam_custom_role.kl_export` | rol `klExportOnlyDev` con **un solo permiso**, `cloudsql.instances.export` |
| 6 | `google_project_iam_member.scheduler_export` | ese rol para `beeside-dev-kl-scheduler@`, **con condición IAM** `resource.name == "projects/beeside-dev-508220/instances/beeside-dev-kl-db"` (no sirve para la instancia canónica) |
Sin schedules para ninguna otra plataforma; la cuenta `beeside-dev-kl-scheduler@` ya existe desde la Fase 1.

## Comandos (en este orden; cada paso se autoriza o se agrupa expresamente)
```bash
cd /Users/miguelortega/Developer/beeside-kl
bash scripts/kl/g2/d9-scheduler.sh plan                                  # solo lectura: 6/0/0
D9_CONFIRM=yes bash scripts/kl/g2/d9-scheduler.sh apply                  # habilita la API y crea los 2 schedules EN PAUSA; verifica solo
bash scripts/kl/g2/d9-scheduler.sh verify                                # estado PAUSED, rol e IAM, plan sin deriva
D9_CONFIRM=yes bash scripts/kl/g2/d9-scheduler.sh run-now export         # prueba única del camino de exportación (condición IAM + permiso)
D9_CONFIRM=yes bash scripts/kl/g2/d9-scheduler.sh run-now worker         # prueba única del tick (si la API rechaza ejecutar un job en pausa: usar resume)
D9_CONFIRM=yes bash scripts/kl/g2/d9-scheduler.sh resume                 # SOLO tras las dos pruebas: activa el tick cada 5 min (y "resume export" para el diario)
```
Verificación de cada prueba (solo lectura): `gcloud run jobs executions list --job beeside-dev-kl-worker --region northamerica-south1 --limit 3` (una ejecución nueva **creada por el schedule**, `exit 0`, un solo intento); `gcloud storage ls -l gs://beeside-dev-508220-beeside-dev-kl-exports/daily/` (objeto nuevo con su versión); en Cloud Logging, `protoPayload.authenticationInfo.principalEmail = beeside-dev-kl-scheduler@…`. **Tras activar:** comprobar durante 2–3 ticks `retriedCount` y la ausencia de `exit(1)` (aquí se confirma con muestras el fallo intermitente de conexión ya corregido con 10 s).

## Rollback
```bash
D9_CONFIRM=yes bash scripts/kl/g2/d9-scheduler.sh pause                  # detención inmediata, conserva todo
D9_CONFIRM=yes bash scripts/kl/g2/d9-scheduler.sh rollback               # destruye los 5 recursos de KL de D9 (schedules, IAM, rol)
gcloud services disable cloudscheduler.googleapis.com --project beeside-dev-508220   # opcional: la API queda habilitada tras el rollback
```
Un tick que ya se disparó termina solo (el worker es idempotente y reclama con `SKIP LOCKED`); pausar no interrumpe una ejecución en curso.

## Riesgos
| Riesgo | Detalle / mitigación |
|---|---|
| **Cambio en el proyecto compartido** | Se habilita una API y se crean un rol personalizado y una asignación condicionada (aditivos, KL-owned, sin afectar a otras plataformas). Todo reversible salvo que la API queda habilitada |
| **Condición IAM del export** | `resource.name` de Cloud SQL tiene el formato `projects/<proyecto>/instances/<instancia>`; si el formato no coincidiera, la exportación respondería 403 en la prueba `run-now export` **antes** de reanudarla (por eso existe esa prueba). No se asume: se verifica |
| Ejecuciones solapadas | Un tick cada 5 min con ciclos de ~10–20 s; si una ejecución se atrasara, Cloud Run permite ejecuciones paralelas y la cola usa `FOR UPDATE SKIP LOCKED` con `lease_token`; el daño posible es nulo con agentes apagados |
| Falla silenciosa | Sin alertas de Monitoring (fuera de alcance): una racha de `exit(1)` solo se vería en los registros. Recomendado: alerta sobre ejecuciones fallidas del job (decisión posterior) |
| Ruido y costo | 288 ejecuciones/día × ~8–20 s de 1 vCPU/2 GiB ≈ entre 2.300 y 5.800 vCPU-s/día (70–170 mil/mes) y 140–350 mil GiB-s/mes: **dentro o en el límite del nivel gratuito** de Cloud Run (180 mil vCPU-s y 360 mil GiB-s/mes) si nadie más lo consume; 2 schedules entran en los 3 gratuitos de Cloud Scheduler por cuenta de facturación (compartida con otros proyectos: no verificable aquí). Orden de magnitud: 0–5 USD/mes. Sin verificar contra la calculadora oficial |
| Exportación diaria sobre una instancia `db-g1-small` | La exportación SQL de una base pequeña es breve; sobrecarga mínima en la ventana 08:30 UTC (02:30 CDMX) |
| Deriva de Terraform | Un `terraform apply` posterior **sin** `-var scheduler_enabled=true` destruiría los schedules. El script siempre pasa las variables; tras la aprobación se debe fijar `scheduler_enabled`/`scheduler_paused` por omisión en `envs/dev-kl/main.tf` (cambio KL) |
| Rol del worker en producción | Hoy el tick solo hace mantenimiento (planificación, triage, caducidades) con agentes apagados; activar los agentes es otra decisión y exigiría control de salida a red (G3) |
| Dependencias abiertas | Adaptador GCS (D8): el worker en `NODE_ENV=development` usa disco efímero y **no publica ediciones**; el tick activo no lo necesita. Procesos de fondo del backend que escalan a cero: independientes de este cambio |

## Qué necesito
Autorización expresa de: (1) `apply` (habilita la API y crea los 2 schedules **en pausa**), (2) las pruebas `run-now export` y `run-now worker`, y (3) por separado, `resume` (activación periódica).
