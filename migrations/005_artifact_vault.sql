CREATE TABLE artifact_retrieval_attempts (
  attempt_id TEXT PRIMARY KEY CHECK (
    length(attempt_id) = 69 AND substr(attempt_id, 1, 5) = 'att1_' AND
    substr(attempt_id, 6) = lower(substr(attempt_id, 6)) AND
    substr(attempt_id, 6) NOT GLOB '*[^0-9a-f]*'
  ),
  staging_id TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL CHECK (
    length(provider) = 69 AND substr(provider, 1, 5) = 'prv1_' AND
    substr(provider, 6) = lower(substr(provider, 6)) AND
    substr(provider, 6) NOT GLOB '*[^0-9a-f]*'
  ),
  provider_record_id TEXT NOT NULL CHECK (
    length(provider_record_id) = 69 AND substr(provider_record_id, 1, 5) = 'rec1_' AND
    substr(provider_record_id, 6) = lower(substr(provider_record_id, 6)) AND
    substr(provider_record_id, 6) NOT GLOB '*[^0-9a-f]*'
  ),
  provider_revision_id TEXT NOT NULL CHECK (
    length(provider_revision_id) = 69 AND substr(provider_revision_id, 1, 5) = 'rev1_' AND
    substr(provider_revision_id, 6) = lower(substr(provider_revision_id, 6)) AND
    substr(provider_revision_id, 6) NOT GLOB '*[^0-9a-f]*'
  ),
  started_at_ms INTEGER NOT NULL CHECK (started_at_ms >= 0),
  recorded_at_ms INTEGER NOT NULL CHECK (recorded_at_ms >= 0),
  request_method TEXT NOT NULL,
  request_origin TEXT NOT NULL,
  request_path_hash TEXT NOT NULL,
  request_route_label TEXT NOT NULL,
  request_identity_hash TEXT NOT NULL,
  attempt_json TEXT NOT NULL,
  attempt_hash TEXT NOT NULL
) STRICT;

CREATE INDEX artifact_attempts_request_identity
  ON artifact_retrieval_attempts (request_identity_hash);

CREATE TABLE artifact_retrieval_outcomes (
  sequence INTEGER PRIMARY KEY,
  attempt_id TEXT NOT NULL UNIQUE CHECK (
    length(attempt_id) = 69 AND substr(attempt_id, 1, 5) = 'att1_' AND
    substr(attempt_id, 6) = lower(substr(attempt_id, 6)) AND
    substr(attempt_id, 6) NOT GLOB '*[^0-9a-f]*'
  ),
  outcome TEXT NOT NULL CHECK (outcome IN ('succeeded', 'failed', 'abandoned', 'expired')),
  completed_at_ms INTEGER NOT NULL CHECK (completed_at_ms >= 0),
  reason_code TEXT,
  detail_hash TEXT,
  outcome_json TEXT NOT NULL,
  outcome_hash TEXT NOT NULL,
  FOREIGN KEY (attempt_id) REFERENCES artifact_retrieval_attempts(attempt_id)
) STRICT;

CREATE TABLE artifact_blobs (
  digest TEXT PRIMARY KEY CHECK (
    length(digest) = 64 AND digest = lower(digest) AND digest NOT GLOB '*[^0-9a-f]*'
  ),
  algorithm TEXT NOT NULL CHECK (algorithm = 'sha256'),
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0 AND size_bytes <= 9007199254740991),
  committed_at_ms INTEGER NOT NULL CHECK (committed_at_ms >= 0),
  provenance TEXT NOT NULL CHECK (provenance IN ('retrieval', 'recovered-orphan')),
  blob_json TEXT NOT NULL,
  blob_hash TEXT NOT NULL
) STRICT;

CREATE TABLE artifact_writer_fence (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  generation INTEGER NOT NULL CHECK (generation > 0),
  owner_token TEXT NOT NULL,
  expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms >= 0)
) STRICT;

