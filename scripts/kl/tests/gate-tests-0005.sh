#!/usr/bin/env bash
# Pruebas adversariales de Arquitectura para L1 0005 (complementan gate-tests.sh de KL; mismo método: clon temporal, push deshabilitado,
# scripts de HEAD copiados a una referencia protegida separada, API de GitHub simulada con JSON). Uso: bash scripts/kl/tests/gate-tests-0005.sh
# Cubre: scripts de CI fuera de .github/ (B3), checks de ci.yml con nombre equivalente o de otro origen (B3), paginación de la API (B3),
# evento pull_request sin _target (B1), coherencia rulesets ⇄ jobs reales de ci.yml, y deploy-dev atado a ci.yml por ruta.
set -u
export GIT_TERMINAL_PROMPT=0 GIT_AUTHOR_NAME=arq-test GIT_AUTHOR_EMAIL=t@local GIT_COMMITTER_NAME=arq-test GIT_COMMITTER_EMAIL=t@local
unset GITHUB_EVENT_NAME GITHUB_HEAD_REF GITHUB_REF_NAME KL_GUARD_APPROVAL KL_APPROVAL_RESULT
ROOT="$(git rev-parse --show-toplevel)"; SB="$(mktemp -d)"; trap 'rm -rf "$SB"' EXIT
PASS=0; FAIL=0
git clone -q --no-local "$ROOT" "$SB/w" && cd "$SB/w" || exit 2
git remote set-url origin https://github.com/InnovMO-ai/beeside.git; git remote set-url --push origin NOPUSH
MAIN="$(git -C "$ROOT" rev-parse HEAD)"; git update-ref refs/remotes/origin/main "$MAIN"
mkdir -p "$SB/trusted"; git archive "$MAIN" scripts/kl | tar -x -C "$SB/trusted"; T="$SB/trusted/scripts/kl"
sc() { git checkout -q -f -B "$1" origin/main; git clean -fdq; }
c() { git add -A; git commit -qm "$1"; }
pf() { GITHUB_EVENT_NAME="${3:-pull_request_target}" GITHUB_HEAD_REF="$1" GITHUB_REPOSITORY=InnovMO-ai/beeside KL_PLATFORM=knowledge-layer-code KL_APPROVAL_RESULT="$2" bash "$T/gate-run.sh" "$T" 2>&1; echo "exit=$?"; }
expect() { local n="$1" want="$2" re="$3" out="$4" got; got="$(printf '%s\n' "$out" | sed -n 's/^exit=//p' | tail -1)"
  if [ "$got" = "$want" ] && printf '%s' "$out" | grep -Eq -- "$re"; then PASS=$((PASS+1)); printf 'PASS  %s\n' "$n"
  else FAIL=$((FAIL+1)); printf 'FALLA %s (exit %s esperado %s; patrón %s)\n' "$n" "$got" "$want" "$re"; printf '%s\n' "$out" | grep -E '^(STOP|REVISAR|RESULTADO)' | head -5 | sed 's/^/        /'; fi; }
check() { if [ "$2" = 0 ]; then PASS=$((PASS+1)); echo "PASS  $1"; else FAIL=$((FAIL+1)); echo "FALLA $1"; fi; }

echo "── B3 · scripts que ejecutan los checks obligatorios (fuera de .github/)"
for f in scripts/ci/integration.sh scripts/secrets-scan.sh scripts/fa4-copy-inventory.js scripts/migrate.js backend/src/scripts/migration-target.ts backend/db/migrations/migration-targets.json; do
  sc feature/x; printf '\n' >> "$f"; c x
  expect "X1 PR de otra plataforma neutraliza $f sin aprobación verificada" 1 "sin aprobación verificada.*$f" "$(pf feature/x missing)"
  expect "X2 ... con aprobación verificada el PO decide (REVISAR)" 0 "aprobación VERIFICADA.*$f" "$(pf feature/x verified)"
done
for f in scripts/ci/integration.sh scripts/secrets-scan.sh scripts/fa4-copy-inventory.js scripts/migrate.js backend/src/scripts/migration-target.ts; do
  sc kl/x; printf '\n' >> "$f"; c x
  expect "X3 rama kl/* modifica $f sin aprobación verificada" 1 "sin aprobación verificada.*$f" "$(pf kl/x missing)"
