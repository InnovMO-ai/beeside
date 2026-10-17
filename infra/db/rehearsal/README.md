# Local rehearsal of the canonical database (no GCP)

Simulates the production Cloud SQL instance on a throw-away PostgreSQL 16 cluster (port 5433): a managed admin that is NOT a real superuser (`sqladmin`, member of
`cloudsqlsuperuser`), `discovery_migrate` / `discovery_runtime` as Cloud SQL API users, and the legacy `discovery` database at migration 24 with 54 synthetic projects.

    bash infra/db/rehearsal/create-cluster.sh
    npm run build --workspace=backend
    bash infra/db/rehearsal/rehearse-provision.sh   # plan, gates, PRE, migrate to 54, POST, 17-point isolation contract   (27 checks)
    bash infra/db/rehearsal/rehearse-cutover.sh     # data copy, reconcile, runtime permissions, privacy bypass, rollback, legacy hardening  (150 checks: copy, reconcile, permissions, F1 guards, erasure propagation before/during/after the cutover, manifest, tombstone, optional legacy protection, rollback, hardening)

Everything is local and destructive only to the simulation cluster. Passwords are random per run and never printed.

## Rehearsal on a TEMPORARY Cloud SQL clone (requires written approval; see `RUNBOOK-clone-rehearsal.md`)

    bash infra/db/rehearsal/clone-rehearsal.sh plan                # prints the whole procedure; executes nothing
    RUN=1 bash infra/db/rehearsal/clone-rehearsal.sh preflight     # read-only
    RUN=1 APPROVAL=CLONE_REHEARSAL_APPROVED bash infra/db/rehearsal/clone-rehearsal.sh create|harden|mark|resize|teardown   # create = clone + immediate password rotation + network/TLS gate
    TAG=<tag> bash infra/db/rehearsal/rehearse-on-clone.sh   # SQL side; FIXED target (no host/port/db/dir/project variables), refuses any server without the marker role
    # both scripts STOP if PROJECT, REGION, SOURCE_INSTANCE, SOURCE, CLONE, ALLOW_OTHER_PROJECT, SQL_INSTANCE, PROXY_PORT or REHEARSAL_DIR is set

The simulator is aligned with the production evidence of Part B Q13 (no creator-ADMIN row on `discovery_migrate`, legacy database owned by `cloudsqlsuperuser`).
`rehearse-on-clone.sh` stops at the first critical failure and never continues into destructive steps (reverse reconciliation, legacy hardening, DROP DATABASE/ROLE): see RUNBOOK §5.1. Its privacy check runs the real `fa4_anonymize_project` and verifies the effects (RUNBOOK §5.2). F1 (migration 0052) and F2 (migration 0053 + `domain-erasure-reconcile` + the privacy gate of `domain-data-sync`) are part of the lineage: the run needs no proposed SQL (204/204 on the simulator, S6c rehearses the propagation and the rollback without reappearance). `REHEARSAL_APPLY_SQL` (simulator only) stays as a hook for defect-injection drills: with the pre-0052 guards the run HALTS at S4; without the tombstone it HALTS at S6c, before any DROP.
`SIM_Q13=creator-row` restores the earlier hazard model (used as a negative control). `rehearse-on-clone.sh` is itself tested against this simulator (204/204; REHEARSAL_SIMULATOR=1 REHEARSAL_DIR=<dir> selects the simulator on port 5433).
