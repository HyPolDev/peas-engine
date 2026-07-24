import { createHash } from "node:crypto";

import { evaluateStudyBound } from "./bounds.js";
import { StudyContractError } from "./contracts.js";

function separatedHash(label: string, ...parts: readonly Uint8Array[]): Buffer {
  const hash = createHash("sha256");
  hash.update(label, "ascii");
  for (const part of parts) {
    hash.update(Uint8Array.of(0));
    hash.update(part);
  }
  return hash.digest();
}

function uint64be(value: bigint): Buffer {
  if (value < 0n || value > 0xffff_ffff_ffff_ffffn) {
    throw new StudyContractError("study.input-invalid", "uint64 value is outside range");
  }
  const output = Buffer.allocUnsafe(8);
  output.writeBigUInt64BE(value);
  return output;
}

export function deriveStudyRankDigest(rankSeedHex: string, clusterCandidateId: string): string {
  if (!/^[0-9a-f]{64}$/u.test(rankSeedHex)) {
    throw new StudyContractError("study.rank-invalid", "rank seed must be 32 lowercase-hex bytes", {
      rankFailureKind: "seed",
    });
  }
  return separatedHash(
    "peas/event-study-rank/v1",
    Buffer.from(rankSeedHex, "hex"),
    Buffer.from(clusterCandidateId, "utf8"),
  ).toString("hex");
}

export function deriveBootstrapSeed(rankSeedHex: string, studyDesignId: string): string {
  if (!/^[0-9a-f]{64}$/u.test(rankSeedHex)) {
    throw new StudyContractError("study.input-invalid", "bootstrap rank seed is invalid");
  }
  return separatedHash(
    "peas/study-bootstrap-seed/v1",
    Buffer.from(rankSeedHex, "hex"),
    Buffer.from(studyDesignId, "ascii"),
  ).toString("hex");
}

export function deriveBootstrapWord(
  input: Readonly<{
    bootstrapSeedHex: string;
    metricId: string;
    replicateIndex: number;
    laneOrdinal: 0 | 1 | 2;
    drawIndex: number;
    counter: bigint;
  }>,
): Readonly<{ digest: string; word: bigint }> {
  if (
    !/^[0-9a-f]{64}$/u.test(input.bootstrapSeedHex) ||
    !Number.isSafeInteger(input.replicateIndex) ||
    input.replicateIndex < 0 ||
    !Number.isSafeInteger(input.drawIndex) ||
    input.drawIndex < 0
  ) {
    throw new StudyContractError("study.input-invalid", "bootstrap word input is invalid");
  }
  const digest = createHash("sha256")
    .update("peas/study-bootstrap-word/v1", "ascii")
    .update(Uint8Array.of(0))
    .update(Buffer.from(input.bootstrapSeedHex, "hex"))
    .update(Uint8Array.of(0))
    .update(input.metricId, "ascii")
    .update(uint64be(BigInt(input.replicateIndex)))
    .update(Uint8Array.of(input.laneOrdinal))
    .update(uint64be(BigInt(input.drawIndex)))
    .update(uint64be(input.counter))
    .digest();
  return { digest: digest.toString("hex"), word: digest.readBigUInt64BE(0) };
}

export function bootstrapPoolIndex(word: bigint, poolSize: number): number | null {
  if (!Number.isSafeInteger(poolSize) || poolSize < 1) {
    throw new StudyContractError("study.input-invalid", "bootstrap pool size must be positive");
  }
  const size = BigInt(poolSize);
  const limit = ((1n << 64n) / size) * size;
  return word >= limit ? null : Number(word % size);
}

export type CapacityCellV1 = Readonly<{ cellId: string; capacity: number }>;
export type CapacityAwardV1 = Readonly<{ cellId: string; awarded: number; capacity: number }>;

/**
 * The repeatable capacity-capped Hamilton pass used for both first-level remaining seats and each
 * second-level allocation. Base seats are applied by the caller before this helper.
 */
