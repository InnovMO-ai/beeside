# Track C — ClickUp / Operation Hub: status

**Status label: IN BUILD — adapter contract-tested against a faithful fake; SANDBOX not verified.**

Nothing in this track has been run against real ClickUp. There were no credentials. Everything "proven" below is proven against a
local fake that encodes our reading of the ClickUp documentation. Real delivery stays disabled (`PRECISION_OH_PROVIDER=simulator`)
until the sandbox script in section 6 has been run by the Product Owner and every row is PASS or has been hand-verified.

Branch `feature/f5-clickup` (from the F5 integration branch). Commit SHAs are listed in the hand-off message.

## 1. What was built

| Piece | File |
|---|---|
| ClickUp adapter (`ClickUpOperationHub`, `clickUpConfigFromEnv`) | `backend/src/precision/adapters/clickup-operation-hub.ts` |
| Local fake ClickUp server (node `http`, scriptable faults) | `backend/src/precision/adapters/clickup-fake-server.ts` |
| Test harness (fake + adapter, sync construction) | `backend/src/__tests__/helpers/clickup-harness.ts` |
| Adapter tests incl. the shared conformance suite | `backend/src/precision/adapters/clickup-operation-hub.test.ts` |
| `OhDeliveryService` (ledger, lock, read-back, first-send gate, UX state) | `backend/src/precision/delivery/oh-delivery-service.ts` |
| DB fixtures + DB-backed service tests | `backend/src/__tests__/helpers/precision-fixtures.ts`, `backend/src/__integration__/oh-delivery.int.test.ts` |
| Ledger migration: `attempt` column, one-delivered index, terminal-row guard | `backend/db/migrations/0021_*.sql`, `0022_*.sql` (+ drizzle meta), `backend/db/schema/precision.ts` |
| SQL tests C01-C07 | `backend/db/tests/precision/60_oh_delivery_attempts.sql` (included from `run_precision_tests.sql`) |
| Sandbox verification script (cannot be run here) | `backend/scripts/clickup-sandbox-verify.ts` |

Not changed: the port, the simulator, the conformance helper, `backend/src/premium/**`, the engine files, `frontend/`.
Additive only: new exports from the adapter module; one `\ir` line in `run_precision_tests.sql`; the `oh_delivery` columns/indexes in
`db/schema/precision.ts` (needed for `drizzle-kit generate`).

## 2. Architecture as implemented

```
Precision -> OhDeliveryService -> OperationHubPort -> ClickUpOperationHub -> ClickUp API v2
                 |  (ledger oh_delivery, lock, retry policy, read-back)      (all platform specifics live here)
```

Customer-visible sequence is unchanged: Confirm CRP -> Preview -> Send -> **Sent**. `Sent` (`state: "sent"`) is produced only when the
port returns an acceptance whose checksum equals `payloadChecksum(payload)`, or when an unknown outcome is resolved by a read-back
that finds the delivery with that checksum. Confirmed != Sent. Sherpa is never implied: `contactMySherpa` requires
`provisioned && clientAccessible && sherpaAssigned` from the port.

### 2.1 Mapping inside the adapter (divergences from contract v1.1 marked)

| Contract idea | Implemented | Divergence |
|---|---|---|
| Space = Operation Hub | Space = `CLICKUP_SPACE_ID` | none |
| company -> Folder | **no company container.** The company display name is part of the project Folder name | **yes** |
| project -> container | one Folder per project: `"<company> · P-<sha256(project_id)[0..12]>"`; found again by the `P-…` reference, never by full name | contract left the container type open |
| PSM -> "Project Overview" List | List `Project Overview` (configurable). The adapter creates one task per PSM version on the first CRP send (`oh-overview` tag) | adapter-created, not in the payload kinds |
| category workstream -> List named with the category label | List named `category_label` | none |
| CRP -> task | one task per delivery: `"<label> · CRP v<n>"` | none |
| (not in contract) idempotency | tags `oh-<sha256(key)[0..24]>` and `ohp-<sha256(project)[0..16]>` + marker block and canonical JSON body in the description | ClickUp has no idempotency header and no API to create Custom Fields |

Why flat, no company Folder: ClickUp's documented hierarchy is Workspace > Space > Folder > List > Task > Subtask, but the Create/Get
Folder pages show **sub-folders exist when the feature is enabled for the Workspace** (`parent_folder_id`, `parent_folder`). That is a
Workspace-level setting we cannot assume, so nesting is not relied on. If the Product Owner wants company -> project nesting and enables it,
it is a contained change in `ensureStructure` (decision requested, section 8).

