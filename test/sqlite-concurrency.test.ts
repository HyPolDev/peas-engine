import assert from "node:assert/strict";
import { type ChildProcess, fork } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CapturedEventLog } from "../src/adapters/memory/captured-event-log.js";
import { InMemoryProcessingStore } from "../src/adapters/memory/processing-store.js";
import { loadMigrations, openSqliteDatabase } from "../src/adapters/sqlite/database.js";
import { SqliteEventLog } from "../src/adapters/sqlite/event-log.js";
import { SqliteProcessingStore } from "../src/adapters/sqlite/processing-store.js";
import { ManualClock } from "../src/core/clock.js";
import { draftFromStored, type EventDraft } from "../src/core/event.js";
import { canonicalHash } from "../src/core/hash.js";
import { canonicalJson, type JsonObject, type JsonValue } from "../src/core/json.js";
import {
  type AggregateCheckpoint,
  type AggregatePage,
  DeterministicProcessor,
  type OutputPage,
  type ProcessingCommit,
  type ProcessingStore,
  type RunCursor,
  type RunRegistration,
} from "../src/core/processor.js";
import {
  EarningsClusterReducer,
  type EarningsClusterState,
} from "../src/domain/earnings-cluster/reducer.js";
import { BASE_TIME_MS, CONFIG, captureScenario, FISCAL_PERIOD, makeManifest } from "./scenario.js";

const migrations = loadMigrations(join(process.cwd(), "migrations"));
const workerPath = join(process.cwd(), "test", "fixtures", "sqlite-worker.mjs");

type WorkerCommand = Readonly<Record<string, unknown> & { operation: string }>;
type WorkerResult = Readonly<{
  type: "result";
  ok: boolean;
  value?: unknown;
  error?: string;
}>;

function temporaryDatabasePath(context: test.TestContext, label: string): string {
  const directory = mkdtempSync(join(tmpdir(), `peas-sqlite-${label}-`));
  context.after(() => {
    const safePrefix = join(tmpdir(), `peas-sqlite-${label}-`);
    if (!directory.startsWith(safePrefix)) throw new Error("Unsafe concurrency cleanup path");
    rmSync(directory, { recursive: true, force: true });
  });
  return join(directory, "kernel.sqlite");
}

function initializeDatabase(databasePath: string): void {
  const database = openSqliteDatabase(databasePath, migrations);
  database.close();
}

function waitForMessage<T>(
  child: ChildProcess,
  predicate: (message: unknown) => message is T,
  label: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      child.off("message", onMessage);
      child.off("error", onError);
      child.off("exit", onExit);
    };
    const onMessage = (message: unknown): void => {
      if (!predicate(message)) return;
      cleanup();
      resolve(message);
    };
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
      cleanup();
      reject(new Error(`${label} exited before responding (code=${code}, signal=${signal})`));
    };
    child.on("message", onMessage);
    child.once("error", onError);
    child.once("exit", onExit);
  });
}

function isReady(message: unknown): message is Readonly<{ type: "ready" }> {
  return (
    typeof message === "object" && message !== null && "type" in message && message.type === "ready"
  );
}

function isResult(message: unknown): message is WorkerResult {
  return (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    message.type === "result"
  );
}

async function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((resolve, reject) => {
    child.once("exit", () => resolve());
    child.once("error", reject);
  });
}

async function executeConcurrently(
  databasePath: string,
  commands: readonly WorkerCommand[],
): Promise<readonly WorkerResult[]> {
  const active = commands.map(() =>
    fork(workerPath, [databasePath], { stdio: ["ignore", "ignore", "pipe", "ipc"] }),
  );
  try {
    await Promise.all(active.map((child) => waitForMessage(child, isReady, "SQLite worker")));
    const results = active.map((child) => waitForMessage(child, isResult, "SQLite worker result"));
    for (let index = 0; index < active.length; index += 1) {
      const child = active[index];
      const command = commands[index];
      if (child === undefined || command === undefined) throw new Error("Worker command mismatch");
      child.send(command);
    }
    const resolved = await Promise.all(results);
    await Promise.all(active.map(waitForExit));
    return resolved;
  } finally {
    for (const child of active) {
      if (child.exitCode === null && child.signalCode === null) child.kill();
    }
    await Promise.all(active.map(waitForExit));
  }
}

