# Discovery v1.0 — P0/P1 traceability (G0 · G1 · status per item)

Branch: `feat/fa4-launch-config` (L1 CONVERGENCE: **PENDING** — coordinated by Architecture; nothing here touches `main`, `integration/*` or `prep/*`).
Source of truth for scope: `Discovery_Checklist_Maestro_v2.xlsx` + `HANDOFF_Discovery_Code_P1.md` (Cowork). Rule: no migrations, no shared platform files, no change to `fa4-precision-context/1`, Precision, KL, common auth, Control Center, infra, `main`/L1.

## G0 — branch gate (PASS, 2026-10-21)
Deployed source = `feat/fa4-launch-config @ ba20f85` (web/backend/worker digests `f90e3ec5…`, `07a81e02…`; build `08394b97…`; tarball content == `git archive ba20f85`). Implementation continues on this branch.

## How "shared" is read in G1
`shared/fa-public-engine` is **Discovery's own engine package** ("FA Public v1.0"; its only consumers on this line are `backend/src/fa4`, `frontend/src/fa4` and Discovery scripts). It is NOT treated as a shared platform file, **but** these paths are never touched in this batch because they are the Question Bank / schema / contract: `src/precision/**`, `src/domain/**`, `src/catalog/**`, `src/engine/{resolve,frontRules,flow-question-logic}`. Anything under `shared/canonical-fields`, `backend/src/{fa,precision,admin}/**`, `infra/**`, `backend/db/migrations/**` is out of bounds. Touched paths inside `shared/fa-public-engine` are listed per item so Architecture can see them for the L1 convergence.

## G1 — pre-flight per item

Legend: Disc = Discovery-only files · Shared = shared platform files · QB = Question Bank / engine logic · Pers = persistence · YEV · Ctr = `fa4-precision-context/1` · BE = backend · FE = frontend · Arch = architecture dependency.

### P0
| ID | Files to modify | Disc | Shared | QB / engine | Pers | YEV | Ctr | BE | FE | Arch |
|---|---|---|---|---|---|---|---|---|---|---|
| DSC-01 | `frontend/src/fa4/api.ts`, `Fa4App.tsx`, `components/steps.tsx` (CompanyStep); `shared/fa-public-engine/src/engine/yev.ts` (subtitle only); `backend/src/fa4/routes.ts` (cache headers); tests | YES | NO (Disc-owned engine pkg, presentation only) | none (no question / id / rule) | none (no schema, no migration; hidden company fields are no longer carried) | subtitle: declared-only guard + «Tu empresa: …» label | no schema/payload change | `Cache-Control: no-store` on GET session | idle-bound resume of the tab session; company fields cleared on «No» | NO |
| DSC-02 | `backend/src/fa4/routes.ts` (distinct code for a recipient-policy refusal), `frontend` error mapping (with DSC-33); tests | YES | NO | none | none | none | none | refusal code instead of a generic 502 | message mapping | NO |
| DSC-03 | none (revalidation: tests + real-URL smoke) | YES | NO | none | none | none | none | none | none | NO |
| DSC-34 | none (read-only inventory → this doc) | YES | NO | none | none | none | none | none | none | NO (contract status reported, not changed) |