### 2.2 How each risky property is achieved

* **Idempotent structure**: find-or-create of Folder and Lists; the Folder is found by its `P-…` reference (a human renaming the middle of
  the name does not break it); when two creators raced, every creator re-reads and picks the lowest id, so they converge. Cache is
  invalidated on 404. Per-project in-process mutex.
* **Idempotent task creation**: before creating, the adapter searches by project tag (one request gives identity check, existing delivery,
  overview presence), then by key tag, then scans the workstream list as a fallback (tags not applied / index lag). After an
  unknown-outcome create it re-polls (`lookupLagRetries` x `lookupLagDelayMs`) before creating again. After a create it reads the task
  back by id, recomputes the checksum from the **stored** body, and runs a duplicate sweep (oldest task wins; the adapter deletes only a
  duplicate it created itself).
* **Checksum**: the description is `beeside-oh/1 / key / checksum / kind / --- / canonical JSON (sent_at excluded)`. Read-back never
  trusts the marker checksum; it hashes the stored body. A mismatch deletes the adapter's own corrupt creation and fails with
  `CHECKSUM_MISMATCH`.
* **Timeouts**: per-request `AbortController` (default 15 s). A timeout on a write is `TIMEOUT` with `outcomeUnknown`.
* **Rate limits**: client-side pacing (default 90 req/min of ClickUp's 100); on 429 the wait is `Retry-After` if present, else
  `X-RateLimit-Reset` (a Unix timestamp per the docs); a wait beyond `maxRateLimitWaitMs` (30 s) fails fast with `RATE_LIMITED`.
* **Backoff**: whole-operation retry (lookup-before-create each time), bounded exponential backoff with full jitter, default 3 attempts.
  The service adds its own bounded attempts on top; both are small and capped.
* **Error mapping**: 401/403 -> `AUTH`; 429 -> `RATE_LIMITED`; 408 -> `TIMEOUT`; 5xx and network failures -> `UNAVAILABLE`
  (outcome unknown for writes except DNS/refused); 404 on the configured Workspace/Space -> `AUTH` (configuration), 404 on a
  List/Folder/Task resolved moments before -> `UNAVAILABLE` + cache reset (a human deleted it); 400/413/422 -> `REJECTED_VALIDATION`;
  409/423/425 -> `UNAVAILABLE`; other 4xx -> `UNKNOWN`. Messages carry the HTTP status and ClickUp `ECODE` only, never a body or the token.
  `IDENTITY_MISMATCH` is raised when the project already holds deliveries for another company id.
* **`accessState`**: `provisioned` comes from the platform (any delivered artifact task carries the project tag); `clientAccessible` and
  `sherpaAssigned` come **only** from an injected `accessSignal`, otherwise false. ClickUp's public API gives no reliable way for Precision
  to know whether a client was invited or a Sherpa assigned; those are Operation Hub processes. Sherpa is never reported without client access.

## 3. Ledger and service (migration 0021/0022)

The 0019 unique index `(idempotency_key, status)` allowed one `queued` and one `failed` row per key ever, so a user retry after a failure
violated it. Minimal additive fix, as the spec anticipated:

* `attempt integer NOT NULL DEFAULT 1`; unique `(idempotency_key, status, attempt)`; the old index is dropped (A17e still gets `23505`).
* partial unique `(idempotency_key) WHERE status='delivered'`: at most one delivered row per key, enforced by Postgres.
* `CHECK (status='delivered') = (oh_reference IS NOT NULL)`; `CHECK attempt >= 1`.
* guard trigger (0022): a `delivered`/`failed` row must close an existing `queued` row of the same key **and attempt** (`BV409`).
* rows are still never updated or deleted (trigger from 0020 unchanged).

`OhDeliveryService.send`: one transaction, `pg_advisory_xact_lock` per **project** (covers the key and the first-send gate), then:
delivered already -> return without calling the port; gate; `queued` row (attempt = max+1); `publish` with bounded attempts; unknown
outcome -> `verify` first; `delivered` row with a compact reference (`artifactId=…|locationId=…`, percent-encoded, no JSON) or `failed`
row with the taxonomy code. Client result carries only `clientCategory` (`try_again_later`, `needs_attention`, `first_send_required`) and
`canRetry`; the code lives in the ledger. `getSendState(projectId)` returns `{ firstSendDone, lastDelivery, ohAccess, ux }`.

Behavioural notes: (1) a send of a different CRP while the first has not succeeded, and a PSM send before provisioning, return
`state: "blocked"` and write **no** ledger row (nothing was attempted). (2) The advisory lock and the DB connection are held while the
platform is called; the port timeouts plus the bounded attempts make that finite (worst case roughly `3 attempts x (3 x 15 s + backoff)`
with default settings; lower `requestTimeoutMs` for production if that is too long). (3) `update_note` is rejected (not specified yet).
(4) Ledger `psm` deliveries map to payload kind `psm_update`; `crp` to `first_send` or `crp`.

## 4. Activation-gate matrix

Legend: **Fake** = proven in this repo against the local fake. **Real** = still to be proven against real ClickUp (script row in section 6).

| # | Criterion | Implemented as | Proven against the fake by | Remaining against real ClickUp |
|---|---|---|---|---|
| 1 | Acceptance response / ACK | `publish` resolves only after create + read-back by id + checksum; `acceptedAt` from the task's `date_created` | conformance "accepts a delivery…"; `oh-delivery.int` happy path | create response really contains `id`; `date_created` format; GET by id works (script rows 1) |
| 2 | Stable external reference | `reference = {artifactId=taskId, taskId, locationId="folder/list", secureReference=task url}` built from the task object; identical across publish/replay/verify | conformance idempotency + read-back; "second adapter instance"; restart tests | task object includes `list`/`folder`/`url`; id stable after rename/move (script row 2, one manual) |
| 3 | Idempotent creation | lookup-before-create (project tag, key tag, list scan), per-project mutex, canonical oldest task, own-duplicate deletion | simultaneous publishes -> 1 task; structure never duplicated; racing folder creators converge; duplicate sweep | tag creation on task create, tag search consistency, cross-process race window (script row 3) |
| 4 | Lookup / read-back | `verify(key)`: id hint -> key-tag search -> body parse; closed tasks included | conformance read-back; closed task still found; unknown key not found | team-task search `tags[]` semantics, `include_closed`, result contains `description` (script rows 4; closed task manual) |
| 5 | Checksum / payload verification | checksum recomputed from stored body; marker checked; mismatch -> `CHECKSUM_MISMATCH` + removal of own corrupt task | conformance corrupt; tampered stored body detected by `verify` and `publish` | **byte-exact round trip of the description** (unicode, quotes, backslashes, newlines, size) — the biggest unknown (script rows 5) |
| 6 | Duplicate Send protection | platform side: idempotent publish, different content under same key refused. Service side: delivered key never re-published; project advisory lock; partial unique index | conformance; `oh-delivery.int` double click, concurrent (one service, two instances); SQL C07 | platform-side rows 6 (service-side needs no ClickUp) |
| 7 | Retry behaviour | operation-level retry with exponential backoff + full jitter, bounded; service-level bounded attempts + user retry as new ledger attempt | 5xx x2 then success with expected delays; exhausted -> retryable error; service retry/attempt tests | real 5xx/429 behaviour; real `Retry-After`/reset headers (script row 7, optional burst) |
| 8 | Timeout behaviour | per-request abort; write timeout -> `TIMEOUT`+`outcomeUnknown`; next attempt looks up first with lag-aware polling | conformance timeout-after-store; slow response; retry self-heals; short lag; long lag documented | measure real search-after-write lag; confirm `lookupLagRetries x lookupLagDelayMs` exceeds it (script row 8) |
| 9 | Network interruption + error taxonomy | see 2.2 mapping; reset after send -> `UNAVAILABLE` unknown outcome -> recovered by lookup | conformance failure-mode block (unavailable, rate limit, reject, corrupt, auth); reset before/after store; wrong token; wrong space; ECONNREFUSED | real 401/403/404/400 bodies and `ECODE`s; a real 429 (script row 9; 400 shape manual) |

Overall: all nine are implemented and contract-tested; **none is verified on the real platform**.

## 5. Commands and results (this machine, 2026-10-09)

All from `backend/`. `export NO_PROXY= no_proxy=` before npm/npx. Scratch DB `beeside_clickup`, migrations 0000..0022 applied.

| Command | Result |
|---|---|
| `npx tsc --noEmit -p tsconfig.json` | clean |
| `npx jest` (whole unit suite) | 24 suites, 424 tests passed |
| `npx jest src/precision/adapters` | simulator 15 passed + clickup 48 passed (identical conformance block runs in both) |
| `TEST_DATABASE_URL=postgres://beeside:beeside@localhost:5432/beeside_clickup npx jest -c jest.integration.config.js oh-delivery` | 23 passed |
| `PGPASSWORD=beeside psql -X -h localhost -U beeside -d beeside_clickup -v ON_ERROR_STOP=1 -f db/tests/precision/run_precision_tests.sql` | passes, 102 `PASS` lines incl. A17 and new C01-C07 |
| `npx drizzle-kit check` / `generate` | "Everything's fine" / "No schema changes" |
| `CLICKUP_SANDBOX_SELFTEST=1 npx tsx scripts/clickup-sandbox-verify.ts` | script runs end to end against the **fake**: PASS 26, FAIL 0, MANUAL 3, SKIP 3 (proves the script, not ClickUp) |

Not run: anything against real ClickUp.

## 6. Sandbox verification (to be run by the Product Owner)

```
cd backend
CLICKUP_TOKEN=<test user personal token> CLICKUP_WORKSPACE_ID=<team id> CLICKUP_SPACE_ID=<test space id> \
CLICKUP_SANDBOX_CONFIRM=I_AM_USING_A_TEST_SPACE \
[CLICKUP_PRODUCTION_IDS=<comma list of production ids to refuse>] [CLICKUP_BURST=1] [CLICKUP_KEEP=1] \
npx tsx scripts/clickup-sandbox-verify.ts
```

It creates one project Folder with random ids, runs the nine criteria (including faults injected *around* real requests: synthetic 503s,
a response lost after a real write, a connection reset after a real write), prints a PASS/FAIL/MANUAL/SKIP table, measures the real
search-after-write lag, and deletes its folder/tasks unless `CLICKUP_KEEP=1`. Exit code 0 only when nothing FAILED; MANUAL/SKIP rows are
not evidence. It must be run **against a Space that is not production** (the confirm variable is mandatory; the production-id list is an
extra guard). It consumes some of the token's 100 req/min budget; it paces itself through the adapter.

Production wiring (after verification): `PRECISION_OH_PROVIDER=clickup` plus `CLICKUP_TOKEN`, `CLICKUP_WORKSPACE_ID`, `CLICKUP_SPACE_ID`,
optional `CLICKUP_API_BASE`, `CLICKUP_MODE=SANDBOX|REAL`, `CLICKUP_REQUEST_TIMEOUT_MS` (see `clickUpConfigFromEnv`). The provider
factory itself belongs to the integration track; `describe()` reports `REAL`/`SANDBOX` + `NOT_VERIFIED` until someone changes that after
the gate is passed.

## 7. ClickUp API facts

Verified by reading the ClickUp developer documentation during this work (fetched 2026-10-09):

| Fact | Source |
|---|---|
| Rate limit is per token: 100 req/min on Free/Unlimited/Business, 1,000 Business Plus, 10,000 Enterprise; HTTP 429 with `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` (Unix timestamp). **`Retry-After` is not documented** (the adapter honours it if present). | https://developer.clickup.com/docs/rate-limits |
| Create Task: `POST /api/v2/list/{list_id}/task`; `name` required; `description`, `markdown_content` (this page; the Tasks guide says `markdown_description`), `tags[]`, `status`, `custom_fields[]`, `parent`, etc. **No idempotency mechanism, no documented error codes, no documented response schema, no documented size limits.** | https://developer.clickup.com/reference/createtask , https://developer.clickup.com/docs/tasks |
| Update Task does not support custom fields; large lists/subtasks can make bodies large and time out; API v3 is in development to address this. | https://developer.clickup.com/docs/tasks |
| No endpoint to **create** a Custom Field exists in the Custom Fields reference (only Get List/Folder/Space/Workspace fields, Set and Remove value). | https://developer.clickup.com/reference/getfolderavailablefields |
| Get Tasks (list): `GET /api/v2/list/{list_id}/task`; zero-based `page`, 100 per page; closed tasks excluded unless `include_closed=true`; subtasks excluded unless `subtasks=true`; `archived`; `custom_fields` filter. | https://developer.clickup.com/reference/gettasks |
| Get Filtered Team Tasks: `GET /api/v2/team/{team_Id}/task`; `tags[]`, `space_ids[]`, `project_ids[]` (Folders), `list_ids[]`, `include_closed`, `page` (0-based), 100 per page. | https://developer.clickup.com/reference/getfilteredteamtasks |
| Get Folders: `GET /api/v2/space/{space_id}/folder?archived=`; sub-folders appear in the same flat list with `parent_folder`. Default of `archived` and response schema not documented. | https://developer.clickup.com/reference/getfolders |
| Create Folder: `POST /api/v2/space/{space_id}/folder` `{name, parent_folder_id?}`; sub-folders only if enabled for the Workspace; duplicate-name behaviour **not documented**. | https://developer.clickup.com/reference/createfolder |
| Create List: `POST /api/v2/folder/{folder_id}/list` `{name, content/markdown_content, …}`; duplicate-name behaviour **not documented**. | https://developer.clickup.com/reference/createlist |
| In API v2 a "team" is a Workspace (`/team/{team_id}`); v3 uses "workspaces". | https://developer.clickup.com/docs/general-v2-v3-api |

**ASSUMED (not confirmed from documentation; encoded in the fake; each is a script row or a manual check):**
`Authorization: <token>` header format for personal tokens; `GET /folder/{id}/list`, `GET/PUT/DELETE /task/{id}`, `DELETE /folder/{id}`
paths; response shapes (`folders[].lists[]`, task `tags:[{name}]`, `date_created` as millisecond string, `list`/`folder`/`url` on the task);
tags supplied on create are created automatically and lower-cased; `tags[]` with several values means AND; search results include
`description` and closed tasks; description round-trips byte-exact; search-after-write lag; maximum description length; Workspace
duplicate Folder/List names allowed (the fake allows it, the adapter tolerates it).

## 8. Open gaps, risks, and what is needed from the Product Owner

Risks (ordered):
1. **Description round trip** — if ClickUp normalises the stored body (whitespace, escaping, size cut), the read-back checksum fails and
   every delivery ends `CHECKSUM_MISMATCH`. Fallback if so: store the body as an attachment or in a text Custom Field and keep only the
   marker in the description. Needs the sandbox run.
2. **Search-after-write lag / tag behaviour** — if the lag exceeds the lookup window, a lost-response retry can create a duplicate (the
   test "lag longer than the lookup window" documents this; later lookups converge on the oldest task, but the ledger would hold the
   newer task's reference). The script measures the real lag; window is configurable.
3. **Cross-process race on first creation** — the mutex is per process. Two processes can still race; structure converges (lowest id),
   tasks are protected by the DB advisory lock at service level and by the duplicate sweep. Real ClickUp must confirm.
4. **Human edits in ClickUp** — deleting or renaming the project Folder's `P-…` reference breaks find-or-create (a new Folder would be
   created). Archived Folders/Lists are not returned by default and would be duplicated.
5. **Task presentation** — the task body is a canonical JSON block for machine verification, not a Sherpa-friendly view. A readable
   summary / Custom Fields / statuses are a product decision, not done.
6. **Rate budget** — a first send costs ~8-10 requests; sustained burst from many projects can approach 100/min on lower plans.
7. **Access state** — `clientAccessible`/`sherpaAssigned` have no ClickUp-side source; they stay false until a signal (e.g. an
   Operation Hub-owned flag, or guest/assignee data) is agreed and injected.
8. A DB connection and advisory lock are held during the platform call (section 3).

Needed from the Product Owner:
* A ClickUp **test Workspace + test Space ids and a personal API token** of a dedicated test user (plan matters: rate limit tier).
* Decision: flat project Folder (implemented) vs nested company -> project folders (requires sub-folders enabled on the Workspace).
* Decision: who and what makes `clientAccessible` and `sherpaAssigned` true (the signal), and whether clients are ClickUp guests.
* Decision: how a delivery task should look to a Sherpa (name, readable summary, statuses, assignment) and whether the PSM "Project
  Overview" task per PSM version is wanted.
* Run `scripts/clickup-sandbox-verify.ts` and send back the table; then the label can move to SANDBOX / VERIFIED.


## 9. Sherpa direct contact channel (Code stage 2, 13 Oct 2026)

`OhAccessState` gained an optional `sherpaContactEmail`: a direct channel to the assigned Sherpa, provided by the platform per project.
`ClickUpAccessSignal.sherpaContactEmail` passes it through (only with an accessible hub and an assigned Sherpa). Nothing is invented:
no default address exists anywhere. A deployment-level fallback can be configured with the `sherpa_contact_email` configuration row
(or `PRECISION_SHERPA_CONTACT_EMAIL`); it is unset today. Without a channel the Operation Hub block offers general "Contact beeside"
(`contact@beeside.you`); "Contact my Sherpa" appears only with a valid channel. **Product Owner decision pending (not blocking):** which
channel the real Operation Hub exposes for the Sherpa (per-project address from the hub, or one shared Sherpa desk address in configuration).
