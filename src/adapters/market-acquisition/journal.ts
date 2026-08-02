import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";

import { canonicalJson, type JsonValue } from "../../core/json.js";
import type { ObservationLedgerEntryV1 } from "../../providers/observation-ledger.js";
import { isProxy } from "node:util/types";

import { P1_10_TEST_AUTHORITY } from "../../internal-test-authority.js";
import { AUTHORIZATION_MODE, MARKET_ACQUISITION_LIMITS } from "./contracts.js";
import { assertOwnedAcquisitionJournal } from "./owned-journal.js";

export const JOURNAL_SCHEMA_VERSION = 1 as const;
export const NO_TOKEN_HASH = "no-token";
export const TERMINAL_TOKEN_HASH = "terminal";
export const GENESIS_HASH = "genesis";

export const JOURNAL_CHECKPOINT_KINDS = Object.freeze([
  "acquisition-declared",
  "request-started",
  "attempt-started",
  "request-succeeded",
  "artifact-committed",
  "artifact-verified",
  "page-checkpointed",
  "chain-complete",
  "normalization-started",
  "normalization-complete",
  "selection-started",
  "completed",
  "stopped",
  "failed-clean",
  "quarantined",
] as const);
export type JournalCheckpointKind = (typeof JOURNAL_CHECKPOINT_KINDS)[number];
export type JournalTerminalState = "completed" | "stopped" | "failed-clean" | "quarantined";

export type JournalCheckpointBody = Readonly<{
  schemaVersion: 1;
  runSessionNonce: string;
  acquisitionObservationId: string;
  marketAcquisitionId: string;
  admittedMarketAcquisitionIds: readonly string[];
  requestIdentityHash: string;
  acquisitionConfigurationHash: string;
  providerId: string;
  datasetId: string;
  feedId: string;
  endpointChannelId: string;
  authorizationMode: "p1-09-approved";
  logicalPageIdentityHash: string;
  pageOrdinal: number;
  currentTokenHash: string;
  currentResumableTokenMaterial: string | null;
  nextTokenHash: string | null;
  nextResumableTokenMaterial: string | null;
  currentContinuationBindingHash: string | null;
  nextContinuationBindingHash: string | null;
  attemptId: string;
  retrievalAttemptId: string;
  attemptOrdinal: number;
  artifactObservationId: string | null;
  artifactDigest: string | null;
  artifactSizeBytes: number | null;
  artifactObservationHash: string | null;
  artifactContentId: string | null;
  rawArtifactId: string | null;
  stageLedgerFactId: string | null;
  causalParentFactIds: readonly string[];
  pageRecordCount: number | null;
  pageNormalizedFactCount: number | null;
  pageChainHash: string;
  cumulativeSuccessfulPages: number;
  cumulativeVerifiedBytes: number;
  cumulativeRecords: number;
  cumulativeNormalizedFacts: number;
  cumulativeAttempts: number;
  acquisitionDeadlineBasis: string;
  quotaWindowEvidence: readonly number[];
  terminalState: JournalTerminalState | null;
  terminalReasonCode: string | null;
  incomplete: boolean;
}>;

export type JournalEntry = Readonly<
  JournalCheckpointBody & {
    marketAcquisitionJournalId: string;
    journalSequence: number;
    priorJournalEntryHash: string;
    checkpointKind: JournalCheckpointKind;
    journalEntryHash: string;
  }
>;

export type JournalIdentityInput = Readonly<{
  schemaVersion: 1;
  requestIdentityHash: string;
  providerId: string;
  datasetId: string;
  feedId: string;
  endpointChannelId: string;
}>;

const HEX_64 = /^[0-9a-f]{64}$/u;
const PREFIXED_ID = /^[a-z][a-z0-9]*1_[0-9a-f]{64}$/u;
const TOKEN_BYTES_MAX = MARKET_ACQUISITION_LIMITS.opaquePageTokenBytes;
const PAGE_MAX = MARKET_ACQUISITION_LIMITS.successfulPages;
const AGGREGATE_BYTES_MAX = MARKET_ACQUISITION_LIMITS.aggregateVerifiedBytes;
const RECORDS_PER_PAGE_MAX = MARKET_ACQUISITION_LIMITS.recordsPerPage;
const FACTS_MAX = MARKET_ACQUISITION_LIMITS.normalizedFacts;
const ATTEMPTS_MAX = MARKET_ACQUISITION_LIMITS.attemptsPerAcquisition;