CREATE TABLE artifact_install_intents (
  intent_id TEXT PRIMARY KEY CHECK (
    length(intent_id) = 69 AND substr(intent_id, 1, 5) = 'ins1_' AND
    substr(intent_id, 6) = lower(substr(intent_id, 6)) AND
    substr(intent_id, 6) NOT GLOB '*[^0-9a-f]*'
  ),
  attempt_id TEXT NOT NULL UNIQUE,
  staging_id TEXT NOT NULL UNIQUE,
  digest TEXT NOT NULL CHECK (
    length(digest) = 64 AND digest = lower(digest) AND digest NOT GLOB '*[^0-9a-f]*'
  ),
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0 AND size_bytes <= 9007199254740991),
  disposition TEXT NOT NULL CHECK (disposition IN ('new-content', 'preexisting-verified')),
  created_writer_generation INTEGER NOT NULL CHECK (created_writer_generation > 0),
  created_at_ms INTEGER NOT NULL CHECK (created_at_ms >= 0),
  artifact_json TEXT NOT NULL,
  artifact_hash TEXT NOT NULL,
  response_json TEXT NOT NULL,
  response_hash TEXT NOT NULL,
  observation_json TEXT NOT NULL,
  observation_hash TEXT NOT NULL,
  intent_json TEXT NOT NULL,
  intent_hash TEXT NOT NULL,
  FOREIGN KEY (attempt_id) REFERENCES artifact_retrieval_attempts(attempt_id),
  FOREIGN KEY (staging_id) REFERENCES artifact_retrieval_attempts(staging_id)
) STRICT;

CREATE TABLE artifact_install_transitions (
  transition_id TEXT PRIMARY KEY CHECK (
    length(transition_id) = 69 AND substr(transition_id, 1, 5) = 'ist1_' AND
    substr(transition_id, 6) = lower(substr(transition_id, 6)) AND
    substr(transition_id, 6) NOT GLOB '*[^0-9a-f]*'
  ),
  intent_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (
    state IN ('content-installed', 'evidence-committed', 'stage-cleaned', 'aborted')
  ),
  writer_generation INTEGER NOT NULL CHECK (writer_generation > 0),
  transitioned_at_ms INTEGER NOT NULL CHECK (transitioned_at_ms >= 0),
  transition_json TEXT NOT NULL,
  transition_hash TEXT NOT NULL,
  UNIQUE (intent_id, state),
  FOREIGN KEY (intent_id) REFERENCES artifact_install_intents(intent_id)
) STRICT;

CREATE TABLE artifact_observations (
  sequence INTEGER PRIMARY KEY,
  observation_id TEXT NOT NULL UNIQUE,
  attempt_id TEXT NOT NULL UNIQUE CHECK (
    length(attempt_id) = 69 AND substr(attempt_id, 1, 5) = 'att1_' AND
    substr(attempt_id, 6) = lower(substr(attempt_id, 6)) AND
    substr(attempt_id, 6) NOT GLOB '*[^0-9a-f]*'
  ),
  artifact_digest TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (
    length(provider) = 69 AND substr(provider, 1, 5) = 'prv1_' AND
    substr(provider, 6) = lower(substr(provider, 6)) AND
    substr(provider, 6) NOT GLOB '*[^0-9a-f]*'
  ),
  provider_record_id TEXT NOT NULL CHECK (
    length(provider_record_id) = 69 AND substr(provider_record_id, 1, 5) = 'rec1_' AND
    substr(provider_record_id, 6) = lower(substr(provider_record_id, 6)) AND
    substr(provider_record_id, 6) NOT GLOB '*[^0-9a-f]*'
  ),
  provider_revision_id TEXT NOT NULL CHECK (
    length(provider_revision_id) = 69 AND substr(provider_revision_id, 1, 5) = 'rev1_' AND
    substr(provider_revision_id, 6) = lower(substr(provider_revision_id, 6)) AND
    substr(provider_revision_id, 6) NOT GLOB '*[^0-9a-f]*'
  ),
  retrieved_at_ms INTEGER NOT NULL CHECK (retrieved_at_ms >= 0),
  request_method TEXT NOT NULL,
  request_origin TEXT NOT NULL,
  request_path_hash TEXT NOT NULL,
  request_route_label TEXT NOT NULL,
  request_identity_hash TEXT NOT NULL,
  status_code INTEGER NOT NULL CHECK (status_code BETWEEN 100 AND 599),
  etag TEXT,
  last_modified TEXT,
  media_type TEXT,
  content_encoding TEXT,
  declared_content_length INTEGER CHECK (
    declared_content_length IS NULL OR
    (declared_content_length >= 0 AND declared_content_length <= 9007199254740991)
  ),
  transport_decoded INTEGER NOT NULL CHECK (transport_decoded = 1),
  observation_json TEXT NOT NULL,
  observation_hash TEXT NOT NULL,
  FOREIGN KEY (attempt_id) REFERENCES artifact_retrieval_attempts(attempt_id),
  FOREIGN KEY (artifact_digest) REFERENCES artifact_blobs(digest)
) STRICT;

CREATE INDEX artifact_observations_digest_sequence
  ON artifact_observations (artifact_digest, sequence);
CREATE INDEX artifact_observations_provider_revision
  ON artifact_observations (provider, provider_record_id, provider_revision_id, sequence);

