#!/usr/bin/env bash
# Pruebas reproducibles del gate de KL (L1 v3). Uso, desde un clon con el commit a validar en HEAD:
#   bash scripts/kl/tests/gate-tests.sh
# Trata HEAD como "origin/main" simulado, copia los scripts de HEAD a un directorio SEPARADO (la referencia protegida) y ejecuta cada escenario
# sobre una rama de un clon temporal con el push deshabilitado. No toca ramas, remotos ni el árbol de trabajo. Termina con 1 si algo falla.
# Opcional: KL_LEGACY_BASE=<sha de feat/kl-1.0-code> para comprobar además el modo heredado (se omite si el objeto no existe).
# Las respuestas de la API de GitHub se SIMULAN con archivos JSON: lo que dependa del comportamiento real de GitHub NO queda probado aquí (ver L1_GUARDAS_CI.md §GitHub real).
set -u
export GIT_TERMINAL_PROMPT=0 GIT_AUTHOR_NAME=kl-test GIT_AUTHOR_EMAIL=t@local GIT_COMMITTER_NAME=kl-test GIT_COMMITTER_EMAIL=t@local
unset GITHUB_EVENT_NAME GITHUB_HEAD_REF GITHUB_REF_NAME KL_GUARD_APPROVAL KL_APPROVAL_RESULT
ROOT="$(git rev-parse --show-toplevel)"; SB="$(mktemp -d)"; trap 'rm -rf "$SB"' EXIT
sha() { if command -v sha256sum >/dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }
PASS=0; FAIL=0
git clone -q --no-local "$ROOT" "$SB/w" && cd "$SB/w" || exit 2
git remote set-url origin https://github.com/InnovMO-ai/beeside.git; git remote set-url --push origin NOPUSH
MAIN="$(git -C "$ROOT" rev-parse HEAD)"; git update-ref refs/remotes/origin/main "$MAIN"
mkdir -p "$SB/trusted"; git archive "$MAIN" scripts/kl | tar -x -C "$SB/trusted"; T="$SB/trusted/scripts/kl"
git rev-parse -q --verify refs/tags/kl-design-1.0-frozen >/dev/null || { echo "falta la etiqueta kl-design-1.0-frozen en el clon"; exit 2; }
sc() { git checkout -q -f -B "$1" ${2:-origin/main}; git clean -fdq; }
# pf <rama simulada> <resultado de aprobación: verified|missing|push|otro> [dir de scripts]  → gate completo (gate-run.sh), como el workflow
pf() { local ev=pull_request_target res="${2-missing}" d="${3:-$T}"; [ "$res" = push ] && { ev=push; res=""; }
  if [ "$ev" = push ]; then GITHUB_EVENT_NAME=push GITHUB_REF_NAME="$1" GITHUB_REPOSITORY=InnovMO-ai/beeside KL_PLATFORM=knowledge-layer-code bash "$d/gate-run.sh" "$d" 2>&1
  else GITHUB_EVENT_NAME=pull_request_target GITHUB_HEAD_REF="$1" GITHUB_REPOSITORY=InnovMO-ai/beeside KL_PLATFORM=knowledge-layer-code KL_APPROVAL_RESULT="$res" bash "$d/gate-run.sh" "$d" 2>&1; fi; echo "exit=$?"; }
# pfd <evento> <rama> <valor KL_GUARD_APPROVAL> [bandera]  → preflight directo (sin gate-run.sh), para probar sus propias defensas
pfd() { GITHUB_EVENT_NAME="$1" GITHUB_HEAD_REF="$2" GITHUB_REPOSITORY=InnovMO-ai/beeside KL_PLATFORM=knowledge-layer-code KL_GUARD_APPROVAL="$3" bash "$T/preflight.sh" --ci ${4:-} 2>&1; echo "exit=$?"; }
expect() { local n="$1" want="$2" re="$3" out="$4" got; got="$(printf '%s\n' "$out" | sed -n 's/^exit=//p' | tail -1)"
  if [ "$got" = "$want" ] && printf '%s' "$out" | grep -Eq -- "$re"; then PASS=$((PASS+1)); printf 'PASS  %s\n' "$n"
  else FAIL=$((FAIL+1)); printf 'FALLA %s (exit %s esperado %s; patrón %s)\n' "$n" "$got" "$want" "$re"; printf '%s\n' "$out" | grep -E '^(STOP|REVISAR|RESULTADO)' | head -5 | sed 's/^/        /'; fi; }
