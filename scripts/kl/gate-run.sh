#!/usr/bin/env bash
# Lanzador del gate (L1 v3). Decide por EVENTO, no por lo que traiga la rama, y falla cerrado ante cualquier valor inesperado.
# Uso (cwd = árbol evaluado):  gate-run.sh <directorio scripts/kl de la referencia protegida>
# Entorno: GITHUB_EVENT_NAME (lo fija GitHub) y KL_APPROVAL_RESULT (lo calcula verify-approval.sh en el paso anterior).
set -u
DIR="${1:-}"; [ -f "$DIR/preflight.sh" ] || { echo "STOP     gate-run: falta el preflight confiable en '$DIR'"; exit 1; }
case "${GITHUB_EVENT_NAME:-}" in
  pull_request_target)
    # Solo el literal "verified" cuenta; vacío, ausente o cualquier otra cosa equivale a "missing".
    case "${KL_APPROVAL_RESULT:-}" in verified) A=verified ;; *) A=missing ;; esac
    KL_GUARD_APPROVAL="$A" bash "$DIR/preflight.sh" --ci --pr-gate; exit $? ;;
  push)
    KL_GUARD_APPROVAL=deferred bash "$DIR/preflight.sh" --ci; exit $? ;;
  *) echo "STOP     gate-run: evento '${GITHUB_EVENT_NAME:-<vacío>}' no soportado (solo push y pull_request_target)"; exit 1 ;;
esac
