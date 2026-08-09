CREATE TABLE market_retention_receipt_revalidations (
  revalidation_id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence >= 1),
  predecessor_receipt_id TEXT NOT NULL,
  receipt_id TEXT NOT NULL UNIQUE,
  attempt_count INTEGER NOT NULL CHECK (attempt_count >= 0),
  completed_at_ms INTEGER NOT NULL CHECK (completed_at_ms >= 0),
  revalidation_json TEXT NOT NULL,
  revalidation_hash TEXT NOT NULL,
  UNIQUE (plan_id, sequence),
  FOREIGN KEY (plan_id) REFERENCES market_retention_erasure_plans(plan_id)
) STRICT;

CREATE INDEX market_retention_receipt_revalidations_plan
  ON market_retention_receipt_revalidations (plan_id, sequence);

CREATE TRIGGER market_retention_receipt_revalidations_no_update
BEFORE UPDATE ON market_retention_receipt_revalidations
BEGIN SELECT RAISE(ABORT, 'retention receipt revalidation is immutable'); END;

CREATE TRIGGER market_retention_receipt_revalidations_no_delete
BEFORE DELETE ON market_retention_receipt_revalidations
BEGIN SELECT RAISE(ABORT, 'retention receipt revalidation is immutable'); END;
