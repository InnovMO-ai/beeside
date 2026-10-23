# ADR-002 · One migration chain, one migrator, per-database ceilings
Status: ACCEPTED (2026-10-20).

- Platform migrations live only in `backend/db/migrations` on `main`, numbered sequentially (next: 0054). KL's own chain (`KL-xxxx`, database
  `beeside_kl`) is separate and owned by KL.
- `db/migrations/migration-targets.json` declares, per database, the last migration it may receive: `discovery` (legacy) and `fa4_staging` stop
  at 0023; `beeside` is uncapped. `dist/scripts/migrate.js` refuses before applying anything if a build would exceed a ceiling, and in production
  refuses an undeclared database or a missing policy. There is no environment override; a ceiling changes only by reviewed commit.
- Schema changes are expand → migrate → contract: code N-1 must run on schema N; a contract step ships only after every consumer is upgraded.
- Recovery = verified on-demand backup + PITR restore to a clone; never restore over a live instance. Data reconciliation uses the existing
  domain-data-sync / erasure-reconcile tools.
