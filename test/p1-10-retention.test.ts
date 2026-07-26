import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fork, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { test } from "node:test";

import { DurableArtifactStore } from "../src/adapters/artifacts/durable-artifact-store.js";
import { artifactRuntimePaths } from "../src/adapters/artifacts/runtime-root.js";
import { SqliteArtifactRepository } from "../src/adapters/artifacts/sqlite-artifact-repository.js";
import { loadMigrations, openSqliteDatabase } from "../src/adapters/sqlite/database.js";
import type { ArtifactVaultConfig, StoreArtifactRequest } from "../src/artifacts/artifact-store.js";
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
import { VaultArtifactRetentionBoundary } from "../src/adapters/market-acquisition/retention/vault-boundary.js";
import { isSafeAcquisitionError } from "../src/adapters/market-acquisition/redaction.js";

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

function controller(
  journal: ArtifactRetentionJournal,
  artifacts: SyntheticArtifactBoundary,
  nowMs: () => number,
  faultBoundary?: (checkpoint: string) => void | Promise<void>,
): DefaultArtifactRetentionController {
  return new DefaultArtifactRetentionController({
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
  context.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
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
  const store = {
    async settleForRetention(): Promise<boolean> {
      return true;
    },
  } as DurableArtifactStore;
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
      const boundary = await VaultArtifactRetentionBoundary.open({
        store: {
          async settleForRetention(): Promise<boolean> {
            return true;
          },
        } as DurableArtifactStore,
        runtimeRoot: root,
      });
      const resumed = new DefaultArtifactRetentionController({
        journal,
        artifacts: boundary,
        nowMs: () => stop().effectiveAtMs,
      });
      const receipt = await resumed.enforceStop(stop());
      assert.equal(receipt.outcome, "verified-erased", checkpoint);
      assert.equal(journal.hasTombstone(digest), true, checkpoint);
      assert.equal(await boundary.verifyDigestCopiesAbsent(digest), true, checkpoint);
      assert.deepEqual(await resumed.enforceStop(stop()), receipt, checkpoint);
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
  const worker = new DefaultArtifactRetentionController({
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
