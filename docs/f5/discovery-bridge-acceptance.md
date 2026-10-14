# Discovery → Precision bridge — conformity suite and acceptance checklist

Discovery is the Product name of what the code still calls First Assessment / FA / `fa4_*` (identifiers are not renamed). This document does **not** define the Discovery contract; that belongs to the Discovery workstream. It records (1) what Precision already proves about ANY reader and (2) what happens when the real contract arrives.

## 1. The suite (reusable against the real reader)

| Suite | Proves | File |
|---|---|---|
| Reader conformance — `faContextConformance(name, make)` | permanent project identity; result id + catalog/contract/crosswalk versions; reproducible content and hash; caller cannot mutate source; declared structured client-safe shape only (no e-mail, tokens, payment, rendered view/YEV, nothing to parse); unknown project → null (isolation); re-run → new result id, same project id | `src/__tests__/helpers/fa-context-conformance.ts` (+ `adapters/fixture-fa-context.test.ts`) |
| Bridge conformance — `discoveryBridgeConformance(name, make)` (PostgreSQL) | provenance per inherited value (`sourcePinId` + `sourceItemRef`, pin names exact result/hash/contract); pin is a reference (no copy of Discovery content — column guard); deterministic offer and pin for the same source from any service instance; re-run → new current pin, old pin preserved and linked; unknown additive fields tolerated and never propagated; no context / failing reader → no offer, no pin; **inherited values create no fact and, even if all are confirmed, Understanding stays open** | `src/__tests__/helpers/discovery-bridge-conformance.ts` (+ `precision/domain/__integration__/discovery-bridge.int.test.ts`) |
| Architecture guard | outside `adapters/` and tests, nothing in Precision reads Discovery's mutable tables (`fa4_*`, `fa_*`), imports the legacy FA3 context module, or depends on YEV | `src/precision/discovery-boundary.test.ts` |

To run against the real reader: add one `faContextConformance("real", …)` and one `discoveryBridgeConformance("real", …)` call whose factory returns the real reader and a real delivered project. No test change.

### What the suite deliberately does NOT say
"Discovery supplied a value, therefore Understanding is complete" is never asserted — the opposite is. Depth, ambiguity, freshness, materiality and missing rationale / phases / country roles / constraints / priorities are evaluated by the Understanding layer (core product work, still pending).

## 2. Constraints the pin table already imposes (to compare with the contract)
`context_pin.project_id`, `source_project_id`, `source_result_id` are **uuid**; `catalog_version`, `contract_version`, `crosswalk_version`, `context_hash` are text; one current pin per project; pins are never deleted. A reader whose result ids are not uuids needs a decision before integration.

Open point (not decided here): Precision does not yet **refuse** an unsupported major `contractVersion`; the fixture uses "0.2". The version grammar and the compatibility rule come from the contract.

## 3. When the Discovery canonical contract arrives — STOP before adapting
Reconciliation (report before coding around anything):
1. Compare each contract guarantee with both suites above (G1–G5 and the list in section 1); list matches and mismatches.
2. List legacy FA3 assumptions still present (`src/precision-context/first-assessment-context.ts`, FA3 module copy) and whether they are touched.
3. Define the minimum adapter (a `FaContextReader` implementation under `adapters/`; no change to the port unless the contract forces it, and then report it as a contradiction).
4. Confirm: no YEV parsing; reproducibility for a pinned result; permanent project identity continuity (Discovery `project_id` = Precision `project_id`).
5. If compatible → implement the permanent reader, run both suites, then the real proof: REAL Discovery project/result → canonical Discovery context → simulated Premium entitlement → permanent entitlement boundary → Precision → provenance pin → Understanding. Later the same path with Stripe recurring / another valid entitlement source (same boundary, same Precision path).
6. If not compatible → report the contradiction (what stays / changes / removed / added) before any workaround.

No temporary Discovery connector is built.
