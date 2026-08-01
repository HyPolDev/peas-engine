import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import type {
  ArtifactStore,
  ArtifactObservation,
  StoreArtifactResult,
} from "../../artifacts/artifact-store.js";
import {
  createClockBasis,
  createObservationLedgerEntry,
  deriveClockBasisId,
  validateObservationLedgerBundle,
  type ClockBasisV1,
  type ClockStampV1,
  type ObservationLedgerEntryV1,
  type ObservationLedgerFactsV1,
  type RawArtifactLinkV1,
} from "../../providers/observation-ledger.js";
import { MARKET_ACQUISITION_LIMITS } from "./contracts.js";
import {
  type AcquisitionJournal,
  type JournalCheckpointBody,
  type JournalEntry,
  type JournalIdentityInput,
  TERMINAL_TOKEN_HASH,
  validateJournalEntries,
} from "./journal.js";

const HASH = /^[0-9a-f]{64}$/u;

function sortIds(values: readonly string[]): readonly string[] {
  const sorted = [...values].sort((left, right) =>
    Buffer.compare(Buffer.from(left), Buffer.from(right)),
  );
  if (new Set(sorted).size !== sorted.length) throw new TypeError("ledger-parent-duplicate");
  return Object.freeze(sorted);
}

function nullClock(): ClockStampV1 {
  return { clockBasisId: null, wallTimeMs: null, monotonicTimeUs: null };
}

type FactsOfKind<Kind extends ObservationLedgerFactsV1["kind"]> = Extract<
  ObservationLedgerFactsV1,
  Readonly<{ kind: Kind }>
>;

export type AcquisitionClockBasisInput = Omit<ClockBasisV1, "clockBasisId"> &
  Readonly<{ clockBasisId?: string }>;

/**
 * Append-only ADR-0009 ledger builder. Every clocked fact receives one separately reconstructed
 * direct clock-basis parent plus its exact causal stage parents.
 */
export class MarketAcquisitionLedger {
  readonly #executionId: string;
  readonly #clockBasis: ClockBasisV1;
  readonly #clockDeclaration: ObservationLedgerEntryV1;
  readonly #entries: ObservationLedgerEntryV1[];

  constructor(executionId: string, input: AcquisitionClockBasisInput) {
    const { clockBasisId: suppliedId, ...preimage } = input;
    const recomputed = deriveClockBasisId(preimage);
    if (suppliedId !== undefined && suppliedId !== recomputed) {
      throw new TypeError("clock-basis-identity-mismatch");
    }
    this.#executionId = executionId;
    this.#clockBasis = createClockBasis(preimage);
    this.#clockDeclaration = createObservationLedgerEntry({
      schemaVersion: 1,
      executionId,
      parentEntryIds: [],
      clock: nullClock(),
      facts: { kind: "clock-basis.declared", clockBasis: this.#clockBasis },
    });
    this.#entries = [this.#clockDeclaration];
    validateObservationLedgerBundle(this.#entries);
  }

  get clockBasis(): ClockBasisV1 {
    return this.#clockBasis;
  }

  get clockDeclaration(): ObservationLedgerEntryV1 {
    return this.#clockDeclaration;
  }

