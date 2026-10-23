# Evidencia Gate R2 — mb4-rebased-0017-0018-fixed

- fecha (UTC): 2026-10-07T23:49:55Z
- método: ejecución real en la máquina del operador con toolchain nativo (Implementation-Evidence Gate); runbook §5 ejecutado por pasos (split mecánico por límite de 180 s por llamada)
- sistema: Linux aarch64; node v22.23.2; npm 10.9.8; psql /sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/r2_steps.sh: line 16: psql: command not found
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

### npm ci

- comando: `npm ci`
- código de salida: **0**; duración: 5s

```
npm warn deprecated inflight@1.0.6: This module is not supported, and leaks memory. Do not use it. Check out lru-cache if you want a good and tested way to coalesce async requests by a key value, which is much more comprehensive and powerful.
npm warn deprecated @esbuild-kit/esm-loader@2.6.5: Merged into tsx: https://tsx.hirok.io
npm warn deprecated rimraf@2.7.1: Rimraf versions prior to v4 are no longer supported
npm warn deprecated @humanwhocodes/config-array@0.13.0: Use @eslint/config-array instead
npm warn deprecated rimraf@3.0.2: Rimraf versions prior to v4 are no longer supported
npm warn deprecated supertest@6.3.4: Please upgrade to supertest v7.1.3+, see release notes at https://github.com/forwardemail/supertest/releases/tag/v7.1.3 - maintenance is supported by Forward Email @ https://forwardemail.net
npm warn deprecated whatwg-encoding@3.1.1: Use @exodus/bytes instead for a more spec-conformant and faster implementation
npm warn deprecated glob@7.2.3: Old versions of glob are not supported, and contain widely publicized security vulnerabilities, which have been fixed in the current version. Please update. Support for old versions may be purchased (at exorbitant rates) by contacting i@izs.me
npm warn deprecated @esbuild-kit/core-utils@3.3.2: Merged into tsx: https://tsx.hirok.io
npm warn deprecated @humanwhocodes/object-schema@2.0.3: Use @eslint/object-schema instead
npm warn deprecated superagent@8.1.2: Please upgrade to superagent v10.2.2+, see release notes at https://github.com/forwardemail/superagent/releases/tag/v10.2.2 - maintenance is supported by Forward Email @ https://forwardemail.net
npm warn deprecated eslint@8.57.1: This version is no longer supported. Please see https://eslint.org/version-support for other options.

added 708 packages, and audited 713 packages in 5s

117 packages are looking for funding
  run `npm fund` for details

54 vulnerabilities (10 moderate, 41 high, 3 critical)

To address issues that do not require attention, run:
  npm audit fix

To address all issues possible (including breaking changes), run:
  npm audit fix --force

Some issues need review, and may require choosing
a different dependency.

Run `npm audit` for details.
```

### typecheck

- comando: `npm run typecheck`
- código de salida: **0**; duración: 16s

```

> beeside-first-assessment@0.1.0 typecheck
> npm run typecheck --workspace=shared/canonical-fields && npm run typecheck --workspace=shared/fa-public-engine && npm run typecheck --workspace=backend && npm run typecheck --workspace=frontend


> @beeside/canonical-fields@0.1.0 typecheck
> tsc --noEmit -p tsconfig.json


> @beeside/fa-public-engine@1.0.0 typecheck
> tsc --noEmit -p tsconfig.json


> @beeside/backend@0.1.0 pretypecheck
> npm run build --prefix ../shared/canonical-fields && npm run build --prefix ../shared/fa-public-engine


> @beeside/canonical-fields@0.1.0 build
> tsc -p tsconfig.json


> @beeside/fa-public-engine@1.0.0 build
> rm -rf dist && tsc -p tsconfig.json && tsc -p tsconfig.esm.json && node scripts/finalize-build.mjs


> @beeside/backend@0.1.0 typecheck
> tsc --noEmit -p tsconfig.json


> @beeside/frontend@0.1.0 pretypecheck
> npm run build --prefix ../shared/fa-public-engine


> @beeside/fa-public-engine@1.0.0 build
> rm -rf dist && tsc -p tsconfig.json && tsc -p tsconfig.esm.json && node scripts/finalize-build.mjs


> @beeside/frontend@0.1.0 typecheck
> tsc --noEmit

```

### lint

- comando: `npm run lint`
- código de salida: **0**; duración: 5s

```

> beeside-first-assessment@0.1.0 lint
> npm run lint --workspace=backend && npm run lint --workspace=frontend


> @beeside/backend@0.1.0 lint
> eslint "src/**/*.ts"


> @beeside/frontend@0.1.0 lint
> eslint "src/**/*.{ts,tsx}"

```

### pruebas unitarias (jest)

- comando: `npm run test`
- código de salida: **0**; duración: 69s

```
Ran all test suites.

> @beeside/frontend@0.1.0 pretest
> npm run build --prefix ../shared/fa-public-engine


> @beeside/fa-public-engine@1.0.0 build
> rm -rf dist && tsc -p tsconfig.json && tsc -p tsconfig.esm.json && node scripts/finalize-build.mjs


> @beeside/frontend@0.1.0 test
> vitest run


 RUN  v1.6.1 /sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/mb4/frontend

 ✓ src/fa/premium.test.tsx  (7 tests) 287ms
 ✓ src/fa/virtual-snapshot.test.tsx  (10 tests) 542ms
 ✓ src/fa/radar-profile.test.tsx  (6 tests) 132ms
 ✓ src/App.test.tsx  (11 tests) 259ms
 ✓ src/fa/snapshot.test.tsx  (5 tests) 210ms
 ✓ src/admin/admin.test.tsx  (7 tests) 2461ms
 ✓ src/fa/feedback.test.tsx  (4 tests) 182ms
 ✓ src/fa4/fa4App.test.tsx  (5 tests) 554ms
 ✓ src/fa4/result.test.tsx  (15 tests) 1344ms
 ✓ src/fa4/copyGate.test.ts  (5 tests) 7ms
 ✓ src/fa/identity.test.tsx  (3 tests) 216ms
 ✓ src/fa/opening-recap.test.tsx  (3 tests) 80ms
 ✓ src/fa/pathway-diagram.test.tsx  (4 tests) 116ms
 ✓ src/fa/stand-out-panels.test.tsx  (3 tests) 83ms
 ✓ src/fa/capability-landscape-grid.test.tsx  (4 tests) 73ms
 ✓ src/fa/priority-list.test.tsx  (3 tests) 71ms
 ✓ src/fa4/contamination.test.ts  (4 tests) 7ms
 ✓ src/fa/precision-transition.test.tsx  (1 test) 51ms

 Test Files  18 passed (18)
      Tests  100 passed (100)
   Start at  23:51:23
   Duration  6.33s (transform 1.25s, setup 0ms, collect 3.49s, tests 6.67s, environment 4.77s, prepare 1.12s)

```

