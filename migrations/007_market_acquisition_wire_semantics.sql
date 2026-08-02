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

CREATE TABLE market_acquisition_ledger_entries (
  market_acquisition_journal_id TEXT NOT NULL,
  execution_id TEXT NOT NULL,
  ledger_sequence INTEGER NOT NULL CHECK (ledger_sequence >= 0),
  entry_id TEXT NOT NULL,
  entry_json TEXT NOT NULL,
  entry_hash TEXT NOT NULL,
  PRIMARY KEY (market_acquisition_journal_id, ledger_sequence),
  UNIQUE (market_acquisition_journal_id, entry_id)
) STRICT;

CREATE TRIGGER market_acquisition_ledger_entries_no_update
BEFORE UPDATE ON market_acquisition_ledger_entries
BEGIN SELECT RAISE(ABORT, 'market acquisition ledger is immutable'); END;

CREATE TRIGGER market_acquisition_ledger_entries_no_delete
BEFORE DELETE ON market_acquisition_ledger_entries
BEGIN SELECT RAISE(ABORT, 'market acquisition ledger is immutable'); END;

CREATE TABLE market_acquisition_workflow_journal_proofs (
  market_acquisition_journal_id TEXT NOT NULL,
  journal_entry_hash TEXT NOT NULL,
  PRIMARY KEY (market_acquisition_journal_id, journal_entry_hash)
) STRICT;

CREATE TABLE market_acquisition_workflow_ledger_proofs (
  market_acquisition_journal_id TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  PRIMARY KEY (market_acquisition_journal_id, entry_id)
) STRICT;

CREATE TRIGGER market_acquisition_workflow_journal_proofs_owned_insert
BEFORE INSERT ON market_acquisition_workflow_journal_proofs
WHEN peas_acquisition_workflow_proof_authorized(NEW.market_acquisition_journal_id) <> 1
BEGIN SELECT RAISE(ABORT, 'acquisition workflow proof write denied'); END;

CREATE TRIGGER market_acquisition_workflow_ledger_proofs_owned_insert
BEFORE INSERT ON market_acquisition_workflow_ledger_proofs
WHEN peas_acquisition_workflow_proof_authorized(NEW.market_acquisition_journal_id) <> 1
BEGIN SELECT RAISE(ABORT, 'acquisition workflow proof write denied'); END;

CREATE TRIGGER market_acquisition_workflow_journal_proofs_no_update
BEFORE UPDATE ON market_acquisition_workflow_journal_proofs
BEGIN SELECT RAISE(ABORT, 'acquisition workflow proof is immutable'); END;

CREATE TRIGGER market_acquisition_workflow_journal_proofs_no_delete
BEFORE DELETE ON market_acquisition_workflow_journal_proofs
BEGIN SELECT RAISE(ABORT, 'acquisition workflow proof is immutable'); END;

CREATE TRIGGER market_acquisition_workflow_ledger_proofs_no_update
BEFORE UPDATE ON market_acquisition_workflow_ledger_proofs
BEGIN SELECT RAISE(ABORT, 'acquisition workflow proof is immutable'); END;

CREATE TRIGGER market_acquisition_workflow_ledger_proofs_no_delete
BEFORE DELETE ON market_acquisition_workflow_ledger_proofs
BEGIN SELECT RAISE(ABORT, 'acquisition workflow proof is immutable'); END;