  get entries(): readonly ObservationLedgerEntryV1[] {
    return Object.freeze([...this.#entries]);
  }

  #append(
    facts: ObservationLedgerFactsV1,
    causalParentIds: readonly string[],
    clock: ClockStampV1,
  ): ObservationLedgerEntryV1 {
    if (clock.clockBasisId !== this.#clockBasis.clockBasisId || clock.wallTimeMs === null) {
      throw new TypeError("ledger-clock-basis-mismatch");
    }
    const known = new Set(this.#entries.map((entry) => entry.entryId));
    if (causalParentIds.some((parent) => !known.has(parent))) {
      throw new TypeError("ledger-causal-parent-missing");
    }
    if (causalParentIds.includes(this.#clockDeclaration.entryId)) {
      throw new TypeError("ledger-clock-parent-is-not-causal");
    }
    const parentEntryIds = sortIds([...causalParentIds, this.#clockDeclaration.entryId]);
    const entry = createObservationLedgerEntry({
      schemaVersion: 1,
      executionId: this.#executionId,
      parentEntryIds,
      clock,
      facts,
    });
    const prospective = [...this.#entries, entry];
    validateObservationLedgerBundle(prospective);
    this.#entries.push(entry);
    return entry;
  }

  declareAcquisition(
    facts: FactsOfKind<"acquisition.declared">,
    clock: ClockStampV1,
  ): ObservationLedgerEntryV1 {
    return this.#append(facts, [], clock);
  }

  requestStarted(
    acquisition: ObservationLedgerEntryV1,
    facts: FactsOfKind<"request.started">,
    clock: ClockStampV1,
  ): ObservationLedgerEntryV1 {
    return this.#append(facts, [acquisition.entryId], clock);
  }

  requestSucceeded(
    started: ObservationLedgerEntryV1,
    facts: FactsOfKind<"request.succeeded">,
    clock: ClockStampV1,
  ): ObservationLedgerEntryV1 {
    return this.#append(facts, [started.entryId], clock);
  }

  artifactCommitted(
    acquisition: ObservationLedgerEntryV1,
    requestSucceeded: ObservationLedgerEntryV1 | null,
    facts: FactsOfKind<"artifact.committed">,
    clock: ClockStampV1,
  ): ObservationLedgerEntryV1 {
    if ((facts.acquisitionMode === "live") !== (requestSucceeded !== null)) {
      throw new TypeError("ledger-artifact-mode-parent-mismatch");
    }
    return this.#append(
      facts,
      requestSucceeded === null
        ? [acquisition.entryId]
        : [acquisition.entryId, requestSucceeded.entryId],
      clock,
    );
  }

  artifactVerified(
    committed: ObservationLedgerEntryV1,
    facts: FactsOfKind<"artifact.verified">,
    clock: ClockStampV1,
  ): ObservationLedgerEntryV1 {
    return this.#append(facts, [committed.entryId], clock);
  }

  normalizationOutcome(
    verifiedParents: readonly ObservationLedgerEntryV1[],
    facts:
      | FactsOfKind<"normalization.emitted">
      | FactsOfKind<"normalization.ignored">
      | FactsOfKind<"normalization.quarantined">,
    clock: ClockStampV1,
  ): ObservationLedgerEntryV1 {
    return this.#append(
      facts,
      verifiedParents.map((entry) => entry.entryId),
      clock,
    );
  }

  selectionRecorded(
    normalization: ObservationLedgerEntryV1,
    selectedEvidence: ObservationLedgerEntryV1,
    facts: FactsOfKind<"selection.recorded">,
    clock: ClockStampV1,
  ): ObservationLedgerEntryV1 {
    return this.#append(facts, [normalization.entryId, selectedEvidence.entryId], clock);
  }

  failureRecorded(
    lastSuccessful: ObservationLedgerEntryV1,
    facts: FactsOfKind<"failure.recorded">,
    clock: ClockStampV1,
  ): ObservationLedgerEntryV1 {
    return this.#append(facts, [lastSuccessful.entryId], clock);
  }
}

export type CommittedArtifactExpectation = Readonly<{
  artifactObservationId: string;
  artifactDigest: string;
  artifactSizeBytes: number;
  artifactObservationHash: string;
  retrievalAttemptId: string;
  requestIdentityHash: string;
  provider?: string;
}>;

export type VerifiedAcquisitionArtifact = Readonly<{
  observation: ArtifactObservation;
  digest: string;
  sizeBytes: number;
  consumedSizeBytes: number;
}>;

export async function verifyCommittedArtifact(
  store: ArtifactStore,
  expected: CommittedArtifactExpectation,
): Promise<VerifiedAcquisitionArtifact> {
  if (
    !HASH.test(expected.artifactDigest) ||
    !HASH.test(expected.artifactObservationHash) ||
    !Number.isSafeInteger(expected.artifactSizeBytes) ||
    expected.artifactSizeBytes < 0 ||
    expected.artifactSizeBytes > MARKET_ACQUISITION_LIMITS.rawArtifactBytes
  ) {
    throw new TypeError("artifact-expectation-invalid");
  }
  const observation = await store.getObservation(expected.artifactObservationId);
  if (
    observation === undefined ||
    observation.artifactDigest !== expected.artifactDigest ||
    observation.observationHash !== expected.artifactObservationHash ||
    observation.attemptId !== expected.retrievalAttemptId ||
    observation.request.identityHash !== expected.requestIdentityHash ||
    (expected.provider !== undefined && observation.provider !== expected.provider)
  ) {
    throw new TypeError("artifact-observation-mismatch");
  }
  const attempt = await store.getAttempt(expected.retrievalAttemptId);
  if (
    attempt === undefined ||
    attempt.attemptId !== observation.attemptId ||
    attempt.request.identityHash !== expected.requestIdentityHash
  ) {
    throw new TypeError("artifact-attempt-mismatch");
  }
  const metadata = await store.stat(expected.artifactDigest);
  if (
    metadata === undefined ||
    metadata.digest !== expected.artifactDigest ||
    metadata.sizeBytes !== expected.artifactSizeBytes
  ) {
    throw new TypeError("artifact-metadata-mismatch");
  }
  const verified = await store.read(expected.artifactDigest);
  if (
    verified.artifact.digest !== expected.artifactDigest ||
    verified.artifact.sizeBytes !== expected.artifactSizeBytes
  ) {
    throw new TypeError("artifact-read-metadata-mismatch");
  }
  const hasher = createHash("sha256");
  let consumedSizeBytes = 0;
  try {
    for await (const member of verified.stream) {
      const bytes = Buffer.isBuffer(member) ? member : Buffer.from(member as Uint8Array);
      consumedSizeBytes += bytes.byteLength;
      if (
        consumedSizeBytes > expected.artifactSizeBytes ||
        consumedSizeBytes > MARKET_ACQUISITION_LIMITS.rawArtifactBytes
      ) {
        throw new RangeError("artifact-consumed-size-bound");
      }
      hasher.update(bytes);
    }
  } catch (error) {
    verified.stream.destroy();
    throw error;
  }
  if (
    consumedSizeBytes !== expected.artifactSizeBytes ||
    hasher.digest("hex") !== expected.artifactDigest
  ) {
    throw new TypeError("artifact-verified-read-mismatch");
  }
  return Object.freeze({
    observation,
    digest: expected.artifactDigest,
    sizeBytes: expected.artifactSizeBytes,
    consumedSizeBytes,
  });
}

export function rawArtifactLink(
  acquisitionObservationId: string,
  result: StoreArtifactResult,
): RawArtifactLinkV1 {
  return Object.freeze({
    role: "primary",
    acquisitionObservationId,
    vaultObservationId: result.observation.observationId,
    vaultObservationHash: result.observation.observationHash,
    artifactDigest: result.artifact.digest,
    sizeBytes: result.artifact.sizeBytes,
  });
}

export function attachLedgerEvidence(
  body: JournalCheckpointBody,
  stage: ObservationLedgerEntryV1 | null,
  clockDeclaration: ObservationLedgerEntryV1,
): JournalCheckpointBody {
  if (clockDeclaration.facts.kind !== "clock-basis.declared") {
    throw new TypeError("ledger-clock-declaration-invalid");
  }
  if (stage === null) {
    return Object.freeze({ ...body, stageLedgerFactId: null, causalParentFactIds: [] });
  }
  const causalParentFactIds = stage.parentEntryIds.filter(
    (parent) => parent !== clockDeclaration.entryId,
  );
  if (causalParentFactIds.length + 1 !== stage.parentEntryIds.length) {
    throw new TypeError("ledger-clock-parent-invalid");
  }
  return Object.freeze({
    ...body,
    stageLedgerFactId: stage.entryId,
    causalParentFactIds: Object.freeze(causalParentFactIds),
  });
}

export function validateJournalLedgerBindings(
  journal: readonly JournalEntry[],
  ledger: readonly ObservationLedgerEntryV1[],
): void {
  validateObservationLedgerBundle(ledger);
  const byId = new Map(ledger.map((entry) => [entry.entryId, entry]));
  const clockDeclarations = new Set(
    ledger
      .filter((entry) => entry.facts.kind === "clock-basis.declared")
      .map((entry) => entry.entryId),
  );
  for (const checkpoint of journal) {
    if (checkpoint.stageLedgerFactId === null) {
      if (checkpoint.causalParentFactIds.length !== 0) {
        throw new TypeError("journal-ledger-parent-without-stage");
      }
      continue;
    }
    const stage = byId.get(checkpoint.stageLedgerFactId);
    if (stage === undefined) throw new TypeError("journal-ledger-stage-missing");
    const causal = stage.parentEntryIds.filter((parent) => !clockDeclarations.has(parent));
    if (
      JSON.stringify(causal) !== JSON.stringify(checkpoint.causalParentFactIds) ||
      stage.parentEntryIds.filter((parent) => clockDeclarations.has(parent)).length !== 1
    ) {
      throw new TypeError("journal-ledger-direct-parent-invalid");
    }
  }
}

export type DeliveryDisposition =
  | Readonly<{ kind: "first-delivery"; digests: readonly string[] }>
  | Readonly<{ kind: "exact-redelivery"; digests: readonly string[] }>
  | Readonly<{ kind: "conflict-quarantined"; digests: readonly string[] }>;

export class DeliveryConflictRegistry {
  readonly #digests = new Map<string, Set<string>>();

  observe(assertedDeliveryIdentity: string, digest: string): DeliveryDisposition {
    if (assertedDeliveryIdentity.length === 0 || !HASH.test(digest)) {
      throw new TypeError("delivery-evidence-invalid");
    }
    const existing = this.#digests.get(assertedDeliveryIdentity);
    if (existing === undefined) {
      this.#digests.set(assertedDeliveryIdentity, new Set([digest]));
      return Object.freeze({ kind: "first-delivery", digests: Object.freeze([digest]) });
    }
    existing.add(digest);
    const digests = Object.freeze([...existing].sort());
    return Object.freeze({
      kind: existing.size === 1 ? "exact-redelivery" : "conflict-quarantined",
      digests,
    });
  }
}

export type RestartDecision =
  | Readonly<{ kind: "preflight"; pageOrdinal: number; transportAllowed: true }>
  | Readonly<{ kind: "fresh-attempt"; pageOrdinal: number; transportAllowed: true }>
  | Readonly<{ kind: "append-artifact-verification"; pageOrdinal: number; transportAllowed: false }>
  | Readonly<{ kind: "append-page-checkpoint"; pageOrdinal: number; transportAllowed: false }>
  | Readonly<{ kind: "close-chain"; pageOrdinal: number; transportAllowed: false }>
  | Readonly<{ kind: "restart-normalization"; pageOrdinal: number; transportAllowed: false }>
  | Readonly<{ kind: "run-selection"; pageOrdinal: number; transportAllowed: false }>
  | Readonly<{
      kind: "terminal";
      pageOrdinal: number;
      terminalState: NonNullable<JournalEntry["terminalState"]>;
      transportAllowed: false;
    }>;

function artifactExpectation(entry: JournalEntry): CommittedArtifactExpectation | null {
  if (
    entry.artifactObservationId === null ||
    entry.artifactDigest === null ||
    entry.artifactSizeBytes === null ||
    entry.artifactObservationHash === null
  ) {
    return null;
  }
  return {
    artifactObservationId: entry.artifactObservationId,
    artifactDigest: entry.artifactDigest,
    artifactSizeBytes: entry.artifactSizeBytes,
    artifactObservationHash: entry.artifactObservationHash,
    retrievalAttemptId: entry.retrievalAttemptId,
    requestIdentityHash: entry.requestIdentityHash,
  };
}

export async function decideAcquisitionRestart(
  input: Readonly<{
    journal: AcquisitionJournal;
    journalId: string;
    expectedIdentity: JournalIdentityInput;
    expectedConfigurationHash: string;
    artifactStore: ArtifactStore;
  }>,
): Promise<RestartDecision> {
  const entries = await input.journal.load(input.journalId);
  validateJournalEntries(entries, input.expectedIdentity);
  if (
    entries.some(
      (entry) =>
        entry.requestIdentityHash !== input.expectedIdentity.requestIdentityHash ||
        entry.acquisitionConfigurationHash !== input.expectedConfigurationHash,
    )
  ) {
    throw new TypeError("journal-conflict");
  }
  const verifiedObservations = new Set<string>();
  for (const entry of entries) {
    if (
      ![
        "artifact-committed",
        "artifact-verified",
        "page-checkpointed",
        "chain-complete",
        "normalization-started",
        "normalization-complete",
        "selection-started",
        "completed",
      ].includes(entry.checkpointKind)
    ) {
      continue;
    }
    const expected = artifactExpectation(entry);
    if (expected !== null && !verifiedObservations.has(expected.artifactObservationId)) {
      await verifyCommittedArtifact(input.artifactStore, expected);
      verifiedObservations.add(expected.artifactObservationId);
    }
  }
  const latest = entries.at(-1);
  if (latest === undefined) throw new TypeError("journal-empty");
  if (latest.terminalState !== null) {
    return {
      kind: "terminal",
      pageOrdinal: latest.pageOrdinal,
      terminalState: latest.terminalState,
      transportAllowed: false,
    };
  }
  switch (latest.checkpointKind) {
    case "acquisition-declared":
      return { kind: "preflight", pageOrdinal: latest.pageOrdinal, transportAllowed: true };
    case "attempt-started":
    case "request-succeeded":
      return { kind: "fresh-attempt", pageOrdinal: latest.pageOrdinal, transportAllowed: true };
    case "artifact-committed":
      return {
        kind: "append-artifact-verification",
        pageOrdinal: latest.pageOrdinal,
        transportAllowed: false,
      };
    case "artifact-verified":
      return {
        kind: "append-page-checkpoint",
        pageOrdinal: latest.pageOrdinal,
        transportAllowed: false,
      };
    case "page-checkpointed":
      return latest.nextTokenHash === TERMINAL_TOKEN_HASH
        ? { kind: "close-chain", pageOrdinal: latest.pageOrdinal, transportAllowed: false }
        : { kind: "preflight", pageOrdinal: latest.pageOrdinal + 1, transportAllowed: true };
    case "chain-complete":
    case "normalization-started":
      return {
        kind: "restart-normalization",
        pageOrdinal: latest.pageOrdinal,
        transportAllowed: false,
      };
    case "normalization-complete":
    case "selection-started":
      return { kind: "run-selection", pageOrdinal: latest.pageOrdinal, transportAllowed: false };
    case "completed":
    case "stopped":
    case "failed-clean":
    case "quarantined":
      throw new TypeError("journal-terminal-state-missing");
  }
}