function sourceDraft(index: number, overrides: Partial<EventDraft> = {}): EventDraft {
  const issuerCik = "0000765432";
  const subject = `earnings:${issuerCik}:${FISCAL_PERIOD}`;
  const artifactHash = canonicalHash("peas/concurrency-artifact/v2", { index });
  return {
    envelopeVersion: 2,
    type: "earnings.source.observed",
    schemaVersion: 1,
    source: "concurrency-probe",
    subject,
    occurredAtMs: BASE_TIME_MS,
    correlationId: "concurrency-probe",
    provider: {
      provider: "concurrency-provider",
      recordId: `record-${index}`,
      revisionId: "1",
      artifactHash,
    },
    payload: {
      issuerCik,
      fiscalPeriod: FISCAL_PERIOD,
      sourceKind: "issuer_release",
      artifactHash,
      publishedAtMs: BASE_TIME_MS,
      timestampConfidence: "exact",
      originalTimestamp: null,
    },
    ...overrides,
  };
}

class CommitBarrier {
  readonly #participants: number;
  #arrived = 0;
  #release: (() => void) | undefined;
  readonly #open: Promise<void>;

  constructor(participants: number) {
    this.#participants = participants;
    this.#open = new Promise((resolve) => {
      this.#release = resolve;
    });
  }

  async arrive(): Promise<void> {
    this.#arrived += 1;
    if (this.#arrived === this.#participants) this.#release?.();
    await this.#open;
  }
}

class BarrierProcessingStore<TState extends JsonObject> implements ProcessingStore<TState> {
  readonly #delegate: ProcessingStore<TState>;
  readonly #barrier: CommitBarrier;

  constructor(delegate: ProcessingStore<TState>, barrier: CommitBarrier) {
    this.#delegate = delegate;
    this.#barrier = barrier;
  }

  async ensureRun(registration: RunRegistration): Promise<void> {
    await this.#delegate.ensureRun(registration);
  }

  async loadCursor(runId: string): Promise<RunCursor | undefined> {
    return this.#delegate.loadCursor(runId);
  }

  async loadAggregate(
    runId: string,
    aggregateId: string,
  ): Promise<AggregateCheckpoint<TState> | undefined> {
    return this.#delegate.loadAggregate(runId, aggregateId);
  }

  async commit(value: ProcessingCommit<TState>): Promise<void> {
    await this.#barrier.arrive();
    await this.#delegate.commit(value);
  }

  async readOutputsAfter(runId: string, sequence: string, limit: number): Promise<OutputPage> {
    return this.#delegate.readOutputsAfter(runId, sequence, limit);
  }

  async readAggregatesAfter(
    runId: string,
    aggregateId: string,
    limit: number,
  ): Promise<AggregatePage<TState>> {
    return this.#delegate.readAggregatesAfter(runId, aggregateId, limit);
  }
}

