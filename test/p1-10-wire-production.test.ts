import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import test from "node:test";

import { canonicalHash } from "../src/core/hash.js";
import { canonicalJson, type JsonValue } from "../src/core/json.js";
import { normalizeRecordedMarketRecords } from "../src/providers/market-reference/normalization.js";
import { deriveAcquisitionObservationId } from "../src/providers/observation-ledger.js";
import {
  AlpacaWireContractError,
  createDurableAlpacaWireAdmissionBoundary,
  createTestDurableAlpacaWireAdmissionBoundary,
  createTestDurableAlpacaWireSemanticEvidenceBoundary,
  admitAlpacaHistoricalPage,
  decodeAlpacaHistoricalJson,
  parseAlpacaHistoricalJson,
  parseAndAdmitAlpacaHistoricalPage,
  parseAlpacaWireTimestamp,
  resolveAlpacaHistoricalChain,
  type AlpacaWireEndpointKind,
  type AlpacaWireParseContext,
} from "../src/adapters/market-acquisition/alpaca/wire.js";
import {
  MemoryAlpacaWireSemanticEvidenceStore,
  createTestAlpacaWireSemanticAuthority,
  createSqliteAlpacaWireSemanticEvidenceStore,
  createDurableAlpacaWireSemanticEvidenceBoundary,
} from "../src/adapters/market-acquisition/alpaca/wire-semantic-evidence.js";
import {
  ALPACA_PRIMARY_CORPUS_AUTHORITY_ID,
  acceptedAlpacaWireCalendarEntries,
} from "../src/adapters/market-acquisition/alpaca/wire-semantic-catalog.js";
import {
  MarketAcquisitionLedger,
  attachLedgerEvidence,
} from "../src/adapters/market-acquisition/artifact-integration.js";
import type { ArtifactStore } from "../src/artifacts/artifact-store.js";
import { validateMarketAcquisitionConfiguration } from "../src/adapters/market-acquisition/configuration.js";
import {
  ACCEPTED_PR_2E_CANDIDATE_SHA,
  type MarketAcquisitionConfigurationInput,
  type ValidatedMarketAcquisitionConfiguration,
} from "../src/adapters/market-acquisition/contracts.js";
import {
  ALPACA_ROUTE_REGISTRY,
  ZERO_SPEND_POLICY_ID,
  ZERO_SPEND_POLICY_PREIMAGE,
} from "../src/adapters/market-acquisition/identity.js";
import { createMemoryAcquisitionJournal } from "../src/adapters/market-acquisition/memory-journal.js";
import { createSqliteAcquisitionJournal } from "../src/adapters/market-acquisition/sqlite-journal.js";
import { loadMigrations, openSqliteDatabase } from "../src/adapters/sqlite/database.js";
import {
  GENESIS_HASH,
  NO_TOKEN_HASH,
  createJournalEntry,
  deriveLogicalPageIdentityHash,
  deriveMarketAcquisitionJournalId,
  journalEntryBody,
  appendTestAcquisitionWorkflowEvidence,
  TERMINAL_TOKEN_HASH,
  type JournalCheckpointBody,
  type JournalEntry,
} from "../src/adapters/market-acquisition/journal.js";
import { completeChainProof, retentionGuardedArtifactStore } from "./p1-10-repair-fixtures.js";

type PlainRecord = Record<string, unknown>;
type ValidCase = Readonly<{
  caseId: string;
  endpointKind: AlpacaWireEndpointKind;
  expectedGrammarDisposition: "accept";
  expectedTranslationDisposition: string;
  wire: PlainRecord;
}>;

const ROOT = "fixtures/market-acquisition/v1/wire-grammar";
const valid = JSON.parse(readFileSync(`${ROOT}/valid-pages.json`, "utf8")) as Readonly<{
  cases: readonly ValidCase[];
}>;
const translation = JSON.parse(readFileSync(`${ROOT}/bar-translation.json`, "utf8")) as Readonly<{
  cases: readonly Readonly<{
    wireCaseId: string;
    itemIndex: number;
    expectedRecord: unknown;
  }>[];
}>;

const dataField = Object.freeze({ quotes: "quotes", trades: "trades", bars: "bars" });
const symbols = Object.freeze(
  [
    ...new Set(
      valid.cases.flatMap((entry) =>
        Object.keys(entry.wire[dataField[entry.endpointKind]] as PlainRecord),
      ),
    ),
  ].sort(),
);
const instrumentIds = Object.freeze(
  Object.fromEntries(
    symbols.map((symbol) => [
      symbol,
      symbol === "PEASIVY"
        ? `min1_${"b".repeat(64)}`
        : `min1_${canonicalHash("peas/p1-10-wire-test-instrument/v1", symbol)}`,
    ]),
  ),
);
const startNs = BigInt(parseAlpacaWireTimestamp("2033-05-06T00:00:00Z").timestamp.epochNs);
const endNs = BigInt(parseAlpacaWireTimestamp("2033-05-07T00:00:00Z").timestamp.epochNs);
const wireClockBasisId = `clk1_${canonicalHash("peas/clock-basis/v1", {
  wallClock: "system-utc",
  synchronization: "verified-bound",
  maximumErrorMs: 0,
  monotonicClock: "process-monotonic-us",
  monotonicSessionId: "p1-10-wire-authority-session",
})}`;
const context: AlpacaWireParseContext = Object.freeze({
  requestedSymbols: symbols,
  instrumentIds,
  queryStartNs: startNs,
  queryEndNs: endNs,
  entitlementSnapshotId: `ent1_${"a".repeat(64)}`,
  marketAcquisitionId: `maq1_${"d".repeat(64)}`,
  rawArtifactId: `mar1_${"c".repeat(64)}`,
  calendarVersion: "peas-p1-10-original-synthetic-calendar-v1",
  durableClockBasisId: wireClockBasisId,
  durablyRecordedAtMs: 1_998_976_380_000,
  durableLogicalAtMs: 1_998_976_380_000,
  sessionKind: "regular-continuous",
  primaryCorpusMember: true,
  timeframe: "1Min",
  adjustment: "raw",
});

function parsed(caseId: string): PlainRecord {
  const fixture = valid.cases.find((entry) => entry.caseId === caseId);
  assert.ok(fixture);
  return parseAlpacaHistoricalJson(JSON.stringify(fixture.wire)) as PlainRecord;
}

