import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import type { ArtifactStore } from "../src/artifacts/artifact-store.js";
import { canonicalHash } from "../src/core/hash.js";
import { canonicalJson, type JsonValue } from "../src/core/json.js";
import { AlpacaProductionAttemptBoundary } from "../src/adapters/market-acquisition/alpaca/adapter.js";
import type {
  AlpacaAttemptResource,
  AlpacaBodyRead,
  AlpacaDeadlineScheduler,
  AlpacaPageAuthority,
  AlpacaResponseBody,
  AlpacaTransport,
  AlpacaTransportRequest,
  AlpacaTransportResponse,
  AlpacaArtifactCommitSink,
} from "../src/adapters/market-acquisition/alpaca/contracts.js";
import {
  RetentionOwnedAlpacaPageSink,
  createRetentionOwnedAlpacaPageSink,
  createTestAlpacaArtifactCommitSink,
} from "../src/adapters/market-acquisition/alpaca/retained-sink.js";
import { createOwnedAlpacaDeadlineScheduler } from "../src/adapters/market-acquisition/alpaca/deadline.js";
import { openSqliteDatabase } from "../src/adapters/sqlite/database.js";
import { decideAcquisitionRestart } from "../src/adapters/market-acquisition/artifact-integration.js";
import {
  ACCEPTED_PR_2E_CANDIDATE_SHA,
  MARKET_ACQUISITION_LIMITS,
  type AlpacaAcquisitionKind,
  type MarketAcquisitionConfigurationInput,
  type ValidatedMarketAcquisitionConfiguration,
} from "../src/adapters/market-acquisition/contracts.js";
import { validateMarketAcquisitionConfiguration } from "../src/adapters/market-acquisition/configuration.js";
import type { AlpacaAuthorizationHeaders } from "../src/adapters/market-acquisition/credentials.js";
import { createTestCredentialIsolatedAlpacaTransport } from "../src/adapters/market-acquisition/credentials.js";
import {
  ALPACA_ROUTE_REGISTRY,
  ZERO_SPEND_POLICY_ID,
  ZERO_SPEND_POLICY_PREIMAGE,
} from "../src/adapters/market-acquisition/identity.js";
import {
  deriveContinuationBindingHash,
  deriveLogicalPageIdentityHash,
  deriveMarketAcquisitionJournalId,
  derivePrivateTokenHash,
  NO_TOKEN_HASH,
  createJournalEntry,
  type AcquisitionJournal,
  type JournalCheckpointBody,
} from "../src/adapters/market-acquisition/journal.js";
import { MemoryAcquisitionJournal } from "../src/adapters/market-acquisition/memory-journal.js";
import {
  MAX_ATTEMPTS_PER_ACQUISITION,
  MAX_ATTEMPTS_PER_PAGE,
  decideRetry,
  type RetryFailure,
} from "../src/adapters/market-acquisition/retry.js";
import { SqliteAcquisitionJournal } from "../src/adapters/market-acquisition/sqlite-journal.js";
import {
  type DefaultArtifactRetentionController,
  createTestArtifactRetentionController,
} from "../src/adapters/market-acquisition/retention/controller.js";
import type { RetentionArtifactBoundary } from "../src/adapters/market-acquisition/retention/contracts.js";
import { MemoryArtifactRetentionJournal } from "../src/adapters/market-acquisition/retention/memory-journal.js";
import {
  AcquisitionStateMachine,
  createInitialAcquisitionSnapshot,
  type AcquisitionEventProof,
  type AcquisitionMachineSnapshot,
  type AcquisitionTransitionPlan,
} from "../src/adapters/market-acquisition/state-machine.js";
import {
  ALLOW_ALL_RETENTION,
  credentialAuthorizationFixture,
  retentionGuardedArtifactStore,
} from "./p1-10-repair-fixtures.js";