done
sc kl/x; printf '\n' >> backend/db/migrations/migration-targets.json; c x
expect "X4 rama kl/* y migration-targets.json: sigue siendo migración compartida (STOP aun con aprobación)" 1 "migración compartida" "$(pf kl/x verified)"
sc feature/disc2; printf '// x\n' >> backend/src/fa4/index.ts 2>/dev/null || { mkdir -p backend/src/fa4; echo x > backend/src/fa4/x.ts; }; c x
expect "X5 Discovery: cambio de producto sin controles sigue pasando" 0 "RESULTADO: OK \(PR ajeno a KL\)" "$(pf feature/disc2 missing)"
sc feature/prec2; printf '\n' >> scripts/check-precision-dto.js; c x
expect "X6 Precision: script propio que no es check obligatorio sigue pasando" 0 "RESULTADO: OK \(PR ajeno a KL\)" "$(pf feature/prec2 missing)"

echo "── B1 · eventos"
sc feat/kl-1.0-code
expect "B1x evento pull_request (sin _target) en el lanzador => STOP" 1 "no soportado" "$(pf feat/kl-1.0-code verified pull_request)"
expect "B1y evento pull_request_target, rama feat/kl-1.0-code, aunque diga verified => STOP" 1 "NO admite el modo heredado" "$(pf feat/kl-1.0-code verified)"

echo "── B2 · valores del paso de aprobación como los produce el workflow"
sc kl/b2x; echo "# x" >> scripts/kl/gate-run.sh; c x
for v in "verified
verified" " verified" "verified " "VERIFIED" "missing" ""; do
  w="$v"; case "$w" in verified) ;; *) w=missing ;; esac   # misma normalización que el paso «appr» de kl-preflight.yml
  expect "B2x salida '$(printf '%s' "$v" | tr '\n' '|')' de verify-approval => STOP" 1 "sin aprobación verificada" "$(pf kl/b2x "$w")"
done

echo "── B3 · origen de checks de ci.yml y paginación (API simulada)"
A="$SB/api"; mkdir -p "$A"; HS=cccccccccccccccccccccccccccccccccccccccc
key() { printf '%s' "$1" | tr '/?&=' '____'; }
CRK="$A/$(key "repos/o/r/commits/$HS/check-runs?per_page=100").json"; STK="$A/$(key "repos/o/r/commits/$HS/statuses?per_page=100").json"
runfile() { printf '{"id":%s,"path":"%s","head_sha":"%s","repository":{"full_name":"o/r"},"check_suite_id":%s}' "$1" "$2" "$HS" "$((9000+$1))" > "$A/$(key "repos/o/r/actions/runs/$1").json"; }
# cr <nombre> <app> <run en details_url> [check suite real del check-run]
cr() { printf '{"name":"%s","app":{"id":%s,"slug":"x"},"details_url":"https://github.com/o/r/actions/runs/%s/job/9","check_suite":{"id":%s}}' "$1" "$2" "$3" "${4:-$((9000+$3))}"; }
co() { KL_API_DIR="$A" REPO=o/r HEAD_SHA=$HS bash "$T/verify-check-origin.sh" 2>&1; echo "exit=$?"; }
runfile 1 .github/workflows/ci.yml; runfile 2 .github/workflows/kl-preflight.yml; runfile 3 .github/workflows/rogue.yml; echo '[]' > "$STK"
printf '{"total_count":3,"check_runs":[%s,%s,%s]}' "$(cr 'build-lint-test (backend)' 15368 1)" "$(cr integration-postgres 15368 1)" "$(cr kl-gate 15368 2)" > "$CRK"
expect "O12 checks legítimos de ci.yml (incluido nombre con espacios)" 0 "origen de los checks protegidos verificado" "$(co)"
printf '{"check_runs":[%s]}' "$(cr 'build-lint-test (backend)' 15368 3)" > "$CRK"; expect "O13 'build-lint-test (backend)' desde otro workflow" 1 "NO es ci.yml" "$(co)"
printf '{"check_runs":[%s]}' "$(cr 'build-lint-test (otro)' 15368 3)" > "$CRK"; expect "O14 variante de matriz inventada desde otro workflow" 1 "NO es ci.yml" "$(co)"
printf '{"check_runs":[%s]}' "$(cr integration-postgres 4242 9)" > "$CRK"; expect "O15 integration-postgres desde otra app" 1 "app-ajena" "$(co)"
printf '{"check_runs":[%s]}' "$(cr secrets-scan 15368 1)" > "$CRK"; printf '[{"context":"secrets-scan","state":"success"}]' > "$STK"; expect "O16 estado de commit llamado secrets-scan" 1 "Statuses API" "$(co)"
echo '[]' > "$STK"
{ printf '{"total_count":2,"check_runs":[%s]}' "$(cr kl-gate 15368 2)"; printf '{"total_count":2,"check_runs":[%s]}' "$(cr kl-gate 15368 3)"; } > "$CRK"
expect "O17 kl-gate falso escondido en la página 2" 1 "NO es kl-preflight.yml" "$(co)"
printf '{"total_count":150,"check_runs":[%s]}' "$(cr kl-gate 15368 2)" > "$CRK"; expect "O18 lista truncada (total_count ≠ recibidos) => STOP" 1 "ilegible" "$(co)"
printf '{"check_runs":[%s]}' "$(cr kl-gate 15368 2)" > "$CRK"; { echo '[]'; printf '[{"context":"kl-tests","state":"success"}]'; } > "$STK"
expect "O19 estado falso escondido en la página 2 de statuses" 1 "Statuses API" "$(co)"