function wirePlan(kind: AlpacaWireEndpointKind): ValidatedMarketAcquisitionConfiguration {
  const route = ALPACA_ROUTE_REGISTRY[kind];
  const wallNs = endNs + 900_000_000_000n;
  const timestamp = (value: bigint): string => {
    const milliseconds = value / 1_000_000n;
    const fraction = (value % 1_000_000_000n).toString().padStart(9, "0");
    return `${new Date(Number(milliseconds)).toISOString().slice(0, 19)}.${fraction}Z`;
  };
  const common = {
    symbols: symbols.join(","),
    start: timestamp(startNs),
    end: timestamp(endNs),
    limit: "10000",
    feed: "sip" as const,
    sort: "asc" as const,
  };
  const input: MarketAcquisitionConfigurationInput = {
    schemaVersion: 1,
    acceptedContractCandidateSha: ACCEPTED_PR_2E_CANDIDATE_SHA,
    lane: "alpaca-historical-sip",
    kind,
    providerId: route.providerId,
    datasetId: route.datasetId,
    feedId: route.feedId,
    endpointChannelId: route.endpointChannelId,
    entitlementSnapshotId: context.entitlementSnapshotId,
    routePolicyVersion: "p1-10-frozen-historical-multi-symbol-v1",
    aliasAuthorityCatalogId: `maac1_${"b".repeat(64)}`,
    instruments: symbols.map((symbol) => ({ instrumentId: instrumentIds[symbol] ?? "", symbol })),
    queryFields: kind === "bars" ? { ...common, timeframe: "1Min", adjustment: "raw" } : common,
    trustedClockEvidence: {
      available: true,
      basisId: wireClockBasisId,
      wallClock: "system-utc",
      synchronization: "verified-bound",
      maximumErrorNs: 0n,
      maximumErrorBounded: true,
      monotonicClock: "process-monotonic-us",
      monotonicSessionId: "p1-10-wire-authority-session",
      priorSample: {
        sampleId: "wire-prior",
        previousSampleId: null,
        basisId: wireClockBasisId,
        wallClock: "system-utc",
        synchronization: "verified-bound",
        wallNs: wallNs - 1n,
        monotonicClock: "process-monotonic-us",
        monotonicSessionId: "p1-10-wire-authority-session",
        monotonicUs: 100n,
      },
      currentSample: {
        sampleId: "wire-current",
        previousSampleId: "wire-prior",
        basisId: wireClockBasisId,
        wallClock: "system-utc",
        synchronization: "verified-bound",
        wallNs,
        monotonicClock: "process-monotonic-us",
        monotonicSessionId: "p1-10-wire-authority-session",
        monotonicUs: 101n,
      },
    },
    liveEnabled: true,
    authorizationMode: "p1-09-approved",
    capability: "historical-market-reference",
    sourceRole: "primary",
    fallbackKind: "none",
    zeroIncrementalSpend: true,
    costStatus: "zero-incremental-spend-approved",
    zeroSpendPolicyId: ZERO_SPEND_POLICY_ID,
    zeroSpendPolicyPreimage: ZERO_SPEND_POLICY_PREIMAGE,
    runDecision: "allow",
    retentionPolicyReadiness: "ready",
  };
  const result = validateMarketAcquisitionConfiguration(input);
  assert.equal(result.ok, true, result.ok ? undefined : result.error.reasonCode);
  if (!result.ok) throw new Error("wire authority plan must validate");
  return result.value;
}

