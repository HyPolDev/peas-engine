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
  for (const artifact of input.artifacts) {
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