CREATE TABLE artifact_reconciliation_action_plans (
  action_key TEXT PRIMARY KEY CHECK (
    length(action_key) = 69 AND substr(action_key, 1, 5) = 'act1_' AND
    substr(action_key, 6) = lower(substr(action_key, 6)) AND
    substr(action_key, 6) NOT GLOB '*[^0-9a-f]*'
  ),
  run_id TEXT NOT NULL CHECK (
    length(run_id) = 68 AND substr(run_id, 1, 4) = 'rr1_' AND
    substr(run_id, 5) = lower(substr(run_id, 5)) AND
    substr(run_id, 5) NOT GLOB '*[^0-9a-f]*'
  ),
  work_key TEXT NOT NULL UNIQUE CHECK (
    length(work_key) = 69 AND substr(work_key, 1, 5) = 'wrk1_' AND
    substr(work_key, 6) = lower(substr(work_key, 6)) AND
    substr(work_key, 6) NOT GLOB '*[^0-9a-f]*'
  ),
  action_kind TEXT NOT NULL CHECK (action_kind IN (
    'quarantine', 'remove-snapshot', 'expire-attempt', 'adopt-orphan',
    'record-missing-content', 'clean-stage', 'abort-install'
  )),
  source_relative_path TEXT,
  source_identity_json TEXT,
  expected_digest TEXT,
  expected_size_bytes INTEGER CHECK (
    expected_size_bytes IS NULL OR
    (expected_size_bytes >= 0 AND expected_size_bytes <= 9007199254740991)
  ),
  incident_id TEXT,
  quarantine_name TEXT,
  planned_phase TEXT NOT NULL,
  planned_shard INTEGER NOT NULL CHECK (planned_shard >= 0 AND planned_shard <= 65536),
  planned_after_key TEXT NOT NULL,
  recorded_at_ms INTEGER NOT NULL CHECK (recorded_at_ms >= 0),
  plan_json TEXT NOT NULL,
  plan_hash TEXT NOT NULL
) STRICT;

CREATE TABLE artifact_integrity_incidents (
  sequence INTEGER PRIMARY KEY,
  incident_id TEXT NOT NULL UNIQUE CHECK (
    length(incident_id) = 69 AND substr(incident_id, 1, 5) = 'inc1_' AND
    substr(incident_id, 6) = lower(substr(incident_id, 6)) AND
    substr(incident_id, 6) NOT GLOB '*[^0-9a-f]*'
  ),
  action_key TEXT UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN (
    'abandoned-stage', 'expired-stage', 'invalid-orphan', 'metadata-less-orphan',
    'missing-content', 'size-mismatch', 'digest-mismatch', 'unsafe-filesystem-object',
    'conflicting-destination', 'snapshot-verification-failure'
  )),
  recorded_at_ms INTEGER NOT NULL CHECK (recorded_at_ms >= 0),
  staging_id TEXT,
  claimed_digest TEXT CHECK (
    claimed_digest IS NULL OR
    (length(claimed_digest) = 64 AND claimed_digest = lower(claimed_digest)
      AND claimed_digest NOT GLOB '*[^0-9a-f]*')
  ),
  expected_size_bytes INTEGER CHECK (
    expected_size_bytes IS NULL OR
    (expected_size_bytes >= 0 AND expected_size_bytes <= 9007199254740991)
  ),
  actual_size_bytes INTEGER CHECK (
    actual_size_bytes IS NULL OR
    (actual_size_bytes >= 0 AND actual_size_bytes <= 9007199254740991)
  ),
  detail_hash TEXT,
  incident_json TEXT NOT NULL,
  incident_hash TEXT NOT NULL,
  FOREIGN KEY (action_key) REFERENCES artifact_reconciliation_action_plans(action_key)
) STRICT;

CREATE INDEX artifact_incidents_kind_sequence
  ON artifact_integrity_incidents (kind, sequence);
CREATE INDEX artifact_incidents_digest_sequence
  ON artifact_integrity_incidents (claimed_digest, sequence);

CREATE TABLE artifact_reconciliation_action_applications (
  action_key TEXT PRIMARY KEY,
  writer_generation INTEGER NOT NULL CHECK (writer_generation > 0),
  applied_at_ms INTEGER NOT NULL CHECK (applied_at_ms >= 0),
  resulting_identity_json TEXT,
  resulting_digest TEXT,
  resulting_size_bytes INTEGER CHECK (
    resulting_size_bytes IS NULL OR
    (resulting_size_bytes >= 0 AND resulting_size_bytes <= 9007199254740991)
  ),
  application_json TEXT NOT NULL,
  application_hash TEXT NOT NULL,
  FOREIGN KEY (action_key) REFERENCES artifact_reconciliation_action_plans(action_key)
) STRICT;

