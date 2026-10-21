#!/usr/bin/env bash
# KL 1.0 · Preflight obligatorio de Knowledge Layer Code
#
# Uso (desde el worktree KL):
#   KL_PLATFORM=knowledge-layer-code bash scripts/kl/preflight.sh            # inicio de sesión / desarrollo
#   KL_PLATFORM=knowledge-layer-code bash scripts/kl/preflight.sh --gate     # antes de cada commit
#   KL_PLATFORM=knowledge-layer-code bash scripts/kl/preflight.sh --remote   # además contrasta la etiqueta con origin
#   bash scripts/kl/preflight.sh --ci                                        # GitHub Actions (implica --gate)
#   bash <ref-protegida>/scripts/kl/preflight.sh --ci --pr-gate              # gate de pull request: el script viene de main, el árbol evaluado es el de la rama
#
# Ramas: feat/kl-1.0-code (modo heredado, sin cambios) o kl/* creadas desde main (modo main: solo cuenta lo que la rama cambia respecto de main).
# Salida: 0 = OK (puede listar elementos a REVISAR) · 1 = STOP: no escribir · 3 = uso incorrecto
# Compatible con bash 3.2 (macOS) y GNU/Linux. Solo lee: no modifica el repositorio.
set -u

# ── Constantes de identidad (no dependen de archivos editables) ─────────────────
PLATFORM="knowledge-layer-code"
REPO_SLUG="InnovMO-ai/beeside"
BRANCH="feat/kl-1.0-code"                     # modo heredado (rama larga de KL): base de comparación = commit de Design
TRUNK="main"; TRUNK_PREFIX="kl/"               # modo main (ADR-001): ramas cortas kl/* desde main; base = merge-base con origin/main
WORKTREE_REL="Developer/beeside-kl"            # relativo a $HOME en el Mac
TAG="kl-design-1.0-frozen"
TAG_OBJ="02198ebd426a1935cad9c8176edc65586bfb7e20"
DESIGN_COMMIT="69f211a11f9c95ea5f5288c61b4d263d354910fa"
FROZEN_DIRS="docs/knowledge-layer/kl-1.0-design-frozen docs/knowledge-layer/kl-1.0-freeze-meta"
GUARD_FILES="scripts/kl/preflight.sh scripts/kl/kl.fingerprint .github/workflows/kl-preflight.yml"
# Modo main (L1 v2): además del gate, son controles protegidos el CI de KL, el registro de aprobaciones, la lista de aprobadores y los scripts que verifican aprobación y CI.
# Cualquier cambio exige aprobación VERIFICADA del PO en GitHub (no basta lo que diga un archivo de la propia rama).
GUARD_FILES_MAIN="$GUARD_FILES .github/workflows/kl-ci.yml scripts/kl/shared-changes.txt scripts/kl/po-approvers.txt scripts/kl/verify-approval.sh scripts/kl/require-kl-ci.sh scripts/kl/verify-check-origin.sh scripts/kl/gate-run.sh"
KL_PATHS_GLOB() { case "$1" in backend/src/kl/*|frontend/src/kl/*|backend/src/admin/kl/*|frontend/src/admin/kl/*|scripts/kl/*|.github/workflows/kl-*|docs/knowledge-layer/*) return 0 ;; esac; return 1; }
# Decisión única sobre aprobación de controles protegidos (L1 v3). Falla cerrado: solo dos combinaciones evento/valor se aceptan, cualquier otra (vacía, desconocida,
# "deferred" fuera de push, "verified" fuera de pull_request_target) es STOP. El valor lo calcula el workflow confiable (gate-run.sh), nunca la rama.
approval_gate() {  # $1 = rutas protegidas modificadas
  case "${KL_GUARD_APPROVAL:-}:${GITHUB_EVENT_NAME:-}" in
    verified:pull_request_target) review "controles protegidos modificados con aprobación VERIFICADA del PO en GitHub:$1" ;;
    deferred:push) review "controles protegidos modificados:$1 (en push la aprobación del PO no se puede verificar; se exige en el pull request)" ;;
    *) stop "controles protegidos modificados sin aprobación verificada del PO (revisión APPROVED de un aprobador de scripts/kl/po-approvers.txt sobre este commit; evento '${GITHUB_EVENT_NAME:-?}', valor '${KL_GUARD_APPROVAL:-<vacío>}'):$1" ;;
  esac
}
FP="scripts/kl/kl.fingerprint"
DECL="scripts/kl/shared-changes.txt"
DATABASE="beeside_kl"                                   # CR-KL-002
ADDENDUM_DIR="docs/knowledge-layer/kl-1.0-addenda/CR-KL-002"
ADDENDUM_MANIFEST_SHA="08520b6a42721521c77b72b0920d1be1006f5a00a08c33cd21e3ac37049dbc6b"

MODE="dev"; REMOTE=0; CI=0; PRGATE=0
for a in "$@"; do
  case "$a" in
    --gate) MODE="gate" ;;
    --remote) REMOTE=1 ;;
    --ci) CI=1; MODE="gate" ;;
    --pr-gate) PRGATE=1 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "uso: preflight.sh [--gate] [--remote] [--ci] [--pr-gate]" >&2; exit 3 ;;
  esac
done
[ "$CI" = 1 ] && KL_PLATFORM="${KL_PLATFORM:-}"
# En eventos de pull request el gate de PR es OBLIGATORIO aunque falte la bandera: ese camino nunca usa el modo heredado.
[ "${GITHUB_EVENT_NAME:-}" = pull_request_target ] && { PRGATE=1; CI=1; MODE="gate"; }

N_STOP=0; N_REVIEW=0; N_WARN=0
ok()     { printf 'OK       %s\n' "$*"; }
stop()   { printf 'STOP     %s\n' "$*"; N_STOP=$((N_STOP+1)); }
review() { printf 'REVISAR  %s\n' "$*"; N_REVIEW=$((N_REVIEW+1)); }
warn()   { printf 'AVISO    %s\n' "$*"; N_WARN=$((N_WARN+1)); }
sha()    { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$@"; else shasum -a 256 "$@"; fi; }

echo "KL preflight · modo=$MODE$( [ "$CI" = 1 ] && echo ' (CI)')$( [ "$REMOTE" = 1 ] && echo ' +remote')"

SELF_DIR="$(cd "$(dirname "$0")" && pwd -P)"   # dónde vive ESTE script (en CI debe estar fuera del árbol evaluado)
TOP="$(git rev-parse --show-toplevel 2>/dev/null)" || { echo "STOP     no es un repositorio git"; echo "RESULTADO: STOP — no escribir"; exit 1; }
cd "$TOP" || exit 1

# P1 · Plataforma declarada
if [ "${KL_PLATFORM:-}" = "$PLATFORM" ]; then ok "plataforma: $PLATFORM"
else stop "plataforma declarada '${KL_PLATFORM:-<vacía>}' ≠ $PLATFORM (exporta KL_PLATFORM=$PLATFORM)"; fi

# P2 · Repositorio canónico
URL="$(git remote get-url origin 2>/dev/null || true)"
case "$URL" in
  "https://github.com/$REPO_SLUG"|"https://github.com/$REPO_SLUG.git"|https://*@github.com/$REPO_SLUG|https://*@github.com/$REPO_SLUG.git|"git@github.com:$REPO_SLUG"|"git@github.com:$REPO_SLUG.git"|"ssh://git@github.com/$REPO_SLUG"|"ssh://git@github.com/$REPO_SLUG.git")
    ok "origin: github.com/$REPO_SLUG" ;;
  *) stop "origin '$(printf '%s' "$URL" | sed 's#//[^@/]*@#//***@#')' no es github.com/$REPO_SLUG" ;;
esac
if [ "$CI" = 1 ]; then
  [ "${GITHUB_REPOSITORY:-}" = "$REPO_SLUG" ] && ok "CI repo: $GITHUB_REPOSITORY" || stop "CI repo '${GITHUB_REPOSITORY:-}' ≠ $REPO_SLUG"
fi

# P3 · Worktree dedicado (no el árbol principal de Discovery)
if [ "$CI" = 0 ]; then
  EXP="$HOME/$WORKTREE_REL"
  TOPR="$(cd "$TOP" && pwd -P)"
  if [ -d "$EXP" ] && [ "$(cd "$EXP" && pwd -P)" = "$TOPR" ]; then ok "worktree: ~/$WORKTREE_REL"
  else stop "ruta '$TOPR' ≠ ~/$WORKTREE_REL"; fi
  GD="$(cd "$(git rev-parse --git-dir)" && pwd -P)"
  CD="$(cd "$(git rev-parse --git-common-dir)" && pwd -P)"
  if [ "$GD" != "$CD" ]; then ok "worktree vinculado (repo común: $CD)"
  else stop "este es el worktree principal del repositorio, no el worktree KL"; fi
fi

# P4 · Rama
if [ "$CI" = 1 ]; then BR="${GITHUB_HEAD_REF:-${GITHUB_REF_NAME:-}}"
else BR="$(git symbolic-ref -q --short HEAD || echo '<detached>')"; fi
BASE="$DESIGN_COMMIT"; BMODE="heredado"
case "$BR" in
  "$BRANCH")
    if [ "$PRGATE" = 1 ]; then
      stop "el gate de pull request NO admite el modo heredado: '$BRANCH' no se fusiona por PR; los cambios de KL entran desde ramas ${TRUNK_PREFIX}* creadas desde $TRUNK"
      echo "──"; echo "RESULTADO: STOP — $N_STOP incumplimiento(s). No escribir; informar al PO."; exit 1
    fi
    ok "rama: $BRANCH (modo heredado)" ;;
  "$TRUNK_PREFIX"*)
    BMODE="main"
    if git rev-parse -q --verify "refs/remotes/origin/$TRUNK" >/dev/null; then
      BASE="$(git merge-base HEAD "refs/remotes/origin/$TRUNK" 2>/dev/null || true)"
      [ -n "$BASE" ] && ok "rama: $BR (modo main; base $(printf '%s' "$BASE" | cut -c1-12) = merge-base con origin/$TRUNK)" || stop "rama $BR sin ancestro común con origin/$TRUNK"
    else stop "modo main: falta origin/$TRUNK (git fetch origin $TRUNK)"; fi ;;
  *)
    if [ "$PRGATE" = 1 ]; then
      # PR de otra plataforma: no se evalúa el resto del gate de KL, pero NO puede tocar rutas de KL (el nombre de la rama no debe servir para esquivar el control).
      if git rev-parse -q --verify "refs/remotes/origin/$TRUNK" >/dev/null; then
        NB="$(git merge-base HEAD "refs/remotes/origin/$TRUNK" 2>/dev/null || true)"
        if [ -z "$NB" ]; then stop "PR ajeno a KL sin ancestro común con origin/$TRUNK"
        else
          KLTOUCH="$(git diff --name-only --no-renames "$NB" HEAD | while IFS= read -r f; do KL_PATHS_GLOB "$f" && echo "$f"; done)"
          if [ -n "$KLTOUCH" ]; then stop "rama '$BR' (no es ${TRUNK_PREFIX}* ni $BRANCH) modifica rutas de KL; los cambios de KL solo entran desde ramas ${TRUNK_PREFIX}*:"; printf '           %s\n' $KLTOUCH | head -10
          else
            ok "PR ajeno a KL ('$BR'): no toca rutas de KL"
            GHTOUCH="$(git diff --name-only --no-renames "$NB" HEAD | grep -E '^\.github/' | tr '\n' ' ' || true)"
            [ -n "$GHTOUCH" ] && approval_gate " $GHTOUCH"
          fi
        fi
      else stop "falta origin/$TRUNK"; fi
      echo "──"
      if [ "$N_STOP" -gt 0 ]; then echo "RESULTADO: STOP — $N_STOP incumplimiento(s). No escribir; informar al PO."; exit 1; fi
      echo "RESULTADO: OK (PR ajeno a KL)$( [ "$N_REVIEW" -gt 0 ] && echo " · $N_REVIEW elemento(s) a REVISAR por el PO")"; exit 0
    fi
    stop "rama '$BR' no es $BRANCH ni ${TRUNK_PREFIX}*" ;;
esac
# El preflight de una rama kl/* debe ejecutarse desde una referencia protegida, no desde el árbol que se evalúa (si no, la rama puede reescribir su propio control).
if [ "$CI" = 1 ] && [ "$BMODE" = main ]; then
  case "$SELF_DIR/" in "$(pwd -P)"/*) stop "preflight ejecutado desde el árbol evaluado ($SELF_DIR): en modo main debe venir de una referencia protegida (checkout separado de main)" ;; *) ok "preflight ejecutado desde referencia protegida ($(printf '%s' "$SELF_DIR" | sed 's#.*/##')): sha256 $(sha "$0" | cut -c1-12)" ;; esac
fi

# P5 · Referencia de Design y ancestría
OBJ="$(git rev-parse -q --verify "refs/tags/$TAG" 2>/dev/null || true)"
PEEL="$(git rev-parse -q --verify "refs/tags/$TAG^{commit}" 2>/dev/null || true)"
[ "$OBJ" = "$TAG_OBJ" ] && ok "etiqueta $TAG → objeto ${TAG_OBJ:0:12}" || stop "etiqueta $TAG local = '${OBJ:-ausente}' ≠ ${TAG_OBJ:0:12}"
[ "$PEEL" = "$DESIGN_COMMIT" ] && ok "etiqueta apunta a ${DESIGN_COMMIT:0:12}" || stop "etiqueta apunta a '${PEEL:-ausente}' ≠ ${DESIGN_COMMIT:0:12}"
if git cat-file -e "$DESIGN_COMMIT^{commit}" 2>/dev/null && git merge-base --is-ancestor "$DESIGN_COMMIT" HEAD 2>/dev/null; then
  ok "HEAD $(git rev-parse --short=12 HEAD) desciende de ${DESIGN_COMMIT:0:12}"
else stop "HEAD no desciende del commit de Design ${DESIGN_COMMIT:0:12}"; fi
if [ "$REMOTE" = 1 ]; then
  R="$(GIT_TERMINAL_PROMPT=0 git -c http.lowSpeedLimit=1 -c http.lowSpeedTime=15 ls-remote origin "refs/tags/$TAG" "refs/tags/$TAG^{}" 2>/dev/null || true)"
  if [ -z "$R" ]; then warn "no se pudo consultar origin (sin red); referencia remota no contrastada"
  else
    RO="$(printf '%s\n' "$R" | awk -v t="refs/tags/$TAG" '$2==t{print $1}')"
    RP="$(printf '%s\n' "$R" | awk -v t="refs/tags/$TAG^{}" '$2==t{print $1}')"
    [ "$RO" = "$TAG_OBJ" ] && [ "$RP" = "$DESIGN_COMMIT" ] && ok "origin: $TAG idéntica" || stop "origin: $TAG = '$RO' → '$RP' (esperado ${TAG_OBJ:0:12} → ${DESIGN_COMMIT:0:12})"
  fi
fi

# Identidad incorrecta → no tiene sentido evaluar límites: STOP inmediato
if [ "$N_STOP" -gt 0 ]; then
  echo "──"; echo "RESULTADO: STOP — identidad o referencia incorrecta ($N_STOP). No escribir; informar al PO."; exit 1
fi

# P6 · Operaciones de git en curso y merges
GDIR="$(git rev-parse --git-dir)"
for f in MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD rebase-merge rebase-apply BISECT_LOG; do
  [ -e "$GDIR/$f" ] && stop "operación git en curso: $f"
done
M="$(git rev-list --merges "$BASE..HEAD" 2>/dev/null | head -1)"
[ -z "$M" ] && ok "sin merges en la rama (desde $( [ "$BMODE" = main ] && echo "la base en main" || echo Design))" || stop "commit de merge no autorizado en la rama: ${M:0:12}"

# P7 · Design congelado intacto
FD_CHANGED="$( { git diff --name-only "$DESIGN_COMMIT" -- $FROZEN_DIRS; git diff --cached --name-only "$DESIGN_COMMIT" -- $FROZEN_DIRS; git ls-files --others --exclude-standard -- $FROZEN_DIRS; } 2>/dev/null | sort -u)"
if [ -z "$FD_CHANGED" ]; then ok "documentación congelada sin cambios respecto de ${DESIGN_COMMIT:0:12}"
else stop "documentación congelada alterada:"; printf '           %s\n' $FD_CHANGED; fi
VS="docs/knowledge-layer/kl-1.0-freeze-meta/verify.sh"
if [ -n "$FD_CHANGED" ]; then :   # verify.sh pertenece a la documentación congelada: si cambió, NO se ejecuta (es código de la rama)
elif [ -f "$VS" ] && bash "$VS" >/dev/null 2>&1; then ok "verify.sh: manifiesto 8901ecfa… y 88 archivos versionados idénticos"
else stop "verify.sh falló (ejecuta: bash $VS)"; fi

# P7b · Addendum aprobado CR-KL-002 (inmutable; cambios = nuevo CR aprobado por el PO)
if [ -d "$ADDENDUM_DIR" ]; then
  got="$(sha "$ADDENDUM_DIR/MANIFEST.sha256" 2>/dev/null | cut -d' ' -f1)"
  extra="$(cd "$ADDENDUM_DIR" && find . -type f ! -name MANIFEST.sha256 | sed 's#^\./##' | LC_ALL=C sort | comm -23 - <(awk '{print $2}' MANIFEST.sha256 | LC_ALL=C sort))"
  if [ "$got" = "$ADDENDUM_MANIFEST_SHA" ] && ( cd "$ADDENDUM_DIR" && if command -v sha256sum >/dev/null 2>&1; then sha256sum -c --quiet MANIFEST.sha256; else shasum -a 256 -c --quiet MANIFEST.sha256; fi ) >/dev/null 2>&1 && [ -z "$extra" ]; then
    ok "CR-KL-002 íntegro (manifiesto ${ADDENDUM_MANIFEST_SHA:0:12})"
  else stop "CR-KL-002 alterado o con archivos ajenos ($ADDENDUM_DIR)"; fi
else stop "falta el addendum aprobado $ADDENDUM_DIR"; fi

# P8 · Fingerprint KL
if [ -f "$FP" ]; then
  fpv() { awk -F= -v k="$1" '$1==k{sub(/^[^=]*=/,""); print; exit}' "$FP"; }
  bad=""
  for kv in "code_platform=$PLATFORM" "repo=$REPO_SLUG" "branch=$BRANCH" "worktree=~/$WORKTREE_REL" "design_tag=$TAG" "design_tag_object=$TAG_OBJ" "design_commit=$DESIGN_COMMIT" "database=$DATABASE" "addendum_cr_kl_002_manifest_sha256=$ADDENDUM_MANIFEST_SHA"; do
    k="${kv%%=*}"; v="${kv#*=}"; [ "$(fpv "$k")" = "$v" ] || bad="$bad $k"
  done
  [ -z "$bad" ] && ok "fingerprint $(sha "$FP" | cut -c1-12) coherente con el preflight" || stop "fingerprint no coincide en:$bad"
  MP="$(fpv module_path)"; MS="$(fpv module_status)"
  case "$MS" in
    planned) [ -d "$MP" ] && review "$MP ya existe pero module_status=planned: actualiza el fingerprint a active" || ok "módulo $MP: planned (aún sin implementación)" ;;
    active)  [ -d "$MP" ] && ok "módulo $MP: active" || stop "module_status=active pero falta $MP" ;;
    *) stop "module_status inválido: '$MS'" ;;
  esac
