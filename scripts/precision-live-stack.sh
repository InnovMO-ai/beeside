#!/usr/bin/env bash
# Precision Center V2.0 - local live stack for rehearsal and QA (internal use only).
#
#   scripts/precision-live-stack.sh up [--stage=start|map_confirmed|logistics_ready] [--reset] [--no-build]
#   scripts/precision-live-stack.sh seed [--stage=...] [--reset]      # mint a new one-time access path (shown once)
#   scripts/precision-live-stack.sh status | logs | down
#
# What it starts (all local, nothing external):
#   Postgres database  $QA_DB            (created and migrated with the repo's own migrate job)
#   backend            :$BACKEND_PORT    dist/index.js with PRECISION_API_ENABLED=true and the isolated providers
#                                        (scripted model, simulated Operation Hub, fixture entitlement, fixture First Assessment context)
#   frontend           :$FRONTEND_PORT   production static server (frontend/server/static-server.mjs: CSP, security headers)
#                                        serving a build made with VITE_PRECISION_API_MODE=live; /api is proxied to the backend.
# The browser origin is the frontend origin, so the backend Origin guard is satisfied by ALLOWED_ORIGINS (it is never disabled).
#
# Overrides (environment): QA_DB, DB_ADMIN_URL, BACKEND_PORT, FRONTEND_PORT, RUN_DIR, PRECISION_INTERNAL_KEY.
# Secrets (internal key, one-time access path) live only under $RUN_DIR with mode 600 and are never echoed except the access path, once.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="${RUN_DIR:-/tmp/precision-live}"
QA_DB="${QA_DB:-beeside_qa}"
PG_USER="${PG_USER:-beeside}"
PG_PASSWORD="${PG_PASSWORD:-beeside}"
PG_HOST="${PG_HOST:-localhost}"
PG_PORT="${PG_PORT:-5432}"
BACKEND_PORT="${BACKEND_PORT:-18080}"
FRONTEND_PORT="${FRONTEND_PORT:-14180}"
DATABASE_URL="postgres://${PG_USER}:${PG_PASSWORD}@${PG_HOST}:${PG_PORT}/${QA_DB}"
ADMIN_URL="${DB_ADMIN_URL:-postgres://${PG_USER}:${PG_PASSWORD}@${PG_HOST}:${PG_PORT}/postgres}"
FRONTEND_DIST="$ROOT/frontend/node_modules/.precision-live"

export NO_PROXY= no_proxy= npm_config_noproxy=
mkdir -p "$RUN_DIR"
chmod 700 "$RUN_DIR"

cmd="${1:-up}"; shift || true
STAGE="start"; RESET=""; BUILD=1
for a in "$@"; do
  case "$a" in
    --stage=*) STAGE="${a#--stage=}" ;;
    --reset) RESET="--reset" ;;
    --no-build) BUILD=0 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done

say() { printf '[live-stack] %s\n' "$*"; }

ensure_db() {
  if ! psql "$DATABASE_URL" -Atqc 'select 1' >/dev/null 2>&1; then
    say "creating database $QA_DB"
    psql "$ADMIN_URL" -qc "CREATE DATABASE \"$QA_DB\""
  fi
  (cd "$ROOT/backend" && DATABASE_URL="$DATABASE_URL" npx tsx src/scripts/migrate.ts >/dev/null)
  say "database $QA_DB migrated"
}

internal_key() {
  local f="$RUN_DIR/internal-key"
  if [ -n "${PRECISION_INTERNAL_KEY:-}" ]; then printf '%s' "$PRECISION_INTERNAL_KEY" >"$f"; fi
  if [ ! -s "$f" ]; then head -c 24 /dev/urandom | base64 | tr -d '+/=' >"$f"; fi
  chmod 600 "$f"
  cat "$f"
}

seed() {
  local out
  out="$(cd "$ROOT/backend" && DATABASE_URL="$DATABASE_URL" CONFIG_BOOTSTRAP_ENV=development npm run -s precision:seed-demo -- --stage="$STAGE" $RESET)"
  # The one-time code is printed once on the terminal and kept (mode 600) so a test run can reuse it.
  local path
  path="$(printf '%s\n' "$out" | sed -n 's/^one-time access path (shown once): //p')"
  printf '%s\n' "$out" | grep -v 'one-time access path' | sed -n '1,12p'
  if [ -n "$path" ]; then
    umask 077; printf '%s' "$path" >"$RUN_DIR/access-path"
    say "one-time access path (shown once): http://localhost:${FRONTEND_PORT}${path}"
  fi
}