CREATE TABLE artifact_quarantine_receipts (
  action_key TEXT PRIMARY KEY,
  target_name TEXT NOT NULL UNIQUE CHECK (
    length(target_name) = 79 AND substr(target_name, 1, 3) = 'q1_' AND
    substr(target_name, 4, 64) = lower(substr(target_name, 4, 64)) AND
    substr(target_name, 4, 64) NOT GLOB '*[^0-9a-f]*' AND
    substr(target_name, 68) = '.quarantined'
  ),
  target_identity_json TEXT NOT NULL,
  digest TEXT NOT NULL CHECK (
    length(digest) = 64 AND digest = lower(digest) AND digest NOT GLOB '*[^0-9a-f]*'
  ),
  size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0 AND size_bytes <= 9007199254740991),
  receipt_json TEXT NOT NULL,
  receipt_hash TEXT NOT NULL,
  FOREIGN KEY (action_key) REFERENCES artifact_reconciliation_action_plans(action_key)
) STRICT;

CREATE TABLE artifact_reconciliation_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  run_id TEXT NOT NULL UNIQUE CHECK (
    length(run_id) = 68 AND substr(run_id, 1, 4) = 'rr1_' AND
    substr(run_id, 5) = lower(substr(run_id, 5)) AND
    substr(run_id, 5) NOT GLOB '*[^0-9a-f]*'
  ),
  writer_generation INTEGER NOT NULL CHECK (writer_generation > 0),
  generation INTEGER NOT NULL CHECK (generation > 0),
  cursor_epoch INTEGER NOT NULL CHECK (cursor_epoch = generation),
  phase TEXT NOT NULL CHECK (phase IN (
    'attempts', 'outcomes', 'blobs', 'observations', 'incidents', 'install-intents',
    'snapshots', 'staging', 'open-attempts', 'content', 'missing-content'
  )),
  shard INTEGER NOT NULL CHECK (shard >= 0 AND shard <= 65536),
  after_key TEXT NOT NULL,
  pending_action_key TEXT,
  active_call_key TEXT CHECK (
    active_call_key IS NULL OR
    (length(active_call_key) = 69 AND substr(active_call_key, 1, 5) = 'rcl1_' AND
      substr(active_call_key, 6) = lower(substr(active_call_key, 6)) AND
      substr(active_call_key, 6) NOT GLOB '*[^0-9a-f]*')
  ),
  active_call_accepted_token TEXT,
  cursor_token TEXT NOT NULL CHECK (
    length(cursor_token) = 68 AND substr(cursor_token, 1, 4) = 'rc1_' AND
    substr(cursor_token, 5) = lower(substr(cursor_token, 5)) AND
    substr(cursor_token, 5) NOT GLOB '*[^0-9a-f]*'
  ),
  run_nonce TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'terminal')),
  rows_visited INTEGER NOT NULL DEFAULT 0 CHECK (rows_visited >= 0),
  items_processed INTEGER NOT NULL DEFAULT 0 CHECK (items_processed >= 0),
  bytes_hashed INTEGER NOT NULL DEFAULT 0 CHECK (bytes_hashed >= 0),
  directory_entries_read INTEGER NOT NULL DEFAULT 0 CHECK (directory_entries_read >= 0),
  state_json TEXT NOT NULL,
  state_hash TEXT NOT NULL,
  FOREIGN KEY (pending_action_key) REFERENCES artifact_reconciliation_action_plans(action_key)
) STRICT;

CREATE TABLE artifact_reconciliation_receipts (
  call_key TEXT PRIMARY KEY CHECK (
    length(call_key) = 69 AND substr(call_key, 1, 5) = 'rcl1_' AND
    substr(call_key, 6) = lower(substr(call_key, 6)) AND
    substr(call_key, 6) NOT GLOB '*[^0-9a-f]*'
  ),
  run_id TEXT NOT NULL,
  accepted_token TEXT,
  response_token TEXT,
  terminal INTEGER NOT NULL CHECK (terminal IN (0, 1)),
  writer_generation INTEGER NOT NULL CHECK (writer_generation > 0),
  report_json TEXT NOT NULL,
  report_hash TEXT NOT NULL,
  CHECK ((terminal = 1 AND response_token IS NULL) OR (terminal = 0 AND response_token IS NOT NULL))
) STRICT;

CREATE UNIQUE INDEX artifact_reconciliation_receipt_accepted_token
  ON artifact_reconciliation_receipts (accepted_token) WHERE accepted_token IS NOT NULL;

