# KL dev · runbook de aprovisionamiento (PREPARADO, NO EJECUTADO)

Cada fase requiere aprobación expresa del PO. Estado de cada fase: pendiente. Precondiciones: `scripts/kl/preflight.sh --gate` en OK; Terraform ≥ 1.7; `gcloud` con la cuenta del operador; `cloud-sql-proxy` (usar `--gcloud-auth`, el ADC puede estar vencido).

## Fase 0 · plan sin cambios
```bash
cd infra/terraform/envs/dev-kl
terraform init            # estado propio: prefijo dev-kl; no toca el estado de envs/dev
terraform plan -lock=false -var provisioner_enabled=true     # esperado: solo adiciones (38; 42 con provisioner_enabled; 48 con además scheduler_enabled), 0 cambios, 0 destrucciones
```
Si el plan muestra cualquier cambio o destrucción: **parar**.

## Fase 1 · instancia, secretos, cuentas, buckets, jobs (con aprovisionador)
```bash
terraform apply -var provisioner_enabled=true
```
Crea `beeside-dev-kl-db` (PG16, deletion_protection=true), 5 secretos `beeside-dev-kl-*-url`, `kl_provisioner` y su secreto, 3 cuentas de servicio, 2 buckets y los jobs `beeside-dev-kl-migrate` y `beeside-dev-kl-worker` (con imagen de marcador). No fija contraseña a `postgres`: no puede iniciar sesión.

## Fase 2 · roles y base (SQL, un solo uso) — ensayado el 2026-10-16
Conectar con `cloud-sql-proxy --gcloud-auth --port 5455 beeside-dev-508220:northamerica-south1:beeside-dev-kl-db` como `kl_provisioner` (contraseña del secreto, solo en memoria):
1. `\i backend/src/kl/db/bootstrap/roles.sql` (roles `LOGIN NOSUPERUSER NOCREATEROLE NOCREATEDB`, límites y tiempos).
2. `ALTER ROLE <kl_x> PASSWORD '<valor del secreto beeside-dev-<kl-x>-url>'` para los cinco roles (sin imprimir).
3. Sentencias **separadas** (CREATE DATABASE no corre en un bloque multisentencia): `GRANT kl_owner TO kl_provisioner;` → `CREATE DATABASE beeside_kl OWNER kl_owner;` → `REVOKE ALL ON DATABASE beeside_kl FROM PUBLIC;` → `REVOKE kl_owner FROM kl_provisioner;`
4. Verificar `pg_auth_members`: ninguna fila `kl_*` con `admin_option` ni con `kl_provisioner`.

## Fase 3 · retirar el aprovisionador
```bash
terraform apply -var provisioner_enabled=false      # elimina kl_provisioner y su secreto
```
Después, los únicos miembros de `cloudsqlsuperuser` son `postgres` (sin contraseña) y los usuarios que el operador cree a propósito.

## Fase 4 · G1 (X23): E1–E15
Con el protocolo de `docs/knowledge-layer/kl-1.0-code/G1_G2_PLAN.md` §4 contra la instancia dedicada, **antes de migrar**: como `postgres` es imposible (sin contraseña), la prueba de un principal con privilegios se hace creando temporalmente un usuario por API (`gcloud sql users create g1_probe`), ejecutando E1–E15 con él y borrándolo. Se espera que, como en el ensayo, ese principal *sí* escale: por eso la evidencia que cierra G1 es **la ausencia de cualquier otro miembro de `cloudsqlsuperuser`** (`SELECT member::regrole FROM pg_auth_members WHERE roleid='cloudsqlsuperuser'::regrole` → solo `postgres` y `cloudsql*`) más E1–E15 limpios para un usuario simple. Evidencia en `docs/knowledge-layer/kl-1.0-code/evidence/G1-<fecha>/`. Sin evidencia, no se migra.

## Fase 5 · exportación previa y migración
1. `gcloud sql export sql beeside-dev-kl-db gs://<bucket exports>/pre-migration/<sha>.sql.gz --database=beeside_kl` (base vacía la primera vez).
2. `gcloud run jobs update beeside-dev-kl-migrate --image <imagen runtime del sha> --region northamerica-south1` y `gcloud run jobs execute beeside-dev-kl-migrate --wait`.
3. `X24`: importar la exportación a `beeside_kl_restore`, comparar recuentos/huellas, borrar la base de restauración.

## Fase 6 · worker (agentes apagados)
`gcloud run jobs update beeside-dev-kl-worker --image <imagen runtime-kl-worker del sha>`; ejecutar una vez a mano; X26/X27 (el backend no lee los secretos del worker; el worker no tiene secreto de `beeside`). Los schedules (`scheduler_enabled=true`, decisión D9) se crean **pausados**.

## Backend
Variables `KL_DB_URL_APP` y `KL_DB_URL_READER` en `beeside-dev-backend-api` con `gcloud run services update --set-secrets ...` desde los secretos `beeside-dev-kl-app-url` y `beeside-dev-kl-reader-precision-url` (módulo `cloud-run` ignora deriva de env). `PRECISION_KNOWLEDGE_PROVIDER=off`.

## Rollback
- Antes de la fase 5 (todo vacío): `terraform apply -var deletion_protection=false` y luego `terraform destroy` en `envs/dev-kl`. No afecta a `envs/dev` ni a `beeside-dev-canonical-db`.
- Después de migrar: migración correctiva, o restaurar la última exportación en `beeside_kl_restore` y cambiar los secretos. No usar PITR a nivel de instancia salvo desastre.
- Nunca ejecutar `terraform apply/destroy` en `envs/dev` por KL.