echo "── B3 · rutas no ASCII y con caracteres de control (hallazgo de la revisión independiente)"
sc feature/u1; mkdir -p .github/workflows; printf 'name: x\non: push\njobs: {}\n' > ".github/workflows/ñ.yml"; c x
expect "U1 PR de otra plataforma añade .github/workflows/ñ.yml" 1 "sin aprobación verificada.*ñ.yml" "$(pf feature/u1 missing)"
sc feature/u2; printf 'x\n' > "scripts/kl/ñ.sh"; c x; expect "U2 PR de otra plataforma añade scripts/kl/ñ.sh" 1 "modifica rutas de KL" "$(pf feature/u2 missing)"
sc kl/u3; printf 'name: x\non: push\njobs: {}\n' > ".github/workflows/ñ.yml"; c x; expect "U3 rama kl/* añade .github/workflows/ñ.yml" 1 "sin aprobación verificada.*ñ.yml" "$(pf kl/u3 missing)"
sc feature/u4; printf 'x\n' > "$(printf 'backend/src/a\tb.ts')"; c x; expect "U4 ruta con carácter de control (PR ajeno a KL) => STOP" 1 "caracteres de control" "$(pf feature/u4 missing)"
sc kl/u4b; printf 'x\n' > "$(printf 'backend/src/kl/a\tb.ts')"; c x; expect "U4b ruta con carácter de control (rama kl/*) => STOP" 1 "caracteres de control" "$(pf kl/u4b verified)"
sc feature/u5; mkdir -p backend/src/fa4; printf 'x\n' > "backend/src/fa4/ñandú.ts"; c x; expect "U5 Discovery: archivo propio con nombre no ASCII sigue pasando" 0 "RESULTADO: OK \(PR ajeno a KL\)" "$(pf feature/u5 missing)"
echo "── B3 · scripts que producen kl-images y preparan la integración"
sc kl/s1; printf 'exit 0\n' >> scripts/kl/smoke/images.sh; c x; expect "S1 rama kl/* neutraliza scripts/kl/smoke/images.sh" 1 "sin aprobación verificada.*smoke/images.sh" "$(pf kl/s1 missing)"
sc feature/s2; printf '\n' >> backend/src/scripts/domain-roles-prepare.ts; c x; expect "S2 PR ajeno modifica domain-roles-prepare.ts (lo llama integration.sh)" 1 "sin aprobación verificada.*domain-roles-prepare.ts" "$(pf feature/s2 missing)"
echo "── B3 · check-run falsificado que reutiliza el details_url del run legítimo"
echo '[]' > "$STK"
printf '{"check_runs":[%s,%s]}' "$(cr kl-gate 15368 2)" "$(cr kl-gate 15368 2 777)" > "$CRK"; expect "O20 segundo kl-gate con details_url del run real pero otra check suite" 1 "NO es kl-preflight.yml" "$(co)"
printf '{"check_runs":[{"name":"kl-gate","app":{"id":15368},"details_url":"https://github.com/o/r/actions/runs/2/job/9"}]}' > "$CRK"; expect "O21 check-run protegido sin check suite => STOP" 1 "sin-suite" "$(co)"
python3 -I - "$ROOT" <<'PY2'; check "I1 ningún run: de los workflows interpola entradas controlables (inputs, títulos, ramas, cuerpos)" $?
import yaml,glob,os,re,sys
bad=[]; pat=re.compile(r"\$\{\{\s*(inputs\.|github\.event\.inputs|github\.head_ref|github\.event\.(pull_request|issue|comment|review|head_commit|commits|workflow_run\.head_branch|workflow_run\.display_title))")
for f in glob.glob(os.path.join(sys.argv[1],'.github/workflows/*.yml')):
    d=yaml.safe_load(open(f))
    for jn,j in (d.get('jobs') or {}).items():
        for st in j.get('steps') or []:
            if pat.search(str(st.get('run',''))): bad.append('%s:%s:%s'%(os.path.basename(f),jn,st.get('name','?')))
