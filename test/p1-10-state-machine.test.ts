import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import { canonicalJson, type JsonValue } from "../src/core/json.js";
import {
  GENESIS_HASH,
  NO_TOKEN_HASH,
  TERMINAL_TOKEN_HASH,
  type JournalCheckpointBody,
  createJournalEntry,
  deriveAttemptControlIdentities,
  deriveContinuationBindingHash,
  deriveLogicalPageIdentityHash,
  deriveMarketAcquisitionJournalId,
  derivePrivateTokenHash,
  framedHash,
  planPageAdmission,
  validateContinuationAuthority,
  validateJournalEntries,
} from "../src/adapters/market-acquisition/journal.js";
import {
  ACQUISITION_DEADLINE_MS,
  ATTEMPT_DEADLINE_MS,
  evaluateRollingQuota,
  retryFitsAcquisitionDeadline,
  validateDeadlineProof,
} from "../src/adapters/market-acquisition/quota.js";
import {
  MAX_ATTEMPTS_PER_ACQUISITION,
  MAX_ATTEMPTS_PER_PAGE,
  decideRetry,
  parseRetryAfterMs,
  validateRetryDelayProof,
} from "../src/adapters/market-acquisition/retry.js";
import {
  ACQUISITION_STATES,
  ACQUISITION_TRANSITIONS,
  AcquisitionStateMachine,
  type AcquisitionEvent,
  type AcquisitionEventProof,
  type AcquisitionMachineSnapshot,
  createInitialAcquisitionSnapshot,
} from "../src/adapters/market-acquisition/state-machine.js";

const hex = (member: string): string => framedHash("peas/p1-10-state-machine-test/v1", { member });
const prefixed = (prefix: string, member: string): string => `${prefix}${hex(member)}`;

const REQUEST_HASH = hex("request");
const CONFIGURATION_HASH = hex("configuration");
const JOURNAL_ID = hex("journal");
const RUN_NONCE = "offline-run-session-v1";

function initialSnapshot(): AcquisitionMachineSnapshot {
  return createInitialAcquisitionSnapshot({
    requestIdentityHash: REQUEST_HASH,
    acquisitionConfigurationHash: CONFIGURATION_HASH,
    marketAcquisitionJournalId: JOURNAL_ID,
    runSessionNonce: RUN_NONCE,
    acquisitionDeclaredMonotonicMs: 0,
  });
}

