#!/usr/bin/env bash
# Creates the LOCAL simulation cluster (PostgreSQL 16, port 5433, trust on the local socket, scram over TCP). Debian/Ubuntu postgresql-common. Local machine only.
set -euo pipefail
pg_lsclusters | grep -q " sim " || pg_createcluster 16 sim -p 5433 -- --auth-local=trust --auth-host=scram-sha-256
pg_lsclusters | grep -q "sim.*online" || pg_ctlcluster 16 sim start
echo "simulation cluster up on port 5433"
