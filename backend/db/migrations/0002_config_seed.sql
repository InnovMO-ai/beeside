-- Custom SQL migration (drizzle-kit generate --custom): canonical reference catalogs.
-- Replaces the former out-of-band db/seed/0001_config_seed.sql so every environment gets
-- exactly the same catalogs through the tracked Drizzle migration sequence.
--
-- Deliberately NOT included: placeholder question_bank_version / rules_engine_version /
-- snapshot_template_version rows. Those existed only to satisfy project's NOT NULL FKs
-- during testing; published versions belong to Phase 3's versioning workflow. The
-- integrity test suite now creates its own version rows inside its rolled-back transaction.
-- field_key_registry is never seeded here: it is synced from shared/canonical-fields.

-- Rules Matrix v1 §0 — fixed 15-value category list. First 14 are finding areas (§1-§14 in order);
-- "Other" (15) is a valid constraint/priority value but never produces a finding.
INSERT INTO rules_matrix_category (category_id, name, display_order, is_finding_area) VALUES
  (1,  'Target market',                          1,  true),
  (2,  'Customs & trade',                        2,  true),
  (3,  'Local sourcing/suppliers',                3,  true),
  (4,  'Local inventory & warehousing',           4,  true),
  (5,  'Freight & logistics',                     5,  true),
  (6,  'Technology systems',                      6,  true),
  (7,  'Local workforce',                         7,  true),
  (8,  'Facilities & real estate',                8,  true),
  (9,  'Local partner/distributor',               9,  true),
  (10, 'Regulatory permits & certifications',    10,  true),
  (11, 'Local entity & legal setup',              11,  true),
  (12, 'Banking',                                 12,  true),
  (13, 'Insurance',                               13,  true),
  (14, 'Go-to-market/commercial strategy',        14,  true),
  (15, 'Other',                                   15,  false);
--> statement-breakpoint

-- Capability Taxonomy v1 §2 — 10 client-facing categories (up to 6 shown per assessment,
-- selection/ranking logic lives in rules_engine_version.config, not here).
INSERT INTO capability_taxonomy_category (category_id, name, description, display_order) VALUES
  (1,  'Trade & customs',                    'Getting goods across borders — duties, documentation, import structure', 1),
  (2,  'Local entity & legal setup',         'Setting up the legal structure this market requires', 2),
  (3,  'Regulatory permits & certifications','Getting the specific approvals and certifications your operation needs', 3),
  (4,  'Local partners & suppliers',         'Finding and qualifying the people you''ll depend on locally', 4),
  (5,  'Workforce & HR setup',               'Hiring and managing people in the new market', 5),
  (6,  'Facilities & warehousing',           'Where you''ll store, produce, or operate from', 6),
  (7,  'Freight & logistics',                'Moving goods to and within the new market', 7),
  (8,  'Systems & technology',               'Making your existing systems work in the new market', 8),
  (9,  'Banking & insurance',                'Local financial and risk infrastructure', 9),
  (10, 'Go-to-market strategy',              'How you''ll sell and compete locally', 10);
--> statement-breakpoint

-- country — starter set only (ISO 3166-1 alpha-2). The content owner completes the full or
-- curated list later through a new migration; this does not block the schema.
INSERT INTO country (country_code, name) VALUES
  ('MX', 'Mexico'), ('US', 'United States'), ('CA', 'Canada'), ('BR', 'Brazil'),
  ('CO', 'Colombia'), ('CL', 'Chile'), ('AR', 'Argentina'), ('ES', 'Spain'),
  ('DE', 'Germany'), ('GB', 'United Kingdom');
