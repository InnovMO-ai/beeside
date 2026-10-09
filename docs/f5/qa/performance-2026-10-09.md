# Precision Center V2.0 - Performance, live stack (2026-10-09)

Commit under test: `63f874866f9442cabac7870bb2b6a3e2292c745f` plus the uncommitted QA-LIVE changes of this day.
Machine: shared 8 GB Linux VM (the same VM runs Postgres, the backend, the static server and Chromium), Node 22, PostgreSQL 16, Chromium from `/opt/pw-browsers`.
Internal QA document. It says nothing about production capacity.

## What is and is not measured

| Layer | In the measurement | Not in the measurement |
|---|---|---|
| Frontend | production build (`VITE_PRECISION_API_MODE=live`) served by the production static server (CSP, headers, `/api` proxy) | CDN, TLS, real network between a client and the hosting |
| Backend | real Express app, real routers, manifests, conversation engine, delivery service | production hardware, horizontal scale |
| Database | real PostgreSQL 16 on the same machine | network latency to a managed database, a cold buffer cache |
| Model | scripted provider, in process (about 0 ms) | **provider latency of the real model: the dominant cost of a free-text turn in production and not measured here** |
| Operation Hub | simulator, in process (about 0 ms) | **real Operation Hub / ClickUp latency and its rate limits: Send time in production is dominated by them** |

Every figure below is therefore the cost of OUR code and database only. For a turn that needs the model and for Send, add the provider time; see "Provider-dependent parts".

## Method (exact)

Command, with the QA stack up (`PRECISION_LIVE_REUSE=1` reuses the running servers):

```
cd frontend
PRECISION_PERF=1 PRECISION_LIVE_REUSE=1 npx playwright test -c playwright.precision-live.config.ts perf --project=desktop-light
```

Spec: `frontend/e2e/precision-live/perf.live.spec.ts`. Raw output: `/tmp/precision-live/perf-results.json`. Each series is n runs; p50 and p95 are nearest-rank (with n = 5 or 6 the p95 is the maximum, read it as "worst seen").

* Page load, cold: a new browser context (empty HTTP cache, empty storage) opens the one-time link; time from `goto` until the first `h1` is visible. It includes the one-time code exchange and the entry request. n = 5.
* Page load, warm: `reload()` of the same context (HTTP cache primed, session restored from `sessionStorage`, no exchange). n = 5.
* Desktop: 1440x900, no throttling. Mobile: 390x844, touch, 2x, with Chromium DevTools throttling of 1.6 Mbit/s down, 750 kbit/s up, 150 ms round trip, CPU x4 slower.
* FCP / LCP: `PerformanceObserver` paint entries of the same load. Transfer: sum of `transferSize` of the navigation and its resources.
* Navigation: client-side clicks in the sidebar, time from click until the destination content is visible (data fetched and rendered). 6 rounds.
* Conversation: 3 fresh Logistics conversations of 17 turns (11 answers and 6 process questions) = 51 turns. Each turn is one `POST /categories/:id/turns`; the wall time of the complete HTTP request, measured by the client on the same machine, so it is server time plus a few ms of loopback. Every 4th turn goes straight to the backend port, the rest through the static server proxy.
* CRP view, category open, Center, Preview, Send, service map: API calls on 12 fresh projects at `logistics_ready`, through the proxy. Screen times in the browser: 4 fresh projects, desktop.

## Results

### Page load

| Scenario | p50 | worst of 5 | Notes |
|---|---|---|---|
| Desktop, cold, first content | 432 ms | 528 ms | 14 requests, 326 KB transferred |
| Desktop, warm reload | 386 ms | 518 ms | |
| Desktop FCP / LCP (cold) | 272 ms / 460 ms | 324 ms / 540 ms | |
| Mobile throttled, cold, first content | 2217 ms | 2276 ms | 9 requests, 285 KB; time is bandwidth bound |
| Mobile throttled, warm reload | 1173 ms | 1260 ms | |
| Mobile throttled FCP / LCP (cold) | 2140 ms | 2184 ms | |