check() { if [ "$2" = 0 ]; then PASS=$((PASS+1)); echo "PASS  $1"; else FAIL=$((FAIL+1)); echo "FALLA $1"; fi; }
setdecl() { python3 - "$1" "$2" "$3" <<'PY'
import sys
p,ap,h=sys.argv[1:]; L=open('scripts/kl/shared-changes.txt').read().split('\n')
for i,l in enumerate(L):
    if l.startswith(p+' |'):
        f=[x.strip() for x in l.split(' | ')]; f[-2]=ap; f[-1]='sha256='+h; L[i]=' | '.join(f)
open('scripts/kl/shared-changes.txt','w').write('\n'.join(L))
PY
}
H() { sha "$1" | cut -d' ' -f1; }
c() { git add -A; git commit -qm "$1"; }
rc_of() { printf '%s\n' "$1" | sed -n 's/^exit=//p' | tail -1; }

echo "── Gate de pull request (scripts de la referencia protegida)"
sc kl/p1;  expect "P1 rama kl/* sin cambios" 0 "RESULTADO: OK" "$(pf kl/p1 verified)"
sc kl/p2;  echo "// x" >> backend/src/kl/ingest/object-store.ts; c x; expect "P2 solo archivos de KL, sin tocar controles" 0 "RESULTADO: OK" "$(pf kl/p2 missing)"
sc kl/p3;  echo "# nota" >> scripts/kl/preflight.sh; setdecl scripts/kl/preflight.sh "PO 20-oct-2026 · aprobado" "$(H scripts/kl/preflight.sh)"; c x
           expect "P3 control modificado, declarado con hash y aprobación VERIFICADA" 0 "REVISAR +controles protegidos modificados con aprobación VERIFICADA" "$(pf kl/p3 verified)"
           expect "P6 mismo cambio en push (aprobación diferida al PR)" 0 "se exige en el pull request" "$(pf kl/p3 push)"
sc feature/otra; mkdir -p backend/src/otro; echo x > backend/src/otro/a.ts; c x
           expect "P4 PR de otra plataforma que no toca KL" 0 "PR ajeno a KL" "$(pf feature/otra missing)"
sc feature/disc; mkdir -p backend/src/fa4; echo x > backend/src/fa4/a.ts; c x; expect "P7 Discovery: PR que toca solo su código sigue pasando" 0 "RESULTADO: OK \(PR ajeno a KL\)" "$(pf feature/disc missing)"
sc feature/prec; mkdir -p backend/src/precision; echo x > backend/src/precision/a.ts; c x; expect "P8 Precision: PR que toca solo su código sigue pasando" 0 "RESULTADO: OK \(PR ajeno a KL\)" "$(pf feature/prec missing)"
sc kl/p9;  echo "# x" >> backend/Dockerfile; c x; expect "P9 KL: cambio de un compartido ya declarado sigue siendo REVISAR" 0 "componente compartido declarado" "$(pf kl/p9 missing)"

echo "── Técnica 1 · reescribir preflight.sh para desactivarlo"
sc kl/n1; sed -i.bak '2i\
exit 0
' scripts/kl/preflight.sh; rm -f scripts/kl/preflight.sh.bak; setdecl scripts/kl/preflight.sh "PO 20-oct-2026 · aprobado" "$(H scripts/kl/preflight.sh)"; c x
           expect "N1a ejecutado desde referencia protegida: la edición se detecta" 1 "STOP +controles protegidos modificados sin aprobación verificada" "$(pf kl/n1 missing)"
           out="$(pf kl/n1 missing "$SB/w/scripts/kl")"; [ "$(rc_of "$out")" = 0 ] && check "N1c (demostración) el script editado, autoevaluado, sale 0 sin avisar: por eso el gate NUNCA lo ejecuta desde la rama" 0 || check "N1c la demostración no reprodujo el ataque" 1
           expect "N1b ejecutado desde el árbol evaluado (sin editar): se rechaza el autoexamen" 1 "debe venir de una referencia protegida" "$(sc kl/n1b; pf kl/n1b missing "$SB/w/scripts/kl")"