test("production artifacts reject no-op persistence, arbitrary wire roots, and prototype mutation", () => {
  const script = `
    import { AcquisitionStateMachine, createInitialAcquisitionSnapshot, openOwnedAcquisitionStateMachine } from './dist/production/src/adapters/market-acquisition/state-machine.js';
    import { openSqliteDurableAlpacaWireAdmissionBoundary, DurableAlpacaWireAdmissionBoundary, resolveAlpacaHistoricalChain } from './dist/production/src/adapters/market-acquisition/alpaca/wire.js';
    import { openSqliteDurableAlpacaWireSemanticEvidenceBoundary, DurableAlpacaWireSemanticEvidenceBoundary } from './dist/production/src/adapters/market-acquisition/alpaca/wire-semantic-evidence.js';
    import { DurableCredentialAuthorizationBoundary } from './dist/production/src/adapters/market-acquisition/credentials.js';
    import { openSqliteDatabase } from './dist/production/src/adapters/sqlite/database.js';
    import { createSqliteAcquisitionJournal } from './dist/production/src/adapters/market-acquisition/sqlite-journal.js';
    import { decideAcquisitionRestart, persistVerifiedAcquisitionWorkflowEvidence } from './dist/production/src/adapters/market-acquisition/artifact-integration.js';
    const snapshot = createInitialAcquisitionSnapshot({
      requestIdentityHash: '1'.repeat(64), acquisitionConfigurationHash: '2'.repeat(64),
      marketAcquisitionJournalId: '3'.repeat(64), runSessionNonce: 'offline-owned-run',
      acquisitionDeclaredMonotonicMs: 0,
    });
    const outcomes = [];
    try { new AcquisitionStateMachine(snapshot, async () => {}); outcomes.push('noop-accepted'); }
    catch (error) { outcomes.push(error.message); }
    try { openOwnedAcquisitionStateMachine({}); outcomes.push('owned-state-opened'); }
    catch (error) { outcomes.push(error.message); }
    try { await persistVerifiedAcquisitionWorkflowEvidence({}); outcomes.push('workflow-arrays-accepted'); }
    catch (error) { outcomes.push(error.message); }
    try { openSqliteDurableAlpacaWireAdmissionBoundary('caller.sqlite', [], {}, {}); outcomes.push('wire-root-accepted'); }
    catch (error) { outcomes.push(error.message); }
    try { openSqliteDurableAlpacaWireSemanticEvidenceBoundary('caller.sqlite', [], {}, {}); outcomes.push('semantic-root-accepted'); }
    catch (error) { outcomes.push(error.message); }
    const database = openSqliteDatabase(':memory:', []);
    const journal = createSqliteAcquisitionJournal(database, { schemaVersion: 1, requestIdentityHash: '1'.repeat(64), providerId: 'mpv1_' + '2'.repeat(64), datasetId: 'mds1_' + '3'.repeat(64), feedId: 'mfd1_' + '4'.repeat(64), endpointChannelId: 'mec1_' + '5'.repeat(64) });
    try { await journal.claimAttemptStarted('6'.repeat(64), {}); outcomes.push('claim-accepted'); }
    catch (error) { outcomes.push(error.message); }
    try { resolveAlpacaHistoricalChain('bars', [], { journal: [], expectedIdentity: {} }); outcomes.push('structural-chain-accepted'); }
    catch (error) { outcomes.push(error.code ?? error.message); }
    try { await decideAcquisitionRestart({ journal: {}, journalId: '1'.repeat(64), expectedIdentity: {}, expectedConfigurationHash: '2'.repeat(64), artifactStore: {} }); outcomes.push('structural-restart-accepted'); }
    catch (error) { outcomes.push(error.message); }
    database.close();
    for (const prototype of [AcquisitionStateMachine.prototype, DurableAlpacaWireAdmissionBoundary.prototype, DurableAlpacaWireSemanticEvidenceBoundary.prototype, DurableCredentialAuthorizationBoundary.prototype]) {
      try { Object.defineProperty(prototype, 'forged', { value() {} }); outcomes.push('prototype-mutable'); }
      catch { outcomes.push(Object.isFrozen(prototype) ? 'prototype-frozen' : 'prototype-not-frozen'); }
    }
    process.stdout.write(JSON.stringify(outcomes));
  `;
  const child = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), [
    "owned-acquisition-durable-persistence-required",
    "owned-acquisition-state-test-composition-unavailable",
    "verified-workflow-test-composition-unavailable",
    "arbitrary-wire-admission-root-unavailable",
    "arbitrary-wire-semantic-root-unavailable",
    "owned-attempt-claim-required",
    "page-chain-incomplete",
    "owned-acquisition-journal-required",
    "prototype-frozen",
    "prototype-frozen",
    "prototype-frozen",
    "prototype-frozen",
  ]);
});

function proof(
  machine: AcquisitionStateMachine,
  nowMonotonicMs: number,
  resourcesSettled = true,
): AcquisitionEventProof {
  return {
    requestIdentityHash: machine.snapshot.requestIdentityHash,
    acquisitionConfigurationHash: machine.snapshot.acquisitionConfigurationHash,
    marketAcquisitionJournalId: machine.snapshot.marketAcquisitionJournalId,
    runSessionNonce: machine.snapshot.runSessionNonce,
    nowMonotonicMs,
    resourcesSettled,
  };
}

