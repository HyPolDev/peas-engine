CREATE TABLE artifact_retrieval_attempts (
  attempt_id TEXT PRIMARY KEY CHECK (
    length(attempt_id) = 69 AND substr(attempt_id, 1, 5) = 'att1_' AND
    substr(attempt_id, 6) = lower(substr(attempt_id, 6)) AND
    substr(attempt_id, 6) NOT GLOB '*[^0-9a-f]*'
  ),
  staging_id TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL CHECK (
    length(provider) = 69 AND substr(provider, 1, 5) = 'prv1_' AND
    substr(provider, 6) NOT GLOB '*[^0-9a-f]*'
  ),
  provider_record_id TEXT NOT NULL CHECK (
    length(provider_record_id) = 69 AND substr(provider_record_id, 1, 5) = 'rec1_' AND
    substr(provider_record_id, 6) NOT GLOB '*[^0-9a-f]*'
  ),
  provider_revision_id TEXT NOT NULL CHECK (
    length(provider_revision_id) = 69 AND substr(provider_revision_id, 1, 5) = 'rev1_' AND
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

CREATE TABLE artifact_reconciliation_state (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  generation INTEGER NOT NULL CHECK (generation > 0),
  phase TEXT NOT NULL CHECK (phase IN (
    'attempts', 'outcomes', 'blobs', 'observations', 'incidents',
    'snapshots', 'staging', 'open-attempts', 'content', 'missing-content'
  )),
  shard INTEGER NOT NULL CHECK (shard >= 0 AND shard <= 65536),
  after_key TEXT NOT NULL,
  cursor_token TEXT NOT NULL CHECK (
    length(cursor_token) = 64 AND cursor_token = lower(cursor_token) AND
    cursor_token NOT GLOB '*[^0-9a-f]*'
  ),
  state_json TEXT NOT NULL,
  state_hash TEXT NOT NULL
) STRICT;

CREATE TABLE artifact_observations (
  sequence INTEGER PRIMARY KEY,
  observation_id TEXT NOT NULL UNIQUE,
  attempt_id TEXT NOT NULL UNIQUE CHECK (
    length(attempt_id) = 69 AND substr(attempt_id, 1, 5) = 'att1_' AND
    substr(attempt_id, 6) NOT GLOB '*[^0-9a-f]*'
  ),
  artifact_digest TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (
    length(provider) = 69 AND substr(provider, 1, 5) = 'prv1_' AND
    substr(provider, 6) NOT GLOB '*[^0-9a-f]*'
  ),
  provider_record_id TEXT NOT NULL CHECK (
    length(provider_record_id) = 69 AND substr(provider_record_id, 1, 5) = 'rec1_' AND
    substr(provider_record_id, 6) NOT GLOB '*[^0-9a-f]*'
  ),
  provider_revision_id TEXT NOT NULL CHECK (
    length(provider_revision_id) = 69 AND substr(provider_revision_id, 1, 5) = 'rev1_' AND
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

CREATE TABLE artifact_integrity_incidents (
  sequence INTEGER PRIMARY KEY,
  incident_id TEXT NOT NULL UNIQUE,
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
  incident_hash TEXT NOT NULL
) STRICT;

CREATE INDEX artifact_incidents_kind_sequence
  ON artifact_integrity_incidents (kind, sequence);
CREATE INDEX artifact_incidents_digest_sequence
  ON artifact_integrity_incidents (claimed_digest, sequence);

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
CREATE TRIGGER artifact_observations_no_update BEFORE UPDATE ON artifact_observations
BEGIN SELECT RAISE(ABORT, 'artifact observations are immutable'); END;
CREATE TRIGGER artifact_observations_no_delete BEFORE DELETE ON artifact_observations
BEGIN SELECT RAISE(ABORT, 'artifact observations are immutable'); END;
CREATE TRIGGER artifact_incidents_no_update BEFORE UPDATE ON artifact_integrity_incidents
BEGIN SELECT RAISE(ABORT, 'artifact incidents are immutable'); END;
CREATE TRIGGER artifact_incidents_no_delete BEFORE DELETE ON artifact_integrity_incidents
BEGIN SELECT RAISE(ABORT, 'artifact incidents are immutable'); END;
