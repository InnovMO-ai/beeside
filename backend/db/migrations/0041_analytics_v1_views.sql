-- V1.0 analytics query layer: ONE event layer (fa_journey_event + precision_journey_event, both with closed property contracts), exposed as
-- read-only views that the internal statistics endpoints AND Tableau read. There is no second pipeline: Tableau connects to these views with
-- the read-only role `beeside_analytics_reader`; the Admin statistics screen reads the same views through the Admin API.
-- No view exposes raw conversation text, structured answers, e-mail or names: project_id is a random identifier, everything else is an
-- enum, a counter, a flag or a timestamp. precision_turn is exposed WITHOUT content/structured.
-- Rollback: DROP VIEW analytics_v1_*; DROP ROLE IF EXISTS beeside_analytics_reader.

CREATE VIEW analytics_v1_events AS
  SELECT 'core'::text AS channel, event_type AS event_name, project_id, occurred_at, interface_language, properties FROM fa_journey_event
  UNION ALL
  SELECT 'precision'::text, event_name, project_id, occurred_at, interface_language, properties FROM precision_journey_event;
--> statement-breakpoint

-- One row per project: when it first reached each Precision funnel stage. "Understanding completed" is `my_service_map_ready` (the engine
-- judged the Understanding ready to confirm); "Service Map viewed" is not a stored fact and is not claimed.
CREATE VIEW analytics_v1_project_funnel AS
  SELECT project_id,
         min(occurred_at) FILTER (WHERE event_name = 'precision_started') AS precision_opened_at,
         min(occurred_at) FILTER (WHERE event_name = 'understanding_started') AS understanding_started_at,
         min(occurred_at) FILTER (WHERE event_name = 'my_service_map_ready') AS understanding_completed_at,
         min(occurred_at) FILTER (WHERE event_name = 'my_service_map_confirmed') AS service_map_confirmed_at,
         min(occurred_at) FILTER (WHERE event_name = 'category_started') AS first_category_started_at,
         min(occurred_at) FILTER (WHERE event_name = 'crp_ready_for_review') AS first_crp_ready_at,
         min(occurred_at) FILTER (WHERE event_name = 'crp_confirmed') AS first_crp_confirmed_at,
         min(occurred_at) FILTER (WHERE event_name = 'handoff_previewed') AS first_preview_at,
         min(occurred_at) FILTER (WHERE event_name = 'operation_hub_send_completed') AS first_send_at,
         min(occurred_at) FILTER (WHERE event_name = 'operation_hub_activated') AS first_oh_accepted_at
    FROM precision_journey_event
   GROUP BY project_id;
--> statement-breakpoint

-- Commercial events: the entitlement/program/privacy events of the catalog plus the paid lifecycle (subscription_event).
CREATE VIEW analytics_v1_commercial_events AS
  SELECT event_type AS event_name, project_id, occurred_at,
         properties ->> 'source_type' AS source_type,
         properties ->> 'program_kind' AS program_kind,
         properties ->> 'from_mode' AS from_mode,
         properties ->> 'to_mode' AS to_mode,
         properties ->> 'reason_code' AS reason_code,
         NULL::text AS origin
    FROM fa_journey_event
   WHERE event_type IN ('entitlement_granted', 'entitlement_extended', 'entitlement_ended', 'entitlement_mode_changed',
                        'program_activated', 'program_closed', 'program_redeemed', 'privacy_block_applied')
  UNION ALL
  SELECT event_type::text, project_id, occurred_at, 'paid', NULL, NULL, NULL, NULL, source
    FROM subscription_event;
--> statement-breakpoint

-- Current commercial state per project: what the access layer answers, from which sources, and whether privacy overrides it.
CREATE VIEW analytics_v1_entitlement_state AS
  SELECT e.project_id, e.precision_access_mode AS access_mode, e.premium_access_active, e.effective_from, e.effective_until, e.readonly_until,
         e.revoked_at, COALESCE(ps.state, 'open') AS privacy_state, COALESCE(src.sources, ARRAY[]::text[]) AS sources
    FROM entitlement e
    LEFT JOIN project_privacy_state ps ON ps.project_id = e.project_id
    LEFT JOIN LATERAL (SELECT array_agg(DISTINCT s.source ORDER BY s.source) AS sources FROM entitlement_sources_for(e.project_id) s) src ON true;
--> statement-breakpoint

-- Conversation shape without the conversation: who spoke on which surface and what kind of turn it was, never what was said.
CREATE VIEW analytics_v1_turns AS
  SELECT project_id, scope_instance_id, surface, role, kind, locale, created_at AS occurred_at FROM precision_turn;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'beeside_analytics_reader') THEN
    BEGIN
      CREATE ROLE beeside_analytics_reader NOLOGIN;
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'beeside_analytics_reader not created (needs CREATEROLE); create it and GRANT SELECT on analytics_v1_* manually';
    END;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'beeside_analytics_reader') THEN
    EXECUTE 'GRANT SELECT ON analytics_v1_events, analytics_v1_project_funnel, analytics_v1_commercial_events, analytics_v1_entitlement_state, analytics_v1_turns TO beeside_analytics_reader';
  END IF;
END $$;
