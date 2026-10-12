# PRE-CODE CONTENT & EXPERIENCE AUDIT (12 Oct 2026)

Scope: every customer-facing string that ships (frontend dictionary EN/ES, 1 336 manifest strings, 128 backend copy entries, Process Knowledge pack `pk-2026-10-12.1`), the configuration of legal / help / contact values, and a short functional hygiene check of the Embassy RC. No product, architecture or design decision was reopened.

## 1. Configuration applied (all from the configuration layer, never in UI components)

| Key | Value | Where it appears |
|---|---|---|
| `privacy_url` | https://beeside.you/PolíticaPrivacidad | Help → Información legal |
| `terms_url` | https://beeside.you/termsandconditions | Help → Información legal |
| `help_center_url` | https://beeside.you/HelpCenter | Help → Centro de ayuda |
| `contact_beeside_email` | contact@beeside.you | Every "Contact beeside" action (`mailto:`), link-error pages, send-failed page, access-ended page |
| `commercial_notices_url` | https://beeside.you/Policiescommercialnotices | Stored and served by config only; **not** exposed in navigation, Help or footer. No commercial-consent surface exists inside Precision, so it is not rendered anywhere |

Resolution order: database row (`precision_config`, per locale or `*`) > environment > shipped default; malformed values fall through to the next source. Precision adds no acceptance screen and no acceptance behaviour. A public rate-limited `GET /support` serves the contact email to pages shown before a session exists.

## 2. Findings and classification

| # | Finding | Class | Action |
|---|---|---|---|
| 1 | Contact beeside used a form posting to an endpoint with no mechanism behind it | MAJOR | Replaced by `mailto:` to the configured email; form and unused client method removed |
| 2 | Help had no privacy / terms / help-center destinations | MAJOR | Added from config |
| 3 | `revoked.body` and the draft entry `precision_access_ended` promised data recovery on re-subscription (no mechanism, no retention rule) | CONTENT → fixed | "To get back in, contact beeside." / "Para volver a entrar, contacta a beeside." |
| 4 | `center.title.sentAll` "up to date / al día" could read as complete / ready | MINOR → fixed | "Everything you started has been sent" / "Todo lo que iniciaste ya fue enviado" |
| 5 | "Shift and Enter" / "Mayús y Enter" | MINOR → fixed | "Shift + Enter" / "Mayús + Enter" |
| 6 | `errors.test.ts` still asserted the removed `contactUrl` | MINOR (test) | Updated |
| 7 | Three of the four approved URLs return "404 Página no encontrada" today (see 5) | CONFIG | Values kept as approved; PO action |
| 8 | Backend copy entries not referenced by any screen (50 draft, including legacy psm_/pbyc_/ccir_ wording) | CONTENT | Not shipped to the customer; list kept for the Code phase clean-up |
| 9 | Spanish uses "tarimas" for pallets; "Noted, no on that one" style | MINOR | Left as is |
| 11 | Top-bar link was labelled "Help Center" but opens the in-app Help page (label promised the external Help Center) | MAJOR (CTA/label) → fixed | Label is now "Help" / "Ayuda"; the external Help Center is its own link inside Help |
| 10 | The scripted harness flagged "Sherpa" in the P-02 process answer as "sherpa before assigned" | MINOR (scanner) | The answer defines Sherpa as a role in Operation Hub (approved); the scanner flags any mention |

## 3. Sweeps (results)