else stop "falta $FP"; fi

# P9 · Límites entre plataformas (commits desde Design + índice + árbol + no rastreados)
classify() {
  case "$1" in
    docs/knowledge-layer/kl-1.0-design-frozen/*|docs/knowledge-layer/kl-1.0-freeze-meta/*) echo FROZEN ;;
    docs/knowledge-layer/kl-1.0-addenda/CR-KL-002/*) echo ADDENDUM ;;
    backend/db/migrations/*) echo MIGRATION ;;
    backend/src/precision/*|backend/src/precision-context/*|frontend/src/precision/*|frontend/e2e/precision*|frontend/playwright.precision*|docs/f5/*|scripts/*precision*|backend/scripts/precision*|backend/scripts/clickup-*|backend/scripts/stripe-*) echo PRECISION ;;
    backend/src/fa4/*|frontend/src/fa4/*|backend/src/fa/*|frontend/src/fa/*|shared/fa-public-engine/*|deploy/*|frontend/e2e-production/*|docs/deployment/*) echo DISCOVERY ;;
    backend/src/kl/*|frontend/src/kl/*|backend/src/admin/kl/*|frontend/src/admin/kl/*|scripts/kl/*|.github/workflows/kl-*|docs/knowledge-layer/*) echo KL ;;
    *) echo SHARED ;;
  esac
}
declared() {  # $1 = ruta → imprime la referencia de aprobación si está declarada
  [ -f "$DECL" ] || return 1
  awk -F'|' -v p="$1" '
    /^[[:space:]]*#/ || NF<3 {next}
    { r=$1; gsub(/^[ \t]+|[ \t]+$/,"",r); j=$2; gsub(/^[ \t]+|[ \t]+$/,"",j); a=$3; gsub(/^[ \t]+|[ \t]+$/,"",a)
      if (j=="") next
      h=""; if (NF>=4) { h=$4; gsub(/^[ \t]+|[ \t]+$/,"",h); sub(/^sha256=/,"",h) }
      if (p==r || (substr(r,length(r))=="/" && index(p,r)==1)) { print (a==""?"pendiente":a) "\t" h; found=1; exit } }
    END { exit found?0:1 }' "$DECL"
}
BOOT="$(git log --diff-filter=A --format=%H "$DESIGN_COMMIT..HEAD" -- scripts/kl/preflight.sh 2>/dev/null | tail -1)"
TMP="$(mktemp)"; trap 'rm -f "$TMP"' EXIT
{ git diff --name-only --no-renames "$BASE" HEAD
  git diff --name-only --no-renames HEAD
  git diff --cached --name-only --no-renames HEAD
  git ls-files --others --exclude-standard; } 2>/dev/null | sort -u > "$TMP"
GUARD_CHANGED=""; GUARD_LIST=""
GF="$GUARD_FILES"; [ "$BMODE" = main ] && GF="$GUARD_FILES_MAIN"
# Modo main: una guarda que difiere de la base en main es guarda, aunque coincida con la versión del bootstrap (no puede revertirse sin declararla).
GREF="$BOOT"; [ "$BMODE" = main ] && GREF="$BASE"
if [ -n "$GREF" ]; then
  GUARD_CHANGED="$( { git diff --name-only "$GREF" HEAD -- $GF; git diff --name-only HEAD -- $GF; git diff --cached --name-only HEAD -- $GF; } 2>/dev/null | sort -u)"
else
  warn "bootstrap del preflight aún sin commit (estado inicial esperado solo durante la instalación)"
fi
n_kl=0; n_sh=0; n_blk=0; n_shown=0
cap() { n_shown=$((n_shown+1)); [ "$n_shown" -le 25 ] || { N_STOP=$((N_STOP+1)); [ "$n_shown" -eq 26 ] && echo "STOP     … (más rutas bloqueadas omitidas)"; return 1; }; }
while IFS= read -r f; do
  [ -z "$f" ] && continue
  c="$(classify "$f")"
  if [ "$c" = KL ] && printf '%s\n' "$GUARD_CHANGED" | grep -qxF "$f"; then c=GUARD; fi
  # Modo main: TODO lo que cuelga de .github/ (workflows de CI, publicación y despliegue, CODEOWNERS) es control protegido; no basta declararlo.
  if [ "$BMODE" = main ] && [ "$c" != GUARD ]; then case "$f" in .github/*) c=PROTECTED ;; esac; fi
  case "$c" in
    KL) n_kl=$((n_kl+1)) ;;
    FROZEN) n_blk=$((n_blk+1)) ;;   # ya reportado en P7
    ADDENDUM) n_kl=$((n_kl+1)) ;;   # integridad verificada en P7b
    MIGRATION) n_blk=$((n_blk+1)); cap && stop "migración compartida (prohibido; KL migra solo a beeside_kl desde backend/src/kl/db/migrations, CR-KL-002 B10): $f" ;;
    PRECISION) n_blk=$((n_blk+1)); cap && stop "ruta de Precision (no autorizada desde KL): $f" ;;
    DISCOVERY) n_blk=$((n_blk+1)); cap && stop "ruta de Discovery (no autorizada desde KL): $f" ;;
    PROTECTED) n_sh=$((n_sh+1)); GUARD_LIST="$GUARD_LIST $f" ;;
    SHARED|GUARD)
      n_sh=$((n_sh+1)); lbl="componente compartido"; [ "$c" = GUARD ] && lbl="archivo de guarda del preflight"
      if [ "$c" = GUARD ] && [ "$BMODE" = main ]; then GUARD_LIST="$GUARD_LIST $f"; fi
      # El registro de declaraciones no puede declararse a sí mismo: en modo main su cambio exige aprobación verificada (más abajo); en modo heredado es un archivo de KL.
      if [ "$f" = "$DECL" ]; then review "registro de declaraciones modificado: $f"; continue; fi
      dec=""; if d="$(declared "$f")"; then dec="$d"; fi
      ap="${dec%%	*}"; dh="${dec#*	}"
      # Una guarda solo cuenta como declarada si la declaración fija la huella exacta de su contenido actual
      if [ -n "$dec" ] && [ "$c" = GUARD ] && { [ ! -f "$f" ] || [ "$dh" != "$(sha "$f" | cut -d' ' -f1)" ]; }; then dec=""; fi
      if [ -n "$dec" ] && [ "$CI" = 1 ] && printf '%s' "$ap" | grep -qi 'pendiente'; then stop "$lbl con aprobación PENDIENTE (bloquea en CI hasta que el PO registre la aprobación): $f"
      elif [ -n "$dec" ]; then review "$lbl declarado en $DECL (aprobación: $ap): $f"
      elif [ "$MODE" = gate ]; then stop "$lbl sin declarar en $DECL: $f"
      else review "$lbl sin declarar (declararlo antes de commit): $f"; fi ;;
  esac
done < "$TMP"
if [ "$CI" = 1 ] && [ "$BMODE" = main ] && [ -n "$GUARD_LIST" ]; then approval_gate "$GUARD_LIST"; fi
ok "cambios desde la base ($BMODE): $n_kl KL · $n_sh compartidos/guarda · $n_blk bloqueados"
if [ "$CI" = 0 ]; then
  W="$(git status --porcelain=v1 2>/dev/null | wc -l | tr -d ' ')"
  [ "$W" = 0 ] && ok "árbol limpio" || ok "árbol con $W cambios locales (permitido en desarrollo; clasificados arriba)"
fi

echo "──"
if [ "$N_STOP" -gt 0 ]; then echo "RESULTADO: STOP — $N_STOP incumplimiento(s). No escribir; informar al PO."; exit 1; fi
echo "RESULTADO: OK$( [ "$N_REVIEW" -gt 0 ] && echo " · $N_REVIEW elemento(s) a REVISAR por el PO")$( [ "$N_WARN" -gt 0 ] && echo " · $N_WARN aviso(s)")"
exit 0