function lp(bytes: Buffer): Buffer {
  const prefix = Buffer.alloc(8);
  prefix.writeBigUInt64BE(BigInt(bytes.byteLength));
  return Buffer.concat([prefix, bytes]);
}

/** Accepted PEAS eight-byte length framing over domain and canonical JSON preimage. */
export function framedHash(domain: string, preimage: JsonValue): string {
  const domainBytes = Buffer.from(domain, "utf8");
  const preimageBytes = Buffer.from(canonicalJson(preimage), "utf8");
  return createHash("sha256").update(lp(domainBytes)).update(lp(preimageBytes)).digest("hex");
}

function assertSafeCount(value: number, maximum: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new RangeError(`${name}-invalid`);
  }
}

function assertExactKeys(value: object, expected: readonly string[], name: string): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (
    actual.length !== sortedExpected.length ||
    actual.some((key, index) => key !== sortedExpected[index])
  ) {
    throw new TypeError(`${name}-shape-invalid`);
  }
}

function assertHash(value: string, name: string): void {
  if (!HEX_64.test(value)) throw new TypeError(`${name}-invalid`);
}

function assertPrefixedId(value: string, prefix: string, name: string): void {
  if (!value.startsWith(prefix) || !PREFIXED_ID.test(value)) {
    throw new TypeError(`${name}-invalid`);
  }
}

function assertSortedUnique(values: readonly string[], name: string): void {
  if (
    values.some(
      (value, index) =>
        index > 0 && Buffer.compare(Buffer.from(values[index - 1] ?? ""), Buffer.from(value)) >= 0,
    )
  ) {
    throw new TypeError(`${name}-not-sorted-unique`);
  }
}

export function deriveMarketAcquisitionJournalId(input: JournalIdentityInput): string {
  return framedHash("peas/market-acquisition-journal/v1", input as unknown as JsonValue);
}

export function derivePrivateTokenHash(opaqueTokenMaterial: string): string {
  if (
    typeof opaqueTokenMaterial !== "string" ||
    opaqueTokenMaterial.length === 0 ||
    Buffer.byteLength(opaqueTokenMaterial, "utf8") > TOKEN_BYTES_MAX
  ) {
    throw new RangeError("private-token-invalid");
  }
  return framedHash("peas/market-acquisition-private-token/v1", {
    opaqueTokenMaterial,
  });
}

export function deriveLogicalPageIdentityHash(
  input: Readonly<{
    requestIdentityHash: string;
    pageOrdinal: number;
    currentTokenHash: string;
  }>,
): string {
  assertHash(input.requestIdentityHash, "request-identity");
  assertSafeCount(input.pageOrdinal, Number.MAX_SAFE_INTEGER, "page-ordinal");
  if (input.currentTokenHash !== NO_TOKEN_HASH && !HEX_64.test(input.currentTokenHash)) {
    throw new TypeError("current-token-hash-invalid");
  }
  if ((input.pageOrdinal === 0) !== (input.currentTokenHash === NO_TOKEN_HASH)) {
    throw new TypeError("first-page-token-invalid");
  }
  return framedHash("peas/market-acquisition-logical-page/v1", input as unknown as JsonValue);
}

export function deriveAttemptControlIdentities(
  input: Readonly<{
    logicalPageIdentityHash: string;
    attemptOrdinal: number;
    runSessionNonce: string;
  }>,
): Readonly<{ attemptId: string; retrievalAttemptId: string }> {
  assertHash(input.logicalPageIdentityHash, "logical-page-identity");
  assertSafeCount(
    input.attemptOrdinal,
    MARKET_ACQUISITION_LIMITS.attemptsPerLogicalPage - 1,
    "attempt-ordinal",
  );
  if (
    typeof input.runSessionNonce !== "string" ||
    input.runSessionNonce.length === 0 ||
    Buffer.byteLength(input.runSessionNonce, "utf8") > 256
  ) {
    throw new TypeError("run-session-nonce-invalid");
  }
  const digest = framedHash(
    "peas/market-acquisition-attempt-control/v1",
    input as unknown as JsonValue,
  );
  return Object.freeze({
    attemptId: `mat1_${digest}`,
    retrievalAttemptId: `rat1_${digest}`,
  });
}

export type ContinuationBindingInput = Readonly<{
  precedingMarketAcquisitionId: string;
  requestIdentityHash: string;
  precedingLogicalPageIdentityHash: string;
  precedingPageOrdinal: number;
  precedingArtifactObservationId: string;
  precedingArtifactDigest: string;
  precedingPageChainHash: string;
  nextPageOrdinal: number;
  nextTokenHash: string;
}>;