async function authenticatedAdmission(
  endpointKind: AlpacaWireEndpointKind,
  wire: PlainRecord,
  parseContext: AlpacaWireParseContext,
  authorityPlan?: ValidatedMarketAcquisitionConfiguration,
  semanticSubstitution?: Readonly<{
    calendarVersion?: string;
    primaryCorpusMember?: boolean;
  }>,
  persistence: "memory" | "sqlite" = "memory",
) {
  const bytes = Buffer.from(JSON.stringify(wire), "utf8");
  const plan = wirePlan(endpointKind);
  const expectedIdentity = {
    schemaVersion: 1 as const,
    requestIdentityHash: plan.requestIdentityHash,
    providerId: plan.route.providerId,
    datasetId: plan.route.datasetId,
    feedId: plan.route.feedId,
    endpointChannelId: plan.route.endpointChannelId,
  };
  const journalId = deriveMarketAcquisitionJournalId(expectedIdentity);
  const hash = (member: string): string =>
    canonicalHash("peas/p1-10-wire-authority-fixture/v1", { endpointKind, member });
  const retrievalAttemptId = `rat1_${hash("retrieval-attempt")}`;
  const acquisitionObservationId = deriveAcquisitionObservationId({
    provider: "alpaca",
    retrievalAttemptId,
    sanitizedRequestIdentityHash: plan.requestIdentityHash,
    routeLabel: plan.route.safeRouteLabel,
  });
  const body = (overrides: Partial<JournalCheckpointBody> = {}): JournalCheckpointBody => ({
    schemaVersion: 1,
    runSessionNonce: "p1-10-wire-authority-run",
    acquisitionObservationId,
    marketAcquisitionId: parseContext.marketAcquisitionId,
    admittedMarketAcquisitionIds: [],
    requestIdentityHash: plan.requestIdentityHash,
    acquisitionConfigurationHash: plan.acquisitionConfigurationHash,
    providerId: plan.route.providerId,
    datasetId: plan.route.datasetId,
    feedId: plan.route.feedId,
    endpointChannelId: plan.route.endpointChannelId,
    authorizationMode: "p1-09-approved",
    logicalPageIdentityHash: deriveLogicalPageIdentityHash({
      requestIdentityHash: plan.requestIdentityHash,
      pageOrdinal: 0,
      currentTokenHash: NO_TOKEN_HASH,
    }),
    pageOrdinal: 0,
    currentTokenHash: NO_TOKEN_HASH,
    currentResumableTokenMaterial: null,
    nextTokenHash: null,
    nextResumableTokenMaterial: null,
    currentContinuationBindingHash: null,
    nextContinuationBindingHash: null,
    attemptId: `mat1_${hash("attempt")}`,
    retrievalAttemptId,
    attemptOrdinal: 0,
    artifactObservationId: null,
    artifactDigest: null,
    artifactSizeBytes: null,
    artifactObservationHash: null,
    artifactContentId: null,
    rawArtifactId: null,
    stageLedgerFactId: null,
    causalParentFactIds: [],
    pageRecordCount: null,
    pageNormalizedFactCount: null,
    pageChainHash: GENESIS_HASH,
    cumulativeSuccessfulPages: 0,
    cumulativeVerifiedBytes: 0,
    cumulativeRecords: 0,
    cumulativeNormalizedFacts: 0,
    cumulativeAttempts: 0,
    acquisitionDeadlineBasis: "offline-monotonic-basis-v1",
    quotaWindowEvidence: [],
    terminalState: null,
    terminalReasonCode: null,
    incomplete: true,
    ...overrides,
  });
  const entries: JournalEntry[] = [];
  const append = (kind: Parameters<typeof createJournalEntry>[2], value: JournalCheckpointBody) => {
    entries.push(createJournalEntry(entries.at(-1) ?? null, journalId, kind, value));
  };
  const artifact = {
    artifactObservationId: hash("artifact-observation"),
    artifactDigest: createHash("sha256").update(bytes).digest("hex"),
    artifactSizeBytes: bytes.byteLength,
    artifactObservationHash: hash("artifact-observation-hash"),
    artifactContentId: `mac1_${hash("artifact-content")}`,
    rawArtifactId: parseContext.rawArtifactId,
    cumulativeAttempts: 1,
    quotaWindowEvidence: [0],
  } as const;
  const semanticAuthority = createTestAlpacaWireSemanticAuthority({
    schemaVersion: 1,
    requestIdentityHash: plan.requestIdentityHash,
    pageArtifactObservationId: artifact.artifactObservationId,
    pageArtifactDigest: artifact.artifactDigest,
    queryStartNs: plan.queryStartNs.toString(),
    queryEndNs: plan.queryEndNs.toString(),
  });
  const servedSemanticAuthority = (() => {
    if (semanticSubstitution === undefined) return semanticAuthority;
    const calendarVersion =
      semanticSubstitution.calendarVersion ?? semanticAuthority.calendarVersion;
    const calendarEntries = semanticAuthority.calendarEntries.map((entry) =>
      Object.freeze({ ...entry, calendarVersion }),
    );
    const primaryCorpusMember =
      semanticSubstitution.primaryCorpusMember ?? semanticAuthority.primaryCorpusMember;
    const calendarDigest = canonicalHash("peas/alpaca-wire-calendar-authority/v1", {
      catalogVersion: calendarVersion,
      calendarEntries,
    });
    const corpusAdmissionHash = canonicalHash("peas/alpaca-wire-corpus-admission/v1", {
      corpusAuthorityId: ALPACA_PRIMARY_CORPUS_AUTHORITY_ID,
      requestIdentityHash: semanticAuthority.requestIdentityHash,
      pageArtifactObservationId: semanticAuthority.pageArtifactObservationId,
      pageArtifactDigest: semanticAuthority.pageArtifactDigest,
      primaryCorpusMember,
    });
    const body = Object.freeze({
      schemaVersion: 1 as const,
      requestIdentityHash: semanticAuthority.requestIdentityHash,
      pageArtifactObservationId: semanticAuthority.pageArtifactObservationId,
      pageArtifactDigest: semanticAuthority.pageArtifactDigest,
      queryStartNs: semanticAuthority.queryStartNs,
      queryEndNs: semanticAuthority.queryEndNs,
      calendarVersion,
      calendarDigest,
      calendarEntries: Object.freeze(calendarEntries),
      primaryCorpusMember,
      corpusAdmissionHash,
    });
    return Object.freeze({
      ...body,
      authorityId: `wsa1_${canonicalHash(
        "peas/alpaca-wire-semantic-authority/v1",
        body as unknown as JsonValue,
      )}`,
    });
  })();
  const servedSemanticAuthorityBytes = Buffer.from(
    canonicalJson(servedSemanticAuthority as unknown as JsonValue),
  );
  const semanticAuthorityArtifact = {
    artifactObservationId: hash("semantic-authority-observation"),
    artifactObservationHash: hash("semantic-authority-observation-hash"),
    artifactDigest: createHash("sha256").update(servedSemanticAuthorityBytes).digest("hex"),
    artifactSizeBytes: servedSemanticAuthorityBytes.byteLength,
  } as const;
  const ledger = new MarketAcquisitionLedger("p1-10-wire-authority-ledger-v1", {
    wallClock: "system-utc",
    synchronization: "verified-bound",
    maximumErrorMs: 0,
    monotonicClock: "process-monotonic-us",
    monotonicSessionId: "p1-10-wire-authority-session",
  });
  const stamp = (wallTimeMs: number, monotonicTimeUs: number) => ({
    clockBasisId: ledger.clockBasis.clockBasisId,
    wallTimeMs,
    monotonicTimeUs,
  });
  const declared = ledger.declareAcquisition(
    {
      kind: "acquisition.declared",
      acquisitionObservationId,
      provider: "alpaca",
      retrievalAttemptId,
      sanitizedRequestIdentityHash: plan.requestIdentityHash,
      routeLabel: plan.route.safeRouteLabel,
    },
    stamp(context.durablyRecordedAtMs - 4, 1),
  );
  const started = ledger.requestStarted(
    declared,
    { kind: "request.started", acquisitionObservationId },
    stamp(context.durablyRecordedAtMs - 3, 2),
  );
  const succeeded = ledger.requestSucceeded(
    started,
    {
      kind: "request.succeeded",
      acquisitionObservationId,
      safeResponseMetadataHash: hash("safe-response-metadata"),
    },
    stamp(context.durablyRecordedAtMs - 2, 3),
  );
  const committed = ledger.artifactCommitted(
    declared,
    succeeded,
    {
      kind: "artifact.committed",
      acquisitionObservationId,
      vaultObservationId: artifact.artifactObservationId,
      vaultObservationHash: artifact.artifactObservationHash,
      artifactDigest: artifact.artifactDigest,
      sizeBytes: artifact.artifactSizeBytes,
      acquisitionMode: "live",
      retrievedAtMs: context.durablyRecordedAtMs,
    },
    stamp(context.durablyRecordedAtMs, 4),
  );
  const verified = ledger.artifactVerified(
    committed,
    {
      kind: "artifact.verified",
      acquisitionObservationId,
      vaultObservationId: artifact.artifactObservationId,
      artifactDigest: artifact.artifactDigest,
      metadataSizeBytes: artifact.artifactSizeBytes,
      consumedSizeBytes: artifact.artifactSizeBytes,
    },
    stamp(context.durableLogicalAtMs, 5),
  );
  const authorityAcquisitionObservationId = deriveAcquisitionObservationId({
    provider: "alpaca",
    retrievalAttemptId,
    sanitizedRequestIdentityHash: plan.requestIdentityHash,
    routeLabel: `${plan.route.safeRouteLabel}:wire-semantic-authority`,
  });
  const authorityDeclared = ledger.declareAcquisition(
    {
      kind: "acquisition.declared",
      acquisitionObservationId: authorityAcquisitionObservationId,
      provider: "alpaca",
      retrievalAttemptId,
      sanitizedRequestIdentityHash: plan.requestIdentityHash,
      routeLabel: `${plan.route.safeRouteLabel}:wire-semantic-authority`,
    },
    stamp(context.durableLogicalAtMs + 1, 6),
  );
  const authorityCommitted = ledger.artifactCommitted(
    authorityDeclared,
    null,
    {
      kind: "artifact.committed",
      acquisitionObservationId: authorityAcquisitionObservationId,
      vaultObservationId: semanticAuthorityArtifact.artifactObservationId,
      vaultObservationHash: semanticAuthorityArtifact.artifactObservationHash,
      artifactDigest: semanticAuthorityArtifact.artifactDigest,
      sizeBytes: semanticAuthorityArtifact.artifactSizeBytes,
      acquisitionMode: "recorded",
      retrievedAtMs: context.durablyRecordedAtMs,
    },
    stamp(context.durableLogicalAtMs + 2, 7),
  );
  const authorityVerified = ledger.artifactVerified(
    authorityCommitted,
    {
      kind: "artifact.verified",
      acquisitionObservationId: authorityAcquisitionObservationId,
      vaultObservationId: semanticAuthorityArtifact.artifactObservationId,
      artifactDigest: semanticAuthorityArtifact.artifactDigest,
      metadataSizeBytes: semanticAuthorityArtifact.artifactSizeBytes,
      consumedSizeBytes: semanticAuthorityArtifact.artifactSizeBytes,
    },
    stamp(context.durableLogicalAtMs + 3, 8),
  );
  const withStage = (
    value: JournalCheckpointBody,
    stage: Parameters<typeof attachLedgerEvidence>[1],
  ): JournalCheckpointBody => attachLedgerEvidence(value, stage, ledger.clockDeclaration);
  append("acquisition-declared", withStage(body(), declared));
  append("request-started", withStage(body(), started));
  append(
    "attempt-started",
    withStage(body({ cumulativeAttempts: 1, quotaWindowEvidence: [0] }), started),
  );
  append(
    "request-succeeded",
    withStage(body({ cumulativeAttempts: 1, quotaWindowEvidence: [0] }), succeeded),
  );
  append("artifact-committed", withStage(body(artifact), committed));
  append("artifact-verified", withStage(body(artifact), verified));
  const database =
    persistence === "sqlite"
      ? openSqliteDatabase(":memory:", loadMigrations(`${process.cwd()}/migrations`))
      : null;
  const journal =
    database === null
      ? createMemoryAcquisitionJournal(expectedIdentity)
      : createSqliteAcquisitionJournal(database, expectedIdentity);
  await appendTestAcquisitionWorkflowEvidence(journal, ledger.entries, entries);
  const latest = entries.at(-1);
  assert.ok(latest);
  const evidence =
    database === null
      ? new MemoryAlpacaWireSemanticEvidenceStore()
      : createSqliteAlpacaWireSemanticEvidenceStore(database);
  const request = {
    method: "GET" as const,
    origin: plan.route.origin,
    pathHash: hash("path"),
    routeLabel: plan.route.safeRouteLabel,
    identityHash: plan.requestIdentityHash,
  };
  const metadata = {
    digest: artifact.artifactDigest,
    algorithm: "sha256" as const,
    sizeBytes: artifact.artifactSizeBytes,
    committedAtMs: context.durablyRecordedAtMs,
    provenance: "retrieval" as const,
  };
  const authorityMetadata = {
    digest: semanticAuthorityArtifact.artifactDigest,
    algorithm: "sha256" as const,
    sizeBytes: semanticAuthorityArtifact.artifactSizeBytes,
    committedAtMs: context.durablyRecordedAtMs,
    provenance: "retrieval" as const,
  };
  const rawStore = {
    async stat(candidate: string) {
      return candidate === artifact.artifactDigest
        ? metadata
        : candidate === semanticAuthorityArtifact.artifactDigest
          ? authorityMetadata
          : undefined;
    },
    async read(candidate: string) {
      if (candidate === artifact.artifactDigest)
        return { artifact: metadata, stream: Readable.from([bytes]) };
      if (candidate === semanticAuthorityArtifact.artifactDigest)
        return {
          artifact: authorityMetadata,
          stream: Readable.from([servedSemanticAuthorityBytes]),
        };
      throw new Error("unexpected-wire-digest");
    },
    async getAttempt(candidate: string) {
      return candidate === retrievalAttemptId
        ? {
            attemptId: retrievalAttemptId,
            provider: "alpaca",
            recordId: "original-synthetic-wire-record",
            revisionId: "original-synthetic-wire-revision",
            startedAtMs: context.durablyRecordedAtMs - 3,
            request,
            stagingId: "original-synthetic-wire-stage",
            recordedAtMs: context.durablyRecordedAtMs - 3,
          }
        : undefined;
    },
    async getObservation(candidate: string) {
      const selected =
        candidate === artifact.artifactObservationId
          ? artifact
          : candidate === semanticAuthorityArtifact.artifactObservationId
            ? semanticAuthorityArtifact
            : null;
      return selected !== null
        ? {
            observationId: selected.artifactObservationId,
            attemptId: retrievalAttemptId,
            artifactDigest: selected.artifactDigest,
            provider: "alpaca",
            recordId: "original-synthetic-wire-record",
            revisionId: "original-synthetic-wire-revision",
            retrievedAtMs: context.durablyRecordedAtMs,
            request,
            response: {
              statusCode: 200,
              etag: null,
              lastModified: null,
              mediaType: "application/json",
              contentEncoding: null,
              declaredContentLength: selected.artifactSizeBytes,
              transportDecoded: true,
            },
            observationHash: selected.artifactObservationHash,
          }
        : undefined;
    },
  } as unknown as ArtifactStore;
  const guarded = retentionGuardedArtifactStore(rawStore, [artifact, semanticAuthorityArtifact]);
  const semanticBoundary =
    database === null
      ? createTestDurableAlpacaWireSemanticEvidenceBoundary(journal, evidence, guarded)
      : createDurableAlpacaWireSemanticEvidenceBoundary(journal, evidence, guarded);
  const issuedSemanticAuthority = await semanticBoundary.issueAuthority(plan, {
    artifactObservationId: artifact.artifactObservationId,
    artifactObservationHash: artifact.artifactObservationHash,
    artifactDigest: artifact.artifactDigest,
    artifactSizeBytes: artifact.artifactSizeBytes,
    retrievalAttemptId,
    requestIdentityHash: plan.requestIdentityHash,
    provider: "alpaca",
  });
  if (database !== null) {
    const corpusAdmission = database
      .prepare(`SELECT primary_corpus_member, corpus_admission_hash
        FROM market_acquisition_alpaca_corpus_admissions
        WHERE request_identity_hash = ? AND artifact_observation_id = ? AND artifact_digest = ?`)
      .get(plan.requestIdentityHash, artifact.artifactObservationId, artifact.artifactDigest) as
      | { primary_corpus_member: bigint; corpus_admission_hash: string }
      | undefined;
    assert.equal(corpusAdmission?.primary_corpus_member, 1n);
    assert.equal(
      corpusAdmission?.corpus_admission_hash,
      issuedSemanticAuthority.corpusAdmissionHash,
    );
  }
  if (semanticSubstitution === undefined) {
    assert.equal(
      canonicalJson(issuedSemanticAuthority as unknown as JsonValue),
      canonicalJson(semanticAuthority as unknown as JsonValue),
    );
  }
  await assert.rejects(
    () =>
      semanticBoundary.issueAuthority(plan, {
        artifactObservationId: artifact.artifactObservationId,
        artifactObservationHash: artifact.artifactObservationHash,
        artifactDigest: artifact.artifactDigest,
        artifactSizeBytes: artifact.artifactSizeBytes,
        retrievalAttemptId,
        requestIdentityHash: canonicalHash("forged-request", {}),
        provider: "alpaca",
      }),
    /corpus-admission-invalid/u,
  );
  await semanticBoundary.persist({
    expectedIdentity,
    marketAcquisitionJournalId: journalId,
    plan,
    semanticAuthority: {
      artifactObservationId: semanticAuthorityArtifact.artifactObservationId,
      artifactObservationHash: semanticAuthorityArtifact.artifactObservationHash,
      artifactDigest: semanticAuthorityArtifact.artifactDigest,
      artifactSizeBytes: semanticAuthorityArtifact.artifactSizeBytes,
      retrievalAttemptId,
      requestIdentityHash: plan.requestIdentityHash,
      provider: "alpaca",
      stageLedgerFactId: authorityVerified.entryId,
    },
  });
  const admissionBoundary =
    database === null
      ? createTestDurableAlpacaWireAdmissionBoundary(journal, evidence)
      : createDurableAlpacaWireAdmissionBoundary(journal, evidence);
  const authority = await admissionBoundary.issue({
    plan: authorityPlan ?? plan,
    expectedIdentity,
    marketAcquisitionJournalId: journalId,
  });
  try {
    return parseAndAdmitAlpacaHistoricalPage(endpointKind, bytes, authority);
  } finally {
    database?.close();
  }
}

