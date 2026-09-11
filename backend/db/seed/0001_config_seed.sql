-- Phase 2 seed data — config/reference tables only. Never hand-edit field_key_registry.

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

-- country — starter set only. Content owner should complete the full ISO-3166-1 list
-- (or the curated subset beeside actually supports) before Phase 2 goes live; this does
-- not block the schema, only the data.
INSERT INTO country (country_code, name) VALUES
  ('MX', 'Mexico'), ('US', 'United States'), ('CA', 'Canada'), ('BR', 'Brazil'),
  ('CO', 'Colombia'), ('CL', 'Chile'), ('AR', 'Argentina'), ('ES', 'Spain'),
  ('DE', 'Germany'), ('GB', 'United Kingdom');

-- Placeholder v1 versions — real content (question bank, rules config, snapshot template)
-- is Phase 8/product-content work, not Phase 2 schema. These rows only satisfy the
-- NOT NULL FK on `project` for local testing.
INSERT INTO question_bank_version (version, config, is_current) VALUES ('v1', '{}', true);
INSERT INTO rules_engine_version (version, config, is_current) VALUES ('v1', '{}', true);
INSERT INTO snapshot_template_version (version, config, is_current) VALUES ('v1', '{}', true);