export function deriveContinuationBindingHash(input: ContinuationBindingInput): string {
  assertPrefixedId(input.precedingMarketAcquisitionId, "maq1_", "market-acquisition-id");
  assertHash(input.requestIdentityHash, "request-identity");
  assertHash(input.precedingLogicalPageIdentityHash, "logical-page-identity");
  assertSafeCount(input.precedingPageOrdinal, Number.MAX_SAFE_INTEGER, "preceding-page-ordinal");
  assertHash(input.precedingArtifactObservationId, "artifact-observation-id");
  assertHash(input.precedingArtifactDigest, "artifact-digest");
  assertHash(input.precedingPageChainHash, "page-chain-hash");
  if (input.nextPageOrdinal !== input.precedingPageOrdinal + 1) {
    throw new TypeError("continuation-page-gap");
  }
  assertHash(input.nextTokenHash, "next-token-hash");
  return framedHash(
    "peas/market-acquisition-continuation-binding/v1",
    input as unknown as JsonValue,
  );
}

export type PageChainInput = Readonly<{
  priorPageChainHash: string;
  marketAcquisitionId: string;
  requestIdentityHash: string;
  logicalPageIdentityHash: string;
  pageOrdinal: number;
  artifactObservationId: string;
  artifactDigest: string;
  artifactSizeBytes: number;
  artifactObservationHash: string;
  artifactContentId: string;
  rawArtifactId: string;
  currentTokenHash: string;
  nextTokenHash: string;
  pageRecordCount: number;
  cumulativeSuccessfulPages: number;
  cumulativeVerifiedBytes: number;
  cumulativeRecords: number;
  cumulativeNormalizedFacts: number;
  cumulativeAttempts: number;
}>;

export function derivePageChainHash(input: PageChainInput): string {
  if (input.priorPageChainHash !== GENESIS_HASH) {
    assertHash(input.priorPageChainHash, "prior-page-chain-hash");
  }
  assertPrefixedId(input.marketAcquisitionId, "maq1_", "market-acquisition-id");
  assertHash(input.requestIdentityHash, "request-identity");
  assertHash(input.logicalPageIdentityHash, "logical-page-identity");
  assertSafeCount(input.pageOrdinal, PAGE_MAX - 1, "page-ordinal");
  assertHash(input.artifactObservationId, "artifact-observation-id");
  assertHash(input.artifactDigest, "artifact-digest");
  assertSafeCount(
    input.artifactSizeBytes,
    MARKET_ACQUISITION_LIMITS.rawArtifactBytes,
    "artifact-size",
  );
  assertHash(input.artifactObservationHash, "artifact-observation-hash");
  assertPrefixedId(input.artifactContentId, "mac1_", "artifact-content-id");
  assertPrefixedId(input.rawArtifactId, "mar1_", "raw-artifact-id");
  if (input.currentTokenHash !== NO_TOKEN_HASH) assertHash(input.currentTokenHash, "current-token");
  if (input.nextTokenHash !== TERMINAL_TOKEN_HASH) assertHash(input.nextTokenHash, "next-token");
  assertSafeCount(input.pageRecordCount, RECORDS_PER_PAGE_MAX, "page-record-count");
  assertSafeCount(input.cumulativeSuccessfulPages, PAGE_MAX, "cumulative-pages");
  assertSafeCount(input.cumulativeVerifiedBytes, AGGREGATE_BYTES_MAX, "cumulative-bytes");
  assertSafeCount(input.cumulativeRecords, PAGE_MAX * RECORDS_PER_PAGE_MAX, "cumulative-records");
  if (input.cumulativeNormalizedFacts !== 0) {
    throw new RangeError("page-chain-normalized-facts-invalid");
  }
  assertSafeCount(input.cumulativeAttempts, ATTEMPTS_MAX, "cumulative-attempts");
  return framedHash("peas/market-acquisition-page-chain/v1", input as unknown as JsonValue);
}

export type PageAdmission = Readonly<{
  pageChainHash: string;
  nextTokenHash: string;
  nextContinuationBindingHash: string | null;
}>;

/**
 * Freezes the contract's acyclic order: page-chain first, then continuation binding from the
 * newly admitted chain hash.
 */
