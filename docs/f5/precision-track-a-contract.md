# Precision Track A — build contract (F5, 9 Oct 2026)

Audience: the engineers/agents building the Embassy Release Candidate. Authority order: PO instructions → Build Readiness
(`docs/f5/source/build-readiness.md`, closure of 9 Oct: B1–B5 and D-1…D-11 CLOSED) → Voice Guide v1.1 (`docs/f5/source/voice-pack.md` + §Voice v1.1 below) → this file.
Anything in the sources marked SUPERSEDED / DO NOT BUILD (Build Readiness §N) must not appear. AFP / beta / FA 3.0 push path is historical reference only.

## 0. Non-negotiables (customer surfaces)

* Never show: MOCK, STUB, SIMULATOR, SANDBOX, SIMULATED, raw error codes (BV409…), JSON, `new:<slug>`, `_generic`, `CONTEXT_ONLY`, PSM/MSM/OH/PbyC/PA/FA, "reopen", version numbers, "Discovery" as a label, "Out of Scope" labels, "Unmapped", person names tied to corporate structure, provider names, Sherpa before an assigned one.
* Canonical terms (EN, never translated): Precision Center, Precision Understanding ("Understanding" only in reduced navigation), My Service Map, Precision by Category, Category Requirement Pack (CRP), Add a Service, Operation Hub. First mention of the CRP is spelled "Category Requirement Pack (CRP)"; afterwards "CRP" only. Every other term is always written in full.
* Voice (ES: tuteo, professional; EN: second person): one question per turn, no exclamation marks/emojis/colloquialisms, no quality judgments ("ready/validated/excellent"), never re-ask known facts, "not mapped" ≠ "out of scope". Spanish "listo/lista" is forbidden by lint R7 except where an exact exception is registered.
* AI disclosure once, in the first Precision Understanding assistant turn, exact copy:
  ES "Precision usa inteligencia artificial para ayudarte a estructurar tu proyecto. Si algo de lo que entiende no es correcto, puedes corregirlo en cualquier momento." /
  EN "Precision uses artificial intelligence to help structure your project. If anything it understands is not correct, you can correct it at any time."
* No percentage anywhere in Understanding. Category progress is a deterministic percentage; criticality never weights it.
* No payment, checkout or payment-state gating in Precision. Entitlement is read through `EntitlementProvider` only.
* Documents: no upload UI, no attachments, no "Supporting Documents" section in the CRP. "Information required later" is operational context only.
* Honest copy: no invented integrations, SLAs, coverage, providers, response times, legal claims by country without an approved source (R10 → "I can't confirm that" + a pending item).

## 1. Module boundaries (backend `backend/src/precision/`)

| Dir | Owner | Contents |
|---|---|---|
| `manifest/` | ENGINE | `types.ts` (given), `effective-fields.ts` (moved from `manifest.ts`; keep `../manifest` import path working via `manifest/index.ts` re-exports and fix existing imports), AST (`ast.ts`), validator (`validator.ts`), `readiness.ts` (`evaluateCategory`), `crp-content.ts`, `materiality.ts`, `classifier.ts`, `registry.ts` (DB-backed loader), `data/*.json` (the 8 authored manifests + `_generic` + `project_manifest_v2`), `publish.ts` (idempotent publish into `project_manifest_version`/`category_manifest_version`) |
| `conversation/` | CONV | prompts, ports (`ModelProvider`, `ConversationStore`), `process-knowledge/` (pack, term registry, pre-router), `verifiers/` (R1–R4, R7, R9, R10, voice lint), `turn-engine.ts`, `copy/` (fixed ES/EN strings with stable `copy_key`s), `providers/{gateway-model.ts, scripted-model.ts}` |
| `domain/` | DOMAIN | services over the DB: session/entry, center, service map (live + snapshot), categories, CRP lifecycle, preview/payload builder, send, add-a-service, analytics events, cover/config resolution, demo seed |
| `api/` | DOMAIN | `dto.ts` (mirror of `docs/f5/precision-dto.ts`), `router.ts`, auth middleware, error mapping |
| frontend `frontend/src/precision/` | FRONTEND | the whole client app (see §6) |