### P1 authorised (pass G1)
| ID | Files to modify | Disc | Shared | QB / engine | Pers | YEV | Ctr | BE | FE | Arch |
|---|---|---|---|---|---|---|---|---|---|---|
| DSC-04 | `frontend/src/fa4/components/steps.tsx` (ReasonStep) | YES | NO | none (UI echo, not a QB question) | none (text still saved) | none | none | none | remove echo box | NO |
| DSC-05 | `components/steps.tsx` (ActivatorsStep list), `fa4.css` (`.qnum`) | YES | NO | none (numbering is UI structure, not QB text) | none | none | none | none | remove numbers | NO |
| DSC-06 | `frontend/src/fa4/copy/ui.ts` (stages[4], extraTitle, descr) | YES | NO | none (strings only; ids/logic unchanged; QB text not persisted/versioned in Discovery) | none | none | none | none | strings ES/EN | NO |
| DSC-07 | `copy/ui.ts` (heading), `components/YourExpansionView.tsx` (no reason text); `scripts/export-not-applicable-rules.*` (new, read-only inventory) | YES | NO | none (rules read, not changed) | none | heading + topics shown without reason until Product approves the table (model unchanged) | none | none | render | NO |
| DSC-08 | `copy/ui.ts`, `components/PremiumContinuation.tsx` | YES | NO | none | none | Premium block title/text | none | none | strings ES/EN | NO |
| DSC-10 | `components/BeesideValueSection.tsx` → comparison moved to `components/ValueComparison.tsx` (kept, not rendered, DSC-10 comment); tests | YES | NO | none | none | comparison not rendered | none | none | composition | NO |
| DSC-11 | `components/steps.tsx` (FrontsStatusStep / FrontsTableStep), `copy/ui.ts` (key removed) | YES | NO | none | none (no data change) | none | none | none | remove button + action | NO |
| DSC-28 | `components/steps.tsx` (ExtraStep) | YES | NO | none (field `context.personalNeed` already boolean) | none (same boolean; No = false) | none | none (existence only, unchanged) | none | Yes/No radio | NO |
| DSC-14 | `fa4.css` (stabilization modal) | YES | NO | none | none | none | none | none | CSS | NO |
| DSC-22 | `copy/ui.ts`, `components/steps.tsx` (ActivityStep help) | YES | NO | none (options unchanged) | none | none | none | none | help text | NO |
| DSC-23 | `components/steps.tsx` (IdentityStep role), `copy/ui.ts` | YES | NO | none | none | none | none | none | placeholder + help | NO |
| DSC-33 | `backend/src/fa4/routes.ts`, `frontend/src/fa4/api.ts`, `Fa4App.tsx`, `copy/ui.ts` | YES | NO | none | none | none | none | refusal code only for the recipient policy | message only for that code | NO — **applies**: DSC-02 shows the 20-oct failure was the recipient allowlist |

### Verifications (no code unless they fail; failures leave P1)
DSC-09, DSC-27 → run as tests/evidence, no files modified.

### Excluded from this batch
| ID | Reason |
|---|---|
| DSC-13 (+17), DSC-15, DSC-25a | **Design first** (spec not delivered). |
| DSC-18, DSC-16 | **Not authorised** until Product approves the design. |
| DSC-12 | **ARCHITECTURE DEPENDENCY** — Question Bank + engine + possible field in `fa4-precision-context/1`. |
| DSC-19, 20, 21, 25, 26 | **ARCHITECTURE DEPENDENCY** — new fields / persistence / contract / data type. |
| DSC-24, 29, 30, 31, 10b, 32 | Posterior / closed. |

## P0 — root cause and resolution

### DSC-01 · YEV with data the person did not declare in this session
**Evidence base.** Cloud Run request logs of `discovery-web` since the last deployment (2026-10-16 22:03 UTC), the code, and the tests below. The tester's two cases and the database rows of their projects were NOT available (the production database was not queried), so the exact YEV shown to them cannot be attributed field by field; what is established is **every path by which a value the person did not give in this visit can reach a YEV**, plus a proof that no path crosses between two projects.

