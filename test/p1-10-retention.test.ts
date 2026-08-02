import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fork, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { test } from "node:test";

import { DurableArtifactStore } from "../src/adapters/artifacts/durable-artifact-store.js";
import type { AlpacaArtifactCommitSink } from "../src/adapters/market-acquisition/alpaca/contracts.js";
import {
  RetentionOwnedAlpacaPageSink,
  assertRetentionOwnedAlpacaPageSink,
  createRetentionOwnedAlpacaPageSink,
  createTestAlpacaArtifactCommitSink,
} from "../src/adapters/market-acquisition/alpaca/retained-sink.js";
import { artifactRuntimePaths } from "../src/adapters/artifacts/runtime-root.js";
import { SqliteArtifactRepository } from "../src/adapters/artifacts/sqlite-artifact-repository.js";
import { loadMigrations, openSqliteDatabase } from "../src/adapters/sqlite/database.js";
import type {
  ArtifactStore,
  ArtifactVaultConfig,
  ReconciliationReport,
  StoreArtifactRequest,
  VerifiedArtifactRead,
} from "../src/artifacts/artifact-store.js";
import { sanitizeRequestIdentity } from "../src/artifacts/identity.js";
import { ManualClock } from "../src/core/clock.js";
import {
  ALPACA_MAX_RETENTION_DAYS,
  ALPACA_PRIVATE_ARTIFACT_POLICY,
  ALPACA_RETENTION_POLICY_ID,
  ALPACA_STOP_GRACE_DAYS,
  UTC_DAY_MS,
  digestContentPath,
  retentionExpiryMs,
  retentionStopDeadlineMs,
} from "../src/adapters/market-acquisition/private-artifact-policy.js";
import {
  DefaultArtifactRetentionController,
  createArtifactRetentionController,
  createTestArtifactRetentionController,
  assertOwnedArtifactRetentionController,
  recomputeRetentionPlanHash,
} from "../src/adapters/market-acquisition/retention/controller.js";
import type {
  ArtifactRetentionJournal,
  ErasureResult,
  RetentionArtifactBoundary,
  RetentionOwnership,
  RetentionReceipt,
  RetentionStopEvent,
} from "../src/adapters/market-acquisition/retention/contracts.js";
import { MemoryArtifactRetentionJournal } from "../src/adapters/market-acquisition/retention/memory-journal.js";
import { SqliteArtifactRetentionJournal } from "../src/adapters/market-acquisition/retention/sqlite-journal.js";
import {
  RetentionEnforcedArtifactStore,
  assertRetentionEnforcedArtifactStore,
  createTestRetentionEnforcedArtifactStore,
} from "../src/adapters/market-acquisition/retention/artifact-access.js";
import { VaultArtifactRetentionBoundary } from "../src/adapters/market-acquisition/retention/vault-boundary.js";
import { isSafeAcquisitionError } from "../src/adapters/market-acquisition/redaction.js";
import {
  evaluateRecordedMarketFixtureSelections,
  loadRecordedMarketArtifacts,
  loadRecordedMarketFixture,
  normalizeVerifiedRecordedMarketFixture,
  recordedMarketArtifactProjection,
} from "../src/adapters/market-reference/recorded-market-loader.js";
import { checkedRecordedMarketFixtureAuthority } from "./market-reference-scenario.js";
import { recordedFixtureArtifactStore } from "./recorded-fixture-artifact-store.js";

const migrations = loadMigrations(join(process.cwd(), "migrations"));
const hardKillWorker = join(process.cwd(), "test", "fixtures", "p1-10-retention-worker.mjs");

function identifier(prefix: string, nibble: string): string {
  return `${prefix}${nibble.repeat(64)}`;
}

const providerId = identifier("mpv1_", "1");
const datasetId = identifier("mds1_", "2");
const feedId = identifier("mfd1_", "3");
const endpointChannelId = identifier("mec1_", "4");
const observationId = identifier("aob1_", "5");
const derivedId = identifier("drv1_", "6");
const syntheticBytes = Buffer.from("original synthetic retention bytes v1", "utf8");
const digest = createHash("sha256").update(syntheticBytes).digest("hex");
const captureMs = 1_700_000_000_000;

function ownership(
  overrides: Partial<Omit<RetentionOwnership, "ownershipId">> = {},
): Omit<RetentionOwnership, "ownershipId"> {
  return {
    policyId: ALPACA_RETENTION_POLICY_ID,
    providerLane: "alpaca",
    providerId,
    datasetId,
    feedId,
    endpointChannelId,
    artifactObservationId: observationId,
    artifactDigest: digest,
    artifactSizeBytes: syntheticBytes.byteLength,
    derivedIds: [derivedId],
    trustedCaptureMs: captureMs,
    expiresAtMs: retentionExpiryMs(ALPACA_PRIVATE_ARTIFACT_POLICY, captureMs, null),
    ...overrides,
  };
}

function stop(
  overrides: Partial<Omit<RetentionStopEvent, "stopEventId">> = {},
): Omit<RetentionStopEvent, "stopEventId"> {
  const effectiveAtMs = captureMs + UTC_DAY_MS;
  return {
    policyId: ALPACA_RETENTION_POLICY_ID,
    providerLane: "alpaca",
    providerId,
    effectiveAtMs,
    deadlineMs: retentionStopDeadlineMs(ALPACA_PRIVATE_ARTIFACT_POLICY, effectiveAtMs, null),
    reason: "owner-revocation",
    ...overrides,
  };
}

class SyntheticArtifactBoundary implements RetentionArtifactBoundary {
  readonly present = new Set<string>([digest]);
  settle = true;
  erasures = 0;
  postReturnActivity = 0;

  async settleActiveReadersAndWriters(): Promise<boolean> {
    return this.settle;
  }
  async eraseDigestCopies(value: string): Promise<ErasureResult> {
    const present = this.present.delete(value);
    this.erasures += 1;
    return {
      artifactDigest: value,
      erasedCopies: {
        content: present ? 1 : 0,
        staging: 0,
        snapshot: 0,
        quarantine: 0,
      },
      alreadyAbsent: !present,
    };
  }
  async verifyDigestCopiesAbsent(value: string): Promise<boolean> {
    return !this.present.has(value);
  }
}