export function capacityHamilton(
  cells: readonly CapacityCellV1[],
  requestedSeats: number,
): readonly CapacityAwardV1[] {
  if (!Number.isSafeInteger(requestedSeats) || requestedSeats < 0) {
    throw new StudyContractError("study.input-invalid", "requested seats are invalid");
  }
  const ordered = [...cells].sort((left, right) =>
    Buffer.compare(Buffer.from(left.cellId, "utf8"), Buffer.from(right.cellId, "utf8")),
  );
  if (new Set(ordered.map((cell) => cell.cellId)).size !== ordered.length) {
    throw new StudyContractError("study.input-invalid", "Hamilton cell IDs must be unique");
  }
  for (const cell of ordered) {
    if (!Number.isSafeInteger(cell.capacity) || cell.capacity < 1) {
      throw new StudyContractError("study.input-invalid", "Hamilton capacity must be positive");
    }
  }
  const totalCapacity = ordered.reduce((sum, cell) => sum + cell.capacity, 0);
  if (totalCapacity < requestedSeats) {
    throw new StudyContractError("study.quota-insufficient", "Hamilton capacity is insufficient", {
      quotaKind: "stratum",
    });
  }
  const awards = new Map(ordered.map((cell) => [cell.cellId, 0]));
  let remaining = requestedSeats;
  let active = ordered.map((cell) => ({ ...cell }));
  while (remaining > 0) {
    const capacitySum = active.reduce((sum, cell) => sum + cell.capacity, 0);
    const passSeats = remaining;
    const remainders: { cellId: string; remainder: number }[] = [];
    let floorAwards = 0;
    for (const cell of active) {
      const floor = Math.floor((passSeats * cell.capacity) / capacitySum);
      const award = Math.min(floor, cell.capacity);
      awards.set(cell.cellId, (awards.get(cell.cellId) ?? 0) + award);
      cell.capacity -= award;
      floorAwards += award;
      remainders.push({
        cellId: cell.cellId,
        remainder: (passSeats * (cell.capacity + award)) % capacitySum,
      });
    }
    remaining -= floorAwards;
    remainders.sort(
      (left, right) =>
        right.remainder - left.remainder ||
        Buffer.compare(Buffer.from(left.cellId, "utf8"), Buffer.from(right.cellId, "utf8")),
    );
    for (const remainder of remainders) {
      if (remaining === 0) break;
      const cell = active.find((candidate) => candidate.cellId === remainder.cellId);
      if (cell !== undefined && cell.capacity > 0) {
        awards.set(cell.cellId, (awards.get(cell.cellId) ?? 0) + 1);
        cell.capacity -= 1;
        remaining -= 1;
      }
    }
    active = active.filter((cell) => cell.capacity > 0);
    if (active.length === 0 && remaining > 0) {
      throw new StudyContractError("study.quota-insufficient", "Hamilton cells exhausted", {
        quotaKind: "stratum",
      });
    }
  }
  return ordered.map((cell) => ({
    cellId: cell.cellId,
    capacity: cell.capacity,
    awarded: awards.get(cell.cellId) ?? 0,
  }));
}

export const HOLM_SLOT_IDS = [
  "holm.movement.prior-close.pre-market",
  "holm.movement.prior-close.regular",
  "holm.movement.prior-close.post-market",
  "holm.movement.prior-close.other",
  "holm.movement.release-gap.pre-market",
  "holm.movement.release-gap.regular",
  "holm.movement.release-gap.post-market",
  "holm.movement.release-gap.other",
  "holm.movement.residual-1m.pre-market",
  "holm.movement.residual-1m.regular",
  "holm.movement.residual-1m.post-market",
  "holm.movement.residual-1m.other",
  "holm.movement.residual-5m.pre-market",
  "holm.movement.residual-5m.regular",
  "holm.movement.residual-5m.post-market",
  "holm.movement.residual-5m.other",
  "holm.movement.residual-30m.pre-market",
  "holm.movement.residual-30m.regular",
  "holm.movement.residual-30m.post-market",
  "holm.movement.residual-30m.other",
  "holm.quote-trade.T0",
  "holm.quote-trade.T1",
  "holm.quote-trade.T5",
  "holm.quote-trade.T30",
] as const;

export function validateHolmFamilySlots(slotIds: readonly string[]): void {
  if (
    !evaluateStudyBound("holmSlots", slotIds.length).accepted ||
    slotIds.some((slot, index) => slot !== HOLM_SLOT_IDS[index])
  ) {
    throw new StudyContractError(
      "study.input-invalid",
      "Holm family must contain the exact 24 slots in canonical order",
    );
  }
}
