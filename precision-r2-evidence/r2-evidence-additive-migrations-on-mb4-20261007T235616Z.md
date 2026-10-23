# Evidencia Gate R2 — additive-migrations-on-mb4

- fecha (UTC): 2026-10-07T23:56:16Z
- método: ejecución real en la máquina del operador con toolchain nativo (Implementation-Evidence Gate); runbook §5 ejecutado por pasos (split mecánico por límite de 180 s por llamada)
- sistema: Linux aarch64; node v22.23.2; npm 10.9.8; psql psql (PostgreSQL) 16.14
## Repositorio

- remoto(s): origin https://github.com/InnovMO-ai/beeside.git;
- rama: mb4-rebased
- SHA completo: e7b69baa451f2f01fa63ee33bd8200b39f911a68
- árbol de trabajo limpio: 0 archivos modificados/sin seguimiento
- `git ls-remote origin HEAD mb4-rebased`:
```
bc3f52760a5c427c0b057a1e2bb0d71d8d0034d3	HEAD
```
- últimas migraciones: 0015_fa4_public_v1.sql 0016_fa4_public_v1_integrity.sql 0017_precision_persistence.sql 0018_precision_persistence_integrity.sql 
- base de pruebas: host/db = 127.0.0.1:54330/r2_mb4_add (copia de r2_mb4 con las migraciones reales 0000-0018 aplicadas por drizzle-kit; PostgreSQL 16.14; sin datos reales)
- rama bajo prueba: mb4-rebased (e7b69ba) = bc3f527 + MB4 renumerado + fix repository.ts; paquete aditivo = claude/precision-f1-prototype-sql-pack-2026-10-07.md (§1, §4, §5), archivos recuperados con sha256 verificado (099c99eb…)

### migración aditiva consolidada (M-A…M-G) sobre 0017/0018

- comando: `psql postgres://postgres@127.0.0.1:54330/r2_mb4_add -X -v ON_ERROR_STOP=1 -f additive_migration.sql`
- código de salida: **0**; duración: 0s

```
BEGIN
ALTER TABLE
ALTER TABLE
ALTER TABLE
ALTER TABLE
ALTER TABLE
ALTER TABLE
ALTER TABLE
CREATE TABLE
CREATE INDEX
CREATE INDEX
CREATE INDEX
CREATE FUNCTION
CREATE TRIGGER
ALTER TABLE
ALTER TABLE
ALTER TABLE
CREATE FUNCTION
DROP FUNCTION
CREATE FUNCTION
ALTER TYPE
CREATE TABLE
CREATE INDEX
CREATE FUNCTION
CREATE TRIGGER
CREATE VIEW
CREATE FUNCTION
COMMIT
```

### regresión MB4: run_precision_tests.sql tras la migración aditiva

- comando: `psql postgres://postgres@127.0.0.1:54330/r2_mb4_add -X -v ON_ERROR_STOP=1 -f db/tests/precision/run_precision_tests.sql`
- código de salida: **0**; duración: 0s