### build

- comando: `npm run build`
- código de salida: **0**; duración: 19s

```
> @beeside/frontend@0.1.0 build
> tsc -b && vite build

vite v5.4.21 building for production...
transforming...
../node_modules/zod/v4/core/regexes.js (74:0): A comment

"/** Anchors a pattern source. The interpolation lives here rather than at the call site because
 * esbuild will not drop a `@__PURE__` call whose own argument interpolates a variable, but it
 * will drop `anchor(dateSource)`. Keeping it inline pinned `date` into every bundle. */"

in "../node_modules/zod/v4/core/regexes.js" contains an annotation that Rollup cannot interpret due to the position of the comment. The comment will be removed to avoid issues.
../node_modules/zod/v4/core/util.js (400:0): A comment

"// Wrapped in a `@__PURE__` IIFE: esbuild never tree-shakes a top-level initializer that contains a member access on `Number`, so the bare object literal survived into every bundle."

in "../node_modules/zod/v4/core/util.js" contains an annotation that Rollup cannot interpret due to the position of the comment. The comment will be removed to avoid issues.
✓ 208 modules transformed.
rendering chunks...
computing gzip size...
dist/index.html                                         0.34 kB │ gzip:  0.25 kB
dist/assets/bridge-operation-hub-BqPIkGs1.png           8.14 kB
dist/assets/bridge-strategic-advisory-DeuT3hs4.png      8.37 kB
dist/assets/bridge-the-hive-tbUbeQR0.png               16.38 kB
dist/assets/bridge-beeside-verified-CPis786X.png       17.45 kB
dist/assets/next-operation-hub-MLtvMSPH.png            18.13 kB
dist/assets/bridge-sherpa-C4TR9Lkc.png                 21.03 kB
dist/assets/next-precision-assessment-BQUYiXwx.png     42.83 kB
dist/assets/next-sherpa-CDK_G7sT.png                   43.61 kB
dist/assets/value-banner-photo-BLdlJP0N.jpg            62.93 kB
dist/assets/beeside-logo-BoWvbITC.png                 101.50 kB
dist/assets/hero-world-bee-BSHpXXqR.png             1,683.49 kB
dist/assets/fa4-DBDqYc5o.css                           12.60 kB │ gzip:  3.33 kB
dist/assets/styles-DK57sb0O.css                        34.39 kB │ gzip:  7.43 kB
dist/assets/analytics-CntTpaZW.js                       3.24 kB │ gzip:  1.39 kB
dist/assets/AdminApp-DWMT-3zO.js                       52.31 kB │ gzip: 13.66 kB
dist/assets/App-D78qZHby.js                           102.08 kB │ gzip: 25.91 kB
dist/assets/Fa4App-CwhkdQwy.js                        104.27 kB │ gzip: 33.07 kB
dist/assets/index-dpcTJs8P.js                         144.61 kB │ gzip: 46.62 kB
✓ built in 1.13s
```

### drizzle-kit check (cadena de snapshots)

- comando: `bash -c cd backend && DATABASE_URL=postgres://x@127.0.0.1:1/x npx drizzle-kit check`
- código de salida: **0**; duración: 1s

```
No config path provided, using default 'drizzle.config.ts'
Reading config file '/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/mb4/backend/drizzle.config.ts'
Everything's fine 🐶🔥
```

### drizzle-kit generate: cero deriva (No schema changes)

- comando: `bash -c cd backend && DATABASE_URL=postgres://x@127.0.0.1:1/x npx drizzle-kit generate --name drift_probe | tee /dev/stderr | grep -q "No schema changes"`
- código de salida: **0**; duración: 0s

```
email_event 9 columns 1 indexes 2 fks
outbox_event 7 columns 2 indexes 1 fks
config_version_event 12 columns 1 indexes 4 fks
config_version_review 15 columns 1 indexes 4 fks
fa_access_extension 8 columns 1 indexes 1 fks
fa_journey_event 14 columns 3 indexes 1 fks
fa_project_lifecycle 14 columns 2 indexes 1 fks
legal_acceptance 8 columns 1 indexes 3 fks
project_access_token 9 columns 2 indexes 1 fks
admin_audit_event 11 columns 3 indexes 2 fks
admin_session 10 columns 2 indexes 1 fks
email_delivery 22 columns 3 indexes 2 fks
job_run 10 columns 2 indexes 1 fks
retention_purge_record 11 columns 1 indexes 2 fks
analytics_project_profile 13 columns 1 indexes 1 fks
integration_delivery 19 columns 3 indexes 2 fks
integration_external_ref 5 columns 0 indexes 1 fks
rate_limit_counter 6 columns 2 indexes 0 fks
snapshot_feedback 8 columns 2 indexes 1 fks
fa4_access_token 9 columns 2 indexes 1 fks
fa4_catalog_change 9 columns 1 indexes 0 fks
fa4_catalog_entity 8 columns 1 indexes 0 fks
fa4_catalog_version 4 columns 0 indexes 0 fks
fa4_continuation_request 4 columns 2 indexes 2 fks
fa4_demand_signal 15 columns 2 indexes 2 fks
fa4_email_delivery 15 columns 3 indexes 1 fks
fa4_legal_acceptance 7 columns 1 indexes 1 fks
fa4_privacy_erasure_log 6 columns 0 indexes 1 fks
fa4_project 8 columns 1 indexes 0 fks
fa4_result 6 columns 2 indexes 2 fks
category_assessment 8 columns 2 indexes 4 fks
category_manifest_version 11 columns 3 indexes 2 fks
fact 12 columns 4 indexes 2 fks
pack 6 columns 2 indexes 1 fks
precision_assessment 7 columns 0 indexes 3 fks
precision_instance 5 columns 2 indexes 1 fks
project_manifest_version 10 columns 1 indexes 2 fks
service_map_snapshot 5 columns 2 indexes 1 fks

No schema changes, nothing to migrate 😴
```
- base de pruebas: host/db = 127.0.0.1:54330/r2_mb4 (PostgreSQL desechable 16.14, aarch64, sin datos reales; psql (PostgreSQL) 16.14)

### migraciones reales 0000-0018 (drizzle-kit migrate)

- comando: `npx drizzle-kit migrate`
- código de salida: **0**; duración: 1s

```
No config path provided, using default 'drizzle.config.ts'
Reading config file '/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/mb4/backend/drizzle.config.ts'
Using 'pg' driver for database querying
[⣷] applying migrations...[2K[1G[⣯] applying migrations...[2K[1G[⣟] applying migrations...[2K[1G[⡿] applying migrations...[2K[1G[✓] migrations applied successfully!```

### SQL: db/tests/precision/run_precision_tests.sql

