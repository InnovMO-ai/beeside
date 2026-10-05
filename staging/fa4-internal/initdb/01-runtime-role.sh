#!/bin/sh
# Creates the LOGIN role the API uses. Migration 0014 makes it a member of beeside_runtime_role (SELECT/INSERT/UPDATE only, no DELETE).
set -e
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE ROLE beeside_runtime LOGIN PASSWORD '${RUNTIME_DB_PASSWORD}';
SQL
