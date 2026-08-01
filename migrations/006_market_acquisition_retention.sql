CREATE TABLE market_retention_policies (
  policy_id TEXT PRIMARY KEY,
  provider_lane TEXT NOT NULL CHECK (provider_lane IN ('alpaca', 'fmp')),
  maximum_retention_ms INTEGER NOT NULL CHECK (maximum_retention_ms >= 0),
  stop_grace_ms INTEGER NOT NULL CHECK (stop_grace_ms >= 0),
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  policy_json TEXT NOT NULL,
  policy_hash TEXT NOT NULL
) STRICT;

CREATE TABLE market_retention_ownership (
  ownership_id TEXT PRIMARY KEY,
  policy_id TEXT NOT NULL,
  provider_lane TEXT NOT NULL CHECK (provider_lane IN ('alpaca', 'fmp')),
  provider_id TEXT NOT NULL,
  dataset_id TEXT NOT NULL,
  feed_id TEXT NOT NULL,
  endpoint_channel_id TEXT NOT NULL,
  artifact_observation_id TEXT NOT NULL,
  artifact_digest TEXT NOT NULL CHECK (
    length(artifact_digest) = 64 AND artifact_digest = lower(artifact_digest)
    AND artifact_digest NOT GLOB '*[^0-9a-f]*'
  ),
  artifact_size_bytes INTEGER NOT NULL CHECK (
    artifact_size_bytes >= 0 AND artifact_size_bytes <= 9007199254740991
  ),
  trusted_capture_ms INTEGER NOT NULL CHECK (trusted_capture_ms >= 0),
  expires_at_ms INTEGER NOT NULL CHECK (expires_at_ms >= trusted_capture_ms),
  ownership_json TEXT NOT NULL,
  ownership_hash TEXT NOT NULL,
  UNIQUE (policy_id, artifact_observation_id),
  FOREIGN KEY (policy_id) REFERENCES market_retention_policies(policy_id)
) STRICT;

CREATE INDEX market_retention_ownership_provider
  ON market_retention_ownership (provider_lane, provider_id, ownership_id);
CREATE INDEX market_retention_ownership_digest
  ON market_retention_ownership (artifact_digest, ownership_id);

CREATE TABLE market_retention_derivation_ownership (
  ownership_id TEXT NOT NULL,
  derived_id TEXT NOT NULL,
  PRIMARY KEY (ownership_id, derived_id),
  FOREIGN KEY (ownership_id) REFERENCES market_retention_ownership(ownership_id)
) STRICT;

CREATE TABLE market_retention_stop_events (
  stop_event_id TEXT PRIMARY KEY,
  policy_id TEXT NOT NULL,
  provider_lane TEXT NOT NULL CHECK (provider_lane IN ('alpaca', 'fmp')),
  provider_id TEXT NOT NULL,
  effective_at_ms INTEGER NOT NULL CHECK (effective_at_ms >= 0),
  deadline_ms INTEGER NOT NULL CHECK (deadline_ms >= effective_at_ms),
  reason TEXT NOT NULL CHECK (reason IN (
    'maximum-retention', 'account-closure', 'owner-revocation', 'provider-guidance',
    'classification-loss', 'subscription-termination', 'attestation-expired'
  )),
  stop_json TEXT NOT NULL,
  stop_hash TEXT NOT NULL,
  FOREIGN KEY (policy_id) REFERENCES market_retention_policies(policy_id)
) STRICT;

CREATE TABLE market_retention_provider_denials (
  stop_event_id TEXT PRIMARY KEY,
  provider_lane TEXT NOT NULL CHECK (provider_lane IN ('alpaca', 'fmp')),
  provider_id TEXT NOT NULL,
  effective_at_ms INTEGER NOT NULL CHECK (effective_at_ms >= 0),
  UNIQUE (provider_lane, provider_id),
  FOREIGN KEY (stop_event_id) REFERENCES market_retention_stop_events(stop_event_id)
) STRICT;

CREATE TABLE market_retention_digest_denials (
  stop_event_id TEXT NOT NULL,
  artifact_digest TEXT NOT NULL CHECK (
    length(artifact_digest) = 64 AND artifact_digest = lower(artifact_digest)
    AND artifact_digest NOT GLOB '*[^0-9a-f]*'
  ),
  PRIMARY KEY (stop_event_id, artifact_digest),
  FOREIGN KEY (stop_event_id) REFERENCES market_retention_stop_events(stop_event_id)
) STRICT;

