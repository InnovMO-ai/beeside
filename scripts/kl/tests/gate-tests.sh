#!/usr/bin/env bash
# Pruebas reproducibles del gate de KL (L1 v2). Uso, desde un clon con el commit a validar en HEAD:
#   bash scripts/kl/tests/gate-tests.sh
# Trata HEAD como "origin/main" simulado, copia los scripts de HEAD a un directorio SEPARADO (la referencia protegida) y ejecuta cada escenario
# sobre una rama kl/* de un clon temporal con el push deshabilitado. No toca ramas, remotos ni el árbol de trabajo. Termina con 1 si algo falla.
# Opcional: KL_LEGACY_BASE=<sha de feat/kl-1.0-code> para comprobar además el modo heredado (se omite si el objeto no existe).
set -u
export GIT_TERMINAL_PROMPT=0 GIT_AUTHOR_NAME=kl-test GIT_AUTHOR_EMAIL=t@local GIT_COMMITTER_NAME=kl-test GIT_COMMITTER_EMAIL=t@local
ROOT="$(git rev-parse --show-toplevel)"; SB="$(mktemp -d)"; trap 'rm -rf "$SB"' EXIT
sha() { if command -v sha256sum >/dev/null; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }
PASS=0; FAIL=0
git clone -q --no-local "$ROOT" "$SB/w" && cd "$SB/w" || exit 2
git remote set-url origin https://github.com/InnovMO-ai/beeside.git; git remote set-url --push origin NOPUSH
MAIN="$(git -C "$ROOT" rev-parse HEAD)"; git update-ref refs/remotes/origin/main "$MAIN"
mkdir -p "$SB/trusted"; git archive "$MAIN" scripts/kl | tar -x -C "$SB/trusted"; T="$SB/trusted/scripts/kl"
git rev-parse -q --verify refs/tags/kl-design-1.0-frozen >/dev/null || { echo "falta la etiqueta kl-design-1.0-frozen en el clon"; exit 2; }
sc() { git checkout -q -f -B "$1" origin/main; git clean -fdq; }
pf() { # $1 rama simulada · $2 aprobación (verified|deferred|missing) · $3 directorio del script (por omisión la referencia protegida)
  GITHUB_REPOSITORY=InnovMO-ai/beeside GITHUB_HEAD_REF="$1" KL_PLATFORM=knowledge-layer-code KL_GUARD_APPROVAL="${2:-missing}" bash "${3:-$T}/preflight.sh" --ci --pr-gate 2>&1; echo "exit=$?"; }
expect() { # nombre · exit esperado · regex esperada · salida
  local n="$1" want="$2" re="$3" out="$4" got; got="$(printf '%s\n' "$out" | sed -n 's/^exit=//p' | tail -1)"
  if [ "$got" = "$want" ] && printf '%s' "$out" | grep -Eq -- "$re"; then PASS=$((PASS+1)); printf 'PASS  %s\n' "$n"
  else FAIL=$((FAIL+1)); printf 'FALLA %s (exit %s esperado %s; patrón %s)\n' "$n" "$got" "$want" "$re"; printf '%s\n' "$out" | grep -E '^(STOP|REVISAR|RESULTADO)' | head -5 | sed 's/^/        /'; fi; }
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

echo "── Gate de pull request (scripts de la referencia protegida)"
sc kl/p1;  expect "P1 rama kl/* sin cambios" 0 "RESULTADO: OK" "$(pf kl/p1 deferred)"
sc kl/p2;  echo "// x" >> backend/src/kl/ingest/object-store.ts; c x; expect "P2 solo archivos de KL, sin tocar controles" 0 "RESULTADO: OK" "$(pf kl/p2 missing)"
sc kl/p3;  echo "# nota" >> scripts/kl/preflight.sh; setdecl scripts/kl/preflight.sh "PO 20-oct-2026 · aprobado" "$(H scripts/kl/preflight.sh)"; c x
           expect "P3 control modificado, declarado con hash y aprobación VERIFICADA" 0 "REVISAR +controles protegidos modificados con aprobación VERIFICADA" "$(pf kl/p3 verified)"
           expect "P6 mismo cambio en push (aprobación diferida al PR)" 0 "se verifica en el pull request" "$(pf kl/p3 deferred)"
sc feature/otra; mkdir -p backend/src/otro; echo x > backend/src/otro/a.ts; c x
           expect "P4 PR de otra plataforma que no toca KL" 0 "PR ajeno a KL" "$(pf feature/otra missing)"