CREATE TRIGGER artifact_attempts_no_update BEFORE UPDATE ON artifact_retrieval_attempts
BEGIN SELECT RAISE(ABORT, 'artifact retrieval attempts are immutable'); END;
CREATE TRIGGER artifact_attempts_no_delete BEFORE DELETE ON artifact_retrieval_attempts
BEGIN SELECT RAISE(ABORT, 'artifact retrieval attempts are immutable'); END;
CREATE TRIGGER artifact_outcomes_no_update BEFORE UPDATE ON artifact_retrieval_outcomes
BEGIN SELECT RAISE(ABORT, 'artifact retrieval outcomes are immutable'); END;
CREATE TRIGGER artifact_outcomes_no_delete BEFORE DELETE ON artifact_retrieval_outcomes
BEGIN SELECT RAISE(ABORT, 'artifact retrieval outcomes are immutable'); END;
CREATE TRIGGER artifact_blobs_no_update BEFORE UPDATE ON artifact_blobs
BEGIN SELECT RAISE(ABORT, 'artifact blobs are immutable'); END;
CREATE TRIGGER artifact_blobs_no_delete BEFORE DELETE ON artifact_blobs
BEGIN SELECT RAISE(ABORT, 'artifact blobs are immutable'); END;
CREATE TRIGGER artifact_install_intents_no_update BEFORE UPDATE ON artifact_install_intents
BEGIN SELECT RAISE(ABORT, 'artifact install intents are immutable'); END;
CREATE TRIGGER artifact_install_intents_no_delete BEFORE DELETE ON artifact_install_intents
BEGIN SELECT RAISE(ABORT, 'artifact install intents are immutable'); END;
CREATE TRIGGER artifact_install_transitions_no_update BEFORE UPDATE ON artifact_install_transitions
BEGIN SELECT RAISE(ABORT, 'artifact install transitions are immutable'); END;
CREATE TRIGGER artifact_install_transitions_no_delete BEFORE DELETE ON artifact_install_transitions
BEGIN SELECT RAISE(ABORT, 'artifact install transitions are immutable'); END;
CREATE TRIGGER artifact_observations_no_update BEFORE UPDATE ON artifact_observations
BEGIN SELECT RAISE(ABORT, 'artifact observations are immutable'); END;
CREATE TRIGGER artifact_observations_no_delete BEFORE DELETE ON artifact_observations
BEGIN SELECT RAISE(ABORT, 'artifact observations are immutable'); END;
CREATE TRIGGER artifact_incidents_no_update BEFORE UPDATE ON artifact_integrity_incidents
BEGIN SELECT RAISE(ABORT, 'artifact incidents are immutable'); END;
CREATE TRIGGER artifact_incidents_no_delete BEFORE DELETE ON artifact_integrity_incidents
BEGIN SELECT RAISE(ABORT, 'artifact incidents are immutable'); END;
CREATE TRIGGER artifact_action_plans_no_update BEFORE UPDATE ON artifact_reconciliation_action_plans
BEGIN SELECT RAISE(ABORT, 'artifact reconciliation action plans are immutable'); END;
CREATE TRIGGER artifact_action_plans_no_delete BEFORE DELETE ON artifact_reconciliation_action_plans
BEGIN SELECT RAISE(ABORT, 'artifact reconciliation action plans are immutable'); END;
CREATE TRIGGER artifact_action_applications_no_update BEFORE UPDATE ON artifact_reconciliation_action_applications
BEGIN SELECT RAISE(ABORT, 'artifact reconciliation action applications are immutable'); END;
CREATE TRIGGER artifact_action_applications_no_delete BEFORE DELETE ON artifact_reconciliation_action_applications
BEGIN SELECT RAISE(ABORT, 'artifact reconciliation action applications are immutable'); END;
CREATE TRIGGER artifact_quarantine_receipts_no_update BEFORE UPDATE ON artifact_quarantine_receipts
BEGIN SELECT RAISE(ABORT, 'artifact quarantine receipts are immutable'); END;
CREATE TRIGGER artifact_quarantine_receipts_no_delete BEFORE DELETE ON artifact_quarantine_receipts
BEGIN SELECT RAISE(ABORT, 'artifact quarantine receipts are immutable'); END;
CREATE TRIGGER artifact_reconciliation_receipts_no_update BEFORE UPDATE ON artifact_reconciliation_receipts
BEGIN SELECT RAISE(ABORT, 'artifact reconciliation receipts are immutable'); END;
CREATE TRIGGER artifact_reconciliation_receipts_no_delete BEFORE DELETE ON artifact_reconciliation_receipts
BEGIN SELECT RAISE(ABORT, 'artifact reconciliation receipts are immutable'); END;
