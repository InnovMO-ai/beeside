#!/usr/bin/env bash
# M1-cierre · Verificación REAL del estado público y de la descarga autenticada con un servicio TEMPORAL y exclusivo de KL (DEV).
#   ALERTS... no: este script no toca alertas.
# Uso: VERIFY_CONFIRM=yes bash scripts/kl/m1/verify-public-download.sh <up|test|down>
#   up   : ventana privilegiada breve → base de ensayo beeside_kl_e2e (dueño kl_owner) → migra → siembra (personas de prueba; el PO real recibe solo KL_REVIEWER)
#          → worker de Cloud Run renderiza la vista previa y, tras la aprobación, la edición final → despliega beeside-dev-kl-verify (PRIVADO, IAM).
#   test : pruebas automáticas HTTP (estado público, rechazos sin sesión, inicio del flujo OIDC).
#   down : elimina el servicio y la base de ensayo, comprueba que no queda nada y conserva la evidencia.
# El servicio reutiliza la imagen del backend existente y su cuenta de servicio; NO modifica el backend, IAM, secretos ni la base de otras plataformas.
# Los objetos PDF del bucket de almacén no se pueden borrar (versionado + retención 30 días); quedan bajo kl/editions/e2e_synthetic/ y kl/previews/.
set -uo pipefail
[[ "${VERIFY_CONFIRM:-}" == "yes" ]] || { echo "STOP: requiere VERIFY_CONFIRM=yes" >&2; exit 2; }
P="${KL_PROJECT:-beeside-dev-508220}"; R=northamerica-south1; I=beeside-dev-kl-db; JOB=beeside-dev-kl-worker; SVC=beeside-dev-kl-verify; BACKEND=beeside-dev-backend-api
PSQL="${PSQL:-/Applications/Postgres.app/Contents/Versions/latest/bin/psql}"; PORT=5468; PORT2=5469; ADM=m1v_admin; DB=beeside_kl_e2e; PO_EMAIL="${PO_EMAIL:?define PO_EMAIL con el correo del revisor (no se versiona)}"; LOCAL_PORT="${LOCAL_PORT:-8081}"
cd "$(git rev-parse --show-toplevel)"
WORK="${VERIFY_WORK:-/private/tmp/kl-m1-verify}"; mkdir -p "$WORK"; chmod 700 "$WORK"; EV="docs/knowledge-layer/kl-1.0-code/evidence/M1-publico-descarga-$(date -u +%Y-%m-%d)"; mkdir -p "$EV"
log() { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*"; }
PIDS=(); cleanup_pids() { for p in "${PIDS[@]:-}"; do kill "$p" 2>/dev/null; done; }
url_for() { # $1 secreto $2 base $3 puerto
  gcloud secrets versions access latest --secret "$1" --project "$P" | python3 -c '
import re,sys
t=sys.stdin.read().strip(); m=re.match(r"^(postgres(?:ql)?://[^@]+)@/([A-Za-z0-9_]+)\?host=/cloudsql/[^&]+$", t)
if not m: sys.stderr.write("formato inesperado\n"); sys.exit(3)
print(f"{m.group(1)}@127.0.0.1:{sys.argv[1]}/{sys.argv[2]}?sslmode=disable")' "$3" "$2"; }
worker_run() { # ejecuta el job del worker apuntado a la base de ensayo (reescribe el nombre de la base en las dos URLs que usa)
  local JS='const e={...process.env}; for (const k of ["KL_DB_URL_AGENT","KL_DB_URL_KNOWLEDGE"]) e[k]=e[k].replace("/beeside_kl?","/beeside_kl_e2e?"); for (const k of ["KL_DB_URL_AGENT","KL_DB_URL_KNOWLEDGE"]) if (!e[k].includes("/beeside_kl_e2e?")) throw new Error("reescritura sin efecto en "+k); const r=require("child_process").spawnSync("node",["dist/kl/worker/kl-worker.js"],{env:e,stdio:"inherit"}); process.exit(r.status??1)'
  gcloud run jobs execute "$JOB" --region "$R" --project "$P" --wait --args="^@^-e@$JS" 2>&1 | tail -3; }
owner_sql() { "$PSQL" "$(url_for beeside-dev-kl-owner-url "${1:-$DB}" $PORT)" -X -tA -F ' | ' -c "$2"; }

phase_up() {
  TMP="$(mktemp -d)"; chmod 700 "$TMP"
  trap 'cleanup_pids; rm -rf "$TMP"; gcloud sql users delete "$ADM" --instance "$I" --project "$P" --quiet >/dev/null 2>&1' EXIT
  log "1) ventana privilegiada breve → $DB (dueño kl_owner)"
  openssl rand -hex 16 > "$TMP/pw"
  gcloud sql users create "$ADM" --instance "$I" --project "$P" --password "$(cat "$TMP/pw")" --quiet >/dev/null || exit 1
  cloud-sql-proxy --gcloud-auth --port "$PORT" "$P:$R:$I" >/dev/null 2>&1 & PIDS+=($!); sleep 6
  adm() { PGPASSWORD="$(cat "$TMP/pw")" PGSSLMODE=disable "$PSQL" -X -q -h 127.0.0.1 -p "$PORT" -U "$ADM" -d postgres "$@"; }
  adm -c "GRANT kl_owner TO $ADM" && adm -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" && adm -c "CREATE DATABASE $DB OWNER kl_owner" && adm -c "REVOKE ALL ON DATABASE $DB FROM PUBLIC" || exit 1
  adm -c "REVOKE kl_owner FROM $ADM"; gcloud sql users delete "$ADM" --instance "$I" --project "$P" --quiet >/dev/null && log "   ventana cerrada (usuario temporal eliminado)"
  log "2) migración KL-0001…0005"
  export KL_DB_URL_OWNER; KL_DB_URL_OWNER="$(url_for beeside-dev-kl-owner-url $DB $PORT)"
  ( cd backend && npx tsx -e 'import("./src/kl/db/runner").then(async (m) => { const r = await m.runMigrations({ connectionString: process.env.KL_DB_URL_OWNER as string, expectedDatabase: "beeside_kl_e2e", foreignMigrationsDir: "db/migrations" }); console.log(JSON.stringify(r.applied.length)+" aplicadas"); })' ) || exit 1
  unset KL_DB_URL_OWNER
  log "3) PO real (solo lectura de admin_user en la base principal)"
  cloud-sql-proxy --gcloud-auth --port "$PORT2" "$P:$R:beeside-dev-canonical-db" >/dev/null 2>&1 & PIDS+=($!); sleep 6
  PO="$("$PSQL" "$(url_for beeside-dev-database-url beeside $PORT2)" -X -tA -F ' ' -c "SELECT admin_user_id, auth_identity FROM admin_user WHERE auth_identity=lower('$PO_EMAIL') AND active AND login_enabled" 2>/dev/null)"
  [ -n "$PO" ] || { echo "STOP: $PO_EMAIL no es un admin_user activo con login"; exit 1; }
  export KL_E2E_PO_ID="${PO%% *}" KL_E2E_PO_EMAIL="${PO#* }"
  for pair in OWNER:beeside-dev-kl-owner-url APP:beeside-dev-kl-app-url READER:beeside-dev-kl-reader-precision-url AGENT:beeside-dev-kl-agent-url KNOWLEDGE:beeside-dev-kl-knowledge-url; do export "KL_E2E_URL_${pair%%:*}=$(url_for "${pair#*:}" $DB $PORT)"; done
  log "4) siembra A: edición en aprobación + vista previa solicitada"
  A="$(cd backend && KL_E2E_PHASE=A npx tsx src/kl/testing/cloud-e2e.ts)" || exit 1; echo "$A" > "$WORK/state.json"; echo "$A" | python3 -c 'import json,sys; d=json.loads(sys.stdin.read().splitlines()[-1]); print("   edición", d["editionId"])'
  log "5) worker (Cloud Run) renderiza la vista previa"; worker_run
  owner_sql $DB "SELECT 'vistas previas', count(*) FROM kl.edition_preview" | tee "$EV/db-preview.txt"
  log "6) aprobación por otra persona (revisor editorial) y render final"
  ST="$(tail -1 "$WORK/state.json")"; B="$(cd backend && KL_E2E_PHASE=B KL_E2E_STATE="$ST" npx tsx src/kl/testing/cloud-e2e.ts)" || exit 1; echo "$B" > "$WORK/state-b.json"; worker_run
  owner_sql $DB "SELECT 'edición', code, status FROM kl.edition" | tee "$EV/db-edition.txt"; grep -q "published" "$EV/db-edition.txt" || { echo "STOP: la edición no quedó publicada"; exit 1; }
  log "7) servicio temporal PRIVADO $SVC (clon del backend: misma imagen, misma cuenta de servicio, KL apuntando a $DB)"
  gcloud run services describe "$BACKEND" --region "$R" --project "$P" --format=export > "$WORK/backend.yaml" || exit 1
  node scripts/kl/m1/clone-backend-yaml.js "$(pwd)" "$WORK/backend.yaml" "$SVC" "http://localhost:$LOCAL_PORT" "$WORK/verify.yaml" || exit 1
  grep -q "invoker-iam-disabled" "$WORK/verify.yaml" && { echo "STOP: el YAML clonado conserva invoker-iam-disabled"; exit 1; }
  gcloud run services replace "$WORK/verify.yaml" --region "$R" --project "$P" 2>&1 | tail -3
  gcloud run services describe "$SVC" --region "$R" --project "$P" --format='value(metadata.annotations)' | tr ',' '\n' | grep -c "invoker-iam-disabled" | sed 's/^/anotaciones invoker-iam-disabled presentes: /' | tee "$EV/svc-privacidad.txt"
  gcloud run services get-iam-policy "$SVC" --region "$R" --project "$P" --format=json >> "$EV/svc-privacidad.txt"
  URLX="$(gcloud run services describe "$SVC" --region "$R" --project "$P" --format='value(status.url)')"
  CODE="$(curl -s -o /dev/null -w '%{http_code}' "$URLX/api/public/editions/aaaaaaaaaaaaaaaaaaaaaaaaaa/status")"; echo "petición SIN credenciales → HTTP $CODE (debe ser 403)" | tee -a "$EV/svc-privacidad.txt"
  [ "$CODE" = 403 ] || { echo "STOP: el servicio temporal NO es privado; se elimina"; gcloud run services delete "$SVC" --region "$R" --project "$P" --quiet; exit 1; }
  gcloud run services describe "$SVC" --region "$R" --project "$P" --format='value(status.url)' > "$WORK/url.txt"; log "   $(cat "$WORK/url.txt")"
}

tok() { gcloud auth print-identity-token 2>/dev/null; }
phase_test() {
  URL="$(cat "$WORK/url.txt")"; EID="$(tail -1 "$WORK/state-b.json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["editionId"])')"; T="$(tok)"
  FAILS=0; chk() { if [ "$2" = "$3" ]; then echo "   OK $1: $2"; else echo "   FALLA $1: obtuvo $2, esperaba $3"; FAILS=1; fi; }
  c=$(curl -s -o /dev/null -w '%{http_code}' "$URL/api/public/editions/aaaaaaaaaaaaaaaaaaaaaaaaaa/status"); chk "T0 petición SIN credenciales (el servicio debe ser privado)" "$c" 403; echo "T0 sin credenciales: HTTP $c" > "$EV/t0-privacidad.txt"
  H() { curl -s -o "$WORK/body.out" -D "$WORK/head.out" -w '%{http_code}' -H "Authorization: Bearer $T" "$@"; }
  # El identificador público NO es el id de la edición: es el «verification id» impreso en el PDF (la base solo guarda su sha256).
  cloud-sql-proxy --gcloud-auth --port "$PORT" "$P:$R:$I" >/dev/null 2>&1 & PIDS+=($!); trap 'cleanup_pids' EXIT; sleep 6
  KEY="$(owner_sql $DB "SELECT fo.storage_key FROM kl.edition_rendering er JOIN kl.file_object fo ON fo.id=er.file_object_id WHERE er.locale='es'" | head -1)"
  gcloud storage cp "gs://$P-beeside-dev-kl-store/$KEY" "$WORK/final-es.pdf" >/dev/null 2>&1
  VID="$(python3 -c '
import re,sys
d=open(sys.argv[1],"rb").read(); u=set(re.findall(rb"verify\.sintetico\.example/verificar/([a-z0-9]{20,40})",d)); print(sorted(u)[0].decode() if u else "")' "$WORK/final-es.pdf")"
  [ -n "$VID" ] || { echo "STOP: no se encontró el verification id en el PDF"; exit 1; }
  echo "$VID" > "$WORK/vid.txt"; DBSHA="$(owner_sql $DB "SELECT verification_id_sha256 FROM kl.edition LIMIT 1")"; PDFSHA="$(printf '%s' "$VID" | shasum -a 256 | cut -c1-64)"
  [ "$DBSHA" = "$PDFSHA" ] && log "   el sha256 del verification id del PDF coincide con el guardado en la base" || { echo "STOP: el verification id del PDF no coincide con la base ($DBSHA vs $PDFSHA)"; exit 1; }
  log "T1 estado público con el verification id del PDF publicado"; c=$(H "$URL/api/public/editions/$VID/status"); chk T1 "$c" 200; grep -q '"status":"current"' "$WORK/body.out" || { echo "   FALLA T1: cuerpo sin status current"; FAILS=1; }; cat "$WORK/body.out"; echo; grep -iE "cache-control|x-robots|x-content-type" "$WORK/head.out"; { echo "HTTP $c"; cat "$WORK/head.out"; cat "$WORK/body.out"; } > "$EV/t1-estado-publico.txt"
  log "T2 id inexistente / mal formado"; c=$(H "$URL/api/public/editions/aaaaaaaaaaaaaaaaaaaaaaaaaa/status"); [ "$c" = 200 ] || { echo "FALLA T2"; FAILS=1; }; echo "   inexistente → HTTP $c $(cat "$WORK/body.out" | head -c 160)"; c2=$(H "$URL/api/public/editions/no-es-uuid/status"); echo "   mal formado → HTTP $c2"; chk "T2 inexistente" "$c" 200; chk "T2 mal formado" "$c2" 200; { echo "inexistente $c: $(cat "$WORK/body.out")"; } > "$EV/t2-ids.txt"; H "$URL/api/public/editions/no-es-uuid/status" >/dev/null; echo "mal formado $c2: $(cat "$WORK/body.out")" >> "$EV/t2-ids.txt"
  log "T3 descarga de la vista previa SIN sesión (debe rechazarse)"; PE="$(tail -1 "$WORK/state.json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["editionId"])')"
  c=$(H "$URL/api/admin/kl/editions/$PE/preview/es/pdf"); echo "   sin cookie → HTTP $c"; c2=$(H -H "Cookie: beeside_admin_session=invalida" "$URL/api/admin/kl/editions/$PE/preview/es/pdf"); echo "   cookie inválida → HTTP $c2"; chk "T3 sin cookie" "$c" 401; chk "T3 cookie inválida" "$c2" 401; echo "sin cookie $c | cookie inválida $c2" > "$EV/t3-sin-sesion.txt"
  log "T4 inicio del flujo OIDC (redirección a Google con el redirect_uri de prueba)"; c=$(H "$URL/api/admin/auth/login"); echo "   HTTP $c"; grep -i "^location" "$WORK/head.out" | sed -E 's/(client_id=)[^&]*/\1…/; s/(state|nonce|code_challenge)=[^&]*/\1=…/g' | tee "$EV/t4-oidc-redirect.txt"
  log "preview edición: $PE · edición final: $EID"; [ "$FAILS" = 0 ] || { echo "RESULTADO: FALLÓ"; exit 1; }; echo "RESULTADO: pruebas HTTP correctas"
}

phase_down() {
  trap 'cleanup_pids' EXIT
  log "retirada: servicio, base de ensayo, usuarios temporales"
  gcloud run services delete "$SVC" --region "$R" --project "$P" --quiet 2>&1 | tail -1
  cloud-sql-proxy --gcloud-auth --port "$PORT" "$P:$R:$I" >/dev/null 2>&1 & PIDS+=($!); sleep 6
  "$PSQL" "$(url_for beeside-dev-kl-owner-url postgres $PORT)" -X -q -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)"
  LEFT="$(gcloud sql databases list --instance "$I" --project "$P" --format='value(name)' | tr '\n' ' ')"; USERS="$(gcloud sql users list --instance "$I" --project "$P" --format='value(name)' | tr '\n' ' ')"
  SV="$(gcloud run services list --region "$R" --project "$P" --format='value(metadata.name)' | grep -c "^$SVC$" || true)"
  log "bases=[$LEFT] usuarios=[$USERS] servicio_temporal_presente=$SV" | tee "$EV/retirada.txt"
  [[ "$LEFT" == *"$DB"* || "$SV" != 0 ]] && { echo "ALERTA: la retirada no terminó" >&2; exit 1; }; exit 0
}
phase_revoke() {  # estado público tras revocar (acto irreversible dentro de la base de ensayo)
  trap 'cleanup_pids' EXIT; URL="$(cat "$WORK/url.txt")"; VID="$(cat "$WORK/vid.txt")"; T="$(tok)"
  cloud-sql-proxy --gcloud-auth --port "$PORT" "$P:$R:$I" >/dev/null 2>&1 & PIDS+=($!); sleep 6
  for pair in OWNER:beeside-dev-kl-owner-url APP:beeside-dev-kl-app-url READER:beeside-dev-kl-reader-precision-url AGENT:beeside-dev-kl-agent-url KNOWLEDGE:beeside-dev-kl-knowledge-url; do export "KL_E2E_URL_${pair%%:*}=$(url_for "${pair#*:}" $DB $PORT)"; done
  ST="$(tail -1 "$WORK/state.json")"; (cd backend && KL_E2E_PHASE=C KL_E2E_STATE="$ST" npx tsx src/kl/testing/cloud-e2e.ts) || exit 1
  c=$(curl -s -o "$WORK/body.out" -w '%{http_code}' -H "Authorization: Bearer $T" "$URL/api/public/editions/$VID/status"); log "estado público tras revocar: HTTP $c $(cat "$WORK/body.out")"; { echo "HTTP $c"; cat "$WORK/body.out"; } > "$EV/t5-estado-revocado.txt"
}
case "${1:-}" in up) phase_up ;; test) phase_test ;; revoke) phase_revoke ;; down) phase_down ;; *) echo "uso: verify-public-download.sh <up|test|down>"; exit 3 ;; esac
