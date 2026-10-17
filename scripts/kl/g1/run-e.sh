#!/usr/bin/env bash
# Protocolo E1–E15 (CR-KL-002 Contratos de seguridad §8.3, prueba X23) contra una instancia de KL ya aprovisionada.
# Se ejecuta como un rol SIMPLE ajeno a KL (NOSUPERUSER NOCREATEROLE NOCREATEDB, fuera de cloudsqlsuperuser). Solo intenta cosas que deben
# FALLAR; en una instancia correcta no cambia nada. Las contraseñas de los kl_* se leen de Secret Manager en memoria; nunca se imprimen.
# Precondición: cloud-sql-proxy --gcloud-auth --port $G1_PORT <proyecto>:<región>:<instancia> en marcha, y el rol de prueba creado
#   (ver infra/terraform/envs/dev-kl/RUNBOOK.md Fase 4: se crea con un usuario de API temporal que se elimina enseguida, y se borra al final).
# Uso: G1_PROBE_USER=g1_probe G1_PROBE_PW=... [G1_PORT=5458] [G1_PROJECT=beeside-dev-508220] bash scripts/kl/g1/run-e.sh | tee evidencia.txt
# Tras KL-0001 (condición de G1): repetir y archivar en docs/knowledge-layer/kl-1.0-code/evidence/G1-<fecha>/. Añade además, ya con objetos, E9 y E10.
set -uo pipefail
PSQL="${PSQL:-psql}"; PORT="${G1_PORT:-5458}"; PROJECT="${G1_PROJECT:-beeside-dev-508220}"; U="${G1_PROBE_USER:?G1_PROBE_USER}"; : "${G1_PROBE_PW:?G1_PROBE_PW}"
KL="kl_owner kl_app kl_reader_precision kl_agent kl_knowledge"
pw_of() { gcloud secrets versions access latest --secret "beeside-dev-$(echo "$1" | tr _ -)-url" --project "$PROJECT" | python3 -c 'import sys,re;print(re.match(r"^[a-z]+://[^:]+:([^@]+)@",sys.stdin.read().strip()).group(1))'; }
run() { local user=$1 db=$2; shift 2; local pw; if [ "$user" = "$U" ]; then pw=$G1_PROBE_PW; else pw=$(pw_of "$user"); fi
        PGPASSWORD="$pw" PGSSLMODE=disable "$PSQL" -X -q -h 127.0.0.1 -p "$PORT" -U "$user" -d "$db" "$@" 2>&1; }
res() { local out; out=$(cat); if echo "$out" | grep -qiE "error|denied|must be|FATAL"; then echo "FALLA ✅ ($(echo "$out" | grep -iE "error|denied|must be|FATAL" | head -1 | cut -c1-95))"; else echo "SIN ERROR ❌ [$(echo "$out" | tr '\n' ' ' | cut -c1-80)]"; fi; }
sql() { run "$U" postgres -c "$1" | res; }
scalar() { run "$1" "$2" -tAc "$3"; }
echo "# E1–E15 · principal: $U · $(date -u +%FT%TZ)"
echo "E1  | conectarse a beeside_kl | $(run "$U" beeside_kl -c 'select 1' | res)"
for r in $KL; do echo "E2  | GRANT $r TO $U | $(sql "GRANT $r TO $U")"; done
for r in $KL; do echo "E3  | SET ROLE $r | $(sql "SET ROLE $r")"; done
for r in $KL; do echo "E4a | ALTER ROLE $r PASSWORD | $(sql "ALTER ROLE $r PASSWORD 'zz'")"; echo "E4b | ALTER ROLE $r NOLOGIN | $(sql "ALTER ROLE $r NOLOGIN")"; echo "E4c | DROP ROLE $r | $(sql "DROP ROLE $r")"; done
echo "E5a | CREATE ROLE x_probe IN ROLE kl_owner | $(sql 'CREATE ROLE x_probe IN ROLE kl_owner')"
echo "E5b | CREATE ROLE x_probe2 ADMIN kl_owner | $(sql 'CREATE ROLE x_probe2 ADMIN kl_owner')"
echo "E6  | ALTER DATABASE beeside_kl OWNER TO $U | $(sql "ALTER DATABASE beeside_kl OWNER TO $U")"
echo "E7  | pg_has_role MEMBER | $(scalar "$U" postgres "SELECT string_agg(r||'='||pg_has_role('$U',r,'MEMBER'),', ') FROM unnest(ARRAY['kl_owner','kl_app','kl_reader_precision','kl_agent','kl_knowledge','cloudsqlsuperuser']) r")"
echo "E8  | filas con admin_option sobre kl_* o con cloudsqlsuperuser/$U como miembro (debe ser 0) | $(scalar "$U" postgres "SELECT count(*) FROM pg_auth_members m WHERE m.roleid::regrole::text LIKE 'kl\_%' AND (m.admin_option OR m.member::regrole::text IN ('cloudsqlsuperuser','$U'))")"
echo "E9  | dueños de beeside_kl y de todos sus objetos (como kl_owner; solo kl_owner y pg_database_owner) | $(scalar kl_owner beeside_kl "SELECT string_agg(DISTINCT o, ', ') FROM (SELECT pg_get_userbyid(datdba) o FROM pg_database WHERE datname='beeside_kl' UNION SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname NOT LIKE 'pg\_%' AND nspname<>'information_schema' UNION SELECT pg_get_userbyid(relowner) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema','pg_toast') UNION SELECT pg_get_userbyid(proowner) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname NOT IN ('pg_catalog','information_schema') UNION SELECT pg_get_userbyid(typowner) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='kl') s")"
echo "E10 | cada kl_* intenta leer pg_authid | $(for r in $KL; do printf '%s:%s ' "$r" "$(run "$r" postgres -tAc 'SELECT count(*) FROM pg_authid' | grep -qi denied && echo denegado || echo PERMITIDO)"; done)"
( run kl_app postgres -c "select pg_sleep(12)" >/dev/null 2>&1 & ); sleep 3
echo "E11 | DROP DATABASE beeside_kl | $(sql 'DROP DATABASE beeside_kl')"
echo "E12 | pg_terminate_backend sobre sesión activa de kl_app | $(sql "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename='kl_app'")"
echo "E13a| GRANT CONNECT ON DATABASE beeside_kl TO $U | $(sql "GRANT CONNECT ON DATABASE beeside_kl TO $U")"
echo "E13b| GRANT CONNECT ... TO PUBLIC | $(sql 'GRANT CONNECT ON DATABASE beeside_kl TO PUBLIC')"
echo "E13c| ALTER DATABASE beeside_kl SET search_path=public | $(sql 'ALTER DATABASE beeside_kl SET search_path=public')"
echo "E14 | kl_* con super/createrole/createdb/miembro de cloudsqlsuperuser (debe ser 0) | $(scalar "$U" postgres "SELECT count(*) FROM pg_roles WHERE rolname LIKE 'kl\_%' AND (rolsuper OR rolcreaterole OR rolcreatedb OR pg_has_role(rolname,'cloudsqlsuperuser','MEMBER'))")"
echo "E15 | leer pg_authid (hashes) | $(sql 'SELECT count(*) FROM pg_authid')"
echo "--  | miembros de cloudsqlsuperuser (solo postgres y cloudsql*) | $(scalar "$U" postgres "select string_agg(member::regrole::text,', ' order by 1) from pg_auth_members where roleid='cloudsqlsuperuser'::regrole")"
