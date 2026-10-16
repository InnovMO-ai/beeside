# Evidencia Gate R2 — mb4-rebased-0017-0018

- fecha (UTC): 2026-10-07T23:48:56Z
- método: ejecución real en la máquina del operador con toolchain nativo (Implementation-Evidence Gate); runbook §5 ejecutado por pasos (split mecánico por límite de 180 s por llamada)
- sistema: Linux aarch64; node v22.23.2; npm 10.9.8; psql /sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/r2_steps.sh: line 16: psql: command not found
## Repositorio

- remoto(s): origin https://github.com/InnovMO-ai/beeside.git;
- rama: mb4-rebased
- SHA completo: c118f6a4af85964da5dbfe4415c9dd933055d8f4
- árbol de trabajo limpio: 0 archivos modificados/sin seguimiento
- `git ls-remote origin HEAD mb4-rebased`:
```
bc3f52760a5c427c0b057a1e2bb0d71d8d0034d3	HEAD
```
- últimas migraciones: 0015_fa4_public_v1.sql 0016_fa4_public_v1_integrity.sql 0017_precision_persistence.sql 0018_precision_persistence_integrity.sql 

### npm ci

- comando: `npm ci`
- código de salida: **0**; duración: 6s

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
- código de salida: **2**; duración: 8s

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

src/precision/repository.ts(63,26): error TS2532: Object is possibly 'undefined'.
src/precision/repository.ts(105,26): error TS2532: Object is possibly 'undefined'.
src/precision/repository.ts(146,12): error TS2532: Object is possibly 'undefined'.
src/precision/repository.ts(171,12): error TS2532: Object is possibly 'undefined'.
src/precision/repository.ts(184,12): error TS2532: Object is possibly 'undefined'.
npm error Lifecycle script `typecheck` failed with error:
npm error code 2
npm error path /sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/mb4/backend
npm error workspace @beeside/backend@0.1.0
npm error location /sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/mb4/backend
npm error command failed
npm error command sh -c tsc --noEmit -p tsconfig.json
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

### drizzle-kit check (cadena de snapshots)

- comando: `bash -c cd backend && DATABASE_URL=postgres://x@127.0.0.1:1/x npx drizzle-kit check`
- código de salida: **0**; duración: 0s

```
No config path provided, using default 'drizzle.config.ts'
Reading config file '/sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/mb4/backend/drizzle.config.ts'
Everything's fine 🐶🔥
```

### drizzle-kit generate: cero deriva (debe decir No schema changes)

- comando: `bash -c cd backend && DATABASE_URL=postgres://x@127.0.0.1:1/x npx drizzle-kit generate --name drift_probe | tee /dev/stderr | grep -q "No schema changes"`
- código de salida: **0**; duración: 1s

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
