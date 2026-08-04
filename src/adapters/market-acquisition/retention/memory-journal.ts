import { P1_10_TEST_AUTHORITY } from "../../../internal-test-authority.js";
import { canonicalJson } from "../../../core/json.js";
import type {
  ArtifactRetentionJournal,
  RetentionCheckpoint,
  RetentionErasureAttempt,
  RetentionErasurePlan,
  RetentionOwnership,
  RetentionProviderLane,
  RetentionReceipt,
  RetentionStopEvent,
  RetentionTombstone,
} from "./contracts.js";

const ownedMemoryRetentionJournals = new WeakSet<object>();

function replayEqual(label: string, existing: unknown, next: unknown): void {
  if (canonicalJson(existing as never) !== canonicalJson(next as never))
    throw new Error(`${label} conflicts with immutable retention evidence`);
}

export class MemoryArtifactRetentionJournal implements ArtifactRetentionJournal {
  readonly #ownership = new Map<string, RetentionOwnership>();
  readonly #derivedOwnership = new Map<string, Set<string>>();
  readonly #stops = new Map<string, RetentionStopEvent>();
  readonly #providerDenials = new Set<string>();
  readonly #digestDenials = new Set<string>();
  readonly #derivedDenials = new Set<string>();
  readonly #plans = new Map<string, RetentionErasurePlan>();
  readonly #attempts = new Map<string, RetentionErasureAttempt>();
  readonly #tombstones = new Map<string, RetentionTombstone>();
  readonly #receipts = new Map<string, RetentionReceipt>();
  readonly #checkpoints = new Map<string, RetentionCheckpoint>();

  registerOwnershipAndApplyActiveStop(value: RetentionOwnership): boolean {
    const existing = this.#ownership.get(value.ownershipId);
    if (existing !== undefined) replayEqual("Ownership", existing, value);
    else this.#ownership.set(value.ownershipId, structuredClone(value));
    const lineage = this.#derivedOwnership.get(value.ownershipId) ?? new Set<string>();
    for (const derivedId of value.derivedIds) lineage.add(derivedId);
    this.#derivedOwnership.set(value.ownershipId, lineage);
    const denied = this.providerUseDenied(value.providerLane, value.providerId);
    if (denied) {
      this.#digestDenials.add(value.artifactDigest);
      for (const derivedId of value.derivedIds) this.#derivedDenials.add(derivedId);
    }
    return !denied;
  }

  registerDerivedLineageAndApplyActiveStop(
    ownershipId: string,
    derivedIds: readonly string[],
  ): boolean {
    const ownership = this.#ownership.get(ownershipId);
    if (ownership === undefined) throw new Error("Retention ownership is missing");
    const lineage = this.#derivedOwnership.get(ownershipId) ?? new Set<string>();
    for (const derivedId of derivedIds) lineage.add(derivedId);
    this.#derivedOwnership.set(ownershipId, lineage);
    const denied = this.providerUseDenied(ownership.providerLane, ownership.providerId);
    if (denied) for (const derivedId of derivedIds) this.#derivedDenials.add(derivedId);
    return !denied;
  }