export function planPageAdmission(
  input: Omit<PageChainInput, "nextTokenHash">,
  nextTokenMaterial: string | null,
): PageAdmission {
  const nextTokenHash =
    nextTokenMaterial === null ? TERMINAL_TOKEN_HASH : derivePrivateTokenHash(nextTokenMaterial);
  const pageChainHash = derivePageChainHash({ ...input, nextTokenHash });
  const nextContinuationBindingHash =
    nextTokenMaterial === null
      ? null
      : deriveContinuationBindingHash({
          precedingMarketAcquisitionId: input.marketAcquisitionId,
          requestIdentityHash: input.requestIdentityHash,
          precedingLogicalPageIdentityHash: input.logicalPageIdentityHash,
          precedingPageOrdinal: input.pageOrdinal,
          precedingArtifactObservationId: input.artifactObservationId,
          precedingArtifactDigest: input.artifactDigest,
          precedingPageChainHash: pageChainHash,
          nextPageOrdinal: input.pageOrdinal + 1,
          nextTokenHash,
        });
  return Object.freeze({ pageChainHash, nextTokenHash, nextContinuationBindingHash });
}

export function validateContinuationAuthority(
  preceding: Readonly<{
    marketAcquisitionId: string;
    requestIdentityHash: string;
    logicalPageIdentityHash: string;
    pageOrdinal: number;
    artifactObservationId: string;
    artifactDigest: string;
    pageChainHash: string;
    nextTokenHash: string;
    nextContinuationBindingHash: string;
  }>,
  next: Readonly<{
    requestIdentityHash: string;
    pageOrdinal: number;
    tokenMaterial: string;
    currentTokenHash: string;
    currentContinuationBindingHash: string;
  }>,
  previouslyConsumedTokenHashes: ReadonlySet<string>,
): void {
  if (next.requestIdentityHash !== preceding.requestIdentityHash) {
    throw new TypeError("continuation-query-substitution");
  }
  if (next.pageOrdinal !== preceding.pageOrdinal + 1) throw new TypeError("continuation-page-gap");
  const tokenHash = derivePrivateTokenHash(next.tokenMaterial);
  if (
    tokenHash !== next.currentTokenHash ||
    tokenHash !== preceding.nextTokenHash ||
    previouslyConsumedTokenHashes.has(tokenHash)
  ) {
    throw new TypeError("continuation-token-invalid");
  }
  const expectedBinding = deriveContinuationBindingHash({
    precedingMarketAcquisitionId: preceding.marketAcquisitionId,
    requestIdentityHash: preceding.requestIdentityHash,
    precedingLogicalPageIdentityHash: preceding.logicalPageIdentityHash,
    precedingPageOrdinal: preceding.pageOrdinal,
    precedingArtifactObservationId: preceding.artifactObservationId,
    precedingArtifactDigest: preceding.artifactDigest,
    precedingPageChainHash: preceding.pageChainHash,
    nextPageOrdinal: next.pageOrdinal,
    nextTokenHash: tokenHash,
  });
  if (
    expectedBinding !== preceding.nextContinuationBindingHash ||
    expectedBinding !== next.currentContinuationBindingHash
  ) {
    throw new TypeError("continuation-binding-invalid");
  }
}

const BODY_KEYS = Object.freeze([
  "schemaVersion",
  "runSessionNonce",
  "acquisitionObservationId",
  "marketAcquisitionId",
  "admittedMarketAcquisitionIds",
  "requestIdentityHash",
  "acquisitionConfigurationHash",
  "providerId",
  "datasetId",
  "feedId",
  "endpointChannelId",
  "authorizationMode",
  "logicalPageIdentityHash",
  "pageOrdinal",
  "currentTokenHash",
  "currentResumableTokenMaterial",
  "nextTokenHash",
  "nextResumableTokenMaterial",
  "currentContinuationBindingHash",
  "nextContinuationBindingHash",
  "attemptId",
  "retrievalAttemptId",
  "attemptOrdinal",
  "artifactObservationId",
  "artifactDigest",
  "artifactSizeBytes",
  "artifactObservationHash",
  "artifactContentId",
  "rawArtifactId",
  "stageLedgerFactId",
  "causalParentFactIds",
  "pageRecordCount",
  "pageNormalizedFactCount",
  "pageChainHash",
  "cumulativeSuccessfulPages",
  "cumulativeVerifiedBytes",
  "cumulativeRecords",
  "cumulativeNormalizedFacts",
  "cumulativeAttempts",
  "acquisitionDeadlineBasis",
  "quotaWindowEvidence",
  "terminalState",
  "terminalReasonCode",
  "incomplete",
] as const);

const ENTRY_KEYS = Object.freeze([
  ...BODY_KEYS,
  "marketAcquisitionJournalId",
  "journalSequence",
  "priorJournalEntryHash",
  "checkpointKind",
  "journalEntryHash",
] as const);