async function advanceToActive(machine: AcquisitionStateMachine, startMs = 1_000): Promise<void> {
  await machine.applyAcquisitionEvent({ kind: "begin-preflight", proof: proof(machine, 0) });
  await machine.applyAcquisitionEvent({ kind: "preflight-approved", proof: proof(machine, 0) });
  await machine.applyAcquisitionEvent({ kind: "credentials-loaded", proof: proof(machine, 0) });
  await machine.applyAcquisitionEvent({
    kind: "dispatch-started",
    proof: proof(machine, startMs, false),
    entitlementQuotaLimit: 30,
    deadlineProof: {
      acquisitionDeclaredMonotonicMs: 0,
      attemptStartedMonotonicMs: startMs,
      nowMonotonicMs: startMs,
    },
  });
}

function currentPageChainInput(machine: AcquisitionStateMachine, sizeBytes = 13) {
  const snapshot = machine.snapshot;
  return {
    priorPageChainHash: snapshot.pageChainHash,
    marketAcquisitionId: prefixed("maq1_", `market-acquisition-${snapshot.pageOrdinal}`),
    requestIdentityHash: snapshot.requestIdentityHash,
    logicalPageIdentityHash: snapshot.logicalPageIdentityHash,
    pageOrdinal: snapshot.pageOrdinal,
    artifactObservationId: hex(`artifact-observation-${snapshot.pageOrdinal}`),
    artifactDigest: hex(`artifact-digest-${snapshot.pageOrdinal}`),
    artifactSizeBytes: sizeBytes,
    artifactObservationHash: hex(`artifact-observation-hash-${snapshot.pageOrdinal}`),
    artifactContentId: prefixed("mac1_", `content-${snapshot.pageOrdinal}`),
    rawArtifactId: prefixed("mar1_", `raw-${snapshot.pageOrdinal}`),
    currentTokenHash: snapshot.currentTokenHash,
    pageRecordCount: 2,
    cumulativeSuccessfulPages: snapshot.budgets.successfulPages + 1,
    cumulativeVerifiedBytes: snapshot.budgets.verifiedBytes + sizeBytes,
    cumulativeRecords: snapshot.budgets.records + 2,
    cumulativeNormalizedFacts: 0,
    cumulativeAttempts: snapshot.budgets.attempts,
  } as const;
}

test("event and transition evidence are synchronously snapshotted before durable await", async () => {
  const initial = createInitialAcquisitionSnapshot({
    requestIdentityHash: "1".repeat(64),
    acquisitionConfigurationHash: "2".repeat(64),
    marketAcquisitionJournalId: hex("async-event-snapshot"),
    runSessionNonce: "async-event-snapshot-run",
    acquisitionDeclaredMonotonicMs: 0,
  });
  let release!: () => void;
  let entered!: () => void;
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  const persistenceEntered = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let persistedEvent: AcquisitionEvent | undefined;
  const machine = new AcquisitionStateMachine(initial, async (_plan, event) => {
    persistedEvent = event;
    entered();
    await paused;
  });
  const event = {
    kind: "begin-preflight" as const,
    proof: { ...proof(machine, 0) },
  };
  const pending = machine.applyAcquisitionEvent(event);
  await persistenceEntered;
  event.proof.requestIdentityHash = "f".repeat(64);
  event.proof.runSessionNonce = "mutated-after-call";
  release();
  await pending;
  assert.equal(persistedEvent?.proof.requestIdentityHash, initial.requestIdentityHash);
  assert.equal(persistedEvent?.proof.runSessionNonce, initial.runSessionNonce);
  assert.equal(machine.snapshot.currentState, "preflighting");
});