echo "── Técnica 2 · debilitar kl-ci.yml"
sc kl/n2; sed -i.bak 's/^  kl-tests:/  kl-tests:\n    if: false/' .github/workflows/kl-ci.yml; rm -f .github/workflows/kl-ci.yml.bak; c x
           expect "N2a kl-ci.yml debilitado" 1 "sin declarar.*kl-ci.yml" "$(pf kl/n2 verified)"
           expect "N2b kl-ci.yml debilitado, sin aprobación verificada" 1 "STOP" "$(pf kl/n2 missing)"
sc kl/n2c; git rm -q .github/workflows/kl-ci.yml; c x; expect "N2c kl-ci.yml borrado" 1 "STOP" "$(pf kl/n2c verified)"
sc kl/n2d; git mv .github/workflows/kl-ci.yml .github/workflows/kl-ci.yml.off; c x; expect "N2d kl-ci.yml renombrado" 1 "STOP" "$(pf kl/n2d verified)"
echo "── Técnica 4 · aprobación PENDIENTE y declaraciones falsas"
sc kl/n4; echo "# x" >> scripts/kl/preflight.sh; setdecl scripts/kl/preflight.sh "PENDIENTE de validación" "$(H scripts/kl/preflight.sh)"; c x
           expect "N4a PENDIENTE bloquea en CI aun con aprobación verificada" 1 "aprobación PENDIENTE" "$(pf kl/n4 verified)"
sc kl/n4b; echo "# x" >> scripts/kl/preflight.sh; setdecl scripts/kl/preflight.sh "PO 20-oct-2026 · aprobado" 00ff; c x
           expect "N4b declaración con hash incorrecto" 1 "sin declarar" "$(pf kl/n4b verified)"
sc kl/n4c; echo "backend/src/auth-x.ts | falso | PO 20-oct aprobó" >> scripts/kl/shared-changes.txt; echo x > backend/src/auth-x.ts; c x
           expect "N4c declaración falsificada en la propia rama (sin aprobación verificada)" 1 "controles protegidos modificados sin aprobación verificada" "$(pf kl/n4c missing)"
sc kl/n4d; echo x > backend/src/auth-x.ts; c x; expect "N4d componente compartido sin declarar" 1 "componente compartido sin declarar" "$(pf kl/n4d verified)"
echo "── Controles de identidad y de rama"
sc kl/n5; echo "# x" >> .github/workflows/kl-preflight.yml; c x; expect "N5 kl-preflight.yml modificado" 1 "STOP" "$(pf kl/n5 verified)"
sc kl/n6; echo "ramaajena" > scripts/kl/x.txt; c x; git checkout -q -b feature/evade; expect "N6 rama no kl/* que toca scripts/kl (evasión por nombre)" 1 "modifica rutas de KL" "$(pf feature/evade verified)"
sc kl/n7; mkdir -p backend/src/precision; echo x > backend/src/precision/z.ts; c x; expect "N7 ruta de Precision desde una rama kl/*" 1 "ruta de Precision" "$(pf kl/n7 verified)"
sc kl/n8; git checkout -q -b side; echo a > backend/src/kl/a.txt; c a; git checkout -q kl/n8; echo b > backend/src/kl/b.txt; c b; git merge -q --no-ff side -m m; expect "N8 commit de merge" 1 "merge no autorizado" "$(pf kl/n8 verified)"
sc kl/n9; git update-ref -d refs/remotes/origin/main; expect "N9 sin origin/main" 1 "falta origin/main" "$(pf kl/n9 verified)"; git update-ref refs/remotes/origin/main "$MAIN"
sc kl/n10; printf '#!/usr/bin/env bash\ntouch "%s/SENTINEL"\nexit 0\n' "$SB" > docs/knowledge-layer/kl-1.0-freeze-meta/verify.sh; c x
           expect "N10 verify.sh malicioso (documentación congelada alterada)" 1 "documentación congelada alterada" "$(pf kl/n10 verified)"
           [ ! -e "$SB/SENTINEL" ]; check "N10b el verify.sh alterado NO se ejecutó" $?