- comando: `psql postgres://postgres@127.0.0.1:54330/r2_mb4 -X -v ON_ERROR_STOP=1 -f db/tests/precision/run_precision_tests.sql`
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
psql:db/tests/precision/30_manifest_versioning.sql:39: NOTICE:  M06 PASS: rejected [BV409] category_manifest_version 945764d9-c024-4f96-88fd-eaf3ddbdc680 is published and immutable except is_current
psql:db/tests/precision/30_manifest_versioning.sql:39: NOTICE:  M07 PASS: rejected [BV409] project_manifest_version pmv-pilot-1 is published and immutable except is_current
psql:db/tests/precision/30_manifest_versioning.sql:39: NOTICE:  M08 PASS: cmv-hr-1 content is untouched by the rejected UPDATE (M06) and by hr moving current to cmv-hr-2 (M03) — it stays reproducible as "what was true then" (§10/§15)
DO
--- M09-M10: category_assessment pins the version current at ITS OWN creation, not a later one ---
psql:db/tests/precision/30_manifest_versioning.sql:61: NOTICE:  M09 PASS: Add Category pins the categorys currently-published version at the moment of creation (§19/§22)
psql:db/tests/precision/30_manifest_versioning.sql:61: NOTICE:  M10 PASS: a later repoint of hr current never touches an already-pinned category_assessment instance (§19)
DO
--- O01-O04: service_map_snapshot and pack are fully immutable ---
psql:db/tests/precision/40_outputs_immutability.sql:19: NOTICE:  O01 PASS: rejected [BV409] service_map_snapshot rows are never updated or deleted (id 61c19e6a-c2ab-4947-a52e-675aaf21eb28)
psql:db/tests/precision/40_outputs_immutability.sql:19: NOTICE:  O02 PASS: rejected [BV409] service_map_snapshot rows are never updated or deleted (id 61c19e6a-c2ab-4947-a52e-675aaf21eb28)
psql:db/tests/precision/40_outputs_immutability.sql:19: NOTICE:  O03 PASS: rejected [BV409] pack rows are never updated or deleted (id 2bee72f2-8490-47ea-b2d6-58d505b02f39)
psql:db/tests/precision/40_outputs_immutability.sql:19: NOTICE:  O04 PASS: rejected [BV409] pack rows are never updated or deleted (id 2bee72f2-8490-47ea-b2d6-58d505b02f39)
DO
--- O05: service_map_snapshot can only point at a scope=project instance ---
psql:db/tests/precision/40_outputs_immutability.sql:29: NOTICE:  O05 PASS: rejected [BV409] service_map_snapshot.precision_instance_id 1b3625a7-8339-436d-81e6-cb23df0997b3 must reference a scope=project instance
DO
--- O06-O08: project.split_from_project_id — self-reference rejected, write-once ---
psql:db/tests/precision/40_outputs_immutability.sql:50: NOTICE:  O06 PASS: rejected [23514] new row for relation "project" violates check constraint "project_split_from_not_self"
psql:db/tests/precision/40_outputs_immutability.sql:50: NOTICE:  O07 PASS: P2.split_from_project_id = P1 — the worked example from §3A
psql:db/tests/precision/40_outputs_immutability.sql:50: NOTICE:  O08 PASS: rejected [BV409] project 9931febe-5a00-4a0d-9959-108c5771e334 split_from_project_id is write-once
DO
--- DONE: rolling back, no test data persists ---
ROLLBACK
```

### SQL: db/tests/run_analytics_security_tests.sql

- comando: `psql postgres://postgres@127.0.0.1:54330/r2_mb4 -X -v ON_ERROR_STOP=1 -f db/tests/run_analytics_security_tests.sql`
- código de salida: **0**; duración: 0s

```
psql:db/tests/run_analytics_security_tests.sql:128: NOTICE:  A05 PASS: rejected [BV409] snapshot_feedback a7b8f7a3-ec54-4dce-abcf-7a608a3def6e is immutable once submitted
psql:db/tests/run_analytics_security_tests.sql:128: NOTICE:  A06 PASS: rejected [BV409] snapshot_feedback rows are never deleted
psql:db/tests/run_analytics_security_tests.sql:128: NOTICE:  A07 PASS: rejected [23514] new row for relation "snapshot_feedback" violates check constraint "snapshot_feedback_usefulness"
DO
--- A08-A13: the analytics profile carries enumerations only and is never deleted ---
psql:db/tests/run_analytics_security_tests.sql:147: NOTICE:  A08 PASS: a profile starts without completion facts and without finding signals
psql:db/tests/run_analytics_security_tests.sql:147: NOTICE:  A09 PASS: rejected [BV422] analytics_project_profile.target_markets holds ISO country codes only
psql:db/tests/run_analytics_security_tests.sql:147: NOTICE:  A10 PASS: rejected [BV422] analytics_project_profile holds enumerated option values only
psql:db/tests/run_analytics_security_tests.sql:147: NOTICE:  A11 PASS: rejected [BV422] analytics_project_profile.signal_areas holds area identifiers only
psql:db/tests/run_analytics_security_tests.sql:147: NOTICE:  A12 PASS: rejected [23514] new row for relation "analytics_project_profile" violates check constraint "analytics_project_profile_enumerations"
psql:db/tests/run_analytics_security_tests.sql:147: NOTICE:  A13 PASS: rejected [BV409] analytics_project_profile.completed_at is written once
psql:db/tests/run_analytics_security_tests.sql:147: NOTICE:  A14 PASS: rejected [BV409] analytics_project_profile rows are anonymous analytics and are never deleted
DO
--- A15-A22: outbound integration delivery state machine ---
psql:db/tests/run_analytics_security_tests.sql:185: NOTICE:  A15 PASS: rejected [BV409] integration_delivery must mirror its outbox event exactly
psql:db/tests/run_analytics_security_tests.sql:185: NOTICE:  A16 PASS: rejected [BV409] an integration delivery is always created as PENDING
psql:db/tests/run_analytics_security_tests.sql:185: NOTICE:  A17 PASS: rejected [23505] duplicate key value violates unique constraint "integration_delivery_event_destination_unique"
psql:db/tests/run_analytics_security_tests.sql:185: NOTICE:  A18 PASS: rejected [BV409] claiming an integration delivery takes a lease and counts one attempt
psql:db/tests/run_analytics_security_tests.sql:185: NOTICE:  A19 PASS: rejected [BV409] integration delivery 3af6446f-4354-4194-88cd-d475f6ac5f85 cannot move from PENDING to DELIVERED
psql:db/tests/run_analytics_security_tests.sql:185: NOTICE:  A20 PASS: rejected [BV409] a skipped integration delivery records its reason
psql:db/tests/run_analytics_security_tests.sql:185: NOTICE:  A21 PASS: rejected [BV409] a retried integration delivery restarts its attempt count
psql:db/tests/run_analytics_security_tests.sql:185: NOTICE:  A22 PASS: rejected [BV409] integration delivery 3af6446f-4354-4194-88cd-d475f6ac5f85 is final (DELIVERED)
psql:db/tests/run_analytics_security_tests.sql:185: NOTICE:  A23 PASS: rejected [BV409] integration_external_ref identity is immutable
DO
--- A24-A25: rate-limit counters never store an address, email or token in clear ---
psql:db/tests/run_analytics_security_tests.sql:197: NOTICE:  A24 PASS: rejected [23514] new row for relation "rate_limit_counter" violates check constraint "rate_limit_counter_key_format"
psql:db/tests/run_analytics_security_tests.sql:197: NOTICE:  A25 PASS: counters are keyed by an HMAC digest only
DO
--- A26: the purge removes the feedback comment and pending deliveries, keeps anonymous analytics, and tells destinations to delete their copy ---
psql:db/tests/run_analytics_security_tests.sql:232: NOTICE:  A26 PASS: the purge deletes the feedback (comment included) and the project's integration deliveries
psql:db/tests/run_analytics_security_tests.sql:232: NOTICE:  A27 PASS: anonymous analytics and the external cross-reference survive; client content does not
psql:db/tests/run_analytics_security_tests.sql:232: NOTICE:  A28 PASS: destinations are told to delete their own copy (ids only)
DO
--- A29-A32: least-privilege runtime database role ---
psql:db/tests/run_analytics_security_tests.sql:256: NOTICE:  A29 PASS: the runtime role cannot log in by itself, is not a superuser and manages nothing
psql:db/tests/run_analytics_security_tests.sql:256: NOTICE:  A30 PASS: the runtime role can do what the application does, including the retention purge
psql:db/tests/run_analytics_security_tests.sql:256: NOTICE:  A31 PASS: append-only and anonymous-analytics tables cannot be rewritten by the running application
psql:db/tests/run_analytics_security_tests.sql:256: NOTICE:  A32 PASS: the runtime role cannot change the schema or the migration registry, and future tables inherit the same grants
DO
ROLLBACK
```