test("the accepted state vocabulary and transition graph are exact and closed", () => {
  assert.equal(ACQUISITION_STATES.length, 20);
  assert.deepEqual(ACQUISITION_TRANSITIONS, {
    declared: ["preflighting"],
    preflighting: ["dispatch-ready", "stopped", "failed-clean"],
    "dispatch-ready": ["credential-ready", "stopped"],
    "credential-ready": ["attempt-active"],
    "attempt-active": ["waiting-retry", "response-accepted", "stopped", "failed-clean"],
    "response-accepted": ["artifact-committing", "failed-clean"],
    "artifact-committing": ["artifact-committed", "failed-clean"],
    "artifact-committed": ["artifact-verifying"],
    "artifact-verifying": ["page-verified", "failed-clean", "quarantined"],
    "page-verified": ["checkpointing"],
    checkpointing: ["chain-complete", "preflighting", "failed-clean"],
    "waiting-retry": ["preflighting", "stopped"],
    "chain-complete": ["normalizing"],
    normalizing: ["ready-for-selection", "quarantined", "failed-clean"],
    "ready-for-selection": ["selecting"],
    selecting: ["completed", "failed-clean", "quarantined"],
    completed: [],
    stopped: [],
    "failed-clean": [],
    quarantined: [],
  });
  for (const state of ACQUISITION_STATES) {
    assert.equal(
      new Set(ACQUISITION_TRANSITIONS[state]).size,
      ACQUISITION_TRANSITIONS[state].length,
    );
  }
});

test("the integrated reducer completes one page and persists each plan before mutation", async () => {
  const persisted: string[] = [];
  const machine = new AcquisitionStateMachine(initialSnapshot(), async (plan) => {
    persisted.push(`${plan.fromState}->${plan.toState}:${plan.checkpointKind ?? "none"}`);
  });
  await advanceToActive(machine);
  const attemptId = machine.snapshot.attemptId;
  assert.match(attemptId ?? "", /^mat1_[0-9a-f]{64}$/u);
  assert.match(machine.snapshot.retrievalAttemptId ?? "", /^rat1_[0-9a-f]{64}$/u);

  await machine.applyAcquisitionEvent({ kind: "response-accepted", proof: proof(machine, 1_001) });
  await machine.applyAcquisitionEvent({
    kind: "artifact-store-started",
    proof: proof(machine, 1_002, false),
  });
  await machine.applyAcquisitionEvent({
    kind: "artifact-store-committed",
    proof: proof(machine, 1_003),
  });
  await machine.applyAcquisitionEvent({
    kind: "artifact-verification-started",
    proof: proof(machine, 1_004),
  });
  await machine.applyAcquisitionEvent({ kind: "page-verified", proof: proof(machine, 1_005) });
  await machine.applyAcquisitionEvent({
    kind: "page-checkpointed",
    proof: proof(machine, 1_006),
    pageChainInput: currentPageChainInput(machine),
    nextTokenMaterial: null,
  });
  assert.equal(machine.snapshot.budgets.successfulPages, 1);
  assert.equal(machine.snapshot.continuationAuthority, null);
  await machine.applyAcquisitionEvent({
    kind: "terminal-page-admitted",
    proof: proof(machine, 1_007),
  });
  await machine.applyAcquisitionEvent({
    kind: "normalization-started",
    proof: proof(machine, 1_008),
  });
  await machine.applyAcquisitionEvent({
    kind: "normalization-completed",
    proof: proof(machine, 1_009),
    normalizedFactCount: 2,
  });
  await machine.applyAcquisitionEvent({ kind: "selection-started", proof: proof(machine, 1_010) });
  await machine.applyAcquisitionEvent({
    kind: "selection-completed",
    proof: proof(machine, 1_011),
  });
  assert.equal(machine.snapshot.currentState, "completed");
  assert.equal(machine.snapshot.terminalReason, null);
  assert.equal(persisted.at(0), "declared->preflighting:acquisition-declared");
  assert.equal(persisted.at(-1), "selecting->completed:completed");
});

