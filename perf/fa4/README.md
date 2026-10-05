# FA4 load / concurrency tests

Reproducible, dependency-free (Node ≥ 20, `pg`, the engine fixtures). Not part of the production images or CI.

1. A disposable PostgreSQL with the migrations applied and a LOGIN role that is a member of `beeside_runtime_role` (the actual least-privilege role).
2. Harness server (real FA4 router + real PostgreSQL; email captured in memory, never sent; rate limits off because all virtual users share one address — they are covered by `backend/src/__integration__/fa4-verify.int.test.ts`):
   ```bash
   ulimit -n 20000
   PERF_DATABASE_URL=postgres://beeside_runtime:…@127.0.0.1:5432/db PERF_ADMIN_DATABASE_URL=postgres://owner@127.0.0.1:5432/db npx tsx perf/fa4/server.ts
   ```
   `PERF_POOL_MAX` (default 10 = the shipped `pg` default) sets the application pool size.
3. Driver:
   ```bash
   node perf/fa4/load.mjs --mode levels --levels 25,100,250,500,1000 --duration 45 --ramp 10      # realistic flows
   node perf/fa4/load.mjs --mode burst  --levels 50,100,250,500                                    # simultaneous result generation
   node perf/fa4/load.mjs --mode soak   --levels 150 --duration 1800                               # soak
   ```
Each virtual user: create project → autosave ×3 → server-side resolution ×2 (before/after a conditional change) → generate Your Expansion View → read it → re-deliver → "save for later" → captured mail → single-use resume link → replay refused.
Every user carries a unique marker in company, email and free text; client-side checks and a final PostgreSQL pass assert zero cross-project data (answers, results, tokens, mail recipient, Demand Signals, catalog version), unique `result_seq`, and report deadlocks / lock waits / peak connections / memory. Exit code 2 on any integrity violation.