### Navigation between screens (desktop)

| Step | p50 | worst of 6 |
|---|---|---|
| Center to Understanding | 134 ms | 379 ms (first one, loads the screen chunk) |
| Understanding to Center | 122 ms | 145 ms |
| Center to a category (Logistics) | 168 ms | 227 ms |
| Category to Center | 119 ms | 164 ms |

### Conversation round trip (51 turns)

| Series | n | p50 | p95 | max |
|---|---|---|---|---|
| All turns | 51 | 34 ms | 51 ms | 80 ms |
| Through the proxy | 39 | 34 ms | 52 ms | 80 ms |
| Straight to the backend | 12 | 32 ms | 51 ms | 51 ms |
| Answers (extraction + next question) | 33 | 36 ms | 51 ms | 52 ms |
| Process questions (no model call) | 18 | 27 ms | 80 ms | 80 ms |

The proxy adds no measurable time. Model time is zero here (scripted provider).

### CRP, category, Preview, Send (API round trips, n = 12)

| Call | p50 | p95 |
|---|---|---|
| `GET /center` | 13 ms | 35 ms |
| `GET /categories/:id` (category switch, data part) | 18 ms | 56 ms |
| `GET /categories/:id/crp` (CRP view) | 8 ms | 14 ms |
| `POST .../crp/confirm` | 15 ms | 33 ms |
| `GET .../preview` (Preview generation) | 11 ms | 18 ms |
| `POST .../send` (to the simulator, delivered) | 17 ms | 25 ms |
| `GET /service-map` | 14 ms | 22 ms |

### Screens in the browser (desktop, n = 4)

| Screen | p50 | worst |
|---|---|---|
| CRP screen from a page load (incl. code, session, chunk) | 276 ms | 352 ms |
| Preview screen after CRP confirm | 163 ms | 178 ms |
| Click Send until the Sent screen is visible | 268 ms | 340 ms |
| Sent to Center | 118 ms | 246 ms |

## Provider-dependent parts (not measured, stated honestly)

* A free-text answer needs one model call (extraction) and sometimes a second (wording check). With the real model the round trip is the provider's latency, in seconds, not milliseconds. The app already shows honest staged waiting copy and, after 15 s, a "your answer is saved" state (live error suite, `a long wait says the answer is saved`). A budget for the real model has to be measured with the real provider.
* Deterministic answers (quick replies, confirmation cards, process questions) make no model call: 27 to 36 ms here.
* Send: the delivery service retries up to 3 times with backoff and reads back after a timeout. With the simulator a normal send is 17 ms; a timeout-after-store case is resolved by the read-back (error suite: one delivery, Sent only after acceptance). Real Operation Hub time and rate limits are not represented.

## Hot spots checked

* Indexes: `fact(project_id)`, `precision_turn(scope...)`, `oh_delivery(project...)`, `precision_access_token(hash, project)` exist; no sequential scan problem seen at about 3,200 facts and 3,900 turns in the QA database.
* Transactions per request, counted from `pg_stat_database` around one request (includes pool and auth reads): Center 31, category open 23, CRP view 13, Preview 7, process question 15, answer turn 23.
* Manifest loads: the registry caches the published manifests per version; no repeated manifest load per turn found.
* Debt (not fixed, MINOR): `GET /center` evaluates each category separately, about 6 to 7 queries per category. With 4 categories that is 13 ms; with the full 17 categories expect roughly 4x the queries. Batch the per-category state loads before a project with many categories goes live.
* Rate limiting counters now live in PostgreSQL when only Precision is enabled (see the QA report, defect D-14), one small upsert per authenticated request.

## Observations on the bundle

First load on a throttled phone is bandwidth bound (about 285 KB, 2.2 s). Screens are code split; the first screen loads only the shell and its own chunk. No change proposed for the Embassy RC.