test("rejected evidence and failed durable append are byte-atomic", async () => {
  assert.throws(
    () => new AcquisitionStateMachine(initialSnapshot(), undefined as never),
    /durable-persistence-required/u,
  );
  const machine = new AcquisitionStateMachine(initialSnapshot(), async () => {});
  const before = canonicalJson(machine.snapshot as unknown as JsonValue);
  await assert.rejects(
    () =>
      machine.applyAcquisitionEvent({
        kind: "preflight-approved",
        proof: proof(machine, 0),
      }),
    /acquisition-transition-invalid/u,
  );
  assert.equal(canonicalJson(machine.snapshot as unknown as JsonValue), before);

  const persistFailure = new AcquisitionStateMachine(initialSnapshot(), async () => {
    throw new Error("synthetic-journal-failure");
  });
  await assert.rejects(
    () =>
      persistFailure.applyAcquisitionEvent({
        kind: "begin-preflight",
        proof: proof(persistFailure, 0),
      }),
    /synthetic-journal-failure/u,
  );
  assert.equal(persistFailure.snapshot.currentState, "declared");
  assert.equal(persistFailure.snapshot.budgets.attempts, 0);
});

test("retry policy is closed across status, Retry-After, identity, and budget cases", () => {
  for (const status of [408, 500, 502, 503, 504]) {
    assert.deepEqual(
      decideRetry({
        failure: {
          kind: "http",
          status,
          quotaClassification: "missing",
          retryAfter: null,
        },
        pageAttemptsStarted: 1,
        acquisitionAttemptsStarted: 1,
      }),
      { kind: "retry", delayMs: 1_000, retryOrdinal: 1 },
    );
  }
  for (const status of [400, 404, 409, 422, 418]) {
    assert.equal(
      decideRetry({
        failure: {
          kind: "http",
          status,
          quotaClassification: "missing",
          retryAfter: null,
        },
        pageAttemptsStarted: 1,
        acquisitionAttemptsStarted: 1,
      }).kind,
      "stop",
    );
  }
  for (const status of [401, 403]) {
    assert.deepEqual(
      decideRetry({
        failure: {
          kind: "http",
          status,
          quotaClassification: "missing",
          retryAfter: null,
        },
        pageAttemptsStarted: 1,
        acquisitionAttemptsStarted: 1,
      }),
      { kind: "stop", reason: "lane-disabled" },
    );
  }
  assert.deepEqual(
    decideRetry({
      failure: {
        kind: "http",
        status: 429,
        quotaClassification: "temporary-throttling-proved",
        retryAfter: "30",
      },
      pageAttemptsStarted: 1,
      acquisitionAttemptsStarted: 1,
    }),
    { kind: "retry", delayMs: 30_000, retryOrdinal: 1 },
  );
  for (const invalid of ["-1", "01", "1.5", " 1", "Wed, 21 Oct 2015 07:28:00 GMT", "31"]) {
    assert.throws(() => parseRetryAfterMs(invalid), /retry-after-invalid/u);
  }
  assert.equal(parseRetryAfterMs(null), null);
  assert.equal(parseRetryAfterMs("30"), 30_000);
  assert.deepEqual(
    decideRetry({
      failure: { kind: "schema" },
      pageAttemptsStarted: 1,
      acquisitionAttemptsStarted: 1,
    }),
    { kind: "stop", reason: "non-retryable" },
  );
  assert.equal(
    decideRetry({
      failure: { kind: "pre-response-transport" },
      pageAttemptsStarted: MAX_ATTEMPTS_PER_PAGE,
      acquisitionAttemptsStarted: 3,
    }).kind,
    "stop",
  );
  assert.equal(
    decideRetry({
      failure: { kind: "pre-response-transport" },
      pageAttemptsStarted: 1,
      acquisitionAttemptsStarted: MAX_ATTEMPTS_PER_ACQUISITION,
    }).kind,
    "stop",
  );
});

