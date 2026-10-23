#!/usr/bin/env bash
# Comprueba, antes de iniciar Code, que la base aceptada provisionalmente sigue siendo compatible.
# Uso: bash check-base.sh [--fetch]     (salida 0 = compatible sin cambios; 2 = hubo cambios que revisar; 1 = error)
set -euo pipefail
BASE="bc3f52760a5c427c0b057a1e2bb0d71d8d0034d3"   # origin/main al 16-oct-2026
TAG="kl-design-1.0-frozen"
WATCH="backend/src/admin frontend/src/admin backend/src/reports/report-model.ts backend/src/worker.ts backend/src/security/rate-limit.ts frontend/src/styles.css backend/db/migrations backend/src/scripts/migrate.ts backend/package.json frontend/package.json"
[ "${1:-}" = "--fetch" ] && git fetch origin --tags --quiet
git cat-file -e "$BASE^{commit}" || { echo "ERROR: falta la base $BASE"; exit 1; }
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
  git merge-base --is-ancestor "$BASE" "$TAG" && echo "OK  $TAG desciende de la base" || { echo "ERROR: $TAG no desciende de $BASE"; exit 1; }
  if git diff --quiet "$BASE" "$TAG" -- . ':(exclude)docs/knowledge-layer'; then echo "OK  $TAG solo agrega docs/knowledge-layer/"; else echo "ERROR: $TAG cambia código"; exit 1; fi
else echo "AVISO: no existe la etiqueta $TAG en este clon"; fi
MAIN="$(git rev-parse origin/main)"
echo "origin/main = $MAIN"
if [ "$MAIN" = "$BASE" ]; then echo "OK  origin/main sigue en la base aceptada"; status=0; else
  echo "CAMBIOS desde la base:"; git log --oneline "$BASE..origin/main" | head -50
  echo "--- rutas que KL reutiliza o que afectan migraciones:"; git diff --stat "$BASE" origin/main -- $WATCH
  echo "--- migraciones nuevas en main:"; git diff --name-only --diff-filter=A "$BASE" origin/main -- backend/db/migrations | grep -v '/meta/' || true
  status=2; fi
for b in origin/feat/fa4-launch-config origin/feature/precision-v2-f5; do
  git rev-parse -q --verify "$b" >/dev/null || continue
  last=$(git ls-tree --name-only "$b" backend/db/migrations/ | grep -E '/[0-9]{4}_' | tail -1)
  echo "info  $b → $(git rev-parse --short "$b") · última migración: ${last##*/}"
done
exit $status
