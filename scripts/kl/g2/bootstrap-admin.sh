#!/usr/bin/env bash
# Arranque del primer KL_ADMIN (CR-KL-002 §5, B4) ejecutado por un operador de Plataforma desde su equipo, UNA sola vez.
#   bash scripts/kl/g2/bootstrap-admin.sh --check <correo>     solo lectura: ¿es elegible y no hay ya un KL_ADMIN?
#   KL_BOOTSTRAP_CONFIRM=<correo> bash scripts/kl/g2/bootstrap-admin.sh --apply <correo>
# Abre dos Cloud SQL Auth Proxy (beeside-dev-kl-db y beeside-dev-canonical-db), arma las cadenas de conexión EN MEMORIA a partir de Secret Manager
# (nunca se imprimen ni se escriben a disco) y ejecuta backend/src/kl/identity/bootstrap-admin.ts, que: verifica al titular en `admin_user`, se niega
# si ya existe un KL_ADMIN, llama a kl.bootstrap_admin con kl_owner y registra admin_audit_event (SYSTEM) en la base principal.
# Requiere: gcloud autenticado, cloud-sql-proxy, psql, node/npx con las dependencias del repo (npm ci).
set -euo pipefail
MODE="${1:-}"; EMAIL="${2:-}"
[[ "$MODE" == "--check" || "$MODE" == "--apply" ]] && [[ -n "$EMAIL" ]] || { echo "uso: $0 --check|--apply <correo>" >&2; exit 2; }
if [[ "$MODE" == "--apply" && "${KL_BOOTSTRAP_CONFIRM:-}" != "$EMAIL" ]]; then echo "STOP: --apply exige KL_BOOTSTRAP_CONFIRM=<el mismo correo>" >&2; exit 2; fi
P="${KL_PROJECT:-beeside-dev-508220}"; REGION="${KL_REGION:-northamerica-south1}"
KL_PORT=5461; PLATFORM_PORT=5462
PSQL="${PSQL:-psql}"
cd "$(git rev-parse --show-toplevel)"
pids=()
cleanup() { for p in "${pids[@]:-}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT

secret_url() { # <secreto> <puerto> → URL TCP local, sin imprimir nada si el formato no es el esperado
  gcloud secrets versions access latest --secret "$1" --project "$P" | python3 -c '
import re,sys
port=sys.argv[1]; t=sys.stdin.read().strip()
m=re.match(r"^(postgres(?:ql)?://[^@]+)@/([A-Za-z0-9_]+)\?host=/cloudsql/[^&]+$", t)
if not m: sys.stderr.write("formato de cadena de conexión inesperado (no se imprime)\n"); sys.exit(3)
print(f"{m.group(1)}@127.0.0.1:{port}/{m.group(2)}?sslmode=disable")' "$2"
}
cloud-sql-proxy --gcloud-auth --port "$KL_PORT" "$P:$REGION:beeside-dev-kl-db" >/dev/null 2>&1 & pids+=($!)
cloud-sql-proxy --gcloud-auth --port "$PLATFORM_PORT" "$P:$REGION:beeside-dev-canonical-db" >/dev/null 2>&1 & pids+=($!)
sleep 6
export KL_DB_URL_OWNER; KL_DB_URL_OWNER="$(secret_url beeside-dev-kl-owner-url "$KL_PORT")"
export DATABASE_URL;    DATABASE_URL="$(secret_url beeside-dev-database-url "$PLATFORM_PORT")"
export PRECISION_KNOWLEDGE_PROVIDER=off

LOWER="$(printf '%s' "$EMAIL" | tr '[:upper:]' '[:lower:]')"
echo "== elegibilidad (solo lectura)"
"$PSQL" "$DATABASE_URL" -X -tA -F ' | ' -c "SELECT 'admin_user existe='||count(*)||' activo='||coalesce(bool_or(active),false)||' login_habilitado='||coalesce(bool_or(login_enabled),false) FROM admin_user WHERE auth_identity = '$(printf '%s' "$LOWER" | sed "s/'/''/g")'"
"$PSQL" "$KL_DB_URL_OWNER" -X -tA -c "SELECT 'KL_ADMIN no revocados='||count(*) FROM kl.role_grant WHERE role='KL_ADMIN' AND revoked_at IS NULL"
[[ "$MODE" == "--check" ]] && { echo "(--check: no se escribió nada)"; exit 0; }

echo "== arranque"
npm run kl:bootstrap-admin --workspace=backend --silent -- --email "$LOWER"
echo "== verificación"
"$PSQL" "$KL_DB_URL_OWNER" -X -tA -c "SELECT 'KL_ADMIN no revocados='||count(*) FROM kl.role_grant WHERE role='KL_ADMIN' AND revoked_at IS NULL"
"$PSQL" "$DATABASE_URL" -X -tA -c "SELECT 'admin_audit_event kl.bootstrap_admin='||count(*) FROM admin_audit_event WHERE action='kl.bootstrap_admin'"