**What the logs show.**
- 2026-10-20 00:58 UTC, Windows browser on a **different IP** than the earlier sessions: `GET /catalog`, `GET /session` (200), `GET /session/result` (404), then `PUT /session`… **with no `POST /sessions`**: that tab silently **resumed an earlier project** (token kept in the tab's `sessionStorage`; a restored/duplicated tab keeps it) and went on editing it with all its answers already filled in.
- 2026-10-20 19:44 UTC: four reloads in a row each resumed the delivered project of 15:50; a new project was created only at 19:48.
- No `GET /session` appears for any request that created a project: the server never returns a project to a token that is not its own.

**Root causes (all fixed, all tested).**
| # | Mechanism | Effect | Fix |
|---|---|---|---|
| M1 | The tab's working-session token is resumed on any reload, however old. | A tab that returns days later shows an earlier project's answers as if pre-filled («51–250 personas», countries, activity) and the next YEV is built from them. | `api.ts`: resume only while the visit is recent (**30 min of inactivity**, constant `RESUME_IDLE_MS`); an older token is dropped and the visit starts on the cover. The earlier project stays reachable through the e-mailed link. |
| M2 | Answering «No, the company is not operating» did not clear sector / size / operating countries typed before. | The YEV subtitle showed them, they were stored, and the operating countries fed the document-coverage rule («issuing country»). | FE clears them; backend `onlyDeclared()` drops them on create/save/resolution/preview; engine YEV shows company facts only when `hasExistingBusiness === true`. |
| M3 | A declared company size was printed bare in the subtitle. | Looked like a project fact. | Labelled «Tu empresa: …» / «Your company: …» (PO rule). |
| M4 | `GET /session` and `GET /session/result` had no cache headers. | No shared cache exists (CDN off, web tier `no-store`), but nothing forbade one. | `Cache-Control: no-store` on both. |

**Not a cause (checked).** No preselected value exists in the UI (all radios/fields start empty; fresh-profile test); no server-side cross-project path (the YEV is computed only from the answers stored for the token's project; CDN disabled on the backend service; web tier `no-store`).

**Provenance of every visible YEV datum** (field → question → class: D declared · V derived-valid by a deterministic rule from declared answers · C catalog data):
| YEV datum | Field(s) | Origin question | Class |
|---|---|---|---|
| Company name | `identity.company` | «Empresa» | D |
| Title / project paragraphs | `components[].activities,withWhat,presence,permanence,existing`, `destinations` | «¿Qué planeas hacer…», «¿Qué vas a vender…», «¿Cómo piensas estar presente…», «¿Permanente o temporal?», «¿Qué actividad o presencia tienes hoy…» | D (sentences = V) |
| Subtitle: sector · countries · size | `company.sector,operatesIn,size` (only if operating) | «¿A qué se dedica…?», «¿En qué países tiene hoy actividad…?», «¿Cuántas personas…?» | D — **M2/M3 fixed** |
| Key date | `externalDate` | «¿Hay una fecha límite…?» | D |
| Why now | `reasons`, `reasonText` | «¿Por qué quieres hacerlo y por qué ahora?» | D |
| Decided / still open | `decision`, `dependsOn`, `startWhen` | decision + start questions | D |
| Project size | `scale[].text` (proxy by D-149) | project-size question | D (proxy V) |
| Topics: applies / depends / not apply | rules in `frontRules.ts` over declared answers | activators + presence + activities | V |
| Value groups per need, coverage message | `resolve.ts` + published catalog `2026-10-04.v4` | declared needs + destination | V + C |
| Support values / kept in-house / success | `supportValues`, `keepWords`, `context.success` | «Algo más» block | D |
| Premium shown | `resolution.premiumShown` | derived from value | V |
Classes «mal inferido» and «contaminado» before this fix: M2 (stale company facts) and M1 (previous visit's answers). None remains.

**Regression tests.** Engine `provenance.test.ts` (remove a declared fact → it disappears from the YEV; a «No» with stale facts leaks nothing; a session generated after another contains none of its markers). Backend integration (real DB): two projects at the same time each see only their own answers and YEV; another/malformed token opens nothing; `no-store`; «No» drops the facts in storage, result and coverage input. Frontend: idle-bound resume, clean start on the cover, company fields cleared. Browser: tab returning after 31 min starts clean with empty fields.
**Pending evidence (needs deployment + the tester's two cases):** before/after on the real URL.

### DSC-02 · YEV e-mail failure
- 2026-10-20 15:50:36 UTC `POST /session/result/email` → 502 `EMAIL_NOT_SENT`. **The worker logged no cycle with `sent`, `failed` or `dead` that day**: no SMTP attempt was made. The only ERROR/5xx in the whole period 10-17…10-21 is this request.
- Code path: in closed-test mode `closedTestRecipientAllowed()` refuses a recipient outside the allowed domains/addresses → the delivery is CANCELLED without sending, and `settle` mapped every non-sent state to the same 502.
- **Cause: recipient allowlist (policy), not SMTP / worker / backend.** The reviewers' addresses had not been configured (allowlist supports them since 10-16).
- Corrections: the refusal is now `403 RECIPIENT_NOT_AUTHORIZED` (own code, address never echoed, not a 5xx → it no longer raises the 5xx alert); SMTP/other failures keep `502 EMAIL_NOT_SENT` with the real state (tests for both paths). The result stays delivered (D-156).
- **Real send on the deployed digest (2026-10-21 02:08 UTC):** four `POST /session/result/email` → 200 followed by worker cycles `{"sent":1,"failed":0,"dead":0}`; 0 ERROR/5xx in ±15 min. Delivery to the real mailbox (`contact+smoke-…@beeside.you`) is confirmed by SMTP acceptance (`state: sent`); a **received-mail screenshot needs mailbox access** (not available to Code).
- Limit: the `fa4_email_delivery` row itself was not queried (database not accessed); status/recipient of the 10-20 attempt is inferred from logs + code.

### DSC-03 · revalidation (no code change) — BEFORE the deployment of this batch
Real URL, deployed digest `ba20f85`, 2026-10-21 01:57 and 02:08 UTC (`frontend/e2e-production`):
| Element | Result |
|---|---|
| Heading «Cuéntanos un poco sobre ti.» (+ «Sin cuenta ni contraseña.») | ✓ |
| Required answers (message, focus, aria-invalid, no advance) | ✓ |
| Country vs «Aún no lo tengo decidido» (exclusive) | ✓ |
| Question #34 exactly once (ES, EN) | ✓ |
| «En tus palabras (opcional)» absent (ES, EN) | ✓ |
| Stabilization modal (button size, confirmation) · personal-e-mail warning (ES/EN) | ✓ |
| Allowlist (domain + address mechanism) · closedTest (`/config.json`) · noindex · gate closed (401 without credentials) | ✓ |
| Edge: certificate, http→https, `/ops-control` 404, legacy routes absent | ✓ |
| Full journey with real SMTP (4 sends) | ✓ |
Totals: 16 passed, 10 skipped by design (viewport-specific), 0 failed. **After** table: pending the deployment.

### DSC-34 · runtime inventory → `docs/fa4/DSC34_RUNTIME_INVENTORY.md` (blockers B-1…B-5).

## Verifications
- **DSC-27 — PASS.** Normal path (6 screens) and shortcut path (7 screens): no question text repeats along either path (desktop + mobile); in the shortcut path unmarked topics appear under «No indicado» with its note; lists in `docs/fa4/visual/verifications/dsc27-*.json` (local).
- **DSC-09 — FAIL on one point (not fixed here, by rule).** Mexico: states per need, no coverage message, Premium offered with value ✓. Mexico + Chile + South Korea: states only under Mexico ✓, Premium offered because Mexico has value ✓. **Chile / South Korea: the «no active coverage» message appears TWICE per country** (once in «De un vistazo», once in the value block): obtained 4, expected 2 in the browser and in the unit test (`it.fails` records it). It is presentational (`YourExpansionView.tsx`: `GlanceCard` + `ValueBlock`), not an engine rule; fix proposed outside P1 (show it once). Screenshots: `docs/fa4/visual/verifications/dsc09-*.png`.

## Status per item
States: APPROVED → IMPLEMENTED → TESTED → INTEGRATED → DEPLOYED → FUNCTIONALLY VALIDATED → COMMERCIALLY READY. `INTEGRATED` = on the validated candidate branch (not main / L1). **DEPLOYED and FUNCTIONALLY VALIDATED are not marked in this round.** L1 CONVERGENCE: PENDING for every item.

| ID | APPROVED | IMPLEMENTED | TESTED | INTEGRATED | DEPLOYED | FUNC. VALIDATED | COMM. READY | Commit(s) | Notes |
|---|---|---|---|---|---|---|---|---|---|
| DSC-01 | ✓ | ✓ | ✓ | ✓ | – | – | – | `35a7d08` | before/after on real URL pending deployment |
| DSC-02 | ✓ | ✓ (code: refusal code) | ✓ | ✓ | – | – | – | `35a7d08` | cause = allowlist policy; real send evidenced on deployed digest; mailbox screenshot needs the PO |
| DSC-03 | ✓ | n/a | ✓ (before) | n/a | – | – | – | tests only | after-table pending |
| DSC-34 | ✓ | n/a (inventory) | n/a | n/a | – | – | – | docs | **blockers B-1…B-5** |
| DSC-04 | ✓ | ✓ | ✓ | ✓ | – | – | – | `e557890` | |
| DSC-05 | ✓ | ✓ | ✓ | ✓ | – | – | – | `e557890` | |
| DSC-06 | ✓ | ✓ | ✓ | ✓ | – | – | – | `3db4766` | |
| DSC-07 | ✓ | step 1 + heading, no reasons | ✓ | ✓ | – | – | – | `3db4766` | steps 2–3 wait for Product (inventory delivered) |
| DSC-08 | ✓ | ✓ | ✓ | ✓ | – | – | – | `3db4766` | |
| DSC-10 | ✓ | ✓ | ✓ | ✓ | – | – | – | `e557890` | component + tests kept |
| DSC-11 | ✓ | ✓ | ✓ | ✓ | – | – | – | `e557890` | |
| DSC-14 | ✓ | ✓ | ✓ | ✓ | – | – | – | `3db4766` | |
| DSC-22 | ✓ | ✓ | ✓ | ✓ | – | – | – | `3db4766` | |
| DSC-23 | ✓ | ✓ | ✓ | ✓ | – | – | – | `3db4766` | |
| DSC-28 | ✓ | ✓ | ✓ | ✓ | – | – | – | `3db4766` | boolean cannot tell «No» from empty: nothing is pre-selected after a reload |
| DSC-33 | ✓ (condition met by DSC-02) | ✓ | ✓ | ✓ | – | – | – | `35a7d08` | message only for `RECIPIENT_NOT_AUTHORIZED` |
| DSC-09 | ✓ | ✓ (`9b93672`) | ✓ | ✓ | – | – | – | `9b93672` | message once per country (value block); browser: MX / CL+KR / MX+CL+KR |
| DSC-27 | ✓ | n/a (verification) | PASS | n/a | – | – | – | tests | J-check PASS (`acb22aa`) |
| DSC-36 | ✓ | ✓ | ✓ | ✓ | – | – | – | `8996919` | 13 backend + 11 frontend + browser; L1: PENDING (DB role grants on convergence) |
| DSC-37 | ✓ | ✓ | ✓ | ✓ | – | – | – | `472820a` | help-v1; flags E/F OFF until DSC-36/38 validated; `contact=open` deep link still opens ContactDialog |
| DSC-38 / PD-39 | ✓ | ✓ | ✓ | ✓ | – | – | – | `acb22aa`, `472820a` | label «Correo electrónico»/«Email address»; cover dialog; timing measured, NOT fixed (see DISCOVERY_CODE_STAGE2_REPORT.md) |
| DSC-40 | ✓ | ✓ | ✓ | ✓ | – | – | – | `e2015f3` | hero SHA-1 verified; card fits at 375/768/1024/1440 |
| DSC-13, 15, 25a | ✓ | – | – | – | – | – | – | – | **Design first** |
| DSC-18, 16 | ✓ | – | – | – | – | – | – | – | **not authorised** |
| DSC-12, 19, 20, 21, 25, 26 | ✓ | – | – | – | – | – | – | – | **ARCHITECTURE DEPENDENCY** |

## Items to settle before the next build / deploy
1. **`docs/deployment/STABILIZATION_READINESS_CHECKPOINT.md`** (untracked, dated 2026-10-16 10:37, not authored in this batch). It answers a different question (Discovery vs Precision, the 50-migration schema, KL seed, Admin/OIDC, IAP) and concludes «READY: NO» with facts that predate the production deployment. Recommended destination: **hand it to Architecture as an input to the canonical decision log (PD-17 / convergence), outside the Discovery tree** (move, not delete). Until Product decides, the deploy script's clean-tree guard keeps refusing: it is NOT bypassed. Alternative: commit it with a «SUPERSEDED» header (adds stale statements to the PR).
2. **Build context.** The previous build uploaded `KnowledgeLayer/` and the untracked document in the Cloud Build tarball (not in the images: the Dockerfiles copy explicit paths). `deploy/production/deploy-production.sh` now builds from `git archive HEAD` (committed files only, verified: no `KnowledgeLayer/`, no untracked file, build inputs present). Discovery-owned file; no infrastructure or shared file changed; reviewable as its own commit.
