import assert from "node:assert/strict";

import { canonicalHash } from "../src/core/hash.js";
import { MarketAcquisitionLedger } from "../src/adapters/market-acquisition/artifact-integration.js";
import { validateMarketAcquisitionConfiguration } from "../src/adapters/market-acquisition/configuration.js";
import {
  ACCEPTED_PR_2E_CANDIDATE_SHA,
  type AlpacaAcquisitionKind,
  type MarketAcquisitionConfigurationInput,
  type ValidatedMarketAcquisitionConfiguration,
} from "../src/adapters/market-acquisition/contracts.js";
import {
  establishCredentialAuthorizationEvidence,
  type CredentialAuthorizationEvidence,
  type CredentialAuthorizationInput,
} from "../src/adapters/market-acquisition/credentials.js";
import {
  ALPACA_ROUTE_REGISTRY,
  ZERO_SPEND_POLICY_ID,
  ZERO_SPEND_POLICY_PREIMAGE,
} from "../src/adapters/market-acquisition/identity.js";
import {
  GENESIS_HASH,
  NO_TOKEN_HASH,
  createJournalEntry,
  planPageAdmission,
  TERMINAL_TOKEN_HASH,
  deriveLogicalPageIdentityHash,
  deriveMarketAcquisitionJournalId,
  journalEntryBody,
  type JournalCheckpointBody,
} from "../src/adapters/market-acquisition/journal.js";
import type { AlpacaWirePageAdmission } from "../src/adapters/market-acquisition/alpaca/wire.js";
import { MemoryArtifactRetentionJournal } from "../src/adapters/market-acquisition/retention/memory-journal.js";
import type { ArtifactRetentionController } from "../src/adapters/market-acquisition/retention/contracts.js";
import { deriveAcquisitionObservationId } from "../src/providers/observation-ledger.js";

const WALL_NS = 1_800_000_000_000_000_000n;
const BOUNDARY_NS = WALL_NS - 900_000_000_000n;
const CLOCK_SESSION = "p1-10-repair-fixture-session";
const CLOCK_BASIS_ID = `clk1_${canonicalHash("peas/clock-basis/v1", {
  wallClock: "system-utc",
  synchronization: "verified-bound",
  maximumErrorMs: 0,
  monotonicClock: "process-monotonic-us",
  monotonicSessionId: CLOCK_SESSION,
})}`;

export const ALLOW_ALL_RETENTION: ArtifactRetentionController = Object.freeze({
  registerOwnership() {
    throw new Error("unused test retention registration");
  },
  async enforceStop() {
    throw new Error("unused test retention stop");
  },
  assertArtifactUseAllowed() {},
  assertDerivedUseAllowed() {},
});

function timestamp(epochNs: bigint): string {
  const milliseconds = epochNs / 1_000_000n;
  const fraction = (epochNs % 1_000_000_000n).toString().padStart(9, "0");
  return `${new Date(Number(milliseconds)).toISOString().slice(0, 19)}.${fraction}Z`;
}

