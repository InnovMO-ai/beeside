# FA4 — email delivery, contact and event capture (Presentation RC)

## Email architecture
`EmailTransport` (`log` | `smtp`) → `fa4_email_delivery` outbox (lease, retry with backoff, `DEAD` after `max_attempts`, idempotency key = delivery id, per-recipient daily quota, resend cooldown) → worker (`node dist/fa4/worker.js`, `npm run start:fa4-worker`). No direct sends from routes, no second mailer, no legacy `email_delivery`. No DB transaction is open while the provider is contacted. Delivery is at-least-once (a crash between acceptance and the `SENT` update re-sends after the lease expires; Message-ID / `X-Beeside-Delivery` carry the delivery id).

All FA4 operational mail — **final canonical behaviour (PO, 2026-10-12)**:

| Email | To | From | Reply-To |
|---|---|---|---|
| Resume / YEV | the project's email | `beeside <contact@beeside.you>` | `contact@beeside.you` |
| "Hablar con beeside" | `contact@beeside.you` | `beeside <contact@beeside.you>` | **the person who submitted the form** (so beeside's reply reaches them; this supersedes the literal Design §G note) |

Operational email is never marketing.

### Truthful states (queued ≠ sent)
`POST /session/finish-later`, `POST /session/result/email`, `POST /session/contact`, `POST /contact` answer:

| HTTP | body | meaning |
|---|---|---|
| 200 | `{state:"sent"}` | the SMTP server accepted the message |
| 202 | `{state:"pending"}` | still being delivered; poll `GET /session/email-status?kind=resume|result` |
| 502 | `{error:"EMAIL_NOT_SENT"}` | provider failure; asking again re-attempts the SAME delivery (no duplicate) |
| 429 | `{error:"RATE_LIMITED"}` | per-recipient daily quota |

The UI shows *sending → sent* only on `sent`; *failed → try again* otherwise. There is no `ok:true` on enqueue anymore.

### Configuration
`FA4_EMAIL_TRANSPORT=log|smtp` · `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_SECURE`, `SMTP_USER` (`contact@beeside.you`), `SMTP_PASSWORD` (**Secret Manager**, never logged), `MAIL_FROM` (`contact@beeside.you`), `MAIL_FROM_NAME` (`beeside`), `MAIL_REPLY_TO` (`contact@beeside.you`) · `FA4_CONTACT_ADDRESS` (default `contact@beeside.you`) · `FA4_PREMIUM_RESOURCE_URL_ES|EN` (optional secondary CTA of the YEV email) · `FA4_EMAIL_CONFIRM_WAIT_MS` (8000) · `FA4_WORKER_POLL_MS` (5000) · `APP_BASE_URL` (link base). Production refuses `log` and refuses to start with `smtp` and missing variables.

## Email templates (Design v2, frozen)
Three templates × ES/EN, responsive HTML (tables, inline CSS, VML buttons for Outlook, text wordmark, no image dependency) + plain-text fallback, embedded from `backend/src/fa4/email-templates/` (generated `templates.generated.ts`; a test fails on drift). Renderer: `email-render.ts` (conditionals, HTML-escaping, https-only URLs, no unresolved marker may remain). Premium block of the YEV email renders only if ALL THREE hold: a real Premium continuation for the project (D-050/D-096), a Premium URL for the language (`FA4_PREMIUM_RESOURCE_URL_ES|EN`) and `FA4_PREMIUM_COMMERCIAL_CONTENT_ALLOWED=true` (final commercial-content policy — LEGAL-1, external; default false = hidden). Subject: user values (name, company) are sanitized (controls, CR/LF, U+2028/9, bidi, encoded-words, ≤60 chars) and the header is built by the mail library. The internal contact email is generated in the FA language and carries «Idioma de FA» and the origin stage (`FA` | `YEV`). No customer acknowledgement email.

### Private links
- **Resume** (single-use, fragment `#r=`): the page shows an explicit «Continuar donde lo dejaste» action; nothing is redeemed by a GET/HEAD/prefetch/scanner visit (the server has no GET for it) — the real continuation redeems it once.
- **YEV email**: ONE private token (`YEV_LINK`, valid `FA4_YEV_LINK_DAYS`, default 14; revoked when a newer YEV email is issued) serves both «View my Your Expansion View» (`…&view=result`) and «Talk to beeside» (`…&view=result&contact=open&origin=yev_email`). Exchanging it never spends it (each exchange mints a fresh 24 h session), so opening one action never invalidates the other; expired/revoked → one generic «link no longer valid» screen. Talk opens the existing contact form with stage `YEV`; never `mailto:`.

## Event capture (`fa4_event`, append-only)
Privacy: no IP, user agent, fingerprint, email or free text. `visit_id` is a random per-tab UUID in `sessionStorage` (gone with the tab). `props` holds only catalog codes / counts. `project_id` is null before Identity. Capture never blocks or fails a user action. `POST /api/fa4/events` accepts a closed vocabulary (strict schema; anything else → 204, nothing stored); rate-limited.

| name | source | when | props |
|---|---|---|---|
| `visit` | client | app opened (one per page load) | – |
| `language_selected` | client | language chosen on the cover | `locale` |
| `start_clicked` | client | cover CTA | – |
| `step_viewed` | client | each SURVIVING screen shown (step id without component); merged screens emit one event per screen, never one per question | `step` |
| `help_clicked` | client | "Necesito ayuda" | – |
| `contact_opened` | client | "Hablar con beeside" opened | – |
| `result_viewed` | client | YEV rendered | – |
| `project_created` | server | Identity completed | `marketingOptIn` |
| `step_reached` | server | saved step changed | `step` |
| `result_generated` | server | YEV generated | `destinations[]`, `destinationCount`, `applies`, `depends`, `shortcut`, `activities[]`, `noCoverageDestinations[]`; `catalog_version` |
| `resume_email_requested/sent/failed` | server | save-for-later email | `attempts` |
| `yev_email_requested/sent/failed` | server | YEV email | `attempts` |
| `contact_submitted` | server | contact stored | `shareProgress`, `anonymous` |
| `contact_email_sent/failed` | server | contact delivery | `attempts` |
| `premium_continuation_requested` | server | "Continuar con beeside" | `catalog_version` |
| `marketing_opt_in_changed` | server | consent changes | `consented` |
| `resume_link_used` | server | resume token exchanged | – |

Every event carries `props.questionBank` (`FA4_QUESTION_BANK_FINAL_2026-10`) and, where relevant, `catalog_version`. Derived metrics: visit → start → Identity (`project_created`) → step progression (`step_reached`) → abandonment (last step without `result_generated`) → completion; destinations and activity signals from `result_generated`; Demand Signals and coverage gaps remain in the internal `fa4_demand_signal` table (never exposed publicly). Suitable for a later Admin console / Tableau extract.


## Retention of pre-project contact requests
A contact request written before Identity (`fa4_contact_request.project_id IS NULL`, e.g. from the cover) is kept **180 days from its latest interaction**; after that its name, company, email and message are irreversibly anonymized (`anonymized+<id>@invalid.invalid`). Linked requests follow the project's rules (`fa4_anonymize_project` also scrubs them). Mechanism: `purgeExpiredOrphanContacts` (`backend/src/fa4/retention.ts`) — idempotent, bounded (500/run), `SKIP LOCKED`, UPDATE-only so it works with the least-privilege runtime role; run hourly by the FA4 worker (`FA4_ORPHAN_CONTACT_RETENTION_DAYS`, default 180). A contact request is never marketing consent and writes nothing to the consent history.

### Step-id mapping after the Final Design Delta
| Removed / merged screen | Now measured as | Saved `step_key` resolves to |
|---|---|---|
| `same_in_all` | `destinations` | `destinations` |
| `existing:<c>` | `presence` | `presence:<c>` |
| `reflection` (checkpoint) | — (gone; the clarity question is on the last project screen, measured as `presence`/`activity`) | last project screen |
| `scale` | `decision` | `decision` |
| `cargo_route` | `fronts_support` / `fronts_mark` (desktop: `fronts_status`) | `fronts_support` / `fronts_mark` |
`projectConfirmed` / `knowsNeeds` are still stored (the clarity question: YES → shortcut, NO/unanswered → diagnostic path). Historic events keep their old names; the server enum still accepts them.