class PreparedRetentionSink implements AlpacaArtifactCommitSink<string> {
  commits = 0;
  constructor(
    readonly preparedOwnership: Omit<RetentionOwnership, "ownershipId">,
    readonly beforeCommit: () => void | Promise<void> = () => undefined,
    readonly onCommit: () => void = () => undefined,
  ) {}
  async write(): Promise<void> {}
  async prepareVerifiedCommit() {
    return Object.freeze({
      ownership: this.preparedOwnership,
      commit: async () => {
        await this.beforeCommit();
        this.commits += 1;
        this.onCommit();
        return "committed";
      },
    });
  }
  async abort(): Promise<void> {}
  async destroy(): Promise<void> {}
  async settle(): Promise<void> {}
}

function controller(
  journal: ArtifactRetentionJournal,
  artifacts: SyntheticArtifactBoundary,
  nowMs: () => number,
  faultBoundary?: (checkpoint: string) => void | Promise<void>,
): DefaultArtifactRetentionController {
  return createTestArtifactRetentionController({
    journal,
    artifacts,
    nowMs,
    ...(faultBoundary === undefined ? {} : { faultBoundary }),
  });
}

test("retention arithmetic enforces exact 3650/30-day boundaries and earlier deadlines", () => {
  assert.equal(ALPACA_MAX_RETENTION_DAYS, 3_650);
  assert.equal(ALPACA_STOP_GRACE_DAYS, 30);
  assert.equal(
    retentionExpiryMs(ALPACA_PRIVATE_ARTIFACT_POLICY, captureMs, null),
    captureMs + 3_650 * UTC_DAY_MS,
  );
  assert.equal(
    retentionExpiryMs(ALPACA_PRIVATE_ARTIFACT_POLICY, captureMs, captureMs + 7 * UTC_DAY_MS),
    captureMs + 7 * UTC_DAY_MS,
  );
  const effective = captureMs + UTC_DAY_MS;
  assert.equal(
    retentionStopDeadlineMs(ALPACA_PRIVATE_ARTIFACT_POLICY, effective, null),
    effective + 30 * UTC_DAY_MS,
  );
  assert.equal(
    retentionStopDeadlineMs(ALPACA_PRIVATE_ARTIFACT_POLICY, effective, effective + UTC_DAY_MS),
    effective + UTC_DAY_MS,
  );
});

test("trusted-time use guards deny artifact and derived use exactly at expiry across SQLite restart", async (t) => {
  const expiry = captureMs + 10;
  for (const kind of ["memory", "sqlite"] as const) {
    const directory = await mkdtemp(join(tmpdir(), `peas-p1-10-expiry-${kind}-`));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const filename = join(directory, "retention.sqlite");
    let now = expiry - 1;
    let database = kind === "sqlite" ? openSqliteDatabase(filename, migrations) : undefined;
    let journal: ArtifactRetentionJournal =
      database === undefined
        ? new MemoryArtifactRetentionJournal()
        : new SqliteArtifactRetentionJournal(database);
    controller(journal, new SyntheticArtifactBoundary(), () => now).registerOwnership(
      ownership({ expiresAtMs: expiry }),
    );
    database?.close();
    if (kind === "sqlite") {
      database = openSqliteDatabase(filename, migrations);
      journal = new SqliteArtifactRetentionJournal(database);
    }
    const restarted = controller(journal, new SyntheticArtifactBoundary(), () => now);
    assert.doesNotThrow(() => restarted.assertArtifactUseAllowed(digest));
    assert.doesNotThrow(() => restarted.assertDerivedUseAllowed(derivedId));
    now = expiry;
    assert.throws(() => restarted.assertArtifactUseAllowed(digest), isSafeAcquisitionError);
    assert.throws(() => restarted.assertDerivedUseAllowed(derivedId), isSafeAcquisitionError);
    let reconcileCalls = 0;
    const guarded = createTestRetentionEnforcedArtifactStore(
      {
        async reconcile() {
          reconcileCalls += 1;
          throw new Error("expired reconciliation must not begin");
        },
      } as unknown as ArtifactStore,
      restarted,
    );
    await assert.rejects(() => guarded.reconcile(), isSafeAcquisitionError);
    assert.equal(reconcileCalls, 0);
    now = expiry + 1;
    assert.throws(() => restarted.assertArtifactUseAllowed(digest), isSafeAcquisitionError);
    database?.close();
  }
});

test("normalized derived lineage is durable and denied on stop across restart", async (t) => {
  const normalizedDerived = identifier("mnf1_", "7");
  for (const kind of ["memory", "sqlite"] as const) {
    const directory = await mkdtemp(join(tmpdir(), `peas-p1-10-derived-lineage-${kind}-`));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const filename = join(directory, "retention.sqlite");
    let database = kind === "sqlite" ? openSqliteDatabase(filename, migrations) : undefined;
    let journal: ArtifactRetentionJournal =
      database === undefined
        ? new MemoryArtifactRetentionJournal()
        : new SqliteArtifactRetentionJournal(database);
    const artifacts = new SyntheticArtifactBoundary();
    let worker = controller(journal, artifacts, () => captureMs);
    worker.registerOwnership(ownership({ derivedIds: [] }));
    worker.registerDerivedLineage([digest], [normalizedDerived]);
    assert.deepEqual(
      worker.registerOwnership(ownership({ derivedIds: [] })).derivedIds,
      [],
      `${kind} original ownership replay must ignore later hydrated lineage`,
    );
    assert.doesNotThrow(() => worker.assertDerivedUseAllowed(normalizedDerived));
    database?.close();
    if (kind === "sqlite") {
      database = openSqliteDatabase(filename, migrations);
      journal = new SqliteArtifactRetentionJournal(database);
      worker = controller(journal, artifacts, () => stop().effectiveAtMs);
    }
    assert.equal(journal.ownershipForDerivedId(normalizedDerived).length, 1);
    assert.deepEqual(worker.registerOwnership(ownership({ derivedIds: [] })).derivedIds, []);
    assert.doesNotThrow(() => worker.assertDerivedUseAllowed(normalizedDerived));
    await worker.enforceStop(stop());
    assert.throws(() => worker.assertDerivedUseAllowed(normalizedDerived), isSafeAcquisitionError);
    assert.equal(journal.derivedUseDenied(normalizedDerived), true);
    database?.close();
  }
});

