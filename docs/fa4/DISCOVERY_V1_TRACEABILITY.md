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

## Status per item
States: APPROVED → IMPLEMENTED → TESTED → INTEGRATED → DEPLOYED → FUNCTIONALLY VALIDATED → COMMERCIALLY READY. **DEPLOYED / FUNCTIONALLY VALIDATED are not marked in this round.** L1 CONVERGENCE is a separate state (all PENDING).

(Updated below as each item lands — see the final report for commits and test evidence.)
