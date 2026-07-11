import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";

import { CapturedEventLog } from "../src/adapters/memory/captured-event-log.js";
import { InMemoryProcessingStore } from "../src/adapters/memory/processing-store.js";
import { loadMigrations, openSqliteDatabase } from "../src/adapters/sqlite/database.js";
import { SqliteEventLog } from "../src/adapters/sqlite/event-log.js";
import { SqliteProcessingStore } from "../src/adapters/sqlite/processing-store.js";
import { ManualClock } from "../src/core/clock.js";
import type { EventDraft, StoredEvent } from "../src/core/event.js";
import { canonicalHash } from "../src/core/hash.js";
import { canonicalJson, type JsonObject, type JsonValue } from "../src/core/json.js";
import { DeterministicProcessor } from "../src/core/processor.js";
import {
  EarningsClusterReducer,
  type EarningsClusterState,
  type SourceKind,
} from "../src/domain/earnings-cluster/reducer.js";
import { BASE_TIME_MS, CONFIG, FISCAL_PERIOD, makeManifest } from "./scenario.js";

const migrations = loadMigrations(join(process.cwd(), "migrations"));
const sourceKinds: readonly SourceKind[] = [
  "issuer_release",
  "fmp_release",
  "sec_8k",
  "call",
  "transcript",
  "filing",
];

function temporaryDatabasePath(context: test.TestContext, label: string): string {
  const directory = mkdtempSync(join(tmpdir(), `peas-scale-${label}-`));
  context.after(() => {
    const safePrefix = join(tmpdir(), `peas-scale-${label}-`);
    if (!directory.startsWith(safePrefix)) throw new Error("Unsafe scale cleanup path");
    rmSync(directory, { recursive: true, force: true });
  });
  return join(directory, "kernel.sqlite");
}

function sourceDraft(options: {
  index: number;
  issuerCik: string;
  subject?: string;
  sourceKind?: SourceKind;
  occurredAtMs: number;
}): EventDraft {
  const artifactHash = canonicalHash("peas/scale-artifact/v2", {
    index: options.index,
    issuerCik: options.issuerCik,
  });
  return {
    envelopeVersion: 2,
    type: "earnings.source.observed",
    schemaVersion: 1,
    source: "scale-fixture",
    subject: options.subject ?? `earnings:${options.issuerCik}:${FISCAL_PERIOD}`,
    occurredAtMs: options.occurredAtMs,
    correlationId: `scale-${options.issuerCik}`,
    provider: {
      provider: `scale-provider-${options.index % 7}`,
      recordId: `scale-record-${options.index}`,
      revisionId: "1",
      artifactHash,
    },
    payload: {
      issuerCik: options.issuerCik,
      fiscalPeriod: FISCAL_PERIOD,
      sourceKind: options.sourceKind ?? "issuer_release",
      artifactHash,
      publishedAtMs: options.occurredAtMs,
      timestampConfidence: "exact",
      originalTimestamp: null,
    },
  };
}

function quantile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1);
  return sorted[index] ?? 0;
}

function linearSlope(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const midpoint = (values.length - 1) / 2;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  let numerator = 0;
  let denominator = 0;
  for (let index = 0; index < values.length; index += 1) {
    const x = index - midpoint;
    numerator += x * ((values[index] ?? 0) - mean);
    denominator += x * x;
  }
  return denominator === 0 ? 0 : numerator / denominator;
}

function fileSize(path: string): number {
  return existsSync(path) ? statSync(path).size : 0;
}

type ScaleBudget = Readonly<{
  minThroughputPerSecond: number;
  maxP95Ms: number;
  maxP99Ms: number;
  maxSlopePerEvent: number;
  maxProcessingRssDeltaBytes: number;
  maxDatabaseBytes: number;
  maxWalBytes: number;
}>;

type ScalePolicy = Readonly<{
  policyVersion: 1;
  metricsVersion: 2;
  measurementModel: "event-processing-then-streaming-audit-scan";
  workload: Readonly<{
    name: "sparse-single-source-per-issuer-v1";
    sourcesPerIssuer: 1;
    writerCount: 1;
  }>;
  budgets: Readonly<Record<string, ScaleBudget>>;
}>;

const SCALE_POLICY_PATH = "config/scale-policy.v1.json";
const scalePolicyBytes = readFileSync(SCALE_POLICY_PATH);
const scalePolicy = JSON.parse(scalePolicyBytes.toString("utf8")) as ScalePolicy;
assert.equal(scalePolicy.policyVersion, 1);
assert.equal(scalePolicy.metricsVersion, 2);
assert.equal(scalePolicy.measurementModel, "event-processing-then-streaming-audit-scan");
assert.deepEqual(scalePolicy.workload, {
  name: "sparse-single-source-per-issuer-v1",
  sourcesPerIssuer: 1,
  writerCount: 1,
});
assert.deepEqual(Object.keys(scalePolicy.budgets).sort(), ["1000", "10000", "100000"]);
const scalePolicySha256 = createHash("sha256").update(scalePolicyBytes).digest("hex");
const SCALE_BUDGETS = new Map<number, ScaleBudget>(
  Object.entries(scalePolicy.budgets).map(([count, budget]) => [Number(count), budget]),
);

