import assert from "node:assert/strict";
import { createReadStream, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DurableArtifactStore } from "../src/adapters/artifacts/durable-artifact-store.js";
import { artifactRuntimePaths } from "../src/adapters/artifacts/runtime-root.js";
import { SqliteArtifactRepository } from "../src/adapters/artifacts/sqlite-artifact-repository.js";
import { loadRecordedMarketFixture } from "../src/adapters/market-reference/recorded-market-loader.js";
import { CapturedEventLog } from "../src/adapters/memory/captured-event-log.js";
import { InMemoryProcessingStore } from "../src/adapters/memory/processing-store.js";
import { loadMigrations, openSqliteDatabase } from "../src/adapters/sqlite/database.js";
import { SqliteEventLog } from "../src/adapters/sqlite/event-log.js";
import { SqliteProcessingStore } from "../src/adapters/sqlite/processing-store.js";
import type { ArtifactVaultConfig } from "../src/artifacts/artifact-store.js";
import { ManualClock } from "../src/core/clock.js";
import { draftFromStored } from "../src/core/event.js";
import { canonicalHash } from "../src/core/hash.js";
import { canonicalJson, type JsonObject, type JsonValue } from "../src/core/json.js";
import { DeterministicProcessor, type Reducer, type RunManifest } from "../src/core/processor.js";
import {
  checkedRecordedMarketFixtureAuthority,
  loadCheckedRecordedMarketFixture,
} from "./market-reference-scenario.js";
import { captureScenario } from "./scenario.js";

type MarketConfig = Readonly<{ result: JsonObject }>;
type MarketState = JsonObject &
  Readonly<{
    aggregateId: string;
    processedEventIds: readonly string[];
    result: JsonObject | null;
  }>;

class MarketReferenceReducer implements Reducer<MarketState, MarketConfig> {
  readonly name = "market-reference-integration";
  readonly version = "v1";

  route(): string {
    return "market-reference-integration";
  }

  parseState(value: unknown): MarketState {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("invalid market integration state");
    }
    const candidate = value as Partial<MarketState>;
    if (
      typeof candidate.aggregateId !== "string" ||
      !Array.isArray(candidate.processedEventIds) ||
      candidate.processedEventIds.some((eventId) => typeof eventId !== "string") ||
      (candidate.result !== null &&
        (typeof candidate.result !== "object" || Array.isArray(candidate.result)))
    ) {
      throw new Error("invalid market integration state");
    }
    return candidate as MarketState;
  }

  initialState(aggregateId: string): MarketState {
    return { aggregateId, processedEventIds: [], result: null };
  }

  apply(
    state: Readonly<MarketState>,
    event: Parameters<Reducer<MarketState, MarketConfig>["apply"]>[1],
    context: Parameters<Reducer<MarketState, MarketConfig>["apply"]>[2],
  ) {
    return {
      state: {
        aggregateId: state.aggregateId,
        processedEventIds: [...state.processedEventIds, event.eventId],
        result: context.config.result,
      },
      decisions: [{ type: "market-reference.selected", payload: context.config.result }],
      jobs: [],
      outbox: [],
    };
  }
}

const migrations = loadMigrations(join(process.cwd(), "migrations"));

function canonical(value: unknown): string {
  return canonicalJson(value as JsonValue);
}

function temporaryDatabasePath(context: test.TestContext): string {
  const directory = mkdtempSync(join(tmpdir(), "peas-market-reference-persistence-"));
  context.after(() => {
    const safePrefix = join(tmpdir(), "peas-market-reference-persistence-");
    if (!directory.startsWith(safePrefix)) throw new Error("unsafe persistence cleanup path");
    rmSync(directory, { recursive: true, force: true });
  });
  return join(directory, "market-reference.sqlite");
}