function firstItem(page: PlainRecord, endpointKind: AlpacaWireEndpointKind): PlainRecord {
  const groups = page[dataField[endpointKind]] as PlainRecord;
  const symbol = Object.keys(groups)[0];
  assert.ok(symbol);
  return (groups[symbol] as PlainRecord[])[0] as PlainRecord;
}

function expectWireCode(code: string, operation: () => unknown): void {
  assert.throws(
    operation,
    (error: unknown) => error instanceof AlpacaWireContractError && error.code === code,
  );
}

test("production parser admits every accepted original-synthetic valid page", () => {
  for (const fixture of valid.cases) {
    const result = admitAlpacaHistoricalPage(
      fixture.endpointKind,
      parseAlpacaHistoricalJson(JSON.stringify(fixture.wire)),
      context,
    );
    assert.equal(result.endpointKind, fixture.endpointKind, fixture.caseId);
    if (fixture.expectedTranslationDisposition === "terminal-correction-unsupported") {
      assert.equal(result.terminalReason, "correction-unsupported", fixture.caseId);
      assert.equal(result.privateNextToken, null, fixture.caseId);
      assert.deepEqual(result.records, [], fixture.caseId);
      continue;
    }
    assert.equal(result.terminalReason, null, fixture.caseId);
    if (fixture.endpointKind === "bars") {
      assert.equal(
        result.records.length > 0,
        fixture.expectedTranslationDisposition === "emit-recorded-market-record-v1",
        fixture.caseId,
      );
      assert.equal(normalizeRecordedMarketRecords(result.records).length, result.records.length);
    } else {
      assert.deepEqual(result.records, [], fixture.caseId);
      assert.ok(result.quarantines.length > 0, fixture.caseId);
    }
  }
});

