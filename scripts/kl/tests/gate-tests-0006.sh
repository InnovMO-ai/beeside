#!/usr/bin/env bash
# Pruebas de la decisión D1 (segunda identidad humana: castaneda-a). Mismo método que gate-tests.sh: clon temporal con push deshabilitado,
# scripts de HEAD como referencia protegida, API de GitHub simulada con JSON. Uso: bash scripts/kl/tests/gate-tests-0006.sh
# Lo que depende de GitHub real (permiso de escritura de castaneda-a, evaluación de CODEOWNERS por GitHub) lo comprueba L1-verificar-revisor.sh.
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
pf() { GITHUB_EVENT_NAME=pull_request_target GITHUB_HEAD_REF="$1" GITHUB_REPOSITORY=InnovMO-ai/beeside KL_PLATFORM=knowledge-layer-code KL_APPROVAL_RESULT="$2" bash "$T/gate-run.sh" "$T" 2>&1; echo "exit=$?"; }
expect() { local n="$1" want="$2" re="$3" out="$4" got; got="$(printf '%s\n' "$out" | sed -n 's/^exit=//p' | tail -1)"
  if [ "$got" = "$want" ] && printf '%s' "$out" | grep -Eq -- "$re"; then PASS=$((PASS+1)); printf 'PASS  %s\n' "$n"
  else FAIL=$((FAIL+1)); printf 'FALLA %s (exit %s esperado %s; patrón %s)\n' "$n" "$got" "$want" "$re"; printf '%s\n' "$out" | grep -E '^(STOP|REVISAR|RESULTADO)' | head -5 | sed 's/^/        /'; fi; }
check() { if [ "$2" = 0 ]; then PASS=$((PASS+1)); echo "PASS  $1"; else FAIL=$((FAIL+1)); echo "FALLA $1"; fi; }

echo "── Configuración versionada"
python3 -I - "$ROOT" <<'PY'; check "D1a CODEOWNERS: toda ruta protegida (CI/CD, gate, seguridad, migraciones, contratos) la poseen @InnovMO-ai y @castaneda-a" $?
import sys,os,fnmatch
root=sys.argv[1]; rules=[]
for l in open(os.path.join(root,'.github/CODEOWNERS')):
    l=l.strip()
    if not l or l.startswith('#'): continue
    p,*o=l.split(); rules.append((p,set(o)))
def owners(path):
    res=None
    for p,o in rules:   # semántica de CODEOWNERS: gana la última coincidencia
        q=p.lstrip('/')
        if p=='*' or (q.endswith('/') and path.startswith(q)) or path==q or fnmatch.fnmatch(path,q): res=o
    return res
paths=['.github/workflows/ci.yml','.github/workflows/deploy-dev.yml','.github/workflows/kl-publish-images.yml','.github/CODEOWNERS',
 'scripts/ci/integration.sh','scripts/secrets-scan.sh','scripts/fa4-copy-inventory.js','scripts/migrate.js','scripts/kl/preflight.sh',
 'scripts/kl/po-approvers.txt','scripts/kl/verify-approval.sh','scripts/kl/smoke/images.sh','deploy/production/deploy-production.sh',
 'infra/terraform/envs/dev/main.tf','backend/db/migrations/migration-targets.json','backend/src/kl/db/migrations/KL-0002_schema.sql',
 'backend/src/scripts/migration-target.ts','backend/src/scripts/domain-roles-prepare.ts','backend/src/kl/contract/kl-v1.ts',
 'backend/src/knowledge-layer/contract.ts','backend/src/precision-context/first-assessment-context.ts','shared/fa-public-engine/src/precision/versions.ts',
 'shared/canonical-fields/package.json','backend/Dockerfile','frontend/Dockerfile','package-lock.json','docs/adr/ADR-001.md',
 'backend/src/fa4/routes.ts','frontend/src/precision/x.ts']