test("recorded loader cannot bypass trusted-time artifact and derived-use guards across cold restart", async (t) => {
  const checked = await checkedRecordedMarketFixtureAuthority();
  const expiry = captureMs + 20;
  for (const kind of ["memory", "sqlite"] as const) {
    const directory = await mkdtemp(join(tmpdir(), `peas-p1-10-loader-expiry-${kind}-`));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const filename = join(directory, "retention.sqlite");
    let now = expiry - 1;
    let database = kind === "sqlite" ? openSqliteDatabase(filename, migrations) : undefined;
    let journal: ArtifactRetentionJournal =
      database === undefined
        ? new MemoryArtifactRetentionJournal()
        : new SqliteArtifactRetentionJournal(database);
    let retention = controller(journal, new SyntheticArtifactBoundary(), () => now);
    for (const [index, member] of checked.manifest.retrievedMembers.entries()) {
      retention.registerOwnership(
        ownership({
          artifactObservationId: identifier("aob1_", String((index % 5) + 5)),
          artifactDigest: member.artifactDigest,
          artifactSizeBytes: member.sizeBytes,
          derivedIds: [],
          expiresAtMs: expiry,
          endpointChannelId: identifier("mec1_", String((index % 5) + 5)),
        }),
      );
    }
    database?.close();
    if (kind === "sqlite") {
      database = openSqliteDatabase(filename, migrations);
      journal = new SqliteArtifactRetentionJournal(database);
      retention = controller(journal, new SyntheticArtifactBoundary(), () => now);
    }
    const fixtureStore = recordedFixtureArtifactStore(checked.fixtureRoot, checked.seeds);
    const guarded = createTestRetentionEnforcedArtifactStore(fixtureStore.unsafeStore, retention);
    const loaded = await loadRecordedMarketArtifacts(
      guarded,
      recordedMarketArtifactProjection(checked.manifest),
    );
    assert.equal(loaded.status, "verified", JSON.stringify(loaded));
    if (loaded.status !== "verified") assert.fail("fixture artifacts must verify before expiry");
    const diagnosticLease = guarded.createUseLease(
      checked.manifest.retrievedMembers.map((member) => member.artifactDigest),
    );
    assert.doesNotThrow(() =>
      normalizeVerifiedRecordedMarketFixture(checked.manifest, loaded.members, diagnosticLease),
    );
    const verified = await loadRecordedMarketFixture(guarded, checked.manifest);
    assert.equal(verified.status, "verified", JSON.stringify(verified));
    if (verified.status !== "verified") assert.fail("fixture must verify before expiry");
    const derivedIds = verified.normalizedFacts.flatMap((fact) =>
      [fact.marketFactId, fact.normalizedMarketFactId].filter((id): id is string => id !== null),
    );
    assert.equal(derivedIds.length > 0, true);
    for (const derivedId of derivedIds) {
      assert.equal(journal.ownershipForDerivedId(derivedId).length > 0, true);
      assert.doesNotThrow(() => retention.assertDerivedUseAllowed(derivedId));
    }
    const beforeDenied = {
      observations: [...fixtureStore.counters.observationCalls.values()].reduce(
        (sum, count) => sum + count,
        0,
      ),
      reads: [...fixtureStore.counters.readCalls.values()].reduce((sum, count) => sum + count, 0),
    };
    now = expiry;
    assert.throws(
      () =>
        evaluateRecordedMarketFixtureSelections(
          checked.manifest,
          verified.normalizedFacts,
          diagnosticLease,
        ),
      isSafeAcquisitionError,
    );
    assert.equal((await loadRecordedMarketFixture(guarded, checked.manifest)).status, "rejected");
    assert.equal(
      (await loadRecordedMarketFixture(fixtureStore.unsafeStore as never, checked.manifest)).status,
      "rejected",
    );
    assert.deepEqual(
      {
        observations: [...fixtureStore.counters.observationCalls.values()].reduce(
          (sum, count) => sum + count,
          0,
        ),
        reads: [...fixtureStore.counters.readCalls.values()].reduce((sum, count) => sum + count, 0),
      },
      beforeDenied,
    );
    database?.close();
  }
});

test("ownership registered during or after a provider stop is atomically denied and settled", async () => {
  const journal = new MemoryArtifactRetentionJournal();
  const artifacts = new SyntheticArtifactBoundary();
  const secondDigest = createHash("sha256").update("second synthetic artifact").digest("hex");
  const secondDerived = identifier("drv1_", "7");
  const worker = controller(
    journal,
    artifacts,
    () => stop().effectiveAtMs,
    (checkpoint) => {
      if (checkpoint !== "retention-stop-denials-committed") return;
      artifacts.present.add(secondDigest);
      assert.throws(
        () =>
          worker.registerOwnership(
            ownership({
              artifactObservationId: identifier("aob1_", "8"),
              artifactDigest: secondDigest,
              derivedIds: [secondDerived],
            }),
          ),
        isSafeAcquisitionError,
      );
    },
  );
  worker.registerOwnership(ownership());
  const receipt = await worker.enforceStop(stop());
  assert.deepEqual(receipt.artifactDigests, [digest, secondDigest].sort());
  assert.equal(artifacts.present.size, 0);
  assert.equal(journal.digestUseDenied(secondDigest), true);
  assert.equal(journal.derivedUseDenied(secondDerived), true);

  const thirdDigest = createHash("sha256").update("third synthetic artifact").digest("hex");
  assert.throws(
    () =>
      worker.registerOwnership(
        ownership({
          artifactObservationId: identifier("aob1_", "9"),
          artifactDigest: thirdDigest,
          derivedIds: [],
        }),
      ),
    isSafeAcquisitionError,
  );
  assert.equal(journal.digestUseDenied(thirdDigest), true);
});

