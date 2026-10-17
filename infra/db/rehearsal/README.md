# Local rehearsal of the canonical database (no GCP)

Simulates the production Cloud SQL instance on a throw-away PostgreSQL 16 cluster (port 5433): a managed admin that is NOT a real superuser (`sqladmin`, member of
`cloudsqlsuperuser`), `discovery_migrate` / `discovery_runtime` as Cloud SQL API users, and the legacy `discovery` database at migration 24 with 54 synthetic projects.

    bash infra/db/rehearsal/create-cluster.sh
    npm run build --workspace=backend
    bash infra/db/rehearsal/rehearse-provision.sh   # plan, gates, PRE, migrate to 52, POST, 17-point isolation contract   (28 checks)
    bash infra/db/rehearsal/rehearse-cutover.sh     # data copy, reconcile, runtime permissions, privacy bypass, rollback, legacy hardening  (41 checks)

Everything is local and destructive only to the simulation cluster. Passwords are random per run and never printed.