test("production bar projection is byte-identical to the accepted translation fixture", () => {
  const admission = admitAlpacaHistoricalPage(
    "bars",
    parsed("wire-bars-terminal-grouped"),
    context,
  );
  for (const expected of translation.cases.filter(
    (entry) => entry.wireCaseId === "wire-bars-terminal-grouped",
  )) {
    const actual = admission.records.find((record) =>
      record.memberKey.endsWith(`[${expected.itemIndex}]`),
    );
    assert.ok(actual);
    assert.equal(
      canonicalJson(actual as unknown as JsonValue),
      canonicalJson(expected.expectedRecord as JsonValue),
    );
  }
});

test("production complete-chain resolution deduplicates and quarantines globally", async () => {
  const source = valid.cases.find((entry) => entry.caseId === "wire-bars-terminal-grouped");
  assert.ok(source);
  const raw = JSON.stringify(source.wire);
  const firstWire = { ...(source.wire as PlainRecord), next_page_token: "synthetic-next" };
  const first = await authenticatedAdmission("bars", firstWire, context);
  const redelivery = await authenticatedAdmission("bars", JSON.parse(raw) as PlainRecord, {
    ...context,
    marketAcquisitionId: `maq1_${"8".repeat(64)}`,
    rawArtifactId: `mar1_${"f".repeat(64)}`,
  });
  const duplicateResolution = resolveAlpacaHistoricalChain(
    "bars",
    [first, redelivery],
    completeChainProof([first, redelivery]),
  );
  assert.equal(duplicateResolution.records.length, 2);
  assert.equal(duplicateResolution.quarantines.length, 0);
  assert.equal(duplicateResolution.barObservationCount, 4);

  const conflict = await authenticatedAdmission(
    "bars",
    JSON.parse(raw.replace('"h":62.875', '"h":63.875')) as PlainRecord,
    {
      ...context,
      marketAcquisitionId: `maq1_${"7".repeat(64)}`,
      rawArtifactId: `mar1_${"9".repeat(64)}`,
    },
  );
  const conflictResolution = resolveAlpacaHistoricalChain(
    "bars",
    [first, conflict],
    completeChainProof([first, conflict]),
  );
  assert.equal(conflictResolution.records.length, 1);
  assert.equal(conflictResolution.quarantines.length, 2);
  assert.equal(new Set(conflictResolution.quarantines.map((entry) => entry.reason)).size, 1);
  assert.equal(
    conflictResolution.quarantines[0]?.reason,
    "market.provider-observation-invalid/conflicting-content",
  );
});

