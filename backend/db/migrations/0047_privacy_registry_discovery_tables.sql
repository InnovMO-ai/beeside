-- Privacy erasure registry: the three Discovery tables that arrived with Discovery's own migrations 0017-0023 and were not classified yet.
-- The registry guard test ("a new table cannot slip past the erasure") caught them on the first merge of Discovery into Precision.
-- The classification only RECORDS what Discovery already does (its own documented mechanism); it changes no behaviour and no data.
ALTER TABLE privacy_erasure_registry DISABLE TRIGGER privacy_registry_guard_trigger;--> statement-breakpoint
INSERT INTO privacy_erasure_registry (table_name, data_class, action, erase_order, project_predicate, reason) VALUES
  ('fa4_contact_request', 'fa4', 'other_mechanism', NULL, NULL, 'carries personal data; scrubbed by fa4_anonymize_project() (Discovery 0020/0023)'),
  ('fa4_event', 'fa4', 'other_mechanism', NULL, NULL, 'append-only product event; no personal data (Discovery 0020); keyed by the Discovery project id only'),
  ('fa4_marketing_consent', 'fa4', 'other_mechanism', NULL, NULL, 'append-only ledger of the marketing consent decision (project id, decision, language, wording reference); no e-mail or name; kept as evidence of the decision, see fa4_anonymize_project()');--> statement-breakpoint
ALTER TABLE privacy_erasure_registry ENABLE TRIGGER privacy_registry_guard_trigger;