### SQL: db/tests/run_fa_core_tests.sql

- comando: `psql postgres://postgres@127.0.0.1:54330/r2_mb4 -X -v ON_ERROR_STOP=1 -f db/tests/run_fa_core_tests.sql`
- código de salida: **0**; duración: 0s

```
BEGIN
--- SETUP: helpers, test-only published versions, fixtures ---
CREATE FUNCTION
CREATE FUNCTION
CREATE FUNCTION
psql:db/tests/run_fa_core_tests.sql:88: NOTICE:  SETUP OK: fa-suite-v1 current, probe keys synced, project 7749496f-0c3d-47b3-837c-969bf6810c71 IN_PROGRESS
DO
--- F01-F04: canonical field registry is synchronized, never hand-written ---
psql:db/tests/run_fa_core_tests.sql:104: NOTICE:  F01 PASS: rejected [BV403] field_key_registry is synchronized from shared/canonical-fields; write it only through field_registry_sync()
psql:db/tests/run_fa_core_tests.sql:104: NOTICE:  F02 PASS: rejected [BV422] every field must belong to module first_assessment (prefix fa.) and declare data_type and source
psql:db/tests/run_fa_core_tests.sql:104: NOTICE:  F03 PASS: rejected [BV409] field_key_registry rows are never deleted (field_registry_sync deactivates removed keys)
psql:db/tests/run_fa_core_tests.sql:104: NOTICE:  F04 PASS: re-syncing an unchanged field set is a no-op; removed keys are deactivated, not deleted
DO
--- F05: person.primary_email is stored normalized ---
psql:db/tests/run_fa_core_tests.sql:108: NOTICE:  F05 PASS: rejected [23514] new row for relation "person" violates check constraint "person_primary_email_normalized"
--- F06-F09: answers use the pinned question bank and freeze when the assessment closes ---
psql:db/tests/run_fa_core_tests.sql:125: NOTICE:  F06 PASS: rejected [BV409] answer question_bank_version fa-not-pinned does not match the project's pinned version fa-suite-v1
psql:db/tests/run_fa_core_tests.sql:125: NOTICE:  F07 PASS: an answer on the pinned question bank version is accepted while IN_PROGRESS
psql:db/tests/run_fa_core_tests.sql:125: NOTICE:  F08 PASS: rejected [BV409] project 7749496f-0c3d-47b3-837c-969bf6810c71 is COMPLETED_LOCKED; First Assessment answers can no longer change
psql:db/tests/run_fa_core_tests.sql:125: NOTICE:  F09 PASS: precision.* answers remain writable after the First Assessment is locked (continuity into Precision)
DO
--- F10-F13: legal acceptances, extensions and journey events are append-only ---
psql:db/tests/run_fa_core_tests.sql:135: NOTICE:  F10 PASS: rejected [P0001] Row in legal_acceptance is append-only: UPDATE not allowed
psql:db/tests/run_fa_core_tests.sql:135: NOTICE:  F11 PASS: rejected [P0001] Row in fa_access_extension is append-only: DELETE not allowed
psql:db/tests/run_fa_core_tests.sql:135: NOTICE:  F12 PASS: rejected [P0001] Row in fa_journey_event is append-only: UPDATE not allowed
psql:db/tests/run_fa_core_tests.sql:135: NOTICE:  F13 PASS: rejected [23514] new row for relation "fa_journey_event" violates check constraint "fa_journey_event_properties_object"
DO
--- F14-F16: access tokens change only by last use and one-way revocation ---
psql:db/tests/run_fa_core_tests.sql:146: NOTICE:  F14 PASS: rejected [BV409] access token 4aa34be2-7574-4956-82f0-d761e1a59aaf is immutable except last_used_at and revocation
psql:db/tests/run_fa_core_tests.sql:146: NOTICE:  F15 PASS: recording last use and revoking a token are allowed
psql:db/tests/run_fa_core_tests.sql:146: NOTICE:  F16 PASS: rejected [BV409] access token 4aa34be2-7574-4956-82f0-d761e1a59aaf revocation is final
DO
--- F17-F19: access lifecycle milestones are write-once; access is extended, never shortened ---
psql:db/tests/run_fa_core_tests.sql:158: NOTICE:  F17 PASS: rejected [BV409] access window of project 7749496f-0c3d-47b3-837c-969bf6810c71 can only be extended, never shortened
psql:db/tests/run_fa_core_tests.sql:158: NOTICE:  F18 PASS: rejected [BV409] lifecycle milestones of project 7749496f-0c3d-47b3-837c-969bf6810c71 are write-once
psql:db/tests/run_fa_core_tests.sql:158: NOTICE:  F19 PASS: extending the access window is allowed
DO
--- DONE: rolling back, no test data persists ---
ROLLBACK
```

### SQL: db/tests/run_operations_tests.sql

