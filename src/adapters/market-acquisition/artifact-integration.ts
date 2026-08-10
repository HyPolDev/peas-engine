import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { isProxy } from "node:util/types";
import { canonicalJson, type JsonValue } from "../../core/json.js";
import { P1_10_TEST_AUTHORITY } from "../../internal-test-authority.js";

import type { ArtifactObservation, StoreArtifactResult } from "../../artifacts/artifact-store.js";
import { persistedRetrievalAttemptId } from "../../artifacts/validation.js";
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
  deriveMarketAcquisitionJournalId,
  validateJournalEntries,
} from "./journal.js";
import {
  assertRetentionEnforcedArtifactStore,
  type RetentionEnforcedArtifactStore,
} from "./retention/artifact-access.js";
import { assertOwnedAcquisitionJournal } from "./owned-journal.js";

const HASH = /^[0-9a-f]{64}$/u;
type VerifiedWorkflowReceiptBinding = Readonly<{
  journal: AcquisitionJournal;
  ledgerEntries: readonly ObservationLedgerEntryV1[];
  journalEntries: readonly JournalEntry[];
}>;
const verifiedWorkflowReceipts = new WeakMap<object, VerifiedWorkflowReceiptBinding>();

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
  provider: string;
}>;

const ARTIFACT_EXPECTATION_KEYS = Object.freeze([
  "artifactObservationId",
  "artifactDigest",
  "artifactSizeBytes",
  "artifactObservationHash",
  "retrievalAttemptId",
  "requestIdentityHash",
  "provider",
] as const);

/** Detaches a complete inert expectation tuple before any asynchronous artifact operation. */
export function snapshotCommittedArtifactExpectation(
  value: CommittedArtifactExpectation,
): CommittedArtifactExpectation {
  if (
    value === null ||
    typeof value !== "object" ||
    isProxy(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  ) {
    throw new TypeError("artifact-expectation-invalid");
  }
  const values = new Map<string, unknown>();
  for (const key of ARTIFACT_EXPECTATION_KEYS) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor) || descriptor.enumerable !== true) {
      throw new TypeError("artifact-expectation-invalid");
    }
    values.set(key, descriptor.value);
  }
  const snapshot = Object.freeze({
    artifactObservationId: values.get("artifactObservationId"),
    artifactDigest: values.get("artifactDigest"),
    artifactSizeBytes: values.get("artifactSizeBytes"),
    artifactObservationHash: values.get("artifactObservationHash"),
    retrievalAttemptId: values.get("retrievalAttemptId"),
    requestIdentityHash: values.get("requestIdentityHash"),
    provider: values.get("provider"),
  });
  if (
    typeof snapshot.artifactObservationId !== "string" ||
    typeof snapshot.artifactDigest !== "string" ||
    typeof snapshot.artifactSizeBytes !== "number" ||
    typeof snapshot.artifactObservationHash !== "string" ||
    typeof snapshot.retrievalAttemptId !== "string" ||
    typeof snapshot.requestIdentityHash !== "string" ||
    typeof snapshot.provider !== "string"
  ) {
    throw new TypeError("artifact-expectation-invalid");
  }
  return snapshot as CommittedArtifactExpectation;
}

export type VerifiedAcquisitionArtifact = Readonly<{
  observation: ArtifactObservation;
  digest: string;
  sizeBytes: number;
  consumedSizeBytes: number;
}>;