stop_pid() {
  local f="$RUN_DIR/$1.pid"
  if [ -f "$f" ]; then
    local pid; pid="$(cat "$f")"
    if kill -0 "$pid" 2>/dev/null; then kill "$pid" 2>/dev/null || true; for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$pid" 2>/dev/null || break; sleep 0.3; done; kill -9 "$pid" 2>/dev/null || true; fi
    rm -f "$f"
  fi
}

wait_http() { # url, label
  for _ in $(seq 1 60); do curl -fsS -o /dev/null "$1" 2>/dev/null && return 0; sleep 0.5; done
  say "$2 did not become ready; see $RUN_DIR/$3.log" >&2; return 1
}

up() {
  ensure_db
  if [ "$BUILD" = 1 ]; then
    say "building backend"; (cd "$ROOT/backend" && npm run -s build >/dev/null)
    say "building frontend (VITE_PRECISION_API_MODE=live)"
    (cd "$ROOT/frontend" && VITE_PRECISION_API_MODE=live npx vite build --outDir "$FRONTEND_DIST" --emptyOutDir >/dev/null)
  fi
  stop_pid backend; stop_pid frontend
  seed
  local key; key="$(internal_key)"
  say "starting backend on :$BACKEND_PORT"
  cd "$ROOT/backend"
  env NODE_ENV=development PORT="$BACKEND_PORT" DATABASE_URL="$DATABASE_URL" DB_PRIVILEGE_CHECK=off \
    PRECISION_API_ENABLED=true PRECISION_FIXTURE_PROJECT=true PRECISION_INTERNAL_KEY="$key" \
    PRECISION_MODEL_PROVIDER=scripted PRECISION_OH_PROVIDER=simulator PRECISION_ENTITLEMENT_PROVIDER=fixture PRECISION_FA_CONTEXT_PROVIDER=fixture \
    ALLOWED_ORIGINS="http://localhost:${FRONTEND_PORT},http://127.0.0.1:${FRONTEND_PORT}" \
    setsid nohup node dist/index.js </dev/null >"$RUN_DIR/backend.log" 2>&1 &
  echo $! >"$RUN_DIR/backend.pid"
  say "starting frontend on :$FRONTEND_PORT"
  cd "$ROOT/frontend"
  env PORT="$FRONTEND_PORT" STATIC_ROOT="$FRONTEND_DIST" API_UPSTREAM_URL="http://127.0.0.1:${BACKEND_PORT}" \
    setsid nohup node server/static-server.mjs </dev/null >"$RUN_DIR/frontend.log" 2>&1 &
  echo $! >"$RUN_DIR/frontend.pid"
  wait_http "http://127.0.0.1:${BACKEND_PORT}/health" backend backend
  wait_http "http://127.0.0.1:${FRONTEND_PORT}/health" frontend frontend
  say "ready: http://localhost:${FRONTEND_PORT}/precision  (logs: $RUN_DIR/backend.log, $RUN_DIR/frontend.log)"
}

case "$cmd" in
  up) up ;;
  ensure-db) ensure_db ;;
  seed) ensure_db; seed; say "restart is not needed: demo fixtures resolve from the database" ;;
  down) stop_pid backend; stop_pid frontend; say "stopped" ;;
  status)
    for n in backend frontend; do
      if [ -f "$RUN_DIR/$n.pid" ] && kill -0 "$(cat "$RUN_DIR/$n.pid")" 2>/dev/null; then say "$n running (pid $(cat "$RUN_DIR/$n.pid"))"; else say "$n stopped"; fi
    done ;;
  logs) tail -n 80 "$RUN_DIR/backend.log" "$RUN_DIR/frontend.log" ;;
  *) echo "usage: $0 up|seed|ensure-db|down|status|logs [--stage=...] [--reset] [--no-build]" >&2; exit 2 ;;
esac
