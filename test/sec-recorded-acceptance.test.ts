import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import { SEC_FIXTURE_CASES, type SecFixtureCase } from "../fixtures/sec/v1/manifest.js";
import { DurableArtifactStore } from "../src/adapters/artifacts/durable-artifact-store.js";
import { artifactRuntimePaths } from "../src/adapters/artifacts/runtime-root.js";
import { SqliteArtifactRepository } from "../src/adapters/artifacts/sqlite-artifact-repository.js";
import { CapturedEventLog } from "../src/adapters/memory/captured-event-log.js";
import { InMemoryEventLog } from "../src/adapters/memory/event-log.js";
import { InMemoryProcessingStore } from "../src/adapters/memory/processing-store.js";
import {
  loadRecordedSecBundle,
  type RecordedSecBundleManifest,
  runRecordedSecPipeline,
} from "../src/adapters/sec/recorded-sec-pipeline.js";
import { loadMigrations, openSqliteDatabase } from "../src/adapters/sqlite/database.js";
import { SqliteEventLog } from "../src/adapters/sqlite/event-log.js";
import { SqliteProcessingStore } from "../src/adapters/sqlite/processing-store.js";
import type {
  ArtifactStore,
  ArtifactVaultConfig,
  StoreArtifactResult,
  VerifiedArtifactRead,
} from "../src/artifacts/artifact-store.js";
import { sanitizeRequestIdentity } from "../src/artifacts/identity.js";
import { type Clock, ManualClock } from "../src/core/clock.js";
import type { EventDraft, EventLog, StoredEvent } from "../src/core/event.js";
import { canonicalJson, type JsonValue } from "../src/core/json.js";
import { DeterministicProcessor, type RunKind } from "../src/core/processor.js";
import {
  EarningsClusterReducer,
  type EarningsClusterState,
} from "../src/domain/earnings-cluster/reducer.js";
import { computeSecNormalizationTranscriptHash } from "../src/providers/sec/normalizer.js";
import { makeManifest } from "./scenario.js";

const FIXTURE_ROOT = join(process.cwd(), "fixtures", "sec", "v1");
const VECTOR_ROOT = join(process.cwd(), "fixtures");
const CAPTURE_PATH = join(VECTOR_ROOT, "recorded-sec-pr2b.captured.ndjson");
const GOLDEN_PATH = join(VECTOR_ROOT, "recorded-sec-pr2b.golden.json");
const MIGRATIONS = loadMigrations(join(process.cwd(), "migrations"));
const PAGE_SIZES = [1, 2, 7, 10_000] as const;
const EMITTED_CASE_IDS = [
  "valid-item-202",
  "valid-10q-inline-focus",
  "valid-10k-separate-xbrl",
  "accession-prefix-different",
  "amendment-8ka-distinct-accession",
  "amendment-10qa-distinct-accession",
  "amendment-10ka-distinct-accession",
] as const;
const CAPTURE_TIME_MS = 1_800_000_000_000;

const REQUEST = sanitizeRequestIdentity({
  method: "GET",
  origin: "https://fixture.invalid",
  path: "/recorded",
  routeLabel: "recorded-sec-fixture",
});

type MutableClock = Clock & { set(value: number): void };
type Vault = {
  root: string;
  database: ReturnType<typeof openSqliteDatabase>;
  store: DurableArtifactStore;
  clock: MutableClock;
};
type StoredSelections = ReadonlyMap<string, StoreArtifactResult>;

function requiredSelections(
  selections: ReadonlyMap<string, StoredSelections>,
  caseId: string,
): StoredSelections {
  const stored = selections.get(caseId);
  assert.ok(stored, `missing stored selections for ${caseId}`);
  return stored;
}

function fixture(caseId: string): SecFixtureCase {
  const found = SEC_FIXTURE_CASES.find((candidate) => candidate.caseId === caseId);
  assert.ok(found, `missing fixture ${caseId}`);
  return found;
}

function recordedObservationMs(cases: readonly SecFixtureCase[]): number {
  return Math.min(...cases.map((fixtureCase) => fixtureCase.asOfMs)) - 10_000;
}

function mutableClock(initial: number): MutableClock {
  let current = initial;
  return {
    nowMs: () => current,
    set(value: number) {
      assert.ok(Number.isSafeInteger(value) && value >= 0);
      current = value;
    },
  };
}

