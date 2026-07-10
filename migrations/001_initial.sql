CREATE TABLE IF NOT EXISTS events (
  position INTEGER PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  dedupe_key TEXT,
  subject TEXT NOT NULL,
  stream_version INTEGER NOT NULL,
  logical_at_ms INTEGER NOT NULL,
  event_json TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  previous_event_hash TEXT NOT NULL,
  event_hash TEXT NOT NULL UNIQUE,
  UNIQUE (subject, stream_version)
) STRICT;

CREATE UNIQUE INDEX IF NOT EXISTS events_source_dedupe_key
  ON events (source, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS processor_checkpoints (
  processor_key TEXT PRIMARY KEY,
  manifest_hash TEXT NOT NULL,
  processed_position INTEGER NOT NULL,
  logical_at_ms INTEGER NOT NULL,
  state_json TEXT NOT NULL,
  state_hash TEXT NOT NULL,
  decision_head TEXT NOT NULL,
  FOREIGN KEY (processed_position) REFERENCES events(position)
) STRICT;

CREATE TABLE IF NOT EXISTS processing_outputs (
  output_id TEXT PRIMARY KEY,
  processor_key TEXT NOT NULL,
  input_event_id TEXT NOT NULL,
  input_position INTEGER NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('decision', 'job', 'outbox')),
  ordinal INTEGER NOT NULL,
  body_json TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  UNIQUE (processor_key, input_position, category, ordinal),
  FOREIGN KEY (input_position) REFERENCES events(position),
  FOREIGN KEY (input_event_id) REFERENCES events(event_id)
) STRICT;

CREATE TABLE IF NOT EXISTS jobs (
  job_id TEXT PRIMARY KEY,
  processor_key TEXT NOT NULL,
  job_type TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  not_before_logical_ms INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'leased', 'succeeded', 'failed')),
  lease_owner TEXT,
  lease_expires_at_ms INTEGER,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  UNIQUE (processor_key, job_type, dedupe_key),
  FOREIGN KEY (job_id) REFERENCES processing_outputs(output_id)
) STRICT;

CREATE INDEX IF NOT EXISTS jobs_dispatch_order
  ON jobs (status, not_before_logical_ms, job_id);

CREATE TABLE IF NOT EXISTS outbox (
  outbox_id TEXT PRIMARY KEY,
  processor_key TEXT NOT NULL,
  topic TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'leased', 'published', 'failed')),
  lease_owner TEXT,
  lease_expires_at_ms INTEGER,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  UNIQUE (processor_key, topic, dedupe_key),
  FOREIGN KEY (outbox_id) REFERENCES processing_outputs(output_id)
) STRICT;

CREATE INDEX IF NOT EXISTS outbox_dispatch_order
  ON outbox (status, outbox_id);

CREATE TRIGGER IF NOT EXISTS events_no_update
BEFORE UPDATE ON events
BEGIN
  SELECT RAISE(ABORT, 'events are immutable');
END;
CREATE TRIGGER IF NOT EXISTS events_no_delete
BEFORE DELETE ON events
BEGIN
  SELECT RAISE(ABORT, 'events are immutable');
END;

CREATE TRIGGER IF NOT EXISTS processing_outputs_no_update
BEFORE UPDATE ON processing_outputs
BEGIN
  SELECT RAISE(ABORT, 'processing outputs are immutable');
END;

CREATE TRIGGER IF NOT EXISTS processing_outputs_no_delete
BEFORE DELETE ON processing_outputs
BEGIN
  SELECT RAISE(ABORT, 'processing outputs are immutable');
END;