test("complete-chain proof rejects missing zero, gaps, loops, substitutions, repeated and terminal anomalies", async () => {
  const source = valid.cases.find((entry) => entry.caseId === "wire-bars-terminal-grouped");
  assert.ok(source);
  const terminalWire = source.wire as PlainRecord;
  const page = (token: string | null, ordinal: number) =>
    authenticatedAdmission(
      "bars",
      { ...terminalWire, next_page_token: token },
      {
        ...context,
        marketAcquisitionId: `maq1_${String(ordinal + 1).repeat(64)}`,
        rawArtifactId: `mar1_${String(ordinal + 4).repeat(64)}`,
      },
    );
  const first = await page("next-a", 0);
  const terminal = await page(null, 1);
  const proof = completeChainProof([first, terminal]);
  const forgedSemantic = {
    ...terminal,
    barObservations: terminal.barObservations.map((observation) => ({
      ...observation,
      record:
        observation.record === null
          ? null
          : { ...observation.record, calendarVersion: "forged-calendar-version" },
    })),
  };
  expectWireCode("page-semantic-evidence-invalid", () =>
    resolveAlpacaHistoricalChain("bars", [first, forgedSemantic], proof),
  );
  const rebuild = (
    mutate: (entry: JournalEntry, body: JournalCheckpointBody) => JournalCheckpointBody,
  ) => {
    const rows: JournalEntry[] = [];
    for (const entry of proof.journal) {
      rows.push(
        createJournalEntry(
          rows.at(-1) ?? null,
          entry.marketAcquisitionJournalId,
          entry.checkpointKind,
          mutate(entry, journalEntryBody(entry)),
        ),
      );
    }
    return { ...proof, journal: rows };
  };
  assert.throws(() => resolveAlpacaHistoricalChain("bars", [terminal], proof));
  assert.throws(() =>
    resolveAlpacaHistoricalChain(
      "bars",
      [first, terminal],
      rebuild((entry, body) =>
        entry.checkpointKind === "attempt-started" && entry.pageOrdinal === 1
          ? { ...body, pageOrdinal: 2 }
          : body,
      ),
    ),
  );
  assert.throws(() =>
    resolveAlpacaHistoricalChain(
      "bars",
      [first, terminal],
      rebuild((entry, body) =>
        entry.checkpointKind === "attempt-started" && entry.pageOrdinal === 1
          ? { ...body, pageOrdinal: 0 }
          : body,
      ),
    ),
  );
  assert.throws(() =>
    resolveAlpacaHistoricalChain(
      "bars",
      [{ ...first, rawArtifactId: `mar1_${"f".repeat(64)}` }, terminal],
      proof,
    ),
  );
  assert.throws(() =>
    resolveAlpacaHistoricalChain(
      "bars",
      [{ ...first, terminal: true, privateNextToken: null }, terminal],
      proof,
    ),
  );
  assert.throws(() =>
    resolveAlpacaHistoricalChain(
      "bars",
      [first, { ...terminal, terminal: false, privateNextToken: "missing-terminal" }],
      proof,
    ),
  );
  const secondLoop = await page("next-a", 1);
  const third = await page(null, 2);
  assert.throws(() =>
    resolveAlpacaHistoricalChain(
      "bars",
      [first, secondLoop, third],
      completeChainProof([first, secondLoop, third]),
    ),
  );
  assert.throws(() =>
    resolveAlpacaHistoricalChain(
      "bars",
      [first, terminal],
      rebuild((entry, body) =>
        entry.checkpointKind === "page-checkpointed" && entry.pageOrdinal === 0
          ? {
              ...body,
              nextTokenHash: TERMINAL_TOKEN_HASH,
              nextResumableTokenMaterial: null,
              nextContinuationBindingHash: null,
            }
          : body,
      ),
    ),
  );
});

test("production tokenizer rejects duplicate names, noncanonical numbers, and invalid UTF-8", () => {
  assert.throws(
    () => parseAlpacaHistoricalJson('{"bars":{},"bars":{},"next_page_token":null}'),
    (error: unknown) =>
      error instanceof AlpacaWireContractError && error.code === "duplicate-json-name",
  );
  const exponent = JSON.stringify(
    valid.cases.find((entry) => entry.caseId === "wire-bars-terminal-grouped")?.wire,
  ).replace('"o":61.125', '"o":6.1125e1');
  assert.throws(
    () => admitAlpacaHistoricalPage("bars", parseAlpacaHistoricalJson(exponent), context),
    (error: unknown) =>
      error instanceof AlpacaWireContractError && error.code === "market.decimal-invalid",
  );
  const invalid = new Uint8Array([0x7b, 0x22, 0x78, 0x22, 0x3a, 0xc3, 0x28, 0x7d]);
  assert.throws(
    () => decodeAlpacaHistoricalJson(invalid),
    (error: unknown) => error instanceof AlpacaWireContractError && error.code === "schema-invalid",
  );
});