function vaultConfig(root: string): ArtifactVaultConfig {
  return {
    runtimeRootMode: "ci-temporary",
    runtimeRoot: root,
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

async function openVault(root: string, clock: MutableClock): Promise<Vault> {
  const paths = artifactRuntimePaths(root);
  mkdirSync(paths.databaseDirectory, { recursive: true });
  const database = openSqliteDatabase(paths.databasePath, MIGRATIONS);
  const store = await DurableArtifactStore.open({
    repository: new SqliteArtifactRepository(database),
    clock,
    config: vaultConfig(root),
  });
  return { root, database, store, clock };
}

async function closeVault(vault: Vault): Promise<void> {
  await vault.store.close();
  vault.database.close();
}

async function storeFixtureCase(
  vault: Vault,
  fixtureCase: SecFixtureCase,
): Promise<StoredSelections> {
  const selections = new Map<string, StoreArtifactResult>();
  for (const [index, member] of fixtureCase.members.entries()) {
    assert.ok(member.selectedObservation, `${fixtureCase.caseId} must select a stored observation`);
    const result = await vault.store.store({
      attempt: {
        attemptId: `recorded.${fixtureCase.caseId}.${index + 1}`,
        provider: member.selectedObservation.provider,
        recordId: `recorded.${fixtureCase.ordinal}`,
        revisionId: fixtureCase.revisionId,
        startedAtMs: member.retrievalAttempt.startedAtMs,
        request: REQUEST,
      },
      response: member.response,
      entityBytes: Readable.from(readFileSync(join(FIXTURE_ROOT, member.path))),
    });
    assertStoreMatchesFixture(result, member.artifactHash, member.sizeBytes);
    selections.set(member.memberKey, result);
  }
  return selections;
}

function assertStoreMatchesFixture(
  result: StoreArtifactResult,
  artifactHash: string,
  sizeBytes: number,
): void {
  assert.equal(result.artifact.digest, artifactHash);
  assert.equal(result.artifact.sizeBytes, sizeBytes);
}

function manifest(
  fixtureCase: SecFixtureCase,
  selections: StoredSelections,
): RecordedSecBundleManifest {
  return {
    asOfMs: fixtureCase.asOfMs,
    provider: fixtureCase.provider,
    source: fixtureCase.source,
    recordId: fixtureCase.recordId,
    revisionId: fixtureCase.revisionId,
    sourceKind: fixtureCase.sourceKind,
    accession: fixtureCase.accession,
    subjectCik: fixtureCase.subjectCik,
    fiscalPeriod: fixtureCase.fiscalPeriod,
    primaryArtifactHash: fixtureCase.expectedPrimaryArtifactHash,
    evidenceBundleHash: fixtureCase.expected.evidenceBundleHash,
    members: fixtureCase.presentationOrder.map((index) => {
      const member = fixtureCase.members[index];
      assert.ok(member);
      const stored = selections.get(member.memberKey);
      assert.ok(stored, `missing stored selection for ${member.memberKey}`);
      return {
        role: member.role,
        memberKey: member.memberKey,
        artifactHash: member.artifactHash,
        selectedObservationId: stored.observation.observationId,
      };
    }),
  };
}

async function readEvents(eventLog: EventLog, pageSize: number): Promise<readonly StoredEvent[]> {
  const events: StoredEvent[] = [];
  let position = "0";
  for (;;) {
    const page = await eventLog.readAfter(position, pageSize);
    events.push(...page.events);
    position = page.nextPosition;
    if (!page.hasMore) return events;
  }
}

function draftFromStored(event: StoredEvent): EventDraft {
  return {
    envelopeVersion: event.envelopeVersion,
    type: event.type,
    schemaVersion: event.schemaVersion,
    source: event.source,
    subject: event.subject,
    occurredAtMs: event.occurredAtMs,
    correlationId: event.correlationId,
    ...(event.causationId === undefined ? {} : { causationId: event.causationId }),
    payload: event.payload,
    provider: event.provider,
  };
}

function canonical(value: unknown): string {
  return canonicalJson(value as JsonValue);
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function countingStore(
  delegate: ArtifactStore,
  failReadAt: number | null = null,
): Readonly<{
  store: ArtifactStore;
  counts: () => { gets: number; reads: number; consumed: number };
}> {
  let gets = 0;
  let reads = 0;
  let consumed = 0;
  const store: ArtifactStore = {
    store: (request) => delegate.store(request),
    stat: (digest) => delegate.stat(digest),
    getAttempt: (id) => delegate.getAttempt(id),
    getObservation: (id) => {
      gets += 1;
      return delegate.getObservation(id);
    },
    readObservations: (digest, after, limit) => delegate.readObservations(digest, after, limit),
    reconcile: (budget) => delegate.reconcile(budget),
    async read(digest): Promise<VerifiedArtifactRead> {
      reads += 1;
      if (failReadAt === reads) throw new Error("injected verified-read failure");
      const verified = await delegate.read(digest);
      verified.stream.once("end", () => {
        consumed += 1;
      });
      return verified;
    },
  };
  return { store, counts: () => ({ gets, reads, consumed }) };
}

test("recorded loader consumes every verified member before normalizing and fails atomically", async (context) => {
  const root = mkdtempSync(join(tmpdir(), "peas-recorded-sec-loader-"));
  const valid = fixture("valid-item-202");
  const clock = mutableClock(recordedObservationMs([valid]));
  let vault = await openVault(root, clock);
  context.after(async () => {
    await closeVault(vault);
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
  });
  const validSelections = await storeFixtureCase(vault, valid);
  await closeVault(vault);
  clock.set(clock.nowMs() + 30_001);
  vault = await openVault(root, clock);

  const complete = countingStore(vault.store);
  const eventLog = new InMemoryEventLog({ clock: new ManualClock(CAPTURE_TIME_MS) });
  const emitted = await runRecordedSecPipeline({
    artifactStore: complete.store,
    eventLog,
    manifest: manifest(valid, validSelections),
  });
  assert.equal(emitted.status, "emitted");
  assert.deepEqual(complete.counts(), {
    gets: valid.members.length,
    reads: valid.members.length,
    consumed: valid.members.length,
  });
  assert.equal((await readEvents(eventLog, 1)).length, 1);

  const failed = countingStore(vault.store, valid.members.length);
  const emptyLog = new InMemoryEventLog({ clock: new ManualClock(CAPTURE_TIME_MS) });
  const quarantined = await runRecordedSecPipeline({
    artifactStore: failed.store,
    eventLog: emptyLog,
    manifest: manifest(valid, validSelections),
  });
  assert.equal(quarantined.status, "quarantined");
  assert.equal(quarantined.loader.status, "quarantined");
  if (quarantined.loader.status !== "quarantined") assert.fail("expected loader quarantine");
  assert.equal(quarantined.loader.transcript.reasonCode, "sec.artifact-read-failed");
  assert.deepEqual(failed.counts(), {
    gets: valid.members.length,
    reads: valid.members.length,
    consumed: valid.members.length - 1,
  });
  assert.equal((await readEvents(emptyLog, 1)).length, 0);

  const validManifest = manifest(valid, validSelections);
  const missing: RecordedSecBundleManifest = {
    ...validManifest,
    members: validManifest.members.map((member, index) =>
      index === 0 ? { ...member, selectedObservationId: "0".repeat(64) } : member,
    ),
  };
  const missingStore = countingStore(vault.store);
  const missingResult = await runRecordedSecPipeline({
    artifactStore: missingStore.store,
    eventLog: emptyLog,
    manifest: missing,
  });
  assert.equal(missingResult.status, "quarantined");
  assert.equal(missingResult.loader.status, "quarantined");
  if (missingResult.loader.status !== "quarantined") assert.fail("expected loader quarantine");
  assert.equal(missingResult.loader.transcript.reasonCode, "sec.observation-invalid");
  assert.deepEqual(missingStore.counts(), {
    gets: valid.members.length,
    reads: valid.members.length,
    consumed: valid.members.length,
  });
  assert.equal((await readEvents(emptyLog, 1)).length, 0);

  const duplicateSelectionStore = countingStore(vault.store);
  const duplicateSelection = await loadRecordedSecBundle(duplicateSelectionStore.store, {
    ...validManifest,
    members: validManifest.members.map((member, index) =>
      index === 1
        ? {
            ...member,
            selectedObservationId: validManifest.members[0]?.selectedObservationId ?? "",
          }
        : member,
    ),
  });
  assert.equal(duplicateSelection.status, "quarantined");
  assert.equal(duplicateSelection.reasonCode, "sec.observation-invalid");
  assert.deepEqual(duplicateSelectionStore.counts(), {
    gets: valid.members.length,
    reads: valid.members.length,
    consumed: valid.members.length,
  });

  const firstManifestMember = validManifest.members[0];
  assert.ok(firstManifestMember);
  let duplicateObservationReads = 0;
  let duplicateArtifactReads = 0;
  const rejectBeforeReadStore = new Proxy(vault.store, {
    get(target, property, receiver) {
      if (property === "getObservation") {
        return () => {
          duplicateObservationReads += 1;
          throw new Error("duplicate digest reached observation lookup");
        };
      }
      if (property === "read") {
        return () => {
          duplicateArtifactReads += 1;
          throw new Error("duplicate digest reached artifact read");
        };
      }
      return Reflect.get(target, property, receiver);
    },
  }) as ArtifactStore;
  const duplicateMember = {
    ...firstManifestMember,
    memberKey: `${firstManifestMember.memberKey}-duplicate`,
    selectedObservationId: "f".repeat(64),
  };
  for (const members of [
    [firstManifestMember, duplicateMember, ...validManifest.members.slice(1)],
    [duplicateMember, firstManifestMember, ...validManifest.members.slice(1)],
  ]) {
    const duplicateDigest = await loadRecordedSecBundle(rejectBeforeReadStore, {
      ...validManifest,
      members,
    });
    assert.equal(duplicateDigest.status, "quarantined");
    assert.equal(duplicateDigest.reasonCode, "sec.bundle-invalid");
  }
  assert.deepEqual(
    { observationReads: duplicateObservationReads, artifactReads: duplicateArtifactReads },
    { observationReads: 0, artifactReads: 0 },
  );

  const sparseMembers = [...validManifest.members];
  delete sparseMembers[0];
  const cyclicRecord: Record<string, unknown> = {};
  cyclicRecord["self"] = cyclicRecord;
  const symbolManifest = { ...validManifest } as RecordedSecBundleManifest &
    Record<symbol, unknown>;
  Object.defineProperty(symbolManifest, Symbol("unexpected"), {
    enumerable: true,
    value: "unexpected",
  });
  const invalidManifestShapes: unknown[] = [
    { ...validManifest, unexpected: "field" },
    {
      ...validManifest,
      members: validManifest.members.map((member, index) =>
        index === 0 ? { ...member, unexpected: "field" } : member,
      ),
    },
    { ...validManifest, recordId: { nested: { too: { deeply: "value" } } } },
    { ...validManifest, recordId: cyclicRecord },
    { ...validManifest, recordId: "a".repeat(513) },
    { ...validManifest, members: sparseMembers },
    new Proxy(validManifest, {}),
    symbolManifest,
  ];
  for (const invalidManifest of invalidManifestShapes) {
    const rejected = await loadRecordedSecBundle(
      rejectBeforeReadStore,
      invalidManifest as RecordedSecBundleManifest,
    );
    assert.equal(rejected.status, "quarantined");
    assert.equal(rejected.reasonCode, "sec.bundle-invalid");
  }
  assert.deepEqual(
    { observationReads: duplicateObservationReads, artifactReads: duplicateArtifactReads },
    { observationReads: 0, artifactReads: 0 },
  );
  const exactStringBoundary = await loadRecordedSecBundle(vault.store, {
    ...validManifest,
    recordId: "a".repeat(512),
  });
  assert.equal(exactStringBoundary.status, "verified");

  const selectedObservation = await vault.store.getObservation(
    firstManifestMember.selectedObservationId,
  );
  assert.ok(selectedObservation);
  const exactAsOf = await loadRecordedSecBundle(vault.store, {
    ...validManifest,
    asOfMs: selectedObservation.retrievedAtMs,
  });
  assert.equal(exactAsOf.status, "verified");
  const futureStore = countingStore(vault.store);
  const futureResult = await runRecordedSecPipeline({
    artifactStore: futureStore.store,
    eventLog: emptyLog,
    manifest: { ...validManifest, asOfMs: selectedObservation.retrievedAtMs - 1 },
  });
  assert.equal(futureResult.status, "quarantined");
  assert.equal(futureResult.loader.status, "quarantined");
  if (futureResult.loader.status !== "quarantined") assert.fail("expected loader quarantine");
  assert.equal(futureResult.loader.reasonCode, "sec.observation-invalid");
  assert.deepEqual(futureStore.counts(), {
    gets: valid.members.length,
    reads: valid.members.length,
    consumed: valid.members.length,
  });
  assert.equal((await readEvents(emptyLog, 1)).length, 0);

  let accessorCalls = 0;
  const hostileManifest = Object.create(null) as Record<string, unknown>;
  Object.defineProperty(hostileManifest, "evidenceBundleHash", {
    enumerable: true,
    get() {
      accessorCalls += 1;
      throw new Error("manifest accessor executed");
    },
  });
  const hostileResult = await loadRecordedSecBundle(
    vault.store,
    hostileManifest as RecordedSecBundleManifest,
  );
  assert.equal(hostileResult.status, "quarantined");
  assert.equal(hostileResult.reasonCode, "sec.bundle-invalid");
  assert.equal(accessorCalls, 0);

  const nullHashResult = await loadRecordedSecBundle(vault.store, {
    ...validManifest,
    members: validManifest.members.map((member, index) =>
      index === 0 ? { ...member, artifactHash: null as never } : member,
    ),
  });
  assert.equal(nullHashResult.status, "quarantined");
  assert.equal(nullHashResult.reasonCode, "sec.bundle-invalid");

  const corruptDigest = firstManifestMember.artifactHash;
  writeFileSync(
    join(
      root,
      "artifacts",
      "sha256",
      corruptDigest.slice(0, 2),
      corruptDigest.slice(2, 4),
      corruptDigest,
    ),
    "corrupt",
  );
  const corruptResult = await runRecordedSecPipeline({
    artifactStore: vault.store,
    eventLog: emptyLog,
    manifest: validManifest,
  });
  assert.equal(corruptResult.status, "quarantined");
  assert.equal(corruptResult.loader.status, "quarantined");
  if (corruptResult.loader.status !== "quarantined") assert.fail("expected loader quarantine");
  assert.equal(corruptResult.loader.reasonCode, "sec.artifact-read-failed");
  assert.equal((await readEvents(emptyLog, 1)).length, 0);
});

test("ignored and quarantined normalization append no partial event", async (context) => {
  const root = mkdtempSync(join(tmpdir(), "peas-recorded-sec-no-partial-"));
  const ignoredFixture = fixture("non-earnings-8k");
  const quarantinedFixture = fixture("timestamp-conflict");
  const clock = mutableClock(recordedObservationMs([ignoredFixture, quarantinedFixture]));
  const vault = await openVault(root, clock);
  context.after(async () => {
    await closeVault(vault);
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
  });
  const ignoredSelections = await storeFixtureCase(vault, ignoredFixture);
  const quarantinedSelections = await storeFixtureCase(vault, quarantinedFixture);
  const eventLog = new InMemoryEventLog({ clock: new ManualClock(CAPTURE_TIME_MS) });

  const ignored = await runRecordedSecPipeline({
    artifactStore: vault.store,
    eventLog,
    manifest: manifest(ignoredFixture, ignoredSelections),
  });
  const quarantined = await runRecordedSecPipeline({
    artifactStore: vault.store,
    eventLog,
    manifest: manifest(quarantinedFixture, quarantinedSelections),
  });
  assert.equal(ignored.status, "ignored");
  assert.equal(ignored.normalization?.reasonCode, "sec.not-earnings-related");
  assert.equal(quarantined.status, "quarantined");
  assert.equal(quarantined.normalization?.reasonCode, "sec.timestamp-conflict");
  assert.equal((await readEvents(eventLog, 1)).length, 0);
});

test("durable recorded capture, replay paging, reopen, vectors, and dry-run effects are exact", async (context) => {
  const root = mkdtempSync(join(tmpdir(), "peas-recorded-sec-e2e-"));
  const fixtureCases = EMITTED_CASE_IDS.map(fixture);
  const clock = mutableClock(recordedObservationMs(fixtureCases));
  let vault = await openVault(root, clock);
  context.after(async () => {
    await closeVault(vault);
    await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
  });
  const selections = new Map<string, StoredSelections>();
  for (const fixtureCase of fixtureCases) {
    selections.set(fixtureCase.caseId, await storeFixtureCase(vault, fixtureCase));
  }
  await closeVault(vault);
  clock.set(clock.nowMs() + 30_001);
  vault = await openVault(root, clock);

  const memoryLog = new InMemoryEventLog({ clock: new ManualClock(CAPTURE_TIME_MS) });
  const memoryLiveStore = new InMemoryProcessingStore<EarningsClusterState>(memoryLog);
  const memoryLiveProcessor = new DeterministicProcessor({
    reducer: new EarningsClusterReducer(),
    store: memoryLiveStore,
    eventLog: memoryLog,
    manifest: makeManifest("recorded-sec-pr2b-replay"),
  });
  const memoryResults = [];
  const firstFixtureCase = fixtureCases[0];
  assert.ok(firstFixtureCase);
  for (const fixtureCase of fixtureCases) {
    memoryResults.push(
      await runRecordedSecPipeline({
        artifactStore: vault.store,
        eventLog: memoryLog,
        manifest: manifest(fixtureCase, requiredSelections(selections, fixtureCase.caseId)),
      }),
    );
    await memoryLiveProcessor.processAvailable(1);
  }
  assert.ok(memoryResults.every((result) => result.status === "emitted"));
  const redelivery = await runRecordedSecPipeline({
    artifactStore: vault.store,
    eventLog: memoryLog,
    manifest: manifest(firstFixtureCase, requiredSelections(selections, firstFixtureCase.caseId)),
  });
  assert.equal(redelivery.status, "emitted");
  assert.equal(redelivery.capture.disposition, "redelivery");

  const sqliteLog = new SqliteEventLog(vault.database, {
    clock: new ManualClock(CAPTURE_TIME_MS),
  });
  const sqliteLiveProcessor = new DeterministicProcessor({
    reducer: new EarningsClusterReducer(),
    store: new SqliteProcessingStore<EarningsClusterState>(vault.database),
    eventLog: sqliteLog,
    manifest: makeManifest("recorded-sec-pr2b-replay"),
  });
  for (const fixtureCase of fixtureCases) {
    const result = await runRecordedSecPipeline({
      artifactStore: vault.store,
      eventLog: sqliteLog,
      manifest: manifest(fixtureCase, requiredSelections(selections, fixtureCase.caseId)),
    });
    assert.equal(result.status, "emitted");
    await sqliteLiveProcessor.processAvailable(1);
  }
  const memoryEvents = await readEvents(memoryLog, 10_000);
  const sqliteEvents = await readEvents(sqliteLog, 10_000);
  assert.equal(canonical(sqliteEvents), canonical(memoryEvents));
  const liveMemorySnapshot = await memoryLiveProcessor.snapshot(1);
  assert.equal(canonical(await sqliteLiveProcessor.snapshot(1)), canonical(liveMemorySnapshot));

  const first = memoryResults[0];
  if (first?.status !== "emitted") assert.fail("expected first emitted result");
  const conflictingDraft: EventDraft = {
    ...first.normalization.draft,
    payload: { ...first.normalization.draft.payload, publishedAtMs: null },
  };
  await assert.rejects(memoryLog.append(conflictingDraft), /redelivery metadata conflicts/u);
  assert.equal((await readEvents(memoryLog, 10_000)).length, fixtureCases.length);

  const captureBytes = Buffer.from(
    `${memoryEvents.map((event) => canonical(event)).join("\n")}\n`,
    "utf8",
  );
  let expectedSnapshot: unknown = liveMemorySnapshot;
  for (const pageSize of PAGE_SIZES) {
    const replayLog = new CapturedEventLog(memoryEvents);
    const replayStore = new InMemoryProcessingStore<EarningsClusterState>(replayLog);
    const processor = new DeterministicProcessor({
      reducer: new EarningsClusterReducer(),
      store: replayStore,
      eventLog: replayLog,
      manifest: makeManifest("recorded-sec-pr2b-replay"),
    });
    await processor.processAvailable(pageSize);
    const snapshot = await processor.snapshot(pageSize);
    expectedSnapshot ??= snapshot;
    assert.equal(canonical(snapshot), canonical(expectedSnapshot));
  }
  assert.ok(expectedSnapshot);
  const typedSnapshot = expectedSnapshot as {
    cursor: { stateHead: string; decisionHead: string };
    outputs: readonly unknown[];
    aggregates: readonly unknown[];
  };
  const expectedGolden = {
    captureSha256: sha256(captureBytes),
    eventCount: fixtureCases.length,
    eventHead: memoryEvents.at(-1)?.eventHash,
    stateHead: typedSnapshot.cursor.stateHead,
    decisionHead: typedSnapshot.cursor.decisionHead,
    outputCount: typedSnapshot.outputs.length,
    aggregateCount: typedSnapshot.aggregates.length,
    loaderTranscriptHashes: memoryResults.map((result) => {
      assert.equal(result.status, "emitted");
      return result.loader.transcriptHash;
    }),
    normalizationTranscriptHashes: memoryResults.map((result) => {
      assert.equal(result.status, "emitted");
      return computeSecNormalizationTranscriptHash(result.normalization.transcript);
    }),
    snapshot: expectedSnapshot,
  };
  assert.deepEqual(readFileSync(CAPTURE_PATH), captureBytes);
  const checkedCapture = readFileSync(CAPTURE_PATH);
  const checkedGolden = JSON.parse(readFileSync(GOLDEN_PATH, "utf8")) as unknown;
  assert.equal(sha256(checkedCapture), expectedGolden.captureSha256);
  assert.equal(canonical(checkedGolden), canonical(expectedGolden));

  await closeVault(vault);
  clock.set(clock.nowMs() + 30_001);
  vault = await openVault(root, clock);
  const reopenedLog = new SqliteEventLog(vault.database, { clock: new ManualClock(0) });
  assert.equal(canonical(await readEvents(reopenedLog, 2)), canonical(memoryEvents));
  const reopenPrefixLength = 3;
  for (const pageSize of PAGE_SIZES) {
    const processingPath = join(root, `processing-${pageSize}.sqlite`);
    let processingDatabase = openSqliteDatabase(processingPath, MIGRATIONS);
    try {
      const processingLog = new SqliteEventLog(processingDatabase, {
        clock: new ManualClock(CAPTURE_TIME_MS),
      });
      for (const event of memoryEvents.slice(0, reopenPrefixLength)) {
        await processingLog.append(draftFromStored(event));
      }
      assert.equal(
        canonical(await readEvents(processingLog, pageSize)),
        canonical(memoryEvents.slice(0, reopenPrefixLength)),
      );
      const processor = new DeterministicProcessor({
        reducer: new EarningsClusterReducer(),
        store: new SqliteProcessingStore<EarningsClusterState>(processingDatabase),
        eventLog: processingLog,
        manifest: makeManifest("recorded-sec-pr2b-replay"),
      });
      await processor.processAvailable(pageSize);
    } finally {
      processingDatabase.close();
    }
    processingDatabase = openSqliteDatabase(processingPath, MIGRATIONS);
    try {
      const processingLog = new SqliteEventLog(processingDatabase, {
        clock: new ManualClock(CAPTURE_TIME_MS),
      });
      for (const event of memoryEvents.slice(reopenPrefixLength)) {
        await processingLog.append(draftFromStored(event));
      }
      assert.equal(canonical(await readEvents(processingLog, pageSize)), canonical(memoryEvents));
      const reopenedProcessor = new DeterministicProcessor({
        reducer: new EarningsClusterReducer(),
        store: new SqliteProcessingStore<EarningsClusterState>(processingDatabase),
        eventLog: processingLog,
        manifest: makeManifest("recorded-sec-pr2b-replay"),
      });
      await reopenedProcessor.processAvailable(pageSize);
      assert.equal(
        canonical(await reopenedProcessor.snapshot(pageSize)),
        canonical(expectedSnapshot),
      );
    } finally {
      processingDatabase.close();
    }
  }

  for (const kind of ["replay", "shadow", "research", "paper"] satisfies RunKind[]) {
    const replayLog = new CapturedEventLog(memoryEvents);
    const store = new InMemoryProcessingStore<EarningsClusterState>(replayLog);
    const runId = `recorded-sec-pr2b-${kind}`;
    const processor = new DeterministicProcessor({
      reducer: new EarningsClusterReducer(),
      store,
      eventLog: replayLog,
      manifest: makeManifest(runId, kind, false),
    });
    await processor.processAvailable(2);
    assert.deepEqual(store.dispatchableCounts(runId), { jobs: 0, outbox: 0 });
  }
});

test("recorded adapter source is bounded and has no network surface", () => {
  const source = readFileSync(
    join(process.cwd(), "src", "adapters", "sec", "recorded-sec-pipeline.ts"),
    "utf8",
  );
  assert.doesNotMatch(source, /\b(?:fetch|https?|net|tls|WebSocket|EventSource)\b/u);
  assert.doesNotMatch(source, /readObservations\s*\(/u);
});