test("separate processes serialize same/conflicting capture and stream versions", async (context) => {
  const samePath = temporaryDatabasePath(context, "same-redelivery");
  initializeDatabase(samePath);
  const sameDraft = sourceDraft(1);
  const same = await executeConcurrently(samePath, [
    { operation: "append", nowMs: BASE_TIME_MS, draft: sameDraft },
    { operation: "append", nowMs: BASE_TIME_MS, draft: sameDraft },
  ]);
  assert.equal(
    same.every((result) => result.ok),
    true,
    canonicalJson(same as JsonValue),
  );
  const dispositions = same
    .map((result) => (result.value as { disposition: string }).disposition)
    .sort();
  assert.deepEqual(dispositions, ["appended", "redelivery"]);

  const conflictPath = temporaryDatabasePath(context, "conflicting-redelivery");
  initializeDatabase(conflictPath);
  const first = sourceDraft(2);
  const secondArtifact = canonicalHash("peas/concurrency-artifact/v2", { index: 2, variant: 2 });
  const second: EventDraft = {
    ...first,
    provider: { ...first.provider, artifactHash: secondArtifact },
    payload: { ...first.payload, artifactHash: secondArtifact },
  };
  const conflict = await executeConcurrently(conflictPath, [
    { operation: "append", nowMs: BASE_TIME_MS, draft: first },
    { operation: "append", nowMs: BASE_TIME_MS, draft: second },
  ]);
  assert.equal(conflict.filter((result) => result.ok).length, 1);
  assert.match(
    conflict.find((result) => !result.ok)?.error ?? "",
    /changed content without a new revision/u,
  );

  const allocationPath = temporaryDatabasePath(context, "stream-allocation");
  initializeDatabase(allocationPath);
  const allocation = await executeConcurrently(
    allocationPath,
    Array.from({ length: 8 }, (_, index) => ({
      operation: "append",
      nowMs: BASE_TIME_MS,
      draft: sourceDraft(100 + index),
    })),
  );
  assert.equal(
    allocation.every((result) => result.ok),
    true,
    canonicalJson(allocation as JsonValue),
  );
  const database = openSqliteDatabase(allocationPath, migrations);
  try {
    const versions = database
      .prepare("SELECT stream_version FROM events ORDER BY stream_version")
      .all()
      .map((row) => (row as { stream_version: bigint }).stream_version.toString());
    assert.deepEqual(
      versions,
      Array.from({ length: 8 }, (_, index) => String(index + 1)),
    );
    assert.equal(database.pragma("integrity_check", { simple: true }), "ok");
  } finally {
    database.close();
  }
});

test("competing processors cannot both commit the same cursor step", async (context) => {
  const databasePath = temporaryDatabasePath(context, "cursor-contention");
  const captured = await captureScenario();
  const expected = captured.events[0];
  assert.ok(expected);
  const manifest = makeManifest("cursor-contention", "research", false);

  const databaseA = openSqliteDatabase(databasePath, migrations);
  const clock = new ManualClock(expected.receivedAtMs);
  const logA = new SqliteEventLog(databaseA, { clock });
  const appended = await logA.append(draftFromStored(expected));
  assert.equal(canonicalJson(appended.event as unknown as JsonValue), canonicalJson(expected));
  const databaseB = openSqliteDatabase(databasePath, migrations);
  try {
    const logB = new SqliteEventLog(databaseB, { clock: new ManualClock(expected.receivedAtMs) });
    const barrier = new CommitBarrier(2);
    const processorA = new DeterministicProcessor({
      reducer: new EarningsClusterReducer(),
      store: new BarrierProcessingStore(
        new SqliteProcessingStore<EarningsClusterState>(databaseA),
        barrier,
      ),
      eventLog: logA,
      manifest,
    });
    const processorB = new DeterministicProcessor({
      reducer: new EarningsClusterReducer(),
      store: new BarrierProcessingStore(
        new SqliteProcessingStore<EarningsClusterState>(databaseB),
        barrier,
      ),
      eventLog: logB,
      manifest,
    });
    const eventA = await logA.get("1");
    const eventB = await logB.get("1");
    assert.ok(eventA);
    assert.ok(eventB);
    const contested = await Promise.allSettled([
      processorA.process(eventA),
      processorB.process(eventB),
    ]);
    assert.equal(contested.filter((result) => result.status === "fulfilled").length, 1);
    const rejection = contested.find((result) => result.status === "rejected");
    assert.ok(rejection);
    assert.match(String(rejection.reason), /Cursor concurrency conflict/u);

    const sqliteProcessor = new DeterministicProcessor({
      reducer: new EarningsClusterReducer(),
      store: new SqliteProcessingStore<EarningsClusterState>(databaseA),
      eventLog: logA,
      manifest,
    });
    const sqliteSnapshot = await sqliteProcessor.snapshot(1);
    const memoryLog = new CapturedEventLog([expected]);
    const memoryProcessor = new DeterministicProcessor({
      reducer: new EarningsClusterReducer(),
      store: new InMemoryProcessingStore<EarningsClusterState>(memoryLog),
      eventLog: memoryLog,
      manifest,
    });
    await memoryProcessor.processAvailable(1);
    const memorySnapshot = await memoryProcessor.snapshot(1);
    assert.equal(
      canonicalJson(sqliteSnapshot as unknown as JsonValue),
      canonicalJson(memorySnapshot as unknown as JsonValue),
    );
  } finally {
    databaseB.close();
    databaseA.close();
  }
});

