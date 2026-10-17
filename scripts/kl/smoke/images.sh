#!/usr/bin/env bash
# Validación REAL de las imágenes de KL (G2): construye los dos destinos de backend/Dockerfile y ejecuta pruebas de humo sobre cada uno.
# Requiere Docker. No usa credenciales de GCP, no sube imágenes, no toca bases de datos ni redes compartidas; el render corre con --network none.
# Uso (desde cualquier carpeta del repo):  bash scripts/kl/smoke/images.sh      Salida: scripts/kl/smoke/out/image-smoke-report.json
# Un fallo en cualquier comprobación termina con código ≠ 0. NO ejecutado todavía (este Mac no tiene Docker): ver G1_G2_PLAN.md §11.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
command -v docker >/dev/null || { echo "STOP  Docker no está disponible: la validación de imagen sigue PENDIENTE G2"; exit 2; }

TAG="${KL_IMAGE_TAG:-kl-smoke}"
OUT="scripts/kl/smoke/out"; mkdir -p "$OUT"
REPORT="$OUT/image-smoke-report.json"
SMOKE_DIR="$PWD/scripts/kl/smoke"
PORT="${KL_SMOKE_PORT:-18080}"
cid=""
cleanup() { [ -n "$cid" ] && docker rm -f "$cid" >/dev/null 2>&1 || true; }
trap cleanup EXIT
pass() { printf 'OK    %s\n' "$*"; CHECKS+=("$*"); }
die()  { printf 'FALLA %s\n' "$*" >&2; exit 1; }
CHECKS=()

echo "== build"
docker build -f backend/Dockerfile --target runtime            -t "$TAG-api"     . 
docker build -f backend/Dockerfile --target runtime-kl-worker  -t "$TAG-worker"  .
docker build -f backend/Dockerfile                             -t "$TAG-default" .
[ "$(docker image inspect -f '{{.Id}}' "$TAG-default")" = "$(docker image inspect -f '{{.Id}}' "$TAG-api")" ] \
  && pass "el destino predeterminado (sin --target) es runtime (la API)" || die "el destino predeterminado NO es runtime"

meta() { docker image inspect -f "$2" "$1"; }
echo "== metadatos"
[ "$(meta $TAG-api '{{.Config.User}}')" = "node" ]    && pass "api: usuario node"    || die "api: no corre como node"
[ "$(meta $TAG-worker '{{.Config.User}}')" = "node" ] && pass "worker: usuario node" || die "worker: no corre como node"
meta $TAG-api    '{{json .Config.Cmd}}' | grep -q 'dist/index.js'                  && pass "api: CMD dist/index.js"            || die "api: CMD inesperado"
meta $TAG-worker '{{json .Config.Cmd}}' | grep -q 'dist/kl/worker/kl-worker.js'     && pass "worker: CMD kl-worker.js"          || die "worker: CMD inesperado"
meta $TAG-api    '{{json .Config.ExposedPorts}}' | grep -q '8080/tcp'              && pass "api: expone 8080"                  || die "api: sin puerto 8080"

echo "== disposición de archivos (rutas que espera el código compilado)"
LAYOUT='set -e
test -f dist/kl/db/migrations/KL-0001_base.sql
test -f dist/kl/db/migrations/KL-0005_products_integrity.sql
[ "$(ls dist/kl/db/migrations/KL-*.sql | wc -l)" -ge 10 ]
test -f dist/kl/products/assets/paginate.js
test -f dist/kl/products/assets/theme.css
test -d dist/kl/products/assets/fonts
test -d dist/kl/products/assets/fonts-fallback
test -d db/migrations
[ "$(ls db/migrations/*.sql | wc -l)" -ge 1 ]
node -e "require.resolve(\"playwright-core\")"'
for img in api worker; do
  docker run --rm --entrypoint sh "$TAG-$img" -c "$LAYOUT" && pass "$img: migraciones y assets de KL en dist/kl/..., migraciones de plataforma en db/migrations, playwright-core presente" || die "$img: falta algún archivo esperado"
done
docker run --rm --entrypoint sh "$TAG-api" -c 'test ! -d /ms-playwright' && pass "api: SIN Chromium (imagen ligera)" || die "api: contiene Chromium"
docker run --rm --entrypoint sh "$TAG-worker" -c 'ls /ms-playwright | grep -q chromium && test -r "$(ls -d /ms-playwright/chromium-*/ | head -1)"' && pass "worker: Chromium en /ms-playwright, legible por node" || die "worker: sin Chromium"

echo "== migraciones empaquetadas (sin base de datos)"
for img in api worker; do
  docker run --rm -v "$SMOKE_DIR:/smoke:ro" --entrypoint node "$TAG-$img" /smoke/migrations-smoke.js > "$OUT/migrations-$img.json" \
    && pass "$img: migraciones KL contiguas, con huellas y lint contra las tablas de las demás plataformas" || die "$img: migraciones-smoke falló"
done

echo "== API: arranca sin KL y se comporta como antes"
cid=$(docker run -d -p "$PORT:8080" -e NODE_ENV=development "$TAG-api")
for i in $(seq 1 30); do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break; sleep 1; [ "$i" = 30 ] && { docker logs "$cid" | tail -20; die "api: /health no respondió"; }; done
pass "api: /health 200"
code() { curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT$1"; }
[ "$(code /api/public/editions/abcdefghijklmnopqrstuvwxyz/status)" = "404" ] && pass "api: ruta pública de ediciones NO montada sin KL (404)" || die "api: la ruta pública existe sin KL"
c=$(code /api/admin/kl/products); [ "$c" = "404" ] && pass "api: /api/admin/kl no montada sin KL (404)" || die "api: /api/admin/kl respondió $c sin KL"
docker logs "$cid" 2>&1 | grep -qi 'KL_DB_URL' && die "api: el log menciona credenciales de KL" || pass "api: sin credenciales de KL en el log"
cleanup; cid=""

echo "== worker: render real con la red BLOQUEADA"
docker run --rm --network none -v "$SMOKE_DIR:/smoke:ro" --entrypoint node "$TAG-worker" /smoke/render-smoke.js | tee "$OUT/render-smoke.json" \
  && pass "worker: Chromium arranca sin red, Lato verificada, PDF determinista, petición remota bloqueada (X19)" || die "worker: render-smoke falló"

echo "== worker: se niega a arrancar sin configuración (no hace nada por omisión)"
if docker run --rm "$TAG-worker" >/dev/null 2>"$OUT/worker-noconfig.err"; then die "worker: terminó con éxito sin configuración"; else pass "worker: sale con error sin KL_DB_URL_* (agentes nunca se activan por omisión)"; fi

echo "== AC-10 en esta plataforma"
python3 - "$OUT/render-smoke.json" <<'PY' || true
import json,sys
r=json.loads(open(sys.argv[1]).read().strip().splitlines()[-1])
key=f"linux-{'x64' if r['platform'].endswith('x64') else 'arm64'}-chromium-{r['chromium']}-{r['family']}"
base=json.load(open("backend/src/kl/products/ac10-baseline.json"))
print(f"AVISO línea base AC-10 «{key}»: " + ("registrada" if key in base else "NO registrada: registrarla (con aprobación del PO) a partir de este informe"))
PY

printf '{"ok":true,"tag":"%s","checks":%d}\n' "$TAG" "${#CHECKS[@]}" > "$REPORT"
echo "TODAS LAS COMPROBACIONES OK (${#CHECKS[@]}). Informe: $REPORT"
