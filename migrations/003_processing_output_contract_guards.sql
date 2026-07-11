-- Preserve the canonical processing-output transcript even if a caller bypasses the TypeScript
-- verifier and writes directly through the SQLite adapter.
CREATE TRIGGER processing_outputs_validate_insert
BEFORE INSERT ON processing_outputs
BEGIN
  SELECT CASE
    WHEN NEW.sequence < 1 OR NEW.sequence > 9007199254740991
      THEN RAISE(ABORT, 'processing output sequence is not a positive safe integer')
    WHEN NEW.category NOT IN ('decision', 'job', 'outbox')
      THEN RAISE(ABORT, 'processing output category is unsupported')
    WHEN NEW.aggregate_id = ''
      OR length(CAST(NEW.aggregate_id AS BLOB)) > 512
      OR instr(NEW.aggregate_id, char(0)) > 0
      OR NEW.aggregate_id GLOB '*[^A-Za-z0-9._:-]*'
      THEN RAISE(ABORT, 'processing output aggregate ID is not portable')
    WHEN NEW.ordinal < 0 OR NEW.ordinal > 9007199254740991
      THEN RAISE(ABORT, 'processing output ordinal is not a non-negative safe integer')
    WHEN NEW.category = 'decision'
      AND (NEW.dedupe_key IS NOT NULL OR NEW.not_before_logical_ms IS NOT NULL)
      THEN RAISE(ABORT, 'decision output has delivery metadata')
    WHEN NEW.category IN ('job', 'outbox')
      AND (NEW.dedupe_key IS NULL OR NEW.dedupe_key = '')
      THEN RAISE(ABORT, 'dispatchable output requires a dedupe key')
    WHEN NEW.category = 'job'
      AND (
        NEW.not_before_logical_ms IS NULL
        OR NEW.not_before_logical_ms < 0
        OR NEW.not_before_logical_ms > 9007199254740991
      )
      THEN RAISE(ABORT, 'job not-before time is not a non-negative safe integer')
    WHEN NEW.category = 'outbox' AND NEW.not_before_logical_ms IS NOT NULL
      THEN RAISE(ABORT, 'outbox output has unexpected not-before metadata')
    WHEN EXISTS (
      SELECT 1
      FROM processing_outputs AS prior
      WHERE prior.run_id = NEW.run_id
        AND prior.input_position = NEW.input_position
        AND CASE prior.category
          WHEN 'decision' THEN 0
          WHEN 'job' THEN 1
          WHEN 'outbox' THEN 2
        END > CASE NEW.category
          WHEN 'decision' THEN 0
          WHEN 'job' THEN 1
          WHEN 'outbox' THEN 2
        END
    )
      THEN RAISE(ABORT, 'processing outputs are not in canonical category order')
    WHEN NEW.ordinal != (
      SELECT count(*)
      FROM processing_outputs AS prior
      WHERE prior.run_id = NEW.run_id
        AND prior.input_position = NEW.input_position
        AND prior.category = NEW.category
    )
      THEN RAISE(ABORT, 'processing output ordinals must be contiguous from zero')
  END;
END;