print('\n'.join(bad)); sys.exit(1 if bad else 0)
PY2
echo "── Coherencia de configuración"
python3 -I - "$ROOT" <<'PY'; check "R1 cada job de ci.yml (con su matriz) es check obligatorio en los rulesets de main, fijado a GitHub Actions, sin bypass" $?
import json,sys,yaml,glob,os
root=sys.argv[1]; ci=yaml.safe_load(open(os.path.join(root,'.github/workflows/ci.yml')))
names=set()
for j,d in ci['jobs'].items():
    n=d.get('name',j); m=(d.get('strategy') or {}).get('matrix') or {}
    if m: names|={"%s (%s)"%(n,v) for k,vs in m.items() if k not in('include','exclude') for v in vs}
    else: names.add(n)
bad=[]
for f in glob.glob(os.path.join(root,'scripts/kl/ruleset/[12]-*.json')):
    r=json.load(open(f))
    if r.get('bypass_actors'): bad.append(f+': bypass')
    sc=[x for x in r['rules'] if x['type']=='required_status_checks'][0]['parameters']['required_status_checks']
    got={c['context'] for c in sc if c.get('integration_id')==15368}
    if names-got: bad.append(f+': faltan '+', '.join(sorted(names-got)))
    if len(got)!=len(sc): bad.append(f+': check sin integration_id 15368')
print('\n'.join(bad)); sys.exit(1 if bad else 0)
PY
python3 -I - "$ROOT" <<'PY'; check "R2 deploy-dev solo despliega tras un run de .github/workflows/ci.yml (no por nombre)" $?
import yaml,sys,os
d=yaml.safe_load(open(os.path.join(sys.argv[1],'.github/workflows/deploy-dev.yml')))
sys.exit(0 if "github.event.workflow_run.path == '.github/workflows/ci.yml'" in d['jobs']['deploy']['if'] else 1)
PY
python3 -I - "$ROOT" <<'PY'; check "R3 rulesets de release/* y de creación de etiquetas kl-publish-* sin bypass" $?
import json,sys,os
r=os.path.join(sys.argv[1],'scripts/kl/ruleset')
a=json.load(open(os.path.join(r,'5-release.ruleset.json'))); b=json.load(open(os.path.join(r,'3b-tags-publish-creation.ruleset.json')))
ok={x['type'] for x in a['rules']}>={'deletion','non_fast_forward','creation','update'} and not a['bypass_actors'] and {x['type'] for x in b['rules']}=={'creation'} and not b['bypass_actors']
sys.exit(0 if ok else 1)
PY
python3 -I - "$ROOT" <<'PY2'; check "I2 IMAGE_REF se valida con [[ =~ ]] (sin grep por líneas) y se cita en todos sus usos" $?
import yaml,sys,os,re,subprocess
bad=[]
for f in ['deploy-staging.yml','deploy-production.yml']:
    d=yaml.safe_load(open(os.path.join(sys.argv[1],'.github/workflows',f)))
    runs=[st.get('run','') for st in d['jobs']['deploy']['steps'] if st.get('run')]
    v=[r for r in runs if 'IMAGE_REF' in r and '=~' in r]
    if not v: bad.append(f+': sin validación')
    else:
        chk=v[0].strip().split('\n')[0].split('||')[0]
        for val,want in [('abc123',0),('abc123\n--image=x',1),('a b',1),('',1),('v1.2-rc_3',0)]:
            rc=subprocess.run(['bash','-c','IMAGE_REF="$1"; '+chk,'_',val]).returncode
            if (rc==0)!=(want==0): bad.append('%s: %r'%(f,val))
    if re.search(r'(?<!")\$IMAGE_REF(?!")',''.join(r for r in runs if '=~' not in r)): bad.append(f+': uso sin comillas')
print('\n'.join(bad)); sys.exit(1 if bad else 0)
PY2
echo "──"; echo "RESULTADO: $PASS pruebas correctas, $FAIL fallidas"; [ "$FAIL" = 0 ]