function checkpointBody(entry: JournalEntry): JournalCheckpointBody {
  const {
    marketAcquisitionJournalId: _journalId,
    journalSequence: _sequence,
    priorJournalEntryHash: _prior,
    checkpointKind: _kind,
    journalEntryHash: _hash,
    ...body
  } = entry;
  return body;
}

export function deriveJournalEntryHash(entry: Omit<JournalEntry, "journalEntryHash">): string {
  const {
    marketAcquisitionJournalId,
    journalSequence,
    priorJournalEntryHash,
    checkpointKind,
    ...body
  } = entry;
  const canonicalEntryBody = canonicalJson(body as unknown as JsonValue);
  return framedHash("peas/market-acquisition-journal-entry/v1", {
    marketAcquisitionJournalId,
    journalSequence,
    priorJournalEntryHash,
    entryKind: checkpointKind,
    canonicalEntryBody,
  });
}

export function createJournalEntry(
  previous: JournalEntry | null,
  marketAcquisitionJournalId: string,
  checkpointKind: JournalCheckpointKind,
  body: JournalCheckpointBody,
): JournalEntry {
  assertExactKeys(body, BODY_KEYS, "journal-body");
  assertHash(marketAcquisitionJournalId, "journal-id");
  const draft = {
    ...body,
    marketAcquisitionJournalId,
    journalSequence: previous === null ? 0 : previous.journalSequence + 1,
    priorJournalEntryHash: previous === null ? GENESIS_HASH : previous.journalEntryHash,
    checkpointKind,
  } satisfies Omit<JournalEntry, "journalEntryHash">;
  return Object.freeze({ ...draft, journalEntryHash: deriveJournalEntryHash(draft) });
}

function validateCheckpointSemantics(entry: JournalEntry): void {
  assertSafeCount(entry.pageOrdinal, PAGE_MAX - 1, "page-ordinal");
  assertSafeCount(entry.attemptOrdinal, 2, "attempt-ordinal");
  assertSafeCount(entry.cumulativeSuccessfulPages, PAGE_MAX, "cumulative-pages");
  assertSafeCount(entry.cumulativeVerifiedBytes, AGGREGATE_BYTES_MAX, "cumulative-bytes");
  assertSafeCount(entry.cumulativeRecords, PAGE_MAX * RECORDS_PER_PAGE_MAX, "cumulative-records");
  assertSafeCount(entry.cumulativeNormalizedFacts, FACTS_MAX, "cumulative-facts");
  assertSafeCount(entry.cumulativeAttempts, ATTEMPTS_MAX, "cumulative-attempts");
  if (entry.pageRecordCount !== null) {
    assertSafeCount(entry.pageRecordCount, RECORDS_PER_PAGE_MAX, "page-record-count");
  }
  if (entry.pageNormalizedFactCount !== null) {
    assertSafeCount(entry.pageNormalizedFactCount, FACTS_MAX, "page-fact-count");
  }
  if (entry.artifactSizeBytes !== null) {
    assertSafeCount(
      entry.artifactSizeBytes,
      MARKET_ACQUISITION_LIMITS.rawArtifactBytes,
      "artifact-size",
    );
  }
  if (entry.authorizationMode !== AUTHORIZATION_MODE || entry.schemaVersion !== 1) {
    throw new TypeError("journal-authority-invalid");
  }
  if (entry.pageOrdinal === 0) {
    if (
      entry.currentTokenHash !== NO_TOKEN_HASH ||
      entry.currentResumableTokenMaterial !== null ||
      entry.currentContinuationBindingHash !== null
    ) {
      throw new TypeError("first-page-token-invalid");
    }
  } else if (
    !HEX_64.test(entry.currentTokenHash) ||
    entry.currentResumableTokenMaterial === null ||
    entry.currentContinuationBindingHash === null
  ) {
    throw new TypeError("continuation-state-invalid");
  }
  if (entry.currentResumableTokenMaterial !== null) {
    if (derivePrivateTokenHash(entry.currentResumableTokenMaterial) !== entry.currentTokenHash) {
      throw new TypeError("current-token-material-invalid");
    }
  }
  if (entry.nextResumableTokenMaterial !== null) {
    const nextHash = derivePrivateTokenHash(entry.nextResumableTokenMaterial);
    if (entry.nextTokenHash !== nextHash) throw new TypeError("next-token-material-invalid");
  }
  if (entry.terminalState === null) {
    if (entry.terminalReasonCode !== null || !entry.incomplete) {
      throw new TypeError("journal-terminal-state-invalid");
    }
  } else if (entry.terminalReasonCode === null || entry.incomplete) {
    throw new TypeError("journal-terminal-state-invalid");
  }
  assertSortedUnique(entry.causalParentFactIds, "causal-parent-facts");
}

