# ADR-001 · One canonical line: `main` (+ temporary `release/discovery-v1`)
Status: ACCEPTED by the Product Owner (2026-10-20). Supersedes the three long-lived lines.

- Discovery, Precision Center and Knowledge Layer are one backend and one image; three long-lived branches of it were the root cause of
  code ≠ deployed and of repeated reconciliation. `main` is the only development line. Work happens in short branches (≤ 3 days) merged by PR.
- `release/discovery-v1` starts at the commit running in Discovery production (ba20f85, verified in L0) and exists only for Discovery hotfixes,
  without migrations, until the cutover to `beeside`. Every hotfix is forward-ported to `main`.
- `integration/reconcile-discovery-precision`, `feat/fa4-launch-config`, `prep/*`, `feature/shared-db-*` and `feat/kl-1.0-code` are contained in
  `main` after L1; they are retired by authorized batches (their SHAs live in `main`, the manifest and the verified bundle). No `archive/` branches.
- Rollback of `main` is a revert PR (`git revert -m 1 <merge>`), never force-push or history rewrite.
