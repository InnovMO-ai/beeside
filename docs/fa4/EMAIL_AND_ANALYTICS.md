# FA4 — email delivery, contact and event capture (Presentation RC)

## Email architecture
`EmailTransport` (`log` | `smtp`) → `fa4_email_delivery` outbox (lease, retry with backoff, `DEAD` after `max_attempts`, idempotency key = delivery id, per-recipient daily quota, resend cooldown) → worker (`node dist/fa4/worker.js`, `npm run start:fa4-worker`). No direct sends from routes, no second mailer, no legacy `email_delivery`. No DB transaction is open while the provider is contacted. Delivery is at-least-once (a crash between acceptance and the `SENT` update re-sends after the lease expires; Message-ID / `X-Beeside-Delivery` carry the delivery id).

All FA4 operational mail: From `beeside <contact@beeside.you>`, Reply-To `contact@beeside.you` (contact messages: Reply-To = the person who wrote), recipient of "Hablar con beeside" = `contact@beeside.you`. Operational email is never marketing.

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

## Event capture (`fa4_event`, append-only)
Privacy: no IP, user agent, fingerprint, email or free text. `visit_id` is a random per-tab UUID in `sessionStorage` (gone with the tab). `props` holds only catalog codes / counts. `project_id` is null before Identity. Capture never blocks or fails a user action. `POST /api/fa4/events` accepts a closed vocabulary (strict schema; anything else → 204, nothing stored); rate-limited.

| name | source | when | props |
|---|---|---|---|
| `visit` | client | app opened (one per page load) | – |
| `language_selected` | client | language chosen on the cover | `locale` |
| `start_clicked` | client | cover CTA | – |
| `step_viewed` | client | each step shown (step id without component) | `step` |
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
