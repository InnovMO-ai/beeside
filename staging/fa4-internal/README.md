# FA Public v1.0 — internal staging

**Not a public launch.** A separate, reversible environment for the team to try FA Public v1.0 with test data.

| Property | How |
|---|---|
| Separate from production | own database (`fa4_staging`), own host/port; `FA4_ENV=staging` is **refused** when `APP_BASE_URL` is `beeside.you` / `www.beeside.you` |
| Not indexed, not linked | `ROBOTS_NOINDEX=true` → `X-Robots-Tag: noindex…` on every response and `/robots.txt` = `Disallow: /`; nothing links to it |
| Gated | `STAGING_BASIC_AUTH=user:password` in front of everything except `/health` (a same-origin HttpOnly cookie carries the login to the page's own API calls) |
| Test data only | visible strip on every screen (`STAGING_LABEL`); no real customers |
| No real email | `FA4_ENV=staging` ⇒ log transport only (links are printed so you can follow them) and inline delivery; no provider, no credentials |
| No Hive sharing | FA4 has no integration with The Hive; Demand Signals stay internal in `fa4_demand_signal` |
| Legal | Terms = the official page/version. Privacy = an explicit **TEST** placeholder (`STAGING-TEST-NOT-LEGAL`, page `/staging/privacy-test`) until `FA4_PRIVACY_VERSION` / `FA4_PRIVACY_URL` are provided. Public production keeps failing without them |
| Least privilege | the API connects as `beeside_runtime` (member of `beeside_runtime_role`: no DELETE, no UPDATE on append-only tables) |

## Run (Docker)
```bash
cd staging/fa4-internal
cp .env.example .env        # set passwords, STAGING_BASE_URL, STAGING_BASIC_AUTH
docker compose up -d --build
# open STAGING_BASE_URL/fa4  (basic-auth user/password from .env)
docker compose logs -f backend | grep "email:log"     # emails (masked recipient + link) as they would be sent
docker compose down -v      # remove everything (containers, volume, data)
```

## Run without Docker (any machine with Node 20 + PostgreSQL 16)
```bash
npm ci && npm run build
# owner connection for migrations, runtime login for the API (see initdb/01-runtime-role.sh)
(cd backend && DATABASE_URL=postgres://owner@host/fa4_staging npx drizzle-kit migrate)
DATABASE_URL=postgres://owner@host/fa4_staging node backend/dist/scripts/seed-fa4-catalog.js
NODE_ENV=staging FA4_ENV=staging FA4_API_ENABLED=true APP_BASE_URL=http://localhost:8080 PORT=8081 \
  DATABASE_URL=postgres://beeside_runtime:…@host/fa4_staging node backend/dist/index.js &
VITE_FA4_ENV_LABEL="STAGING INTERNO · datos de prueba" npm run build --workspace=frontend
cd frontend && API_UPSTREAM_URL=http://localhost:8081 ROBOTS_NOINDEX=true STAGING_BASIC_AUTH=tester:pw STAGING_TEST_LEGAL=true PORT=8080 node server/static-server.mjs   # serve ./dist
```

## What to try
Journeys A (simple), B (multi-country, cargo route) and C (shortcut "mark what you need"), in ES and EN, at phone and desktop widths; save-for-later and resume link (single-use); Your Expansion View → BeesideValueSection → Premium continuation / email-the-result; the early exit for "no existing business".
