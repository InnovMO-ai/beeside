# Precision pilot fixture content — NOT production truth

These three files (`project-manifest.json`, `logistics.json`, `hr.json`) are a faithful JSON
transcription of the real Logistics/HR pilot content authored in
`claude/precision-macroblock3-manifest-content-readiness-contract-2026-10-02.md` (as corrected by
the Macroblock 4 hygiene fix of 2026-10-02 — see that document's changelog note), reshaped to the
exact `project_manifest_version.content` / `category_manifest_version.content` JSONB shapes frozen
in `claude/precision-block2-macroblock2-canonical-data-model-manifest-architecture-2026-10-02.md`.

**Macroblock 4 hygiene item C, restated as an explicit, checkable guarantee:** no migration, seed
script, or application code in this repository publishes the content in this directory. The only
place these files are ever loaded and actually published (via `precision_project_manifest_publish`
/ `precision_category_manifest_publish`) is inside `backend/db/tests/precision/run_precision_tests.sql`'s
own setup block, which runs its entire suite inside one `BEGIN; ... ROLLBACK;` transaction — nothing
written there is ever committed. Until a real, product-owner-approved publish step is authored
(explicitly out of scope for this macroblock, which is persistence-layer-only), this content is
fixture data for exercising the schema, never regulatory truth presented to a client. The SG
deactivation of `hr_statutory_year_end_bonus_status` in `hr.json` carries the same
`CONTENT_VALIDATION_REQUIRED` flag the source document places on it — do not clear that flag here;
it is cleared only by whoever next does the real regulatory review the source document calls for.

**Macroblock 4 hygiene item B, restated as an explicit, checkable guarantee:** `category_key`
values used across this pilot (`logistics`, `hr` — and, elsewhere in the taxonomy per
`project-manifest.json`'s `candidate_categories[]`, `legal`/`tax`/`market_validation`) are pilot/
provisional identifiers only, never a frozen taxonomy. This is enforced structurally, not just by
convention: `category_assessment.category_key` (`backend/db/schema/precision.ts`) is a plain
format-checked `text` column — never a Postgres enum, never a foreign key into a fixed taxonomy
table — so adding, renaming, or retiring a category never requires a schema migration.

**Critical-decision `resolution_rule` encoding:** each `critical_decisions[].resolution_rule` below
is the closed, non-`eval` AST defined in `backend/src/precision/critical-decisions.ts`
(`ResolutionRule`), not the source document's pseudocode strings. Two ops were added to that module
specifically to represent this pilot's own authored content faithfully rather than approximating it
away: `field_asked`/`field_not_asked` (the pseudocode's literal "is not NOT_ASKED," which is a
strictly weaker test than "is answered" — see that file's header comment on the distinction) and
`group_min_items` / `group_item_text_matches_any` (repeatable-group minimum-count gates and the
§9.2 hazmat-keyword material-contradiction worked example). This is a routine, non-breaking,
additive extension to an already-declarative representation — no business rule changed, no field
semantics changed; it only gives the storage format enough expressiveness to hold what was already
authored in the source document without silently dropping or distorting it.
