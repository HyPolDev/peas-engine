CREATE TABLE events (
  position INTEGER PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  provider_key TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  provider_record_id TEXT NOT NULL,
  provider_revision_id TEXT NOT NULL,
  artifact_hash TEXT NOT NULL,
  source TEXT NOT NULL,
  subject TEXT NOT NULL,
  stream_version INTEGER NOT NULL,
  received_at_ms INTEGER NOT NULL,
  logical_at_ms INTEGER NOT NULL,
  event_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  previous_event_hash TEXT NOT NULL,
  event_hash TEXT NOT NULL UNIQUE,
  UNIQUE (subject, stream_version)
) STRICT;

CREATE INDEX events_subject_head ON events (subject, stream_version DESC);

CREATE TABLE run_manifests (
  run_id TEXT PRIMARY KEY,
  run_kind TEXT NOT NULL CHECK (run_kind IN ('live', 'replay', 'shadow', 'research', 'paper')),
  effects_allowed INTEGER NOT NULL CHECK (
    effects_allowed IN (0, 1)
    AND (effects_allowed = 0 OR run_kind = 'live')
  ),
  manifest_json TEXT NOT NULL,
  manifest_hash TEXT NOT NULL,
  behavior_hash TEXT NOT NULL
) STRICT;

CREATE TABLE run_cursors (
  run_id TEXT PRIMARY KEY,
  manifest_hash TEXT NOT NULL,
  behavior_hash TEXT NOT NULL,
  processed_position INTEGER NOT NULL,
  logical_at_ms INTEGER NOT NULL,
  last_event_hash TEXT NOT NULL,
  state_head TEXT NOT NULL,
  decision_head TEXT NOT NULL,
  cursor_hash TEXT NOT NULL,
  FOREIGN KEY (run_id) REFERENCES run_manifests(run_id),
  FOREIGN KEY (processed_position) REFERENCES events(position)
) STRICT;

CREATE TABLE aggregate_checkpoints (
  run_id TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  last_input_position INTEGER NOT NULL,
  state_json TEXT NOT NULL,
  state_hash TEXT NOT NULL,
  checkpoint_hash TEXT NOT NULL,
  PRIMARY KEY (run_id, aggregate_id),
  FOREIGN KEY (run_id) REFERENCES run_manifests(run_id),
  FOREIGN KEY (last_input_position) REFERENCES events(position)
) STRICT;

CREATE TABLE processing_outputs (
  sequence INTEGER PRIMARY KEY,
  output_id TEXT NOT NULL UNIQUE,
  run_id TEXT NOT NULL,
  input_event_id TEXT NOT NULL,
  input_position INTEGER NOT NULL,
  aggregate_id TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('decision', 'job', 'outbox')),
  ordinal INTEGER NOT NULL,
  dedupe_key TEXT,
  not_before_logical_ms INTEGER,
  body_json TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  envelope_hash TEXT NOT NULL,
  UNIQUE (run_id, input_position, category, ordinal),
  FOREIGN KEY (run_id) REFERENCES run_manifests(run_id),
  FOREIGN KEY (input_position) REFERENCES events(position),
  FOREIGN KEY (input_event_id) REFERENCES events(event_id)
) STRICT;

CREATE UNIQUE INDEX processing_outputs_run_dedupe
  ON processing_outputs (run_id, category, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX processing_outputs_dispatch_order
  ON processing_outputs (run_id, category, not_before_logical_ms, output_id);

CREATE TABLE jobs (
  output_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'leased', 'succeeded', 'failed', 'ambiguous')),
  lease_owner TEXT,
  lease_expires_at_ms INTEGER,
  fencing_token INTEGER NOT NULL DEFAULT 0,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  FOREIGN KEY (output_id) REFERENCES processing_outputs(output_id)
) STRICT;

CREATE INDEX jobs_claim_order
  ON jobs (status, lease_expires_at_ms, output_id);

CREATE TABLE outbox (
  output_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'leased', 'published', 'failed', 'ambiguous')),
  lease_owner TEXT,
  lease_expires_at_ms INTEGER,
  fencing_token INTEGER NOT NULL DEFAULT 0,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  FOREIGN KEY (output_id) REFERENCES processing_outputs(output_id)
) STRICT;

CREATE INDEX outbox_claim_order
  ON outbox (status, lease_expires_at_ms, output_id);

CREATE TRIGGER events_no_update BEFORE UPDATE ON events
BEGIN
  SELECT RAISE(ABORT, 'events are immutable');
END;

CREATE TRIGGER events_no_delete BEFORE DELETE ON events
BEGIN
  SELECT RAISE(ABORT, 'events are immutable');
END;

CREATE TRIGGER run_manifests_no_update BEFORE UPDATE ON run_manifests
BEGIN
  SELECT RAISE(ABORT, 'run manifests are immutable');
END;

CREATE TRIGGER run_manifests_no_delete BEFORE DELETE ON run_manifests
BEGIN
  SELECT RAISE(ABORT, 'run manifests are immutable');
END;

CREATE TRIGGER processing_outputs_no_update BEFORE UPDATE ON processing_outputs
BEGIN
  SELECT RAISE(ABORT, 'processing outputs are immutable');
END;

CREATE TRIGGER processing_outputs_no_delete BEFORE DELETE ON processing_outputs
BEGIN
  SELECT RAISE(ABORT, 'processing outputs are immutable');
END;