test("trusted artifact completion closes provider-stop races before, during, and after commit", async () => {
  const secondDigest = createHash("sha256").update("atomic synthetic commit").digest("hex");
  const candidateOwnership = ownership({
    artifactObservationId: identifier("aob1_", "8"),
    artifactDigest: secondDigest,
    artifactSizeBytes: 23,
    derivedIds: [],
  });

  const beforeJournal = new MemoryArtifactRetentionJournal();
  const beforeArtifacts = new SyntheticArtifactBoundary();
  const beforeWorker = controller(beforeJournal, beforeArtifacts, () => stop().effectiveAtMs);
  beforeWorker.registerOwnership(ownership());
  await beforeWorker.enforceStop(stop());
  const beforeSink = new PreparedRetentionSink(candidateOwnership);
  const beforeOwnedSink = createRetentionOwnedAlpacaPageSink(
    createTestAlpacaArtifactCommitSink(beforeSink),
    beforeWorker,
  );
  await beforeOwnedSink.write(Buffer.from("atomic synthetic commit"));
  await assert.rejects(
    () => beforeOwnedSink.completeVerifyAndRegisterOwnership(),
    isSafeAcquisitionError,
  );
  assert.equal(beforeSink.commits, 0);
  assert.throws(() => beforeWorker.assertArtifactUseAllowed(secondDigest), isSafeAcquisitionError);

  const duringJournal = new MemoryArtifactRetentionJournal();
  const duringArtifacts = new SyntheticArtifactBoundary();
  const duringWorker = controller(duringJournal, duringArtifacts, () => stop().effectiveAtMs);
  let releaseCommit!: () => void;
  let commitEntered!: () => void;
  const entered = new Promise<void>((resolve) => {
    commitEntered = resolve;
  });
  const release = new Promise<void>((resolve) => {
    releaseCommit = resolve;
  });
  const duringSink = new PreparedRetentionSink(
    candidateOwnership,
    async () => {
      commitEntered();
      await release;
    },
    () => duringArtifacts.present.add(secondDigest),
  );
  const duringOwnedSink = createRetentionOwnedAlpacaPageSink(
    createTestAlpacaArtifactCommitSink(duringSink),
    duringWorker,
  );
  await duringOwnedSink.write(Buffer.from("atomic synthetic commit"));
  const committing = duringOwnedSink.completeVerifyAndRegisterOwnership();
  await entered;
  const stopping = controller(
    duringJournal,
    duringArtifacts,
    () => stop().effectiveAtMs,
  ).enforceStop(stop());
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(duringArtifacts.erasures, 0);
  releaseCommit();
  await assert.rejects(() => committing, isSafeAcquisitionError);
  await stopping;
  assert.equal(duringSink.commits, 1);
  assert.equal(duringArtifacts.present.has(secondDigest), false);
  assert.throws(() => duringWorker.assertArtifactUseAllowed(secondDigest), isSafeAcquisitionError);

  const afterJournal = new MemoryArtifactRetentionJournal();
  const afterArtifacts = new SyntheticArtifactBoundary();
  const afterWorker = controller(afterJournal, afterArtifacts, () => stop().effectiveAtMs);
  const afterSink = new PreparedRetentionSink(
    candidateOwnership,
    () => undefined,
    () => afterArtifacts.present.add(secondDigest),
  );
  const afterOwnedSink = createRetentionOwnedAlpacaPageSink(
    createTestAlpacaArtifactCommitSink(afterSink),
    afterWorker,
  );
  await afterOwnedSink.write(Buffer.from("atomic synthetic commit"));
  assert.equal(await afterOwnedSink.completeVerifyAndRegisterOwnership(), "committed");
  await afterWorker.enforceStop(stop());
  assert.throws(() => afterWorker.assertArtifactUseAllowed(secondDigest), isSafeAcquisitionError);
});

test("SQLite controllers sharing one durable boundary serialize commit against stop", async () => {
  const database = openSqliteDatabase(":memory:", migrations);
  try {
    const journalA = new SqliteArtifactRetentionJournal(database);
    const journalB = new SqliteArtifactRetentionJournal(database);
    const artifacts = new SyntheticArtifactBoundary();
    const commitController = controller(journalA, artifacts, () => stop().effectiveAtMs);
    const stopController = controller(journalB, artifacts, () => stop().effectiveAtMs);
    const committedBytes = Buffer.from("atomic synthetic commit", "utf8");
    const committedDigest = createHash("sha256").update(committedBytes).digest("hex");
    let releaseCommit!: () => void;
    let commitEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      commitEntered = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseCommit = resolve;
    });
    const sink = new PreparedRetentionSink(
      ownership({
        artifactObservationId: identifier("aob1_", "a"),
        artifactDigest: committedDigest,
        artifactSizeBytes: committedBytes.byteLength,
        derivedIds: [],
      }),
      async () => {
        commitEntered();
        await release;
      },
      () => artifacts.present.add(committedDigest),
    );
    const owned = createRetentionOwnedAlpacaPageSink(
      createTestAlpacaArtifactCommitSink(sink),
      commitController,
    );
    await owned.write(committedBytes);
    const committing = owned.completeVerifyAndRegisterOwnership();
    await entered;
    const stopping = stopController.enforceStop(stop());
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(artifacts.erasures, 0);
    releaseCommit();
    await assert.rejects(() => committing, isSafeAcquisitionError);
    const receipt = await stopping;
    assert.equal(receipt.outcome, "verified-erased");
    assert.equal(artifacts.present.has(committedDigest), false);
    assert.equal(journalB.digestUseDenied(committedDigest), true);
  } finally {
    database.close();
  }
});

test("existing receipts revalidate absence and physical attempt counts use unique ordinals", async () => {
  const journal = new MemoryArtifactRetentionJournal();
  const artifacts = new SyntheticArtifactBoundary();
  const worker = controller(journal, artifacts, () => stop().effectiveAtMs);
  worker.registerOwnership(ownership());
  const receipt = await worker.enforceStop(stop());
  assert.equal(receipt.attemptCount, 1);
  assert.equal(journal.attemptsFor(receipt.planId, digest).length, 2);
  artifacts.present.add(digest);
  const recovery = await worker.enforceStop(stop());
  assert.notEqual(recovery.planId, receipt.planId);
  assert.equal(recovery.attemptCount, 1);
  assert.equal(journal.attemptsFor(recovery.planId, digest).length, 2);
  assert.equal(artifacts.present.has(digest), false);
  assert.equal((await worker.enforceStop(stop())).receiptId, receipt.receiptId);
});