test("retry keeps a logical page stable and creates a fresh physical attempt", async () => {
  const machine = new AcquisitionStateMachine(initialSnapshot(), async () => {});
  await advanceToActive(machine);
  const logicalPage = machine.snapshot.logicalPageIdentityHash;
  const firstAttempt = machine.snapshot.attemptId;
  await machine.applyAcquisitionEvent({
    kind: "retry-cleanup-complete",
    proof: proof(machine, 1_100),
    context: {
      failure: { kind: "pre-response-transport" },
      pageAttemptsStarted: 1,
      acquisitionAttemptsStarted: 1,
    },
  });
  assert.equal(machine.snapshot.pendingRetryDelayMs, 1_000);
  const beforeEarly = canonicalJson(machine.snapshot as unknown as JsonValue);
  await assert.rejects(
    () =>
      machine.applyAcquisitionEvent({
        kind: "retry-delay-elapsed",
        proof: proof(machine, 2_100),
        delayProof: {
          clockBasis: "same-session-monotonic",
          elapsedMs: 999,
          monotonicOrderValid: true,
        },
      }),
    /retry-delay-proof-invalid/u,
  );
  assert.equal(canonicalJson(machine.snapshot as unknown as JsonValue), beforeEarly);
  await machine.applyAcquisitionEvent({
    kind: "retry-delay-elapsed",
    proof: proof(machine, 2_100),
    delayProof: {
      clockBasis: "same-session-monotonic",
      elapsedMs: 1_000,
      monotonicOrderValid: true,
    },
  });
  const retryPreflight = await machine.applyAcquisitionEvent({
    kind: "preflight-approved",
    proof: proof(machine, 2_100),
  });
  assert.equal(retryPreflight.checkpointKind, null);
  await machine.applyAcquisitionEvent({
    kind: "credentials-loaded",
    proof: proof(machine, 2_100),
  });
  await machine.applyAcquisitionEvent({
    kind: "dispatch-started",
    proof: proof(machine, 2_101, false),
    entitlementQuotaLimit: 30,
    deadlineProof: {
      acquisitionDeclaredMonotonicMs: 0,
      attemptStartedMonotonicMs: 2_101,
      nowMonotonicMs: 2_101,
    },
  });
  assert.equal(machine.snapshot.logicalPageIdentityHash, logicalPage);
  assert.notEqual(machine.snapshot.attemptId, firstAttempt);
  assert.equal(machine.snapshot.attemptOrdinal, 1);
});

test("production retry transition refuses to wait when a full next attempt cannot fit", async () => {
  const machine = new AcquisitionStateMachine(initialSnapshot(), async () => {});
  await advanceToActive(machine);
  await assert.rejects(
    () =>
      machine.applyAcquisitionEvent({
        kind: "retry-cleanup-complete",
        proof: proof(machine, ACQUISITION_DEADLINE_MS - ATTEMPT_DEADLINE_MS + 1),
        context: {
          failure: { kind: "pre-response-transport" },
          pageAttemptsStarted: 1,
          acquisitionAttemptsStarted: 1,
        },
      }),
    /retry-acquisition-deadline/u,
  );
});

test("rolling quota and deadline proofs preserve exact boundaries", () => {
  const thirtyStarts = Array.from({ length: 30 }, (_, index) => index);
  assert.equal(evaluateRollingQuota(thirtyStarts, 59_999, 30, 300_000).kind, "wait");
  const boundary = evaluateRollingQuota(thirtyStarts, 60_000, 30, 300_000);
  assert.equal(boundary.kind, "admit");
  assert.equal(evaluateRollingQuota([0], 1, 1, 59_999).kind, "stop");
  assert.doesNotThrow(() =>
    validateDeadlineProof({
      acquisitionDeclaredMonotonicMs: 0,
      attemptStartedMonotonicMs: 270_000,
      nowMonotonicMs: 300_000,
    }),
  );
  assert.throws(
    () =>
      validateDeadlineProof({
        acquisitionDeclaredMonotonicMs: 0,
        attemptStartedMonotonicMs: 270_000,
        nowMonotonicMs: 300_001,
      }),
    /attempt-timeout/u,
  );
  assert.equal(retryFitsAcquisitionDeadline(269_000, 1_000, 0), true);
  assert.equal(retryFitsAcquisitionDeadline(269_001, 1_000, 0), false);
  assert.equal(ATTEMPT_DEADLINE_MS, 30_000);
  assert.equal(ACQUISITION_DEADLINE_MS, 300_000);
  assert.doesNotThrow(() =>
    validateRetryDelayProof(2_000, {
      clockBasis: "same-session-monotonic",
      elapsedMs: 2_000,
      monotonicOrderValid: true,
    }),
  );
});

