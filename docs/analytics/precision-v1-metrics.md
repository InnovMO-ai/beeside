# Precision V1.0 — analytics layer and canonical metrics

One event layer, three consumers. There is no second pipeline.

```
fa_journey_event  ┐                                   ┌─ Admin → Statistics (internal, operational)
precision_journey_event ┼─► analytics_v1_* views ─────┼─ Tableau (read-only role beeside_analytics_reader)
subscription_event / entitlement / precision_turn (kind only) ┘   └─ ad-hoc SQL for the data team
```

## Views (migration 0034)
| View | Grain | Use |
|---|---|---|
| `analytics_v1_events` | one row per event (both channels) | any funnel/quality cut; `channel` = `core` or `precision` |
| `analytics_v1_project_funnel` | one row per project | first time the project reached each Precision stage |
| `analytics_v1_commercial_events` | one row per commercial event | grants, extensions, endings, mode changes, programs, privacy, plus the paid lifecycle (activated, renewed, reactivated, cancellation, period ended) |
| `analytics_v1_entitlement_state` | one row per project | current access mode, sources (`paid`, `complimentary`, …), dates, privacy state |
| `analytics_v1_turns` | one row per conversation turn | who spoke, on which surface, which kind — **never the text** |

No view carries names, e-mail, answers, conversation text, comments or payloads (a contract test checks the column names and a canary check proves no conversation text leaks). `project_id` is a random identifier. After an erasure the rows stay (they hold ids, enums and counters) so history is not rewritten.

## Connecting Tableau
1. A DBA creates a login that is a member of `beeside_analytics_reader` (the migration creates the NOLOGIN role when it has CREATEROLE; otherwise create it and `GRANT SELECT` on the five views).
2. Point Tableau at a read replica or the primary with that login. It can read the views and nothing else (`person`, `precision_turn`, `answer`, … are not granted).
3. Build on `analytics_v1_*` only. The metric definitions below are the contract; do not recompute them from raw tables.

## Canonical metrics
The machine-readable catalog is `GET /api/admin/analytics/precision/catalog` (source: `src/analytics/precision-metrics.ts`). Every metric has an id, a definition, a unit, a source and a status:

* `live` — the behaviour exists and the event is emitted.
* `awaiting_product_layer` — defined and wired to its catalog event, but the behaviour that produces it is Fase 1 work. It reports 0/null; it is never approximated.

**Product funnel** (cohort = projects whose Precision was first opened in the range): opened → Understanding started → Understanding completed (My Service Map ready) → Service Map confirmed → category started → CRP ready → CRP confirmed → preview → send → Operation Hub accepted. "Service Map viewed" is not a stored fact and is not claimed.

**Quality / AI experience** — live: process-question rate, Add a Service started/completed, unknown legitimate need, CRP correction requests, critical items open rate. Awaiting the product layer: Service Map corrected, noise filtered, needs routed, client priority captured, Understanding depth, repeated-question rate, correction rate, clarification loops, misunderstanding repair.

**AI**: processed turns by surface, outcome and latency bucket; unavailable rate; fallback rate (awaiting model-tier plumbing).

**Commercial**: access now by mode and source; activations, renewals, reactivations, cancellations, periods ended, grants by source, extensions, moves to READ_ONLY / REVOKED, programs activated/redeemed/closed, privacy blocks. Privacy state is a separate dimension from commerce.

## Terminology: Discovery
**Discovery** is the Product name of what the code and historical event ids still call First Assessment / FA / `fa4_*`. Rules for this layer:

* Historical ids are not renamed. `fa_journey_event` and every `event_type` stored in it (`channel = 'core'` in `analytics_v1_events`) keep their ids; **Product alias: Discovery journey events**. Any `fa.*` profile key (`src/analytics/project-profile.ts`) keeps its key; Product alias: Discovery answers.
* New Product-facing event definitions, metric labels and Tableau field names use Discovery wording (e.g. "Discovery completed"); where an implementation id must still carry `fa`, the catalog states the alias in the definition.
* Rename or versioning of historical ids is proposed only if it gives real value (it would break Tableau history); today it does not.
* No raw client conversation is logged in any event (unchanged): events hold ids, enums and counters.