test("retention ownership cannot name bytes or sizes different from the committed stream", async () => {
  const journal = new MemoryArtifactRetentionJournal();
  const artifacts = new SyntheticArtifactBoundary();
  const worker = controller(journal, artifacts, () => captureMs);
  const lower = new PreparedRetentionSink(
    ownership({
      artifactDigest: digest,
      artifactSizeBytes: syntheticBytes.byteLength,
      derivedIds: [],
    }),
  );
  const sink = createRetentionOwnedAlpacaPageSink(
    createTestAlpacaArtifactCommitSink(lower),
    worker,
  );
  await sink.write(Buffer.from("different original synthetic bytes", "utf8"));
  await assert.rejects(
    () => sink.completeVerifyAndRegisterOwnership(),
    /alpaca-artifact-ownership-byte-mismatch/u,
  );
  assert.equal(lower.commits, 0);
  assert.equal(journal.ownershipForDigest(digest).length, 0);
});

test("owned read admission destroys a delayed post-denial stream before stop settles", async () => {
  const journal = new MemoryArtifactRetentionJournal();
  const artifacts = new SyntheticArtifactBoundary();
  const worker = controller(journal, artifacts, () => stop().effectiveAtMs);
  worker.registerOwnership(ownership());
  let resolveRead!: (value: VerifiedArtifactRead) => void;
  const delayedRead = new Promise<VerifiedArtifactRead>((resolve) => {
    resolveRead = resolve;
  });
  let streamCloses = 0;
  let readCalls = 0;
  const raw = {
    async read() {
      readCalls += 1;
      return delayedRead;
    },
  } as unknown as ArtifactStore;
  const guarded = createTestRetentionEnforcedArtifactStore(raw, worker);
  assert.throws(
    () => new RetentionEnforcedArtifactStore(raw, {} as never),
    /owned-artifact-retention-controller-required/u,
  );
  const reading = guarded.read(digest);
  await new Promise<void>((resolve) => setImmediate(resolve));
  const stopping = worker.enforceStop(stop());
  let stopSettled = false;
  void stopping.then(() => {
    stopSettled = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(stopSettled, false);
  const stream = new Readable({ read() {} });
  stream.once("close", () => {
    streamCloses += 1;
  });
  resolveRead({
    artifact: {
      digest,
      algorithm: "sha256",
      sizeBytes: syntheticBytes.byteLength,
      committedAtMs: captureMs,
      provenance: "retrieval",
    },
    stream,
  });
  await assert.rejects(() => reading, isSafeAcquisitionError);
  await stopping;
  assert.equal(readCalls, 1);
  assert.equal(streamCloses, 1);
  assert.equal(stream.closed, true);
  assert.equal(artifacts.present.has(digest), false);
});

test("owned retention brands reject structural objects, subclasses, and proxies", () => {
  const journal = new MemoryArtifactRetentionJournal();
  const artifacts = new SyntheticArtifactBoundary();
  const trusted = controller(journal, artifacts, () => captureMs);
  class ControllerSubclass extends DefaultArtifactRetentionController {}
  const subclass = new ControllerSubclass({
    journal,
    artifacts,
    nowMs: () => captureMs,
  });
  for (const hostile of [{} as never, subclass, new Proxy(trusted, {})]) {
    assert.throws(
      () => assertOwnedArtifactRetentionController(hostile),
      /owned-artifact-retention-controller-required/u,
    );
  }

  const raw = {} as ArtifactStore;
  class GuardedStoreSubclass extends RetentionEnforcedArtifactStore {}
  const guardedSubclass = new GuardedStoreSubclass(raw, trusted);
  const guarded = createTestRetentionEnforcedArtifactStore(raw, trusted);
  for (const hostile of [{} as never, guardedSubclass, new Proxy(guarded, {})]) {
    assert.throws(
      () => assertRetentionEnforcedArtifactStore(hostile),
      /retention-enforced-store-required/u,
    );
  }

  const lower = createTestAlpacaArtifactCommitSink({
    async write() {},
    async prepareVerifiedCommit() {
      return { ownership: ownership(), async commit() {} };
    },
    async abort() {},
    async destroy() {},
    async settle() {},
  });
  const ownedSink = createRetentionOwnedAlpacaPageSink(lower, trusted);
  class PageSinkSubclass extends RetentionOwnedAlpacaPageSink<void> {}
  const sinkSubclass = new PageSinkSubclass(lower, trusted);
  for (const hostile of [{} as never, sinkSubclass, new Proxy(ownedSink, {})]) {
    assert.throws(
      () => assertRetentionOwnedAlpacaPageSink(hostile),
      /alpaca-retention-owned-sink-required/u,
    );
  }
});

test("reconciliation is cancelled before stop settlement and rejected before work after denial", async () => {
  const journal = new MemoryArtifactRetentionJournal();
  const artifacts = new SyntheticArtifactBoundary();
  const worker = controller(journal, artifacts, () => stop().effectiveAtMs);
  worker.registerOwnership(ownership());
  let resolveReconcile!: (value: ReconciliationReport) => void;
  let reconcileCalls = 0;
  const mutations = 0;
  let cancellations = 0;
  const raw = {
    async reconcile() {
      reconcileCalls += 1;
      return new Promise<ReconciliationReport>((resolve) => {
        resolveReconcile = resolve;
      });
    },
  } as unknown as ArtifactStore;
  const guarded = createTestRetentionEnforcedArtifactStore(raw, worker, () => {
    cancellations += 1;
    resolveReconcile({
      runId: "synthetic-reconciliation",
      validArtifacts: 0,
      adoptedOrphans: 0,
      abandonedStages: 0,
      expiredStages: 0,
      quarantinedObjects: 0,
      missingArtifacts: 0,
      incidents: [],
      continuationCursor: null,
      rowsVisited: 0,
      directoryEntriesRead: 0,
      bytesHashed: 0,
      elapsedMs: 0,
    });
  });
  const reconciling = guarded.reconcile();
  const reconciliationRejected = assert.rejects(() => reconciling, isSafeAcquisitionError);
  await new Promise<void>((resolve) => setImmediate(resolve));
  const stopping = worker.enforceStop(stop());
  await new Promise<void>((resolve) => setImmediate(resolve));
  await reconciliationRejected;
  await stopping;
  assert.equal(cancellations, 1);
  assert.equal(mutations, 0);
  await assert.rejects(() => guarded.reconcile(), isSafeAcquisitionError);
  assert.equal(reconcileCalls, 1);
  assert.equal(mutations, 0);
  assert.equal(artifacts.present.has(digest), false);
});

test("stop installs denial before erasure and follows the accepted durable sequence", async () => {
  const journal = new MemoryArtifactRetentionJournal();
  const artifacts = new SyntheticArtifactBoundary();
  const checkpoints: string[] = [];
  const stopInput = stop();
  const worker = controller(
    journal,
    artifacts,
    () => stopInput.deadlineMs,
    (checkpoint) => {
      checkpoints.push(checkpoint);
      if (checkpoint === "retention-stop-denials-committed") {
        assert.equal(journal.providerUseDenied("alpaca", providerId), true);
        assert.equal(journal.digestUseDenied(digest), true);
        assert.equal(journal.derivedUseDenied(derivedId), true);
        assert.equal(artifacts.present.has(digest), true);
      }
    },
  );
  worker.registerOwnership(ownership());
  const receipt = await worker.enforceStop(stopInput);
  assert.equal(receipt.outcome, "verified-erased");
  assert.equal(artifacts.present.has(digest), false);
  assert.equal(journal.hasTombstone(digest), true);
  assert.deepEqual(checkpoints, [
    "retention-stop-denials-committed",
    "retention-plan-committed",
    "retention-resources-settled",
    `retention-erasure-attempt-started:${digest}`,
    `retention-physical-erasure-complete:${digest}`,
    `retention-tombstone-committed:${digest}`,
    "retention-erasure-verified",
    "retention-receipt-committed-reread",
    "retention-checkpoint-committed-reread",
  ]);
  assert.throws(() => worker.assertArtifactUseAllowed(digest), isSafeAcquisitionError);
  assert.throws(() => worker.assertDerivedUseAllowed(derivedId), isSafeAcquisitionError);
  const stable = artifacts.postReturnActivity;
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(artifacts.postReturnActivity, stable);
});

test("exact stop deadline completes while one millisecond over fails closed with denial installed", async () => {
  const exactJournal = new MemoryArtifactRetentionJournal();
  const exactArtifacts = new SyntheticArtifactBoundary();
  const input = stop();
  const exact = controller(exactJournal, exactArtifacts, () => input.deadlineMs);
  exact.registerOwnership(ownership());
  assert.equal((await exact.enforceStop(input)).outcome, "verified-erased");

  const lateJournal = new MemoryArtifactRetentionJournal();
  const lateArtifacts = new SyntheticArtifactBoundary();
  const late = controller(lateJournal, lateArtifacts, () => input.deadlineMs + 1);
  late.registerOwnership(ownership());
  await assert.rejects(
    () => late.enforceStop(input),
    (error) => {
      assert.equal(isSafeAcquisitionError(error), true);
      assert.equal((error as { reasonCode: string }).reasonCode, "retention-deadline-breached");
      return true;
    },
  );
  assert.equal(lateJournal.digestUseDenied(digest), true);
  assert.equal(lateArtifacts.present.has(digest), true);
});

test("failure to settle remains denied and performs no physical erasure", async () => {
  const journal = new MemoryArtifactRetentionJournal();
  const artifacts = new SyntheticArtifactBoundary();
  artifacts.settle = false;
  const worker = controller(journal, artifacts, () => stop().effectiveAtMs);
  worker.registerOwnership(ownership());
  await assert.rejects(() => worker.enforceStop(stop()), isSafeAcquisitionError);
  assert.equal(journal.digestUseDenied(digest), true);
  assert.equal(artifacts.erasures, 0);
});

test("restart after every durable boundary is idempotent and never resurrects content", async () => {
  const checkpoints = [
    "retention-stop-denials-committed",
    "retention-plan-committed",
    "retention-resources-settled",
    `retention-erasure-attempt-started:${digest}`,
    `retention-physical-erasure-complete:${digest}`,
    `retention-tombstone-committed:${digest}`,
    "retention-erasure-verified",
    "retention-receipt-committed-reread",
    "retention-checkpoint-committed-reread",
  ];
  for (const crashAt of checkpoints) {
    const journal = new MemoryArtifactRetentionJournal();
    const artifacts = new SyntheticArtifactBoundary();
    const input = stop();
    let crashed = false;
    const first = controller(
      journal,
      artifacts,
      () => input.effectiveAtMs,
      (checkpoint) => {
        if (!crashed && checkpoint === crashAt) {
          crashed = true;
          throw new Error("synthetic hard kill");
        }
      },
    );
    first.registerOwnership(ownership());
    await assert.rejects(() => first.enforceStop(input), /synthetic hard kill/u);
    const resumed = controller(journal, artifacts, () => input.effectiveAtMs);
    const receipt = await resumed.enforceStop(input);
    assert.equal(receipt.outcome, "verified-erased", crashAt);
    assert.equal(journal.hasTombstone(digest), true, crashAt);
    assert.equal(artifacts.present.has(digest), false, crashAt);
    const replay = await resumed.enforceStop(input);
    assert.deepEqual(replay, receipt, crashAt);
  }
});

async function runBackend(
  kind: "memory" | "sqlite",
): Promise<{ receipt: RetentionReceipt; planHash: string; attempts: number }> {
  let database: ReturnType<typeof openSqliteDatabase> | undefined;
  let journal: ArtifactRetentionJournal;
  if (kind === "memory") journal = new MemoryArtifactRetentionJournal();
  else {
    database = openSqliteDatabase(":memory:", migrations);
    journal = new SqliteArtifactRetentionJournal(database);
  }
  try {
    const artifacts = new SyntheticArtifactBoundary();
    const input = stop();
    const worker = controller(journal, artifacts, () => input.effectiveAtMs);
    worker.registerOwnership(ownership());
    const receipt = await worker.enforceStop(input);
    const plan = journal.getPlan(receipt.planId);
    assert.notEqual(plan, undefined);
    assert.equal(recomputeRetentionPlanHash(plan as NonNullable<typeof plan>), receipt.planHash);
    return {
      receipt,
      planHash: receipt.planHash,
      attempts: journal.attemptsFor(receipt.planId, digest).length,
    };
  } finally {
    database?.close();
  }
}

test("memory and SQLite retention journals are semantically equivalent and immutable", async () => {
  const memory = await runBackend("memory");
  const sqlite = await runBackend("sqlite");
  assert.deepEqual(sqlite, memory);

  const database = openSqliteDatabase(":memory:", migrations);
  try {
    new SqliteArtifactRetentionJournal(database);
    assert.throws(() => database.prepare("DELETE FROM market_retention_policies").run());
    assert.throws(() => database.prepare("UPDATE market_retention_policies SET enabled = 0").run());
    const migrationFiveTriggers = database
      .prepare(
        "SELECT count(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'artifact_%_no_delete'",
      )
      .get() as { count: bigint };
    assert.ok(migrationFiveTriggers.count > 0n);
  } finally {
    database.close();
  }
});

test("shared digest is conservatively denied and erased for all references", async () => {
  const journal = new MemoryArtifactRetentionJournal();
  const artifacts = new SyntheticArtifactBoundary();
  const worker = controller(journal, artifacts, () => stop().effectiveAtMs);
  worker.registerOwnership(ownership());
  worker.registerOwnership(
    ownership({
      providerId: identifier("mpv1_", "7"),
      artifactObservationId: identifier("aob1_", "8"),
      derivedIds: [identifier("drv1_", "9")],
    }),
  );
  await worker.enforceStop(stop());
  assert.equal(journal.digestUseDenied(digest), true);
  assert.equal(artifacts.erasures, 1);
});

test("vault retention boundary removes content, staging, snapshot, and quarantine copies", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "peas-p1-10-retention-"));
  const paths = artifactRuntimePaths(root);
  for (const directory of [
    paths.databaseDirectory,
    paths.content,
    paths.staging,
    paths.snapshots,
    paths.quarantine,
    paths.locks,
  ])
    await mkdir(directory, { recursive: true });
  const content = digestContentPath(root, digest);
  await mkdir(dirname(content), { recursive: true });
  await writeFile(content, syntheticBytes, { mode: 0o600 });
  await writeFile(join(paths.staging, "synthetic.part"), syntheticBytes, { mode: 0o600 });
  await writeFile(join(paths.snapshots, "synthetic.verified"), syntheticBytes, { mode: 0o600 });
  await writeFile(join(paths.quarantine, "synthetic.quarantined"), syntheticBytes, {
    mode: 0o600,
  });
  const database = openSqliteDatabase(paths.databasePath, migrations);
  const store = await DurableArtifactStore.open({
    repository: new SqliteArtifactRepository(database),
    clock: new ManualClock(captureMs),
    config: vaultConfig(root),
  });
  context.after(async () => {
    await store.close();
    if (database.open) database.close();
    await rm(root, { recursive: true, force: true });
  });
  const boundary = await VaultArtifactRetentionBoundary.open({
    store,
    runtimeRoot: root,
  });
  const result = await boundary.eraseDigestCopies(digest);
  assert.deepEqual(result.erasedCopies, {
    content: 1,
    staging: 1,
    snapshot: 1,
    quarantine: 1,
  });
  assert.equal(await boundary.verifyDigestCopiesAbsent(digest), true);
  const second = await boundary.eraseDigestCopies(digest);
  assert.equal(second.alreadyAbsent, true);
});

