# Copy issues that need a code change outside the copy scope

Owner of the wording: COPY. Owner of the fix: QA-LIVE / lead. Date: 2026-10-09.

The wording for each item is already in the repository. Only the code wiring is missing.

| Id | Severity | Where | Problem | Requested change |
|---|---|---|---|---|
| CI-1 | MAJOR | `backend/src/precision/domain/add-service.ts` (around line 140) | The out-of-scope notice reuses `add_service_not_available_yet`, whose text says the service is being included ("I am including it"). For a request that cannot be added, the customer is told the opposite of what happens. | Use the new copy key `add_service_not_supported_now` for the case where the request cannot be added. EN: "I cannot add this to your My Service Map right now. You can ask beeside about it through Contact beeside, or tell me about another need in your project." ES: "Por ahora no puedo agregar esto a tu My Service Map. Puedes consultarlo con beeside desde Contactar a beeside, o contarme otra necesidad de tu proyecto." Keep `add_service_not_available_yet` for the case where the service is being included. |
| CI-2 | MINOR | Provider wiring (`selectModelProvider`) | `DEMO_SCRIPT_FIXTURE` is no longer needed for the lane step; the scripted provider now separates origin from destination by itself. | DONE by QA-LIVE (2026-10-10): the fixture branch was removed from `wiring.ts`; the project fixture switch is now `PRECISION_FIXTURE_PROJECT`. |
| CI-3 | MINOR | Frontend components that show First Assessment objective text | In the Spanish run the objective and product text from the synthetic First Assessment appear in English (data, not translation). | None for production. For the demo, seed a Spanish synthetic objective if a fully Spanish run is wanted. |

## Test failures seen during the copy work that are not copy-related

These two integration tests failed after QA-LIVE changes. They do not touch text.

| Suite | Test | Observed |
|---|---|---|
| `seed.int` | "reset starts a NEW project; the fixtures follow the newest one" | Fails when the suite runs after other suites on the same database. |
| `reliability.int` | "a reader that throws..." | `/understanding` returns 500. |

QA-LIVE answer (2026-10-09): `reliability.int` was a real behaviour change, not a copy issue. The first Understanding opening now waits for the First Assessment context (it is not created without the inherited-value confirmation); the test was updated to expect `TEMPORARILY_UNAVAILABLE` on that first open and the full opening once the context is back. CI-1 is wired (`add-service.ts` now returns `add_service_not_supported_now` for an out-of-scope request). `seed.int`: see the QA report.

## Items added by QA-LIVE after the live runs (2026-10-09)

Each is a wording or content matter. Id, screen, locale, text, why.

| Id | Screen | Locale | Text | Why |
|---|---|---|---|---|
| CI-4 | Navigation, every screen with the sidebar | ES | "Add a Service" (menu entry) | Stays in English in the Spanish interface while "Ayuda" and the categories are translated. If it is a product name, confirm it; otherwise "Agregar un servicio". |
| CI-5 | Navigation, Center | ES | "Strategic Advisory" (category name) | The category is shown in English in the Spanish interface (other categories are Spanish). Confirm it is intended. |
| CI-6 | Navigation, product card | ES | "Packaged food products" under "Tu proyecto" | Data of the synthetic First Assessment, not UI copy (see CI-3). Listed so nobody reads it as a missing translation. |
| CI-7 | `manifest/data/category-labels.json`, field `note` | n/a | "...drafted for the Embassy Release Candidate..." | The word "Embassy" is the only remaining occurrence in the Precision product data and comments (grep of the whole product code is clean otherwise). It is an internal free-text note, never shown. Reword to "release candidate" when the file is next edited. DONE by QA-LIVE (2026-10-10); the security spec no longer tolerates the exception. |
| CI-8 | Category conversation, Spanish | ES | Question about confidentiality was recorded as "withheld" | FIXED by COPY after QA-LIVE reported it (regression test in `process.live.spec.ts`). Kept here as a reminder that "Is my information confidential?" has no approved answer: the product says it cannot confirm it. A real answer from legal/privacy is a content dependency before launch. |
| CI-9 | Understanding, after it is complete | EN, ES | Any off-topic or process question asked after the conversation is ready receives "I have what I need to put together your My Service Map..." | Acceptable, but for a client who asked "Can I skip this question?" there is no question left to skip. Consider one line of context ("There is nothing left to answer here.") when no question is pending. |
| CI-10 | Understanding, first question after a process question | EN, ES | The process answer is followed by the pending question as plain text and, for inherited values, the confirmation card again | Works as designed. Check with design that the card repeated under the answer is what Design Proof v3.3 shows. |

Not copy: after the router fix the live suite asserts the whole canonical list plus the phrasings above (`frontend/e2e/precision-live/process.live.spec.ts`).

## Items added by QA-LIVE after the acceptance pass (2026-10-10)

| Id | Screen | Locale | Text | Why |
|---|---|---|---|---|
| CI-11 | CRP document | EN, ES | Eyebrow "Category Requirement Pack (CRP)" and the title "Logistics - Category Requirement Pack (CRP)" both spell the name out | Two spellings on the first screenful. The eyebrow is enforced by `i18n.test.ts`, so it was left alone. Decide whether the title should say only "CRP" once the eyebrow has spelled it out. |
| CI-12 | Center and Sent | EN, ES | "We will let you know as soon as you can enter." | It promises a notification. No notification channel exists in this release candidate. Approved copy; the PO should confirm the promise is intended or approve a wording that does not promise it. EXTERNAL DEPENDENCY (the access path to Operation Hub). |
| CI-13 | Category CRP, after "Request changes" | EN | Lifecycle label after Request changes | The category stays at "For your review" with the CRP editable. `docs/f5/demo-route.md` calls it "In progress". Wording of the document or of the label to be aligned by the PO. |
