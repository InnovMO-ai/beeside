# Copy review, Precision Center V2.0 (F5, Track A)

Date: 2026-10-09. Owner: COPY and CONVERSATION-QUALITY. Scope: all customer-visible text in English and Spanish.

Result: zero unresolved CRITICAL or MAJOR copy issues in the repository text. Open items are listed in section 7 (decisions for the PO) and in `copy-issues.md` (code changes outside the copy scope).

## 1. Method

1. Authority order: PO mandate rules, `precision-track-a-contract.md` §0 and §4, `source/voice-pack.md` (v1 and v1.1), `source/build-readiness.md`, brand voice (serious, clear, warm senior advisor).
2. Static sweep: every customer-visible string was extracted and read in both languages. 945 backend items (copy entries, process-knowledge sentences, the question bank, and the label dictionaries of eight manifests, value labels, units and category labels) and 303 frontend dictionary pairs.
3. Route battery: the whole demo route (Understanding, Logistics with process questions, Strategic Advisory) was played in both languages with the real manifests and read turn by turn.
4. Both reviews are now automated so they keep protecting the text (section 5).

Severity scale. CRITICAL: breaks a hard rule (internal term shown, country-specific legal claim, promise, wrong fact). MAJOR: a customer would misread or doubt the text (wrong meaning, wrong register, mixed terminology, developer language, a bug that writes the wrong fact). MINOR: style, rhythm, consistency.

## 2. Findings and resolution

| Severity | Finding | Resolution |
|---|---|---|
| CRITICAL | Country-specific legal or customs claims in overlay and help texts of manifests (customs filing systems, a broker rule for one region, company-form names, "Mexican labor law requires...") | Neutralized to country-free wording (R10). A sweep rule now fails on any country or demonym next to a claim pattern, and on country names in overlay and help texts. |
| CRITICAL | A tax manifest framed an item as "due diligence" with a legal flavour | Reworded: "Tax review ahead of a transaction" / "Revisión fiscal previa a una operación". |
| CRITICAL | `pv.first` and `sent.body` implied beeside will start working after the send | Rewritten without any promise. |
| MAJOR | Default provider wrote the origin country into the destination ("Chile to Chile") and the same text into several free fields | Fixed in the provider with a lane-role and kind-exclusivity pass. Tests added, including a route test without the demo script. |
| MAJOR | Questions came from labels and read mechanically ("What can you tell me about services in scope for this workstream?") | Reviewed bilingual question bank for all authored fields, group intros and leads; a neutral wrapper for fields outside the bank. |
| MAJOR | Third-person wording about the customer in labels ("client confirmed...", "cliente") | Replaced with neutral labels. |
| MAJOR | Developer or consultant wording: "workstream", "frente de trabajo", "lanes", "on file", "reopen", "plain sight" | Replaced with plain words ("services", "flows", "recorded", "start a new version", "always visible"). |
| MAJOR | Bare "map" / "mapa" instead of the canonical name | "My Service Map" everywhere (backend copy, pack, frontend, both languages). |
| MAJOR | `add_service_not_available_yet` is reused for a request that cannot be added and says it is being included | New key `add_service_not_supported_now` added. The switch in code is item CI-1 of `copy-issues.md`. |
| MAJOR | Process questions about skipping, confidentiality or pausing were read as answers; in Spanish "¿Mi información es confidencial?" recorded a withheld fact | Router and pack extended (section 4). Nothing is written for these questions. |
| MAJOR | English "send" used as a noun in the pack ("between the preview and the send") | Reworded. |
| MAJOR | Spanish used "Estatus", "Timing", "Seniority" and English loan words in labels | Estado, Plazo / Horizonte de tiempo, Nivel de experiencia. |
| MAJOR | Acronyms without an introduction (VAT, IVA, SKU, EORI, FDA, IMSS, CPF, CFDI) | Glossed on first use in the label or help. |
| MAJOR | "Primera Evaluación" in some Spanish places, "FA" none | "First Assessment" kept in both languages everywhere. |
| MINOR | Acknowledgements repeated the same word every turn | Pools rotate by a stable hash; the value is echoed only when short and plain. |
| MINOR | Examples in the prompt used voseo or "Got it" | Tuteo and "Understood". |
| MINOR | `nav.understandingShort` abbreviated the canonical name; Help Center in Spanish | Full "Precision Understanding"; "Centro de ayuda". |
| MINOR | Machine-like phrasing in several pack sentences | Rewritten in the voice of the Voice Pack. |

String counts. Reviewed: 945 backend items plus 303 frontend pairs (about 2,500 individual strings in two languages) and the route transcripts. Changed: about 250 individual strings (about 150 manifest dictionary entries, 40 copy entries and pack sentences, 30 frontend dictionary entries, the rest question-bank and provider text). By severity: CRITICAL 3 groups (all fixed), MAJOR 12 groups (all fixed; CI-1 needs a one-line code switch), MINOR 4 groups (all fixed).

