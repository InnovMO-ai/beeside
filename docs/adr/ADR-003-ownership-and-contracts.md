# ADR-003 · Ownership by domain, versioned contracts
Status: ACCEPTED (2026-10-20).

- Architecture owns shared resources: `.github/`, `backend/db/migrations/`, `backend/src/index.ts`, `admin-router.ts`, Dockerfiles, package
  manifests/lockfile, `deploy/`, `infra/`, `scripts/ci/`, `docs/adr/`. Changes need transversal review and the contract tests.
- Knowledge Layer publishes `kl.v1`; Precision consumes it. The embedded `backend/src/knowledge-layer` module is a transitional dependency,
  retired when KL delivers M3 (port I4, AC-11, A01) and its data is migrated. No new features are built on it.
- `fa4-precision-context/1` (Discovery → Precision) stays backward compatible; `continuity-bridge` and `discovery-real` are its contract tests.
- No conversation instructs another domain directly; cross-domain changes go through an ADR or a reviewed PR.