function temporaryVaultRoot(context: test.TestContext): string {
  const directory = mkdtempSync(join(tmpdir(), "peas-market-reference-vault-"));
  context.after(() => {
    const safePrefix = join(tmpdir(), "peas-market-reference-vault-");
    if (!directory.startsWith(safePrefix)) throw new Error("unsafe vault cleanup path");
    rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

function vaultConfig(runtimeRoot: string): ArtifactVaultConfig {
  return {
    runtimeRootMode: "ci-temporary",
    runtimeRoot,
    maxArtifactBytes: 10 * 1024 * 1024,
    maxVaultBytes: 64 * 1024 * 1024,
    maxConcurrentWrites: 2,
    streamHighWaterMarkBytes: 257,
    stageExpiryMs: 60_000,
    writerLeaseBehavior: "fail",
    writerLeaseWaitMs: 0,
    writerLeaseDurationMs: 30_000,
    writerLeaseRenewalMs: 10_000,
  };
}

async function bounded<T>(label: string, operation: Promise<T>): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} exceeded 30 seconds`)), 30_000);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}

function manifest(result: JsonObject): RunManifest<MarketConfig> {
  return {
    manifestVersion: 2,
    runId: "market-reference-persistence-v1",
    kind: "research",
    effectsAllowed: false,
    canonicalizationVersion: "peas-json-v1",
    behavior: {
      reducerName: "market-reference-integration",
      reducerVersion: "v1",
      buildDigest: canonicalHash("peas/market-reference-integration-build/v1", { version: 1 }),
      schemaRegistryDigest: canonicalHash("peas/market-reference-integration-schema/v1", {
        version: 1,
      }),
      configuration: { result },
      identities: {
        extractorVersion: "market-reference-recorded-v1",
        featureSetId: null,
        modelId: null,
        promptId: null,
        datasetId: null,
      },
    },
  };
}

test("market results are byte-identical across memory, SQLite restart, and page sizes", async (context) => {
  const captured = await captureScenario();
  const checked = await loadCheckedRecordedMarketFixture();
  assert.equal(checked.result.status, "verified");
  const result = checked.result.evaluations[0];
  assert.ok(result !== undefined);
  const resultJson = JSON.parse(canonical(result)) as JsonObject;
  const runManifest = manifest(resultJson);

  const memoryLog = new CapturedEventLog(captured.events);
  const memory = new DeterministicProcessor({
    reducer: new MarketReferenceReducer(),
    store: new InMemoryProcessingStore<MarketState>(memoryLog),
    eventLog: memoryLog,
    manifest: runManifest,
  });
  await memory.processAvailable(7);
  const memorySnapshot = await memory.snapshot(2);

  const databasePath = temporaryDatabasePath(context);
  for (const event of captured.events) {
    const restartedFixture = await loadCheckedRecordedMarketFixture();
    assert.equal(restartedFixture.result.status, "verified");
    assert.equal(canonical(restartedFixture.result.evaluations[0]), canonical(result));
    const database = openSqliteDatabase(databasePath, migrations);
    try {
      const replayLog = new SqliteEventLog(database, {
        clock: new ManualClock(event.receivedAtMs),
      });
      const appended = await replayLog.append(draftFromStored(event));
      assert.equal(canonical(appended.event), canonical(event));
      const processor = new DeterministicProcessor({
        reducer: new MarketReferenceReducer(),
        store: new SqliteProcessingStore<MarketState>(database),
        eventLog: replayLog,
        manifest: runManifest,
      });
      await processor.process(appended.event);
    } finally {
      database.close();
    }
  }

  const database = openSqliteDatabase(databasePath, migrations);
  try {
    assert.equal(database.pragma("integrity_check", { simple: true }), "ok");
    const replayLog = new SqliteEventLog(database, { clock: new ManualClock(0) });
    const sqlite = new DeterministicProcessor({
      reducer: new MarketReferenceReducer(),
      store: new SqliteProcessingStore<MarketState>(database),
      eventLog: replayLog,
      manifest: runManifest,
    });
    const sqliteSnapshot = await sqlite.snapshot(1);
    assert.equal(canonical(sqliteSnapshot), canonical(memorySnapshot));
    assert.equal(runManifest.effectsAllowed, false);
    assert.ok(
      sqliteSnapshot.outputs.every(
        (output) =>
          output.category === "decision" && output.body["type"] === "market-reference.selected",
      ),
    );
  } finally {
    database.close();
  }
});

test("checked bytes survive durable ArtifactStore restart and observation page sizes", async (context) => {
  const memory = await loadCheckedRecordedMarketFixture();
  assert.equal(memory.result.status, "verified");
  const authority = await checkedRecordedMarketFixtureAuthority();
  const runtimeRoot = temporaryVaultRoot(context);
  const paths = artifactRuntimePaths(runtimeRoot);
  mkdirSync(paths.databaseDirectory, { recursive: true });
  const clock = new ManualClock(Math.min(...authority.seeds.map((seed) => seed.retrievedAtMs)));
  let database = openSqliteDatabase(paths.databasePath, migrations);
  let store = await bounded(
    "initial durable store open",
    DurableArtifactStore.open({
      repository: new SqliteArtifactRepository(database),
      clock,
      config: vaultConfig(runtimeRoot),
    }),
  );
  for (const seed of authority.seeds) {
    clock.advanceTo(seed.retrievedAtMs);
    const stored = await bounded(
      `initial store ${seed.role}`,
      store.store({
        attempt: seed.attempt,
        response: seed.response,
        entityBytes: createReadStream(join(authority.fixtureRoot, seed.path)),
      }),
    );
    assert.equal(stored.artifact.digest, seed.artifactHash);
    const expectedMember = authority.manifest.retrievedMembers.find(
      (member) => member.role === seed.role,
    );
    assert.ok(expectedMember !== undefined);
    assert.equal(stored.observation.observationId, expectedMember.selectedObservationId);

    for (let duplicate = 1; duplicate <= 1; duplicate += 1) {
      await bounded(
        `redelivery store ${seed.role}`,
        store.store({
          attempt: {
            ...seed.attempt,
            attemptId: `${seed.attempt.attemptId}-redelivery-${duplicate}`,
          },
          response: seed.response,
          entityBytes: createReadStream(join(authority.fixtureRoot, seed.path)),
        }),
      );
    }
  }
  await bounded("initial durable store close", store.close());
  database.close();
  clock.advanceBy(30_001);

  database = openSqliteDatabase(paths.databasePath, migrations);
  store = await bounded(
    "restart durable store open",
    DurableArtifactStore.open({
      repository: new SqliteArtifactRepository(database),
      clock,
      config: vaultConfig(runtimeRoot),
    }),
  );
  try {
    const durable = await bounded(
      "restarted recorded fixture load",
      loadRecordedMarketFixture(store, authority.manifest),
    );
    assert.equal(durable.status, "verified");
    assert.equal(canonical(durable.normalizedFacts), canonical(memory.result.normalizedFacts));
    assert.equal(canonical(durable.evaluations), canonical(memory.result.evaluations));

    for (const seed of authority.seeds) {
      let expected: string | undefined;
      for (const pageSize of [1, 2, 7, 10_000]) {
        const observations = [];
        let afterSequence = "0";
        let hasMore = true;
        while (hasMore) {
          const page = await bounded(
            `observation page ${pageSize}`,
            store.readObservations(seed.artifactHash, afterSequence, pageSize),
          );
          observations.push(...page.items);
          afterSequence = page.nextSequence;
          hasMore = page.hasMore;
        }
        const projection = canonical(
          observations.map((observation) => ({
            observationId: observation.observationId,
            observationHash: observation.observationHash,
            artifactDigest: observation.artifactDigest,
          })),
        );
        expected ??= projection;
        assert.equal(projection, expected, `observation page size ${pageSize}`);
      }
    }
  } finally {
    await bounded("restarted durable store close", store.close());
    database.close();
  }
});
