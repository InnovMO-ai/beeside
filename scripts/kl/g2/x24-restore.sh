#!/usr/bin/env bash
# X24 · Exportación de beeside_kl y restauración en beeside_kl_restore (CR-KL-002 §10 / Pruebas X24, condición G2). Comprueba que la copia lógica restaura
# EXACTAMENTE lo mismo: recuento y contenido por tabla, definición de funciones/vistas, privilegios (ACL) y diario de migraciones.
# Uso: X24_CONFIRM=yes bash scripts/kl/g2/x24-restore.sh        (deja la salida en $X24_EVIDENCE si se define; no imprime secretos)
# Pasos: (1) pausa el tick del worker (lo reanuda al salir si estaba ENABLED); (2) exporta; (3) con un usuario de API TEMPORAL crea beeside_kl_restore con
# dueño kl_owner (GRANT/REVOKE temporal); (4) importa como kl_owner; (5) compara; (6) borra la base de restauración y el usuario temporal.
set -uo pipefail
[[ "${X24_CONFIRM:-}" == "yes" ]] || { echo "STOP: requiere X24_CONFIRM=yes" >&2; exit 2; }
P="${KL_PROJECT:-beeside-dev-508220}"; R=northamerica-south1; I=beeside-dev-kl-db; LOC=us-south1; TICK=beeside-dev-kl-worker-tick
BUCKET="$P-beeside-dev-kl-exports"; PSQL="${PSQL:-psql}"; PORT=5464; ADM=x24_admin
cd "$(git rev-parse --show-toplevel)"
TMP="$(mktemp -d)"; chmod 700 "$TMP"; PROXY_PID=""; TICK_WAS=""; DONE_CLEAN=0
log() { printf '%s %s\n' "$(date -u +%H:%M:%S)" "$*"; }
secret_url() { gcloud secrets versions access latest --secret "$1" --project "$P" | python3 -c '
import re,sys
t=sys.stdin.read().strip(); m=re.match(r"^(postgres(?:ql)?://[^@]+)@/([A-Za-z0-9_]+)\?host=/cloudsql/[^&]+$", t)
if not m: sys.stderr.write("formato inesperado\n"); sys.exit(3)
print(f"{m.group(1)}@127.0.0.1:{sys.argv[1]}/"+sys.argv[2]+"?sslmode=disable")' "$PORT" "$2"; }
adm() { PGPASSWORD="$(cat "$TMP/pw")" PGSSLMODE=disable "$PSQL" -X -q -h 127.0.0.1 -p "$PORT" -U "$ADM" -d postgres "$@"; }
cleanup() {
  set +e
  KLPG="$(secret_url beeside-dev-kl-owner-url postgres 2>/dev/null)"
  if [[ -n "$KLPG" && -n "$PROXY_PID" ]]; then "$PSQL" "$KLPG" -X -q -c "DROP DATABASE IF EXISTS beeside_kl_restore WITH (FORCE)" >/dev/null 2>&1; fi
  [[ -f "$TMP/pw" ]] && adm -c "REVOKE kl_owner FROM $ADM" >/dev/null 2>&1
  gcloud sql users delete "$ADM" --instance "$I" --project "$P" --quiet >/dev/null 2>&1
  LEFT="$(gcloud sql databases list --instance "$I" --project "$P" --format='value(name)' 2>/dev/null | tr '\n' ' ')"; USERS="$(gcloud sql users list --instance "$I" --project "$P" --format='value(name)' 2>/dev/null | tr '\n' ' ')"
  [[ -n "$PROXY_PID" ]] && kill "$PROXY_PID" 2>/dev/null
  if [[ "$TICK_WAS" == "ENABLED" ]]; then gcloud scheduler jobs resume "$TICK" --location "$LOC" --project "$P" >/dev/null 2>&1; fi
  rm -rf "$TMP"
  log "limpieza: bases = [$LEFT] · usuarios = [$USERS] · tick del worker: $(gcloud scheduler jobs describe "$TICK" --location "$LOC" --project "$P" --format='value(state)' 2>/dev/null)"
  [[ "$LEFT" == *beeside_kl_restore* || "$USERS" == *"$ADM"* ]] && { echo "ALERTA: la limpieza NO terminó (base de restauración o usuario temporal siguen presentes)" >&2; }
}
trap cleanup EXIT

log "1) pausa el tick del worker para que el origen no cambie durante la comparación"
TICK_WAS="$(gcloud scheduler jobs describe "$TICK" --location "$LOC" --project "$P" --format='value(state)')"
[[ "$TICK_WAS" == "ENABLED" ]] && gcloud scheduler jobs pause "$TICK" --location "$LOC" --project "$P" >/dev/null
sleep 20   # deja terminar un ciclo en curso

TS="$(date -u +%Y%m%dT%H%M%SZ)"; OBJ="gs://$BUCKET/x24/post-KL0001-0005-$TS.sql.gz"
log "2) exportación → $OBJ"
gcloud sql export sql "$I" "$OBJ" --database=beeside_kl --project "$P" --quiet >/dev/null
gcloud storage ls -l "$OBJ" | head -1

log "3) usuario de API temporal + proxy + base de restauración con dueño kl_owner"
openssl rand -hex 16 > "$TMP/pw"; chmod 600 "$TMP/pw"
gcloud sql users create "$ADM" --instance "$I" --project "$P" --password "$(cat "$TMP/pw")" --quiet >/dev/null
cloud-sql-proxy --gcloud-auth --port "$PORT" "$P:$R:$I" >/dev/null 2>&1 & PROXY_PID=$!; sleep 6
adm -c "GRANT kl_owner TO $ADM"
adm -c "DROP DATABASE IF EXISTS beeside_kl_restore WITH (FORCE)"
adm -c "CREATE DATABASE beeside_kl_restore OWNER kl_owner"
adm -c "REVOKE ALL ON DATABASE beeside_kl_restore FROM PUBLIC"
adm -c "REVOKE kl_owner FROM $ADM"; log "   miembro temporal retirado de kl_owner"

log "4) importación como kl_owner"
gcloud sql import sql "$I" "$OBJ" --database=beeside_kl_restore --user=kl_owner --project "$P" --quiet 2>&1 | tail -2

log "5) comparación"
SRC="$(secret_url beeside-dev-kl-owner-url beeside_kl)"; DST="$(secret_url beeside-dev-kl-owner-url beeside_kl_restore)"
cat > "$TMP/cmp.sql" <<'SQL'
SET TimeZone='UTC';
SELECT format('SELECT %L AS item, count(*)::text || '' rows · '' || md5(coalesce(string_agg(t::text, ''|'' ORDER BY t::text), '''')) AS fp FROM %I.%I t', 'tabla ' || tablename, schemaname, tablename)
  FROM pg_tables WHERE schemaname = 'kl' ORDER BY tablename \gexec
SELECT 'columnas', md5(string_agg(table_name||'.'||column_name||':'||data_type||':'||is_nullable||':'||coalesce(column_default,''), ',' ORDER BY table_name, ordinal_position)) FROM information_schema.columns WHERE table_schema='kl';
SELECT 'funciones', count(*)::text || ' · ' || md5(string_agg(pg_get_functiondef(p.oid), '' ORDER BY p.oid::regprocedure::text)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='kl';
SELECT 'vistas', count(*)::text || ' · ' || md5(string_agg(pg_get_viewdef(c.oid), '' ORDER BY c.relname)) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='kl' AND c.relkind='v';
SELECT 'ACL de relaciones', md5(string_agg(c.relname||':'||pg_get_userbyid(c.relowner)||':'||coalesce(c.relacl::text,''), ',' ORDER BY c.relname)) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='kl' AND c.relkind IN ('r','v','S');
SELECT 'ACL de funciones', md5(string_agg(p.oid::regprocedure::text||':'||pg_get_userbyid(p.proowner)||':'||coalesce(p.proacl::text,''), ',' ORDER BY p.oid::regprocedure::text)) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='kl';
SELECT 'ACL de esquema', coalesce(nspacl::text,'-') || ' dueño ' || pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='kl';
SELECT 'triggers', count(*)::text || ' · ' || md5(string_agg(pg_get_triggerdef(t.oid), '' ORDER BY t.tgname, t.tgrelid::regclass::text)) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='kl' AND NOT t.tgisinternal;
SELECT 'restricciones ' || coalesce(nullif(co.conrelid::regclass::text,'-'),'(dominio)'), count(*)::text || ' · ' || md5(string_agg(co.conname||':'||co.contype::text||':'||pg_get_constraintdef(co.oid), '|' ORDER BY co.conname, co.contype::text, pg_get_constraintdef(co.oid))) FROM pg_constraint co JOIN pg_namespace n ON n.oid=co.connamespace WHERE n.nspname='kl' GROUP BY co.conrelid;
SELECT 'índices', count(*)::text || ' · ' || md5(string_agg(indexdef, '' ORDER BY indexname)) FROM pg_indexes WHERE schemaname='kl';
SELECT 'diario ' || seq, name||' '||sha256 FROM kl.__kl_migrations ORDER BY seq;
SQL
"$PSQL" "$SRC" -X -tA -F ' | ' -f "$TMP/cmp.sql" 2>&1 | sort > "$TMP/src.txt"
"$PSQL" "$DST" -X -tA -F ' | ' -f "$TMP/cmp.sql" 2>&1 | sort > "$TMP/dst.txt"
# Detalle por restricción (para clasificar diferencias): una línea por restricción, ordenada.
cat > "$TMP/cons.sql" <<'SQL'
SET TimeZone='UTC';
SELECT coalesce(nullif(co.conrelid::regclass::text,'-'),'(dominio)') || ' :: ' || co.conname || ' :: ' || co.contype::text || ' :: ' || pg_get_constraintdef(co.oid) FROM pg_constraint co JOIN pg_namespace n ON n.oid=co.connamespace WHERE n.nspname='kl' ORDER BY 1;
SQL
"$PSQL" "$SRC" -X -tA -f "$TMP/cons.sql" > "$TMP/cons_src.txt" 2>&1; "$PSQL" "$DST" -X -tA -f "$TMP/cons.sql" > "$TMP/cons_dst.txt" 2>&1
N="$(wc -l < "$TMP/src.txt" | tr -d ' ')"; echo "elementos comparados: $N (tablas: $(grep -c '^tabla ' "$TMP/src.txt"))"
# Una consulta de comparación que falla en AMBAS bases daría un falso «idéntico»: se exige que no haya errores de psql en la salida.
if grep -qE 'ERROR:|^LINE [0-9]+:|psql:' "$TMP/src.txt" "$TMP/dst.txt" "$TMP/cons_src.txt" "$TMP/cons_dst.txt"; then echo "RESULTADO X24: INVÁLIDO (una consulta de comparación falló)"; grep -hE 'ERROR:|psql:' "$TMP/src.txt" "$TMP/cons_src.txt" | head -3; RC=2
elif diff "$TMP/src.txt" "$TMP/dst.txt" > "$TMP/diff.txt"; then echo "RESULTADO X24: IDÉNTICO (recuentos, contenido, definiciones, ACL, triggers, restricciones, índices y diario)"; RC=0
else
  # Solo se admite una diferencia: restricciones cuyo texto cambia por la forma de los paréntesis (p. ej. ((A AND B) AND C) → (A AND B AND C)), sin OR ni NOT.
  if grep -E '^[<>]' "$TMP/diff.txt" | grep -qvE '^[<>] restricciones '; then BENIGN=0; else
    diff "$TMP/cons_src.txt" "$TMP/cons_dst.txt" | grep -E '^[<>]' > "$TMP/cd.txt" || true
    BENIGN=1; for k in $(seq 1 1); do :; done
    python3 - "$TMP/cd.txt" <<'PY' || BENIGN=0
import re,sys
lines=[l.rstrip("\n") for l in open(sys.argv[1])]
src=[l[2:] for l in lines if l.startswith("<")]; dst=[l[2:] for l in lines if l.startswith(">")]
norm=lambda x: re.sub(r"[\s()]","",x)
if len(src)!=len(dst) or not src: sys.exit(1)
for a,b in zip(sorted(src,key=norm),sorted(dst,key=norm)):
    if norm(a)!=norm(b) or re.search(r"\b(OR|NOT)\b",a+b): sys.exit(1)
print("diferencias admitidas (equivalencia lógica por paréntesis, sin OR/NOT):")
for a,b in zip(sorted(src,key=norm),sorted(dst,key=norm)): print("  origen:",a[:200]); print("  restau:",b[:200])
PY
  fi
  if [[ "$BENIGN" == "1" ]]; then echo "RESULTADO X24: IDÉNTICO SALVO restricciones equivalentes por normalización de paréntesis (ver arriba; el resto: recuentos, contenido, definiciones, ACL, triggers, índices y diario idénticos)"; RC=0
  else echo "RESULTADO X24: DIFERENCIAS"; cut -c1-200 "$TMP/diff.txt" | head -40; echo "-- detalle de restricciones:"; diff "$TMP/cons_src.txt" "$TMP/cons_dst.txt" | cut -c1-260 | head -30; RC=1; fi
fi
[[ -n "${X24_EVIDENCE:-}" ]] && { mkdir -p "$(dirname "$X24_EVIDENCE")"; { echo "# X24 · $TS · exportación $OBJ"; echo "# origen = beeside_kl · restauración = beeside_kl_restore (huellas por tabla/objeto; sin datos)"; cat "$TMP/src.txt"; echo "# diferencias con la restauración: $([[ $RC = 0 ]] && { [[ "${BENIGN:-0}" == 1 ]] && echo "1 restricción equivalente por normalización de paréntesis (ver resultado); ninguna otra" || echo ninguna; } || echo "ver resultado")"; } > "$X24_EVIDENCE"; }
exit $RC
