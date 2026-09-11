CREATE TABLE research_manifests (
  id TEXT PRIMARY KEY,
  epoch TEXT NOT NULL UNIQUE,
  body TEXT NOT NULL CHECK(json_valid(body))
) STRICT;
CREATE TABLE research_records (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  manifest_id TEXT NOT NULL REFERENCES research_manifests(id),
  kind TEXT NOT NULL CHECK(kind IN ('attempt-start','attempt-end','features','labels','trials','signals','evaluation')),
  record_key TEXT NOT NULL,
  body TEXT NOT NULL CHECK(json_valid(body)),
  UNIQUE(manifest_id, kind, record_key)
) STRICT;
CREATE TRIGGER research_manifests_no_update BEFORE UPDATE ON research_manifests
BEGIN SELECT RAISE(ABORT, 'research manifest is immutable'); END;
CREATE TRIGGER research_manifests_no_delete BEFORE DELETE ON research_manifests
BEGIN SELECT RAISE(ABORT, 'research manifest is immutable'); END;
CREATE TRIGGER research_records_no_update BEFORE UPDATE ON research_records
BEGIN SELECT RAISE(ABORT, 'research records are append-only'); END;
CREATE TRIGGER research_records_no_delete BEFORE DELETE ON research_records
BEGIN SELECT RAISE(ABORT, 'research records are append-only'); END;
CREATE TRIGGER research_manifests_no_replace BEFORE INSERT ON research_manifests
WHEN EXISTS (SELECT 1 FROM research_manifests WHERE id = NEW.id OR epoch = NEW.epoch)
BEGIN SELECT RAISE(ABORT, 'research manifest is immutable'); END;
CREATE TRIGGER research_records_no_replace BEFORE INSERT ON research_records
WHEN EXISTS (SELECT 1 FROM research_records WHERE id = NEW.id OR sequence = NEW.sequence
  OR (manifest_id = NEW.manifest_id AND kind = NEW.kind AND record_key = NEW.record_key))
BEGIN SELECT RAISE(ABORT, 'research records are append-only'); END;