function verifiedCandidateGitIdentity(): {
  candidateCommitSha: string;
  worktreeClean: boolean;
} {
  const actualSha = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
    windowsHide: true,
  }).trim();
  const expectedSha = process.env["PEAS_CANDIDATE_SHA"];
  if (process.env["CI"] === "true" && expectedSha === undefined) {
    throw new Error("CI scale gates must declare PEAS_CANDIDATE_SHA");
  }
  if (expectedSha !== undefined && actualSha !== expectedSha) {
    throw new Error(
      `Scale metrics SHA mismatch: expected ${expectedSha}, checked out ${actualSha}`,
    );
  }
  const worktreeClean =
    execFileSync("git", ["status", "--porcelain"], {
      encoding: "utf8",
      windowsHide: true,
    }).trim().length === 0;
  if (process.env["PEAS_SCALE_METRICS_PATH"] !== undefined && !worktreeClean) {
    throw new Error("Refusing scale metrics from a dirty worktree");
  }
  return { candidateCommitSha: actualSha, worktreeClean };
}

async function runSqliteScale(
  context: test.TestContext,
  clusterCount: number,
  label: string,
): Promise<void> {
  const databasePath = temporaryDatabasePath(context, label);
  const database = openSqliteDatabase(databasePath, migrations);
  const clock = new ManualClock(BASE_TIME_MS);
  const eventLog = new SqliteEventLog(database, { clock });
  const store = new SqliteProcessingStore<EarningsClusterState>(database);
  const manifest = makeManifest(`sqlite-scale-${label}`, "research", false);
  const processor = new DeterministicProcessor({
    reducer: new EarningsClusterReducer(),
    store,
    eventLog,
    manifest,
  });
  const budget = SCALE_BUDGETS.get(clusterCount);
  if (budget === undefined) throw new Error(`Missing scale budget for ${clusterCount} clusters`);
  const latencies: number[] = [];
  const rssBefore = process.memoryUsage().rss;
  const started = performance.now();
  try {
    for (let index = 0; index < clusterCount; index += 1) {
      const issuerCik = String(index + 1).padStart(10, "0");
      const before = performance.now();
      const appended = await eventLog.append(
        sourceDraft({ index, issuerCik, occurredAtMs: clock.nowMs() }),
      );
      await processor.process(appended.event);
      latencies.push(performance.now() - before);
      clock.advanceBy(1);
    }
    const elapsedMs = performance.now() - started;
    const rssAfterProcessing = process.memoryUsage().rss;
    const auditScanStarted = performance.now();
    const cursor = await store.loadCursor(manifest.runId);
    let aggregateCount = 0;
    let maxCheckpointBytes = 0;
    let aggregateCursor = "";
    while (true) {
      const page = await store.readAggregatesAfter(manifest.runId, aggregateCursor, 1_000);
      for (const aggregate of page.aggregates) {
        aggregateCount += 1;
        maxCheckpointBytes = Math.max(
          maxCheckpointBytes,
          Buffer.byteLength(canonicalJson(aggregate.state), "utf8"),
        );
      }
      aggregateCursor = page.nextAggregateId;
      if (!page.hasMore) break;
    }
    let outputCount = 0;
    let outputCursor = "0";
    while (true) {
      const page = await store.readOutputsAfter(manifest.runId, outputCursor, 1_000);
      outputCount += page.outputs.length;
      outputCursor = page.nextSequence;
      if (!page.hasMore) break;
    }
    const auditScanMs = performance.now() - auditScanStarted;
    const rssAfterAuditScan = process.memoryUsage().rss;
    const sorted = [...latencies].sort((left, right) => left - right);
    const { candidateCommitSha, worktreeClean } = verifiedCandidateGitIdentity();
    assert.ok(cursor);
    assert.equal(cursor.processedPosition, String(clusterCount));
    assert.equal(aggregateCount, clusterCount);
    assert.ok(outputCount >= clusterCount, "audit scan did not observe the expected outputs");
    assert.ok(maxCheckpointBytes < 32_000, `checkpoint exceeded 32 KiB: ${maxCheckpointBytes}`);
    const integrityCheck = database.pragma("integrity_check", { simple: true });
    assert.equal(integrityCheck, "ok");
    const throughputPerSecond = clusterCount / (elapsedMs / 1_000);
    const latencyMs = {
      p50: quantile(sorted, 0.5),
      p95: quantile(sorted, 0.95),
      p99: quantile(sorted, 0.99),
      max: sorted.at(-1) ?? 0,
      slopePerEvent: linearSlope(latencies),
    };
    const processingRssDelta = rssAfterProcessing - rssBefore;
    const storageBytes = {
      database: fileSize(databasePath),
      wal: fileSize(`${databasePath}-wal`),
    };
    assert.ok(
      throughputPerSecond >= budget.minThroughputPerSecond,
      `throughput ${throughputPerSecond}/s fell below ${budget.minThroughputPerSecond}/s`,
    );
    assert.ok(latencyMs.p95 <= budget.maxP95Ms, `p95 ${latencyMs.p95}ms exceeded budget`);
    assert.ok(latencyMs.p99 <= budget.maxP99Ms, `p99 ${latencyMs.p99}ms exceeded budget`);
    assert.ok(
      latencyMs.slopePerEvent <= budget.maxSlopePerEvent,
      `latency slope ${latencyMs.slopePerEvent}ms/event exceeded budget`,
    );
    assert.ok(
      processingRssDelta <= budget.maxProcessingRssDeltaBytes,
      `processing RSS delta ${processingRssDelta} exceeded budget`,
    );
    assert.ok(
      storageBytes.database <= budget.maxDatabaseBytes,
      `database size ${storageBytes.database} exceeded budget`,
    );
    assert.ok(
      storageBytes.wal <= budget.maxWalBytes,
      `WAL size ${storageBytes.wal} exceeded budget`,
    );
    const metrics = {
      metricsVersion: scalePolicy.metricsVersion,
      measurementModel: scalePolicy.measurementModel,
      scalePolicy: {
        policyVersion: scalePolicy.policyVersion,
        path: SCALE_POLICY_PATH,
        fileSha256: scalePolicySha256,
      },
      workload: {
        name: scalePolicy.workload.name,
        eventCount: clusterCount,
        issuerCount: clusterCount,
        sourcesPerIssuer: scalePolicy.workload.sourcesPerIssuer,
        writerCount: scalePolicy.workload.writerCount,
      },
      gateStatus: "passed",
      integrityCheck,
      candidateCommitSha,
      worktreeClean,
      clusterCount,
      elapsedMs,
      throughputPerSecond,
      latencyMs,
      rssBytes: {
        before: rssBefore,
        afterProcessing: rssAfterProcessing,
        processingDelta: processingRssDelta,
        afterAuditScan: rssAfterAuditScan,
        auditScanDelta: rssAfterAuditScan - rssAfterProcessing,
        after: rssAfterAuditScan,
        delta: rssAfterAuditScan - rssBefore,
      },
      auditScan: {
        pageSize: 1_000,
        elapsedMs: auditScanMs,
        aggregateCount,
        outputCount,
      },
      storageBytes,
      maxCheckpointBytes,
      performanceBudget: budget,
    };
    context.diagnostic(`PEAS SQLite scale metrics: ${JSON.stringify(metrics)}`);
    const metricsPath = process.env["PEAS_SCALE_METRICS_PATH"];
    if (metricsPath !== undefined) {
      writeFileSync(metricsPath.replace("{label}", label), `${JSON.stringify(metrics, null, 2)}\n`);
    }
  } finally {
    database.close();
  }
}