## 3. Decisions on terminology and voice

| Decision | EN | ES |
|---|---|---|
| Canonical names, never translated or shortened | Precision Center, Precision Understanding, My Service Map, Precision by Category, Category Requirement Pack (CRP), Add a Service, Operation Hub | Same names |
| CRP | "Category Requirement Pack (CRP)" on first mention, "CRP" after | Same |
| First Assessment | Kept | Kept in English ("First Assessment"), never "FA" |
| Partner | partner | socio |
| Services in scope | "Services in scope" (not workstream) | "Servicios en alcance" (not frente de trabajo) |
| Shipping lane | "Logistics flows" | "Flujos logísticos" |
| Status | Status | Estado (not Estatus) |
| Time | Timeframe / Time window | Plazo / Horizonte de tiempo |
| Experience | Seniority is not used; "Experience level" | Nivel de experiencia; "Sénior" |
| Pending | "Pending Information" | "Información pendiente" |
| Not mapped vs out of scope | Never merged | Never merged |
| Spanish register | Tuteo, professional. The words "listo/lista" are not used. | |
| Pallet unit | | "tarimas" |
| Resume line | "Back to where we left off." | "Retomamos donde nos quedamos." |

## 4. Process questions: pace and privacy (request from QA-LIVE)

Added to `process-knowledge/router.ts` and `pack.ts`:

- Skip / required: "Is it possible to skip a question?", "Can I skip this question?", "Do I have to answer everything?", "Is it mandatory to answer all of them?" and the Spanish equivalents route to the existing pending-information topic ("If you do not know something, we leave it as pending; you do not need to make up an answer...").
- Pause: "Can I stop and continue later?", "Can I pause and come back tomorrow?", "Can I finish this later?" and the Spanish equivalents route to the new topic `pause_and_resume` ("Yes, you decide when to continue and when to pause. What you have already answered is saved in your project, so you can pick it up again later."). Facts: voice pack pause note and Build Readiness L-7.
- Confidentiality and privacy: no approved fact exists, so these route to the honest "I can't confirm that detail" copy plus the pending question. They write nothing. This replaces the incorrect behaviour of recording a withheld fact.
- Test: `process-knowledge.test.ts` plays the five phrasings in each language on every surface and asserts a process-question turn, no facts written, the pending question resumed, and no critical verifier violation.

## 5. Automated protection added

| Test | What it protects |
|---|---|
| `conversation/__tests__/route-copy-quality.test.ts` (16 tests) | Plays the route in EN and ES: replies, no fallback question, verifiers, forbidden terms, no exclamation, emoji or placeholder, short sentences, one question per turn, no repeated sentence, no same-country lane. `PRINT_ROUTE=1` prints the transcript. |
| `conversation/__tests__/static-copy-sweep.test.ts` (10 tests) | Coverage above 900 items, placeholders, voice lint, canonical and internal terms, R10 claims, country names in overlay texts, third-person customer, question-mark parity, capital starts, jargon. |
| `conversation/__tests__/providers.test.ts` | Lane extraction and phrasing. |
| `frontend/src/precision/test/copy-quality.test.ts` (14 tests) | Same rules for the dictionaries, plus the registered glossary decisions. |
| `route-rehearsal.int.test.ts` | Plays the route without the demo script and checks "Origin country: Chile · Destination country: Mexico". |

## 6. Verification (2026-10-09)

- Backend `npx tsc --noEmit`: clean. `npx jest src/precision`: 29 suites, 1215 passed, 8 skipped (skips are pre-existing).
- Frontend `npx tsc --noEmit`: clean. `npx vitest run src/precision`: 5 files, 43 tests passed.
- Integration suites on a clean database, one at a time: access 18, journey 15, crp-lifecycle 15, crp-send 19, route-rehearsal 6, registry-publish 8, all passed. Two suites are not green and are not copy-related: `seed.int` ("reset starts a NEW project; the fixtures follow the newest one") and `reliability.int` (does not compile: line 205 passes two arguments to a helper that takes one). Both belong to QA-LIVE.

## 7. Decisions and approvals for the PO

1. Pack status. Process Knowledge topics are served as "draft". The new `pause_and_resume` topic and the reworded sentences need PO approval before they are marked "approved".
2. Privacy and confidentiality. The product answers "I can't confirm that" until the PO supplies an approved statement. A proposed sentence needs legal review before use.
3. Manifest hash. Label changes change the content hash of eight bundled manifests. If any manifest was already published to a shared environment, republish it.
4. Approved CCIR copy ("Favor de validar") was left as approved. It reads as an imperative to a third party; the PO may want to confirm it is intended for the customer.
5. Spanish keeps "First Assessment", "Operation Hub" and "Contact beeside" (Contactar a beeside) in the form the PO mandate gives. A Spanish name for First Assessment would be a PO decision.

## 8. Out of scope for this review

Visual layout, component states and accessibility labels outside `i18n/**` (QA-LIVE). Domain and legal facts: none were added or changed.
