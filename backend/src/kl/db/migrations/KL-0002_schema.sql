-- KL-0002 · Esquema congelado de Design Spec §5 con los ajustes de CR-KL-002: todas las columnas de actor son uuid
-- con llave foránea a kl.principal; claves de catálogo, servicios, industrias y geografía siguen sin llave foránea
-- (se validan al publicar, AC-12). Las de contenido son de solo inserción salvo estado y marcas, que cambian por
-- transición permitida (ver KL-0002_schema_integrity.sql).

CREATE TYPE kl.cadence AS ENUM ('weekly', 'monthly', 'quarterly', 'semiannual', 'annual', 'none');

-- ---------------------------------------------------------------------------------------------------------------
-- 5.1 Fuentes (Source Registry)
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE kl.institution (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key             text NOT NULL UNIQUE CHECK (key ~ '^[a-z0-9_.]{2,60}$'),
  name            text NOT NULL,
  country         text NOT NULL CHECK (country ~ '^[A-Z]{2}$'),
  authority_class text NOT NULL CHECK (authority_class IN ('A', 'B', 'C', 'D')),
  kind            text NOT NULL CHECK (kind IN ('public', 'multilateral', 'research', 'chamber', 'commercial', 'beeside', 'partner')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE kl.publication (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key                   text NOT NULL UNIQUE CHECK (key ~ '^[a-z0-9_.]{2,80}$'),
  institution_id        uuid NOT NULL REFERENCES kl.institution (id),
  title                 text NOT NULL,
  jurisdiction          text NOT NULL,
  topics                text[] NOT NULL DEFAULT '{}',
  official_url          text NOT NULL CHECK (official_url ~ '^https://[^/\s]+'),
  edition_pattern       text,
  license_text          text,
  permitted_use         text NOT NULL CHECK (permitted_use IN ('quote', 'paraphrase_and_cite', 'cite_only')),
  default_content_risk  text NOT NULL CHECK (default_content_risk IN ('low', 'medium', 'high')),
  expected_periodicity  text,
  check_frequency       text NOT NULL DEFAULT 'inherit' CHECK (check_frequency IN ('inherit', 'weekly', 'monthly', 'quarterly', 'semiannual', 'annual', 'none')),
  next_check_at         timestamptz,
  status                text NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed', 'approved', 'suspended', 'rejected', 'revoked', 'blocked_pending_verification', 'discontinued')),
  owner_user_id         uuid REFERENCES kl.principal (principal_id),
  matrix_code           text CHECK (matrix_code ~ '^(S(0[1-9]|10)|R([1-9]|[12][0-9]|3[0-4]))$'),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE kl.publication_config_version (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id uuid NOT NULL REFERENCES kl.publication (id),
  version        integer NOT NULL CHECK (version >= 1),
  config         jsonb NOT NULL,
  authored_by    uuid NOT NULL REFERENCES kl.principal (principal_id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (publication_id, version)
);

CREATE TABLE kl.source_exception (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  publication_id uuid NOT NULL REFERENCES kl.publication (id),
  scope          text NOT NULL,
  jurisdiction   text NOT NULL,
  permitted_use  text NOT NULL CHECK (permitted_use IN ('quote', 'paraphrase_and_cite', 'cite_only')),
  expires_at     timestamptz NOT NULL,
  approved_by    uuid NOT NULL REFERENCES kl.principal (principal_id),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE kl.indicator (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key                    text NOT NULL UNIQUE CHECK (key ~ '^[a-z0-9_]{2,80}$'),
  name_es                text NOT NULL,
  name_en                text NOT NULL,
  unit                   text NOT NULL,
  direction              text CHECK (direction IN ('higher_is_better', 'lower_is_better')),
  nature                 text NOT NULL CHECK (nature IN ('objective', 'perception', 'composite')),
  primary_publication_id uuid REFERENCES kl.publication (id),
  consumable             boolean NOT NULL DEFAULT false,
  created_at             timestamptz NOT NULL DEFAULT now(),
  -- Percepción y compuestos: consumable = false por defecto (D2, T11); solo lo objetivo se consume.
  CONSTRAINT indicator_only_objective_consumable CHECK (nature = 'objective' OR NOT consumable)
);

CREATE TABLE kl.topic (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key           text NOT NULL UNIQUE CHECK (key ~ '^[a-z0-9_.]{2,100}$'),
  parent_key    text,
  label_es      text NOT NULL,
  label_en      text NOT NULL,
  category_keys text[] NOT NULL DEFAULT '{}',
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------------------------------------------
-- 5.2 Ingestión
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE kl.file_object (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sha256        text NOT NULL UNIQUE CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  detected_type text NOT NULL CHECK (detected_type IN ('csv', 'json', 'xlsx', 'pdf', 'docx', 'txt', 'zip')),
  byte_length   bigint NOT NULL CHECK (byte_length > 0),
  storage_key   text NOT NULL,
  scan_result   text NOT NULL CHECK (scan_result IN ('clean', 'not_required_dev', 'pending')),
  uploaded_by   uuid NOT NULL REFERENCES kl.principal (principal_id),
  purpose       text NOT NULL CHECK (purpose IN ('source_original', 'validation_evidence', 'edition_pdf')),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE kl.agent_run (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent          text NOT NULL CHECK (agent IN ('collector', 'knowledge')),
  publication_id uuid REFERENCES kl.publication (id),
  trigger        text NOT NULL CHECK (trigger IN ('scheduled', 'manual', 'extraordinary')),
  status         text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'succeeded', 'failed', 'cut_off')),
  started_at     timestamptz NOT NULL DEFAULT now(),
  finished_at    timestamptz,
  outcome        text CHECK (outcome IN ('no_change', 'new_publication', 'to_review', 'failed')),
  tokens_in      integer NOT NULL DEFAULT 0 CHECK (tokens_in >= 0),
  tokens_out     integer NOT NULL DEFAULT 0 CHECK (tokens_out >= 0),
  cost_usd       numeric(12, 6) NOT NULL DEFAULT 0 CHECK (cost_usd >= 0),
  error_code     text CHECK (error_code ~ '^[a-z0-9_]{1,60}$'),
  attempt        integer NOT NULL DEFAULT 1 CHECK (attempt >= 1),
  requested_by   uuid NOT NULL REFERENCES kl.principal (principal_id),
  created_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE kl.job ADD CONSTRAINT job_agent_run_fk FOREIGN KEY (agent_run_id) REFERENCES kl.agent_run (id);

CREATE TABLE kl.ingest_batch (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  origin               text NOT NULL CHECK (origin IN ('team', 'kseed', 'collector_agent')),
  publication_id       uuid REFERENCES kl.publication (id),
  edition_label        text,
  source_published_at  date,
  provenance_url       text,
  declared_license     text,
  file_object_id       uuid REFERENCES kl.file_object (id),
  file_sha256          text CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  status               text NOT NULL DEFAULT 'received' CHECK (status IN ('received', 'awaiting_source', 'rejected', 'extracted', 'in_review', 'approved', 'published', 'superseded', 'withdrawn')),
  reject_reason        text CHECK (length(reject_reason) <= 300),
  uploaded_by          uuid NOT NULL REFERENCES kl.principal (principal_id),
  reviewed_by          uuid REFERENCES kl.principal (principal_id),
  approved_by          uuid REFERENCES kl.principal (principal_id),
  agent_run_id         uuid REFERENCES kl.agent_run (id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  -- Un archivo que falla la validación no se guarda: solo el motivo y la huella (Design Spec §6.2).
  CONSTRAINT batch_rejected_has_reason CHECK (status <> 'rejected' OR reject_reason IS NOT NULL),
  CONSTRAINT batch_has_file_or_fingerprint CHECK (file_object_id IS NOT NULL OR file_sha256 IS NOT NULL),
  CONSTRAINT batch_approved_needs_reviewer CHECK (status NOT IN ('approved', 'published') OR approved_by IS NOT NULL)
);

CREATE TABLE kl.extracted_row (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id       uuid NOT NULL REFERENCES kl.ingest_batch (id),
  locator        text NOT NULL,
  raw_label      text,
  raw_value_text text,
  indicator_key  text,
  geo_code       text,
  period_label   text,
  period_start   date,
  period_end     date,
  parsed_value   numeric,
  classification text CHECK (classification IN ('new_period', 'correction', 'complement', 'method_change', 'conflict', 'unclassifiable')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, locator)
);

CREATE TABLE kl.qa_report (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id          uuid NOT NULL REFERENCES kl.ingest_batch (id),
  checks            jsonb NOT NULL,
  blocking_failures integer NOT NULL CHECK (blocking_failures >= 0),
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------------------------------------------
-- 5.3 Repositorio de conocimiento
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE kl.unit (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_key        text NOT NULL UNIQUE CHECK (unit_key ~ '^[a-z0-9_.:-]{3,160}$'),
  kind            text NOT NULL CHECK (kind IN ('statistic', 'card')),
  country         text NOT NULL CHECK (country ~ '^[A-Z]{2}$'),
  region          text,
  topic_key       text,
  category_keys   text[] NOT NULL DEFAULT '{}',
  service_ids     text[] NOT NULL DEFAULT '{}',
  industry_keys   text[] NOT NULL DEFAULT '{}',
  catalog_version text NOT NULL,
  content_risk    text NOT NULL CHECK (content_risk IN ('low', 'medium', 'high')),
  product_flag    boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE kl.unit_version (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id                 uuid NOT NULL REFERENCES kl.unit (id),
  version                 integer NOT NULL CHECK (version >= 1),
  status                  text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in_review', 'awaiting_validation', 'published', 'superseded', 'rejected', 'expired', 'withdrawn')),
  requires_review         boolean NOT NULL DEFAULT false,
  supersedes_version_id   uuid REFERENCES kl.unit_version (id),
  change_class            text NOT NULL CHECK (change_class IN ('new_period', 'correction', 'complement', 'method_change', 'conflict', 'unclassifiable')),
  review_level            integer CHECK (review_level BETWEEN 1 AND 3),
  origin                  text NOT NULL CHECK (origin IN ('collector', 'team', 'kseed', 'beeside_correction')),
  batch_id                uuid REFERENCES kl.ingest_batch (id),
  valid_from              timestamptz NOT NULL DEFAULT now(),
  valid_to                timestamptz,
  next_review_at          timestamptz,
  permitted_use           text NOT NULL CHECK (permitted_use IN ('quote', 'paraphrase_and_cite', 'cite_only')),
  limits_es               text[] NOT NULL DEFAULT '{}',
  limits_en               text[] NOT NULL DEFAULT '{}',
  specialist_required     boolean NOT NULL DEFAULT false,
  specialist_category_key text,
  authored_by             uuid NOT NULL REFERENCES kl.principal (principal_id),
  approved_by             uuid REFERENCES kl.principal (principal_id),
  approved_at             timestamptz,
  published_at            timestamptz,
  content_sha256          text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  created_at              timestamptz NOT NULL DEFAULT now(),
  UNIQUE (unit_id, version),
  CONSTRAINT unit_version_published_needs_approval CHECK (status NOT IN ('published', 'awaiting_validation', 'superseded', 'expired') OR approved_by IS NOT NULL OR origin = 'collector'),
  CONSTRAINT unit_version_valid_range CHECK (valid_to IS NULL OR valid_to > valid_from)
);
CREATE INDEX unit_version_status_idx ON kl.unit_version (unit_id, status, version DESC);
CREATE INDEX unit_version_batch_idx ON kl.unit_version (batch_id) WHERE batch_id IS NOT NULL;

CREATE TABLE kl.stat_value (
  unit_version_id          uuid PRIMARY KEY REFERENCES kl.unit_version (id),
  indicator_key            text NOT NULL REFERENCES kl.indicator (key),
  geo_code                 text NOT NULL,
  period_label             text NOT NULL,
  period_start             date NOT NULL,
  period_end               date NOT NULL,
  period_confidence        text NOT NULL CHECK (period_confidence IN ('declared', 'inferred', 'estimated')),
  value_numeric            numeric,
  value_status             text NOT NULL CHECK (value_status IN ('value', 'not_available')),
  display_es               text NOT NULL,
  display_en               text NOT NULL,
  unit_label               text NOT NULL,
  source_published_at      date,
  locator                  text,
  publication_id           uuid NOT NULL REFERENCES kl.publication (id),
  primary_unit_version_id  uuid REFERENCES kl.unit_version (id),
  rank_position            integer CHECK (rank_position >= 1),
  rank_of                  integer CHECK (rank_of >= 1),
  tie_group                integer CHECK (tie_group >= 1),
  series_break_note        text,
  estimated                boolean NOT NULL DEFAULT false,
  created_at               timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT stat_value_status_pair CHECK ((value_status = 'value') = (value_numeric IS NOT NULL)),
  CONSTRAINT stat_value_period_order CHECK (period_end >= period_start),
  CONSTRAINT stat_value_rank_pair CHECK ((rank_position IS NULL) = (rank_of IS NULL) AND (rank_position IS NULL OR rank_position <= rank_of))
);
CREATE INDEX stat_value_lookup_idx ON kl.stat_value (indicator_key, geo_code, period_end DESC);

CREATE TABLE kl.card_content (
  unit_version_id               uuid PRIMARY KEY REFERENCES kl.unit_version (id),
  card_type                     text NOT NULL CHECK (card_type IN ('country_profile', 'context', 'question_guide', 'diagnostic_trigger', 'local_service_condition', 'service_general', 'normative', 'guidance', 'methodology', 'beeside_process')),
  title_es                      text NOT NULL,
  body_es                       text NOT NULL,
  claims_es                     text[] NOT NULL DEFAULT '{}',
  cites                         jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(cites) = 'array'),
  primary_source_publication_id uuid REFERENCES kl.publication (id),
  norm_published_at             date,
  norm_effective_from           date,
  last_reviewed_at              date,
  created_at                    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE kl.card_locale_variant (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_version_id uuid NOT NULL REFERENCES kl.unit_version (id),
  locale          text NOT NULL CHECK (locale IN ('en')),
  title           text NOT NULL,
  body            text NOT NULL,
  claims          text[] NOT NULL DEFAULT '{}',
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in_translation', 'approved', 'requires_translation')),
  reviewed_by     uuid REFERENCES kl.principal (principal_id),
  approved_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (unit_version_id, locale),
  CONSTRAINT variant_approved_needs_reviewer CHECK (status <> 'approved' OR (reviewed_by IS NOT NULL AND approved_at IS NOT NULL))
);

CREATE TABLE kl.unit_link (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_version_id uuid NOT NULL REFERENCES kl.unit_version (id),
  to_unit_id      uuid NOT NULL REFERENCES kl.unit (id),
  kind            text NOT NULL CHECK (kind IN ('derived_from_primary', 'complements', 'methodology', 'series_continues', 'supports_equivalence')),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (from_version_id, to_unit_id, kind)
);

-- ---------------------------------------------------------------------------------------------------------------
-- 5.4 Validación especializada
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE kl.validator (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind           text NOT NULL CHECK (kind IN ('internal', 'external')),
  admin_user_id  uuid REFERENCES kl.principal (principal_id),
  display_name   text NOT NULL,
  organization   text,
  domains        text[] NOT NULL CHECK (cardinality(domains) > 0),
  engagement_ref text,
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  registered_by  uuid NOT NULL REFERENCES kl.principal (principal_id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- Los validadores externos no son principales: su validación la registra un principal interno.
  CONSTRAINT validator_internal_is_principal CHECK ((kind = 'internal') = (admin_user_id IS NOT NULL))
);

CREATE TABLE kl.specialist_validation (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_version_id  uuid NOT NULL REFERENCES kl.unit_version (id),
  content_sha256   text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  locale           text NOT NULL CHECK (locale IN ('es', 'en')),
  domain           text NOT NULL,
  scope_statement  text NOT NULL,
  verdict          text NOT NULL CHECK (verdict IN ('approved', 'approved_with_changes_required', 'rejected')),
  validator_id     uuid NOT NULL REFERENCES kl.validator (id),
  recorded_by      uuid NOT NULL REFERENCES kl.principal (principal_id),
  evidence_file_id uuid REFERENCES kl.file_object (id),
  validated_at     timestamptz NOT NULL,
  expires_at       timestamptz NOT NULL,
  status           text NOT NULL DEFAULT 'valid' CHECK (status IN ('valid', 'expired', 'superseded', 'revoked_by_reform')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT validation_max_12_months CHECK (expires_at > validated_at AND expires_at <= validated_at + interval '12 months')
);
CREATE INDEX specialist_validation_version_idx ON kl.specialist_validation (unit_version_id, status);

-- ---------------------------------------------------------------------------------------------------------------
-- 5.5 RAM (contexto compilado)
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE kl.context_package (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_key        text NOT NULL CHECK (package_key ~ '^pkg\.[a-z0-9_.]{3,120}$'),
  version            integer NOT NULL CHECK (version >= 1),
  level              text NOT NULL CHECK (level IN ('core', 'stage')),
  scope              jsonb NOT NULL,
  manifest           jsonb NOT NULL CHECK (jsonb_typeof(manifest) = 'array'),
  hash               text NOT NULL CHECK (hash ~ '^[0-9a-f]{64}$'),
  estimated_tokens   integer NOT NULL CHECK (estimated_tokens >= 0),
  budget_tokens      integer NOT NULL CHECK (budget_tokens > 0),
  status             text NOT NULL DEFAULT 'active' CHECK (status IN ('compiling', 'active', 'invalidated', 'retired')),
  compiled_by_run_id uuid REFERENCES kl.agent_run (id),
  compiled_by        uuid NOT NULL REFERENCES kl.principal (principal_id),
  invalidated_reason text CHECK (length(invalidated_reason) <= 300),
  created_at         timestamptz NOT NULL DEFAULT now(),
  invalidated_at     timestamptz,
  UNIQUE (package_key, version),
  CONSTRAINT package_within_budget CHECK (estimated_tokens <= budget_tokens)
);
CREATE UNIQUE INDEX context_package_one_active ON kl.context_package (package_key) WHERE status = 'active';

CREATE TABLE kl.package_member (
  package_id      uuid NOT NULL REFERENCES kl.context_package (id),
  unit_version_id uuid NOT NULL REFERENCES kl.unit_version (id),
  PRIMARY KEY (package_id, unit_version_id)
);
CREATE INDEX package_member_version_idx ON kl.package_member (unit_version_id);

CREATE TABLE kl.promotion_policy (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version                integer NOT NULL UNIQUE CHECK (version >= 1),
  thresholds             jsonb NOT NULL,
  window_days            integer NOT NULL CHECK (window_days > 0),
  budgets                jsonb NOT NULL,
  auto_promotion_enabled boolean NOT NULL DEFAULT false,
  authored_by            uuid NOT NULL REFERENCES kl.principal (principal_id),
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE kl.promotion_event (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  unit_id            uuid NOT NULL REFERENCES kl.unit (id),
  package_key        text NOT NULL,
  action             text NOT NULL CHECK (action IN ('promote', 'retire')),
  reason             text NOT NULL CHECK (reason IN ('usage_threshold', 'budget', 'status_change', 'manual')),
  usage_window_count integer CHECK (usage_window_count >= 0),
  decided_by         uuid REFERENCES kl.principal (principal_id),
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------------------------------------------
-- 5.6 Demanda y uso (nada del cliente: solo temas, dimensiones y un HMAC opaco)
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE kl.demand_group (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_key           text NOT NULL UNIQUE,
  destination_country text NOT NULL CHECK (destination_country ~ '^[A-Z]{2}$'),
  region              text,
  topic               text NOT NULL,
  category_key        text,
  service_id          text,
  information_type    text NOT NULL,
  first_seen          timestamptz NOT NULL,
  last_seen           timestamptz NOT NULL,
  signal_count        bigint NOT NULL DEFAULT 0 CHECK (signal_count >= 0),
  distinct_projects   integer NOT NULL DEFAULT 0 CHECK (distinct_projects >= 0),
  status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'decided', 'incorporating', 'closed')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE kl.demand_signal (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract            text NOT NULL CHECK (contract = 'kl.v1'),
  destination_country text NOT NULL CHECK (destination_country ~ '^[A-Z]{2}$'),
  region              text,
  topic               text NOT NULL CHECK (topic ~ '^[a-z0-9_.]{2,100}$'),
  category_key        text,
  service_id          text,
  information_type    text NOT NULL CHECK (information_type IN ('definition', 'procedure', 'general_requirement', 'statistic', 'comparison', 'equivalence')),
  coverage            text NOT NULL CHECK (coverage IN ('absent', 'partial')),
  partial_unit_refs   text[] NOT NULL DEFAULT '{}',
  stage               text NOT NULL CHECK (stage IN ('understanding', 'precision_by_category')),
  locale              text NOT NULL CHECK (locale IN ('es', 'en')),
  candidate           text NOT NULL CHECK (candidate IN ('knowledge_candidate', 'specialist_service', 'unclear')),
  project_ref         text NOT NULL CHECK (project_ref ~ '^[0-9a-f]{64}$'),
  occurred_at         timestamptz NOT NULL,
  group_id            uuid NOT NULL REFERENCES kl.demand_group (id),
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX demand_signal_group_idx ON kl.demand_signal (group_id, occurred_at);

CREATE TABLE kl.demand_group_project (
  group_id    uuid NOT NULL REFERENCES kl.demand_group (id),
  project_ref text NOT NULL CHECK (project_ref ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY (group_id, project_ref)
);

CREATE TABLE kl.demand_decision (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id       uuid NOT NULL REFERENCES kl.demand_group (id),
  decision       text NOT NULL CHECK (decision IN ('CREATE', 'ENRICH', 'PARTIAL', 'MAP', 'SPECIALIST_ONLY', 'DEFER', 'REJECT')),
  reason         text NOT NULL CHECK (length(reason) <= 500),
  decided_by     uuid NOT NULL REFERENCES kl.principal (principal_id),
  publication_id uuid REFERENCES kl.publication (id),
  unit_ids       uuid[] NOT NULL DEFAULT '{}',
  requires_admin boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE kl.usage_daily (
  day             date NOT NULL,
  unit_version_id uuid NOT NULL REFERENCES kl.unit_version (id),
  stage           text NOT NULL CHECK (stage IN ('understanding', 'precision_by_category')),
  country         text NOT NULL CHECK (country ~ '^[A-Z]{2}$'),
  category_key    text NOT NULL DEFAULT '',
  via             text NOT NULL CHECK (via IN ('ram', 'query')),
  count           bigint NOT NULL CHECK (count >= 0),
  PRIMARY KEY (day, unit_version_id, stage, country, category_key, via)
);

-- ---------------------------------------------------------------------------------------------------------------
-- 5.7 Productos (R3 los usa; el esquema se congela desde R1)
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE kl.product (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key                text NOT NULL UNIQUE CHECK (key ~ '^[a-z0-9_]{2,60}$'),
  kind               text NOT NULL CHECK (kind IN ('guide')),
  country            text NOT NULL CHECK (country ~ '^[A-Z]{2}$'),
  master_locale      text NOT NULL CHECK (master_locale = 'es'),
  locales            text[] NOT NULL DEFAULT ARRAY['es', 'en'],
  review_periodicity kl.cadence NOT NULL DEFAULT 'semiannual',
  next_cycle_at      timestamptz,
  template_key       text,
  theme_key          text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE kl.product_section (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id        uuid NOT NULL REFERENCES kl.product (id),
  section_key       text NOT NULL,
  chapter           text NOT NULL,
  part              text,
  slot              text NOT NULL CHECK (slot IN ('essentials', 'key_data', 'how_it_works', 'obligations', 'decide_with', 'sources')),
  sort_order        integer NOT NULL,
  title_es          text NOT NULL,
  title_en          text NOT NULL,
  content_type      text NOT NULL CHECK (content_type IN ('data', 'guidance', 'obligation', 'generated')),
  category_keys     text[] NOT NULL DEFAULT '{}',
  validation_domain text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, section_key)
);

CREATE TABLE kl.composition_item (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id        uuid NOT NULL REFERENCES kl.product_section (id),
  unit_id           uuid NOT NULL REFERENCES kl.unit (id),
  pinned_version_id uuid REFERENCES kl.unit_version (id),
  sort_order        integer NOT NULL,
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in_review', 'in_specialist_validation', 'approved_es', 'in_translation', 'approved_en', 'requires_review')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (section_id, unit_id)
);

CREATE TABLE kl.edition (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id             uuid NOT NULL REFERENCES kl.product (id),
  code                   text NOT NULL CHECK (code ~ '^[0-9]{4}\.[0-9]{1,2}$'),
  status                 text NOT NULL DEFAULT 'composing' CHECK (status IN ('composing', 'in_approval', 'rendering', 'published', 'superseded', 'unpublished', 'revoked')),
  manifest               jsonb,
  manifest_sha256        text CHECK (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  cutoff_date            date,
  change_report          jsonb,
  composed_by            uuid NOT NULL REFERENCES kl.principal (principal_id),
  approved_by            uuid REFERENCES kl.principal (principal_id),
  published_at           timestamptz,
  superseded_by          uuid REFERENCES kl.edition (id),
  revocation_reason      text CHECK (length(revocation_reason) <= 500),
  verification_id_sha256 text UNIQUE CHECK (verification_id_sha256 ~ '^[0-9a-f]{64}$'),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id, code),
  CONSTRAINT edition_published_needs_manifest CHECK (status IN ('composing', 'in_approval') OR (manifest IS NOT NULL AND manifest_sha256 IS NOT NULL AND approved_by IS NOT NULL))
);

CREATE TABLE kl.edition_rendering (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id             uuid NOT NULL REFERENCES kl.edition (id),
  locale                 text NOT NULL CHECK (locale IN ('es', 'en')),
  report_document_sha256 text NOT NULL CHECK (report_document_sha256 ~ '^[0-9a-f]{64}$'),
  print_html_sha256      text NOT NULL CHECK (print_html_sha256 ~ '^[0-9a-f]{64}$'),
  file_object_id         uuid NOT NULL REFERENCES kl.file_object (id),
  pdf_sha256             text NOT NULL CHECK (pdf_sha256 ~ '^[0-9a-f]{64}$'),
  renderer               text NOT NULL CHECK (renderer ~ '^chromium@'),
  rendered_at            timestamptz NOT NULL,
  UNIQUE (edition_id, locale)
);

CREATE TABLE kl.change_notice (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      uuid NOT NULL REFERENCES kl.product (id),
  unit_id         uuid NOT NULL REFERENCES kl.unit (id),
  from_version_id uuid REFERENCES kl.unit_version (id),
  to_version_id   uuid REFERENCES kl.unit_version (id),
  kind            text NOT NULL CHECK (kind IN ('new_period', 'correction', 'reform_detected', 'validation_expiring', 'withdrawn')),
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved_for_next', 'dismissed')),
  decided_by      uuid REFERENCES kl.principal (principal_id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  decided_at      timestamptz,
  CONSTRAINT notice_decision_pair CHECK ((status = 'pending') = (decided_by IS NULL))
);

CREATE TABLE kl.distribution_daily (
  edition_id uuid NOT NULL REFERENCES kl.edition (id),
  locale     text NOT NULL CHECK (locale IN ('es', 'en')),
  day        date NOT NULL,
  downloads  bigint NOT NULL CHECK (downloads >= 0),
  PRIMARY KEY (edition_id, locale, day)
);

-- ---------------------------------------------------------------------------------------------------------------
-- 5.8 Gobierno · configuración versionada (kl.principal, role_grant y audit_event están en KL-0001)
-- ---------------------------------------------------------------------------------------------------------------
CREATE TABLE kl.setting_version (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL CHECK (key ~ '^kl\.[a-z0-9_.]{2,80}$'),
  version     integer NOT NULL CHECK (version >= 1),
  value       jsonb NOT NULL,
  reference   text CHECK (length(reference) <= 200),
  authored_by uuid NOT NULL REFERENCES kl.principal (principal_id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (key, version)
);

-- Valores seguros por defecto (Code Handoff Pack §4), firmados por la cuenta kl-bootstrap.
SELECT kl.mutation_on();
INSERT INTO kl.setting_version (key, version, value, reference, authored_by) VALUES
  ('kl.r10_claims_enabled', 1, 'false'::jsonb, 'default seguro: CR-KL-001 sin aceptar', '00000000-0000-4000-8000-0000000000a3'),
  ('kl.agents_enabled', 1, 'false'::jsonb, 'default seguro: agentes apagados en R1', '00000000-0000-4000-8000-0000000000a3'),
  ('kl.links.discovery_start', 1, '"https://beeside.you"'::jsonb, 'C9: se cambia al pasar a producción', '00000000-0000-4000-8000-0000000000a3'),
  ('kl.upload.max_bytes', 1, '52428800'::jsonb, 'tamaño máximo inicial: 50 MB', '00000000-0000-4000-8000-0000000000a3');
SELECT kl.mutation_off();
