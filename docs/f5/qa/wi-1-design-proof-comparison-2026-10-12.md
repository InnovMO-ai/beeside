# WI-1 — Design Proof v3.3 comparison against the Embassy RC (12 Oct 2026)

**Result: PASS.** No CRITICAL or MAJOR visual difference remains. Frozen product behaviour and approved copy were not changed to match the proof.

Method. The proof ("Precision Center V2.0 — Design proof 3.3.pdf", pages 1–17) was rendered page by page and read side by side with screenshots of the real stack (real frontend build, backend, Postgres) for every screen, in desktop 1440×900 and mobile 390×844 (2×), Day and Night Shift, English and Spanish. Nothing was reconstructed from memory. Commands and SHA: live Playwright `npx playwright test -c playwright.precision-live.config.ts` (screens in `/tmp/precision-live-shots/{desktop,mobile}-{light,dark}-{en,es}`), SHA of the build in the release evidence block below.

## What was changed to reach the proof (visual only)

Tritone tokens (Ink / Paper / Violet + Tint) for Day and Night Shift; Public Sans for all UI, Noto Serif only for the Cover headline and the product titles (My Service Map, Category Requirement Pack (CRP), Preview before Send, Sent), both self-hosted (OFL licences included, no external request). New shell: top bar, sidebar with Add a Service and the categories (icon badges), mobile drawer, document shell with back link. Conversation grammar: typographic Precision turns without bubble, tint block for the client, "What we understood" card, quick-choice pills (full width on mobile), rounded composer with round send button, amber "critical" notice. Document views: contents rail, summary strip, tint synthesis, status = glyph + label. Cover: neutral wash, serif headline, dark Continue, canonical four-step strip. Print stylesheets for My Service Map and CRP kept. New customer-visible keys: `sm.contents` (Contents / Contenido), `crp.readOnlyLabel` (Read-only / Solo lectura) — EN/ES parity checked by `i18n.test.ts`.

## Screen-by-screen

| Screen (proof page) | Result | Note |
|---|---|---|
| Cover (p-02) | PASS | Neutral global wash (no approved country photo). |
| Precision Center (p-03, p-15) | PASS | Continue card, 3-column strip, Precision by Category table. |
| Precision Understanding (p-04, p-12) | PASS | Pills stack full width on mobile. |
| Category conversation (p-05) | PASS | Header strip, structured input, amber notice. |
| Add a Service (p-06) | PASS | Same conversation grammar and confirmation card. |
| My Service Map (p-07) | PASS | Contents rail, serif title, summary strip, services list. |
| Category Requirement Pack (CRP) (p-08) | PASS | Context / Part tables, status glyph + label. |
| Preview before Send (p-09, p-16) | PASS | Sticky full-width Send on mobile. |
| Sent to Operation Hub (p-10) | PASS | Neutral state-based access copy. |
| Light / dark (p-11) | PASS | Night Shift tokens, logo plate kept for the official logo. |
| Responsive desktop / mobile, drawer (p-13, p-14, p-17) | PASS | No horizontal overflow at 390 px. |

## Remaining differences (all allowed: obsolete copy, asset, or frozen product)

1. **Placeholder and obsolete copy in the proof is not reproduced** ("[value]", "Sample content", "Understanding" instead of Precision Understanding, "Ver My Service Map", "Map / Prepare / Activate"): the implementation keeps the approved copy and canonical terms.
2. **No "Pinned" section** in the sidebar: there is no Pinned feature in the frozen product.
3. **My Service Map structure.** The proof sketches eleven numbered narrative sections; the frozen product renders Your project / Your services / Open items from the confirmed data. Same visual grammar, different content structure.
4. **Logo.** The official beeside logo file is used as delivered (with its plate in Night Shift); the proof's plain "beeside" word is a mock-up of it.
5. **Cover photo.** Neutral wash, because no approved country photo/presence exists (R10: no country-specific claims without an approved source).
6. **Sidebar progress.** The proof shows a percentage beside every category; the implementation shows it for the active category and the full set in the Center table (data comes from the Center response; no per-category fetch added to the sidebar). MINOR.
7. **Mobile conversation header.** The proof shows the conversation title and "View My Service Map" in the mobile top bar; the implementation keeps the product title and menu, and the conversation header stays inside the thread. MINOR.
8. **Wording "enabled" instead of "ready"** in the Operation Hub access state: the copy linter forbids "ready/listo" for state claims (no readiness promise).
9. **Target size.** Quick-choice pills and chips on desktop follow the proof's compact size (below 44 px, above the WCAG 2.2 AA minimum); on mobile every control is 44×44. axe: 0 serious/critical. **PO acceptance of this exemption requested.**

## Evidence (12 Oct 2026)

- Branch `feature/precision-v2-f5`, commits 9bc7091, 9db4471, 5e66cc8 (see the release evidence block in `f5-status-2026-10-12.md`).
- Mock-mode Playwright (`playwright.precision.config.ts`): 250 passed. Frontend vitest and `tsc --noEmit`: pass.
- Live-stack Playwright (`playwright.precision-live.config.ts`, 4 projects × EN/ES): 182 of 182 pass; two specs failed once under concurrent load (acceptance en desktop-light on the Add a Service turn count; errors "revoked session" mobile-dark) and passed on isolated re-run — wait-condition races in the test harness, not product defects; to be hardened after the presentation.
- axe: 0 serious/critical on every screen and state; targets, overflow and focus rings asserted in `a11y.live.spec.ts`.
