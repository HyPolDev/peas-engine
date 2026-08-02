CREATE TABLE market_acquisition_owned_request_started (
  workflow_id TEXT PRIMARY KEY,
  request_identity_hash TEXT NOT NULL,
  retrieval_attempt_id TEXT NOT NULL,
  acquisition_observation_id TEXT NOT NULL,
  journal_json TEXT NOT NULL,
  ledger_json TEXT NOT NULL,
  workflow_hash TEXT NOT NULL
) STRICT;

CREATE TABLE market_acquisition_owned_attempt_claims (
  workflow_id TEXT PRIMARY KEY,
  FOREIGN KEY (workflow_id) REFERENCES market_acquisition_owned_request_started(workflow_id)
) STRICT;

CREATE TRIGGER market_acquisition_owned_request_started_no_update
BEFORE UPDATE ON market_acquisition_owned_request_started
BEGIN SELECT RAISE(ABORT, 'owned request-started evidence is immutable'); END;

CREATE TRIGGER market_acquisition_owned_request_started_no_delete
BEFORE DELETE ON market_acquisition_owned_request_started
BEGIN SELECT RAISE(ABORT, 'owned request-started evidence is immutable'); END;

CREATE TRIGGER market_acquisition_owned_attempt_claims_no_update
BEFORE UPDATE ON market_acquisition_owned_attempt_claims
BEGIN SELECT RAISE(ABORT, 'owned attempt claim is immutable'); END;

CREATE TRIGGER market_acquisition_owned_attempt_claims_no_delete
BEFORE DELETE ON market_acquisition_owned_attempt_claims
BEGIN SELECT RAISE(ABORT, 'owned attempt claim is immutable'); END;
