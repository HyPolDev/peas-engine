CREATE TABLE market_acquisition_wire_semantic_evidence (
  evidence_id TEXT PRIMARY KEY,
  journal_entry_hash TEXT NOT NULL UNIQUE,
  market_acquisition_journal_id TEXT NOT NULL,
  artifact_observation_id TEXT NOT NULL,
  artifact_digest TEXT NOT NULL,
  artifact_size_bytes INTEGER NOT NULL CHECK (artifact_size_bytes >= 0),
  stage_ledger_fact_id TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  evidence_hash TEXT NOT NULL
) STRICT;

CREATE TRIGGER market_acquisition_wire_semantics_no_update
BEFORE UPDATE ON market_acquisition_wire_semantic_evidence
BEGIN SELECT RAISE(ABORT, 'wire semantic evidence is immutable'); END;

CREATE TRIGGER market_acquisition_wire_semantics_no_delete
BEFORE DELETE ON market_acquisition_wire_semantic_evidence
BEGIN SELECT RAISE(ABORT, 'wire semantic evidence is immutable'); END;