const ARTIFACT_FIELDS = Object.freeze([
  "artifactObservationId",
  "artifactDigest",
  "artifactSizeBytes",
  "artifactObservationHash",
  "artifactContentId",
  "rawArtifactId",
] as const);

const ARTIFACT_REQUIRED = new Set<JournalCheckpointKind>([
  "artifact-committed",
  "artifact-verified",
  "page-checkpointed",
  "chain-complete",
  "normalization-started",
  "normalization-complete",
  "selection-started",
  "completed",
]);

const NONTERMINAL_TRANSITIONS: Readonly<
  Record<JournalCheckpointKind, readonly JournalCheckpointKind[]>
> = Object.freeze({
  "acquisition-declared": ["request-started", "stopped", "failed-clean", "quarantined"],
  "request-started": ["attempt-started", "stopped", "failed-clean", "quarantined"],
  "attempt-started": [
    "attempt-started",
    "request-succeeded",
    "stopped",
    "failed-clean",
    "quarantined",
  ],
  "request-succeeded": [
    "attempt-started",
    "artifact-committed",
    "stopped",
    "failed-clean",
    "quarantined",
  ],
  "artifact-committed": ["artifact-verified", "stopped", "failed-clean", "quarantined"],
  "artifact-verified": ["page-checkpointed", "stopped", "failed-clean", "quarantined"],
  "page-checkpointed": ["attempt-started", "chain-complete", "stopped", "failed-clean"],
  "chain-complete": ["normalization-started", "stopped", "failed-clean", "quarantined"],
  "normalization-started": ["normalization-complete", "stopped", "failed-clean", "quarantined"],
  "normalization-complete": ["selection-started", "stopped", "failed-clean", "quarantined"],
  "selection-started": ["completed", "stopped", "failed-clean", "quarantined"],
  completed: [],
  stopped: [],
  "failed-clean": [],
  quarantined: [],
});

function artifactTuple(entry: JournalEntry): readonly unknown[] | null {
  const values = ARTIFACT_FIELDS.map((field) => entry[field]);
  const present = values.map((value) => value !== null);
  if (present.some(Boolean) && !present.every(Boolean)) {
    throw new TypeError("journal-artifact-tuple-partial");
  }
  return present.every(Boolean) ? values : null;
}

function pinnedArtifactTuple(entry: JournalEntry): readonly unknown[] | null {
  const tuple = artifactTuple(entry);
  return tuple === null
    ? null
    : [
        entry.acquisitionObservationId,
        entry.marketAcquisitionId,
        entry.requestIdentityHash,
        entry.providerId,
        entry.attemptId,
        entry.retrievalAttemptId,
        entry.attemptOrdinal,
        ...tuple,
      ];
}