Rule: modules talk through the exported functions/ports named here. Nobody edits another owner's files; ask via the final report.
Existing code to reuse: `repository.ts`, `critical-decisions.ts` (AST base ops), `engine/{gateway,guard,extraction}.ts`, `ports/*`, `adapters/*`, `delivery/oh-delivery-service.ts`.

## 2. Data mapping

* Project identity: `project.project_id` (core table). Precision rows: `precision_instance` (scope `project` = Understanding, scope `category` = a workstream).
* Fact keys: `fact.field_key = "precision." + manifest field_key` (e.g. `precision.logistics_flows`). Project-level (Understanding) facts use the `pa_*` keys: `pa_project_objective`, `pa_destination_countries`, `pa_expansion_product_or_service`, `pa_operating_entity`, `pa_time_window`, `pa_confirmed_categories`, `pa_critical_decisions` (+ `pa_priority_notes`, optional). Every fact write goes through `recordFact` and is append-only/superseding.
* Inheritance: values from `FaContextRead` are shown for confirmation (`PREFILL_CONFIRM`): until the client confirms, the fact is not written as confirmed. Confirmation writes `provenance_stage = client_confirmed` with `source_pin_id` + `source_item_ref`. A correction writes `client_corrected`.
* Category selection: initial proposal = FA `needs[].capabilityId` mapped to categories by `capability_signals` in `project_manifest_v2` (SA/ED are reserved platform categories). Unknown capability ids are never errors (scenario classification).
* Category lifecycle (`category_assessment.lifecycle_status`): proposed → confirmed(=Not started in UI) → in_progress → completed. UI status: `not_started` | `in_progress` | `ready_for_review` (in_progress ∧ ready) | `confirmed` (completed) | `sent` (an `oh_delivery` delivered for the current pack). `completed` is reached only through `completeCategoryAssessment` at Confirm CRP, in the same transaction as the `crp_confirmation` insert.
* New version (client-initiated, after Confirm): `moveCategoryLifecycle(completed → in_progress)`; the confirmed pack and its confirmation stay current until a new pack is confirmed; send key uses the new pack version.
* My Service Map: live view = pure projection over facts + `category_assessment` rows; snapshot = `service_map_snapshot.content` (schema `psm.v1`, below) written by `precision_assessment_confirm()` / `precision_psm_new_version()`.
* `psm.v1` content: `{ schema:"psm.v1", project:{ objective, destinations[], timeWindow, productOrService, operatingEntity }, groups:[{ categoryKey, label, kind, items:[{ id, label, why, priority, timing, state }] }], openItems:[string], contextPinId, versions:{ catalog, crosswalk, contract, manifests:{[categoryKey]:version} } }`. Version numbers are stored, never shown.
* Pack content (`pack.content`): `{ schema:"crp.v1", categoryKey, crpKind, title, context[], sections[], pending[], requiredLater[], versions{…} }`; `pack.context_snapshot` = pointers (fact ids, pin id, manifest version, catalog/crosswalk/contract versions).
* Turns: `precision_turn` (client + assistant rows share `turn_key`). Client row is persisted first; assistant row after. Retrying with the same `turn_key`: if the assistant row exists return it; if only the client row exists reprocess once under a per-project advisory lock.
* Analytics: `precision_journey_event` via one helper `emitEvent(tx, name, key, projectId, props)` (`ON CONFLICT (event_key) DO NOTHING`); the 19 Precision events in Build Readiness §F with event 14 using `ready` (not 100 %).
* Config: `precision_config` keys `operation_hub_url`, `help_center_url`, `terms_url`, `privacy_url`, `analytics.resume_gap_minutes`, `return.stale_after_days`; missing → defined fallback (link hidden), never an error. Cover: `precision_cover_asset` (only `approved ∧ is_active` rows count), else global (`*`), else neutral composition.
* Access/Entitlement: `EntitlementProvider` (fixture|core). `FULL` → writes allowed; `READ_ONLY` → reads only (writes `PRECISION_READ_ONLY` 403); `REVOKED` → 403 on everything except `/entry`.

## 3. Readiness rules (frozen, engine implements)

