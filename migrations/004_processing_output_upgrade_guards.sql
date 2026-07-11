-- Reject an upgrade when historical rows do not already satisfy the complete relational output
-- transcript contract. The throwaway STRICT table turns an invalid aggregate predicate into a
-- CHECK failure; applyMigrations wraps this file and its ledger row in one IMMEDIATE transaction.
CREATE TABLE processing_output_contract_v4_preflight (
  result TEXT NOT NULL CHECK (result = 'valid')
) STRICT;

INSERT INTO processing_output_contract_v4_preflight (result)
SELECT CASE
  WHEN EXISTS (
    SELECT 1
    FROM processing_outputs AS output
    WHERE output.sequence < 1
      OR output.sequence > 9007199254740991
      OR output.category NOT IN ('decision', 'job', 'outbox')
      OR output.aggregate_id = ''
      OR length(CAST(output.aggregate_id AS BLOB)) > 512
      OR instr(output.aggregate_id, char(0)) > 0
      OR output.aggregate_id GLOB '*[^A-Za-z0-9._:-]*'
      OR output.ordinal < 0
      OR output.ordinal > 9007199254740991
      OR (
        output.category = 'decision'
        AND (output.dedupe_key IS NOT NULL OR output.not_before_logical_ms IS NOT NULL)
      )
      OR (
        output.category IN ('job', 'outbox')
        AND (output.dedupe_key IS NULL OR output.dedupe_key = '')
      )
      OR (
        output.category = 'job'
        AND (
          output.not_before_logical_ms IS NULL
          OR output.not_before_logical_ms < 0
          OR output.not_before_logical_ms > 9007199254740991
        )
      )
      OR (output.category = 'outbox' AND output.not_before_logical_ms IS NOT NULL)
  ) THEN 'invalid'
  WHEN EXISTS (
    SELECT 1
    FROM aggregate_checkpoints AS checkpoint
    WHERE checkpoint.aggregate_id = ''
      OR length(CAST(checkpoint.aggregate_id AS BLOB)) > 512
      OR instr(checkpoint.aggregate_id, char(0)) > 0
      OR checkpoint.aggregate_id GLOB '*[^A-Za-z0-9._:-]*'
  ) THEN 'invalid'
  WHEN EXISTS (
    SELECT 1
    FROM processing_outputs AS output
    GROUP BY output.run_id, output.input_position, output.category
    HAVING min(output.ordinal) != 0
      OR max(output.ordinal) != count(*) - 1
  ) THEN 'invalid'
  WHEN EXISTS (
    SELECT 1
    FROM processing_outputs AS earlier
    JOIN processing_outputs AS later
      ON later.run_id = earlier.run_id
      AND later.input_position = earlier.input_position
      AND later.sequence > earlier.sequence
    WHERE CASE earlier.category
      WHEN 'decision' THEN 0
      WHEN 'job' THEN 1
      WHEN 'outbox' THEN 2
    END > CASE later.category
      WHEN 'decision' THEN 0
      WHEN 'job' THEN 1
      WHEN 'outbox' THEN 2
    END
  ) THEN 'invalid'
  WHEN EXISTS (
    SELECT 1
    FROM jobs AS delivery
    LEFT JOIN processing_outputs AS output ON output.output_id = delivery.output_id
    WHERE output.category IS NULL OR output.category != 'job'
  ) THEN 'invalid'
  WHEN EXISTS (
    SELECT 1
    FROM outbox AS delivery
    LEFT JOIN processing_outputs AS output ON output.output_id = delivery.output_id
    WHERE output.category IS NULL OR output.category != 'outbox'
  ) THEN 'invalid'
  ELSE 'valid'
END;

DROP TABLE processing_output_contract_v4_preflight;

CREATE TRIGGER aggregate_checkpoints_validate_identifier_insert
BEFORE INSERT ON aggregate_checkpoints
BEGIN
  SELECT CASE
    WHEN NEW.aggregate_id = ''
      OR length(CAST(NEW.aggregate_id AS BLOB)) > 512
      OR instr(NEW.aggregate_id, char(0)) > 0
      OR NEW.aggregate_id GLOB '*[^A-Za-z0-9._:-]*'
    THEN RAISE(ABORT, 'aggregate checkpoint ID is not portable')
  END;
END;

CREATE TRIGGER aggregate_checkpoints_validate_identifier_update
BEFORE UPDATE OF aggregate_id ON aggregate_checkpoints
BEGIN
  SELECT CASE
    WHEN NEW.aggregate_id = ''
      OR length(CAST(NEW.aggregate_id AS BLOB)) > 512
      OR instr(NEW.aggregate_id, char(0)) > 0
      OR NEW.aggregate_id GLOB '*[^A-Za-z0-9._:-]*'
    THEN RAISE(ABORT, 'aggregate checkpoint ID is not portable')
  END;
END;

-- SQLite foreign keys establish identity, while these guards establish semantic category identity.
CREATE TRIGGER jobs_validate_output_category_insert
BEFORE INSERT ON jobs
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM processing_outputs
      WHERE output_id = NEW.output_id AND category = 'job'
    ) THEN RAISE(ABORT, 'jobs row must reference a job output')
  END;
END;

CREATE TRIGGER jobs_validate_output_category_update
BEFORE UPDATE OF output_id ON jobs
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM processing_outputs
      WHERE output_id = NEW.output_id AND category = 'job'
    ) THEN RAISE(ABORT, 'jobs row must reference a job output')
  END;
END;

CREATE TRIGGER outbox_validate_output_category_insert
BEFORE INSERT ON outbox
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM processing_outputs
      WHERE output_id = NEW.output_id AND category = 'outbox'
    ) THEN RAISE(ABORT, 'outbox row must reference an outbox output')
  END;
END;

CREATE TRIGGER outbox_validate_output_category_update
BEFORE UPDATE OF output_id ON outbox
BEGIN
  SELECT CASE
    WHEN NOT EXISTS (
      SELECT 1 FROM processing_outputs
      WHERE output_id = NEW.output_id AND category = 'outbox'
    ) THEN RAISE(ABORT, 'outbox row must reference an outbox output')
  END;
END;