echo "── B1 · el gate de PR nunca usa el modo heredado"
sc feat/kl-1.0-code; sed -i.bak 's/^  kl-tests:/  kl-tests:\n    if: false/' .github/workflows/kl-ci.yml; rm -f .github/workflows/kl-ci.yml.bak; c x
           expect "B1a rama llamada feat/kl-1.0-code con kl-ci.yml debilitado y sin aprobación" 1 "NO admite el modo heredado" "$(pf feat/kl-1.0-code missing)"
           expect "B1b lo mismo aunque el valor de aprobación sea 'verified'" 1 "NO admite el modo heredado" "$(pf feat/kl-1.0-code verified)"
sc feat/kl-1.0-code; expect "B1c el nombre solo basta para el STOP (árbol idéntico a main)" 1 "NO admite el modo heredado" "$(pf feat/kl-1.0-code verified)"
           expect "B1d evento pull_request_target SIN la bandera --pr-gate: el preflight la impone" 1 "NO admite el modo heredado" "$(pfd pull_request_target feat/kl-1.0-code verified)"
sc kl/b1e; expect "B1e evento pull_request_target con rama kl/* limpia: sigue pasando" 0 "RESULTADO: OK" "$(pfd pull_request_target kl/b1e verified)"

echo "── B2 · cualquier error o aprobación no verificable bloquea"
sc kl/b2; echo "# x" >> scripts/kl/po-approvers.txt; echo attacker >> scripts/kl/po-approvers.txt; setdecl scripts/kl/po-approvers.txt "PO 21-oct (falsa)" "$(H scripts/kl/po-approvers.txt)"; c x
           for v in "" "VERIFIED" "yes" "true" "deferred" "verified x" "missing"; do expect "B2a KL_APPROVAL_RESULT='$v' => STOP" 1 "sin aprobación verificada" "$(pf kl/b2 "$v")"; done
           expect "B2b valor exacto 'verified' (única vía de paso)" 0 "aprobación VERIFICADA" "$(pf kl/b2 verified)"
           expect "B2c 'deferred' con evento pull_request_target => STOP" 1 "sin aprobación verificada" "$(pfd pull_request_target kl/b2 deferred)"
           expect "B2d 'verified' con evento push => STOP" 1 "sin aprobación verificada" "$(pfd push kl/b2 verified)"
           expect "B2e valor vacío => STOP" 1 "sin aprobación verificada" "$(pfd pull_request_target kl/b2 "")"
           expect "B2f evento no soportado en el lanzador => STOP" 1 "no soportado" "$(GITHUB_EVENT_NAME=workflow_dispatch bash "$T/gate-run.sh" "$T" 2>&1; echo "exit=$?")"
           expect "B2g evento vacío en el lanzador => STOP" 1 "no soportado" "$(env -u GITHUB_EVENT_NAME bash "$T/gate-run.sh" "$T" 2>&1; echo "exit=$?")"
           expect "B2h lanzador sin preflight confiable => STOP" 1 "falta el preflight" "$(GITHUB_EVENT_NAME=push bash "$T/gate-run.sh" /nonexistent 2>&1; echo "exit=$?")"
