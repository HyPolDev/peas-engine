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
import {
  type CommittedArtifactExpectation,
  snapshotCommittedArtifactExpectation,
  verifyCommittedArtifact,
} from "./artifact-integration.js";
import type { JournalEntry, JournalIdentityInput } from "./journal.js";
import { validateJournalEntries } from "./journal.js";
import type { RetentionEnforcedArtifactStore } from "./retention/artifact-access.js";

function sortIds(values: readonly string[]): readonly string[] {
  return Object.freeze(
    [...values].sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right))),
  );
}

function replayFacts(facts: ObservationLedgerFactsV1): ObservationLedgerFactsV1 {
  if (facts.kind === "artifact.committed") {
    return Object.freeze({ ...facts, acquisitionMode: "replay" });
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
  const clockDeclarations = new Map<string, string>();
  const lastWallEntry = new Map<string, ObservationLedgerEntryV1>();

  for (let offset = 0; offset < validated.length; offset += pageSize) {
    for (const source of validated.slice(offset, offset + pageSize)) {
      if (source.facts.kind === "clock.regression") {
        const regressing = remapped.get(source.facts.regressingEntryId);
        const prior = remapped.get(source.facts.priorEntryId);
        const originalRegressing = originalById.get(source.facts.regressingEntryId);
        const originalPrior = originalById.get(source.facts.priorEntryId);
        if (
          (originalRegressing !== undefined && shouldOmit(originalRegressing)) ||
          (originalPrior !== undefined && shouldOmit(originalPrior))
        ) {
          const representative = regressing ?? prior;
          if (representative === undefined) {
            throw new TypeError("replay-clock-regression-endpoint-missing");
          }
          remapped.set(source.entryId, representative);
          continue;
        }
        const witness = replayed.find(
          (entry) =>
            entry.facts.kind === "clock.regression" &&
            entry.facts.regressingEntryId === regressing &&
            entry.facts.priorEntryId === prior,
        );
        if (witness === undefined) throw new TypeError("replay-clock-regression-witness-missing");
        remapped.set(source.entryId, witness.entryId);
        continue;
      }
      if (shouldOmit(source)) {
        const representatives = source.parentEntryIds.flatMap((parentId) => {
          const mapped = remapped.get(parentId);
          return mapped === undefined ? [] : [mapped];
        });
        if (representatives.length === 0) throw new TypeError("replay-omitted-parent-missing");
        remapped.set(source.entryId, representatives.at(-1) as string);
        continue;
      }
      const parents: string[] = [];
      for (const parentId of source.parentEntryIds) {
        const parent = originalById.get(parentId);
        if (
          source.facts.kind === "artifact.committed" &&
          source.facts.acquisitionMode === "live" &&
          parent?.facts.kind === "request.succeeded"
        ) {
          continue;
        }
        const mapped = remapped.get(parentId);
        if (mapped !== undefined) {
          if (!parents.includes(mapped)) parents.push(mapped);
          continue;
        }
        throw new TypeError("replay-parent-missing");
      }
      const entry = createObservationLedgerEntry({
        schemaVersion: 1,
        executionId,
        parentEntryIds: sortIds(parents),
        clock: source.clock,
        facts: replayFacts(source.facts),
      });
      replayed.push(entry);
      remapped.set(source.entryId, entry.entryId);
      if (entry.facts.kind === "clock-basis.declared") {
        clockDeclarations.set(entry.facts.clockBasis.clockBasisId, entry.entryId);
        continue;
      }
      const basisId = entry.clock.clockBasisId;
      if (basisId === null || entry.clock.wallTimeMs === null) continue;
      const prior = lastWallEntry.get(basisId);
      if (
        prior !== undefined &&
        prior.clock.wallTimeMs !== null &&
        entry.clock.wallTimeMs < prior.clock.wallTimeMs
      ) {
        const basisEntryId = clockDeclarations.get(basisId);
        if (basisEntryId === undefined) throw new TypeError("replay-clock-basis-missing");
        const witness = createObservationLedgerEntry({
          schemaVersion: 1,
          executionId,
          parentEntryIds: sortIds([basisEntryId, prior.entryId, entry.entryId]),
          clock: entry.clock,
          facts: Object.freeze({
            kind: "clock.regression" as const,
            priorEntryId: prior.entryId,
            regressingEntryId: entry.entryId,
            priorWallTimeMs: prior.clock.wallTimeMs,
            currentWallTimeMs: entry.clock.wallTimeMs,
            monotonicOrderPreserved:
              prior.clock.monotonicTimeUs !== null &&
              entry.clock.monotonicTimeUs !== null &&
              entry.clock.monotonicTimeUs > prior.clock.monotonicTimeUs,
          }),
        });
        replayed.push(witness);
        lastWallEntry.set(basisId, witness);
        continue;
      }
      lastWallEntry.set(basisId, entry);
    }
  }
  return validateObservationLedgerBundle(replayed);
}

export async function replayVerifiedAcquisition(
  input: Readonly<{
    artifactStore: RetentionEnforcedArtifactStore;
    artifacts: readonly CommittedArtifactExpectation[];
    ledger: readonly ObservationLedgerEntryV1[];
    executionId: string;
    pageSize: number;
  }>,
): Promise<readonly ObservationLedgerEntryV1[]> {
  const ledger = validateObservationLedgerBundle(input.ledger);
  const declarations = new Map(
    ledger.flatMap((entry) =>
      entry.facts.kind === "acquisition.declared"
        ? [[entry.facts.acquisitionObservationId, entry.facts] as const]
        : [],
    ),
  );
  const required = new Map<string, CommittedArtifactExpectation>();
  for (const entry of ledger) {
    if (entry.facts.kind !== "artifact.committed") continue;
    const declaration = declarations.get(entry.facts.acquisitionObservationId);
    if (declaration === undefined) throw new TypeError("replay-artifact-acquisition-missing");
    const expectation: CommittedArtifactExpectation = Object.freeze({
      artifactObservationId: entry.facts.vaultObservationId,
      artifactDigest: entry.facts.artifactDigest,
      artifactSizeBytes: entry.facts.sizeBytes,
      artifactObservationHash: entry.facts.vaultObservationHash,
      retrievalAttemptId: declaration.retrievalAttemptId,
      requestIdentityHash: declaration.sanitizedRequestIdentityHash,
      provider: declaration.provider,
    });
    const prior = required.get(expectation.artifactObservationId);
    if (
      prior !== undefined &&
      canonicalJson(prior as unknown as JsonValue) !==
        canonicalJson(expectation as unknown as JsonValue)
    ) {
      throw new TypeError("replay-ledger-artifact-conflict");
    }
    required.set(expectation.artifactObservationId, expectation);
  }
  const supplied = new Map<string, CommittedArtifactExpectation>();
  for (const candidate of input.artifacts) {
    const artifact = snapshotCommittedArtifactExpectation(candidate);
    const prior = supplied.get(artifact.artifactObservationId);
    if (
      prior !== undefined &&
      canonicalJson(prior as unknown as JsonValue) !==
        canonicalJson(artifact as unknown as JsonValue)
    ) {
      throw new TypeError("replay-artifact-expectation-conflict");
    }
    supplied.set(artifact.artifactObservationId, artifact);
  }
  if (
    supplied.size !== required.size ||
    [...required].some(([id, expectation]) => {
      const artifact = supplied.get(id);
      return (
        artifact === undefined ||
        canonicalJson(artifact as unknown as JsonValue) !==
          canonicalJson(expectation as unknown as JsonValue)
      );
    })
  ) {
    throw new TypeError("replay-artifact-coverage-mismatch");
  }
  for (const artifact of [...supplied.values()].sort((left, right) =>
    left.artifactObservationId.localeCompare(right.artifactObservationId),
  )) {
    await verifyCommittedArtifact(input.artifactStore, artifact);
  }
  return replayAcquisitionLedger(ledger, input.executionId, input.pageSize);
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