export function validatedRepairPlan(
  kind: AlpacaAcquisitionKind = "quotes",
): ValidatedMarketAcquisitionConfiguration {
  const route = ALPACA_ROUTE_REGISTRY[kind];
  const common = {
    symbols: "QA,QB",
    start: timestamp(BOUNDARY_NS - 60_000_000_000n),
    end: timestamp(BOUNDARY_NS),
    limit: "10000",
    feed: "sip",
    sort: "asc",
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
    entitlementSnapshotId: `ent1_${"a".repeat(64)}`,
    routePolicyVersion: "p1-10-frozen-historical-multi-symbol-v1",
    aliasAuthorityCatalogId: `maac1_${"b".repeat(64)}`,
    instruments: [
      { instrumentId: `min1_${"1".repeat(64)}`, symbol: "QA" },
      { instrumentId: `min1_${"2".repeat(64)}`, symbol: "QB" },
    ],
    queryFields: kind === "bars" ? { ...common, timeframe: "1Min", adjustment: "raw" } : common,
    trustedClockEvidence: {
      available: true,
      basisId: CLOCK_BASIS_ID,
      wallClock: "system-utc",
      synchronization: "verified-bound",
      maximumErrorNs: 0n,
      maximumErrorBounded: true,
      monotonicClock: "process-monotonic-us",
      monotonicSessionId: CLOCK_SESSION,
      priorSample: {
        sampleId: "prior",
        previousSampleId: null,
        basisId: CLOCK_BASIS_ID,
        wallClock: "system-utc",
        synchronization: "verified-bound",
        wallNs: WALL_NS - 1n,
        monotonicClock: "process-monotonic-us",
        monotonicSessionId: CLOCK_SESSION,
        monotonicUs: 100n,
      },
      currentSample: {
        sampleId: "current",
        previousSampleId: "prior",
        basisId: CLOCK_BASIS_ID,
        wallClock: "system-utc",
        synchronization: "verified-bound",
        wallNs: WALL_NS,
        monotonicClock: "process-monotonic-us",
        monotonicSessionId: CLOCK_SESSION,
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
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("repair fixture plan must validate");
  return result.value;
}

export function credentialAuthorizationInput(
  plan: ValidatedMarketAcquisitionConfiguration,
): CredentialAuthorizationInput {
  const digest = (member: string): string =>
    canonicalHash("peas/p1-10-repair-credential-evidence/v1", { member });
  const retrievalAttemptId = `rat1_${digest("retrieval-attempt")}`;
  const acquisitionObservationId = deriveAcquisitionObservationId({
    provider: "alpaca",
    retrievalAttemptId,
    sanitizedRequestIdentityHash: plan.requestIdentityHash,
    routeLabel: plan.route.safeRouteLabel,
  });
  const ledger = new MarketAcquisitionLedger("p1-10-repair-credential-ledger", {
    wallClock: "system-utc",
    synchronization: "verified-bound",
    maximumErrorMs: 0,
    monotonicClock: "process-monotonic-us",
    monotonicSessionId: "p1-10-repair-credential-ledger-session",
  });
  const stamp = (offset: number) => ({
    clockBasisId: ledger.clockBasis.clockBasisId,
    wallTimeMs: 1_000 + offset,
    monotonicTimeUs: 10_000 + offset,
  });
  const declaration = ledger.declareAcquisition(
    {
      kind: "acquisition.declared",
      acquisitionObservationId,
      provider: "alpaca",
      retrievalAttemptId,
      sanitizedRequestIdentityHash: plan.requestIdentityHash,
      routeLabel: plan.route.safeRouteLabel,
    },
    stamp(0),
  );
  const started = ledger.requestStarted(
    declaration,
    { kind: "request.started", acquisitionObservationId },
    stamp(1),
  );
  const journalIdentity = {
    schemaVersion: 1 as const,
    requestIdentityHash: plan.requestIdentityHash,
    providerId: plan.route.providerId,
    datasetId: plan.route.datasetId,
    feedId: plan.route.feedId,
    endpointChannelId: plan.route.endpointChannelId,
  };
  const body = (
    stageLedgerFactId: string,
    causalParentFactIds: readonly string[],
  ): JournalCheckpointBody => ({
    schemaVersion: 1,
    runSessionNonce: "p1-10-repair-credential-run",
    acquisitionObservationId,
    marketAcquisitionId: `maq1_${digest("market-acquisition")}`,
    admittedMarketAcquisitionIds: [],
    requestIdentityHash: plan.requestIdentityHash,
    acquisitionConfigurationHash: plan.acquisitionConfigurationHash,
    providerId: journalIdentity.providerId,
    datasetId: journalIdentity.datasetId,
    feedId: journalIdentity.feedId,
    endpointChannelId: journalIdentity.endpointChannelId,
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
    attemptId: `mat1_${digest("attempt")}`,
    retrievalAttemptId,
    attemptOrdinal: 0,
    artifactObservationId: null,
    artifactDigest: null,
    artifactSizeBytes: null,
    artifactObservationHash: null,
    artifactContentId: null,
    rawArtifactId: null,
    stageLedgerFactId,
    causalParentFactIds,
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
  });
  const journalId = deriveMarketAcquisitionJournalId(journalIdentity);
  const declared = createJournalEntry(
    null,
    journalId,
    "acquisition-declared",
    body(
      declaration.entryId,
      declaration.parentEntryIds.filter((id) => id !== ledger.clockDeclaration.entryId),
    ),
  );
  const requestStarted = createJournalEntry(
    declared,
    journalId,
    "request-started",
    body(
      started.entryId,
      started.parentEntryIds.filter((id) => id !== ledger.clockDeclaration.entryId),
    ),
  );
  return Object.freeze({
    plan,
    acquisitionObservationId,
    retrievalAttemptId,
    journalIdentity,
    journal: Object.freeze([declared, requestStarted]),
    ledger: ledger.entries,
    retentionJournal: new MemoryArtifactRetentionJournal(),
  });
}

export function credentialEvidence(
  plan: ValidatedMarketAcquisitionConfiguration,
): CredentialAuthorizationEvidence {
  return establishCredentialAuthorizationEvidence(credentialAuthorizationInput(plan));
}

export function completeChainProof(admissions: readonly AlpacaWirePageAdmission[]): Readonly<{
  journal: readonly import("../src/adapters/market-acquisition/journal.js").JournalEntry[];
  expectedIdentity: import("../src/adapters/market-acquisition/journal.js").JournalIdentityInput;
}> {
  assert.ok(admissions.length > 0);
  const plan = validatedRepairPlan(admissions[0]?.endpointKind ?? "bars");
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
    canonicalHash("peas/p1-10-repair-chain-proof/v1", { member });
  const acquisitionObservationId = hash("acquisition-observation");
  const entries: import("../src/adapters/market-acquisition/journal.js").JournalEntry[] = [];
  let cumulativePages = 0;
  let cumulativeBytes = 0;
  let cumulativeRecords = 0;
  let cumulativeAttempts = 0;
  let currentTokenHash = NO_TOKEN_HASH;
  let currentTokenMaterial: string | null = null;
  let currentBinding: string | null = null;
  let pageChainHash = GENESIS_HASH;
  const append = (kind: Parameters<typeof createJournalEntry>[2], body: JournalCheckpointBody) => {
    entries.push(createJournalEntry(entries.at(-1) ?? null, journalId, kind, body));
  };
  const base = (
    pageOrdinal: number,
    overrides: Partial<JournalCheckpointBody> = {},
  ): JournalCheckpointBody => ({
    schemaVersion: 1,
    runSessionNonce: "p1-10-repair-chain-run",
    acquisitionObservationId,
    marketAcquisitionId: admissions[pageOrdinal]?.marketAcquisitionId ?? `maq1_${hash("missing")}`,
    admittedMarketAcquisitionIds: [],
    requestIdentityHash: plan.requestIdentityHash,
    acquisitionConfigurationHash: plan.acquisitionConfigurationHash,
    providerId: expectedIdentity.providerId,
    datasetId: expectedIdentity.datasetId,
    feedId: expectedIdentity.feedId,
    endpointChannelId: expectedIdentity.endpointChannelId,
    authorizationMode: "p1-09-approved",
    logicalPageIdentityHash: deriveLogicalPageIdentityHash({
      requestIdentityHash: plan.requestIdentityHash,
      pageOrdinal,
      currentTokenHash,
    }),
    pageOrdinal,
    currentTokenHash,
    currentResumableTokenMaterial: currentTokenMaterial,
    nextTokenHash: null,
    nextResumableTokenMaterial: null,
    currentContinuationBindingHash: currentBinding,
    nextContinuationBindingHash: null,
    attemptId: `mat1_${hash(`attempt-${pageOrdinal}`)}`,
    retrievalAttemptId: `rat1_${hash(`attempt-${pageOrdinal}`)}`,
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
    pageChainHash,
    cumulativeSuccessfulPages: cumulativePages,
    cumulativeVerifiedBytes: cumulativeBytes,
    cumulativeRecords,
    cumulativeNormalizedFacts: 0,
    cumulativeAttempts,
    acquisitionDeadlineBasis: "offline-monotonic-basis-v1",
    quotaWindowEvidence: Array.from({ length: cumulativeAttempts }, (_, index) => index),
    terminalState: null,
    terminalReasonCode: null,
    incomplete: true,
    ...overrides,
  });
  append("acquisition-declared", base(0));
  append("request-started", base(0));
  for (const [pageOrdinal, admission] of admissions.entries()) {
    cumulativeAttempts += 1;
    append(
      "attempt-started",
      base(pageOrdinal, {
        cumulativeAttempts,
        quotaWindowEvidence: Array.from({ length: cumulativeAttempts }, (_, index) => index),
      }),
    );
    append(
      "request-succeeded",
      base(pageOrdinal, {
        cumulativeAttempts,
        quotaWindowEvidence: Array.from({ length: cumulativeAttempts }, (_, index) => index),
      }),
    );
    const artifactSizeBytes = admission.wireItemCount + 1;
    const artifact = {
      artifactObservationId: hash(`observation-${pageOrdinal}`),
      artifactDigest: hash(`artifact-${pageOrdinal}`),
      artifactSizeBytes,
      artifactObservationHash: hash(`observation-hash-${pageOrdinal}`),
      artifactContentId: `mac1_${hash(`content-${pageOrdinal}`)}`,
      rawArtifactId: admission.rawArtifactId,
      cumulativeAttempts,
      quotaWindowEvidence: Array.from({ length: cumulativeAttempts }, (_, index) => index),
    } as const;
    append("artifact-committed", base(pageOrdinal, artifact));
    append(
      "artifact-verified",
      base(pageOrdinal, {
        ...artifact,
        pageRecordCount: admission.wireItemCount,
      }),
    );
    const admissionProof = planPageAdmission(
      {
        priorPageChainHash: pageChainHash,
        marketAcquisitionId: admission.marketAcquisitionId,
        requestIdentityHash: plan.requestIdentityHash,
        logicalPageIdentityHash: deriveLogicalPageIdentityHash({
          requestIdentityHash: plan.requestIdentityHash,
          pageOrdinal,
          currentTokenHash,
        }),
        pageOrdinal,
        artifactObservationId: artifact.artifactObservationId,
        artifactDigest: artifact.artifactDigest,
        artifactSizeBytes,
        artifactObservationHash: artifact.artifactObservationHash,
        artifactContentId: artifact.artifactContentId,
        rawArtifactId: artifact.rawArtifactId,
        currentTokenHash,
        pageRecordCount: admission.wireItemCount,
        cumulativeSuccessfulPages: cumulativePages + 1,
        cumulativeVerifiedBytes: cumulativeBytes + artifactSizeBytes,
        cumulativeRecords: cumulativeRecords + admission.wireItemCount,
        cumulativeNormalizedFacts: 0,
        cumulativeAttempts,
      },
      admission.privateNextToken,
    );
    cumulativePages += 1;
    cumulativeBytes += artifactSizeBytes;
    cumulativeRecords += admission.wireItemCount;
    pageChainHash = admissionProof.pageChainHash;
    append(
      "page-checkpointed",
      base(pageOrdinal, {
        ...artifact,
        admittedMarketAcquisitionIds: [admission.marketAcquisitionId],
        nextTokenHash: admissionProof.nextTokenHash,
        nextResumableTokenMaterial: admission.privateNextToken,
        nextContinuationBindingHash: admissionProof.nextContinuationBindingHash,
        pageRecordCount: admission.wireItemCount,
        pageChainHash,
        cumulativeSuccessfulPages: cumulativePages,
        cumulativeVerifiedBytes: cumulativeBytes,
        cumulativeRecords,
      }),
    );
    currentTokenMaterial = admission.privateNextToken;
    currentTokenHash = admissionProof.nextTokenHash;
    currentBinding = admissionProof.nextContinuationBindingHash;
  }
  assert.equal(currentTokenHash, TERMINAL_TOKEN_HASH);
  append(
    "chain-complete",
    journalEntryBody(entries.at(-1) as NonNullable<(typeof entries)[number]>),
  );
  return Object.freeze({ journal: Object.freeze(entries), expectedIdentity });
}
