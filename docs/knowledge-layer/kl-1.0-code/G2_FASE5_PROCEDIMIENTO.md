# G2 · Fase 5 · Publicar imágenes, exportación previa, migrar KL-0001…0005 y repetir E1–E15

Estado: **PREPARADO. NADA SE HA EJECUTADO.** Cada subfase requiere autorización expresa del PO (puede darse en bloque, pero hay puntos de parada). Entorno: `beeside-dev-508220`, región `northamerica-south1`, instancia dedicada `beeside-dev-kl-db`. Base de partida: commit `84f0870` de `feat/kl-1.0-code`, `kl-ci` y `kl-preflight` en verde.

## 0. Bloqueos y precondiciones

| # | Precondición | Estado hoy |
|---|---|---|
| P1 | **`gcloud` del operador sin sesión válida**: en el diagnóstico de hoy `gcloud` respondió `Reauthentication failed` (la reautenticación vence y exige navegador). Hace falta `gcloud auth login` **por ti** (yo no puedo hacerlo no interactivo). Sin ello no se pueden ejecutar 5.2–5.6 | **BLOQUEA** |
| P2 | `scripts/kl/preflight.sh --gate` en OK y `origin/feat/kl-1.0-code == HEAD` local | OK en `84f0870` |
| P3 | `terraform plan` de `envs/dev-kl` sin cambios (`-detailed-exitcode` = 0) | OK en la última comprobación |
| P4 | `beeside-dev-kl-db` en `RUNNABLE`; usuarios = cinco `kl_*` y `postgres`; `beeside_kl` vacía | OK tras Fase 4 |
| P5 | **Congelación de las migraciones.** Al migrar, el diario `kl.__kl_migrations` fija el SHA-256 de cada archivo; el runner falla si cambia un archivo ya aplicado. A partir de aquí KL-0001…0005 son **inmutables en dev-kl** (cualquier cambio = KL-0006+). Hasta hoy podían editarse porque no estaban aplicadas en ningún entorno compartido. **Necesito que confirmes la congelación** | **DECISIÓN PO** |
| P6 | Imágenes publicadas (5.1) | pendiente |

Huellas que deben aparecer en el diario (primeros 16 hex; completas en el archivo): `KL-0001_base 047d0099…`, `_integrity a6d234b4…`; `KL-0002_schema dd3436c7…`, `98548b8d…`; `KL-0003_domain 7ba3f367…`, `4c989689…`; `KL-0004_governance bfd3c6e9…`, `98ec7f2a…`; `KL-0005_products fb47e862…`, `5342158a…`.

## 5.1 Publicar las imágenes (cambia Artifact Registry y la configuración de 2 jobs de KL)

Mecanismo: workflow `.github/workflows/kl-publish-images.yml` (en la rama; **no** se puede disparar con `workflow_dispatch` porque GitHub exige el archivo en la rama por defecto). Se dispara empujando una etiqueta `kl-publish-dev-*` sobre un commit de la rama KL. Corre `images.sh` (los mismos 19 controles que `kl-ci`, ahora con `KL_SMOKE_REQUIRE_BASELINE=1`) y **publica exactamente las imágenes que pasaron la prueba**, con nombres propios:
- `northamerica-south1-docker.pkg.dev/beeside-dev-508220/beeside-dev/kl-backend:<sha>` (destino `runtime`, usado por `beeside-dev-kl-migrate`)
- `.../kl-worker:<sha>` (destino `runtime-kl-worker`)
y ejecuta `gcloud run jobs update` sobre `beeside-dev-kl-migrate` y `beeside-dev-kl-worker` (solo cambia la imagen; **no ejecuta los jobs**). Autenticación WIF con `beeside-dev-ci-deployer` (tiene `artifactregistry.writer` en el repositorio, `run.developer` en los jobs de KL y `serviceAccountUser` sobre sus cuentas, todo ya aplicado en Fase 1; el entorno GitHub `dev` no restringe ramas).

```bash
# desde el repo, con HEAD == origin/feat/kl-1.0-code
SHA=$(git rev-parse --short HEAD)
git tag kl-publish-dev-$SHA
git push origin kl-publish-dev-$SHA                # único push de esta subfase (una etiqueta)
gh run watch $(gh run list --workflow "KL publish images (manual, dev)" --limit 1 --json databaseId -q '.[0].databaseId')
```
Verificación (solo lectura): el log imprime los *digests*; `gcloud artifacts docker images list northamerica-south1-docker.pkg.dev/beeside-dev-508220/beeside-dev --include-tags` muestra `kl-backend` y `kl-worker` con la etiqueta del SHA, y `backend-api`/`frontend-app` **intactas**; `gcloud run jobs describe beeside-dev-kl-migrate --region northamerica-south1 --format='value(spec.template.spec.template.spec.containers[0].image)'` apunta al `kl-backend:<sha>`.
**Rollback:** `gcloud artifacts docker images delete .../kl-backend:<sha> --delete-tags` (y `kl-worker`), `gcloud run jobs update <job> --image us-docker.pkg.dev/cloudrun/container/hello`, `git push origin :refs/tags/kl-publish-dev-<sha>`. No afecta a otras plataformas.
**Si falla la autenticación o permisos:** el workflow termina antes de empujar nada.

