# PRECISION — FINAL VERIFY (12 Oct 2026)

Code under test: `feature/precision-v2-f5` @ the commit that carries this document (code identical to `4848377`: frontend/test-only delta on top of `efb9d16`, backend identical to `efb9d16`).
`embassy-rc` stays frozen at `73b5d46`; `embassy-rc-1`, `checkpoint-pre-push-20261012` and earlier bundles untouched. No rewrite, no force-push.

## Verdict

**NOT EMBASSY READY — one gate item open: the real-model final rehearsal on current code has to be run by the PO** (the provider key lives only in the PO's `precision-poc.env`; it cannot run from the cloud). Everything else in the gate is PASS with evidence below. No CRITICAL or MAJOR defect is open. If the real-model run returns zero failed checks (A–J, P-01, P-02), the verdict becomes EMBASSY READY with no further code change.

Command for the PO (new bundle already in the rehearsal folder, it is the newest so the script picks it):

```
bash ~/Developer/precision-poc-env/rehearsal-12oct/run-real-rehearsal.sh
python3 ~/Developer/precision-poc-env/rehearsal-12oct/verify-real-rehearsal.py <out-dir printed by the script>
python3 ~/Developer/precision-poc-env/rehearsal-12oct/opening-words.py <out-dir>
```

## 1. Full journey (not limited to A–J)

PASS on a real backend and database, production build, through the static server, EN and ES: first entry (Cover), re-entry by deep link / reload on 9 routes, Center, Understanding (card confirm, correct, free text, process questions, injection), corrections, interruption/resume, My Service Map (draft, confirm dialog, confirmed, read-only, print), Add a Service, Precision by Category (lanes, quick replies, P-01/P-02), progress vs readiness, CRP review, Request changes (dialog, returns to the open thread), Confirm CRP (one dialog, then read-only, no second Confirm), new CRP version (dialog, editable again, confirm), Preview, Send, Sent, second delivery for version 2, Operation Hub hidden / pending / available (with and without Sherpa and with and without a direct channel), READ_ONLY and revoked access, Help / Contact / legal links.
New spec `e2e/precision-live/final-verify.live.spec.ts` (16 tests, EN+ES) walks the parts A–J does not.

## 2. Edge cases

PASS (existing live specs + the new one): double click / duplicate turn / duplicate Confirm / duplicate Send (one delivery per version), refresh mid-turn (turn resumed under the same key, completes once), back/forward (same thread, same position), interrupted request, offline while a page loads (shell stays, automatic retry, "Try now"), AI failure and AI timeout (answer saved, retry completes the same turn), stale Preview (calm refusal, nothing sent), Operation Hub fault / timeout / slow / rate limit (outcome unknown is reconciled, never a duplicate), partial or empty data (new project, Service Map not ready), unknown / malformed addresses and out-of-order API calls (4xx, never 5xx, no stack or driver text), session restoration, link reuse / expired / revoked, language switch and Night Shift switch (no reload, thread kept), language switch **while an answer is processing** (counted once, reply arrives, no alert). No lost work, no duplicate business effect, no impossible visible state, no raw technical text.

## 3. Bugs found

| # | Severity | Finding |
|---|---|---|
| FV-1 | MAJOR (lost work) | The typed draft in the composer was lost when the client switched language (the thread reloads for the new language and the composer unmounted). |
| FV-2 | MINOR (structure / a11y) | When a conversation could not be loaded (for example an unknown category address) the page had two `h1` elements and two autofocus targets. |
| FV-3 | test only | Mobile navigation helper decided once, without waiting, whether the menu button existed; one run of 185 on mobile-dark timed out. Not reproducible in 6 reruns (3 plain, 3 under CPU load); the product menu has no auto-close. Helper hardened. |

Not defects (assumptions in my first draft of the new spec, verified against code and approved design): Add a Service on a confirmed map records the new My Service Map version immediately by design (the client already confirmed the service in the card; the previous version is kept immutable), so there is no half-confirmed draft; Request changes and Start a new version both open a confirmation dialog.

## 4. Fixes applied

* FV-1: the draft now lives in the workspace, not in the composer (`Workspace.tsx`); it is cleared when the scope changes (another category) and kept when the language changes. Covered by the new live spec (failed before, passes after, EN and ES).
* FV-2: `PageState` / `InlineError` take `level`; the in-workspace load error renders `h2` (`primitives.tsx`, `SystemPages.tsx`, `Workspace.tsx`, `.pz-pagestate h2` in `precision.css`). Covered by the empty/missing-data spec.
* Date correction: Code Complete / status docs now say 12 Oct 2026.

## 5. Regression after fixes (on the current code)

* frontend `tsc` clean; vitest 143/143.
* mock Playwright (`playwright.precision.config.ts`): 306 passed, 6 skipped (unchanged).
* live Playwright (real backend + DB, desktop/mobile × light/dark × EN/ES): **201 passed, 0 failed**, 167 skipped by design (project-specific specs). Includes security, a11y/axe, reduced motion, error hygiene, CSP, journey, process, injection, Sherpa contact.
* backend `tsc` clean; unit 1136 passed / 8 skipped (30 suites); Precision integration on `beeside_it` 92 passed / 5 skipped, repeated twice; `registry-publish` 8/8 on a fresh migrated database.

## 6. Copy / terminology (EN/ES)

PASS. All 2,540 shipped strings (UI i18n, conversation copy registry, field questions, process-knowledge pack, manifest labels) dumped and checked: no developer or internal vocabulary on customer surfaces (no Embassy, mock, stub, simulator, sandbox, webhook, FA/PA/RFI/CCIR/PSM, TODO, placeholder), no untranslated canonical term drift (Precision Center, My Service Map, Operation Hub, Add a Service, Category Requirement Pack (CRP), Sherpa are kept in English in ES), no double spaces, no repeated words, no missing locale, no empty string, no ES accent omissions found by pattern, English spell-check clean. Read in full: Help (FAQ, Contact, legal), Contact beeside, Sherpa role / contact timing, AI disclosure ("Precision uses artificial intelligence… Progress and what is confirmed are calculated with fixed rules"), confidentiality answer (no conversation history, email, people's names or documents go to Operation Hub; review before sending), Operation Hub boundary. No unsupported legal, security or country claim. "Contact my Sherpa" appears only with an active hub + access + assigned Sherpa + valid direct channel; otherwise "Contact beeside" with the configured address.

## 7. Visual / responsive

PASS. Contact sheets of the full journey reviewed (mobile 390 dark ES / light EN, desktop 1440 light EN / dark ES, 20 screens each): typography, wrapping, spacing, CTA hierarchy, dialogs, success banners, read-only, loading and error states consistent, nothing clipped. The live suite checks axe (serious/critical = 0), no horizontal overflow, target sizes, focus ring on every keyboard stop, no keyboard trap, reduced motion, on every screen and state in the four viewport/theme combinations and both languages. No Design reopened.

## 8. Real-model rehearsal

**Pending — PO to run** (see Verdict). Last real-model result (code `fce057e`): A–J 53/53, P-01/P-02 PASS. Since then the conversation layer changed (acknowledgement variety, Sherpa contact copy, yes/no echo verifier, "pallets"), so the run must be repeated on the current code.

## 9. Opening-word distribution

Baseline on the last real-model run (before Stage 1 variation): EN "Understood" 73% (19/26, longest same-opener run 7); ES "Entendido" 72% (13/18, longest run 6). After-change figures need the PO's real run; `opening-words.py` prints the share, the longest run and the full distribution per language. Target is naturalness, not a number; if the run shows a long same-opener run, it is a MINOR copy item, not a gate failure.

## 10. Remaining MINOR items (documented, none blocks)

1. Opening-word variety to be measured on the real-model run (item 9).
2. Seven older First Assessment integration suites expect `st-1.0.0` and the code is `st-1.1.0` (identical on committed HEAD before this work); outside Precision.
3. `registry-publish.int` needs an empty manifest registry (fresh migrated database); it fails on a database where manifests were already published. Test-environment hygiene, not product.
4. One unexplained, non-reproducible intermittent failure of a combined integration run earlier in this verification (17 tests, passed on 5+ reruns, including under load); the failure text was not captured. If it recurs, logs are now kept in `/tmp/int-fv*.log` style runs.
5. One test-helper race on mobile-dark (FV-3), hardened.
6. "Strategic Advisory" and "Ecosystem Development" stay in English in ES (approved catalog names).

## 11. Stripe — IN BUILD

Outside the deterministic Embassy path; entitlement runs on the fixture provider (FULL, READ_ONLY, revoked all verified). Needs from the PO side to verify in a sandbox: test secret key, one-time price id, webhook signing secret and `stripe listen`. Not a blocker.

## 12. ClickUp / Operation Hub — IN BUILD

Outside the deterministic path; the simulator path is stable (publish, idempotency, timeout-after-store reconciliation, corruption, rate limit, access states). Needs for a sandbox check: test workspace id, space id, token and the hierarchy / nesting decision; and the decision on the direct Sherpa channel source. Not a blocker.

## 13. External PO items

* `https://www.beeside.you/privacy` must carry beeside's actual Privacy Policy before external presentation (the URL is the approved one and is not changed in code).
* Push the current branch head to GitHub (the cloud session cannot; proxy 403, not bypassed): `push-to-github.sh` in the rehearsal folder, or `git fetch` from the bundle.
* ZDR with the AI provider remains DEFERRED — required before any real customer data.

## 14. Final verdict

**NOT EMBASSY READY — pending only the PO-run real-model final rehearsal on the current code.** All other gate conditions are met: 0 CRITICAL, 0 MAJOR open, primary and recovery paths intact, no visible placeholder or developer content, terminology clean, P-01/P-02 PASS in the deterministic and last real-model runs, journey, edge cases, copy and responsive PASS.