```
psql:db/tests/precision/20_fact_model.sql:60: NOTICE:  F08 PASS: the superseded row keeps its original value — never rewritten, only pointed away from (§8/§9)
DO
--- F09-F12: confidence discipline + PA-level shared-fact scoping ---
psql:db/tests/precision/20_fact_model.sql:89: NOTICE:  F09 PASS: rejected [23514] new row for relation "fact" violates check constraint "fact_confidence_only_when_ai_extracted"
psql:db/tests/precision/20_fact_model.sql:89: NOTICE:  F10 PASS: confidence is recorded for an ai_extracted fact (real-type storage, compared with float tolerance)
psql:db/tests/precision/20_fact_model.sql:89: NOTICE:  F11 PASS: a stale AI confidence number never outlives the clients own confirm act on the same field (§8)
psql:db/tests/precision/20_fact_model.sql:89: NOTICE:  F12 PASS: rejected [23514] new row for relation "fact" violates check constraint "fact_confidence_range"
DO
--- M01-M05: category_manifest_version is independent per category_key (§19) ---
psql:db/tests/precision/30_manifest_versioning.sql:25: NOTICE:  M01 PASS: hr is current on cmv-hr-1 after setup
psql:db/tests/precision/30_manifest_versioning.sql:25: NOTICE:  M02 PASS: logistics is current on cmv-logistics-1, independently of hr
psql:db/tests/precision/30_manifest_versioning.sql:25: NOTICE:  M03 PASS: publishing a new hr version atomically repoints hr current to cmv-hr-2
psql:db/tests/precision/30_manifest_versioning.sql:25: NOTICE:  M04 PASS: publishing a new Logistics-unrelated hr version never touches Logistics current version (§19 literal requirement)
psql:db/tests/precision/30_manifest_versioning.sql:25: NOTICE:  M05 PASS: exactly one current row per category_key, never zero or two
DO
--- M06-M08: published manifest rows are immutable except is_current ---
psql:db/tests/precision/30_manifest_versioning.sql:39: NOTICE:  M06 PASS: rejected [BV409] category_manifest_version acbdc8f9-d551-42fe-a794-7c498befc1b9 is published and immutable except is_current
psql:db/tests/precision/30_manifest_versioning.sql:39: NOTICE:  M07 PASS: rejected [BV409] project_manifest_version pmv-pilot-1 is published and immutable except is_current
psql:db/tests/precision/30_manifest_versioning.sql:39: NOTICE:  M08 PASS: cmv-hr-1 content is untouched by the rejected UPDATE (M06) and by hr moving current to cmv-hr-2 (M03) — it stays reproducible as "what was true then" (§10/§15)
DO
--- M09-M10: category_assessment pins the version current at ITS OWN creation, not a later one ---
psql:db/tests/precision/30_manifest_versioning.sql:61: NOTICE:  M09 PASS: Add Category pins the categorys currently-published version at the moment of creation (§19/§22)
psql:db/tests/precision/30_manifest_versioning.sql:61: NOTICE:  M10 PASS: a later repoint of hr current never touches an already-pinned category_assessment instance (§19)
DO
--- O01-O04: service_map_snapshot and pack are fully immutable ---
psql:db/tests/precision/40_outputs_immutability.sql:19: NOTICE:  O01 PASS: rejected [BV409] service_map_snapshot rows are never updated or deleted (id 2f6e7e8f-3fc2-45c6-b547-6270a6f3dcaa)
psql:db/tests/precision/40_outputs_immutability.sql:19: NOTICE:  O02 PASS: rejected [BV409] service_map_snapshot rows are never updated or deleted (id 2f6e7e8f-3fc2-45c6-b547-6270a6f3dcaa)
psql:db/tests/precision/40_outputs_immutability.sql:19: NOTICE:  O03 PASS: rejected [BV409] pack rows are never updated or deleted (id 329b83f8-0c89-4731-8dcd-201311206143)
psql:db/tests/precision/40_outputs_immutability.sql:19: NOTICE:  O04 PASS: rejected [BV409] pack rows are never updated or deleted (id 329b83f8-0c89-4731-8dcd-201311206143)
DO
--- O05: service_map_snapshot can only point at a scope=project instance ---
psql:db/tests/precision/40_outputs_immutability.sql:29: NOTICE:  O05 PASS: rejected [BV409] service_map_snapshot.precision_instance_id 07bb3efa-c346-4e1f-a9ca-19be99123388 must reference a scope=project instance
DO
--- O06-O08: project.split_from_project_id — self-reference rejected, write-once ---
psql:db/tests/precision/40_outputs_immutability.sql:50: NOTICE:  O06 PASS: rejected [23514] new row for relation "project" violates check constraint "project_split_from_not_self"
psql:db/tests/precision/40_outputs_immutability.sql:50: NOTICE:  O07 PASS: P2.split_from_project_id = P1 — the worked example from §3A
psql:db/tests/precision/40_outputs_immutability.sql:50: NOTICE:  O08 PASS: rejected [BV409] project 8a04abd5-e75f-4ae2-ad08-e4becf4c7c8d split_from_project_id is write-once
DO
--- DONE: rolling back, no test data persists ---
ROLLBACK
```

### A01–A19 (run_additive.sql)

- comando: `psql postgres://postgres@127.0.0.1:54330/r2_mb4_add -X -v ON_ERROR_STOP=1 -f /sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/run_additive.sql`
- código de salida: **0**; duración: 0s

