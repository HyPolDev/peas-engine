import { Buffer } from "node:buffer";

import { canonicalJson, type JsonValue } from "../../core/json.js";
import {
  OBSERVATION_LEDGER_PAGE_SIZE_MAX,
  OBSERVATION_LEDGER_PAGE_SIZE_MIN,
  createObservationLedgerEntry,
  validateObservationLedgerBundle,
  type ObservationLedgerEntryV1,
  type ObservationLedgerFactsV1,
} from "../../providers/observation-ledger.js";
import type { ArtifactStore } from "../../artifacts/artifact-store.js";
import {
  type CommittedArtifactExpectation,
  verifyCommittedArtifact,
} from "./artifact-integration.js";
import type { JournalEntry, JournalIdentityInput } from "./journal.js";
import { validateJournalEntries } from "./journal.js";

function sortIds(values: readonly string[]): readonly string[] {
  return Object.freeze(
    [...values].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right))),
  );
}

function replayFacts(
  facts: ObservationLedgerFactsV1,
  remapped: ReadonlyMap<string, string>,
): ObservationLedgerFactsV1 {
  if (facts.kind === "artifact.committed") {
    return Object.freeze({ ...facts, acquisitionMode: "replay" });
  }
  if (facts.kind === "clock.regression") {
    const priorEntryId = remapped.get(facts.priorEntryId);
    const regressingEntryId = remapped.get(facts.regressingEntryId);
    if (priorEntryId === undefined || regressingEntryId === undefined) {
      throw new TypeError("replay-clock-regression-parent-missing");
    }
    return Object.freeze({ ...facts, priorEntryId, regressingEntryId });
  }
  return facts;
}

function shouldOmit(entry: ObservationLedgerEntryV1): boolean {
  return (
    entry.facts.kind === "request.started" ||
    entry.facts.kind === "request.succeeded" ||
    entry.facts.kind === "failure.recorded"
  );
}

/**
 * Re-emits a validated live/recorded ledger into a new execution. Request and live-failure facts
 * are omitted; replay commits parent only their acquisition declaration. Clock declarations,
 * stamps, semantic facts, and all surviving causal relations are preserved and remapped.
 */
export function replayAcquisitionLedger(
  original: readonly ObservationLedgerEntryV1[],
  executionId: string,
  pageSize: number,
): readonly ObservationLedgerEntryV1[] {
  if (
    !Number.isSafeInteger(pageSize) ||
    pageSize < OBSERVATION_LEDGER_PAGE_SIZE_MIN ||
    pageSize > OBSERVATION_LEDGER_PAGE_SIZE_MAX
  ) {
    throw new RangeError("replay-page-size-invalid");
  }
  const validated = validateObservationLedgerBundle(original);
  const originalById = new Map(validated.map((entry) => [entry.entryId, entry]));
  const remapped = new Map<string, string>();
  const replayed: ObservationLedgerEntryV1[] = [];

  for (let offset = 0; offset < validated.length; offset += pageSize) {
    for (const source of validated.slice(offset, offset + pageSize)) {
      if (shouldOmit(source)) continue;
      const parents: string[] = [];
      for (const parentId of source.parentEntryIds) {
        const mapped = remapped.get(parentId);
        if (mapped !== undefined) {
          parents.push(mapped);
          continue;
        }
        const parent = originalById.get(parentId);
        if (
          source.facts.kind === "artifact.committed" &&
          source.facts.acquisitionMode === "live" &&
          parent?.facts.kind === "request.succeeded"
        ) {
          continue;
        }
        throw new TypeError("replay-parent-missing");
      }
      const entry = createObservationLedgerEntry({
        schemaVersion: 1,
        executionId,
        parentEntryIds: sortIds(parents),
        clock: source.clock,
        facts: replayFacts(source.facts, remapped),
      });
      const prospective = [...replayed, entry];
      validateObservationLedgerBundle(prospective);
      replayed.push(entry);
      remapped.set(source.entryId, entry.entryId);
    }
  }
  return validateObservationLedgerBundle(replayed);
}

export async function replayVerifiedAcquisition(
  input: Readonly<{
    artifactStore: ArtifactStore;
    artifacts: readonly CommittedArtifactExpectation[];
    ledger: readonly ObservationLedgerEntryV1[];
    executionId: string;
    pageSize: number;
  }>,
): Promise<readonly ObservationLedgerEntryV1[]> {
  const observations = new Set<string>();
  for (const artifact of [...input.artifacts].sort((left, right) =>
    left.artifactObservationId.localeCompare(right.artifactObservationId),
  )) {
    if (observations.has(artifact.artifactObservationId)) continue;
    await verifyCommittedArtifact(input.artifactStore, artifact);
    observations.add(artifact.artifactObservationId);
  }
  return replayAcquisitionLedger(input.ledger, input.executionId, input.pageSize);
}

/**
 * Canonical page-size-independent reader projection. Execution-scoped ledger identities remain
 * auditable in the bundle but cannot perturb semantic replay comparisons.
 */
export function canonicalReplayProjection(entries: readonly ObservationLedgerEntryV1[]): string {
  const validated = validateObservationLedgerBundle(entries);
  return canonicalJson(
    validated
      .filter((entry) => entry.facts.kind !== "clock-basis.declared")
      .map((entry) => ({ clock: entry.clock, facts: entry.facts })) as unknown as JsonValue,
  );
}

export function canonicalJournalProjection(
  entries: readonly JournalEntry[],
  expectedIdentity: JournalIdentityInput,
): string {
  const canonicalOrder = [...entries].sort(
    (left, right) => left.journalSequence - right.journalSequence,
  );
  validateJournalEntries(canonicalOrder, expectedIdentity);
  return canonicalJson(canonicalOrder as unknown as JsonValue);
}
