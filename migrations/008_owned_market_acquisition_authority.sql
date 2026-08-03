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
  acquisition_id TEXT NOT NULL,
  request_identity_hash TEXT NOT NULL,
  acquisition_configuration_hash TEXT NOT NULL,
  acquisition_started_ms INTEGER NOT NULL CHECK (acquisition_started_ms >= 0),
  attempt_started_ms INTEGER NOT NULL CHECK (attempt_started_ms >= acquisition_started_ms),
  attempt_ordinal INTEGER NOT NULL CHECK (attempt_ordinal >= 0 AND attempt_ordinal < 48),
  attempt_budget_ms INTEGER NOT NULL CHECK (attempt_budget_ms >= 1 AND attempt_budget_ms <= 30000),
  retrieval_attempt_id TEXT NOT NULL UNIQUE,
  acquisition_observation_id TEXT NOT NULL UNIQUE,
  UNIQUE (acquisition_id, attempt_ordinal),
  FOREIGN KEY (workflow_id) REFERENCES market_acquisition_owned_request_started(workflow_id)
) STRICT;

CREATE INDEX market_acquisition_owned_attempt_claims_rate_window
ON market_acquisition_owned_attempt_claims (attempt_started_ms);

CREATE INDEX market_acquisition_owned_attempt_claims_acquisition
ON market_acquisition_owned_attempt_claims (acquisition_id, attempt_ordinal);

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