```
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/run_additive.sql:207: NOTICE:  A11c PASS: rejected [23514] new row for relation "fact" violates check constraint "fact_source_item_requires_pin"
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/run_additive.sql:207: NOTICE:  A12a PASS: rejected [23505] duplicate key value violates unique constraint "context_pin_one_current"
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/run_additive.sql:207: NOTICE:  A12b PASS: rejected [23505] duplicate key value violates unique constraint "precision_instance_one_pa_per_project"
DO
--- A13-A15 (SA / ED instances) ---
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/run_additive.sql:224: NOTICE:  A13a PASS: SA instance inserts with its own manifest
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/run_additive.sql:224: NOTICE:  A13b PASS: rejected [23505] duplicate key value violates unique constraint "category_assessment_project_category_unique"
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/run_additive.sql:224: NOTICE:  A13c PASS: rejected [23503] insert or update on table "category_assessment" violates foreign key constraint "category_assessment_manifest_version_fk"
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/run_additive.sql:224: NOTICE:  A14 PASS: SA completion yields pack crp_kind=strategic_advisory and moves current_pack_id atomically
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/run_additive.sql:224: NOTICE:  A15 PASS: ED analogue
DO
--- A16 (M-E ASSUMED) ---
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/run_additive.sql:236: NOTICE:  A16a PASS: ASSUMED accepted
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/run_additive.sql:236: NOTICE:  A16b PASS: rejected [22P02] invalid input value for enum fact_answer_state: "GUESSED"
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/run_additive.sql:236: NOTICE:  A16c PASS: ASSUMED superseded by ANSWERED keeps the chain
DO
--- A17 (M-F oh_delivery) ---
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/run_additive.sql:255: NOTICE:  A17a PASS: queued delivery recorded
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/run_additive.sql:255: NOTICE:  A17b PASS: current state = latest row
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/run_additive.sql:255: NOTICE:  A17c PASS: rejected [BV409] oh_delivery rows are append-only (id b1c1134b-9b70-4cf1-8077-32cbd4775fec)
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/run_additive.sql:255: NOTICE:  A17d PASS: rejected [BV409] oh_delivery rows are append-only (id b1c1134b-9b70-4cf1-8077-32cbd4775fec)
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/run_additive.sql:255: NOTICE:  A17e PASS: rejected [23505] duplicate key value violates unique constraint "oh_delivery_idem_status_unique"
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/run_additive.sql:255: NOTICE:  A17f PASS: rejected [23514] new row for relation "oh_delivery" violates check constraint "oh_delivery_kind_artifact"
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/run_additive.sql:255: NOTICE:  A17g PASS: rejected [BV409] oh_delivery artifact does not belong to project ccba8082-8ab3-4939-be3b-cb0d0b3f4ef5 (cross-project scoping violation)
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/run_additive.sql:255: NOTICE:  A17h PASS: rejected [23514] new row for relation "oh_delivery" violates check constraint "oh_delivery_error_only_failed"
DO
--- A18 (M-G new PSM version; sequential here, concurrency tested separately with two sessions) ---
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/run_additive.sql:273: NOTICE:  A18a PASS: rejected [BV409] Add a Service requires a confirmed Project Service Map (currently not_started)
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/run_additive.sql:273: NOTICE:  A18b PASS: same request key returns the same snapshot; new key creates the next
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/run_additive.sql:273: NOTICE:  A18c PASS: versions 1,2,3 contiguous
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/run_additive.sql:273: NOTICE:  A18d PASS: pointer on newest, PA confirmed
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/run_additive.sql:273: NOTICE:  A18e PASS: rejected [BV409] service_map_snapshot rows are never updated or deleted (id 14a07e8a-215e-4e8b-bb21-08252c4d7e98)
DO
--- A19 (D11: new CRP version keeps the old intact) ---
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/run_additive.sql:285: NOTICE:  A19a PASS: current pack is v2
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/run_additive.sql:285: NOTICE:  A19b PASS: v1 still readable and intact
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/run_additive.sql:285: NOTICE:  A19c PASS: rejected [BV409] pack rows are never updated or deleted (id 12679cb2-29f3-4b90-8695-df15ed3dd3fa)
DO
--- DONE additive tests ---
ROLLBACK
```

### N01–N05, P01, P03, P04 (rls_tests.sql)

- comando: `psql postgres://postgres@127.0.0.1:54330/r2_mb4_add -X -v ON_ERROR_STOP=1 -f /sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/rls_tests.sql`
- código de salida: **0**; duración: 0s

