#!/usr/bin/env bash
# Seeds synthetic Discovery rows into the simulated legacy `discovery` DB as the runtime login (what the application does). No real data.
set -euo pipefail
PGPASSWORD=sim_migrate_password_00000 psql -qX -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5433 -U discovery_migrate -d discovery -c "INSERT INTO fa4_catalog_version (version, content) VALUES ('cat-1', '{\"synthetic\":true}') ON CONFLICT DO NOTHING"
export PGPASSWORD=sim_runtime_password_000000
psql -qX -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 5433 -U discovery_runtime -d discovery <<'SQL'
BEGIN;
INSERT INTO fa4_project (email, locale, step_key, answers, status)
SELECT 'tester'||g||'@beeside.you', CASE WHEN g%2=0 THEN 'es' ELSE 'en' END, 'S'||(g%5), jsonb_build_object('n', g, 'note', 'synthetic'), CASE WHEN g%3=0 THEN 'DELIVERED' ELSE 'IN_PROGRESS' END
FROM generate_series(1,54) g;
INSERT INTO fa4_result (project_id, catalog_version, model, rules_version, source_schema_version, source_snapshot, resolution_schema_version, resolution_snapshot)
SELECT project_id, 'cat-1', jsonb_build_object('email', email, 'k', 1), 'r1', 1, '{}', 1, '{}' FROM fa4_project WHERE status='DELIVERED';
INSERT INTO fa4_event (name, source, project_id, props) SELECT 'step_viewed', 'client', project_id, '{"x":1}' FROM fa4_project;
COMMIT;
SQL
psql -qXAt -h 127.0.0.1 -p 5433 -U discovery_runtime -d discovery -c "select 'projects',count(*) from fa4_project union all select 'results',count(*) from fa4_result union all select 'events',count(*) from fa4_event"
