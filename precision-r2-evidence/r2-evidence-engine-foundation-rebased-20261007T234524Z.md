# Evidencia Gate R2 — engine-foundation-rebased

- fecha (UTC): 2026-10-07T23:45:24Z
- método: ejecución real en la máquina del operador con toolchain nativo (Implementation-Evidence Gate); runbook §5 ejecutado por pasos (split mecánico por límite de 180 s por llamada)
- sistema: Linux aarch64; node v22.23.2; npm 10.9.8; psql /sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/r2_steps.sh: line 16: psql: command not found
## Repositorio

- remoto(s): origin https://github.com/InnovMO-ai/beeside.git;
- rama: feature/precision-engine-foundation-rebased
- SHA completo: 0b55a376199864a7d63a0a3098a7334ebb0f53cc
- árbol de trabajo limpio: 0 archivos modificados/sin seguimiento
- `git ls-remote origin HEAD feature/precision-engine-foundation-rebased`:
```
bc3f52760a5c427c0b057a1e2bb0d71d8d0034d3	HEAD
```
- últimas migraciones: 0013_analytics_integrations_security.sql 0014_analytics_integrations_security_integrity.sql 0015_fa4_public_v1.sql 0016_fa4_public_v1_integrity.sql 

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
- código de salida: **0**; duración: 17s

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
- código de salida: **0**; duración: 4s

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
- código de salida: **0**; duración: 74s

```
Ran all test suites.

> @beeside/frontend@0.1.0 pretest
> npm run build --prefix ../shared/fa-public-engine


> @beeside/fa-public-engine@1.0.0 build
> rm -rf dist && tsc -p tsconfig.json && tsc -p tsconfig.esm.json && node scripts/finalize-build.mjs


> @beeside/frontend@0.1.0 test
> vitest run


 RUN  v1.6.1 /sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/ef/frontend

 ✓ src/fa/premium.test.tsx  (7 tests) 273ms
 ✓ src/fa/virtual-snapshot.test.tsx  (10 tests) 511ms
 ✓ src/fa/radar-profile.test.tsx  (6 tests) 125ms
 ✓ src/App.test.tsx  (11 tests) 245ms
 ✓ src/fa/snapshot.test.tsx  (5 tests) 208ms
 ✓ src/admin/admin.test.tsx  (7 tests) 2493ms
 ✓ src/fa4/fa4App.test.tsx  (5 tests) 581ms
 ✓ src/fa/feedback.test.tsx  (4 tests) 194ms
 ✓ src/fa4/result.test.tsx  (15 tests) 1220ms
 ✓ src/fa4/copyGate.test.ts  (5 tests) 7ms
 ✓ src/fa/identity.test.tsx  (3 tests) 178ms
 ✓ src/fa/opening-recap.test.tsx  (3 tests) 90ms
 ✓ src/fa/pathway-diagram.test.tsx  (4 tests) 96ms
 ✓ src/fa/stand-out-panels.test.tsx  (3 tests) 88ms
 ✓ src/fa/capability-landscape-grid.test.tsx  (4 tests) 74ms
 ✓ src/fa4/contamination.test.ts  (4 tests) 6ms
 ✓ src/fa/priority-list.test.tsx  (3 tests) 80ms
 ✓ src/fa/precision-transition.test.tsx  (1 test) 47ms

 Test Files  18 passed (18)
      Tests  100 passed (100)
   Start at  23:47:05
   Duration  6.12s (transform 1.24s, setup 1ms, collect 3.39s, tests 6.52s, environment 4.66s, prepare 1.12s)

```

### build

- comando: `npm run build`
- código de salida: **0**; duración: 20s

```
> @beeside/frontend@0.1.0 build
> tsc -b && vite build

vite v5.4.21 building for production...
transforming...
../node_modules/zod/v4/core/util.js (400:0): A comment

"// Wrapped in a `@__PURE__` IIFE: esbuild never tree-shakes a top-level initializer that contains a member access on `Number`, so the bare object literal survived into every bundle."

in "../node_modules/zod/v4/core/util.js" contains an annotation that Rollup cannot interpret due to the position of the comment. The comment will be removed to avoid issues.
../node_modules/zod/v4/core/regexes.js (74:0): A comment

"/** Anchors a pattern source. The interpolation lives here rather than at the call site because
 * esbuild will not drop a `@__PURE__` call whose own argument interpolates a variable, but it
 * will drop `anchor(dateSource)`. Keeping it inline pinned `date` into every bundle. */"

in "../node_modules/zod/v4/core/regexes.js" contains an annotation that Rollup cannot interpret due to the position of the comment. The comment will be removed to avoid issues.
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
✓ built in 1.17s
```

### jest: engine files only (conteo de pruebas)

- comando: `npx --prefix backend jest --runInBand --rootDir backend src/precision/engine --silent=false --verbose=false`
- código de salida: **1**; duración: 1s