* Required := `requirement_level ∈ {blocking, required, conditional}` and applicable (`applicability_rule` null or true; country overlays add/modify/deactivate via `effectiveFieldsMulti`). Optional (`supporting`, `informational`) never count.
* Confirmed := `ANSWERED | EXPLICIT_NO | ZERO`. `UNKNOWN`, `WITHHELD`, `ASSUMED`, `NOT_ASKED` are not confirmed. A `repeatable_group` is ONE requirement, confirmed when `min_items` is met and every entered item has its required applicable sub-fields confirmed.
* `progressPct = floor(100 * confirmed / total)`; `total = 0` → `null` and `ready = false`.
* `ready := blockingGaps == []`: no applicable `blocking` field unresolved (UNKNOWN/WITHHELD/NOT_ASKED are gaps for blocking; ASSUMED counts as resolved), no unresolved `gates=blocking` critical decision (AST), no unacknowledged blocking contradiction. Pending (non-blocking) information never blocks and is always listed. `ready` ⟂ `progressPct` (G-C2: 100 % with an open decision is `ready=false`; 60 % can be `ready=true`).
* `field_asked(x)` on a NOT_APPLICABLE field is vacuously true (G-C3). Add reachability tests per branch.
* Critical items = blocking field gaps ∪ unresolved blocking decisions; id = `decision_key` else `field_key`. Never weights progress.
* `nextFieldKey` is chosen by the server, not the model: unresolved blocking first, then manifest order of required/conditional gaps with answerState NOT_ASKED; fields answered UNKNOWN/WITHHELD are not re-asked until the final review; nothing left → null.
* CRP content: sections follow manifest order grouped by `section`/theme if present else by field order chunks; each requirement shows label, a human rendering of the value, state (Confirmed / Assumed / Pending / Not applicable) and Execution Dependency mark; pending section lists all applicable required unconfirmed items; `operational_pending_items` become `requiredLater` lines (never a documents section).
* Materiality (for Add a Service / structural changes): `materialChanges` from the reference model (D11).
* Classifier order for Add a Service: out_of_scope → strategic_advisory → ecosystem_development → known_service → unmapped_known_category → discovery.

## 4. Conversation rules (CONV)

* Per turn: ≤ 2 model calls (extract + write) when a model is used; deterministic server decides the target field; the model only phrases (voice-linted) and extracts structured values (existing `extractFields`, `guard`). Verifier failure → regenerate once → fixed-copy fallback question built from the manifest label (never block the client).
* `process_question` turns (P-01, P-02): pre-router → Process Knowledge facts + state flags → brief answer (≤ 3 sentences, no question inside) + resume line with the SAME pending question; no facts written, `answer_state` untouched, no progress change, no analytics `understanding_resumed`.
* Sherpa: before OH active & assigned never "tu/your Sherpa"; the role may be explained in general (Voice v1.1).
* AI failure/timeout: client turn persisted; response `ai_unavailable` + `retryable`; retry with same `turnKey` creates no duplicate effects.
* The model never decides readiness, progress, classification or what a CRP says. Facts are written only after validation (`coerceValue`) and, for inherited/PREFILL values, after explicit confirm.
* Providers are selected by `PRECISION_MODEL_PROVIDER = gateway | scripted` (default `scripted` unless gateway keys exist). `scripted` returns curated structured outputs matched deterministically on (surface, stage, normalized client text key) and is labeled SIMULATED in internal status. No `if demo` logic anywhere.

### Voice v1.1 (additions to v1)
(A) The Sherpa's role may be explained in general when asked; before a real assignment never "your Sherpa"/"contact your Sherpa", never imply assignment. (B) First relevant mention uses FULL NAME (ACRONYM); afterwards the acronym only if public (today only CRP); no internal acronyms.

## 5. API behaviour (DOMAIN)

