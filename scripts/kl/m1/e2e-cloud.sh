#!/usr/bin/env bash
# M1 opción b · Ensayo de punta a punta en la nube sobre beeside_kl_e2e (instancia dedicada, principales de prueba; NO toca beeside_kl).
# Uso: E2E_CONFIRM=yes bash scripts/kl/m1/e2e-cloud.sh
# Pasos: (1) ventana privilegiada: usuario de API temporal crea beeside_kl_e2e con dueño kl_owner y se retira de inmediato; (2) migra KL-0001…0005 como kl_owner;
# (3) siembra el mundo sintético y aprueba una edición con personas distintas; (4) ejecuta el job beeside-dev-kl-worker (Chromium + GcsObjectStore) apuntado
# a la base de ensayo; (5) verifica filas, objetos y hashes; (6) borra la base de ensayo como kl_owner y comprueba que no quedan usuarios temporales.
# Los PDF del bucket de almacén no se pueden borrar (versionado + retención de 30 días): quedan bajo kl/editions/e2e_synthetic/.
set -uo pipefail
[[ "${E2E_CONFIRM:-}" == "yes" ]] || { echo "STOP: requiere E2E_CONFIRM=yes" >&2; exit 2; }
P="${KL_PROJECT:-beeside-dev-508220}"; R=northamerica-south1; I=beeside-dev-kl-db; JOB=beeside-dev-kl-worker
BUCKET="$P-beeside-dev-kl-store"; PSQL="${PSQL:-/Applications/Postgres.app/Contents/Versions/latest/bin/psql}"; PORT=5465; ADM=m1e2e_admin; DB=beeside_kl_e2e
cd "$(git rev-parse --show-toplevel)"; TMP="$(mktemp -d)"; chmod 700 "$TMP"; PROXY_PID=""; RC=1
log() { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*"; }
url_for() { # $1 secreto → URL del proxy hacia $DB (la contraseña no se imprime)
  gcloud secrets versions access latest --secret "$1" --project "$P" | python3 -c '
import re,sys
t=sys.stdin.read().strip(); m=re.match(r"^(postgres(?:ql)?://[^@]+)@/([A-Za-z0-9_]+)\?host=/cloudsql/[^&]+$", t)
if not m: sys.stderr.write("formato inesperado\n"); sys.exit(3)
print(f"{m.group(1)}@127.0.0.1:{sys.argv[1]}/{sys.argv[2]}?sslmode=disable")' "$PORT" "$2"; }
adm() { PGPASSWORD="$(cat "$TMP/pw")" PGSSLMODE=disable "$PSQL" -X -q -h 127.0.0.1 -p "$PORT" -U "$ADM" -d postgres "$@"; }
cleanup() {
  set +e
  OWN="$(url_for beeside-dev-kl-owner-url postgres 2>/dev/null)"
  [[ -n "$OWN" && -n "$PROXY_PID" ]] && "$PSQL" "$OWN" -X -q -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" >/dev/null 2>&1
  [[ -f "$TMP/pw" ]] && adm -c "REVOKE kl_owner FROM $ADM" >/dev/null 2>&1
  gcloud sql users delete "$ADM" --instance "$I" --project "$P" --quiet >/dev/null 2>&1
  LEFT="$(gcloud sql databases list --instance "$I" --project "$P" --format='value(name)' 2>/dev/null | tr '\n' ' ')"; USERS="$(gcloud sql users list --instance "$I" --project "$P" --format='value(name)' 2>/dev/null | tr '\n' ' ')"
  [[ -n "$PROXY_PID" ]] && kill "$PROXY_PID" 2>/dev/null
  rm -rf "$TMP"
  log "limpieza: bases = [$LEFT] · usuarios = [$USERS]"
  [[ "$LEFT" == *"$DB"* || "$USERS" == *"$ADM"* ]] && echo "ALERTA: la limpieza NO terminó" >&2
  exit "$RC"
}
trap cleanup EXIT

log "1) ventana privilegiada: usuario temporal → $DB con dueño kl_owner"
openssl rand -hex 16 > "$TMP/pw"; chmod 600 "$TMP/pw"
gcloud sql users create "$ADM" --instance "$I" --project "$P" --password "$(cat "$TMP/pw")" --quiet >/dev/null || exit 1
cloud-sql-proxy --gcloud-auth --port "$PORT" "$P:$R:$I" >/dev/null 2>&1 & PROXY_PID=$!; sleep 6
adm -c "GRANT kl_owner TO $ADM" && adm -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" && adm -c "CREATE DATABASE $DB OWNER kl_owner" && adm -c "REVOKE ALL ON DATABASE $DB FROM PUBLIC" || exit 1
adm -c "REVOKE kl_owner FROM $ADM"; gcloud sql users delete "$ADM" --instance "$I" --project "$P" --quiet >/dev/null && log "   ventana cerrada: usuario temporal eliminado"

log "2) migración como kl_owner"
export KL_DB_URL_OWNER="$(url_for beeside-dev-kl-owner-url $DB)"
( cd backend && npx tsx -e 'import("./src/kl/db/runner").then(async (m) => { const r = await m.runMigrations({ connectionString: process.env.KL_DB_URL_OWNER as string, expectedDatabase: "beeside_kl_e2e", foreignMigrationsDir: "db/migrations" }); console.log(JSON.stringify(r)); })' ) || exit 1

log "3) siembra y aprobación (personas de prueba distintas)"
for pair in OWNER:beeside-dev-kl-owner-url APP:beeside-dev-kl-app-url READER:beeside-dev-kl-reader-precision-url AGENT:beeside-dev-kl-agent-url KNOWLEDGE:beeside-dev-kl-knowledge-url; do
  export "KL_E2E_URL_${pair%%:*}=$(url_for "${pair#*:}" $DB)"
done
unset KL_DB_URL_OWNER
OUT="$(cd backend && npx tsx src/kl/testing/cloud-e2e.ts)" || exit 1
echo "$OUT"; EID="$(echo "$OUT" | python3 -c 'import json,sys; print(json.loads(sys.stdin.read().strip().splitlines()[-1])["editionId"])')"

log "4) job de Cloud Run apuntado a $DB"
JS='const e={...process.env}; for (const k of ["KL_DB_URL_AGENT","KL_DB_URL_KNOWLEDGE"]) e[k]=e[k].replace("/beeside_kl?","/beeside_kl_e2e?"); const r=require("child_process").spawnSync("node",["dist/kl/worker/kl-worker.js"],{env:e,stdio:"inherit"}); process.exit(r.status??1)'
gcloud run jobs execute "$JOB" --region "$R" --project "$P" --wait --args="^@^-e@$JS" 2>&1 | tail -5

log "5) verificación"
OWNER_URL="$KL_E2E_URL_OWNER"
"$PSQL" "$OWNER_URL" -X -tA -F ' | ' -c "SELECT 'edición', code, status FROM kl.edition WHERE id='$EID'" -c "SELECT 'render', er.locale, fo.byte_length, left(er.pdf_sha256,16), fo.storage_key FROM kl.edition_rendering er JOIN kl.file_object fo ON fo.id=er.file_object_id WHERE er.edition_id='$EID' ORDER BY er.locale" -c "SELECT 'cola', kind, status, count(*) FROM kl.job GROUP BY 2,3 ORDER BY 2,3" 2>&1 | tee "$TMP/v.txt"
grep -q "^edición | 2026.10 | published" "$TMP/v.txt" && RC=0
python3 - "$TMP/v.txt" "$BUCKET" <<'PY' || RC=1
import subprocess,sys,hashlib
bucket=sys.argv[2]; ok=True
for line in open(sys.argv[1]):
    f=[x.strip() for x in line.split("|")]
    if f[0]!="render": continue
    key=f[-1]; data=subprocess.run(["gcloud","storage","cat",f"gs://{bucket}/{key}"],capture_output=True).stdout
    sha=hashlib.sha256(data).hexdigest(); good=sha.startswith(f[3]) and data[:5]==b"%PDF-"
    print(f"objeto {key.split('/')[-2]}: {len(data)} B · sha {'coincide' if good else 'NO COINCIDE'}"); ok&=good
sys.exit(0 if ok else 1)
PY
exit "$RC"