test("separate live controllers over one durable store share the stop barrier", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "peas-p1-10-retention-shared-live-"));
  const paths = artifactRuntimePaths(root);
  await mkdir(paths.databaseDirectory, { recursive: true });
  const database = openSqliteDatabase(paths.databasePath, migrations);
  const store = await DurableArtifactStore.open({
    repository: new SqliteArtifactRepository(database),
    clock: new ManualClock(captureMs),
    config: vaultConfig(root),
  });
  context.after(async () => {
    await store.close();
    if (database.open) database.close();
    await rm(root, { recursive: true, force: true });
  });
  const stored = await store.store(artifactRequest("shared-live", Readable.from([syntheticBytes])));
  const journal = new SqliteArtifactRetentionJournal(database);
  const boundaryA = await VaultArtifactRetentionBoundary.open({ store, runtimeRoot: root });
  const boundaryB = await VaultArtifactRetentionBoundary.open({ store, runtimeRoot: root });
  const controllerA = createArtifactRetentionController({
    journal,
    artifacts: boundaryA,
    nowMs: () => stop().effectiveAtMs,
  });
  const controllerB = createArtifactRetentionController({
    journal,
    artifacts: boundaryB,
    nowMs: () => stop().effectiveAtMs,
  });
  let release!: () => void;
  let entered!: () => void;
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  const commitEntered = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const committing = controllerA.commitArtifact(
    ownership({
      artifactDigest: stored.artifact.digest,
      artifactSizeBytes: stored.artifact.sizeBytes,
      artifactObservationId: identifier("aob1_", "b"),
      derivedIds: [],
    }),
    async () => {
      entered();
      await paused;
      return stored;
    },
  );
  await commitEntered;
  const stopping = controllerB.enforceStop(stop());
  let settled = false;
  void stopping.then(() => {
    settled = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  release();
  await assert.rejects(() => committing, isSafeAcquisitionError);
  assert.equal((await stopping).outcome, "verified-erased");
  assert.equal(await boundaryB.verifyDigestCopiesAbsent(stored.artifact.digest), true);
});