  #withDerived(value: RetentionOwnership): RetentionOwnership {
    return {
      ...structuredClone(value),
      derivedIds: [...(this.#derivedOwnership.get(value.ownershipId) ?? [])].sort(),
    };
  }

  listOwnership(lane: RetentionProviderLane, providerId: string): readonly RetentionOwnership[] {
    return [...this.#ownership.values()]
      .filter((value) => value.providerLane === lane && value.providerId === providerId)
      .sort((left, right) => left.ownershipId.localeCompare(right.ownershipId))
      .map((value) => this.#withDerived(value));
  }

  ownershipForDigest(digest: string): readonly RetentionOwnership[] {
    return [...this.#ownership.values()]
      .filter((value) => value.artifactDigest === digest)
      .sort((left, right) => left.ownershipId.localeCompare(right.ownershipId))
      .map((value) => this.#withDerived(value));
  }

  ownershipForDerivedId(derivedId: string): readonly RetentionOwnership[] {
    return [...this.#ownership.values()]
      .filter((value) => this.#derivedOwnership.get(value.ownershipId)?.has(derivedId) === true)
      .sort((left, right) => left.ownershipId.localeCompare(right.ownershipId))
      .map((value) => this.#withDerived(value));
  }

  recordStopAndDenials(stop: RetentionStopEvent, derivedIds: readonly string[]): void {
    const existing = this.#stops.get(stop.stopEventId);
    if (existing !== undefined) replayEqual("Stop", existing, stop);
    else this.#stops.set(stop.stopEventId, structuredClone(stop));
    this.#providerDenials.add(`${stop.providerLane}:${stop.providerId}`);
    for (const ownership of this.listOwnership(stop.providerLane, stop.providerId))
      this.#digestDenials.add(ownership.artifactDigest);
    for (const derivedId of derivedIds) this.#derivedDenials.add(derivedId);
  }

  providerUseDenied(lane: RetentionProviderLane, providerId: string): boolean {
    return this.#providerDenials.has(`${lane}:${providerId}`);
  }
  reconciliationUseDenied(trustedNowMs: number): boolean {
    return (
      this.#providerDenials.size > 0 ||
      [...this.#ownership.values()].some((ownership) => trustedNowMs >= ownership.expiresAtMs)
    );
  }
  digestUseDenied(digest: string): boolean {
    return this.#digestDenials.has(digest) || this.#tombstones.has(digest);
  }
  derivedUseDenied(derivedId: string): boolean {
    return this.#derivedDenials.has(derivedId);
  }

  recordPlan(value: RetentionErasurePlan): void {
    const existing = this.#plans.get(value.planId);
    if (existing !== undefined) replayEqual("Plan", existing, value);
    else this.#plans.set(value.planId, structuredClone(value));
  }
  getPlan(planId: string): RetentionErasurePlan | undefined {
    const value = this.#plans.get(planId);
    return value === undefined ? undefined : structuredClone(value);
  }

  recordAttempt(value: RetentionErasureAttempt): void {
    const existing = this.#attempts.get(value.attemptId);
    if (existing !== undefined) replayEqual("Attempt", existing, value);
    else this.#attempts.set(value.attemptId, structuredClone(value));
  }
  attemptsFor(planId: string, digest: string): readonly RetentionErasureAttempt[] {
    return [...this.#attempts.values()]
      .filter((value) => value.planId === planId && value.artifactDigest === digest)
      .sort((left, right) => left.attemptOrdinal - right.attemptOrdinal)
      .map((value) => structuredClone(value));
  }

  recordTombstone(value: RetentionTombstone): void {
    const existing = this.#tombstones.get(value.artifactDigest);
    if (existing !== undefined) replayEqual("Tombstone", existing, value);
    else this.#tombstones.set(value.artifactDigest, structuredClone(value));
  }
  hasTombstone(digest: string): boolean {
    return this.#tombstones.has(digest);
  }

  recordReceipt(value: RetentionReceipt): void {
    const existing = this.#receipts.get(value.planId);
    if (existing !== undefined) replayEqual("Receipt", existing, value);
    else this.#receipts.set(value.planId, structuredClone(value));
  }
  getReceiptForPlan(planId: string): RetentionReceipt | undefined {
    const value = this.#receipts.get(planId);
    return value === undefined ? undefined : structuredClone(value);
  }

  recordCheckpoint(value: RetentionCheckpoint): void {
    const existing = this.#checkpoints.get(value.planId);
    if (existing !== undefined) replayEqual("Checkpoint", existing, value);
    else this.#checkpoints.set(value.planId, structuredClone(value));
  }
  getCheckpoint(planId: string): RetentionCheckpoint | undefined {
    const value = this.#checkpoints.get(planId);
    return value === undefined ? undefined : structuredClone(value);
  }
}

export function createMemoryArtifactRetentionJournal(): MemoryArtifactRetentionJournal {
  if (P1_10_TEST_AUTHORITY === undefined) {
    throw new TypeError("test-memory-retention-journal-unavailable");
  }
  const journal = new MemoryArtifactRetentionJournal();
  ownedMemoryRetentionJournals.add(journal);
  Object.freeze(journal);
  return journal;
}

Object.freeze(MemoryArtifactRetentionJournal.prototype);

export function isOwnedMemoryArtifactRetentionJournal(value: object): boolean {
  return (
    ownedMemoryRetentionJournals.has(value) &&
    Object.getPrototypeOf(value) === MemoryArtifactRetentionJournal.prototype &&
    Object.isFrozen(value) &&
    Reflect.ownKeys(value).length === 0
  );
}
