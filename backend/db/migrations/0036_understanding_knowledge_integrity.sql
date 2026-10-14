-- Precision V1.0 — integrity rules for the Understanding frame, the Knowledge Service and the Country Resource Library (follows 0035).

-- ---------------------------------------------------------------------------------------------------------------------
-- Knowledge: accent-insensitive Spanish full-text search over passages (the application folds the query the same way).
-- ---------------------------------------------------------------------------------------------------------------------
CREATE FUNCTION knowledge_fold(t TEXT) RETURNS TEXT AS $$
  SELECT translate(lower(t), 'áéíóúüñàèìòùâêîôû', 'aeiouunaeiouaeiou');
$$ LANGUAGE sql IMMUTABLE;--> statement-breakpoint
ALTER TABLE "knowledge_passage" ADD COLUMN "tsv" tsvector GENERATED ALWAYS AS (to_tsvector('spanish', knowledge_fold("text"))) STORED;--> statement-breakpoint
CREATE INDEX "knowledge_passage_tsv" ON "knowledge_passage" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "knowledge_passage_topics" ON "knowledge_passage" USING gin ("topics");--> statement-breakpoint
CREATE INDEX "knowledge_passage_units" ON "knowledge_passage" USING gin ("units");--> statement-breakpoint

-- A passage belongs to a document of the same source, and is immutable (a new edition is a new document, never an overwrite).
CREATE FUNCTION knowledge_passage_guard() RETURNS TRIGGER AS $$
DECLARE v_source TEXT;
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'knowledge_passage rows are immutable (a new edition is a new document)' USING ERRCODE = 'BV409'; END IF;
  SELECT source_id INTO v_source FROM knowledge_document WHERE id = NEW.document_id;
  IF v_source IS DISTINCT FROM NEW.source_id THEN
    RAISE EXCEPTION 'knowledge_passage source does not match its document' USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER knowledge_passage_guard_trigger BEFORE INSERT OR UPDATE OR DELETE ON knowledge_passage
  FOR EACH ROW EXECUTE FUNCTION knowledge_passage_guard();--> statement-breakpoint

-- A document is immutable except its supersession: active -> superseded (once, with the superseding document), or -> withdrawn.
CREATE FUNCTION knowledge_document_guard() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'knowledge_document rows are never deleted' USING ERRCODE = 'BV409'; END IF;
  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
  IF (NEW.id, NEW.source_id, NEW.title, NEW.edition, NEW.version, NEW.published_at, NEW.effective_at, NEW.retrieved_at, NEW.jurisdiction, NEW.topics, NEW.locator, NEW.content_hash, NEW.confidence, NEW.language)
     IS DISTINCT FROM (OLD.id, OLD.source_id, OLD.title, OLD.edition, OLD.version, OLD.published_at, OLD.effective_at, OLD.retrieved_at, OLD.jurisdiction, OLD.topics, OLD.locator, OLD.content_hash, OLD.confidence, OLD.language) THEN
    RAISE EXCEPTION 'knowledge_document % is immutable except its supersession/withdrawal', OLD.id USING ERRCODE = 'BV409';
  END IF;
  IF OLD.status <> 'active' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'knowledge_document % is already % and cannot change state', OLD.id, OLD.status USING ERRCODE = 'BV409';
  END IF;
  IF OLD.superseded_by_id IS NOT NULL AND NEW.superseded_by_id IS DISTINCT FROM OLD.superseded_by_id THEN
    RAISE EXCEPTION 'knowledge_document % is already superseded', OLD.id USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER knowledge_document_guard_trigger BEFORE INSERT OR UPDATE OR DELETE ON knowledge_document
  FOR EACH ROW EXECUTE FUNCTION knowledge_document_guard();--> statement-breakpoint

-- The document and its passages are inserted in one transaction, but the superseding document must be of the SAME source and title.
CREATE FUNCTION knowledge_supersession_guard() RETURNS TRIGGER AS $$
DECLARE n knowledge_document%ROWTYPE;
BEGIN
  IF NEW.superseded_by_id IS NOT NULL AND (OLD.superseded_by_id IS DISTINCT FROM NEW.superseded_by_id) THEN
    SELECT * INTO n FROM knowledge_document WHERE id = NEW.superseded_by_id;
    IF n.id IS NULL OR n.source_id <> NEW.source_id OR n.title <> NEW.title OR n.version <= NEW.version THEN
      RAISE EXCEPTION 'knowledge_document % can only be superseded by a newer version of the same publication', NEW.id USING ERRCODE = 'BV409';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER knowledge_supersession_guard_trigger BEFORE UPDATE ON knowledge_document
  FOR EACH ROW EXECUTE FUNCTION knowledge_supersession_guard();--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------------
-- Understanding frame events: append-only; the only authorised DELETE path is the privacy erasure (table-aware, project-scoped).
-- ---------------------------------------------------------------------------------------------------------------------
CREATE FUNCTION understanding_frame_event_guard() RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' AND privacy_erasure_authorized(TG_TABLE_NAME, to_jsonb(OLD)) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'understanding_frame_event rows are append-only' USING ERRCODE = 'BV409';
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER understanding_frame_event_guard_trigger BEFORE UPDATE OR DELETE ON understanding_frame_event
  FOR EACH ROW EXECUTE FUNCTION understanding_frame_event_guard();--> statement-breakpoint
REVOKE UPDATE ON "understanding_frame_event" FROM beeside_runtime_role;--> statement-breakpoint

-- The frame can only move forward: version increases by exactly one per write (optimistic concurrency is also enforced here).
CREATE FUNCTION understanding_frame_guard() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.project_id <> OLD.project_id THEN RAISE EXCEPTION 'understanding_frame project is immutable' USING ERRCODE = 'BV409'; END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'understanding_frame version must advance by one (stale write for project %)', OLD.project_id USING ERRCODE = 'BV409';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER understanding_frame_guard_trigger BEFORE UPDATE ON understanding_frame
  FOR EACH ROW EXECUTE FUNCTION understanding_frame_guard();--> statement-breakpoint

-- ---------------------------------------------------------------------------------------------------------------------
-- Privacy erasure registry: classify the new tables (the inventory test fails on an unclassified table).
-- ---------------------------------------------------------------------------------------------------------------------
ALTER TABLE privacy_erasure_registry DISABLE TRIGGER privacy_registry_guard_trigger;--> statement-breakpoint
INSERT INTO privacy_erasure_registry (table_name, data_class, action, erase_order, project_predicate, reason) VALUES
  ('understanding_frame_event', 'precision_content', 'erase', 82, NULL, NULL),
  ('understanding_frame', 'precision_content', 'erase', 84, NULL, NULL),
  ('knowledge_source', 'global', 'global', NULL, NULL, 'knowledge governance (registry of approved sources, not project data)'),
  ('knowledge_document', 'global', 'global', NULL, NULL, 'published institutional knowledge, not project data'),
  ('knowledge_passage', 'global', 'global', NULL, NULL, 'published institutional knowledge, not project data'),
  ('knowledge_candidate', 'global', 'global', NULL, NULL, 'candidate updates to published knowledge, not project data'),
  ('country_resource', 'global', 'global', NULL, NULL, 'configured country guides, not project data');--> statement-breakpoint
ALTER TABLE privacy_erasure_registry ENABLE TRIGGER privacy_registry_guard_trigger;
