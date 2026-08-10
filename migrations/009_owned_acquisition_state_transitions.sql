CREATE TABLE market_acquisition_owned_state_transitions (
  market_acquisition_journal_id TEXT NOT NULL,
  transition_sequence INTEGER NOT NULL CHECK (transition_sequence >= 0),
  request_identity_hash TEXT NOT NULL,
  acquisition_configuration_hash TEXT NOT NULL,
  event_kind TEXT NOT NULL,
  event_json TEXT NOT NULL,
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  checkpoint_kind TEXT,
  next_snapshot_json TEXT NOT NULL,
  transition_hash TEXT NOT NULL UNIQUE,
  PRIMARY KEY (market_acquisition_journal_id, transition_sequence)
) STRICT;

CREATE TRIGGER market_acquisition_owned_state_transitions_no_update
BEFORE UPDATE ON market_acquisition_owned_state_transitions
BEGIN SELECT RAISE(ABORT, 'owned acquisition state transition is immutable'); END;

CREATE TABLE market_acquisition_owned_transition_journal_links (
  transition_hash TEXT PRIMARY KEY,
  journal_entry_hash TEXT NOT NULL UNIQUE,
  FOREIGN KEY (transition_hash)
    REFERENCES market_acquisition_owned_state_transitions(transition_hash)
) STRICT;

CREATE TRIGGER market_acquisition_owned_transition_journal_links_no_update
BEFORE UPDATE ON market_acquisition_owned_transition_journal_links
BEGIN SELECT RAISE(ABORT, 'owned transition journal link is immutable'); END;

CREATE TRIGGER market_acquisition_owned_transition_journal_links_no_delete
BEFORE DELETE ON market_acquisition_owned_transition_journal_links
BEGIN SELECT RAISE(ABORT, 'owned transition journal link is immutable'); END;

CREATE TRIGGER market_acquisition_owned_state_transitions_no_delete
BEFORE DELETE ON market_acquisition_owned_state_transitions
BEGIN SELECT RAISE(ABORT, 'owned acquisition state transition is immutable'); END;