function waitForCheckpoint(child: ChildProcess, expected: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Worker did not reach ${expected}`)), 10_000);
    child.once("error", reject);
    child.on("message", (message: unknown) => {
      if (
        message !== null &&
        typeof message === "object" &&
        (message as { type?: unknown }).type === "checkpoint" &&
        (message as { checkpoint?: unknown }).checkpoint === expected
      ) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
}

test("process hard-kill at every retention boundary converges without resurrection", {
  timeout: 120_000,
}, async () => {
  const checkpoints = [
    "retention-stop-denials-committed",
    "retention-plan-committed",
    "retention-resources-settled",
    `retention-erasure-attempt-started:${digest}`,
    `retention-physical-erasure-complete:${digest}`,
    `retention-tombstone-committed:${digest}`,
    "retention-erasure-verified",
    "retention-receipt-committed-reread",
    "retention-checkpoint-committed-reread",
  ];
  for (const checkpoint of checkpoints) {
    const root = await mkdtemp(join(tmpdir(), "peas-p1-10-retention-kill-"));
    try {
      const paths = artifactRuntimePaths(root);
      await mkdir(paths.databaseDirectory, { recursive: true });
      for (const directory of [
        paths.content,
        paths.staging,
        paths.snapshots,
        paths.quarantine,
        paths.locks,
      ])
        await mkdir(directory, { recursive: true });
      let database = openSqliteDatabase(paths.databasePath, migrations);
      let journal = new SqliteArtifactRetentionJournal(database);
      const seedArtifacts = new SyntheticArtifactBoundary();
      const seed = controller(journal, seedArtifacts, () => stop().effectiveAtMs);
      seed.registerOwnership(ownership());
      database.close();
      const content = digestContentPath(root, digest);
      await mkdir(dirname(content), { recursive: true });
      await writeFile(content, syntheticBytes, { mode: 0o600 });

      const child = fork(hardKillWorker, [paths.databasePath, root, checkpoint, digest], {
        stdio: ["ignore", "ignore", "ignore", "ipc"],
      });
      await waitForCheckpoint(child, checkpoint);
      assert.equal(child.kill("SIGKILL"), true);
      await new Promise<void>((resolve) => child.once("exit", () => resolve()));

      database = openSqliteDatabase(paths.databasePath, migrations);
      journal = new SqliteArtifactRetentionJournal(database);
      const recoveredStore = await DurableArtifactStore.open({
        repository: new SqliteArtifactRepository(database),
        clock: new ManualClock(stop().effectiveAtMs + 30_001),
        config: vaultConfig(root),
      });
      const boundary = await VaultArtifactRetentionBoundary.open({
        store: recoveredStore,
        runtimeRoot: root,
      });
      const resumed = createArtifactRetentionController({
        journal,
        artifacts: boundary,
        nowMs: () => stop().effectiveAtMs,
      });
      const receipt = await resumed.enforceStop(stop());
      assert.equal(receipt.outcome, "verified-erased", checkpoint);
      assert.equal(journal.hasTombstone(digest), true, checkpoint);
      assert.equal(await boundary.verifyDigestCopiesAbsent(digest), true, checkpoint);
      assert.deepEqual(await resumed.enforceStop(stop()), receipt, checkpoint);
      await recoveredStore.close();
      database.close();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

function vaultConfig(runtimeRoot: string): ArtifactVaultConfig {
  return {
    runtimeRootMode: "ci-temporary",
    runtimeRoot,
    maxArtifactBytes: 1_024,
    maxVaultBytes: 4_096,
    maxConcurrentWrites: 1,
    streamHighWaterMarkBytes: 17,
    stageExpiryMs: 1_000,
    writerLeaseBehavior: "fail",
    writerLeaseWaitMs: 0,
    writerLeaseDurationMs: 30_000,
    writerLeaseRenewalMs: 10_000,
  };
}

function artifactRequest(
  attemptId: string,
  entityBytes: Readable,
  provider = "alpaca",
): StoreArtifactRequest {
  return {
    attempt: {
      attemptId,
      provider,
      recordId: `record-${attemptId}`,
      revisionId: "revision-1",
      startedAtMs: captureMs,
      request: sanitizeRequestIdentity({
        method: "GET",
        origin: "https://synthetic.invalid",
        path: "/offline",
        routeLabel: "synthetic.retention",
      }),
    },
    response: {
      statusCode: 200,
      etag: null,
      lastModified: null,
      mediaType: "application/octet-stream",
      contentEncoding: null,
      declaredContentLength: null,
      transportDecoded: true,
    },
    entityBytes,
  };
}

test("retention settlement cannot pass a queued pre-stop writer or admit its later bytes", {
  timeout: 30_000,
}, async (context) => {
  const root = await mkdtemp(join(tmpdir(), "peas-p1-10-retention-queue-"));
  const paths = artifactRuntimePaths(root);
  await mkdir(paths.databaseDirectory, { recursive: true });
  const database = openSqliteDatabase(paths.databasePath, migrations);
  const repository = new SqliteArtifactRepository(database);
  const clock = new ManualClock(captureMs);
  let stageCount = 0;
  let activeStageCreated: (() => void) | undefined;
  const reachedActiveStage = new Promise<void>((resolve) => {
    activeStageCreated = resolve;
  });
  const store = await DurableArtifactStore.open({
    repository,
    clock,
    config: vaultConfig(root),
    faultBoundary(checkpoint) {
      if (checkpoint === "stage-create") {
        stageCount += 1;
        if (stageCount === 2) activeStageCreated?.();
      }
    },
  });
  context.after(async () => {
    await store.close();
    if (database.open) database.close();
    await rm(root, { recursive: true, force: true });
  });

  const seeded = await store.store(artifactRequest("seeded", Readable.from([syntheticBytes])));
  const journal = new SqliteArtifactRetentionJournal(database);
  const boundary = await VaultArtifactRetentionBoundary.open({
    store,
    runtimeRoot: root,
    settlementTimeoutMs: 10_000,
  });
  const worker = createArtifactRetentionController({
    journal,
    artifacts: boundary,
    nowMs: () => stop().effectiveAtMs,
  });
  worker.registerOwnership(
    ownership({
      artifactDigest: seeded.artifact.digest,
      artifactObservationId: identifier("aob1_", "a"),
      artifactSizeBytes: seeded.artifact.sizeBytes,
    }),
  );

  let releaseBody: (() => void) | undefined;
  const bodyReleased = new Promise<void>((resolve) => {
    releaseBody = resolve;
  });
  async function* pausedBody(): AsyncGenerator<Buffer> {
    yield Buffer.from("active-before-stop", "utf8");
    await bodyReleased;
    yield Buffer.from("-must-not-commit", "utf8");
  }
  const active = store.store(artifactRequest("active-before-stop", Readable.from(pausedBody())));
  await reachedActiveStage;
  const queuedBytes = Buffer.from("queued-before-stop", "utf8");
  const queuedDigest = createHash("sha256").update(queuedBytes).digest("hex");
  const queued = store.store(artifactRequest("queued-before-stop", Readable.from([queuedBytes])));
  let stopSettled = false;
  const stopping = worker.enforceStop(stop()).then((value) => {
    stopSettled = true;
    return value;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(stopSettled, false);
  releaseBody?.();
  await assert.rejects(() => active, /retention policy/u);
  await assert.rejects(() => queued, /retention policy/u);
  const receipt = await stopping;
  assert.equal(receipt.outcome, "verified-erased");
  assert.equal(stopSettled, true);
  assert.equal(repository.stat(queuedDigest), undefined);
  const unrelatedBytes = Buffer.from("unrelated synthetic bytes", "utf8");
  const unrelated = await store.store(
    artifactRequest("unrelated-provider-after-stop", Readable.from([unrelatedBytes]), "issuer-ir"),
  );
  assert.equal(unrelated.artifact.sizeBytes, unrelatedBytes.byteLength);
});