echo "── Técnica 1 · reescribir preflight.sh para desactivarlo"
sc kl/n1; sed -i.bak '2i\
exit 0
' scripts/kl/preflight.sh; rm -f scripts/kl/preflight.sh.bak; setdecl scripts/kl/preflight.sh "PO 20-oct-2026 · aprobado" "$(H scripts/kl/preflight.sh)"; c x
           expect "N1a ejecutado desde referencia protegida: la edición se detecta" 1 "STOP +controles protegidos modificados sin aprobación verificada" "$(pf kl/n1 missing)"
           out="$(pf kl/n1 missing "$SB/w/scripts/kl")"; [ "$(printf '%s\n' "$out" | sed -n 's/^exit=//p')" = 0 ] && { PASS=$((PASS+1)); echo "PASS  N1c (demostración) el script editado, autoevaluado, sale 0 sin avisar: por eso el gate NUNCA lo ejecuta desde la rama"; } || { FAIL=$((FAIL+1)); echo "FALLA N1c la demostración no reprodujo el ataque"; }
           expect "N1b ejecutado desde el árbol evaluado (sin editar): se rechaza el autoexamen" 1 "debe venir de una referencia protegida" "$(sc kl/n1b; pf kl/n1b missing "$SB/w/scripts/kl")"
echo "── Técnica 2 · debilitar kl-ci.yml"
sc kl/n2; sed -i.bak 's/^  kl-tests:/  kl-tests:\n    if: false/' .github/workflows/kl-ci.yml; rm -f .github/workflows/kl-ci.yml.bak; c x
           expect "N2a kl-ci.yml debilitado" 1 "archivo de guarda del preflight sin declarar.*kl-ci.yml|sin declarar.*kl-ci.yml" "$(pf kl/n2 verified)"
           expect "N2b kl-ci.yml debilitado, sin aprobación verificada" 1 "STOP" "$(pf kl/n2 missing)"
sc kl/n2c; git rm -q .github/workflows/kl-ci.yml; c x; expect "N2c kl-ci.yml borrado" 1 "STOP" "$(pf kl/n2c verified)"
echo "── Técnica 4 · aprobación PENDIENTE y declaraciones falsas"
sc kl/n4; echo "# x" >> scripts/kl/preflight.sh; setdecl scripts/kl/preflight.sh "PENDIENTE de validación" "$(H scripts/kl/preflight.sh)"; c x
           expect "N4a PENDIENTE bloquea en CI aun con aprobación verificada" 1 "aprobación PENDIENTE" "$(pf kl/n4 verified)"
sc kl/n4b; echo "# x" >> scripts/kl/preflight.sh; setdecl scripts/kl/preflight.sh "PO 20-oct-2026 · aprobado" 00ff; c x
           expect "N4b declaración con hash incorrecto" 1 "sin declarar" "$(pf kl/n4b verified)"
sc kl/n4c; echo "backend/src/auth-x.ts | falso | PO 20-oct aprobó" >> scripts/kl/shared-changes.txt; echo x > backend/src/auth-x.ts; c x
           expect "N4c declaración falsificada en la propia rama (sin aprobación verificada)" 1 "controles protegidos modificados sin aprobación verificada" "$(pf kl/n4c missing)"
sc kl/n4d; echo "backend/src/auth-x.ts | no declarado" > /dev/null; echo x > backend/src/auth-x.ts; c x
           expect "N4d componente compartido sin declarar" 1 "componente compartido sin declarar" "$(pf kl/n4d verified)"