test("token, page-chain, and continuation bindings are acyclic and one-use", () => {
  const logicalPageIdentityHash = deriveLogicalPageIdentityHash({
    requestIdentityHash: REQUEST_HASH,
    pageOrdinal: 0,
    currentTokenHash: NO_TOKEN_HASH,
  });
  const input = {
    priorPageChainHash: GENESIS_HASH,
    marketAcquisitionId: prefixed("maq1_", "page-zero"),
    requestIdentityHash: REQUEST_HASH,
    logicalPageIdentityHash,
    pageOrdinal: 0,
    artifactObservationId: hex("artifact-observation"),
    artifactDigest: hex("artifact-digest"),
    artifactSizeBytes: 10,
    artifactObservationHash: hex("artifact-observation-hash"),
    artifactContentId: prefixed("mac1_", "content"),
    rawArtifactId: prefixed("mar1_", "raw"),
    currentTokenHash: NO_TOKEN_HASH,
    pageRecordCount: 2,
    cumulativeSuccessfulPages: 1,
    cumulativeVerifiedBytes: 10,
    cumulativeRecords: 2,
    cumulativeNormalizedFacts: 0,
    cumulativeAttempts: 1,
  } as const;
  const admission = planPageAdmission(input, "opaque-synthetic-continuation");
  assert.match(admission.pageChainHash, /^[0-9a-f]{64}$/u);
  assert.notEqual(admission.nextTokenHash, TERMINAL_TOKEN_HASH);
  assert.match(admission.nextContinuationBindingHash ?? "", /^[0-9a-f]{64}$/u);
  const preceding = {
    marketAcquisitionId: input.marketAcquisitionId,
    requestIdentityHash: input.requestIdentityHash,
    logicalPageIdentityHash: input.logicalPageIdentityHash,
    pageOrdinal: 0,
    artifactObservationId: input.artifactObservationId,
    artifactDigest: input.artifactDigest,
    pageChainHash: admission.pageChainHash,
    nextTokenHash: admission.nextTokenHash,
    nextContinuationBindingHash: admission.nextContinuationBindingHash as string,
  };
  const next = {
    requestIdentityHash: REQUEST_HASH,
    pageOrdinal: 1,
    tokenMaterial: "opaque-synthetic-continuation",
    currentTokenHash: admission.nextTokenHash,
    currentContinuationBindingHash: admission.nextContinuationBindingHash as string,
  };
  assert.doesNotThrow(() => validateContinuationAuthority(preceding, next, new Set()));
  assert.throws(
    () => validateContinuationAuthority(preceding, next, new Set([admission.nextTokenHash])),
    /continuation-token-invalid/u,
  );
  assert.throws(
    () => validateContinuationAuthority(preceding, { ...next, pageOrdinal: 2 }, new Set()),
    /continuation-page-gap/u,
  );
  assert.throws(() => derivePrivateTokenHash("x".repeat(4_097)), /private-token-invalid/u);
  assert.equal(
    deriveContinuationBindingHash({
      precedingMarketAcquisitionId: input.marketAcquisitionId,
      requestIdentityHash: input.requestIdentityHash,
      precedingLogicalPageIdentityHash: input.logicalPageIdentityHash,
      precedingPageOrdinal: 0,
      precedingArtifactObservationId: input.artifactObservationId,
      precedingArtifactDigest: input.artifactDigest,
      precedingPageChainHash: admission.pageChainHash,
      nextPageOrdinal: 1,
      nextTokenHash: admission.nextTokenHash,
    }),
    admission.nextContinuationBindingHash,
  );
});