test("production parser reject and quarantine branches remain executable and inert", async () => {
  for (const raw of [
    "",
    '"unterminated',
    '"line\nbreak"',
    '"\\uD800"',
    "[1,]",
    '{"x" 1}',
    '{"x":1,}',
    '{"x":1',
  ]) {
    expectWireCode("malformed-json", () => parseAlpacaHistoricalJson(raw));
  }
  assert.deepEqual(parseAlpacaHistoricalJson("[]"), []);
  assert.deepEqual(parseAlpacaHistoricalJson("[true,false,null]"), [true, false, null]);
  expectWireCode("genericStringBytes", () =>
    parseAlpacaHistoricalJson(JSON.stringify("x".repeat(1_025))),
  );
  expectWireCode("pageTokenInputBytes", () =>
    parseAlpacaHistoricalJson(JSON.stringify({ bars: {}, next_page_token: "x".repeat(4_097) })),
  );

  for (const hostile of [null, [], Object.create({ inherited: true })]) {
    expectWireCode("schema-invalid", () => admitAlpacaHistoricalPage("bars", hostile, context));
  }
  const symbolPage = parsed("wire-bars-empty-terminal");
  Object.defineProperty(symbolPage, Symbol("synthetic"), { value: true });
  expectWireCode("schema-invalid", () => admitAlpacaHistoricalPage("bars", symbolPage, context));
  let getterCalls = 0;
  const accessorGroups = Object.create(null) as PlainRecord;
  Object.defineProperty(accessorGroups, "PEASIVY", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return [];
    },
  });
  expectWireCode("schema-invalid", () =>
    admitAlpacaHistoricalPage("bars", { bars: accessorGroups, next_page_token: null }, context),
  );
  assert.equal(getterCalls, 0);

  for (const malformedGroup of [null, {}, new Array(1)]) {
    expectWireCode("schema-invalid", () =>
      admitAlpacaHistoricalPage(
        "bars",
        { bars: { PEASIVY: malformedGroup }, next_page_token: null },
        context,
      ),
    );
  }
  const extraProperty: unknown[] = [];
  Object.defineProperty(extraProperty, "extra", { enumerable: true, value: null });
  expectWireCode("schema-invalid", () =>
    admitAlpacaHistoricalPage(
      "bars",
      { bars: { PEASIVY: extraProperty }, next_page_token: null },
      context,
    ),
  );
  const wrongPrototype: unknown[] = [];
  Object.setPrototypeOf(wrongPrototype, null);
  expectWireCode("schema-invalid", () =>
    admitAlpacaHistoricalPage(
      "bars",
      { bars: { PEASIVY: wrongPrototype }, next_page_token: null },
      context,
    ),
  );

  const barSource = valid.cases.find((entry) => entry.caseId === "wire-bars-terminal-grouped");
  assert.ok(barSource);
  const duplicateWire = structuredClone(barSource.wire);
  const duplicateBars = (duplicateWire["bars"] as PlainRecord)["PEASIVY"] as PlainRecord[];
  const firstBar = duplicateBars[0];
  assert.ok(firstBar);
  duplicateBars.push(structuredClone(firstBar));
  const duplicate = admitAlpacaHistoricalPage(
    "bars",
    parseAlpacaHistoricalJson(JSON.stringify(duplicateWire)),
    context,
  );
  assert.equal(duplicate.records.length, 2);
  assert.equal(duplicate.barObservations.length, 3);

  const conflictWire = structuredClone(duplicateWire);
  const conflictBars = (conflictWire["bars"] as PlainRecord)["PEASIVY"] as PlainRecord[];
  (conflictBars[1] as PlainRecord)["h"] = 63.875;
  const conflict = admitAlpacaHistoricalPage(
    "bars",
    parseAlpacaHistoricalJson(JSON.stringify(conflictWire)),
    context,
  );
  assert.equal(conflict.records.length, 1);
  assert.equal(conflict.quarantines.length, 2);

  const unknownCalendar = admitAlpacaHistoricalPage("bars", parsed("wire-bars-terminal-grouped"), {
    ...context,
    sessionKind: "unknown",
  });
  assert.equal(unknownCalendar.records.length, 0);
  assert.equal(unknownCalendar.quarantines.length, 2);

  const quoteFixture = valid.cases.find((entry) => entry.caseId === "wire-quotes-terminal-grouped");
  assert.ok(quoteFixture);
  const quote = await authenticatedAdmission("quotes", quoteFixture.wire, context);
  const proof = completeChainProof([quote]);
  assert.equal(resolveAlpacaHistoricalChain("quotes", [quote], proof).records.length, 0);
  expectWireCode("schema-invalid", () => resolveAlpacaHistoricalChain("bars", [quote], proof));
  assert.equal((await authenticatedAdmission("bars", barSource.wire, context)).records.length, 2);
  const preIssuanceForgery = await authenticatedAdmission("bars", barSource.wire, {
    ...context,
    calendarVersion: "forged-before-issuance",
    durableClockBasisId: `clk1_${"f".repeat(64)}`,
    durablyRecordedAtMs: 1,
    durableLogicalAtMs: 2,
    sessionKind: "unknown",
    primaryCorpusMember: false,
  });
  assert.equal(preIssuanceForgery.records.length, 2);
  for (const record of preIssuanceForgery.records) {
    assert.equal(record.calendarVersion, context.calendarVersion);
    assert.equal(record.durableClockBasisId, context.durableClockBasisId);
    assert.equal(record.durablyRecordedAtMs, context.durablyRecordedAtMs);
    assert.equal(record.durableLogicalAtMs, context.durableLogicalAtMs);
    assert.equal(record.primaryCorpusMember, true);
  }
  expectWireCode("page-semantic-authority-invalid", () =>
    parseAndAdmitAlpacaHistoricalPage("bars", Buffer.from(JSON.stringify(barSource.wire), "utf8"), {
      ...context,
      calendarVersion: "forged-before-issuance",
    } as never),
  );
  const trustedPlan = wirePlan("bars");
  const forgedPlan = Object.freeze({
    ...trustedPlan,
    instruments: Object.freeze([
      Object.freeze({ instrumentId: `min1_${"9".repeat(64)}`, symbol: symbols[0] }),
    ]),
  }) as ValidatedMarketAcquisitionConfiguration;
  await assert.rejects(
    () => authenticatedAdmission("bars", barSource.wire, context, forgedPlan),
    (error: unknown) =>
      error instanceof AlpacaWireContractError && error.code === "page-semantic-authority-invalid",
  );
  for (const persistence of ["memory", "sqlite"] as const) {
    await assert.rejects(
      () =>
        authenticatedAdmission(
          "bars",
          barSource.wire,
          context,
          undefined,
          {
            calendarVersion: "peas-p1-10-syntactically-valid-alternate-calendar-v1",
          },
          persistence,
        ),
      /wire-semantic-authority-invalid|wire-semantic-calendar-catalog/u,
    );
    await assert.rejects(
      () =>
        authenticatedAdmission(
          "bars",
          barSource.wire,
          context,
          undefined,
          { primaryCorpusMember: false },
          persistence,
        ),
      /wire-semantic-authority-invalid|wire-semantic-calendar-catalog/u,
    );
  }
  assert.deepEqual(
    acceptedAlpacaWireCalendarEntries(startNs.toString(), endNs.toString()).map(
      (entry) => entry.sessionDate,
    ),
    ["2033-05-05", "2033-05-06"],
  );
  const spring = acceptedAlpacaWireCalendarEntries(
    (BigInt(Date.parse("2033-03-10T12:00:00Z")) * 1_000_000n).toString(),
    (BigInt(Date.parse("2033-03-14T12:00:00Z")) * 1_000_000n).toString(),
  );
  assert.throws(
    () =>
      acceptedAlpacaWireCalendarEntries(
        (BigInt(Date.parse("2006-03-20T12:00:00Z")) * 1_000_000n).toString(),
        (BigInt(Date.parse("2006-03-20T12:15:00Z")) * 1_000_000n).toString(),
      ),
    /calendar-year-unsupported/u,
  );
  assert.deepEqual(
    spring.map((entry) => [entry.sessionDate, entry.utcOffsetMinutes]),
    [
      ["2033-03-10", -300],
      ["2033-03-11", -300],
      ["2033-03-12", -300],
      ["2033-03-13", -240],
      ["2033-03-14", -240],
    ],
  );
  const autumn = acceptedAlpacaWireCalendarEntries(
    (BigInt(Date.parse("2033-11-03T12:00:00Z")) * 1_000_000n).toString(),
    (BigInt(Date.parse("2033-11-07T12:00:00Z")) * 1_000_000n).toString(),
  );
  assert.deepEqual(
    autumn.map((entry) => [entry.sessionDate, entry.utcOffsetMinutes]),
    [
      ["2033-11-03", -240],
      ["2033-11-04", -240],
      ["2033-11-05", -240],
      ["2033-11-06", -300],
      ["2033-11-07", -300],
    ],
  );
  for (const entry of [...spring, ...autumn].filter((candidate) => !candidate.holiday)) {
    assert.ok(BigInt(entry.extendedOpenNs as string) < BigInt(entry.regularOpenNs as string));
    assert.ok(BigInt(entry.regularOpenNs as string) < BigInt(entry.regularCloseNs as string));
    assert.ok(BigInt(entry.regularCloseNs as string) < BigInt(entry.extendedCloseNs as string));
  }
  assert.ok(BigInt(parseAlpacaWireTimestamp("1960-01-02T00:00:00Z").timestamp.epochNs) < 0n);
});