CREATE UNIQUE INDEX market_retention_digest_denial_unique
  ON market_retention_digest_denials (artifact_digest);

CREATE TABLE market_retention_derivation_denials (
  stop_event_id TEXT NOT NULL,
  derived_id TEXT NOT NULL,
  PRIMARY KEY (stop_event_id, derived_id),
  FOREIGN KEY (stop_event_id) REFERENCES market_retention_stop_events(stop_event_id)
) STRICT;

CREATE UNIQUE INDEX market_retention_derivation_denial_unique
  ON market_retention_derivation_denials (derived_id);

CREATE TABLE market_retention_erasure_plans (
  plan_id TEXT PRIMARY KEY,
  plan_hash TEXT NOT NULL UNIQUE,
  policy_id TEXT NOT NULL,
  provider_lane TEXT NOT NULL CHECK (provider_lane IN ('alpaca', 'fmp')),
  provider_id TEXT NOT NULL,
  stop_event_id TEXT NOT NULL UNIQUE,
  effective_at_ms INTEGER NOT NULL CHECK (effective_at_ms >= 0),
  deadline_ms INTEGER NOT NULL CHECK (deadline_ms >= effective_at_ms),
  predecessor_receipt_id TEXT,
  plan_json TEXT NOT NULL,
  FOREIGN KEY (policy_id) REFERENCES market_retention_policies(policy_id),
  FOREIGN KEY (stop_event_id) REFERENCES market_retention_stop_events(stop_event_id)
) STRICT;

CREATE TABLE market_retention_erasure_attempts (
  attempt_id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  artifact_digest TEXT NOT NULL,
  attempt_ordinal INTEGER NOT NULL CHECK (attempt_ordinal >= 0),
  started_at_ms INTEGER NOT NULL CHECK (started_at_ms >= 0),
  outcome TEXT NOT NULL CHECK (outcome IN ('started', 'erased', 'already-absent', 'failed')),
  attempt_json TEXT NOT NULL,
  attempt_hash TEXT NOT NULL,
  UNIQUE (plan_id, artifact_digest, attempt_ordinal, outcome),
  FOREIGN KEY (plan_id) REFERENCES market_retention_erasure_plans(plan_id)
) STRICT;

CREATE TABLE market_retention_artifact_tombstones (
  tombstone_id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  artifact_digest TEXT NOT NULL UNIQUE,
  recorded_at_ms INTEGER NOT NULL CHECK (recorded_at_ms >= 0),
  tombstone_json TEXT NOT NULL,
  tombstone_hash TEXT NOT NULL,
  FOREIGN KEY (plan_id) REFERENCES market_retention_erasure_plans(plan_id)
) STRICT;

CREATE TABLE market_retention_erasure_receipts (
  receipt_id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL UNIQUE,
  plan_hash TEXT NOT NULL,
  prior_size_bytes INTEGER NOT NULL CHECK (prior_size_bytes >= 0),
  attempt_count INTEGER NOT NULL CHECK (attempt_count >= 0),
  outcome TEXT NOT NULL CHECK (outcome = 'verified-erased'),
  completed_at_ms INTEGER NOT NULL CHECK (completed_at_ms >= 0),
  receipt_json TEXT NOT NULL,
  receipt_hash TEXT NOT NULL,
  FOREIGN KEY (plan_id) REFERENCES market_retention_erasure_plans(plan_id)
) STRICT;

CREATE TABLE market_retention_checkpoints (
  checkpoint_id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL UNIQUE,
  receipt_id TEXT NOT NULL UNIQUE,
  sequence INTEGER NOT NULL CHECK (sequence >= 0),
  completed_at_ms INTEGER NOT NULL CHECK (completed_at_ms >= 0),
  checkpoint_json TEXT NOT NULL,
  checkpoint_hash TEXT NOT NULL,
  FOREIGN KEY (plan_id) REFERENCES market_retention_erasure_plans(plan_id),
  FOREIGN KEY (receipt_id) REFERENCES market_retention_erasure_receipts(receipt_id)
) STRICT;