bad=[p for p in paths if owners(p)!={'@InnovMO-ai','@castaneda-a'}]
bad+=['línea con un solo owner: '+p for p,o in rules if len(o)<2]
print('\n'.join(bad)); sys.exit(1 if bad else 0)
PY
python3 -I - "$ROOT" <<'PY'; check "D1b po-approvers.txt registra castaneda-a (y la cuenta del PO); ningún otro login" $?
import sys,os
a=[l.strip().lower() for l in open(os.path.join(sys.argv[1],'scripts/kl/po-approvers.txt')) if l.strip() and not l.lstrip().startswith('#')]
sys.exit(0 if sorted(a)==['castaneda-a','innovmo-ai'] else 1)
PY
python3 -I - "$ROOT" <<'PY'; check "D1c rulesets de main: revisión independiente obligatoria, solo merge commit, sin bypass; variantes sin segunda identidad retiradas" $?
import sys,os,json,glob
r=os.path.join(sys.argv[1],'scripts/kl/ruleset'); bad=[]
if glob.glob(os.path.join(r,'*sin-segunda-identidad*')) or os.path.exists(os.path.join(r,'CODEOWNERS.propuesto')): bad.append('quedan variantes/plantillas sin segunda identidad')
for f,co in [('1-bootstrap-main.ruleset.json',False),('2-final-main.ruleset.json',True)]:
    d=json.load(open(os.path.join(r,f))); p=[x for x in d['rules'] if x['type']=='pull_request'][0]['parameters']
    if d['bypass_actors']: bad.append(f+': bypass')
    if p['required_approving_review_count']<1 or not p['require_last_push_approval'] or not p['dismiss_stale_reviews_on_push']: bad.append(f+': revisión independiente incompleta')
    if co and not p['require_code_owner_review']: bad.append(f+': sin code owners')
    if {x['type'] for x in d['rules']}<{'deletion','non_fast_forward','pull_request','required_status_checks'}: bad.append(f+': faltan reglas')
    if p.get('allowed_merge_methods')!=['merge']: bad.append(f+': método de fusión no fijado a merge commit')
print('\n'.join(bad)); sys.exit(1 if bad else 0)
PY

