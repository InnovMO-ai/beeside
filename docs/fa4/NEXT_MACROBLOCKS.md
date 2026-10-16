# FA4 — next macroblocks (registered, not started)

## FA4 Admin — Demand & Catalog Console
Goals
- Statistics: how many visit / start / complete FA.
- Services / capabilities requested; countries / destinations.
- Needs beeside already covers; needs SOURCEABLE / REVIEW; needs not covered; UNMAPPED_NEED.
- Aggregated demand trends.
- Catalog administration: add capability / service; edit through a draft; publish; archive (never delete); change history and version.

Before building it: **audit** what already exists in the backend / data model (candidates: `fa4_demand_signal`, `fa4_catalog_entity` with `draft_data`, `fa4_catalog_change`, `fa4_catalog_version`, `aggregateDemand` / `canReadRawDemand` in the engine, `saveCapabilityDraft` / `publishCapability`, the append-only history) and what is missing in API and UI (admin authentication, endpoints, screens, funnel events for visit / start / complete).