test("one dense cluster retains all 32 source snapshots within its bounded checkpoint", async (context) => {
  const databasePath = temporaryDatabasePath(context, "dense-32");
  const database = openSqliteDatabase(databasePath, migrations);
  const clock = new ManualClock(BASE_TIME_MS);
  const eventLog = new SqliteEventLog(database, { clock });
  const processor = new DeterministicProcessor({
    reducer: new EarningsClusterReducer(),
    store: new SqliteProcessingStore<EarningsClusterState>(database),
    eventLog,
    manifest: makeManifest("dense-32", "research", false),
  });
  try {
    const issuerCik = "0000999999";
    for (let index = 0; index < CONFIG.maxSourcesPerCluster; index += 1) {
      const sourceKind = sourceKinds[index % sourceKinds.length];
      assert.ok(sourceKind);
      const appended = await eventLog.append(
        sourceDraft({ index, issuerCik, sourceKind, occurredAtMs: clock.nowMs() }),
      );
      await processor.process(appended.event);
      clock.advanceBy(1);
    }
    const atCap = await processor.snapshot(7);
    assert.equal(atCap.aggregates.length, 1);
    const cluster = atCap.aggregates[0]?.state.cluster;
    assert.ok(cluster);
    assert.equal(cluster.sources.length, 32);
    assert.ok(cluster.analysisBranches.length > 0);
    assert.ok(cluster.analysisBranches.length <= CONFIG.maxAnalysisBranches);
    assert.equal(atCap.aggregates[0]?.state.rejectionCount, 0);
    const stateAtCap = canonicalJson(atCap.aggregates[0]?.state);
    const overflow = await eventLog.append(
      sourceDraft({
        index: CONFIG.maxSourcesPerCluster,
        issuerCik,
        sourceKind: "call",
        occurredAtMs: clock.nowMs(),
      }),
    );
    await processor.process(overflow.event);
    const afterOverflow = await processor.snapshot(7);
    const overflowAggregate = afterOverflow.aggregates[0];
    assert.ok(overflowAggregate);
    assert.equal(canonicalJson(overflowAggregate.state), stateAtCap);
    assert.equal(afterOverflow.cursor.processedPosition, String(CONFIG.maxSourcesPerCluster + 1));

    const checkpointBytes = Buffer.byteLength(stateAtCap, "utf8");
    context.diagnostic(`PEAS dense-cluster checkpoint bytes: ${checkpointBytes}`);
    assert.ok(checkpointBytes < 128_000, `dense checkpoint exceeded 128 KiB: ${checkpointBytes}`);
    assert.equal(database.pragma("integrity_check", { simple: true }), "ok");
  } finally {
    database.close();
  }
});

