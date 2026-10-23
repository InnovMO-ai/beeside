-- Edition series: a publication keeps one series title and a new edition supersedes the previous one. An OLDER edition ingested after a newer one
-- is stored as historical (superseded by the newer edition). Supersession is therefore allowed by newer VERSION or by later EDITION; nothing is
-- ever deleted or rewritten.
CREATE OR REPLACE FUNCTION knowledge_supersession_guard() RETURNS TRIGGER AS $$
DECLARE n knowledge_document%ROWTYPE;
BEGIN
  IF NEW.superseded_by_id IS NOT NULL AND (OLD.superseded_by_id IS DISTINCT FROM NEW.superseded_by_id) THEN
    SELECT * INTO n FROM knowledge_document WHERE id = NEW.superseded_by_id;
    IF n.id IS NULL OR n.source_id <> NEW.source_id OR n.title <> NEW.title OR (n.version <= NEW.version AND n.edition COLLATE "C" <= NEW.edition COLLATE "C") THEN
      RAISE EXCEPTION 'knowledge_document % can only be superseded by a newer version or edition of the same publication', NEW.id USING ERRCODE = 'BV409';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
