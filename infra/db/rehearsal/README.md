# Local rehearsal of the canonical database (no GCP)

Simulates the production Cloud SQL instance on a throw-away PostgreSQL 16 cluster (port 5433): a managed admin that is NOT a real superuser (`sqladmin`, member of
`cloudsqlsuperuser`), `discovery_migrate` / `discovery_runtime` as Cloud SQL API users, and the legacy `discovery` database at migration 24 with 54 synthetic projects.

    bash infra/db/rehearsal/create-cluster.sh
    npm run build --workspace=backend
    bash infra/db/rehearsal/rehearse-provision.sh   # plan, gates, PRE, migrate to 52, POST, 17-point isolation contract   (28 checks)
    bash infra/db/rehearsal/rehearse-cutover.sh     # data copy, reconcile, runtime permissions, privacy bypass, rollback, legacy hardening  (41 checks)

Everything is local and destructive only to the simulation cluster. Passwords are random per run and never printed.

## Rehearsal on a TEMPORARY Cloud SQL clone (requires written approval; see `RUNBOOK-clone-rehearsal.md`)

    bash infra/db/rehearsal/clone-rehearsal.sh plan                # prints the whole procedure; executes nothing
    RUN=1 bash infra/db/rehearsal/clone-rehearsal.sh preflight     # read-only
    RUN=1 APPROVAL=CLONE_REHEARSAL_APPROVED bash infra/db/rehearsal/clone-rehearsal.sh create|harden|mark|resize|teardown
    CLONE=discovery-db-rehearsal-<TAG> bash infra/db/rehearsal/rehearse-on-clone.sh   # SQL side; refuses any server without the marker role

The simulator is aligned with the production evidence of Part B Q13 (no creator-ADMIN row on `discovery_migrate`, legacy database owned by `cloudsqlsuperuser`).
`SIM_Q13=creator-row` restores the earlier hazard model (used as a negative control). `rehearse-on-clone.sh` is itself tested against this simulator (97/97).