echo "── Controles de identidad y de rama"
sc kl/n5; echo "# x" >> .github/workflows/kl-preflight.yml; c x; expect "N5 kl-preflight.yml modificado" 1 "STOP" "$(pf kl/n5 verified)"
sc kl/n6; echo "ramaajena" > scripts/kl/x.txt; c x; git checkout -q -b feature/evade; expect "N6 rama no kl/* que toca scripts/kl (evasión por nombre)" 1 "modifica rutas de KL" "$(pf feature/evade verified)"
sc kl/n7; mkdir -p backend/src/precision; echo x > backend/src/precision/z.ts; c x; expect "N7 ruta de Precision" 1 "ruta de Precision" "$(pf kl/n7 verified)"
sc kl/n8; git checkout -q -b side; echo a > backend/src/kl/a.txt; c a; git checkout -q kl/n8; echo b > backend/src/kl/b.txt; c b; git merge -q --no-ff side -m m; expect "N8 commit de merge" 1 "merge no autorizado" "$(pf kl/n8 verified)"
sc kl/n9; git update-ref -d refs/remotes/origin/main; expect "N9 sin origin/main" 1 "falta origin/main" "$(pf kl/n9 verified)"; git update-ref refs/remotes/origin/main "$MAIN"
sc kl/n10; echo "# x" >> docs/knowledge-layer/kl-1.0-freeze-meta/verify.sh; printf '#!/usr/bin/env bash\ntouch "%s/SENTINEL"\nexit 0\n' "$SB" > docs/knowledge-layer/kl-1.0-freeze-meta/verify.sh; c x
           expect "N10 verify.sh malicioso (documentación congelada alterada)" 1 "documentación congelada alterada" "$(pf kl/n10 verified)"
           [ ! -e "$SB/SENTINEL" ] && { PASS=$((PASS+1)); echo "PASS  N10b el verify.sh alterado NO se ejecutó"; } || { FAIL=$((FAIL+1)); echo "FALLA N10b se ejecutó código de la rama"; }

echo "── Verificación de aprobación (API simulada)"
A="$SB/api"; mkdir -p "$A"; AP="$SB/approvers.txt"; printf '# aprobadores\npo-reviewer\n' > "$AP"; SHA=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
key() { printf '%s' "$1" | tr '/?&=' '____'; }
rv() { printf '[{"user":{"login":"%s"},"state":"%s","commit_id":"%s","submitted_at":"%s"}]' "$1" "$2" "$3" "$4"; }
va() { KL_API_DIR="$A" REPO=o/r PR=7 HEAD_SHA=$SHA AUTHOR="${2:-dev}" APPROVERS_FILE="${3:-$AP}" bash "$T/verify-approval.sh" 2>/dev/null; }
K="$A/$(key 'repos/o/r/pulls/7/reviews?per_page=100').json"
rv po-reviewer APPROVED $SHA 2026-10-20T10:00:00Z > "$K";  [ "$(va)" = verified ] && { PASS=$((PASS+1)); echo "PASS  A1 aprobación vigente de un aprobador"; } || { FAIL=$((FAIL+1)); echo "FALLA A1"; }
rv po-reviewer APPROVED bbbbbbbb 2026-10-20T10:00:00Z > "$K"; [ "$(va)" = missing ] && { PASS=$((PASS+1)); echo "PASS  A2 aprobación sobre un commit anterior no cuenta"; } || { FAIL=$((FAIL+1)); echo "FALLA A2"; }
rv po-reviewer APPROVED $SHA 2026-10-20T10:00:00Z > "$K"; [ "$(va x po-reviewer)" = missing ] && { PASS=$((PASS+1)); echo "PASS  A3 el autor no puede aprobar su propio cambio"; } || { FAIL=$((FAIL+1)); echo "FALLA A3"; }
rv intruso APPROVED $SHA 2026-10-20T10:00:00Z > "$K"; [ "$(va)" = missing ] && { PASS=$((PASS+1)); echo "PASS  A4 revisor fuera de la lista no cuenta"; } || { FAIL=$((FAIL+1)); echo "FALLA A4"; }
printf '[{"user":{"login":"po-reviewer"},"state":"APPROVED","commit_id":"%s","submitted_at":"2026-10-20T10:00:00Z"},{"user":{"login":"po-reviewer"},"state":"CHANGES_REQUESTED","commit_id":"%s","submitted_at":"2026-10-20T11:00:00Z"}]' $SHA $SHA > "$K"; [ "$(va)" = missing ] && { PASS=$((PASS+1)); echo "PASS  A5 una solicitud de cambios posterior anula la aprobación"; } || { FAIL=$((FAIL+1)); echo "FALLA A5"; }
rv po-reviewer APPROVED $SHA 2026-10-20T10:00:00Z > "$K"; printf '# vacío\n' > "$SB/vacio.txt"; [ "$(va dev "" "$SB/vacio.txt" 2>/dev/null || true)" = missing ] && { PASS=$((PASS+1)); echo "PASS  A6 lista de aprobadores vacía: falla cerrado"; } || { FAIL=$((FAIL+1)); echo "FALLA A6"; }
{ printf '[{"user":{"login":"otro"},"state":"COMMENTED","commit_id":"%s","submitted_at":"2026-10-19T10:00:00Z"}]' $SHA; rv po-reviewer APPROVED $SHA 2026-10-20T10:00:00Z; } > "$K"; [ "$(va)" = verified ] && { PASS=$((PASS+1)); echo "PASS  A7 respuesta paginada (varias listas JSON)"; } || { FAIL=$((FAIL+1)); echo "FALLA A7"; }