## 5.2 Exportación previa (lectura de la base; escribe un objeto en el bucket de exportaciones)
```bash
gcloud sql export sql beeside-dev-kl-db \
  gs://beeside-dev-508220-beeside-dev-kl-exports/pre-migration/pre-KL-0001-0005-$SHA.sql.gz \
  --database=beeside_kl --project=beeside-dev-508220
gcloud storage ls -l gs://beeside-dev-508220-beeside-dev-kl-exports/pre-migration/
```
La base está vacía: la exportación es el punto de restauración y prueba por primera vez el permiso de escritura de Cloud SQL en el bucket. Si falla por permisos del bucket, **parar** (Terraform ya concede `objectAdmin` a la cuenta de servicio de la instancia). Rollback: borrar el objeto.

## 5.3 Ensayo en seco en el entorno real (conecta, valida rol/base y lint; no aplica nada)
```bash
gcloud run jobs execute beeside-dev-kl-migrate --region northamerica-south1 --project beeside-dev-508220 \
  --args=dist/kl/db/migrate-cli.js,--dry-run --wait
gcloud run jobs executions list --job beeside-dev-kl-migrate --region northamerica-south1 --limit 1
```
Esperado: éxito; la salida del log es `{"applied":[],"pending":[<10 nombres>]}`. Comprueba conexión por el socket `/cloudsql`, que el rol es `kl_owner` y la base `beeside_kl` (el runner se niega en caso contrario), y el lint contra las migraciones de plataforma empaquetadas. **Efecto:** el runner crea de forma idempotente el esquema `kl` y la tabla del diario `kl.__kl_migrations` aun en modo seco (el diario vive en `kl`).
Parar si: `WRONG_DATABASE`, `WRONG_ROLE`, error de conexión o de secreto.

## 5.4 Migración real (irreversible salvo restauración; ver P5)
```bash
gcloud run jobs execute beeside-dev-kl-migrate --region northamerica-south1 --project beeside-dev-508220 --wait
```
`max_retries = 0`, tiempo límite 900 s. Cada archivo se ejecuta en **su propia transacción** junto con su fila de diario (falla = rollback de ese archivo; los anteriores quedan). Esperado: `{"applied":["KL-0001_base","KL-0001_base_integrity",…,"KL-0005_products_integrity"],"pending":[]}`.
**Si falla en el archivo k:** los k-1 anteriores permanecen aplicados y consistentes; se diagnostica con el log (sin credenciales) y se corrige hacia adelante; si el fallo está en un archivo **no aplicado** todavía y el PO lo autoriza, se corrige el archivo (sigue sin estar congelado) y se reintenta. Reinicio completo (solo mientras la base no tenga datos reales): conexión por proxy como `kl_owner` y `DROP SCHEMA kl CASCADE` (el diario se va con él), o restaurar la exportación 5.2; luego repetir 5.3–5.4.

## 5.5 Verificación posterior (solo lectura, por proxy como `kl_owner`)
```bash
cloud-sql-proxy --gcloud-auth --port 5458 beeside-dev-508220:northamerica-south1:beeside-dev-kl-db &
# contraseña de kl_owner: se lee del secreto beeside-dev-kl-owner-url en memoria, nunca se imprime (como en las fases anteriores)
```
```sql
SELECT seq, name, left(sha256,16) FROM kl.__kl_migrations ORDER BY seq;               -- 10 filas con las huellas de arriba
SELECT key, version, value FROM kl.setting_version WHERE key IN ('kl.agents_enabled','kl.r10_claims_enabled') ORDER BY key, version;   -- ambos false (agentes y R10 apagados)
SELECT count(*) FROM information_schema.tables WHERE table_schema='kl';               -- tablas esperadas del esquema
-- ninguna tabla se concede directamente a los roles de aplicación (CR-KL-002 §8.2):
SELECT grantee, count(*) FROM information_schema.role_table_grants
 WHERE table_schema='kl' AND grantee IN ('kl_app','kl_reader_precision','kl_agent','kl_knowledge') GROUP BY 1;   -- 0 filas (acceso por vistas y funciones)
SELECT has_database_privilege(r,'beeside_kl','CONNECT') FROM unnest(ARRAY['kl_owner','kl_app','kl_reader_precision','kl_agent','kl_knowledge']) r;  -- todo true
SELECT has_schema_privilege('public','public','USAGE'), (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r');  -- sin objetos en public
```
(Los grants por vista/función se comprueban con `r3`-/`privilege`-pruebas del repositorio contra una base real solo si el PO lo pide; aquí se verifica el estado del catálogo.)