A="$SB/api"; mkdir -p "$A"; AP="$SB/approvers.txt"; printf '# aprobadores\npo-reviewer\n' > "$AP"; SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
key() { printf '%s' "$1" | tr '/?&=' '____'; }
rv() { printf '[{"user":{"login":"%s"},"state":"%s","commit_id":"%s","submitted_at":"%s"}]' "$1" "$2" "$3" "$4"; }
va() { KL_API_DIR="$A" REPO=o/r PR=7 HEAD_SHA=$SHA AUTHOR="${2:-dev}" APPROVERS_FILE="${3:-$AP}" bash "$T/verify-approval.sh" 2>/dev/null; echo "exit=$?"; }
K="$A/$(key 'repos/o/r/pulls/7/reviews?per_page=100').json"
CK="$A/$(key 'repos/o/r/pulls/7/commits?per_page=100').json"; printf '[{"author":{"login":"dev"},"committer":{"login":"dev"}}]' > "$CK"   # D1: commits del PR (autor dev)
rv po-reviewer APPROVED $SHA 2026-10-20T10:00:00Z > "$K";  expect "A1 aprobación vigente de un aprobador" 0 "^verified" "$(va)"
rv po-reviewer APPROVED bbbbbbbb 2026-10-20T10:00:00Z > "$K"; expect "A2 aprobación sobre un commit anterior no cuenta" 0 "^missing" "$(va)"
rv po-reviewer APPROVED $SHA 2026-10-20T10:00:00Z > "$K"; expect "A3 el autor no puede aprobar su propio cambio" 0 "^missing" "$(va x po-reviewer)"
rv intruso APPROVED $SHA 2026-10-20T10:00:00Z > "$K"; expect "A4 revisor fuera de la lista no cuenta" 0 "^missing" "$(va)"
printf '[{"user":{"login":"po-reviewer"},"state":"APPROVED","commit_id":"%s","submitted_at":"2026-10-20T10:00:00Z"},{"user":{"login":"po-reviewer"},"state":"CHANGES_REQUESTED","commit_id":"%s","submitted_at":"2026-10-20T11:00:00Z"}]' $SHA $SHA > "$K"; expect "A5 una solicitud de cambios posterior anula la aprobación" 0 "^missing" "$(va)"
rv po-reviewer APPROVED $SHA 2026-10-20T10:00:00Z > "$K"; printf '# vacío\n' > "$SB/vacio.txt"; expect "A6 lista de aprobadores vacía: falla cerrado" 0 "^missing" "$(va x dev "$SB/vacio.txt")"
{ printf '[{"user":{"login":"otro"},"state":"COMMENTED","commit_id":"%s","submitted_at":"2026-10-19T10:00:00Z"}]' $SHA; rv po-reviewer APPROVED $SHA 2026-10-20T10:00:00Z; } > "$K"; expect "A7 respuesta paginada (varias listas JSON)" 0 "^verified" "$(va)"
echo '<html><body>502 Bad Gateway</body></html>' > "$K"; expect "A8 respuesta HTML => missing, exit 0" 0 "^missing$" "$(va)"
: > "$K"; expect "A9 respuesta vacía => missing" 0 "^missing$" "$(va)"
printf '{"message":"API rate limit exceeded"}' > "$K"; expect "A10 error JSON de la API => missing" 0 "^missing$" "$(va)"
rm -f "$K"; expect "A11 la API no responde (archivo inexistente) => missing" 0 "^missing$" "$(va)"
rv po-reviewer APPROVED $SHA 2026-10-20T10:00:00Z > "$K"; expect "A12 sin variables de entorno => missing, exit 0" 0 "^missing$" "$(env -i PATH="$PATH" bash "$T/verify-approval.sh" 2>/dev/null; echo "exit=$?")"
expect "A13 sin python3 => missing" 0 "^missing$" "$(KL_API_DIR="$A" REPO=o/r PR=7 HEAD_SHA=$SHA AUTHOR=dev APPROVERS_FILE="$AP" PATH=/nonexistent /bin/bash "$T/verify-approval.sh" 2>/dev/null; echo "exit=$?")"
expect "A14 sin archivo de aprobadores => missing" 0 "^missing$" "$(va x dev /nonexistent)"

echo "── B3 · workflows y checks protegidos"
for f in kl-publish-images.yml deploy-dev.yml deploy-staging.yml deploy-production.yml ci.yml; do sc kl/b3; echo "# x" >> ".github/workflows/$f"; c x
  expect "B3a rama kl/* modifica $f sin aprobación verificada" 1 "controles protegidos modificados sin aprobación verificada.*$f" "$(pf kl/b3 missing)"; done