export async function verifyCommittedArtifact(
  store: RetentionEnforcedArtifactStore,
  expected: CommittedArtifactExpectation,
): Promise<VerifiedAcquisitionArtifact> {
  assertRetentionEnforcedArtifactStore(store);
  expected = snapshotCommittedArtifactExpectation(expected);
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
  const persistedAttemptId = persistedRetrievalAttemptId(expected.retrievalAttemptId);
  if (
    observation === undefined ||
    observation.artifactDigest !== expected.artifactDigest ||
    observation.observationHash !== expected.artifactObservationHash ||
    (observation.attemptId !== expected.retrievalAttemptId &&
      observation.attemptId !== persistedAttemptId) ||
    observation.request.identityHash !== expected.requestIdentityHash
  ) {
    throw new TypeError("artifact-observation-mismatch");
  }
  const attempt =
    (await store.getAttempt(expected.retrievalAttemptId)) ??
    (observation.attemptId === expected.retrievalAttemptId
      ? undefined
      : await store.getAttempt(observation.attemptId));
  if (attempt === undefined) throw new TypeError("artifact-attempt-missing");
  if (attempt.attemptId !== observation.attemptId) {
    throw new TypeError("artifact-attempt-identity-mismatch");
  }
  if (attempt.provider !== observation.provider) {
    throw new TypeError("artifact-attempt-provider-mismatch");
  }
  if (attempt.request.identityHash !== expected.requestIdentityHash) {
    throw new TypeError("artifact-attempt-request-mismatch");
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
    const facts = stage.facts;
    const kindValid =
      (checkpoint.checkpointKind === "acquisition-declared" &&
        facts.kind === "acquisition.declared" &&
        facts.acquisitionObservationId === checkpoint.acquisitionObservationId &&
        facts.retrievalAttemptId === checkpoint.retrievalAttemptId &&
        facts.sanitizedRequestIdentityHash === checkpoint.requestIdentityHash &&
        facts.provider === "alpaca") ||
      (checkpoint.checkpointKind === "request-started" &&
        facts.kind === "request.started" &&
        facts.acquisitionObservationId === checkpoint.acquisitionObservationId) ||
      (checkpoint.checkpointKind === "attempt-started" &&
        facts.kind === "request.started" &&
        facts.acquisitionObservationId === checkpoint.acquisitionObservationId) ||
      (checkpoint.checkpointKind === "request-succeeded" &&
        facts.kind === "request.succeeded" &&
        facts.acquisitionObservationId === checkpoint.acquisitionObservationId) ||
      (checkpoint.checkpointKind === "artifact-committed" &&
        facts.kind === "artifact.committed" &&
        facts.acquisitionObservationId === checkpoint.acquisitionObservationId &&
        facts.vaultObservationId === checkpoint.artifactObservationId &&
        facts.artifactDigest === checkpoint.artifactDigest &&
        facts.sizeBytes === checkpoint.artifactSizeBytes &&
        facts.vaultObservationHash === checkpoint.artifactObservationHash) ||
      (checkpoint.checkpointKind === "artifact-verified" &&
        facts.kind === "artifact.verified" &&
        facts.acquisitionObservationId === checkpoint.acquisitionObservationId &&
        facts.vaultObservationId === checkpoint.artifactObservationId &&
        facts.artifactDigest === checkpoint.artifactDigest &&
        facts.metadataSizeBytes === checkpoint.artifactSizeBytes) ||
      (["chain-complete", "normalization-started"].includes(checkpoint.checkpointKind) &&
        facts.kind === "artifact.verified") ||
      (["normalization-complete", "selection-started"].includes(checkpoint.checkpointKind) &&
        ["normalization.emitted", "normalization.ignored", "normalization.quarantined"].includes(
          facts.kind,
        )) ||
      (checkpoint.checkpointKind === "completed" && facts.kind === "selection.recorded") ||
      (["stopped", "failed-clean", "quarantined"].includes(checkpoint.checkpointKind) &&
        ["failure.recorded", "normalization.quarantined"].includes(facts.kind));
    if (!kindValid) throw new TypeError("journal-ledger-stage-semantic-invalid");
  }
}

export function validateExactWorkflowLedgerCoverage(
  journal: readonly JournalEntry[],
  ledger: readonly ObservationLedgerEntryV1[],
): void {
  const ledgerById = new Map(ledger.map((entry) => [entry.entryId, entry]));
  const coveredLedgerIds = new Set(
    journal.flatMap((entry) => [
      ...(entry.stageLedgerFactId === null ? [] : [entry.stageLedgerFactId]),
      ...entry.causalParentFactIds,
    ]),
  );
  let coverageChanged = true;
  while (coverageChanged) {
    coverageChanged = false;
    for (const entryId of [...coveredLedgerIds]) {
      const entry = ledgerById.get(entryId);
      if (entry === undefined) throw new TypeError("acquisition-workflow-ledger-coverage-invalid");
      for (const parentId of entry.parentEntryIds) {
        if (!coveredLedgerIds.has(parentId)) {
          coveredLedgerIds.add(parentId);
          coverageChanged = true;
        }
      }
    }
    for (const entry of ledger) {
      if (
        entry.facts.kind === "clock.regression" &&
        coveredLedgerIds.has(entry.facts.priorEntryId) &&
        coveredLedgerIds.has(entry.facts.regressingEntryId) &&
        !coveredLedgerIds.has(entry.entryId)
      ) {
        coveredLedgerIds.add(entry.entryId);
        coverageChanged = true;
      }
    }
  }
  if (
    coveredLedgerIds.size !== ledger.length ||
    ledger.some((entry) => !coveredLedgerIds.has(entry.entryId))
  ) {
    throw new TypeError("acquisition-workflow-ledger-coverage-invalid");
  }
}

export async function loadWorkflowProducedAcquisitionEvidence(
  journal: AcquisitionJournal,
  journalId: string,
  expectedIdentity: JournalIdentityInput,
): Promise<
  Readonly<{
    journal: readonly JournalEntry[];
    ledger: readonly ObservationLedgerEntryV1[];
  }>