- Forbidden acronyms (PSM, MSM, OH, PbyC, PA, FA, FA3, AFP, CCIR): 0 customer-visible. "My Precision Service Map": 0. Version numbers, upload / documents / Supporting Documents, beta / sandbox / mock / stub / simulator / localhost / staging / placeholder: 0 in shipped strings.
- Notification promises ("avisaremos", "we will notify", "te notificaremos"): 0. One approved sentence in an unreferenced entry says "beeside or the provider will let you know" when a service later needs documents (Voice Guide v1.1, no timing).
- Sherpa: only the action label "Contact my Sherpa / Contactar a mi Sherpa", rendered only when the Operation Hub state says a Sherpa is assigned (`operationHub.contactSherpa`); the process answer defines the role.
- Percentage: only in Precision by Category and the category workspace header; none in Precision Understanding.
- Usted / voseo: 0. Missing accents (common-word scan): 0. Double spaces, space before punctuation: 0. ES/EN parity: 1 336 manifest pairs, 614 UI pairs, 0 unpaired; 22 identical pairs are the canonical product names.
- Country overlays (R10): US / MX / DE / SG overlays are status questions ("IMMEX program participation status", "Taxpayer registry status"), not legal assertions about a country; no unsupported country claim added.
- Process Knowledge: 23 approved topics read in full. Terminology, Voice Guide v1.1, brevity: consistent; confidentiality answer matches the approved text (EN equivalent: "Your project information is used to structure your expansion and is shared only when it is time to move into execution. Precision does not send Operation Hub the conversation history, email, people's names or documents; before you send a Category Requirement Pack (CRP), you can review exactly what information will be shared."); no absolute-confidentiality, privilege, encryption, residency or provider promise; no timing promise; Sherpa answered as a role, never "your Sherpa".
- Operation Hub access copy: "Your information has been sent to Operation Hub. Access will be available here once your workspace is enabled." / "Tu información fue enviada a Operation Hub. El acceso estará disponible aquí cuando tu espacio esté habilitado." (no notification, timing or assignment promise; "enabled" instead of "ready" because the copy linter forbids readiness claims).

## 4. UX semantics checked

Confirm never sends (copy and backend: separate transitions); Send requires an existing Preview (`pv.notReady`); a confirmed CRP shows "Read-only / Solo lectura" and offers only "Start a new version"; retry buttons say "Try again" and never show success styling; Pending Information is separate from failures; progress carries "captured, not an evaluation of your project"; "For your review" is not "complete"; "Sent" appears only after delivery acceptance (backend send tests); Operation Hub appears only after the first successful send; Add a Service exposes no internal classification; Possible New Service is not displayed as an error. Covered by the mock and live Playwright suites below.

## 5. Link and contact validation

| URL | Result on 12 Oct 2026 (browser load) |
|---|---|
| https://beeside.you/termsandconditions | Opens (title "Términos y condiciones \| beeside"). Observations on the page itself (not Precision): section 15 gives **info@beeside.you** as the contact, not contact@beeside.you; section 15 contains the placeholder "[20] días hábiles"; 14.1 ends "Código de Comercio,." |
| https://beeside.you/HelpCenter | 404 Página no encontrada (also lower case) |
| https://beeside.you/PolíticaPrivacidad (and percent-encoded) | 404 Página no encontrada |
| https://beeside.you/Policiescommercialnotices | 404 Página no encontrada |

No placeholder, localhost, dev or staging URL in any shipped customer string; the only non-beeside URL is the mock transport's Operation Hub address, used only when the app runs against the mock transport (tests and demo). Mail action tested: the button is an anchor with `mailto:contact@beeside.you`.

## 6. Test evidence (this working tree, uncommitted until the commit that carries this file)

- Frontend `tsc --noEmit` and `vitest run src/precision`: 43/43.
- Backend `tsc --noEmit`; unit `jest src/precision`: 29 suites pass (1 241 tests); integration `src/precision`: 8 suites pass on a clean database (the registry-publish suite expects a database with no published manifest and fails on a database that already holds them — a test precondition, not a defect).
- Mock-mode Playwright: 250 passed, 6 skipped.
- Live-stack Playwright: 182 passed, 110 skipped (project filters), 0 failed on the full run. After the top-bar label fix: help / contact / errors / axe subset re-run, one keyboard-only a11y spec failed once under load and passed on isolated re-run (same test-harness timing race already documented; MINOR).
- Mock Playwright after the label fix: help/contact subset 12/12.