Routes and DTOs: `docs/f5/precision-dto.ts` (`PRECISION_ROUTES`). Base `/api/precision`, JSON, `Authorization: Bearer <session>`; session via `POST /session/exchange {code}` (one-time `link` token → `session` token; both hashed sha256 at rest; the link alone never grants access; entitlement is evaluated on every request). Locale: header `X-Precision-Locale` (`en|es`), default = FA context locale. All writes are project-scoped by token; no project id in paths. Rate-limit via existing `RateLimiter`. Errors: `ApiErrorDto`; unknown errors → 500 generic `TEMPORARILY_UNAVAILABLE` copy, never internals. `GET /internal/status` requires header `X-Precision-Internal-Key` = env `PRECISION_INTERNAL_KEY` (absent env → 404) and returns `InternalStatusDto` (integration descriptors, dataset, build label) — never reachable from the customer UI.
Preview/send: single payload builder (whitelist) → `previewChecksum`; send rebuilds and compares (409 `PREVIEW_STALE`); delegates to `OhDeliveryService` (idempotency, retry, ledger); response never claims `sent` unless the port accepted + read-back matched; first-send-failed blocks other CRPs (`ACTIVATION_PENDING_RETRY_FIRST`). "Go to Operation Hub" hidden until first delivered; `pending_access` while not client_accessible; Contact my Sherpa only when OH active ∧ client accessible ∧ sherpa assigned.

## 6. Frontend (FRONTEND)

* Mounted at path `/precision` (main.tsx path boot, like `/fa4`, `/admin`); own folder `frontend/src/precision/`, own CSS tokens; lazy-loaded. Auth: URL fragment/param `?code=` exchanged once, token kept in memory + `sessionStorage` (try/catch), cleared on 401.
* Four experience types only: **Cover** (no sidebar) → **Precision Center** (sidebar) → **Conversational Workspace** (sidebar + thread + persistent message bar; used by Understanding, each category, Add a Service) → **Document view** (no sidebar; My Service Map, CRP review, Preview before Send, post-send). "By Category" is not a nav item: active categories are listed directly in the sidebar (only after My Service Map is confirmed). Pinned section only if the user pinned something (not built in RC → absent). Help always reachable ("Help Center", "Contact beeside").
* Visual language: AI-workspace (conversation-first), bi/tritone, premium editorial, no multicolor icons; brand #2E0879 / #7357C1 / #F1F1FA / #17181B, #FFDE59 only as status dot, no #B8860B; Poppins (titles) + Open Sans (text); serif only for Cover headline and product titles; official logo files only (project files "Logos Beeside 1.png", `hive_logo_*`), never redrawn. Night Shift dark theme from tokens. Mobile recomposes (drawer sidebar, bottom message bar). WCAG AA contrast, visible focus, keyboard, 44px touch targets, status never color-only.
* Waiting states (AI turns 7–11 s): client message appears immediately and is marked saved; progressive honest microcopy by elapsed time (no percentages, no promised durations); > 15 s "still working, your answer is saved"; failure → inline retry that reuses `turnKey`. Reload during processing resumes from server state.
* Strings: all in `frontend/src/precision/i18n/{en,es}.ts` with the same keys; server-supplied text is already localized. Locale switch EN/ES in the shell.
* A mock API (`frontend/src/precision/mock/`) implementing the DTO contract with realistic data is used for development, unit tests and screenshots; the real API replaces it by configuration (`VITE_PRECISION_API_MODE=mock|live`), never by branching UI logic. The mock must not ship in production bundles' customer path unless explicitly selected.

## 7. Demo project & route (script/fixture, not product behaviour)

Synthetic company "Northwind Foods Ltd" (fictional): specialty food exporter expanding to Mexico; FA context fixture with needs mapping to `logistics`, `international_trade_customs`, `corporate_legal_admin` (+ one `strategic_advisory` capability); entitlement fixture ACTIVE; OH simulator; model provider `scripted`. Route A–J: A company/project → B destination (MX) → C Premium active, Cover → D Center → E Understanding (scripted answers) → F My Service Map confirm → G Logistics category (scripted answers incl. one "not sure yet" pending) → H CRP review/Request changes/Confirm → I Preview → J Send → Sent + Go to Operation Hub pending-access notice. Seeding is an operational script (`npm run precision:seed-demo`), producing the same rows a real activation would.

## 8. Quality gates (every owner)

Typecheck strict; unit/integration tests added with the code; no `console.log` of client content; no secrets in code; i18n keys complete EN/ES; a11y checks (axe) for each screen; every claim in the final report backed by a command run.