> {
  assertOwnedAcquisitionJournal(journal);
  if (journalId !== deriveMarketAcquisitionJournalId(expectedIdentity)) {
    throw new TypeError("journal-identity-invalid");
  }
  const entries = await journal.load(journalId);
  validateJournalEntries(entries, expectedIdentity);
  const ledger = await journal.loadLedgerEntries();
  validateJournalLedgerBindings(entries, ledger);
  const journalProofs = await Promise.all(
    entries.map((entry) => journal.isWorkflowProducedJournalEntry(entry.journalEntryHash)),
  );
  const ledgerProofs = await Promise.all(
    ledger.map((entry) => journal.isWorkflowProducedLedgerEntry(entry.entryId)),
  );
  const { isOwnedLiveCredentialAcquisitionJournal, isOwnedLiveWorkflowJournalEntryTrusted } =
    await import("./credentials.js");
  const liveWorkflowTrusted = !isOwnedLiveCredentialAcquisitionJournal(journal)
    ? true
    : entries.every((entry) => isOwnedLiveWorkflowJournalEntryTrusted(journal, entry));
  if (
    entries.length === 0 ||
    ledger.length === 0 ||
    journalProofs.some((proved) => !proved) ||
    ledgerProofs.some((proved) => !proved) ||
    !liveWorkflowTrusted ||
    entries.some(
      (entry) =>
        entry.stageLedgerFactId === null &&
        entry.checkpointKind !== "attempt-started" &&
        entry.checkpointKind !== "page-checkpointed",
    )
  ) {
    throw new TypeError("acquisition-workflow-provenance-invalid");
  }
  return Object.freeze({ journal: entries, ledger });
}

/**
 * Sole live workflow extension. Existing credential-rooted bytes must be an exact prefix and every
 * artifact-bearing checkpoint is re-proved against the owned retention-enforced store before the
 * private journal writer can receive a one-shot receipt.
 */
export type VerifiedAcquisitionWorkflowEvidenceInput = Readonly<{
  journal: AcquisitionJournal;
  journalId: string;
  expectedIdentity: JournalIdentityInput;
  artifactStore: RetentionEnforcedArtifactStore;
  journalEntries: readonly JournalEntry[];
  ledgerEntries: readonly ObservationLedgerEntryV1[];
}>;