## 5.6 Repetición de E1–E15 (condición de G1)
Igual que la Fase 4, ahora con objetos y ACL finales (E9/E10 con contenido):
1. Crear temporalmente `g1_admin` (usuario de API, `cloudsqlsuperuser`) → con él `CREATE ROLE g1_probe … NOSUPERUSER NOCREATEROLE NOCREATEDB PASSWORD …` → **eliminar `g1_admin` de inmediato** (ventana de segundos con un miembro extra de `cloudsqlsuperuser`, igual que en la Fase 4).
2. `G1_PROBE_USER=g1_probe G1_PROBE_PW=… G1_PORT=5458 bash scripts/kl/g1/run-e.sh | tee evidencia.txt`.
3. Comprobar miembros de `cloudsqlsuperuser` (solo `postgres` y `cloudsql*`), `terraform plan` sin deriva, y eliminar `g1_probe`.
4. Archivar en `docs/knowledge-layer/kl-1.0-code/evidence/G1-post-KL0001-<fecha>/`. **Resultado exigido:** todos los casos "FALLA ✅", E7 todo `false`, E8 = 0, E9 solo `kl_owner` (+ `pg_database_owner`), E14 = 0. **Si algo no cumple: G1 deja de estar aprobado y se detiene todo.**

## 5.7 Cierre
Registro en `G1_G2_PLAN.md` (resultado, digests, evidencias) y commit local. **No** forma parte de la Fase 5: `kl-bootstrap` (KL_ADMIN), cableado del backend (`KL_DB_URL_APP/READER`), ejecución del `kl-worker`, schedules, restauración X24/X26/X27 (la restauración necesita una base nueva con dueño `kl_owner`, para lo que hay que volver a contar con un aprovisionador temporal: se plantea en su fase), adaptador GCS.

## Riesgos

| Riesgo | Efecto | Mitigación |
|---|---|---|
| Sesión `gcloud` vencida (P1) | No se puede operar | `gcloud auth login` por el PO/operador |
| **Congelación de migraciones** (P5) | Cualquier corrección posterior exige KL-0006+ | Confirmación expresa; 351 pruebas y 3 corridas de CI previas; reinicio total posible mientras no haya datos |
| Fallo a mitad de la secuencia de 10 archivos | Esquema parcial pero consistente (transacción por archivo) | Corregir hacia adelante o `DROP SCHEMA kl CASCADE` / restaurar 5.2 |
| Publicar en Artifact Registry compartido | Nuevos nombres de imagen en el repositorio `beeside-dev` | Nombres propios `kl-*`; no se tocan tags existentes; rollback = borrar tags |
| Etiqueta `kl-publish-dev-*` empujada sobre un commit equivocado | Publicaría ese commit | El workflow exige que el commit pertenezca a `feat/kl-1.0-code` y que pasen los 19 controles |
| Ventana de `g1_admin`/`g1_probe` (E1–E15) | Segundos con un miembro extra de `cloudsqlsuperuser` | Igual que Fase 4; se elimina de inmediato; el único dato en riesgo es una base recién migrada sin datos de clientes (D19) |
| Efecto en otras plataformas | Ninguno esperado: instancia, secretos, cuentas, buckets y jobs propios | Solo se toca Artifact Registry (etiquetas nuevas) y la configuración de 2 jobs de KL |
| **Fusionar la rama a `main`** | `DEPLOY_DEV_ENABLED=true`: un merge a `main` dispara `deploy-dev.yml` (reconstruye y despliega backend, frontend y la migración de la plataforma, y la imagen del backend ya contiene KL) | **No se hace merge sin decisión expresa**; considerarlo antes de cualquier PR |
| Node 20 fuera de soporte | Base sin parches de Node | Migración a Node 22 en un cambio aparte (decisión de Plataforma) |
| Coste | Despreciable: ejecución de jobs, almacenamiento de 2 imágenes y 1 exportación | — |

## Qué necesito de ti para ejecutar
1. **`gcloud auth login`** (P1).
2. **Confirmar la congelación** de KL-0001…0005 (P5).
3. **Autorización expresa** de las subfases: 5.1 (etiqueta/push + publicación), 5.2–5.4 (exportación, ensayo en seco, migración) y 5.5–5.6 (verificación y E1–E15), en bloque o por separado.