const ORIGINAL_FETCH = globalThis.fetch;
let unexpectedNetworkCalls = 0;
globalThis.fetch = (() => {
  unexpectedNetworkCalls += 1;
  throw new Error("unexpected network");
}) as typeof fetch;
test.after(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

const WALL_NS = 1_800_000_000_000_000_000n;
const BOUNDARY_NS = WALL_NS - 900_000_000_000n;
const CLOCK_SESSION = "alpaca-adapter-test-session";
const CLOCK_BASIS_ID = `clk1_${canonicalHash("peas/clock-basis/v1", {
  wallClock: "system-utc",
  synchronization: "verified-bound",
  maximumErrorMs: 0,
  monotonicClock: "process-monotonic-us",
  monotonicSessionId: CLOCK_SESSION,
})}`;
const HEADERS: AlpacaAuthorizationHeaders = Object.freeze({
  "APCA-API-KEY-ID": "x",
  "APCA-API-SECRET-KEY": "y",
});

function adapterRetention(): DefaultArtifactRetentionController {
  const artifacts: RetentionArtifactBoundary = {
    async settleActiveReadersAndWriters() {
      return true;
    },
    async eraseDigestCopies(artifactDigest) {
      return {
        artifactDigest,
        erasedCopies: { content: 0, staging: 0, snapshot: 0, quarantine: 0 },
        alreadyAbsent: true,
      };
    },
    async verifyDigestCopiesAbsent() {
      return true;
    },
  };
  return createTestArtifactRetentionController({
    journal: new MemoryArtifactRetentionJournal(),
    artifacts,
    nowMs: () => 0,
  });
}

async function executeAlpacaAttempt<T>(
  input: Readonly<{
    plan: ValidatedMarketAcquisitionConfiguration;
    page: AlpacaPageAuthority;
    authorizationHeaders: AlpacaAuthorizationHeaders;
    transport: AlpacaTransport;
    artifactSink: AlpacaArtifactCommitSink<T>;
    deadlineScheduler: AlpacaDeadlineScheduler | TimerDouble;
    acquisitionDeclaredMonotonicMs?: number;
    nowMonotonicMs?: number;
  }>,
) {
  assert.equal(Object.isFrozen(input.authorizationHeaders), true);
  const credentialFixture = await credentialAuthorizationFixture(input.plan);
  const boundary = new AlpacaProductionAttemptBoundary(
    {
      read(name) {
        return name.endsWith("KEY_ID")
          ? input.authorizationHeaders["APCA-API-KEY-ID"]
          : input.authorizationHeaders["APCA-API-SECRET-KEY"];
      },
    },
    credentialFixture.authorization,
  );
  return boundary.execute({
    plan: input.plan,
    credentialAuthorization: credentialFixture.request,
    page: input.page,
    transport: createTestCredentialIsolatedAlpacaTransport({
      dispatch: (request) => input.transport.dispatch(request, {} as never),
      abort: () => input.transport.abort(),
      settle: () => input.transport.settle(),
    }),
    artifactSink: createRetentionOwnedAlpacaPageSink(
      createTestAlpacaArtifactCommitSink(input.artifactSink),
      adapterRetention(),
    ),
    deadlineScheduler:
      input.deadlineScheduler instanceof TimerDouble
        ? input.deadlineScheduler.scheduler
        : input.deadlineScheduler,
    acquisitionDeclaredMonotonicMs: input.acquisitionDeclaredMonotonicMs ?? 0,
    nowMonotonicMs: input.nowMonotonicMs ?? 0,
  });
}

function timestamp(epochNs: bigint): string {
  const milliseconds = epochNs / 1_000_000n;
  const fraction = (epochNs % 1_000_000_000n).toString().padStart(9, "0");
  return `${new Date(Number(milliseconds)).toISOString().slice(0, 19)}.${fraction}Z`;
}

function configuration(
  kind: AlpacaAcquisitionKind = "quotes",
  endNs = BOUNDARY_NS,
): MarketAcquisitionConfigurationInput {
  const route = ALPACA_ROUTE_REGISTRY[kind];
  const common = {
    symbols: "QA,QB",
    start: timestamp(endNs - 60_000_000_000n),
    end: timestamp(endNs),
    limit: "10000",
    feed: "sip",
    sort: "asc",
  };
  return {
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
}

function validatedPlan(
  kind: AlpacaAcquisitionKind = "quotes",
): ValidatedMarketAcquisitionConfiguration {
  const result = validateMarketAcquisitionConfiguration(configuration(kind));
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("test plan must validate");
  return result.value;
}

type ResourceCounts = {
  abort: number;
  destroy: number;
  settle: number;
  read: number;
  write: number;
  complete: number;
  transport: number;
};

function counts(): ResourceCounts {
  return { abort: 0, destroy: 0, settle: 0, read: 0, write: 0, complete: 0, transport: 0 };
}

type ResourceFailure = "abort" | "destroy" | "settle" | null;

class ResourceDouble implements AlpacaAttemptResource {
  constructor(
    protected readonly counters: ResourceCounts,
    private readonly failure: ResourceFailure = null,
  ) {}
  async abort(): Promise<void> {
    this.counters.abort += 1;
    if (this.failure === "abort") throw new Error("synthetic abort failure");
  }
  async destroy(): Promise<void> {
    this.counters.destroy += 1;
    if (this.failure === "destroy") throw new Error("synthetic destroy failure");
  }
  async settle(): Promise<void> {
    this.counters.settle += 1;
    if (this.failure === "settle") throw new Error("synthetic settle failure");
  }
}

class BodyDouble extends ResourceDouble implements AlpacaResponseBody {
  readonly #chunks: readonly Uint8Array[];
  #index = 0;
  #pendingResolve: ((value: AlpacaBodyRead) => void) | null = null;
  readonly #hangAfterChunks: boolean;
  readonly #throwAfterChunks: boolean;
  constructor(
    counters: ResourceCounts,
    chunks: readonly Uint8Array[],
    hangAfterChunks = false,
    throwAfterChunks = false,
    cleanupFailure: ResourceFailure = null,
  ) {
    super(counters, cleanupFailure);
    this.#chunks = chunks;
    this.#hangAfterChunks = hangAfterChunks;
    this.#throwAfterChunks = throwAfterChunks;
  }
  async read(): Promise<AlpacaBodyRead> {
    this.counters.read += 1;
    const chunk = this.#chunks[this.#index];
    if (chunk !== undefined) {
      this.#index += 1;
      return { done: false, bytes: chunk };
    }
    if (this.#throwAfterChunks) throw new Error("synthetic partial-body transport failure");
    if (!this.#hangAfterChunks) return { done: true };
    return new Promise((resolve) => {
      this.#pendingResolve = resolve;
    });
  }
  override async abort(): Promise<void> {
    let failure: unknown = null;
    try {
      await super.abort();
    } catch (error) {
      failure = error;
    }
    this.#pendingResolve?.({ done: true });
    this.#pendingResolve = null;
    if (failure !== null) throw failure;
  }
}

class SinkDouble extends ResourceDouble implements AlpacaArtifactCommitSink<string> {
  bytes = 0;
  readonly #hash = createHash("sha256");
  constructor(
    counters: ResourceCounts,
    private readonly failWrite = false,
    cleanupFailure: ResourceFailure = null,
  ) {
    super(counters, cleanupFailure);
  }
  async write(bytes: Uint8Array): Promise<void> {
    this.counters.write += 1;
    if (this.failWrite) throw new Error("synthetic sink failure");
    this.bytes += bytes.byteLength;
    this.#hash.update(bytes);
  }
  async prepareVerifiedCommit() {
    const bytes = this.bytes;
    return Object.freeze({
      ownership: Object.freeze({
        policyId: "p1-10-alpaca-private-retention-v1",
        providerLane: "alpaca" as const,
        providerId: `mpv1_${"1".repeat(64)}`,
        datasetId: `mds1_${"2".repeat(64)}`,
        feedId: `mfd1_${"3".repeat(64)}`,
        endpointChannelId: `mec1_${"4".repeat(64)}`,
        artifactObservationId: `mao1_${"5".repeat(64)}`,
        artifactDigest: this.#hash.digest("hex"),
        artifactSizeBytes: bytes,
        derivedIds: [],
        trustedCaptureMs: 0,
        expiresAtMs: 1,
      }),
      commit: async () => {
        this.counters.complete += 1;
        return `verified:${bytes}`;
      },
    });
  }
}

const neverSettles = (): Promise<void> => new Promise<void>(() => {});

class PendingCleanupResource extends ResourceDouble {
  override abort(): Promise<void> {
    this.counters.abort += 1;
    return neverSettles();
  }
  override destroy(): Promise<void> {
    this.counters.destroy += 1;
    return neverSettles();
  }
  override settle(): Promise<void> {
    this.counters.settle += 1;
    return neverSettles();
  }
}

class PendingCleanupBody extends BodyDouble {
  override abort(): Promise<void> {
    this.counters.abort += 1;
    return neverSettles();
  }
  override destroy(): Promise<void> {
    this.counters.destroy += 1;
    return neverSettles();
  }
  override settle(): Promise<void> {
    this.counters.settle += 1;
    return neverSettles();
  }
}

class PendingCleanupSink extends SinkDouble {
  override abort(): Promise<void> {
    this.counters.abort += 1;
    return neverSettles();
  }
  override destroy(): Promise<void> {
    this.counters.destroy += 1;
    return neverSettles();
  }
  override settle(): Promise<void> {
    this.counters.settle += 1;
    return neverSettles();
  }
}

class TimerDouble {
  #expire: (() => void) | null = null;
  readonly scheduler: AlpacaDeadlineScheduler;
  cancelled = 0;
  settled = 0;
  armedWith: number | null = null;
  constructor(private readonly failSettle = false) {
    this.scheduler = createOwnedAlpacaDeadlineScheduler({
      armed: ({ delayMs, expireNow }) => {
        this.armedWith = delayMs;
        this.#expire = expireNow;
      },
      cancelled: () => {
        this.cancelled += 1;
      },
      settled: () => {
        this.settled += 1;
        if (this.failSettle) throw new Error("synthetic timer settle failure");
      },
    });
  }
  expire(): void {
    this.#expire?.();
  }
}

class CancelDependentTimer extends TimerDouble {}

class TransportDouble implements AlpacaTransport {
  request: AlpacaTransportRequest | null = null;
  constructor(
    private readonly counters: ResourceCounts,
    private readonly response: AlpacaTransportResponse,
    private readonly failure: ResourceFailure = null,
  ) {}
  async dispatch(request: AlpacaTransportRequest): Promise<AlpacaTransportResponse> {
    this.counters.transport += 1;
    this.request = request;
    return this.response;
  }
  async abort(): Promise<void> {
    this.counters.abort += 1;
    if (this.failure === "abort") throw new Error("synthetic transport abort failure");
  }
  async settle(): Promise<void> {
    this.counters.settle += 1;
    if (this.failure === "settle") throw new Error("synthetic transport settle failure");
  }
}

class HangingTransport implements AlpacaTransport {
  #reject: ((reason: unknown) => void) | null = null;
  constructor(private readonly counters: ResourceCounts) {}
  async dispatch(request: AlpacaTransportRequest): Promise<AlpacaTransportResponse> {
    assert.equal(request.signal.aborted, false);
    this.counters.transport += 1;
    return new Promise((_, reject) => {
      this.#reject = reject;
    });
  }
  async abort(): Promise<void> {
    this.counters.abort += 1;
    this.#reject?.(new Error("synthetic aborted transport"));
    this.#reject = null;
  }
  async settle(): Promise<void> {
    this.counters.settle += 1;
  }
}

class PendingCleanupTransport implements AlpacaTransport {
  request: AlpacaTransportRequest | null = null;
  constructor(
    private readonly counters: ResourceCounts,
    private readonly value: AlpacaTransportResponse,
  ) {}
  async dispatch(request: AlpacaTransportRequest): Promise<AlpacaTransportResponse> {
    this.counters.transport += 1;
    this.request = request;
    return this.value;
  }
  abort(): Promise<void> {
    this.counters.abort += 1;
    return neverSettles();
  }
  settle(): Promise<void> {
    this.counters.settle += 1;
    return neverSettles();
  }
}

function response(
  body: AlpacaResponseBody,
  overrides: Partial<AlpacaTransportResponse> = {},
): AlpacaTransportResponse {
  return {
    status: 200,
    contentLength: null,
    retryAfter: null,
    quotaClassification: "missing",
    body,
    siblingResources: [],
    ...overrides,
  };
}

function firstPage(): AlpacaPageAuthority {
  return { kind: "first-page", pageOrdinal: 0 };
}

function continuationPage(plan: ValidatedMarketAcquisitionConfiguration): AlpacaPageAuthority {
  const tokenMaterial = "q";
  const tokenHash = derivePrivateTokenHash(tokenMaterial);
  const preceding = {
    marketAcquisitionId: `maq1_${"1".repeat(64)}`,
    requestIdentityHash: plan.requestIdentityHash,
    logicalPageIdentityHash: deriveLogicalPageIdentityHash({
      requestIdentityHash: plan.requestIdentityHash,
      pageOrdinal: 0,
      currentTokenHash: NO_TOKEN_HASH,
    }),
    pageOrdinal: 0,
    artifactObservationId: "2".repeat(64),
    artifactDigest: "3".repeat(64),
    pageChainHash: "4".repeat(64),
    nextTokenHash: tokenHash,
    nextContinuationBindingHash: "",
  };
  const nextContinuationBindingHash = deriveContinuationBindingHash({
    precedingMarketAcquisitionId: preceding.marketAcquisitionId,
    requestIdentityHash: preceding.requestIdentityHash,
    precedingLogicalPageIdentityHash: preceding.logicalPageIdentityHash,
    precedingPageOrdinal: preceding.pageOrdinal,
    precedingArtifactObservationId: preceding.artifactObservationId,
    precedingArtifactDigest: preceding.artifactDigest,
    precedingPageChainHash: preceding.pageChainHash,
    nextPageOrdinal: 1,
    nextTokenHash: tokenHash,
  });
  return {
    kind: "verified-continuation",
    pageOrdinal: 1,
    tokenMaterial,
    currentTokenHash: tokenHash,
    currentContinuationBindingHash: nextContinuationBindingHash,
    previouslyConsumedTokenHashes: [],
    preceding: { ...preceding, nextContinuationBindingHash },
  };
}

type PartialBodyFailureKind = "transport" | "timeout";
type CleanupFailureKind =
  | `${"body" | "sibling" | "sink"}-${"abort" | "destroy" | "settle"}`
  | `transport-${"abort" | "settle"}`
  | "timer-settle"
  | null;

function cleanupOperation(
  cleanupFailure: CleanupFailureKind,
  owner: "body" | "sibling" | "sink" | "transport",
): ResourceFailure {
  for (const operation of ["abort", "destroy", "settle"] as const) {
    if (cleanupFailure === `${owner}-${operation}`) return operation;
  }
  return null;
}

async function partialBodyFailure(
  kind: PartialBodyFailureKind,
  cleanupFailure: CleanupFailureKind = null,
) {
  const counters = counts();
  const body = new BodyDouble(
    counters,
    [Uint8Array.from([1, 2, 3])],
    kind === "timeout",
    kind === "transport",
    cleanupOperation(cleanupFailure, "body"),
  );
  const sibling = new ResourceDouble(counters, cleanupOperation(cleanupFailure, "sibling"));
  const sink = new SinkDouble(counters, false, cleanupOperation(cleanupFailure, "sink"));
  const transport = new TransportDouble(
    counters,
    response(body, { siblingResources: [sibling] }),
    cleanupOperation(cleanupFailure, "transport"),
  );
  const timer = new TimerDouble(cleanupFailure === "timer-settle");
  const promise = executeAlpacaAttempt({
    plan: validatedPlan(),
    page: firstPage(),
    authorizationHeaders: HEADERS,
    transport,
    artifactSink: sink,
    deadlineScheduler: timer,
  });
  if (kind === "timeout") {
    await new Promise<void>((resolve) => setImmediate(resolve));
    timer.expire();
  }
  const result = await promise;
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("synthetic partial-body failure unexpectedly succeeded");
  return { result, counters, sink, timer };
}

function retryDecision(
  failure: RetryFailure,
  pageAttemptsStarted: number,
  acquisitionAttemptsStarted: number,
) {
  return decideRetry({ failure, pageAttemptsStarted, acquisitionAttemptsStarted });
}

function journalIdentity(plan: ValidatedMarketAcquisitionConfiguration) {
  return {
    schemaVersion: 1,
    requestIdentityHash: plan.requestIdentityHash,
    providerId: plan.route.providerId,
    datasetId: plan.route.datasetId,
    feedId: plan.route.feedId,
    endpointChannelId: plan.route.endpointChannelId,
  } as const;
}

function eventProof(
  snapshot: AcquisitionMachineSnapshot,
  nowMonotonicMs: number,
  resourcesSettled = true,
): AcquisitionEventProof {
  return {
    requestIdentityHash: snapshot.requestIdentityHash,
    acquisitionConfigurationHash: snapshot.acquisitionConfigurationHash,
    marketAcquisitionJournalId: snapshot.marketAcquisitionJournalId,
    runSessionNonce: snapshot.runSessionNonce,
    nowMonotonicMs,
    resourcesSettled,
  };
}

function checkpointBody(
  snapshot: AcquisitionMachineSnapshot,
  plan: ValidatedMarketAcquisitionConfiguration,
): JournalCheckpointBody {
  return {
    schemaVersion: 1,
    runSessionNonce: snapshot.runSessionNonce,
    acquisitionObservationId: canonicalHash("peas/p1-10-adapter-retry-test/v1", {
      member: "acquisition-observation",
    }),
    marketAcquisitionId: `maq1_${canonicalHash("peas/p1-10-adapter-retry-test/v1", {
      member: "market-acquisition",
    })}`,
    admittedMarketAcquisitionIds: [],
    requestIdentityHash: snapshot.requestIdentityHash,
    acquisitionConfigurationHash: snapshot.acquisitionConfigurationHash,
    providerId: plan.route.providerId,
    datasetId: plan.route.datasetId,
    feedId: plan.route.feedId,
    endpointChannelId: plan.route.endpointChannelId,
    authorizationMode: "p1-09-approved",
    logicalPageIdentityHash: snapshot.logicalPageIdentityHash,
    pageOrdinal: snapshot.pageOrdinal,
    currentTokenHash: snapshot.currentTokenHash,
    currentResumableTokenMaterial: null,
    nextTokenHash: null,
    nextResumableTokenMaterial: null,
    currentContinuationBindingHash: snapshot.currentContinuationBindingHash,
    nextContinuationBindingHash: null,
    attemptId:
      snapshot.attemptId ??
      `mat1_${canonicalHash("peas/p1-10-adapter-retry-test/v1", { member: "pending-attempt" })}`,
    retrievalAttemptId:
      snapshot.retrievalAttemptId ??
      `rat1_${canonicalHash("peas/p1-10-adapter-retry-test/v1", { member: "pending-attempt" })}`,
    attemptOrdinal: snapshot.attemptOrdinal ?? 0,
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
    pageChainHash: snapshot.pageChainHash,
    cumulativeSuccessfulPages: snapshot.budgets.successfulPages,
    cumulativeVerifiedBytes: snapshot.budgets.verifiedBytes,
    cumulativeRecords: snapshot.budgets.records,
    cumulativeNormalizedFacts: snapshot.budgets.normalizedFacts,
    cumulativeAttempts: snapshot.budgets.attempts,
    acquisitionDeadlineBasis: "offline-monotonic-basis-v1",
    quotaWindowEvidence: snapshot.quotaWindowEvidence,
    terminalState: null,
    terminalReasonCode: null,
    incomplete: true,
  };
}

async function persistPlan(
  journal: AcquisitionJournal,
  journalId: string,
  plan: ValidatedMarketAcquisitionConfiguration,
  transition: AcquisitionTransitionPlan,
): Promise<void> {
  if (transition.checkpointKind === null) return;
  const rows = await journal.load(journalId);
  await journal.append(
    createJournalEntry(
      rows.at(-1) ?? null,
      journalId,
      transition.checkpointKind,
      checkpointBody(transition.next, plan),
    ),
  );
}

async function driveCleanFailureToRetryBoundary(
  failureKind: PartialBodyFailureKind,
  journal: AcquisitionJournal,
  plan: ValidatedMarketAcquisitionConfiguration,
) {
  const identity = journalIdentity(plan);
  const journalId = deriveMarketAcquisitionJournalId(identity);
  const initial = createInitialAcquisitionSnapshot({
    requestIdentityHash: plan.requestIdentityHash,
    acquisitionConfigurationHash: plan.acquisitionConfigurationHash,
    marketAcquisitionJournalId: journalId,
    runSessionNonce: "offline-adapter-retry-session-v1",
    acquisitionDeclaredMonotonicMs: 0,
  });
  const machine = new AcquisitionStateMachine(initial, (transition) =>
    persistPlan(journal, journalId, plan, transition),
  );
  await machine.applyAcquisitionEvent({
    kind: "begin-preflight",
    proof: eventProof(machine.snapshot, 0),
  });
  await machine.applyAcquisitionEvent({
    kind: "preflight-approved",
    proof: eventProof(machine.snapshot, 0),
  });
  await machine.applyAcquisitionEvent({
    kind: "credentials-loaded",
    proof: eventProof(machine.snapshot, 0),
  });
  await machine.applyAcquisitionEvent({
    kind: "dispatch-started",
    proof: eventProof(machine.snapshot, 1_000, false),
    entitlementQuotaLimit: 30,
    deadlineProof: {
      acquisitionDeclaredMonotonicMs: 0,
      attemptStartedMonotonicMs: 1_000,
      nowMonotonicMs: 1_000,
    },
  });
  const logicalPageIdentityHash = machine.snapshot.logicalPageIdentityHash;
  const attemptId = machine.snapshot.attemptId;
  const { result, counters } = await partialBodyFailure(failureKind);
  await machine.applyAcquisitionEvent({
    kind: "retry-cleanup-complete",
    proof: eventProof(machine.snapshot, 1_001, result.resourcesSettled),
    context: {
      failure: result.retryFailure,
      pageAttemptsStarted: machine.snapshot.pageAttemptsStarted,
      acquisitionAttemptsStarted: machine.snapshot.budgets.attempts,
    },
  });
  assert.equal(machine.snapshot.currentState, "waiting-retry");
  assert.equal(machine.snapshot.logicalPageIdentityHash, logicalPageIdentityHash);
  assert.equal(machine.snapshot.attemptId, attemptId);
  assert.equal(machine.snapshot.budgets.attempts, 1);
  assert.equal(machine.snapshot.budgets.successfulPages, 0);
  assert.equal(machine.snapshot.budgets.records, 0);
  assert.equal(machine.snapshot.pendingRetryDelayMs, 1_000);
  assert.equal(counters.complete, 0);
  return { identity, journalId };
}

test("adapter-produced cleaned partial-body failures retry the same page within exact budgets", async () => {
  for (const failureKind of ["transport", "timeout"] as const) {
    const { result, counters, sink, timer } = await partialBodyFailure(failureKind);
    assert.equal(result.resourcesSettled, true, failureKind);
    assert.deepEqual(result.retryFailure, {
      kind: "clean-partial-body-transport",
      resourcesSettled: true,
    });
    assert.deepEqual(retryDecision(result.retryFailure, 1, 1), {
      kind: "retry",
      delayMs: 1_000,
      retryOrdinal: 1,
    });
    assert.deepEqual(retryDecision(result.retryFailure, 2, 2), {
      kind: "retry",
      delayMs: 2_000,
      retryOrdinal: 2,
    });
    assert.deepEqual(retryDecision(result.retryFailure, MAX_ATTEMPTS_PER_PAGE, 3), {
      kind: "stop",
      reason: "attempt-budget-exhausted",
    });
    assert.deepEqual(retryDecision(result.retryFailure, 1, MAX_ATTEMPTS_PER_ACQUISITION), {
      kind: "stop",
      reason: "attempt-budget-exhausted",
    });
    assert.equal(sink.bytes, 3);
    assert.equal(counters.abort, 4);
    assert.equal(counters.destroy, 3);
    assert.equal(counters.settle, 4);
    assert.equal(counters.read, 2);
    assert.equal(counters.write, 1);
    assert.equal(counters.complete, 0);
    assert.equal(timer.cancelled, 1);
    assert.equal(timer.settled, 1);
    const stable = { ...counters, timerCancelled: timer.cancelled, timerSettled: timer.settled };
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.deepEqual(
      { ...counters, timerCancelled: timer.cancelled, timerSettled: timer.settled },
      stable,
    );
  }
});

test("every unproved partial-body cleanup category remains terminal", async () => {
  const cleanupFailures = [
    "body-abort",
    "body-destroy",
    "body-settle",
    "sibling-abort",
    "sibling-destroy",
    "sibling-settle",
    "sink-abort",
    "sink-destroy",
    "sink-settle",
    "transport-abort",
    "transport-settle",
  ] as const satisfies readonly Exclude<CleanupFailureKind, null>[];
  for (const failureKind of ["transport", "timeout"] as const) {
    for (const cleanupFailure of cleanupFailures) {
      const { result } = await partialBodyFailure(failureKind, cleanupFailure);
      assert.equal(result.resourcesSettled, false, `${failureKind}:${cleanupFailure}`);
      assert.equal(result.retryFailure.kind, "cleanup-unprovable");
      assert.deepEqual(retryDecision(result.retryFailure, 1, 1), {
        kind: "stop",
        reason: "cleanup-unprovable",
      });
    }
  }
});

test("clean adapter retry has byte-identical memory and SQLite restart boundaries", async (t) => {
  const plan = validatedPlan();
  const projections: string[] = [];
  for (const failureKind of ["transport", "timeout"] as const) {
    const identity = journalIdentity(plan);
    const memory = new MemoryAcquisitionJournal(identity);
    const memoryBoundary = await driveCleanFailureToRetryBoundary(failureKind, memory, plan);
    const memoryRows = await memory.load(memoryBoundary.journalId);
    assert.equal(memoryRows.length, 3);
    const beforeRestart = canonicalJson(memoryRows as unknown as JsonValue);
    assert.deepEqual(
      await decideAcquisitionRestart({
        journal: memory,
        journalId: memoryBoundary.journalId,
        expectedIdentity: memoryBoundary.identity,
        expectedConfigurationHash: plan.acquisitionConfigurationHash,
        artifactStore: retentionGuardedArtifactStore({} as ArtifactStore, []),
      }),
      { kind: "fresh-attempt", pageOrdinal: 0, transportAllowed: true },
    );
    assert.equal(
      canonicalJson((await memory.load(memoryBoundary.journalId)) as unknown as JsonValue),
      beforeRestart,
    );

    const directory = mkdtempSync(join(tmpdir(), `peas-p1-10-adapter-retry-${failureKind}-`));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const filename = join(directory, "journal.sqlite");
    let database = openSqliteDatabase(filename, []);
    let sqlite = new SqliteAcquisitionJournal(database, identity);
    const sqliteBoundary = await driveCleanFailureToRetryBoundary(failureKind, sqlite, plan);
    const sqliteRows = await sqlite.load(sqliteBoundary.journalId);
    assert.equal(canonicalJson(sqliteRows as unknown as JsonValue), beforeRestart);
    database.close();

    database = openSqliteDatabase(filename, []);
    sqlite = new SqliteAcquisitionJournal(database, identity);
    assert.deepEqual(
      await decideAcquisitionRestart({
        journal: sqlite,
        journalId: sqliteBoundary.journalId,
        expectedIdentity: sqliteBoundary.identity,
        expectedConfigurationHash: plan.acquisitionConfigurationHash,
        artifactStore: retentionGuardedArtifactStore({} as ArtifactStore, []),
      }),
      { kind: "fresh-attempt", pageOrdinal: 0, transportAllowed: true },
    );
    const afterRestart = await sqlite.load(sqliteBoundary.journalId);
    assert.equal(canonicalJson(afterRestart as unknown as JsonValue), beforeRestart);
    projections.push(beforeRestart);
    database.close();
  }
  assert.equal(new Set(projections).size, 1);
  assert.equal(unexpectedNetworkCalls, 0);
});

async function successfulAttempt(
  kind: AlpacaAcquisitionKind = "quotes",
  page: AlpacaPageAuthority = firstPage(),
) {
  const counters = counts();
  const body = new BodyDouble(counters, [Uint8Array.from([1, 2]), Uint8Array.from([3])]);
  const transport = new TransportDouble(counters, response(body, { contentLength: 3 }));
  const sink = new SinkDouble(counters);
  const timer = new TimerDouble();
  const result = await executeAlpacaAttempt({
    plan: validatedPlan(kind),
    page,
    authorizationHeaders: HEADERS,
    transport,
    artifactSink: sink,
    deadlineScheduler: timer,
  });
  return { result, counters, transport, sink, timer };
}

test("frozen quotes, trades, and bars compile exact GET route and closed query pairs", async () => {
  const expected = {
    quotes: ["symbols", "start", "end", "limit", "feed", "sort"],
    trades: ["symbols", "start", "end", "limit", "feed", "sort"],
    bars: ["symbols", "start", "end", "limit", "feed", "sort", "timeframe", "adjustment"],
  };
  for (const kind of ["quotes", "trades", "bars"] as const) {
    const { result, transport, timer } = await successfulAttempt(kind);
    assert.equal(result.ok, true);
    assert.equal(transport.request?.method, "GET");
    assert.equal(transport.request?.origin, "https://data.alpaca.markets");
    assert.equal(transport.request?.path, ALPACA_ROUTE_REGISTRY[kind].path);
    assert.equal(transport.request?.redirect, "error");
    assert.deepEqual(
      transport.request?.query.map(([field]) => field),
      expected[kind],
    );
    assert.equal(transport.request?.query.find(([field]) => field === "feed")?.[1], "sip");
    assert.equal(transport.request?.query.find(([field]) => field === "sort")?.[1], "asc");
    assert.equal("authorizationHeaders" in (transport.request ?? {}), false);
    assert.equal(JSON.stringify(transport.request).includes("APCA-API"), false);
    assert.equal(timer.armedWith, 30_000);
  }
  assert.equal(unexpectedNetworkCalls, 0);
});

test("production boundary uses the minimum remaining acquisition budget and rejects exact exhaustion", async () => {
  const plan = validatedPlan();
  const exactCounters = counts();
  const exactTimer = new TimerDouble();
  const exact = await executeAlpacaAttempt({
    plan,
    page: firstPage(),
    authorizationHeaders: HEADERS,
    transport: new TransportDouble(exactCounters, response(new BodyDouble(exactCounters, []))),
    artifactSink: new SinkDouble(exactCounters),
    deadlineScheduler: exactTimer,
    acquisitionDeclaredMonotonicMs: 0,
    nowMonotonicMs: MARKET_ACQUISITION_LIMITS.acquisitionDeadlineMs,
  });
  assert.equal(exact.ok, false);
  assert.equal(exactCounters.transport, 0);
  assert.equal(exactTimer.armedWith, null);

  const oneCounters = counts();
  const oneTimer = new TimerDouble();
  const one = await executeAlpacaAttempt({
    plan,
    page: firstPage(),
    authorizationHeaders: HEADERS,
    transport: new TransportDouble(oneCounters, response(new BodyDouble(oneCounters, []))),
    artifactSink: new SinkDouble(oneCounters),
    deadlineScheduler: oneTimer,
    acquisitionDeclaredMonotonicMs: 0,
    nowMonotonicMs: MARKET_ACQUISITION_LIMITS.acquisitionDeadlineMs - 1,
  });
  assert.equal(one.ok, true);
  assert.equal(oneTimer.armedWith, 1);
});

test("caller and test-double sinks cannot attest atomic artifact ownership", async () => {
  const plan = validatedPlan();
  assert.throws(
    () => new RetentionOwnedAlpacaPageSink(new SinkDouble(counts()), ALLOW_ALL_RETENTION),
    /owned-alpaca-artifact-commit-sink-required/u,
  );
  assert.throws(
    () =>
      new RetentionOwnedAlpacaPageSink(
        createTestAlpacaArtifactCommitSink(new SinkDouble(counts())),
        ALLOW_ALL_RETENTION,
      ),
    /owned-artifact-retention-controller-required/u,
  );
  const credentialFixture = await credentialAuthorizationFixture(plan);
  let credentialReads = 0;
  const boundary = new AlpacaProductionAttemptBoundary(
    {
      read() {
        credentialReads += 1;
        return "unreachable";
      },
    },
    credentialFixture.authorization,
  );
  const counters = counts();
  const result = await boundary.execute({
    plan,
    credentialAuthorization: credentialFixture.request,
    page: firstPage(),
    transport: new TransportDouble(counters, response(new BodyDouble(counters, []))),
    artifactSink: new SinkDouble(counters) as never,
    deadlineScheduler: new TimerDouble().scheduler,
    acquisitionDeclaredMonotonicMs: 0,
    nowMonotonicMs: 0,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.reasonCode, "configuration-invalid");
  assert.equal(credentialReads, 0);
  assert.equal(counters.transport, 0);
});

test("15-minute equality dispatches and one nanosecond newer stops before transport", async () => {
  const equality = validateMarketAcquisitionConfiguration(configuration("quotes", BOUNDARY_NS));
  assert.equal(equality.ok, true);

  const tooNew = validateMarketAcquisitionConfiguration(configuration("quotes", BOUNDARY_NS + 1n));
  assert.equal(tooNew.ok, false);
  if (!tooNew.ok) assert.equal(tooNew.error.reasonCode, "historical-boundary-unprovable");
  assert.equal(unexpectedNetworkCalls, 0);
});

test("forged validated plans and unauthorized first-page continuation reject with zero dispatch", async () => {
  const plan = validatedPlan();
  const forged = Object.freeze({
    ...plan,
    requestIdentityHash: "0".repeat(64),
  }) as ValidatedMarketAcquisitionConfiguration;
  for (const [candidate, page] of [
    [forged, firstPage()],
    [plan, { kind: "verified-continuation", pageOrdinal: 1 } as AlpacaPageAuthority],
  ] as const) {
    const counters = counts();
    const body = new BodyDouble(counters, []);
    const result = await executeAlpacaAttempt({
      plan: candidate,
      page,
      authorizationHeaders: HEADERS,
      transport: new TransportDouble(counters, response(body)),
      artifactSink: new SinkDouble(counters),
      deadlineScheduler: new TimerDouble(),
    });
    assert.equal(result.ok, false);
    assert.equal(counters.transport, 0);
    assert.equal(counters.write, 0);
  }
});

test("all non-secret request, scheduler, and transport rejection precedes credential claim", async () => {
  const plan = validatedPlan();
  const invalidContinuation = {
    ...continuationPage(plan),
    currentTokenHash: "0".repeat(64),
  } as AlpacaPageAuthority;
  for (const rejection of ["continuation", "scheduler", "scheduler-handle", "transport"] as const) {
    const fixture = await credentialAuthorizationFixture(plan);
    const counters = counts();
    let credentialReads = 0;
    const rawTransport = new TransportDouble(counters, response(new BodyDouble(counters, [])));
    const isolatedTransport = createTestCredentialIsolatedAlpacaTransport({
      dispatch: (request) => rawTransport.dispatch(request),
      abort: () => rawTransport.abort(),
      settle: () => rawTransport.settle(),
    });
    const boundary = new AlpacaProductionAttemptBoundary(
      {
        read() {
          credentialReads += 1;
          return "must-not-be-read";
        },
      },
      fixture.authorization,
    );
    const result = await boundary.execute({
      plan,
      credentialAuthorization: fixture.request,
      page: rejection === "continuation" ? invalidContinuation : firstPage(),
      transport: rejection === "transport" ? rawTransport : isolatedTransport,
      artifactSink: createRetentionOwnedAlpacaPageSink(
        createTestAlpacaArtifactCommitSink(new SinkDouble(counters)),
        adapterRetention(),
      ),
      deadlineScheduler:
        rejection === "scheduler"
          ? ({ arm: null } as unknown as AlpacaDeadlineScheduler)
          : rejection === "scheduler-handle"
            ? ({ arm: () => Object.freeze({}) } as unknown as AlpacaDeadlineScheduler)
            : new TimerDouble().scheduler,
      acquisitionDeclaredMonotonicMs: 0,
      nowMonotonicMs: 0,
    });
    assert.equal(result.ok, false, rejection);
    assert.equal(credentialReads, 0, rejection);
    assert.equal(counters.transport, 0, rejection);
    const journal = await fixture.journal.load(fixture.request.marketAcquisitionJournalId);
    assert.equal(journal.at(-1)?.checkpointKind, "request-started", rejection);
  }
});

test("a hostile retained transport request contains no plaintext credential surface", async () => {
  const plan = validatedPlan();
  const fixture = await credentialAuthorizationFixture(plan);
  const counters = counts();
  let retained: AlpacaTransportRequest | null = null;
  const rawTransport = new TransportDouble(counters, response(new BodyDouble(counters, [])));
  const transport = createTestCredentialIsolatedAlpacaTransport({
    async dispatch(request) {
      retained = request;
      return rawTransport.dispatch(request);
    },
    abort: () => rawTransport.abort(),
    settle: () => rawTransport.settle(),
  });
  let reads = 0;
  const boundary = new AlpacaProductionAttemptBoundary(
    {
      read(name) {
        reads += 1;
        return name.endsWith("KEY_ID") ? "hostile-key-sentinel" : "hostile-secret-sentinel";
      },
    },
    fixture.authorization,
  );
  const result = await boundary.execute({
    plan,
    credentialAuthorization: fixture.request,
    page: firstPage(),
    transport,
    artifactSink: createRetentionOwnedAlpacaPageSink(
      createTestAlpacaArtifactCommitSink(new SinkDouble(counters)),
      adapterRetention(),
    ),
    deadlineScheduler: new TimerDouble().scheduler,
    acquisitionDeclaredMonotonicMs: 0,
    nowMonotonicMs: 0,
  });
  assert.equal(result.ok, true);
  assert.equal(reads, 2);
  assert.ok(retained !== null);
  assert.equal("authorizationHeaders" in retained, false);
  assert.equal(
    JSON.stringify(retained).includes("hostile-key-sentinel") ||
      JSON.stringify(retained).includes("hostile-secret-sentinel"),
    false,
  );
});

test("verified continuation binding adds one opaque page field and substitutions reject", async () => {
  const plan = validatedPlan();
  const validPage = continuationPage(plan);
  const valid = await successfulAttempt("quotes", validPage);
  assert.equal(valid.result.ok, true);
  assert.deepEqual(
    valid.transport.request?.query.map(([field]) => field),
    ["symbols", "start", "end", "limit", "page_token", "feed", "sort"],
  );

  const counters = counts();
  const body = new BodyDouble(counters, []);
  const substituted = {
    ...validPage,
    currentTokenHash: "0".repeat(64),
  } as AlpacaPageAuthority;
  const rejected = await executeAlpacaAttempt({
    plan,
    page: substituted,
    authorizationHeaders: HEADERS,
    transport: new TransportDouble(counters, response(body)),
    artifactSink: new SinkDouble(counters),
    deadlineScheduler: new TimerDouble(),
  });
  assert.equal(rejected.ok, false);
  assert.equal(counters.transport, 0);
});

test("HTTP retry classifications are sanitized and every response resource is cleaned", async () => {
  for (const [status, quota, expectedReason, laneDisabled] of [
    [408, "missing", "transport-failed", false],
    [429, "temporary-throttling-proved", "transport-failed", false],
    [429, "quota-exhausted", "quota-exhausted", false],
    [500, "missing", "transport-failed", false],
    [401, "missing", "lane-disabled", true],
    [403, "missing", "lane-disabled", true],
    [422, "missing", "http-nonretryable", false],
  ] as const) {
    const counters = counts();
    const body = new BodyDouble(counters, []);
    const sibling = new ResourceDouble(counters);
    const transport = new TransportDouble(
      counters,
      response(body, {
        status,
        quotaClassification: quota,
        siblingResources: [sibling],
      }),
    );
    const result = await executeAlpacaAttempt({
      plan: validatedPlan(),
      page: firstPage(),
      authorizationHeaders: HEADERS,
      transport,
      artifactSink: new SinkDouble(counters),
      deadlineScheduler: new TimerDouble(),
    });
    assert.equal(result.ok, false);
    if (result.ok) continue;
    assert.equal(result.error.reasonCode, expectedReason);
    assert.equal(result.laneDisabled, laneDisabled);
    assert.equal(result.resourcesSettled, true);
    assert.equal(counters.abort >= 3, true);
    assert.equal(counters.destroy >= 3, true);
  }
});

test("malformed or excessive Retry-After is terminal and never reaches retry control", async () => {
  for (const retryAfter of ["-1", "01", "Wed, 21 Oct 2015 07:28:00 GMT", "31"]) {
    const counters = counts();
    const body = new BodyDouble(counters, []);
    const result = await executeAlpacaAttempt({
      plan: validatedPlan(),
      page: firstPage(),
      authorizationHeaders: HEADERS,
      transport: new TransportDouble(
        counters,
        response(body, {
          status: 429,
          quotaClassification: "temporary-throttling-proved",
          retryAfter,
        }),
      ),
      artifactSink: new SinkDouble(counters),
      deadlineScheduler: new TimerDouble(),
    });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.equal(result.error.reasonCode, "retry-after-invalid");
      assert.equal(result.retryFailure.kind, "malformed-body");
    }
  }
});

test("declared and consumed body bounds plus length mismatch never complete a partial sink", async () => {
  const oneOver = MARKET_ACQUISITION_LIMITS.rawArtifactBytes + 1;
  for (const [declaredLength, chunks, expectedReason] of [
    [oneOver, [], "bound-exceeded"],
    [3, [Uint8Array.from([1, 2])], "response-length-mismatch"],
    [null, [new Uint8Array(oneOver)], "bound-exceeded"],
  ] as const) {
    const counters = counts();
    const body = new BodyDouble(counters, chunks);
    const result = await executeAlpacaAttempt({
      plan: validatedPlan(),
      page: firstPage(),
      authorizationHeaders: HEADERS,
      transport: new TransportDouble(counters, response(body, { contentLength: declaredLength })),
      artifactSink: new SinkDouble(counters),
      deadlineScheduler: new TimerDouble(),
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.reasonCode, expectedReason);
    assert.equal(counters.complete, 0);
  }
});

test("the exact raw-page byte limit succeeds and one byte over remains atomic", async () => {
  const counters = counts();
  const exact = MARKET_ACQUISITION_LIMITS.rawArtifactBytes;
  const body = new BodyDouble(counters, [new Uint8Array(exact)]);
  const result = await executeAlpacaAttempt({
    plan: validatedPlan(),
    page: firstPage(),
    authorizationHeaders: HEADERS,
    transport: new TransportDouble(counters, response(body, { contentLength: exact })),
    artifactSink: new SinkDouble(counters),
    deadlineScheduler: new TimerDouble(),
  });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.consumedBytes, exact);
});

test("sink failure destroys partial body and sibling resources without completing", async () => {
  const counters = counts();
  const body = new BodyDouble(counters, [Uint8Array.from([1, 2, 3])]);
  const sibling = new ResourceDouble(counters);
  const result = await executeAlpacaAttempt({
    plan: validatedPlan(),
    page: firstPage(),
    authorizationHeaders: HEADERS,
    transport: new TransportDouble(counters, response(body, { siblingResources: [sibling] })),
    artifactSink: new SinkDouble(counters, true),
    deadlineScheduler: new TimerDouble(),
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.reasonCode, "artifact-store-failed");
    assert.equal(result.resourcesSettled, true);
  }
  assert.equal(counters.complete, 0);
  assert.equal(counters.abort >= 4, true);
  assert.equal(counters.destroy >= 3, true);
});

test("timeout before headers aborts and settles the dispatched operation before return", async () => {
  const counters = counts();
  const timer = new TimerDouble();
  const promise = executeAlpacaAttempt({
    plan: validatedPlan(),
    page: firstPage(),
    authorizationHeaders: HEADERS,
    transport: new HangingTransport(counters),
    artifactSink: new SinkDouble(counters),
    deadlineScheduler: timer,
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  timer.expire();
  const result = await promise;
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.reasonCode, "attempt-timeout");
    assert.equal(result.error.operationStage, "dispatch");
    assert.equal(result.resourcesSettled, true);
  }
  const snapshot = { ...counters };
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(counters, snapshot);
});

test("active-body timeout aborts, destroys, settles, and has no post-return activity", async () => {
  const counters = counts();
  const body = new BodyDouble(counters, [Uint8Array.from([1])], true);
  const sibling = new ResourceDouble(counters);
  const transport = new TransportDouble(counters, response(body, { siblingResources: [sibling] }));
  const timer = new TimerDouble();
  const promise = executeAlpacaAttempt({
    plan: validatedPlan(),
    page: firstPage(),
    authorizationHeaders: HEADERS,
    transport,
    artifactSink: new SinkDouble(counters),
    deadlineScheduler: timer,
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  timer.expire();
  const result = await promise;
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.reasonCode, "attempt-timeout");
    assert.equal(result.resourcesSettled, true);
  }
  const snapshot = { ...counters, timerCancelled: timer.cancelled, timerSettled: timer.settled };
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(
    { ...counters, timerCancelled: timer.cancelled, timerSettled: timer.settled },
    snapshot,
  );
  assert.equal(counters.complete, 0);
  assert.equal(unexpectedNetworkCalls, 0);
});

test("successful verified-page completion settles every resource before return", async () => {
  const { result, counters, sink, timer } = await successfulAttempt();
  assert.deepEqual(result, {
    ok: true,
    artifact: "verified:3",
    status: 200,
    declaredContentLength: 3,
    consumedBytes: 3,
    resourcesSettled: true,
  });
  assert.equal(sink.bytes, 3);
  assert.equal(counters.complete, 1);
  assert.equal(timer.cancelled, 1);
  assert.equal(timer.settled, 1);
  const snapshot = { ...counters };
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(counters, snapshot);
});

test("timer cancellation precedes settlement on success, failure, and deadline paths", async () => {
  const successCounters = counts();
  const successTimer = new CancelDependentTimer();
  const success = await executeAlpacaAttempt({
    plan: validatedPlan(),
    page: firstPage(),
    authorizationHeaders: HEADERS,
    transport: new TransportDouble(successCounters, response(new BodyDouble(successCounters, []))),
    artifactSink: new SinkDouble(successCounters),
    deadlineScheduler: successTimer,
  });
  assert.equal(success.ok, true);
  assert.deepEqual([successTimer.cancelled, successTimer.settled], [1, 1]);

  const failureCounters = counts();
  const failureTimer = new CancelDependentTimer();
  const failure = await executeAlpacaAttempt({
    plan: validatedPlan(),
    page: firstPage(),
    authorizationHeaders: HEADERS,
    transport: new TransportDouble(
      failureCounters,
      response(new BodyDouble(failureCounters, []), { status: 500 }),
    ),
    artifactSink: new SinkDouble(failureCounters),
    deadlineScheduler: failureTimer,
  });
  assert.equal(failure.ok, false);
  if (!failure.ok) assert.equal(failure.resourcesSettled, true);
  assert.deepEqual([failureTimer.cancelled, failureTimer.settled], [1, 1]);

  const deadlineCounters = counts();
  const deadlineTimer = new CancelDependentTimer();
  const pending = executeAlpacaAttempt({
    plan: validatedPlan(),
    page: firstPage(),
    authorizationHeaders: HEADERS,
    transport: new HangingTransport(deadlineCounters),
    artifactSink: new SinkDouble(deadlineCounters),
    deadlineScheduler: deadlineTimer,
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  deadlineTimer.expire();
  const deadline = await pending;
  assert.equal(deadline.ok, false);
  if (!deadline.ok) assert.equal(deadline.resourcesSettled, true);
  assert.deepEqual([deadlineTimer.cancelled, deadlineTimer.settled], [1, 1]);
});

test("pending-forever body, sibling, sink, transport, abort, and destroy cannot exceed the absolute attempt deadline", async () => {
  for (const component of ["body", "sibling", "sink", "transport"] as const) {
    const counters = counts();
    const timer = new TimerDouble();
    const body =
      component === "body" ? new PendingCleanupBody(counters, []) : new BodyDouble(counters, []);
    const sibling =
      component === "sibling" ? new PendingCleanupResource(counters) : new ResourceDouble(counters);
    const value = response(body, {
      status: 500,
      siblingResources: [sibling],
    });
    const transport =
      component === "transport"
        ? new PendingCleanupTransport(counters, value)
        : new TransportDouble(counters, value);
    const sink = component === "sink" ? new PendingCleanupSink(counters) : new SinkDouble(counters);
    const pending = executeAlpacaAttempt({
      plan: validatedPlan(),
      page: firstPage(),
      authorizationHeaders: HEADERS,
      transport,
      artifactSink: sink,
      deadlineScheduler: timer,
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    timer.expire();
    const result = await pending;
    assert.equal(result.ok, false, component);
    if (!result.ok) assert.equal(result.resourcesSettled, false, component);
  }
});
