# ADR-004 · Build once, promote the verified artifact
Status: ACCEPTED (2026-10-20); dev part implemented in L1, staging/production pipeline in L2.

- Dev deploys only `main`: the automatic path deploys the exact commit that passed CI (workflow_run.head_sha), never the moving head; only a
  push to this repository triggers it. Images are built once and addressed by digest; a post-deploy step compares each running revision's digest
  with the authorized one.
- Staging and production workflows refuse unless their GitHub environment declares `DEPLOY_TARGET_ENVIRONMENT`; they stay disabled until the
  promotion pipeline (same digest dev → staging → production, no rebuild) replaces them.
- Discovery production, until the cutover, deploys only from `release/discovery-v1` (deploy-production.sh refuses any other HEAD).
