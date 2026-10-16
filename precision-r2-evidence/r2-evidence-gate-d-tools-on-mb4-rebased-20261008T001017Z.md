# Evidencia Gate R2 — gate-d-tools-on-mb4-rebased

- fecha (UTC): 2026-10-08T00:10:17Z
- método: ejecución real en la máquina del operador con toolchain nativo (Implementation-Evidence Gate); runbook §5 ejecutado por pasos (split mecánico por límite de 180 s por llamada)
- sistema: Linux aarch64; node v22.23.2; npm 10.9.8; psql /sessions/rcw-01h6kaf1bkd7jphknwrvwngj/r2work/r2_steps.sh: line 16: psql: command not found
## Repositorio

- remoto(s): origin https://github.com/InnovMO-ai/beeside.git;
- rama: mb4-rebased
- SHA completo: e7b69baa451f2f01fa63ee33bd8200b39f911a68
- árbol de trabajo limpio: 2 archivos modificados/sin seguimiento
- `git ls-remote origin HEAD mb4-rebased`:
```
bc3f52760a5c427c0b057a1e2bb0d71d8d0034d3	HEAD
```
- últimas migraciones: 0015_fa4_public_v1.sql 0016_fa4_public_v1_integrity.sql 0017_precision_persistence.sql 0018_precision_persistence_integrity.sql 

### Gate D tools: node --test tests/*.test.mjs (expected 64/64)

- comando: `node --experimental-strip-types --no-warnings --test tests/ast-and-overlays.test.mjs tests/copy-lint.test.mjs tests/engine-reference.test.mjs tests/validator.test.mjs`
- código de salida: **0**; duración: 0s

```
  ...
# Subtest: mutation: threshold without change_threshold / non-quantifiable type
ok 60 - mutation: threshold without change_threshold / non-quantifiable type
  ---
  duration_ms: 0.47175
  type: 'test'
  ...
# Subtest: mutation: consistency decision without a single *_ack field
ok 61 - mutation: consistency decision without a single *_ack field
  ---
  duration_ms: 0.531416
  type: 'test'
  ...
# Subtest: mutation: wrong enum value inside an applicability rule (typo)
ok 62 - mutation: wrong enum value inside an applicability rule (typo)
  ---
  duration_ms: 0.529167
  type: 'test'
  ...
# Subtest: satisfiability: the MB3 pilot rule for hr_entity_consistency_ack (entity_registered under eor_peo with field only under direct_entity) is flagged unreachable
ok 63 - satisfiability: the MB3 pilot rule for hr_entity_consistency_ack (entity_registered under eor_peo with field only under direct_entity) is flagged unreachable
  ---
  duration_ms: 0.456791
  type: 'test'
  ...
# Subtest: Project Manifest mutations: missing front, reserved kind, wrong classification order
ok 64 - Project Manifest mutations: missing front, reserved kind, wrong classification order
  ---
  duration_ms: 2.737458
  type: 'test'
  ...
1..64
# tests 64
# suites 0
# pass 64
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 188.883042
```

### Gate D tools: run-validation.mjs over manifests + services_projection (expected 0 errors)

- comando: `node --experimental-strip-types --no-warnings validator/run-validation.mjs manifests ../services_projection.json`
- código de salida: **0**; duración: 0s

```
{
 "manifests": [
  "_generic",
  "corporate_legal_admin",
  "ecosystem_development",
  "international_trade_customs",
  "logistics",
  "people_payroll_employment",
  "strategic_advisory",
  "tax_accounting_audit"
 ],
 "errors": 0,
 "warnings": 0
}
```
El paquete de herramientas de Gate D (sha256 f8ef8e72b7b197d3f465874db5f2d60e5f5176d2de367837181e7f5e24635c65) se ejecutó contra el código fuente MB4 real de la rama mb4-rebased (MB4_SRC=backend/src/precision). La línea 'psql: command not found' del encabezado es del chequeo de versión en este shell (psql solo se usa en el paso de PostgreSQL, evidenciado en otros archivos); los 2 archivos sin seguimiento del árbol son los propios archivos de evidencia. La rama mb4-rebased NO existe en el remoto (ls-remote solo devuelve HEAD): requiere push/PR por una sesión con permisos.

## Veredicto mecánico: TODO EN VERDE