sc kl/b3b; echo "# x" >> .github/workflows/deploy-dev.yml; c x; expect "B3b ... y con aprobación verificada pasa a REVISAR" 0 "aprobación VERIFICADA.*deploy-dev.yml" "$(pf kl/b3b verified)"
sc kl/b3c; printf 'name: x\non: pull_request\njobs:\n  kl-gate:\n    runs-on: ubuntu-latest\n    steps: [{run: "true"}]\n  kl-tests:\n    runs-on: ubuntu-latest\n    steps: [{run: "true"}]\n' > .github/workflows/kl-fake.yml; c x
           expect "B3c workflow nuevo kl-fake.yml que emite kl-gate/kl-tests (rama kl/*)" 1 "controles protegidos modificados sin aprobación verificada.*kl-fake.yml" "$(pf kl/b3c missing)"
sc feature/zz; printf 'name: x\non: pull_request\njobs:\n  kl-gate:\n    runs-on: ubuntu-latest\n    steps: [{run: "true"}]\n' > .github/workflows/zz.yml; c x
           expect "B3d workflow que emite kl-gate desde una rama de otra plataforma" 1 "controles protegidos modificados sin aprobación verificada.*zz.yml" "$(pf feature/zz missing)"
           expect "B3e ... con aprobación verificada el PO decide (REVISAR)" 0 "aprobación VERIFICADA.*zz.yml" "$(pf feature/zz verified)"
sc feature/own; echo "* @alguien" > .github/CODEOWNERS; c x; expect "B3f CODEOWNERS modificado desde otra plataforma" 1 "sin aprobación verificada.*CODEOWNERS" "$(pf feature/own missing)"
sc kl/b3g; echo "# x" >> scripts/kl/verify-check-origin.sh; c x; expect "B3g verify-check-origin.sh es control protegido" 1 "STOP" "$(pf kl/b3g verified)"
sc kl/b3h; echo "# x" >> scripts/kl/gate-run.sh; c x; expect "B3h gate-run.sh es control protegido" 1 "STOP" "$(pf kl/b3h verified)"

echo "── Origen de los checks (API simulada)"
HS=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb
CRK="$A/$(key "repos/o/r/commits/$HS/check-runs?per_page=100").json"; STK="$A/$(key "repos/o/r/commits/$HS/statuses?per_page=100").json"
runfile() { printf '{"id":%s,"path":"%s","head_sha":"%s","repository":{"full_name":"%s"},"check_suite_id":%s}' "$1" "$2" "${3:-$HS}" "${4:-o/r}" "$((9000+$1))" > "$A/$(key "repos/o/r/actions/runs/$1").json"; }
cr() { printf '{"name":"%s","app":{"id":%s,"slug":"%s"},"details_url":"https://github.com/o/r/actions/runs/%s/job/9","check_suite":{"id":%s}}' "$1" "$2" "$3" "$4" "$((9000+$4))"; }
co() { KL_API_DIR="$A" REPO=o/r HEAD_SHA=$HS bash "$T/verify-check-origin.sh" 2>&1; echo "exit=$?"; }
runfile 100 .github/workflows/kl-preflight.yml; runfile 200 .github/workflows/kl-ci.yml; echo '[]' > "$STK"
printf '{"check_runs":[%s,%s,%s]}' "$(cr kl-gate 15368 github-actions 100)" "$(cr kl-tests 15368 github-actions 200)" "$(cr kl-images 15368 github-actions 200)" > "$CRK"; expect "O1 checks de GitHub Actions y workflows esperados" 0 "origen de los checks protegidos verificado" "$(co)"
printf '{"check_runs":[%s]}' "$(cr kl-tests 99999 otra-app 200)" > "$CRK"; expect "O2 kl-tests emitido por otra app" 1 "app-ajena" "$(co)"
runfile 300 .github/workflows/kl-fake.yml; printf '{"check_runs":[%s]}' "$(cr kl-gate 15368 github-actions 300)" > "$CRK"; expect "O3 kl-gate emitido por un workflow distinto de kl-preflight.yml" 1 "NO es kl-preflight.yml" "$(co)"
printf '{"check_runs":[%s]}' "$(cr kl-tests 15368 github-actions 300)" > "$CRK"; expect "O4 kl-tests emitido por un workflow distinto de kl-ci.yml" 1 "NO es kl-ci.yml" "$(co)"
runfile 200 .github/workflows/kl-ci.yml aaaaaaaa; printf '{"check_runs":[%s]}' "$(cr kl-tests 15368 github-actions 200)" > "$CRK"; expect "O5 el run de kl-tests es de otro commit" 1 "NO es kl-ci.yml" "$(co)"
runfile 200 .github/workflows/kl-ci.yml "$HS" otro/repo; expect "O6 el run de kl-tests es de otro repositorio" 1 "NO es kl-ci.yml" "$(co)"
runfile 200 .github/workflows/kl-ci.yml; printf '[{"context":"kl-gate","state":"success"}]' > "$STK"; printf '{"check_runs":[%s]}' "$(cr kl-gate 15368 github-actions 100)" > "$CRK"; expect "O7 estado de commit (Statuses API) llamado kl-gate" 1 "Statuses API" "$(co)"
echo '[]' > "$STK"; echo 'no es json' > "$CRK"; expect "O8 check-runs ilegibles => STOP" 1 "STOP" "$(co)"
rm -f "$CRK"; expect "O9 la API no responde => STOP" 1 "STOP" "$(co)"
printf '{"check_runs":[%s]}' "$(cr kl-gate 15368 github-actions 100)" > "$CRK"; echo 'basura' > "$STK"; expect "O10 estados ilegibles => STOP" 1 "STOP" "$(co)"
echo '[]' > "$STK"; printf '{"check_runs":[%s,%s]}' "$(cr otro-check 99999 x 1)" "$(cr kl-gate-push 15368 github-actions 100)" > "$CRK"; expect "O11 un check ajeno a los nombres protegidos no estorba" 0 "origen de los checks" "$(co)"