function validateCheckpointTransition(previous: JournalEntry | null, entry: JournalEntry): void {
  const tuple = artifactTuple(entry);
  if (ARTIFACT_REQUIRED.has(entry.checkpointKind) && tuple === null) {
    throw new TypeError("journal-artifact-tuple-required");
  }
  if (
    ["acquisition-declared", "request-started", "attempt-started", "request-succeeded"].includes(
      entry.checkpointKind,
    ) &&
    tuple !== null
  ) {
    throw new TypeError("journal-artifact-tuple-premature");
  }
  if (previous === null) {
    if (entry.checkpointKind !== "acquisition-declared" || entry.pageOrdinal !== 0) {
      throw new TypeError("journal-initial-checkpoint-invalid");
    }
    return;
  }
  if (!NONTERMINAL_TRANSITIONS[previous.checkpointKind].includes(entry.checkpointKind)) {
    throw new TypeError("journal-checkpoint-transition-invalid");
  }
  const afterPage = previous.checkpointKind === "page-checkpointed";
  const advancesPage = afterPage && entry.checkpointKind === "attempt-started";
  if (entry.pageOrdinal !== previous.pageOrdinal + (advancesPage ? 1 : 0)) {
    throw new TypeError("journal-page-transition-invalid");
  }
  if (advancesPage) {
    if (
      previous.nextTokenHash === null ||
      previous.nextTokenHash === TERMINAL_TOKEN_HASH ||
      previous.nextContinuationBindingHash === null ||
      entry.currentTokenHash !== previous.nextTokenHash ||
      entry.currentContinuationBindingHash !== previous.nextContinuationBindingHash
    ) {
      throw new TypeError("journal-continuation-transition-invalid");
    }
  }
  if (entry.checkpointKind === "chain-complete") {
    if (
      previous.checkpointKind !== "page-checkpointed" ||
      previous.nextTokenHash !== TERMINAL_TOKEN_HASH
    ) {
      throw new TypeError("journal-chain-completion-invalid");
    }
  }
  if (
    previous.pageOrdinal === entry.pageOrdinal &&
    pinnedArtifactTuple(previous) !== null &&
    pinnedArtifactTuple(entry) !== null &&
    canonicalJson(pinnedArtifactTuple(previous) as JsonValue) !==
      canonicalJson(pinnedArtifactTuple(entry) as JsonValue)
  ) {
    throw new TypeError("journal-artifact-tuple-conflict");
  }
  if (
    [
      "acquisition-declared",
      "request-started",
      "attempt-started",
      "request-succeeded",
      "artifact-committed",
      "artifact-verified",
    ].includes(entry.checkpointKind)
  ) {
    if (
      entry.nextTokenHash !== null ||
      entry.nextResumableTokenMaterial !== null ||
      entry.nextContinuationBindingHash !== null
    ) {
      throw new TypeError("journal-next-token-premature");
    }
  } else if (
    entry.checkpointKind === "page-checkpointed" &&
    (entry.nextTokenHash === null ||
      (entry.nextTokenHash === TERMINAL_TOKEN_HASH) !==
        (entry.nextResumableTokenMaterial === null && entry.nextContinuationBindingHash === null))
  ) {
    throw new TypeError("journal-next-token-fields-invalid");
  }
}

export function validateJournalEntries(
  entries: readonly JournalEntry[],
  expectedIdentity: JournalIdentityInput,
): void {
  if (entries.length === 0) throw new TypeError("journal-empty");
  const expectedJournalId = deriveMarketAcquisitionJournalId(expectedIdentity);
  let previous: JournalEntry | null = null;
  let terminalSeen = false;
  let previousPages = 0;
  let previousBytes = 0;
  let previousRecords = 0;
  let previousFacts = 0;
  let previousAttempts = 0;
  const consumedContinuationTokens = new Set<string>();
  for (const entry of entries) {
    assertExactKeys(entry, ENTRY_KEYS, "journal-entry");
    canonicalJson(entry as unknown as JsonValue);
    const { journalEntryHash: _journalEntryHash, ...entryWithoutHash } = entry;
    if (
      entry.marketAcquisitionJournalId !== expectedJournalId ||
      entry.requestIdentityHash !== expectedIdentity.requestIdentityHash ||
      entry.providerId !== expectedIdentity.providerId ||
      entry.datasetId !== expectedIdentity.datasetId ||
      entry.feedId !== expectedIdentity.feedId ||
      entry.endpointChannelId !== expectedIdentity.endpointChannelId
    ) {
      throw new TypeError("journal-identity-mismatch");
    }
    if (
      entry.journalSequence !== (previous?.journalSequence ?? -1) + 1 ||
      entry.priorJournalEntryHash !== (previous?.journalEntryHash ?? GENESIS_HASH) ||
      entry.journalEntryHash !== deriveJournalEntryHash(entryWithoutHash)
    ) {
      throw new TypeError("journal-hash-chain-invalid");
    }
    if (
      entry.cumulativeSuccessfulPages < previousPages ||
      entry.cumulativeVerifiedBytes < previousBytes ||
      entry.cumulativeRecords < previousRecords ||
      entry.cumulativeNormalizedFacts < previousFacts ||
      entry.cumulativeAttempts < previousAttempts
    ) {
      throw new TypeError("journal-counter-regression");
    }
    if (terminalSeen) throw new TypeError("journal-after-terminal");
    validateCheckpointSemantics(entry);
    if (entry.pageOrdinal > 0 && entry.checkpointKind === "attempt-started") {
      if (consumedContinuationTokens.has(entry.currentTokenHash)) {
        throw new TypeError("journal-continuation-token-loop");
      }
      consumedContinuationTokens.add(entry.currentTokenHash);
    }
    validateCheckpointTransition(previous, entry);
    terminalSeen = entry.terminalState !== null;
    previousPages = entry.cumulativeSuccessfulPages;
    previousBytes = entry.cumulativeVerifiedBytes;
    previousRecords = entry.cumulativeRecords;
    previousFacts = entry.cumulativeNormalizedFacts;
    previousAttempts = entry.cumulativeAttempts;
    previous = entry;
  }
}