function journalBody(
  terminalState: JournalCheckpointBody["terminalState"] = null,
): JournalCheckpointBody {
  return {
    schemaVersion: 1,
    runSessionNonce: RUN_NONCE,
    acquisitionObservationId: prefixed("aob1_", "acquisition-observation"),
    marketAcquisitionId: prefixed("maq1_", "market-acquisition"),
    admittedMarketAcquisitionIds: [],
    requestIdentityHash: REQUEST_HASH,
    acquisitionConfigurationHash: CONFIGURATION_HASH,
    providerId: prefixed("mpv1_", "provider"),
    datasetId: prefixed("mds1_", "dataset"),
    feedId: prefixed("mfd1_", "feed"),
    endpointChannelId: prefixed("mec1_", "channel"),
    authorizationMode: "p1-09-approved",
    logicalPageIdentityHash: deriveLogicalPageIdentityHash({
      requestIdentityHash: REQUEST_HASH,
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
    attemptId: prefixed("mat1_", "attempt"),
    retrievalAttemptId: prefixed("rat1_", "attempt"),
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
    acquisitionDeadlineBasis: "synthetic-monotonic-basis-v1",
    quotaWindowEvidence: [],
    terminalState,
    terminalReasonCode: terminalState === null ? null : "operator-stop",
    incomplete: terminalState === null,
  };
}

test("journal entries use exact domains, canonical bodies, and contiguous hash chains", () => {
  const identity = {
    schemaVersion: 1,
    requestIdentityHash: REQUEST_HASH,
    providerId: prefixed("mpv1_", "provider"),
    datasetId: prefixed("mds1_", "dataset"),
    feedId: prefixed("mfd1_", "feed"),
    endpointChannelId: prefixed("mec1_", "channel"),
  } as const;
  const journalId = deriveMarketAcquisitionJournalId(identity);
  const declared = createJournalEntry(null, journalId, "acquisition-declared", journalBody());
  const stopped = createJournalEntry(declared, journalId, "stopped", journalBody("stopped"));
  assert.doesNotThrow(() => validateJournalEntries([declared, stopped], identity));
  assert.equal(declared.journalSequence, 0);
  assert.equal(declared.priorJournalEntryHash, GENESIS_HASH);
  assert.equal(stopped.priorJournalEntryHash, declared.journalEntryHash);
  assert.throws(
    () =>
      validateJournalEntries([{ ...declared, journalEntryHash: hex("forged") }, stopped], identity),
    /journal-hash-chain-invalid/u,
  );
  assert.throws(() => validateJournalEntries([declared, stopped, stopped], identity), /journal-/u);
});

test("attempt identities bind logical page, ordinal, and run session", () => {
  const logicalPageIdentityHash = deriveLogicalPageIdentityHash({
    requestIdentityHash: REQUEST_HASH,
    pageOrdinal: 0,
    currentTokenHash: NO_TOKEN_HASH,
  });
  const first = deriveAttemptControlIdentities({
    logicalPageIdentityHash,
    attemptOrdinal: 0,
    runSessionNonce: RUN_NONCE,
  });
  const retry = deriveAttemptControlIdentities({
    logicalPageIdentityHash,
    attemptOrdinal: 1,
    runSessionNonce: RUN_NONCE,
  });
  assert.notEqual(first.attemptId, retry.attemptId);
  assert.equal(first.attemptId.slice(5), first.retrievalAttemptId.slice(5));
  assert.equal(retry.attemptId.slice(5), retry.retrievalAttemptId.slice(5));
});