test("poison and unknown event flood advances without wedging and matches memory", async (context) => {
  const databasePath = temporaryDatabasePath(context, "poison-flood");
  const database = openSqliteDatabase(databasePath, migrations);
  const clock = new ManualClock(BASE_TIME_MS);
  const eventLog = new SqliteEventLog(database, { clock });
  const manifest = makeManifest("poison-flood", "research", false);
  const captured: StoredEvent[] = [];
  const eventCount = 512;
  try {
    for (let index = 0; index < eventCount; index += 1) {
      const artifactHash = canonicalHash("peas/poison-artifact/v2", { index });
      const payload: JsonObject =
        index % 2 === 0
          ? { opaque: `unknown-${index}-漢字-🧪` }
          : { issuerCik: "not-a-cik", opaque: `malformed-${index}` };
      const draft: EventDraft = {
        envelopeVersion: 2,
        type: index % 2 === 0 ? "provider.payload.unknown" : "earnings.source.observed",
        schemaVersion: 1,
        source: "poison-fixture",
        subject: `poison:${index}`,
        occurredAtMs: clock.nowMs(),
        correlationId: `poison-${index}`,
        provider: {
          provider: "poison-provider",
          recordId: `poison-${index}`,
          revisionId: "1",
          artifactHash,
        },
        payload,
      };
      captured.push((await eventLog.append(draft)).event);
      clock.advanceBy(1);
    }
    const sqliteProcessor = new DeterministicProcessor({
      reducer: new EarningsClusterReducer(),
      store: new SqliteProcessingStore<EarningsClusterState>(database),
      eventLog,
      manifest,
    });
    await sqliteProcessor.processAvailable(7);
    const sqliteSnapshot = await sqliteProcessor.snapshot(7);
    assert.equal(sqliteSnapshot.cursor.processedPosition, String(eventCount));
    assert.equal(sqliteSnapshot.outputs.length, eventCount);
    assert.equal(sqliteSnapshot.aggregates.length, eventCount);
    assert.equal(
      sqliteSnapshot.aggregates.reduce((sum, aggregate) => sum + aggregate.state.rejectionCount, 0),
      eventCount / 2,
    );

    const memoryLog = new CapturedEventLog(captured);
    const memoryProcessor = new DeterministicProcessor({
      reducer: new EarningsClusterReducer(),
      store: new InMemoryProcessingStore<EarningsClusterState>(memoryLog),
      eventLog: memoryLog,
      manifest,
    });
    await memoryProcessor.processAvailable(1_000);
    const memorySnapshot = await memoryProcessor.snapshot(1_000);
    assert.equal(
      canonicalJson(sqliteSnapshot as unknown as JsonValue),
      canonicalJson(memorySnapshot as unknown as JsonValue),
    );
    assert.equal(database.pragma("integrity_check", { simple: true }), "ok");
  } finally {
    database.close();
  }
});

test("SQLite 1k-cluster scale gate records latency, memory, and storage metrics", async (context) => {
  await runSqliteScale(context, 1_000, "1k");
});

test("SQLite 10k-cluster extended scale gate", {
  skip: process.env["PEAS_SCALE_10K"] !== "1",
  timeout: 10 * 60_000,
}, async (context) => {
  await runSqliteScale(context, 10_000, "10k");
});

test("SQLite 100k-cluster nightly scale gate", {
  skip: process.env["PEAS_SCALE_100K"] !== "1",
  timeout: 60 * 60_000,
}, async (context) => {
  await runSqliteScale(context, 100_000, "100k");
});