- comando: `psql postgres://postgres@127.0.0.1:54330/r2_mb4 -X -v ON_ERROR_STOP=1 -f db/tests/run_operations_tests.sql`
- código de salida: **0**; duración: 0s

```
--- O01-O07: retention is always defined, re-anchored once, never shortened; legal evidence ---
psql:db/tests/run_operations_tests.sql:117: NOTICE:  O01 PASS: a lifecycle without any private link gets a deterministic retention date from its origin
psql:db/tests/run_operations_tests.sql:117: NOTICE:  O02 PASS: rejected [23514] new row for relation "fa_project_lifecycle" violates check constraint "fa_project_lifecycle_retention_basis_matches_window"
psql:db/tests/run_operations_tests.sql:117: NOTICE:  O03 PASS: the first private link re-anchors retention to the access window (later than the origin fallback)
psql:db/tests/run_operations_tests.sql:117: NOTICE:  O04 PASS: rejected [BV409] retention of project 874d069c-f559-41a9-9242-3f500207313e can only be re-anchored once, to the access window, and never shortened
psql:db/tests/run_operations_tests.sql:117: NOTICE:  O05 PASS: rejected [BV409] retention of project 874d069c-f559-41a9-9242-3f500207313e can only be re-anchored once, to the access window, and never shortened
psql:db/tests/run_operations_tests.sql:117: NOTICE:  O06 PASS: rejected [BV409] recorded access expiry of project 874d069c-f559-41a9-9242-3f500207313e only moves forward
psql:db/tests/run_operations_tests.sql:117: NOTICE:  O07 PASS: a legal acceptance records the pinned configuration version that supplied the documents (Privacy Policy URL not invented)
DO
--- O08-O16: admin identities, sessions and audit ---
psql:db/tests/run_operations_tests.sql:149: NOTICE:  O08 PASS: rejected [23514] new row for relation "admin_user" violates check constraint "admin_user_technical_identity_no_login"
psql:db/tests/run_operations_tests.sql:149: NOTICE:  O09 PASS: rejected [23514] new row for relation "admin_user" violates check constraint "admin_user_login_identity_is_email"
psql:db/tests/run_operations_tests.sql:149: NOTICE:  O10 PASS: rejected [BV409] admin_user 3a62ac6c-a248-45bd-b3af-e6a006924692 is already bound to its identity-provider subject
psql:db/tests/run_operations_tests.sql:149: NOTICE:  O11 PASS: rejected [BV409] the last active login-enabled ADMIN cannot be deactivated, demoted or disabled
psql:db/tests/run_operations_tests.sql:149: NOTICE:  O12 PASS: rejected [BV409] admin_user rows are never deleted (deactivate instead)
psql:db/tests/run_operations_tests.sql:149: NOTICE:  O13 PASS: rejected [BV403] an admin session requires an active, login-enabled admin user with that role
psql:db/tests/run_operations_tests.sql:149: NOTICE:  O14 PASS: rejected [BV409] admin session db8f1e01-6d82-4363-adc3-723e905db950 is immutable except activity and revocation
psql:db/tests/run_operations_tests.sql:149: NOTICE:  O15 PASS: rejected [BV409] admin_audit_event rows are append-only: UPDATE not allowed
psql:db/tests/run_operations_tests.sql:149: NOTICE:  O16 PASS: rejected [23514] new row for relation "admin_audit_event" violates check constraint "admin_audit_event_actor_consistency"
DO
--- O17-O23: email outbox and job-run state machines ---
psql:db/tests/run_operations_tests.sql:173: NOTICE:  O17 PASS: rejected [BV409] an email delivery is always enqueued as PENDING
psql:db/tests/run_operations_tests.sql:173: NOTICE:  O18 PASS: rejected [23505] duplicate key value violates unique constraint "email_delivery_dedupe_key_unique"
psql:db/tests/run_operations_tests.sql:173: NOTICE:  O19 PASS: rejected [BV409] email delivery 4a9f6b15-8cdc-492b-8d23-5b94cd1b11a7 cannot move from PENDING to SENT
psql:db/tests/run_operations_tests.sql:173: NOTICE:  O20 PASS: rejected [BV409] claiming an email delivery takes a lease and counts one attempt
psql:db/tests/run_operations_tests.sql:173: NOTICE:  O21 PASS: rejected [BV409] email delivery 4a9f6b15-8cdc-492b-8d23-5b94cd1b11a7 is final (SENT)
psql:db/tests/run_operations_tests.sql:173: NOTICE:  O22 PASS: rejected [23505] duplicate key value violates unique constraint "job_run_one_running_per_job"
psql:db/tests/run_operations_tests.sql:173: NOTICE:  O23 PASS: rejected [BV409] job run 7e6be942-e443-401f-9b4c-1e7b6ced53f7 is finished and immutable
DO
--- O24-O30: retention candidates and the purge ---
psql:db/tests/run_operations_tests.sql:258: NOTICE:  O24 PASS: candidates: elapsed free assessments (IN_PROGRESS or EXPIRED); not a pending Premium request, not a project still within retention
psql:db/tests/run_operations_tests.sql:258: NOTICE:  O25 PASS: the purge re-checks under lock: a pending Premium request wins
psql:db/tests/run_operations_tests.sql:258: NOTICE:  O26 PASS: the purge refuses a project still within retention
psql:db/tests/run_operations_tests.sql:258: NOTICE:  O27 PASS: IN_PROGRESS → EXPIRED → DELETED in one call: client data deleted, identity anonymized, anonymous analytics and lifecycle timestamps kept, evidence recorded
psql:db/tests/run_operations_tests.sql:258: NOTICE:  O28 PASS: a person and company that still belong to a live project are never anonymized by another project's purge
psql:db/tests/run_operations_tests.sql:258: NOTICE:  O29 PASS: rejected [P0001] Row in snapshot is immutable (id=(eae96cc7-4f9b-4667-9ad0-08b88eabc6ac,01e6dfe9-f7ac-4e16-b030-cdad12815e02,"2026-10-07 23:52:00.269518+00",ops-suite-v1,ops-suite-v1,"{""kind"": ""expansion_snapshot""}"))
psql:db/tests/run_operations_tests.sql:258: NOTICE:  O30 PASS: rejected [BV409] retention_purge_record rows are append-only: UPDATE not allowed
DO
--- DONE: rolling back, no test data persists ---
ROLLBACK
```

### SQL: db/tests/run_premium_tests.sql

- comando: `psql postgres://postgres@127.0.0.1:54330/r2_mb4 -X -v ON_ERROR_STOP=1 -f db/tests/run_premium_tests.sql`
- código de salida: **0**; duración: 0s