echo "── CI obligatorio de KL (API simulada)"
RK="$A/$(key "repos/o/r/actions/runs?head_sha=$SHA&per_page=100").json"; JK="$A/$(key 'repos/o/r/actions/runs/55/jobs?per_page=100').json"
run() { printf '{"workflow_runs":[{"id":55,"path":"%s","event":"%s","head_sha":"%s","repository":{"full_name":"%s"},"created_at":"2026-10-20T10:00:00Z","run_attempt":1}]}' "$1" "${2:-pull_request}" "${3:-$SHA}" "${4:-o/r}" > "$RK"; }
jobs() { printf '{"jobs":[%s]}' "$1" > "$JK"; }
jb() { printf '{"name":"%s","status":"%s","conclusion":%s,"head_sha":"%s","run_id":55,"workflow_name":"%s"}' "$1" "$2" "$3" "${4:-$SHA}" "${5:-KL CI (aislado)}"; }
rc() { KL_API_DIR="$A" REPO=o/r HEAD_SHA=$SHA KL_CI_TIMEOUT=2 KL_CI_POLL=1 bash "$T/require-kl-ci.sh" 2>&1; echo "exit=$?"; }
OKJ="$(jb kl-tests completed '"success"'),$(jb kl-images completed '"success"')"
run .github/workflows/kl-ci.yml; jobs "$OKJ"; expect "C1 kl-tests y kl-images en success" 0 "terminó en success" "$(rc)"
jobs "$(jb kl-tests completed '"skipped"'),$(jb kl-images completed '"success"')"; expect "C2 kl-tests omitido (skipped) NO cuenta" 1 "kl-tests: skipped" "$(rc)"
jobs "$(jb kl-tests completed '"success"')"; expect "C3 falta kl-images" 1 "kl-images: ausente" "$(rc)"
jobs "$(jb kl-tests completed '"failure"'),$(jb kl-images completed '"success"')"; expect "C4 kl-tests falló" 1 "kl-tests: failure" "$(rc)"
jobs "$(jb kl-tests in_progress null),$(jb kl-images completed '"success"')"; expect "C5 sin terminar al agotarse el plazo" 1 "no apareció o no terminó" "$(rc)"
run .github/workflows/otro.yml; jobs "$OKJ"; expect "C6 jobs verdes de OTRO workflow no cuentan" 1 "no apareció o no terminó" "$(rc)"
run .github/workflows/kl-ci.yml push; jobs "$OKJ"; expect "C7 un run de evento push no sustituye al de pull_request" 1 "no apareció o no terminó" "$(rc)"
run .github/workflows/kl-ci.yml pull_request aaaaaaaa; expect "C8 run de otro commit" 1 "no apareció o no terminó" "$(rc)"
run .github/workflows/kl-ci.yml pull_request "$SHA" otro/repo; expect "C9 run de otro repositorio" 1 "no apareció o no terminó" "$(rc)"
run .github/workflows/kl-ci.yml; jobs "$(jb kl-tests completed '"success"' aaaaaaaa),$(jb kl-images completed '"success"')"; expect "C10 job de otro commit" 1 "kl-tests: ausente" "$(rc)"
jobs "$(jb kl-tests completed '"success"' "$SHA" 'Otro workflow'),$(jb kl-images completed '"success"')"; expect "C11 job con workflow_name distinto" 1 "kl-tests: ausente" "$(rc)"
echo 'basura' > "$RK"; expect "C12 respuesta ilegible de runs => STOP (nunca PASS)" 1 "no apareció o no terminó" "$(rc)"
run .github/workflows/kl-ci.yml; echo 'basura' > "$JK"; expect "C13 respuesta ilegible de jobs => STOP" 1 "no apareció o no terminó" "$(rc)"

