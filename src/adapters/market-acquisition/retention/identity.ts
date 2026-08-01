import { canonicalHash } from "../../../core/hash.js";
import type { JsonValue } from "../../../core/json.js";
import type {
  RetentionCheckpoint,
  RetentionErasureAttempt,
  RetentionErasurePlan,
  RetentionOwnership,
  RetentionReceipt,
  RetentionStopEvent,
  RetentionTombstone,
} from "./contracts.js";

function prefixed(prefix: string, domain: string, value: unknown): string {
  return `${prefix}${canonicalHash(domain, value as JsonValue)}`;
}

export function deriveRetentionOwnershipId(value: Omit<RetentionOwnership, "ownershipId">): string {
  return prefixed("row1_", "peas/market-acquisition-retention-ownership/v1", value);
}

export function deriveRetentionStopEventId(value: Omit<RetentionStopEvent, "stopEventId">): string {
  return prefixed("rst1_", "peas/market-acquisition-retention-stop/v1", value);
}

export function deriveRetentionPlanId(
  value: Omit<RetentionErasurePlan, "planId" | "planHash">,
): string {
  return prefixed("rpl1_", "peas/market-acquisition-retention-plan/v1", value);
}

export function deriveRetentionPlanHash(value: Omit<RetentionErasurePlan, "planHash">): string {
  return canonicalHash("peas/market-acquisition-retention-plan-record/v1", value as JsonValue);
}

export function deriveRetentionAttemptId(
  value: Omit<RetentionErasureAttempt, "attemptId">,
): string {
  return prefixed("rea1_", "peas/market-acquisition-retention-attempt/v1", value);
}

export function deriveRetentionTombstoneId(value: Omit<RetentionTombstone, "tombstoneId">): string {
  return prefixed("rtm1_", "peas/market-acquisition-retention-tombstone/v1", value);
}

export function deriveRetentionReceiptId(value: Omit<RetentionReceipt, "receiptId">): string {
  return prefixed("rrc1_", "peas/market-acquisition-retention-receipt/v1", value);
}

export function deriveRetentionCheckpointId(
  value: Omit<RetentionCheckpoint, "checkpointId">,
): string {
  return prefixed("rck1_", "peas/market-acquisition-retention-checkpoint/v1", value);
}
