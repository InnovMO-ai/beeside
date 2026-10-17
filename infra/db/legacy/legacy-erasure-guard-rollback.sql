-- Rollback of the OPTIONAL erasure tombstone on the legacy `discovery` database (and of migration 0053 anywhere it must be undone without data loss).
-- Apply the tombstone:   psql "$LEGACY_MIGRATOR_URL" -v ON_ERROR_STOP=1 -1 -f backend/db/migrations/0053_privacy_erasure_tombstone.sql
-- Roll it back:          psql "$LEGACY_MIGRATOR_URL" -v ON_ERROR_STOP=1 -1 -f infra/db/legacy/legacy-erasure-guard-rollback.sql
-- Only triggers and one function are dropped; no table, row or column is touched. Idempotent.
DROP TRIGGER IF EXISTS fa4_tombstone_project ON fa4_project;
DROP TRIGGER IF EXISTS fa4_tombstone_result ON fa4_result;
DROP TRIGGER IF EXISTS fa4_tombstone_signal ON fa4_demand_signal;
DROP TRIGGER IF EXISTS fa4_tombstone_contact ON fa4_contact_request;
DROP FUNCTION IF EXISTS fa4_erased_project_guard();