if [ -n "${KL_LEGACY_BASE:-}" ] && git -C "$ROOT" cat-file -e "${KL_LEGACY_BASE}^{commit}" 2>/dev/null; then
  echo "── Compatibilidad con feat/kl-1.0-code (modo heredado, solo push) y B1 sobre el linaje real"
  git fetch -q "$ROOT" "$KL_LEGACY_BASE" 2>/dev/null; git checkout -q -f -B feat/kl-1.0-code "$KL_LEGACY_BASE"; git clean -fdq
  cp -R "$SB/trusted/scripts/kl/." scripts/kl/; git -C "$ROOT" show "$MAIN:.github/workflows/kl-preflight.yml" > .github/workflows/kl-preflight.yml; c overlay
  legacy() { env -u GITHUB_EVENT_NAME GITHUB_REF_NAME=feat/kl-1.0-code GITHUB_REPOSITORY=InnovMO-ai/beeside KL_PLATFORM=knowledge-layer-code bash scripts/kl/preflight.sh --ci 2>&1; echo "exit=$?"; }
  expect "L1 modo heredado (push) con aprobaciones PENDIENTE: bloquea en CI" 1 "aprobación PENDIENTE" "$(legacy)"
  python3 - <<'PY'
import re
s=open('scripts/kl/shared-changes.txt').read()
s=s.replace('PENDIENTE de validación KL y aprobación del PO','PO 20-oct-2026 · aprobado (simulado)').replace('modo main: PENDIENTE de validación KL y aprobación del PO','modo main: aprobado (simulado)')
open('scripts/kl/shared-changes.txt','w').write(s)
PY
  c aprobado; expect "L2 modo heredado (push) con aprobaciones registradas" 0 "RESULTADO: OK" "$(legacy)"
  sed -i.bak 's/^  kl-tests:/  kl-tests:\n    if: false/' .github/workflows/kl-ci.yml 2>/dev/null; rm -f .github/workflows/kl-ci.yml.bak; c debil
  expect "B1f linaje REAL feat/kl-1.0-code + kl-ci.yml debilitado en el gate de PR" 1 "NO admite el modo heredado" "$(pf feat/kl-1.0-code missing)"
else echo "── (modo heredado omitido: defina KL_LEGACY_BASE con el sha de feat/kl-1.0-code)"; fi
echo "──"; echo "RESULTADO: $PASS pruebas correctas, $FAIL fallidas"; [ "$FAIL" = 0 ]
