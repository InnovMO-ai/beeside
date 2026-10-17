# G2 · Fase 7 · kl-worker (agentes apagados), pruebas X26/X27 y restauración X24 — PREPARADO, NO EJECUTADO

Base: S3/S4 verificados; `kl-worker:7af37659…` publicado y `beeside-dev-kl-worker` apuntando a una imagen de la serie `kl-worker` (job sin ejecutar nunca). Agentes apagados (`kl.agents_enabled=false`, `KL_AGENTS_ENABLED=false`), `PRECISION_KNOWLEDGE_PROVIDER=off`, sin Cloud Scheduler.

## 7.1 Pruebas de aislamiento de credenciales X26 y X27 (solo lectura: intentos que deben FALLAR)
Requieren que el operador (Owner) pueda suplantar las dos cuentas (`roles/iam.serviceAccountTokenCreator`; el Owner suele tenerlo, y si no, el error será «Failed to impersonate», distinto de `PERMISSION_DENIED`). Los intentos descartan la salida para no mostrar un valor si, por error, tuvieran éxito:
```bash
P=beeside-dev-508220
# X26 · el backend (cuenta compute) NO puede leer las credenciales del worker
gcloud secrets versions access latest --secret beeside-dev-kl-agent-url      --project $P --impersonate-service-account=640247497574-compute@developer.gserviceaccount.com >/dev/null 2>/tmp/x26a.err; echo "agent exit=$?"; head -c 200 /tmp/x26a.err
gcloud secrets versions access latest --secret beeside-dev-kl-knowledge-url  --project $P --impersonate-service-account=640247497574-compute@developer.gserviceaccount.com >/dev/null 2>/tmp/x26b.err; echo "knowledge exit=$?"; head -c 200 /tmp/x26b.err
# X27 · el worker NO puede leer la credencial de la base principal ni la del migrador de la plataforma
gcloud secrets versions access latest --secret beeside-dev-database-url           --project $P --impersonate-service-account=beeside-dev-kl-worker@$P.iam.gserviceaccount.com >/dev/null 2>/tmp/x27a.err; echo "database-url exit=$?"; head -c 200 /tmp/x27a.err
gcloud secrets versions access latest --secret beeside-dev-migration-database-url --project $P --impersonate-service-account=beeside-dev-kl-worker@$P.iam.gserviceaccount.com >/dev/null 2>/tmp/x27b.err; echo "migration-url exit=$?"; head -c 200 /tmp/x27b.err
rm -f /tmp/x26a.err /tmp/x26b.err /tmp/x27a.err /tmp/x27b.err
```
**Esperado:** los cuatro con `exit≠0` y `PERMISSION_DENIED`. Evidencia complementaria (sin suplantar): `gcloud secrets get-iam-policy` de `beeside-dev-kl-agent-url`/`-knowledge-url` debe listar solo `beeside-dev-kl-worker@…` y el de `beeside-dev-database-url` no debe incluirlo. **Límite que debe quedar escrito:** `kl-worker` tiene `roles/cloudsql.client` a nivel de proyecto (único alcance posible), es decir, *podría conectarse* a la instancia canónica; no tiene **ninguna credencial** para autenticarse (X27), y la prueba demuestra eso, no ausencia de ruta de red.

## 7.2 Primera ejecución del worker (agentes apagados)
```bash
gcloud run jobs execute beeside-dev-kl-worker --region northamerica-south1 --project beeside-dev-508220 --wait
gcloud logging read 'resource.type="cloud_run_job" AND resource.labels.job_name="beeside-dev-kl-worker" AND logName:"stdout"' --project beeside-dev-508220 --limit 3 --freshness=15m --format=json | python3 -c 'import sys,json;[print(d.get("jsonPayload") or d.get("textPayload")) for d in json.load(sys.stdin)]'
```
**Esperado:** ejecución completada con exit 0 y una línea `{"level":"info","message":"kl-worker cycle","claimed":0,"succeeded":0,"failed":0,…}`. Con `NODE_ENV=development` y `KL_RENDER_ENABLED=true` el worker usa el almacén local de desarrollo (`./.kl-storage`), que **no** sirve para publicar ediciones (falta el adaptador GCS, D8); en esta ejecución no hay trabajos de render, así que no escribe archivos. Efectos esperados en `beeside_kl`: atestaciones de servicio de `kl_agent`/`kl_knowledge` y, si el planificador encuentra algo vencido, trabajos de planificación (no hay fuentes todavía); **ningún trabajo de agente se reclama** (apagados por la base y por configuración). Riesgos: ninguno para otras plataformas (cuenta, secretos y conexiones propias); si falla el arranque de Chromium o la conexión por el socket `/cloudsql`, el job termina con error sin cambiar datos. **Rollback:** no hay estado que deshacer; si dejara filas, se reinicia con `DROP SCHEMA kl CASCADE` y re-migración mientras no haya datos reales (ver Fase 5.4), aunque aquí no se espera ninguna.

## 7.3 X24 · exportación y restauración en `beeside_kl_restore`
1. Exportación: `gcloud sql export sql beeside-dev-kl-db gs://beeside-dev-508220-beeside-dev-kl-exports/post-migration/post-KL-0001-0005-<sha>.sql.gz --database=beeside_kl --project beeside-dev-508220` (la de antes de migrar ya existe y sirve como caso base).
2. Crear `beeside_kl_restore` con dueño `kl_owner`: requiere un aprovisionador temporal (usuario de API de vida corta con `GRANT kl_owner` → `CREATE DATABASE beeside_kl_restore OWNER kl_owner` → `REVOKE` → eliminar al terminar), el mismo patrón de la Fase 4/W0. **Por verificar en el ensayo:** que `gcloud sql import sql` pueda crear los objetos con dueño `kl_owner` (puede exigir `--user`).
3. Importar y comparar: recuento de filas por tabla y huella del diario `kl.__kl_migrations` contra `beeside_kl`; luego `DROP DATABASE beeside_kl_restore`.
**Riesgo:** nueva base en `beeside-dev-kl-db` y una ventana de segundos con un miembro de `cloudsqlsuperuser` extra (como en W0). Rollback: `DROP DATABASE beeside_kl_restore`; borrar el objeto exportado.

## 7.4 Pendientes que NO forman parte de este bloque (decisiones abiertas)
Cloud Scheduler y programación del worker (D9; `scheduler_enabled=true`, creada pausada), adaptador GCS (D8), procesos de fondo que escalan a cero (reconciliador y correlación X30), cuenta de servicio propia del backend (D3), `padmin@beeside.you` (titular y autenticación), revisión manual AC-13, migración de Node 20, PR de la cookie de login y PR de Analytics para Plataforma, y `push` de los commits locales de KL.

## Qué necesito
Autorización expresa de **7.1 + 7.2** (bajo riesgo: intentos que deben fallar y un ciclo del worker que no reclama trabajos) y, por separado, de 7.3.