```
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/rls_tests.sql:186: NOTICE:  N04.category_assessment PASS: no app.project_id => 0 rows
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/rls_tests.sql:186: NOTICE:  N04.precision_assessment PASS: no app.project_id => 0 rows
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/rls_tests.sql:186: NOTICE:  N04.fact PASS: no app.project_id => 0 rows
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/rls_tests.sql:186: NOTICE:  N04.pack PASS: no app.project_id => 0 rows
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/rls_tests.sql:186: NOTICE:  N04.service_map_snapshot PASS: no app.project_id => 0 rows
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/rls_tests.sql:186: NOTICE:  N04.context_pin PASS: no app.project_id => 0 rows
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/rls_tests.sql:186: NOTICE:  N04.oh_delivery PASS: no app.project_id => 0 rows
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/rls_tests.sql:186: NOTICE:  N01.precision_instance PASS: A sees 2 own row(s)
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/rls_tests.sql:186: NOTICE:  N01.category_assessment PASS: A sees 1 own row(s)
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/rls_tests.sql:186: NOTICE:  N01.precision_assessment PASS: A sees 1 own row(s)
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/rls_tests.sql:186: NOTICE:  N01.fact PASS: A sees 1 own row(s)
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/rls_tests.sql:186: NOTICE:  N01.pack PASS: A sees 1 own row(s)
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/rls_tests.sql:186: NOTICE:  N01.service_map_snapshot PASS: A sees 1 own row(s)
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/rls_tests.sql:186: NOTICE:  N01.context_pin PASS: A sees 1 own row(s)
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/rls_tests.sql:186: NOTICE:  N01.oh_delivery PASS: A sees 1 own row(s)
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/rls_tests.sql:186: NOTICE:  N01.nofoo PASS: A sees nothing of B
DO
--- N02 / N03 / N05 (context = A) ---
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/rls_tests.sql:204: NOTICE:  N02a PASS: rejected [42501] new row violates row-level security policy for table "context_pin"
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/rls_tests.sql:204: NOTICE:  N02b PASS: rejected [BV409] fact.project_id must match the owning precision_instance of scope_instance_id 76b63084-1f1c-4e85-b726-18206ad061cc (cross-project scoping violation)
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/rls_tests.sql:204: NOTICE:  N03a PASS: UPDATE of B rows under A affects 0 rows
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/rls_tests.sql:204: NOTICE:  N03b PASS: rejected [42501] permission denied for table fact
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/rls_tests.sql:204: NOTICE:  N05a PASS: rejected [BV404] category_assessment 76b63084-1f1c-4e85-b726-18206ad061cc not found
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/rls_tests.sql:204: NOTICE:  N05b PASS: rejected [BV404] precision_assessment 5c55193c-7be3-427b-a8ed-b909e1b30a2f not found
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/rls_tests.sql:204: NOTICE:  N05c PASS: fact_record supersession works for own project under RLS + column-level UPDATE grant
DO
--- P01 / P03 / P04 ---
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/rls_tests.sql:220: NOTICE:  P01a PASS: rejected [42501] permission denied for table pack
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/rls_tests.sql:220: NOTICE:  P01b PASS: rejected [42501] permission denied for table service_map_snapshot
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/rls_tests.sql:220: NOTICE:  P01c PASS: rejected [42501] permission denied for table pack
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/rls_tests.sql:220: NOTICE:  P01d PASS: rejected [42501] permission denied for table fact
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/rls_tests.sql:220: NOTICE:  P03a PASS: rejected [42501] permission denied for table category_manifest_version
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/rls_tests.sql:220: NOTICE:  P03b PASS: rejected [42501] permission denied for table category_manifest_version
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/rls_tests.sql:220: NOTICE:  P04a PASS: rejected [42501] permission denied for table oh_delivery
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/rls_tests.sql:220: NOTICE:  P04b PASS: rejected [42501] permission denied for table oh_delivery
psql:/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/addpack/files/rls_tests.sql:220: NOTICE:  P04c PASS: INSERT/SELECT on oh_delivery still allowed to the runtime role
DO
RESET
--- DONE rls tests ---
ROLLBACK
```
- aserciones PASS tras migración aditiva — MB4 (esperado 50): **50**
- aserciones PASS A01–A19 (esperado 45): **45**
- aserciones PASS N/P (esperado 33): **33**

## Veredicto mecánico: TODO EN VERDE
