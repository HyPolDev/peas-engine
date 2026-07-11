-- Support deterministic per-run output pagination without scanning outputs from other runs.
CREATE INDEX processing_outputs_run_sequence
  ON processing_outputs (run_id, sequence);