async function persistVerifiedAcquisitionWorkflowEvidenceInternal(
  input: VerifiedAcquisitionWorkflowEvidenceInput,
): Promise<void> {
  const journal = input.journal;
  const artifactStore = input.artifactStore;
  const journalId = input.journalId;
  const expectedIdentity = JSON.parse(
    canonicalJson(input.expectedIdentity as unknown as JsonValue),
  ) as JournalIdentityInput;
  const journalEntries = input.journalEntries.map(
    (entry) => JSON.parse(canonicalJson(entry as unknown as JsonValue)) as JournalEntry,
  );
  const ledgerInput = input.ledgerEntries.map(
    (entry) => JSON.parse(canonicalJson(entry as unknown as JsonValue)) as ObservationLedgerEntryV1,
  );
  assertOwnedAcquisitionJournal(journal);
  assertRetentionEnforcedArtifactStore(artifactStore);
  const { assertOwnedLiveCredentialAcquisitionJournal } = await import("./credentials.js");
  assertOwnedLiveCredentialAcquisitionJournal(journal);
  if (journalId !== deriveMarketAcquisitionJournalId(expectedIdentity)) {
    throw new TypeError("journal-identity-invalid");
  }
  validateJournalEntries(journalEntries, expectedIdentity);
  const ledgerEntries = validateObservationLedgerBundle(ledgerInput);
  validateJournalLedgerBindings(journalEntries, ledgerEntries);
  validateExactWorkflowLedgerCoverage(journalEntries, ledgerEntries);
  const currentJournal = await journal.load(journalId);
  const currentLedger = await journal.loadLedgerEntries();
  if (
    currentJournal.length < 2 ||
    currentJournal.length > journalEntries.length ||
    currentLedger.length > ledgerEntries.length ||
    canonicalJson(journalEntries.slice(0, currentJournal.length) as unknown as JsonValue) !==
      canonicalJson(currentJournal as unknown as JsonValue) ||
    canonicalJson(ledgerEntries.slice(0, currentLedger.length) as unknown as JsonValue) !==
      canonicalJson(currentLedger as unknown as JsonValue)
  ) {
    throw new TypeError("acquisition-workflow-prefix-conflict");
  }
  const suffix = journalEntries.slice(currentJournal.length);
  const { isOwnedLiveWorkflowJournalEntryTrusted, prepareOwnedWorkflowJournalLinks } = await import(
    "./credentials.js"
  );
  const pending = currentJournal.filter(
    (entry) => !isOwnedLiveWorkflowJournalEntryTrusted(journal, entry),
  );
  const extension = [...pending, ...suffix];
  if (
    extension.length === 0 ||
    pending.some(
      (entry, index) =>
        currentJournal[currentJournal.length - pending.length + index]?.journalEntryHash !==
        entry.journalEntryHash,
    ) ||
    extension.some(
      (entry) =>
        entry.stageLedgerFactId === null &&
        entry.checkpointKind !== "attempt-started" &&
        entry.checkpointKind !== "page-checkpointed",
    )
  ) {
    throw new TypeError("acquisition-workflow-extension-invalid");
  }
  const links = prepareOwnedWorkflowJournalLinks(journal, extension);
  for (const entry of extension) {
    const expected = artifactExpectation(entry);
    if (
      [
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
      if (expected === null) throw new TypeError("journal-artifact-tuple-required");
      await verifyCommittedArtifact(artifactStore, expected);
    }
  }
  const receipt = Object.freeze({ kind: "verified-acquisition-workflow-receipt" as const });
  verifiedWorkflowReceipts.set(receipt, {
    journal,
    ledgerEntries,
    journalEntries: Object.freeze(suffix),
  });
  const { persistVerifiedAcquisitionWorkflowReceipt } = await import("./journal.js");
  await persistVerifiedAcquisitionWorkflowReceipt(receipt);
  const { commitOwnedWorkflowJournalLinks } = await import("./credentials.js");
  commitOwnedWorkflowJournalLinks(journal, links);
}

/** Synthetic/test composition only; live production accepts no caller-authored arrays. */
export async function persistVerifiedAcquisitionWorkflowEvidence(
  input: VerifiedAcquisitionWorkflowEvidenceInput,
): Promise<void> {
  if (P1_10_TEST_AUTHORITY === undefined) {
    throw new TypeError("verified-workflow-test-composition-unavailable");
  }
  await persistVerifiedAcquisitionWorkflowEvidenceInternal(input);
}

/** Consumes one lexical adapter receipt; ordinary callers cannot mint its evidence binding. */
export async function persistOwnedProductionAcquisitionWorkflowEvidence(
  receipt: object,
): Promise<void> {
  const { consumeOwnedProductionWorkflowEvidenceReceipt } = await import("./alpaca/adapter.js");
  const binding = consumeOwnedProductionWorkflowEvidenceReceipt(receipt);
  await persistVerifiedAcquisitionWorkflowEvidenceInternal(binding);
}

export function consumeVerifiedAcquisitionWorkflowReceipt(
  receipt: object,
): VerifiedWorkflowReceiptBinding {
  const binding = verifiedWorkflowReceipts.get(receipt);
  if (binding === undefined) {
    throw new TypeError("verified-acquisition-workflow-receipt-required");
  }
  verifiedWorkflowReceipts.delete(receipt);
  return binding;
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
  | Readonly<{ kind: "load-credentials"; pageOrdinal: number; transportAllowed: false }>
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
    provider: "alpaca",
  };
}

export async function decideAcquisitionRestart(
  input: Readonly<{
    journal: AcquisitionJournal;
    journalId: string;
    expectedIdentity: JournalIdentityInput;
    expectedConfigurationHash: string;
    artifactStore: RetentionEnforcedArtifactStore;
  }>,
): Promise<RestartDecision> {
  const { journal: entries } = await loadWorkflowProducedAcquisitionEvidence(
    input.journal,
    input.journalId,
    input.expectedIdentity,
  );
  if (
    entries.some(
      (entry) =>
        entry.requestIdentityHash !== input.expectedIdentity.requestIdentityHash ||
        entry.acquisitionConfigurationHash !== input.expectedConfigurationHash,
    )
  ) {
    throw new TypeError("journal-conflict");
  }
  const verifiedObservations = new Map<string, string>();
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
    if (expected === null) {
      throw new TypeError("journal-artifact-tuple-required");
    }
    const tuple = canonicalJson(expected as unknown as JsonValue);
    const prior = verifiedObservations.get(expected.artifactObservationId);
    if (prior !== undefined && prior !== tuple) {
      throw new TypeError("journal-artifact-expectation-conflict");
    }
    if (prior === undefined) {
      await verifyCommittedArtifact(input.artifactStore, expected);
      verifiedObservations.set(expected.artifactObservationId, tuple);
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
    case "request-started":
      return { kind: "load-credentials", pageOrdinal: latest.pageOrdinal, transportAllowed: false };
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

Object.freeze(MarketAcquisitionLedger.prototype);
Object.freeze(DeliveryConflictRegistry.prototype);
