# Admin — capability matrix (REQUIRED → IMPLEMENTED → TESTED → STILL MISSING)

Rule applied: an API that exists is not "Admin usable". A capability counts as usable only when an Admin user can do it from the Admin UI with the right role, and the audit records it.
Roles: SUPERVISOR (read) · ADMIN (`entitlement.manage`, config, operations) · SUPER_ADMIN (`entitlement.programs.manage`, `privacy.manage`).
Test legend: **BE** = backend integration (PostgreSQL, `entitlement-admin.int.test.ts`, `oh-delivery.int.test.ts`, …) · **UI** = frontend component tests with a mocked API (`admin.test.tsx`) · **E2E** = real browser against a real server (none yet).

| # | REQUIRED | IMPLEMENTED (API → UI) | TESTED | STILL MISSING |
|---|---|---|---|---|
| 1 | Premium status per project (mode, dates, why) | `GET /projects/:id/entitlement` → project tab **Access** (mode, effective dates, read-only window, privacy, covered-until) | BE, UI | – |
| 2 | Entitlement sources (paid / complimentary / sponsored / promotion / trial / manual) | Sources table with source, ref, dates, closed/open-ended | BE, UI | – |
| 3 | Individual grants, extensions, termination (reason, approver) | Issue / Extend / End now with reason; long grants need elevated approver | BE (role + rule refusals), UI | – |
| 4 | Sponsored programs and sponsors | Precision → **Programs & sponsors**: create sponsor/program, activate, close, redeem to a project, eligible companies | BE (end to end quota + eligibility), UI | Edit an existing program (only create/activate/close); redeem needs a typed project id (project search exists elsewhere) |
| 5 | Company-scoped grants | Company-level grant form in project tab (explicit scope + cap), SUPER_ADMIN only | BE (explicit/capped), UI | – |
| 5b | Pick companies without pasting ids | `GET /companies/search` → name/domain picker in program eligibility | BE, UI | – (closed in this round) |
| 6 | Privacy state (open / blocked / anonymized) overriding commerce | Shown in Access; block/unblock recorded by SUPER_ADMIN; `anonymized` only by executor | BE (privacy overrides any entitlement), UI | – |
| 7 | Deletion controls | Policy approval, dry run, typed-confirmation erasure, run history | BE, UI | The **internal retention period is undefined** (needs approved Privacy/Legal policy). Mechanism is governed and blocked until a policy version is approved; no duration is invented |
| 8 | Auditability | Every mutation audited (codes/counts only; never values, reasons, answers); `/audit` view | BE (audit contents asserted) | – |
| 9 | Configurable links / routes | Precision → **Links & routes**: effective value + source per language, versioned save, reset (resolution: Admin → env → default) | BE, UI | – |
| 10 | Precision statistics | Precision → **Statistics**: funnel, quality, AI, commercial, metric catalog incl. `awaiting_product_layer` | BE, UI | Metrics that depend on the core Precision product layer report 0/null by design until that layer exists |
| 11 | OH delivery visibility | Precision → **Operation Hub sends**: by status, attempts, error code (ids/codes only) | BE, UI | No Admin-side manual re-send of a failed Operation Hub delivery (retries are automatic and bounded). Not in the requirement list — decide if Product wants it |
| 12 | Role provisioning | People view provisions ADMIN/SUPERVISOR; privilege-escalation protection preserved | BE | People view cannot provision **SUPER_ADMIN** (API supports it with a SUPER_ADMIN principal; UI option not offered) |
| 13 | Browser-level proof | – | – | **No E2E** (UI tests use a mocked fetch). Needs a Playwright pass over the Admin against a seeded server |

## Verdict
Directionally Feature Complete for the required capabilities: every row 1–11 is usable from the UI by the right role and tested at API and component level. Not declared "Admin Feature Complete" yet because of: (a) no browser-level E2E, (b) SUPER_ADMIN provisioning not exposed in the UI, (c) program edit missing, (d) retention period pending a Privacy/Legal decision (a policy gap, not a code gap).