```
      3 |
      4 | const MODEL_CONFIG: GatewayConfig = {
      5 |   chain: [{ provider: "primary", model: "classifier-model", endpoint: "https://primary.example/v1/chat", apiKeyEnvVar: "P_KEY" }],

      at constructor (../node_modules/@babel/parser/src/parse-error.ts:96:45)
      at Parser.toParseError [as raise] (../node_modules/@babel/parser/src/tokenizer/index.ts:1504:19)
      at Parser.raise [as unexpected] (../node_modules/@babel/parser/src/tokenizer/index.ts:1544:16)
      at Parser.unexpected [as expectContextual] (../node_modules/@babel/parser/src/parser/util.ts:114:12)
      at Parser.expectContextual [as parseImportSpecifiersAndAfter] (../node_modules/@babel/parser/src/parser/statement.ts:3180:10)
      at Parser.parseImportSpecifiersAndAfter [as parseImport] (../node_modules/@babel/parser/src/parser/statement.ts:3148:17)
      at Parser.parseImport [as parseStatementContent] (../node_modules/@babel/parser/src/parser/statement.ts:647:25)
      at Parser.parseStatementContent [as parseStatementLike] (../node_modules/@babel/parser/src/parser/statement.ts:482:17)
      at Parser.parseStatementLike [as parseModuleItem] (../node_modules/@babel/parser/src/parser/statement.ts:419:17)
      at Parser.parseModuleItem [as parseBlockOrModuleBlockBody] (../node_modules/@babel/parser/src/parser/statement.ts:1443:16)
      at Parser.parseBlockOrModuleBlockBody [as parseBlockBody] (../node_modules/@babel/parser/src/parser/statement.ts:1417:10)
      at Parser.parseBlockBody [as parseProgram] (../node_modules/@babel/parser/src/parser/statement.ts:229:10)
      at Parser.parseProgram [as parseTopLevel] (../node_modules/@babel/parser/src/parser/statement.ts:203:25)
      at Parser.parseTopLevel [as parse] (../node_modules/@babel/parser/src/parser/index.ts:83:25)
      at parse (../node_modules/@babel/parser/src/index.ts:86:38)
      at parser (../node_modules/@babel/core/src/parser/index.ts:29:19)
          at parser.next (<anonymous>)
      at normalizeFile (../node_modules/@babel/core/src/transformation/normalize-file.ts:49:24)
          at normalizeFile.next (<anonymous>)
      at run (../node_modules/@babel/core/src/transformation/index.ts:41:36)
          at run.next (<anonymous>)
      at transform (../node_modules/@babel/core/src/transform.ts:29:20)
          at transform.next (<anonymous>)
      at evaluateSync (../node_modules/gensync/index.js:251:28)
      at sync (../node_modules/gensync/index.js:89:14)
      at fn (../node_modules/@babel/core/src/errors/rewrite-stack-trace.ts:99:14)
      at transformSync (../node_modules/@babel/core/src/transform.ts:66:52)
      at ScriptTransformer.transformSource (../node_modules/@jest/transform/build/ScriptTransformer.js:545:31)
      at ScriptTransformer._transformAndBuildScript (../node_modules/@jest/transform/build/ScriptTransformer.js:674:40)
      at ScriptTransformer.transform (../node_modules/@jest/transform/build/ScriptTransformer.js:726:19)

Test Suites: 3 failed, 3 total
Tests:       0 total
Snapshots:   0 total
Time:        0.351 s
Ran all test suites matching /src\/precision\/engine/i.
```
- NOTA: el paso anterior 'jest: engine files only' falló por un error de invocación del operador (flag inexistente de npx), no por el código; se repite correctamente a continuación y se excluye del veredicto.

### jest: solo src/precision/engine (conteo de pruebas)

- comando: `npx jest --runInBand src/precision/engine`
- código de salida: **0**; duración: 3s

```
PASS src/precision/engine/guard.test.ts
PASS src/precision/engine/extraction.test.ts
PASS src/precision/engine/gateway.test.ts

Test Suites: 3 passed, 3 total
Tests:       46 passed, 46 total
Snapshots:   0 total
Time:        2.624 s, estimated 3 s
Ran all test suites matching /src\/precision\/engine/i.
```

### git: diff de la rama contra origin/main (solo archivos nuevos)

- comando: `git diff --stat origin/main..HEAD`
- código de salida: **0**; duración: 0s

```
 backend/src/precision/engine/extraction.test.ts | 190 ++++++++++++++++
 backend/src/precision/engine/extraction.ts      | 246 ++++++++++++++++++++
 backend/src/precision/engine/gateway.test.ts    | 144 ++++++++++++
 backend/src/precision/engine/gateway.ts         | 287 ++++++++++++++++++++++++
 backend/src/precision/engine/guard.test.ts      | 130 +++++++++++
 backend/src/precision/engine/guard.ts           | 156 +++++++++++++
 6 files changed, 1153 insertions(+)
```

## Veredicto mecánico: TODO EN VERDE