echo "── Política de aprobación: nadie aprueba su propio cambio (API simulada)"
A="$SB/api"; mkdir -p "$A"; SHA=dddddddddddddddddddddddddddddddddddddddd; AP="$T/po-approvers.txt"
key() { printf '%s' "$1" | tr '/?&=' '____'; }
K="$A/$(key 'repos/InnovMO-ai/beeside/pulls/9/reviews?per_page=100').json"; CK="$A/$(key 'repos/InnovMO-ai/beeside/pulls/9/commits?per_page=100').json"
rv() { printf '{"user":{"login":"%s"},"state":"%s","commit_id":"%s","submitted_at":"%s"}' "$1" "$2" "${3:-$SHA}" "${4:-2026-10-21T10:00:00Z}"; }
cm() { printf '{"author":{"login":"%s"},"committer":{"login":"%s"}}' "$1" "${2:-$1}"; }
va() { KL_API_DIR="$A" REPO=InnovMO-ai/beeside PR=9 HEAD_SHA=$SHA AUTHOR="$1" APPROVERS_FILE="$AP" bash "$T/verify-approval.sh" 2>/dev/null; echo "exit=$?"; }
echo "[$(rv castaneda-a APPROVED)]" > "$K"; echo "[$(cm InnovMO-ai)]" > "$CK"
expect "V1 PR del PO aprobado por castaneda-a sobre el commit exacto" 0 "^verified$" "$(va InnovMO-ai)"
echo "[$(rv InnovMO-ai APPROVED)]" > "$K"; expect "V2 el PO no puede aprobar su propio PR" 0 "^missing$" "$(va InnovMO-ai)"
echo "[$(cm castaneda-a)]" > "$CK"; echo "[$(rv castaneda-a APPROVED)]" > "$K"; expect "V3 castaneda-a no puede aprobar su propio PR" 0 "^missing$" "$(va castaneda-a)"
echo "[$(rv InnovMO-ai APPROVED)]" > "$K"; expect "V4 PR de castaneda-a aprobado por el PO" 0 "^verified$" "$(va castaneda-a)"
echo "[$(cm InnovMO-ai),$(cm castaneda-a)]" > "$CK"; echo "[$(rv castaneda-a APPROVED)]" > "$K"; expect "V5 quien escribió un commit del PR no cuenta como revisor" 0 "^missing$" "$(va InnovMO-ai)"
echo "[$(cm InnovMO-ai castaneda-a)]" > "$CK"; expect "V6 quien empujó/reescribió un commit (committer) no cuenta" 0 "^missing$" "$(va InnovMO-ai)"
echo "[$(cm InnovMO-ai)]" > "$CK"; echo "[$(rv Castaneda-A APPROVED)]" > "$K"; expect "V7 login con otra capitalización: misma persona" 0 "^verified$" "$(va InnovMO-ai)"
echo "[$(rv castaneda-a APPROVED eeeeeeee)]" > "$K"; expect "V8 aprobación sobre un commit anterior no cuenta" 0 "^missing$" "$(va InnovMO-ai)"
echo "[$(rv castaneda-a APPROVED),$(rv castaneda-a DISMISSED "$SHA" 2026-10-21T11:00:00Z)]" > "$K"; expect "V9 aprobación descartada después no cuenta" 0 "^missing$" "$(va InnovMO-ai)"
echo "[$(rv castaneda-a APPROVED)]" > "$K"
rm -f "$CK"; expect "V10 commits del PR ilegibles (sin respuesta) => missing" 0 "^missing$" "$(va InnovMO-ai)"
echo '[]' > "$CK"; expect "V11 lista de commits vacía => missing" 0 "^missing$" "$(va InnovMO-ai)"
echo '<html>502</html>' > "$CK"; expect "V12 commits en HTML => missing" 0 "^missing$" "$(va InnovMO-ai)"
{ echo "[$(cm InnovMO-ai)]"; echo "[$(cm castaneda-a)]"; } > "$CK"; expect "V13 commit de castaneda-a en la página 2 de commits => missing" 0 "^missing$" "$(va InnovMO-ai)"
echo "[$(cm InnovMO-ai)]" > "$CK"; echo "[$(rv intruso APPROVED)]" > "$K"; expect "V14 revisor fuera de la lista no cuenta" 0 "^missing$" "$(va InnovMO-ai)"
echo "[$(rv castaneda-a APPROVED)]" > "$K"; echo '[{"author":null,"committer":{"login":"InnovMO-ai"}}]' > "$CK"; expect "V15 commit sin cuenta de GitHub asociada => missing (no se sabe quién lo escribió)" 0 "^missing$" "$(va InnovMO-ai)"
python3 -c 'import json;print(json.dumps([{"author":{"login":"InnovMO-ai"},"committer":{"login":"InnovMO-ai"}}]*250))' > "$CK"; expect "V16 250 commits (límite de la API) => missing" 0 "^missing$" "$(va InnovMO-ai)"

echo "── El registro de revisores es un control protegido"
# Edición portable (GNU y BSD/macOS): `sed -i` sin sufijo no es válido en BSD sed. Se comprueba que la manipulación quedó aplicada y confirmada
# antes de evaluar el gate, para que G1 no pueda pasar ni fallar por un cambio que nunca ocurrió.
sc feature/cod; sed -i.bak 's/ @castaneda-a//' .github/CODEOWNERS && rm -f .github/CODEOWNERS.bak; c x
! grep -q '@castaneda-a' .github/CODEOWNERS && [ "$(git diff --name-only origin/main HEAD)" = .github/CODEOWNERS ]; check "G1-pre la rama quita a castaneda-a de CODEOWNERS (único cambio, confirmado)" $?
expect "G1 PR que quita a castaneda-a de CODEOWNERS sin aprobación verificada" 1 "sin aprobación verificada.*CODEOWNERS" "$(pf feature/cod missing)"
expect "G1b mismo PR con aprobación verificada: el gate lo detecta y lo deja en REVISAR" 0 "aprobación VERIFICADA.*CODEOWNERS" "$(pf feature/cod verified)"
sc kl/ap; echo intruso >> scripts/kl/po-approvers.txt; c x; expect "G2 rama kl/* que añade un aprobador sin aprobación verificada" 1 "STOP" "$(pf kl/ap missing)"
sc feature/ap; echo intruso >> scripts/kl/po-approvers.txt; c x; expect "G3 PR ajeno que añade un aprobador" 1 "modifica rutas de KL" "$(pf feature/ap verified)"
echo "──"; echo "RESULTADO: $PASS pruebas correctas, $FAIL fallidas"; [ "$FAIL" = 0 ]