CREATE TRIGGER market_retention_policies_no_update BEFORE UPDATE ON market_retention_policies
BEGIN SELECT RAISE(ABORT, 'retention policies are immutable'); END;
CREATE TRIGGER market_retention_policies_no_delete BEFORE DELETE ON market_retention_policies
BEGIN SELECT RAISE(ABORT, 'retention policies are immutable'); END;
CREATE TRIGGER market_retention_ownership_no_update BEFORE UPDATE ON market_retention_ownership
BEGIN SELECT RAISE(ABORT, 'retention ownership is immutable'); END;
CREATE TRIGGER market_retention_ownership_no_delete BEFORE DELETE ON market_retention_ownership
BEGIN SELECT RAISE(ABORT, 'retention ownership is immutable'); END;
CREATE TRIGGER market_retention_derivation_ownership_no_update BEFORE UPDATE ON market_retention_derivation_ownership
BEGIN SELECT RAISE(ABORT, 'retention derivation ownership is immutable'); END;
CREATE TRIGGER market_retention_derivation_ownership_no_delete BEFORE DELETE ON market_retention_derivation_ownership
BEGIN SELECT RAISE(ABORT, 'retention derivation ownership is immutable'); END;
CREATE TRIGGER market_retention_stop_no_update BEFORE UPDATE ON market_retention_stop_events
BEGIN SELECT RAISE(ABORT, 'retention stop events are immutable'); END;
CREATE TRIGGER market_retention_stop_no_delete BEFORE DELETE ON market_retention_stop_events
BEGIN SELECT RAISE(ABORT, 'retention stop events are immutable'); END;
CREATE TRIGGER market_retention_provider_denials_no_update BEFORE UPDATE ON market_retention_provider_denials
BEGIN SELECT RAISE(ABORT, 'retention provider denials are immutable'); END;
CREATE TRIGGER market_retention_provider_denials_no_delete BEFORE DELETE ON market_retention_provider_denials
BEGIN SELECT RAISE(ABORT, 'retention provider denials are immutable'); END;
CREATE TRIGGER market_retention_digest_denials_no_update BEFORE UPDATE ON market_retention_digest_denials
BEGIN SELECT RAISE(ABORT, 'retention digest denials are immutable'); END;
CREATE TRIGGER market_retention_digest_denials_no_delete BEFORE DELETE ON market_retention_digest_denials
BEGIN SELECT RAISE(ABORT, 'retention digest denials are immutable'); END;
CREATE TRIGGER market_retention_derivation_denials_no_update BEFORE UPDATE ON market_retention_derivation_denials
BEGIN SELECT RAISE(ABORT, 'retention derivation denials are immutable'); END;
CREATE TRIGGER market_retention_derivation_denials_no_delete BEFORE DELETE ON market_retention_derivation_denials
BEGIN SELECT RAISE(ABORT, 'retention derivation denials are immutable'); END;
CREATE TRIGGER market_retention_plans_no_update BEFORE UPDATE ON market_retention_erasure_plans
BEGIN SELECT RAISE(ABORT, 'retention erasure plans are immutable'); END;
CREATE TRIGGER market_retention_plans_no_delete BEFORE DELETE ON market_retention_erasure_plans
BEGIN SELECT RAISE(ABORT, 'retention erasure plans are immutable'); END;
CREATE TRIGGER market_retention_attempts_no_update BEFORE UPDATE ON market_retention_erasure_attempts
BEGIN SELECT RAISE(ABORT, 'retention erasure attempts are immutable'); END;
CREATE TRIGGER market_retention_attempts_no_delete BEFORE DELETE ON market_retention_erasure_attempts
BEGIN SELECT RAISE(ABORT, 'retention erasure attempts are immutable'); END;
CREATE TRIGGER market_retention_tombstones_no_update BEFORE UPDATE ON market_retention_artifact_tombstones
BEGIN SELECT RAISE(ABORT, 'retention tombstones are immutable'); END;
CREATE TRIGGER market_retention_tombstones_no_delete BEFORE DELETE ON market_retention_artifact_tombstones
BEGIN SELECT RAISE(ABORT, 'retention tombstones are immutable'); END;
CREATE TRIGGER market_retention_receipts_no_update BEFORE UPDATE ON market_retention_erasure_receipts
BEGIN SELECT RAISE(ABORT, 'retention receipts are immutable'); END;
CREATE TRIGGER market_retention_receipts_no_delete BEFORE DELETE ON market_retention_erasure_receipts
BEGIN SELECT RAISE(ABORT, 'retention receipts are immutable'); END;
CREATE TRIGGER market_retention_checkpoints_no_update BEFORE UPDATE ON market_retention_checkpoints
BEGIN SELECT RAISE(ABORT, 'retention checkpoints are immutable'); END;
CREATE TRIGGER market_retention_checkpoints_no_delete BEFORE DELETE ON market_retention_checkpoints
BEGIN SELECT RAISE(ABORT, 'retention checkpoints are immutable'); END;