export interface AcquisitionJournal {
  load(marketAcquisitionJournalId: string): Promise<readonly JournalEntry[]>;
  append(entry: JournalEntry, workflowAuthority?: object): Promise<void>;
  /** Atomically consumes one exact request-started checkpoint with its attempt-started claim. */
  claimAttemptStarted(expectedRequestStartedHash: string, entry: JournalEntry): Promise<boolean>;
  appendLedgerEntries(
    entries: readonly ObservationLedgerEntryV1[],
    workflowAuthority?: object,
  ): Promise<void>;
  loadLedgerEntries(): Promise<readonly ObservationLedgerEntryV1[]>;
  isWorkflowProducedJournalEntry(journalEntryHash: string): Promise<boolean>;
  isWorkflowProducedLedgerEntry(entryId: string): Promise<boolean>;
}

const ACQUISITION_WORKFLOW_PRODUCER_AUTHORITY = Object.freeze({});
const ownedAcquisitionWorkflowProducers = new WeakSet<object>();
const ACQUISITION_WORKFLOW_PRODUCER_CONSTRUCTION_AUTHORITY = Object.freeze({});

export function assertAcquisitionWorkflowProducerAuthority(value: object | undefined): void {
  if (value !== ACQUISITION_WORKFLOW_PRODUCER_AUTHORITY) {
    throw new TypeError("owned-acquisition-workflow-producer-required");
  }
}

/** Sole production writer for durable acquisition journal and ledger facts. */
export class DurableAcquisitionWorkflowProducer {
  readonly #journal: AcquisitionJournal;

  constructor(journal: AcquisitionJournal, constructionAuthority?: object) {
    this.#journal = journal;
    if (constructionAuthority === ACQUISITION_WORKFLOW_PRODUCER_CONSTRUCTION_AUTHORITY) {
      ownedAcquisitionWorkflowProducers.add(this);
    }
    Object.freeze(this);
  }

  async persist(
    ledgerEntries: readonly ObservationLedgerEntryV1[],
    journalEntries: readonly JournalEntry[],
  ): Promise<void> {
    if (
      !ownedAcquisitionWorkflowProducers.has(this) ||
      isProxy(this) ||
      Object.getPrototypeOf(this) !== DurableAcquisitionWorkflowProducer.prototype ||
      !Object.isFrozen(this) ||
      Reflect.ownKeys(this).length !== 0
    ) {
      throw new TypeError("owned-acquisition-workflow-producer-required");
    }
    if (ledgerEntries.length > 0) {
      await this.#journal.appendLedgerEntries(
        ledgerEntries,
        ACQUISITION_WORKFLOW_PRODUCER_AUTHORITY,
      );
    }
    for (const entry of journalEntries) {
      await this.#journal.append(entry, ACQUISITION_WORKFLOW_PRODUCER_AUTHORITY);
    }
  }
}

export function createDurableAcquisitionWorkflowProducer(
  journal: AcquisitionJournal,
): DurableAcquisitionWorkflowProducer {
  assertOwnedAcquisitionJournal(journal);
  return new DurableAcquisitionWorkflowProducer(
    journal,
    ACQUISITION_WORKFLOW_PRODUCER_CONSTRUCTION_AUTHORITY,
  );
}

/** Test-only fixture ingress for facts otherwise written only by the owned workflow producer. */
export async function appendTestAcquisitionWorkflowEvidence(
  journal: AcquisitionJournal,
  ledgerEntries: readonly ObservationLedgerEntryV1[],
  entries: readonly JournalEntry[],
): Promise<void> {
  if (P1_10_TEST_AUTHORITY === undefined) {
    throw new TypeError("test-acquisition-workflow-ingress-unavailable");
  }
  await new DurableAcquisitionWorkflowProducer(
    journal,
    ACQUISITION_WORKFLOW_PRODUCER_CONSTRUCTION_AUTHORITY,
  ).persist(ledgerEntries, entries);
}

export async function appendTestAcquisitionJournalEntry(
  journal: AcquisitionJournal,
  entry: JournalEntry,
): Promise<void> {
  await appendTestAcquisitionWorkflowEvidence(journal, [], [entry]);
}

export function journalEntryBody(entry: JournalEntry): JournalCheckpointBody {
  return Object.freeze(checkpointBody(entry));
}