```
psql:db/tests/run_premium_tests.sql:129: NOTICE:  S04 PASS: rejected [BV409] an Operation Hub link for project 7ff67a52-4568-4d05-9a84-a4a856bfb085 requires active Premium access
psql:db/tests/run_premium_tests.sql:129: NOTICE:  S05 PASS: rejected [BV409] Precision starts only with the first Premium activation (project 7ff67a52-4568-4d05-9a84-a4a856bfb085)
psql:db/tests/run_premium_tests.sql:129: NOTICE:  S06 PASS: rejected [BV409] project 7ff67a52-4568-4d05-9a84-a4a856bfb085 entered Premium without premium_first_activated_at
psql:db/tests/run_premium_tests.sql:129: NOTICE:  S07 PASS: rejected [BV409] the Precision handoff package of project 7ff67a52-4568-4d05-9a84-a4a856bfb085 is generated only when a locked First Assessment first enters Premium
psql:db/tests/run_premium_tests.sql:129: NOTICE:  S08 PASS: rejected [23514] new row for relation "subscription" violates check constraint "subscription_period_order"
DO
--- S09-S16: first activation — entitlement, exactly-once handoff, write-once milestones ---
psql:db/tests/run_premium_tests.sql:186: NOTICE:  S09 PASS: first activation grants access from the period start with no end date
psql:db/tests/run_premium_tests.sql:186: NOTICE:  S10 PASS: the handoff package is generated by the premium_activated event from the project's own frozen Snapshot
psql:db/tests/run_premium_tests.sql:186: NOTICE:  S11 PASS: rejected [23505] duplicate key value violates unique constraint "subscription_event_one_premium_activated"
psql:db/tests/run_premium_tests.sql:186: NOTICE:  S12 PASS: rejected [23505] duplicate key value violates unique constraint "precision_handoff_package_project_id_unique"
psql:db/tests/run_premium_tests.sql:186: NOTICE:  S13 PASS: rejected [BV409] the Precision handoff package of project 7ff67a52-4568-4d05-9a84-a4a856bfb085 must come from its own frozen Snapshot and Internal Assessment
psql:db/tests/run_premium_tests.sql:186: NOTICE:  S14 PASS: rejected [BV409] the Precision handoff package of project 7ff67a52-4568-4d05-9a84-a4a856bfb085 must be generated by its premium_activated event
psql:db/tests/run_premium_tests.sql:186: NOTICE:  S15 PASS: rejected [BV409] Premium and Precision milestones of project 7ff67a52-4568-4d05-9a84-a4a856bfb085 are write-once
psql:db/tests/run_premium_tests.sql:186: NOTICE:  S16 PASS: rejected [BV409] operation_hub_link rows are never deleted; access follows entitlement
DO
--- S17-S23: cancellation keeps access until the period ends; an ended subscription is never reopened ---
psql:db/tests/run_premium_tests.sql:227: NOTICE:  S17 PASS: rejected [BV409] a scheduled cancellation records cancel_at_period_end and cancellation_requested_at
psql:db/tests/run_premium_tests.sql:227: NOTICE:  S18 PASS: a scheduled cancellation keeps premium_access_active=true until current_period_end (Phase 2 sync corrected)
psql:db/tests/run_premium_tests.sql:227: NOTICE:  S19 PASS: rejected [BV409] subscription 03e945ab-52f8-4591-abe3-fd92e30dd45c cannot move from CANCELLATION_SCHEDULED to PREMIUM_ACTIVE
psql:db/tests/run_premium_tests.sql:227: NOTICE:  S20 PASS: rejected [BV409] an ended subscription records ended_at
psql:db/tests/run_premium_tests.sql:227: NOTICE:  S21 PASS: the period end removes current access, while premium_ever_activated and precision_state stay as historical facts
psql:db/tests/run_premium_tests.sql:227: NOTICE:  S22 PASS: rejected [BV409] subscription 03e945ab-52f8-4591-abe3-fd92e30dd45c has ended and is never reopened; reactivation creates a new subscription
psql:db/tests/run_premium_tests.sql:227: NOTICE:  S23 PASS: rejected [BV409] subscription rows are never deleted (subscription 03e945ab-52f8-4591-abe3-fd92e30dd45c)
DO
--- S24-S25: reactivation reuses the project, opens a new subscription, never a second package ---
psql:db/tests/run_premium_tests.sql:254: NOTICE:  S24 PASS: reactivation: same project_id, a second subscription row, access active again, still exactly one handoff package
psql:db/tests/run_premium_tests.sql:254: NOTICE:  S25 PASS: rejected [BV409] subscription_event for project 7ff67a52-4568-4d05-9a84-a4a856bfb085 references a subscription of another project
DO
--- S26-S28: activation requests record Terms acceptance and are fulfilled only by an activation event ---
psql:db/tests/run_premium_tests.sql:278: NOTICE:  S26 PASS: rejected [23514] new row for relation "premium_activation_request" violates check constraint "premium_activation_request_fulfilment"
psql:db/tests/run_premium_tests.sql:278: NOTICE:  S27 PASS: rejected [BV409] premium_activation_request ff7ff82c-aabc-455f-8813-814f28bdd418 is immutable except its checkout reference and fulfilment
psql:db/tests/run_premium_tests.sql:278: NOTICE:  S28 PASS: rejected [BV409] premium_activation_request ff7ff82c-aabc-455f-8813-814f28bdd418 is already fulfilled
DO
--- S29-S30: temporary retention never selects a project that entered Premium; First Assessment untouched ---
psql:db/tests/run_premium_tests.sql:315: NOTICE:  S29 PASS: only the expired non-Premium assessment is a retention candidate; the Premium project is excluded despite its past retention date
psql:db/tests/run_premium_tests.sql:315: NOTICE:  S30 PASS: no subscription event touched the First Assessment: still COMPLETED_LOCKED with its frozen Snapshot and Internal Assessment; every deferred check holds
DO
--- DONE: rolling back, no test data persists ---
ROLLBACK
```

### SQL: db/tests/run_rules_snapshot_tests.sql

- comando: `psql postgres://postgres@127.0.0.1:54330/r2_mb4 -X -v ON_ERROR_STOP=1 -f db/tests/run_rules_snapshot_tests.sql`
- código de salida: **0**; duración: 0s