test("canonical trade u wins before every later semantic value without getter or Proxy traps", () => {
  const normal = structuredClone(firstItem(parsed("wire-trades-terminal-grouped"), "trades"));
  const outcomes = new Set<string>();
  let vectors = 0;
  for (const update of ["canceled", "incorrect", "corrected"] as const) {
    for (const placement of ["first", "middle", "last"] as const) {
      for (const successor of ["malformed", "getter", "proxy"] as const) {
        vectors += 1;
        let getterCalls = 0;
        let proxyCalls = 0;
        const later = (): unknown => {
          if (successor === "malformed") return null;
          if (successor === "getter") {
            const value = Object.create(null) as PlainRecord;
            Object.defineProperty(value, "later", {
              enumerable: true,
              get() {
                getterCalls += 1;
                throw new Error("synthetic-later-getter");
              },
            });
            return value;
          }
          return new Proxy(
            {},
            {
              getPrototypeOf() {
                proxyCalls += 1;
                throw new Error("synthetic-later-proxy");
              },
              ownKeys() {
                proxyCalls += 1;
                throw new Error("synthetic-later-proxy");
              },
              getOwnPropertyDescriptor() {
                proxyCalls += 1;
                throw new Error("synthetic-later-proxy");
              },
              get() {
                proxyCalls += 1;
                throw new Error("synthetic-later-proxy");
              },
            },
          );
        };
        const updateItem = structuredClone(normal);
        updateItem["u"] = update;
        const earlier =
          placement === "first"
            ? [updateItem, later()]
            : placement === "middle"
              ? [structuredClone(normal), updateItem, later()]
              : [structuredClone(normal), structuredClone(normal), updateItem];
        const groups: PlainRecord = {};
        groups["PEASUMB"] = placement === "last" ? later() : [];
        groups["PEASLIL"] = earlier;
        assert.deepEqual(Object.keys(groups), ["PEASUMB", "PEASLIL"]);
        const result = admitAlpacaHistoricalPage(
          "trades",
          {
            trades: groups,
            next_page_token: "synthetic-token-must-clear",
          },
          context,
        );
        assert.equal(result.terminal, true);
        assert.equal(result.privateNextToken, null);
        assert.equal(result.terminalReason, "correction-unsupported");
        assert.equal(result.wireItemCount, 0);
        assert.deepEqual(result.records, []);
        assert.deepEqual(result.barObservations, []);
        assert.deepEqual(result.quarantines, [
          {
            endpointKind: "trades",
            reason: "correction-unsupported",
            symbol: "PEASLIL",
            itemIndex: 0,
          },
        ]);
        assert.equal(getterCalls, 0);
        assert.equal(proxyCalls, 0);
        outcomes.add(canonicalJson(result.publicSummary as unknown as JsonValue));
      }
    }
  }
  assert.equal(vectors, 27);
  assert.equal(outcomes.size, 1);
});

test("wire parse snapshots are zeroed even when authority validation throws", () => {
  const bytes = Buffer.from('{"bars":{},"next_page_token":null}', "utf8");
  const fillDescriptor = Object.getOwnPropertyDescriptor(Buffer.prototype, "fill");
  assert.ok(fillDescriptor?.value);
  let zeroed = false;
  Object.defineProperty(Buffer.prototype, "fill", {
    ...fillDescriptor,
    value(this: Buffer, ...args: unknown[]) {
      if (args[0] === 0 && this.equals(bytes)) zeroed = true;
      return Reflect.apply(fillDescriptor.value as (...members: unknown[]) => Buffer, this, args);
    },
  });
  try {
    expectWireCode("page-semantic-authority-invalid", () =>
      parseAndAdmitAlpacaHistoricalPage(
        "bars",
        bytes,
        Object.freeze({
          kind: "p1-10-durable-wire-admission-authority",
        }),
      ),
    );
  } finally {
    Object.defineProperty(Buffer.prototype, "fill", fillDescriptor);
  }
  assert.equal(zeroed, true);
  assert.equal(bytes.toString("utf8"), '{"bars":{},"next_page_token":null}');
});