test("competing job and outbox claimers receive disjoint fenced leases", async (context) => {
  const databasePath = temporaryDatabasePath(context, "claim-contention");
  const captured = await captureScenario();
  const expected = captured.events[0];
  assert.ok(expected);
  const database = openSqliteDatabase(databasePath, migrations);
  const log = new SqliteEventLog(database, { clock: new ManualClock(expected.receivedAtMs) });
  await log.append(draftFromStored(expected));
  const runId = "claim-contention-live";
  const processor = new DeterministicProcessor({
    reducer: new EarningsClusterReducer(),
    store: new SqliteProcessingStore<EarningsClusterState>(database),
    eventLog: log,
    manifest: makeManifest(runId, "live", true),
  });
  await processor.processAvailable(1);
  const dueNow = expected.logicalAtMs + CONFIG.lifecycleMs + 1;
  const jobCount = Number(
    (database.prepare("SELECT count(*) AS count FROM jobs").get() as { count: bigint }).count,
  );
  const outboxCount = Number(
    (database.prepare("SELECT count(*) AS count FROM outbox").get() as { count: bigint }).count,
  );
  database.close();

  const jobResults = await executeConcurrently(databasePath, [
    {
      operation: "claimJobs",
      runId,
      workerId: "job-worker-a",
      nowMs: dueNow,
      leaseMs: 30_000,
      limit: 2,
    },
    {
      operation: "claimJobs",
      runId,
      workerId: "job-worker-b",
      nowMs: dueNow,
      leaseMs: 30_000,
      limit: 2,
    },
  ]);
  assert.equal(
    jobResults.every((result) => result.ok),
    true,
    canonicalJson(jobResults as unknown as JsonValue),
  );
  const jobClaims = jobResults.map(
    (result) => result.value as readonly { outputId: string; fencingToken: number }[],
  );
  const jobIds = jobClaims.flat().map((claim) => claim.outputId);
  assert.equal(new Set(jobIds).size, jobIds.length);
  assert.equal(jobIds.length, jobCount);
  assert.equal(
    jobClaims.flat().every((claim) => claim.fencingToken === 1),
    true,
  );

  const outboxResults = await executeConcurrently(databasePath, [
    {
      operation: "claimOutbox",
      runId,
      workerId: "outbox-worker-a",
      nowMs: dueNow,
      leaseMs: 30_000,
      limit: 1,
    },
    {
      operation: "claimOutbox",
      runId,
      workerId: "outbox-worker-b",
      nowMs: dueNow,
      leaseMs: 30_000,
      limit: 1,
    },
  ]);
  assert.equal(
    outboxResults.every((result) => result.ok),
    true,
    canonicalJson(outboxResults as unknown as JsonValue),
  );
  const outboxIds = outboxResults
    .flatMap((result) => result.value as readonly { outputId: string }[])
    .map((claim) => claim.outputId);
  assert.equal(new Set(outboxIds).size, outboxIds.length);
  assert.equal(outboxIds.length, outboxCount);

  const verification = openSqliteDatabase(databasePath, migrations);
  try {
    assert.equal(verification.pragma("integrity_check", { simple: true }), "ok");
    assert.equal(
      Number(
        (
          verification
            .prepare("SELECT count(*) AS count FROM jobs WHERE status = 'leased'")
            .get() as {
            count: bigint;
          }
        ).count,
      ),
      jobCount,
    );
    assert.equal(
      Number(
        (
          verification
            .prepare("SELECT count(*) AS count FROM outbox WHERE status = 'leased'")
            .get() as { count: bigint }
        ).count,
      ),
      outboxCount,
    );
  } finally {
    verification.close();
  }
});