```
BEGIN
--- SETUP: helpers, test-only published versions, an IN_PROGRESS project ---
CREATE FUNCTION
CREATE FUNCTION
CREATE FUNCTION
CREATE FUNCTION
psql:db/tests/run_rules_snapshot_tests.sql:83: NOTICE:  SETUP OK: rs-suite-v1 current, project e89446ab-3af9-4a0d-bf62-0c9a15682f70 IN_PROGRESS
DO
--- R01-R06: every finding is explainable and NOT_APPLICABLE carries nothing client-facing ---
psql:db/tests/run_rules_snapshot_tests.sql:103: NOTICE:  R01 PASS: rejected [23514] new row for relation "finding" violates check constraint "finding_rule_explained"
psql:db/tests/run_rules_snapshot_tests.sql:103: NOTICE:  R02 PASS: rejected [23514] new row for relation "finding" violates check constraint "finding_reason_client_when_shown"
psql:db/tests/run_rules_snapshot_tests.sql:103: NOTICE:  R03 PASS: rejected [23514] new row for relation "finding" violates check constraint "finding_not_applicable_without_signal"
psql:db/tests/run_rules_snapshot_tests.sql:103: NOTICE:  R04 PASS: rejected [BV409] finding.rules_engine_version rs-not-pinned does not match the project's pinned version rs-suite-v1
psql:db/tests/run_rules_snapshot_tests.sql:103: NOTICE:  R05 PASS: explainable findings (including a silent NOT_APPLICABLE) are accepted on the pinned rules engine while IN_PROGRESS
psql:db/tests/run_rules_snapshot_tests.sql:103: NOTICE:  R06 PASS: rejected [23514] new row for relation "capability_rank" violates check constraint "capability_rank_positive"
DO
--- R07-R10: Snapshot and Internal Assessment use pinned versions and are generated together with the lock ---
psql:db/tests/run_rules_snapshot_tests.sql:137: NOTICE:  R07 PASS: rejected [BV409] snapshot for project e89446ab-3af9-4a0d-bf62-0c9a15682f70 must use the pinned versions (rules rs-suite-v1, template rs-suite-v1)
psql:db/tests/run_rules_snapshot_tests.sql:137: NOTICE:  R08 PASS: rejected [BV409] snapshot and internal_assessment for project e89446ab-3af9-4a0d-bf62-0c9a15682f70 must be generated together
psql:db/tests/run_rules_snapshot_tests.sql:137: NOTICE:  R09 PASS: rejected [BV409] the Snapshot of project e89446ab-3af9-4a0d-bf62-0c9a15682f70 requires its First Assessment to be COMPLETED_LOCKED
psql:db/tests/run_rules_snapshot_tests.sql:137: NOTICE:  R10 PASS: rejected [23514] new row for relation "internal_assessment" violates check constraint "internal_assessment_content_object"
DO
--- R11-R14: the completion transaction, then everything is frozen ---
psql:db/tests/run_rules_snapshot_tests.sql:159: NOTICE:  R11 PASS: findings, Snapshot and Internal Assessment generated in the transaction that locks the First Assessment satisfy every deferred check
psql:db/tests/run_rules_snapshot_tests.sql:159: NOTICE:  R12 PASS: rejected [BV409] project e89446ab-3af9-4a0d-bf62-0c9a15682f70 is COMPLETED_LOCKED; finding rows can no longer be added
psql:db/tests/run_rules_snapshot_tests.sql:159: NOTICE:  R13 PASS: rejected [BV409] project e89446ab-3af9-4a0d-bf62-0c9a15682f70 is COMPLETED_LOCKED; capability_rank rows can no longer be added
psql:db/tests/run_rules_snapshot_tests.sql:159: NOTICE:  R14 PASS: rejected [P0001] Row in snapshot is immutable (id=(edd94a72-21de-4aba-a3e2-96bf2fca830c,e89446ab-3af9-4a0d-bf62-0c9a15682f70,"2026-10-07 23:52:00.329801+00",rs-suite-v1,rs-suite-v1,"{""kind"": ""expansion_snapshot""}"))
DO
--- DONE: rolling back, no test data persists ---
ROLLBACK
```

### SQL: db/tests/run_versioning_tests.sql

- comando: `psql postgres://postgres@127.0.0.1:54330/r2_mb4 -X -v ON_ERROR_STOP=1 -f db/tests/run_versioning_tests.sql`
- código de salida: **0**; duración: 0s

```
psql:db/tests/versioning/20_audit_rollback.sql:65: NOTICE:  L29 PASS: rejected [BV422] bundle is identical to the current published version vt-qb-2
psql:db/tests/versioning/20_audit_rollback.sql:65: NOTICE:  L30 PASS: rejected [BV412] publish refused: the current published version changed since preview (previewed against vt-qb-2, current is vt-qb-4); return to draft and preview again
psql:db/tests/versioning/20_audit_rollback.sql:65: NOTICE:  L31a PASS: rejected [BV412] publish refused: the latest review of question_bank_version.vt-qb-3 covers different content or a different base
psql:db/tests/versioning/20_audit_rollback.sql:65: NOTICE:  L31b PASS: after returning to draft and re-previewing, publish needed a fresh review against the new base
psql:db/tests/versioning/20_audit_rollback.sql:65: NOTICE:  L32 PASS: a rules_engine bundle is always LOGIC_SCHEMA, even when only copy changed
DO
--- L33a-L33e: rollback = repoint current to a previously published version ---
psql:db/tests/versioning/20_audit_rollback.sql:84: NOTICE:  L33a PASS: current repointed to vt-qb-2 with an audited reason; vt-qb-3 stays PUBLISHED and unchanged
psql:db/tests/versioning/20_audit_rollback.sql:84: NOTICE:  L33b PASS: rejected [BV422] changing the current version requires a reason
psql:db/tests/versioning/20_audit_rollback.sql:84: NOTICE:  L33c PASS: rejected [BV409] only PUBLISHED versions can become current (question_bank_version.vt-qb-bad is DRAFT)
psql:db/tests/versioning/20_audit_rollback.sql:84: NOTICE:  L33d PASS: rejected [BV403] configuration changes require an active ADMIN actor (actor 0c3c6197-579a-4019-b458-48fceffad907)
psql:db/tests/versioning/20_audit_rollback.sql:84: NOTICE:  L33e PASS: rejected [BV409] question_bank_version.vt-qb-2 is already the current version
DO
--- L34a-L34d: audit trail is append-only, function-written, complete ---
psql:db/tests/versioning/20_audit_rollback.sql:99: NOTICE:  L34a PASS: rejected [P0001] Row in config_version_event is append-only: UPDATE not allowed
psql:db/tests/versioning/20_audit_rollback.sql:99: NOTICE:  L34b PASS: rejected [P0001] Row in config_version_review is append-only: DELETE not allowed
psql:db/tests/versioning/20_audit_rollback.sql:99: NOTICE:  L34c PASS: rejected [BV403] config_version_review rows can only be written by the config_* versioning functions
psql:db/tests/versioning/20_audit_rollback.sql:99: NOTICE:  L34d PASS: every lifecycle step of vt-qb-3 is recorded, in order
DO
--- L35: placeholder bundles shipped in the repository are valid ---
psql:db/tests/versioning/20_audit_rollback.sql:115: NOTICE:  L35 PASS: db/config-bundles/placeholder/*.json pass bundle validation for all three registries
DO
--- P01-P04: assessment_started pins the current PUBLISHED versions ---
psql:db/tests/versioning/30_pinning.sql:29: NOTICE:  P01 PASS: rejected [BV412] assessment_started refused: every registry needs a current PUBLISHED version (question_bank=vt-qb-2, rules_engine=vt-re-1, snapshot_template=<NULL>)
psql:db/tests/versioning/30_pinning.sql:29: NOTICE:  P02 PASS: a project started without explicit versions pins the three current PUBLISHED versions
psql:db/tests/versioning/30_pinning.sql:29: NOTICE:  P03 PASS: rejected [BV412] assessment_started must pin the current question_bank_version vt-qb-2 (got vt-qb-3)
psql:db/tests/versioning/30_pinning.sql:29: NOTICE:  P04 PASS: explicit version values are accepted only when they are exactly the current versions
DO
--- P05-P07: later publishes and rollbacks never touch started projects ---
psql:db/tests/versioning/30_pinning.sql:58: NOTICE:  P05 PASS: publishing a rules change mid-assessment leaves the in-flight project on vt-re-1; the next project pins vt-re-2
psql:db/tests/versioning/30_pinning.sql:58: NOTICE:  P06 PASS: a rollback repoint affects only future projects: the vt-re-2 project is unchanged, the next one pins vt-re-1
psql:db/tests/versioning/30_pinning.sql:58: NOTICE:  P07 PASS: rejected [P0001] project.e09be145-cbc0-47a4-8e83-cbdedbdc9bfb pinned version fields are immutable after creation
DO
--- P08a-P09: frozen snapshot re-verified through the publish pathway; pinned bundles reconstructable ---
psql:db/tests/versioning/30_pinning.sql:99: NOTICE:  P08a PASS: rejected [P0001] Row in snapshot is immutable (id=(aa5bad1d-1c7f-46c7-8ea5-11b73a8a8afe,e09be145-cbc0-47a4-8e83-cbdedbdc9bfb,"2026-10-07 23:52:00.354095+00",vt-re-1,vt-st-1,"{""greeting"": ""Hi Suite""}"))
psql:db/tests/versioning/30_pinning.sql:99: NOTICE:  P08b PASS: publishing a new snapshot template leaves the locked project and its frozen snapshot on vt-st-1
psql:db/tests/versioning/30_pinning.sql:99: NOTICE:  P09 PASS: the exact bundles pinned by a project stay PUBLISHED and hash-identical, so its results remain reconstructable
DO
--- DONE: rolling back, no test data persists ---
ROLLBACK
```