echo "── CI obligatorio de KL (API simulada)"
RK="$A/$(key "repos/o/r/actions/runs?head_sha=$SHA&per_page=100").json"; JK="$A/$(key 'repos/o/r/actions/runs/55/jobs?per_page=100').json"
run() { printf '{"workflow_runs":[{"id":55,"path":"%s","event":"pull_request","created_at":"2026-10-20T10:00:00Z","run_attempt":1}]}' "$1" > "$RK"; }
jobs() { printf '{"jobs":[%s]}' "$1" > "$JK"; }
jb() { printf '{"name":"%s","status":"%s","conclusion":%s}' "$1" "$2" "$3"; }
rc() { KL_API_DIR="$A" REPO=o/r HEAD_SHA=$SHA KL_CI_TIMEOUT=2 KL_CI_POLL=1 bash "$T/require-kl-ci.sh" 2>&1; echo "exit=$?"; }
run .github/workflows/kl-ci.yml; jobs "$(jb kl-tests completed '"success"'),$(jb kl-images completed '"success"')"; expect "C1 kl-tests y kl-images en success" 0 "terminó en success" "$(rc)"
jobs "$(jb kl-tests completed '"skipped"'),$(jb kl-images completed '"success"')"; expect "C2 kl-tests omitido (skipped) NO cuenta" 1 "kl-tests: skipped" "$(rc)"
jobs "$(jb kl-tests completed '"success"')"; expect "C3 falta kl-images" 1 "kl-images: ausente" "$(rc)"
jobs "$(jb kl-tests completed '"failure"'),$(jb kl-images completed '"success"')"; expect "C4 kl-tests falló" 1 "kl-tests: failure" "$(rc)"
jobs "$(jb kl-tests in_progress null),$(jb kl-images completed '"success"')"; expect "C5 sin terminar al agotarse el plazo" 1 "no apareció o no terminó" "$(rc)"
run .github/workflows/otro.yml; jobs "$(jb kl-tests completed '"success"'),$(jb kl-images completed '"success"')"; expect "C6 jobs verdes de OTRO workflow no cuentan" 1 "no apareció o no terminó" "$(rc)"

if [ -n "${KL_LEGACY_BASE:-}" ] && git -C "$ROOT" cat-file -e "${KL_LEGACY_BASE}^{commit}" 2>/dev/null; then
  echo "── Compatibilidad con feat/kl-1.0-code (modo heredado)"
  git fetch -q "$ROOT" "$KL_LEGACY_BASE" 2>/dev/null; git checkout -q -f -B feat/kl-1.0-code "$KL_LEGACY_BASE"; git clean -fdq
  cp -R "$SB/trusted/scripts/kl/." scripts/kl/; git -C "$ROOT" show "$MAIN:.github/workflows/kl-preflight.yml" > .github/workflows/kl-preflight.yml; c overlay
  out="$(GITHUB_REPOSITORY=InnovMO-ai/beeside GITHUB_HEAD_REF=feat/kl-1.0-code KL_PLATFORM=knowledge-layer-code bash scripts/kl/preflight.sh --ci 2>&1; echo "exit=$?")"
  expect "L1 modo heredado con aprobaciones PENDIENTE: bloquea en CI" 1 "aprobación PENDIENTE" "$out"
  python3 - <<'PY'
L=open('scripts/kl/shared-changes.txt').read().split('\n')
open('scripts/kl/shared-changes.txt','w').write('\n'.join(l.replace('PENDIENTE de validación KL y aprobación del PO','PO 20-oct-2026 · aprobado (simulado)').replace('modo main: PENDIENTE de validación KL y aprobación del PO','modo main: aprobado (simulado)') for l in L))
PY
  c aprobado; out="$(GITHUB_REPOSITORY=InnovMO-ai/beeside GITHUB_HEAD_REF=feat/kl-1.0-code KL_PLATFORM=knowledge-layer-code bash scripts/kl/preflight.sh --ci 2>&1; echo "exit=$?")"
  expect "L2 modo heredado con aprobaciones registradas" 0 "RESULTADO: OK" "$out"
else echo "── (modo heredado omitido: defina KL_LEGACY_BASE con el sha de feat/kl-1.0-code)"; fi
echo "──"; echo "RESULTADO: $PASS pruebas correctas, $FAIL fallidas"; [ "$FAIL" = 0 ]