### SQL: db/tests/run_tests.sql

- comando: `psql postgres://postgres@127.0.0.1:54330/r2_mb4 -X -v ON_ERROR_STOP=1 -f db/tests/run_tests.sql`
- código de salida: **0**; duración: 0s

```
psql:db/tests/run_tests.sql:230: NOTICE:  T9b PASS: revert rejected (project.premium_ever_activated cannot revert to false once true)
psql:db/tests/run_tests.sql:230: NOTICE:  T9c PASS: revert rejected (project.precision_state cannot revert to NOT_STARTED once STARTED)
DO
--- T10: responsible_person_id reassignment is actor-attributed, function-only, and immutably logged ---
psql:db/tests/run_tests.sql:319: NOTICE:  T10a PASS: PERSON-actor reassignment logged correctly
psql:db/tests/run_tests.sql:319: NOTICE:  T10b PASS: ADMIN_USER-actor reassignment logged correctly
psql:db/tests/run_tests.sql:319: NOTICE:  T10c PASS: SYSTEM-actor reassignment logged correctly
psql:db/tests/run_tests.sql:319: NOTICE:  T10d PASS: exactly 3 audit rows accumulated (one per reassignment)
psql:db/tests/run_tests.sql:319: NOTICE:  T10e PASS: direct UPDATE rejected (project.responsible_person_id must only be changed via reassign_project_responsibility(), not a direct UPDATE)
psql:db/tests/run_tests.sql:319: NOTICE:  T10f PASS: inconsistent actor combination rejected (reassign_project_responsibility: actor_type=PERSON requires p_actor_person_id and no p_actor_admin_user_id)
psql:db/tests/run_tests.sql:319: NOTICE:  T10g PASS: actor consistency CHECK rejected mismatched combination (new row for relation "project_responsibility_change" violates check constraint "project_responsibility_change_actor_consistency")
psql:db/tests/run_tests.sql:319: NOTICE:  T10h PASS: delete rejected (Row in project_responsibility_change is append-only: DELETE not allowed)
DO
--- T11: at most one PREMIUM_ACTIVE subscription per project ---
psql:db/tests/run_tests.sql:336: NOTICE:  T11 PASS: second concurrent PREMIUM_ACTIVE subscription rejected
DO
--- T12: subscription write auto-syncs entitlement and subscription_state_transition ---
psql:db/tests/run_tests.sql:350: NOTICE:  T12 PASS: entitlement.premium_access_active=true, 1 history row logged
DO
--- T13: snapshot / internal_assessment / precision_handoff_package are fully immutable ---
psql:db/tests/run_tests.sql:385: NOTICE:  T13a PASS: snapshot update rejected
psql:db/tests/run_tests.sql:385: NOTICE:  T13b PASS: snapshot delete rejected
psql:db/tests/run_tests.sql:385: NOTICE:  T13c PASS: second snapshot for same project rejected
DO
--- T14: operation_hub_link composite PK allows multiple external systems per project ---
psql:db/tests/run_tests.sql:400: NOTICE:  T14 PASS: two different external_system links for the same project both succeeded
DO
--- T15: rules_matrix_category / capability_taxonomy_category catalog counts (migration 0002) ---
psql:db/tests/run_tests.sql:415: NOTICE:  T15 PASS: 15 rules_matrix_category rows (14 finding-capable), 10 capability_taxonomy_category rows, 10 country rows
DO
--- T16: only one is_current version row allowed per version registry ---
psql:db/tests/run_tests.sql:435: NOTICE:  T16 PASS: second concurrent is_current version rejected
DO
--- T17: answer.value supports multi-select containment queries (target_markets pattern) ---
psql:db/tests/run_tests.sql:456: NOTICE:  T17 PASS: containment query over multi-select answer.value returned expected row
DO
--- CHECK: all deferred constraints hold at end of suite ---
SET CONSTRAINTS
--- DONE: rolling back, no test data persists ---
ROLLBACK
```
- aserciones PASS en db/tests/precision/run_precision_tests.sql: **50**
- aserciones PASS en db/tests/run_analytics_security_tests.sql: **32**
- aserciones PASS en db/tests/run_fa_core_tests.sql: **19**
- aserciones PASS en db/tests/run_operations_tests.sql: **30**
- aserciones PASS en db/tests/run_premium_tests.sql: **30**
- aserciones PASS en db/tests/run_rules_snapshot_tests.sql: **14**
- aserciones PASS en db/tests/run_versioning_tests.sql: **57**
- migraciones aplicadas (drizzle.__drizzle_migrations): 19

## Veredicto mecánico: TODO EN VERDE
