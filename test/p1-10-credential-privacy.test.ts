import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import {
  ALPACA_KEY_ID_ENV,
  ALPACA_SECRET_KEY_ENV,
  DurableCredentialAuthorizationBoundary,
  authorizeCredentialLoad,
  assertCredentialIsolatedAlpacaTransport,
  createProductionCredentialIsolatedAlpacaTransport,
  createTestCredentialIsolatedAlpacaTransport,
  createDurableCredentialAuthorizationBoundary,
  createTestDurableCredentialAuthorizationBoundary,
  fmpLaneDisabled,
  withAlpacaAuthorization,
  type AlpacaDispatchCapability,
  type RuntimeSecretSource,
} from "../src/adapters/market-acquisition/credentials.js";
import { buildAlpacaTransportRequest } from "../src/adapters/market-acquisition/alpaca/request.js";
import {
  MemoryAcquisitionJournal,
  createMemoryAcquisitionJournal,
} from "../src/adapters/market-acquisition/memory-journal.js";
import { createSqliteAcquisitionJournal } from "../src/adapters/market-acquisition/sqlite-journal.js";
import { MemoryArtifactRetentionJournal } from "../src/adapters/market-acquisition/retention/memory-journal.js";
import { createSqliteArtifactRetentionJournal } from "../src/adapters/market-acquisition/retention/sqlite-journal.js";
import { loadMigrations, openSqliteDatabase } from "../src/adapters/sqlite/database.js";
import {
  ACCESSOR,
  BYTE_LIMIT,
  CYCLE,
  OPAQUE,
  REDACTED,
  isSafeAcquisitionError,
  projectHostileValue,
  safeAcquisitionError,
} from "../src/adapters/market-acquisition/redaction.js";
import { credentialAuthorizationFixture, validatedRepairPlan } from "./p1-10-repair-fixtures.js";

test("Alpaca credentials load only into an immutable dispatch capability", async () => {
  const plan = validatedRepairPlan();
  const fixture = await credentialAuthorizationFixture(plan);
  const permit = authorizeCredentialLoad(await fixture.authorization.establish(fixture.request));
  const reads: string[] = [];
  const source: RuntimeSecretSource = {
    read(name) {
      reads.push(name);
      return name === ALPACA_KEY_ID_ENV ? "synthetic-key-id" : "synthetic-secret";
    },
  };
  let retained: AlpacaDispatchCapability | null = null;
  let retainedHeaders:
    | import("../src/adapters/market-acquisition/credentials.js").AlpacaAuthorizationHeaders
    | null = null;
  let dispatches = 0;
  let copiedKeyId: string | null = null;
  let copiedSecret: string | null = null;
  const requestLease = buildAlpacaTransportRequest(
    plan,
    { kind: "first-page", pageOrdinal: 0 },
    new AbortController().signal,
  );
  const transport = createTestCredentialIsolatedAlpacaTransport({
    async dispatch(_request, headers) {
      dispatches += 1;
      assert.equal(headers["APCA-API-KEY-ID"], "synthetic-key-id");
      assert.equal(headers["APCA-API-SECRET-KEY"], "synthetic-secret");
      copiedKeyId = headers["APCA-API-KEY-ID"];
      copiedSecret = headers["APCA-API-SECRET-KEY"];
      assert.equal(Object.isFrozen(headers), true);
      retainedHeaders = headers;
      return {} as never;
    },
    async abort() {},
    async settle() {},
  });
  const result = await withAlpacaAuthorization(permit, source, async (capability) => {
    assert.equal(Object.isFrozen(capability), true);
    assert.deepEqual(Object.keys(capability), ["kind"]);
    retained = capability;
    await transport.dispatch(requestLease.request, capability);
    await assert.rejects(
      () => transport.dispatch(requestLease.request, capability),
      /dispatch-capability-invalid/u,
    );
    return "settled";
  });
  requestLease.release();
  assert.deepEqual(result, { ok: true, value: "settled" });
  assert.deepEqual(reads, [ALPACA_KEY_ID_ENV, ALPACA_SECRET_KEY_ENV]);
  assert.ok(retained !== null);
  assert.equal(dispatches, 1);
  assert.ok(retainedHeaders !== null);
  const retainedRecord =
    retainedHeaders as import("../src/adapters/market-acquisition/credentials.js").AlpacaAuthorizationHeaders;
  assert.throws(() => retainedRecord["APCA-API-KEY-ID"], /lease-expired/u);
  assert.throws(() => retainedRecord["APCA-API-SECRET-KEY"], /lease-expired/u);
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(retainedRecord))) {
    assert.equal("value" in descriptor, false);
  }
  // Plain JS strings cannot be revoked once disclosed. This driver seam is test-condition-only;
  // production composition never accepts a caller driver.
  assert.equal(copiedKeyId, "synthetic-key-id");
  assert.equal(copiedSecret, "synthetic-secret");
  await assert.rejects(
    () => transport.dispatch(requestLease.request, retained as AlpacaDispatchCapability),
    /dispatch-capability-invalid/u,
  );
  await assert.rejects(() => withAlpacaAuthorization(permit, source, async () => "reused"));
  const credentials = await import("../src/adapters/market-acquisition/credentials.js");
  assert.equal("resolveAlpacaDispatchCapability" in credentials, false);
});

test("spoofed NODE_TEST_CONTEXT cannot mint any test root or credential transport", () => {
  const moduleUrl = (path: string): string => pathToFileURL(resolve(path)).href;
  const urls = {
    credentials: moduleUrl("dist/src/adapters/market-acquisition/credentials.js"),
    acquisition: moduleUrl("dist/src/adapters/market-acquisition/memory-journal.js"),
    retentionJournal: moduleUrl("dist/src/adapters/market-acquisition/retention/memory-journal.js"),
    retentionController: moduleUrl("dist/src/adapters/market-acquisition/retention/controller.js"),
    artifactAccess: moduleUrl("dist/src/adapters/market-acquisition/retention/artifact-access.js"),
    retainedSink: moduleUrl("dist/src/adapters/market-acquisition/alpaca/retained-sink.js"),
    wire: moduleUrl("dist/src/adapters/market-acquisition/alpaca/wire.js"),
    semantics: moduleUrl("dist/src/adapters/market-acquisition/alpaca/wire-semantic-evidence.js"),
  };
  const probe = `
    const urls = JSON.parse(process.argv[1]);
    process.env.NODE_TEST_CONTEXT = "peas-spoof";
    const c = await import(urls.credentials);
    const a = await import(urls.acquisition);
    const rj = await import(urls.retentionJournal);
    const rc = await import(urls.retentionController);
    const aa = await import(urls.artifactAccess);
    const rs = await import(urls.retainedSink);
    const w = await import(urls.wire);
    const s = await import(urls.semantics);
    if ("createCredentialIsolatedAlpacaTransport" in c) throw new Error("legacy-driver-export");
    let copied = false;
    const driver = { dispatch(_request, headers) { copied = Boolean(headers?.["APCA-API-KEY-ID"]); }, abort() {}, settle() {} };
    const attempts = [
      () => c.createTestCredentialIsolatedAlpacaTransport(driver),
      () => c.createTestDurableCredentialAuthorizationBoundary({}, {}),
      () => a.createMemoryAcquisitionJournal({}),
      () => rj.createMemoryArtifactRetentionJournal(),
      () => rc.createTestArtifactRetentionController({}),
      () => aa.createTestRetentionEnforcedArtifactStore({}, {}),
      () => rs.createTestAlpacaArtifactCommitSink({}),
      () => w.createTestDurableAlpacaWireAdmissionBoundary({}, {}),
      () => s.createTestDurableAlpacaWireSemanticEvidenceBoundary({}, {}, {}),
      () => s.appendTestAlpacaWireSemanticEvidence({}, {}),
      () => c.createProductionCredentialIsolatedAlpacaTransport(driver),
    ];
    for (const attempt of attempts) {
      let rejected = false;
      try { attempt(); } catch { rejected = true; }
      if (!rejected) throw new Error("spoofed-test-root-admitted");
    }
    if (copied) throw new Error("plaintext-copied");
  `;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", probe, JSON.stringify(urls)],
    {
      cwd: process.cwd(),
      env: { ...process.env, NODE_TEST_CONTEXT: "peas-spoof", NODE_OPTIONS: "" },
      encoding: "utf8",
      windowsHide: true,
    },
  );
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("production credential transport is module-owned and accepts no caller driver", () => {
  const transport = createProductionCredentialIsolatedAlpacaTransport();
  assert.doesNotThrow(() => assertCredentialIsolatedAlpacaTransport(transport));
  assert.throws(
    () =>
      (createProductionCredentialIsolatedAlpacaTransport as unknown as (driver: object) => unknown)(
        {
          dispatch() {
            assert.fail("caller driver must never receive authorization");
          },
        },
      ),
    /takes-no-driver/u,
  );
});

test("missing credentials return a closed error and never invoke transport", async () => {
  const fixture = await credentialAuthorizationFixture(validatedRepairPlan());
  const permit = authorizeCredentialLoad(await fixture.authorization.establish(fixture.request));
  let operations = 0;
  const reads: string[] = [];
  const result = await withAlpacaAuthorization(
    permit,
    {
      read(name) {
        reads.push(name);
        return name === ALPACA_KEY_ID_ENV ? "synthetic-key-id" : undefined;
      },
    },
    async () => {
      operations += 1;
      return "unreachable";
    },
  );
  assert.equal(result.ok, false);
  if (result.ok) assert.fail("Credential failure unexpectedly succeeded");
  assert.equal(isSafeAcquisitionError(result.error), true);
  assert.deepEqual(Object.keys(result.error).sort(), [
    "detailHash",
    "operationStage",
    "reasonCode",
  ]);
  assert.equal(result.error.reasonCode, "credential-unavailable");
  assert.equal(operations, 0);
  assert.deepEqual(reads, [ALPACA_KEY_ID_ENV, ALPACA_SECRET_KEY_ENV]);
});

test("a structurally forged permit and incomplete proof cannot read credentials", async () => {
  const plan = validatedRepairPlan();
  const fixture = await credentialAuthorizationFixture(plan);
  let reads = 0;
  await assert.rejects(
    () =>
      withAlpacaAuthorization(
        {
          kind: "p1-10-credential-capability",
          requestIdentityHash: plan.requestIdentityHash,
          acquisitionConfigurationHash: plan.acquisitionConfigurationHash,
          acquisitionObservationId: fixture.request.acquisitionObservationId,
          retrievalAttemptId: fixture.request.retrievalAttemptId,
        } as never,
        {
          read() {
            reads += 1;
            return "unreachable";
          },
        },
        async () => "unreachable",
      ),
    /durable-preconditions/u,
  );
  assert.equal(reads, 0);
  await assert.rejects(
    () =>
      fixture.authorization.establish({
        ...fixture.request,
        acquisitionObservationId: "wrong-acquisition",
      }),
    /request-started/u,
  );
  const emptyJournal = createMemoryAcquisitionJournal(fixture.request.journalIdentity);
  const missingPersistence = createTestDurableCredentialAuthorizationBoundary(
    emptyJournal,
    fixture.retentionJournal,
  );
  await assert.rejects(
    () => missingPersistence.establish(fixture.request),
    /journal-empty|request-started/u,
  );
  assert.equal(reads, 0);
  assert.throws(
    () => authorizeCredentialLoad({ kind: "p1-10-durable-credential-evidence" } as never),
    /evidence-capability-invalid/u,
  );
});

test("durable attempt claims exclude replay and concurrent remint before one secret read", async () => {
  const fixture = await credentialAuthorizationFixture(validatedRepairPlan());
  const outcomes = await Promise.allSettled([
    fixture.authorization.establish(fixture.request),
    fixture.authorization.establish(fixture.request),
  ]);
  const fulfilled = outcomes.filter(
    (
      outcome,
    ): outcome is PromiseFulfilledResult<
      Awaited<ReturnType<typeof fixture.authorization.establish>>
    > => outcome.status === "fulfilled",
  );
  assert.equal(fulfilled.length, 1);
  assert.equal(outcomes.filter((outcome) => outcome.status === "rejected").length, 1);
  const accepted = fulfilled[0];
  assert.ok(accepted !== undefined);
  const journal = await fixture.journal.load(fixture.request.marketAcquisitionJournalId);
  assert.equal(journal.at(-1)?.checkpointKind, "attempt-started");
  assert.equal(journal.at(-1)?.cumulativeAttempts, 1);
  let reads = 0;
  let operations = 0;
  const result = await withAlpacaAuthorization(
    authorizeCredentialLoad(accepted.value),
    {
      read() {
        reads += 1;
        return reads === 1 ? "synthetic-key-id" : "synthetic-secret";
      },
    },
    async () => {
      operations += 1;
      return "authorized-once";
    },
  );
  assert.deepEqual(result, { ok: true, value: "authorized-once" });
  assert.equal(reads, 2);
  assert.equal(operations, 1);
  await assert.rejects(
    () => fixture.authorization.establish(fixture.request),
    /request-started|already-claimed/u,
  );
});

test("a persisted attempt claim cannot be reminted after SQLite cold restart", async (t) => {
  const fixture = await credentialAuthorizationFixture(validatedRepairPlan());
  const directory = await mkdtemp(join(tmpdir(), "peas-p1-10-credential-claim-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = join(directory, "claim.sqlite");
  const migrations = loadMigrations(join(process.cwd(), "migrations"));
  let database = openSqliteDatabase(filename, migrations);
  let journal = createSqliteAcquisitionJournal(database, fixture.request.journalIdentity);
  await journal.appendLedgerEntries(fixture.ledgerEntries);
  for (const entry of fixture.entries) await journal.append(entry);
  let retentionJournal = createSqliteArtifactRetentionJournal(database);
  const first = createDurableCredentialAuthorizationBoundary(journal, retentionJournal);
  await first.establish(fixture.request);
  database.close();
  database = openSqliteDatabase(filename, migrations);
  journal = createSqliteAcquisitionJournal(database, fixture.request.journalIdentity);
  retentionJournal = createSqliteArtifactRetentionJournal(database);
  const restarted = createDurableCredentialAuthorizationBoundary(journal, retentionJournal);
  await assert.rejects(
    () => restarted.establish(fixture.request),
    /request-started|already-claimed/u,
  );
  const entries = await journal.load(fixture.request.marketAcquisitionJournalId);
  assert.equal(entries.filter((entry) => entry.checkpointKind === "attempt-started").length, 1);
  database.close();
});

test("credential authority rejects structural, subclassed, and proxied persistence roots", async () => {
  const fixture = await credentialAuthorizationFixture(validatedRepairPlan());
  class JournalSubclass extends MemoryAcquisitionJournal {}
  class RetentionJournalSubclass extends MemoryArtifactRetentionJournal {}
  const prototypeOnly = Object.create(
    MemoryAcquisitionJournal.prototype,
  ) as MemoryAcquisitionJournal;
  const methodShadow = new MemoryAcquisitionJournal(fixture.request.journalIdentity);
  Object.defineProperty(methodShadow, "load", {
    value: async () => fixture.entries,
    enumerable: true,
  });
  const directlyConstructed = new DurableCredentialAuthorizationBoundary(
    fixture.journal,
    fixture.retentionJournal,
  );
  await assert.rejects(
    () => directlyConstructed.establish(fixture.request),
    /owned-durable-credential-authorization-boundary-required/u,
  );
  class BoundarySubclass extends DurableCredentialAuthorizationBoundary {}
  await assert.rejects(
    () =>
      new BoundarySubclass(fixture.journal, fixture.retentionJournal).establish(fixture.request),
    /owned-durable-credential-authorization-boundary-required/u,
  );
  await assert.rejects(
    () => new Proxy(fixture.authorization, {}).establish(fixture.request),
    /owned-durable-credential-authorization-boundary-required/u,
  );
  for (const journal of [
    {} as never,
    prototypeOnly,
    methodShadow,
    new JournalSubclass(fixture.request.journalIdentity),
    new Proxy(fixture.journal, {}),
  ]) {
    assert.throws(
      () => new DurableCredentialAuthorizationBoundary(journal, fixture.retentionJournal),
      /owned-acquisition-journal-required/u,
    );
  }
  for (const retention of [
    {} as never,
    new RetentionJournalSubclass(),
    new Proxy(fixture.retentionJournal, {}),
  ]) {
    assert.throws(
      () => new DurableCredentialAuthorizationBoundary(fixture.journal, retention),
      /owned-retention-journal-required/u,
    );
  }
});

test("the low-level attempt executor is not a caller-invocable module export", async () => {
  const module = await import("../src/adapters/market-acquisition/alpaca/adapter.js");
  assert.equal("executeAlpacaAttempt" in module, false);
  const credentials = await import("../src/adapters/market-acquisition/credentials.js");
  assert.equal("establishCredentialAuthorizationEvidence" in credentials, false);
});

test("FMP reservation is disabled and exposes no credential-reader capability", () => {
  const result = fmpLaneDisabled();
  assert.equal(result.ok, false);
  if (result.ok) assert.fail("Disabled FMP lane unexpectedly succeeded");
  assert.equal(result.error.reasonCode, "lane-not-implemented");
  assert.equal(result.error.operationStage, "authority");
});

test("recursive projection is descriptor-safe, cycle-safe, and collapses hostile values", () => {
  let getterReads = 0;
  const value: Record<string, unknown> = {
    safeCounter: 7,
    safeBoolean: true,
    harmlessText: "never emit these characters",
    credential: { nested: "secret" },
    requestHeaders: { arbitrary: "header" },
    bodySnippet: "provider bytes",
    nested: Object.create(null) as Record<string, unknown>,
  };
  Object.defineProperty(value, "hostileGetter", {
    enumerable: true,
    get() {
      getterReads += 1;
      throw new Error("must not execute");
    },
  });
  (value["nested"] as Record<string, unknown>)["back"] = value;
  const projected = projectHostileValue(value) as Record<string, unknown>;
  assert.equal(getterReads, 0);
  assert.equal(projected["credential"], REDACTED);
  assert.equal(projected["requestHeaders"], REDACTED);
  assert.equal(projected["bodySnippet"], REDACTED);
  assert.equal(projected["hostileGetter"], ACCESSOR);
  assert.deepEqual(projected["safeCounter"], 7);
  assert.equal((projected["nested"] as Record<string, unknown>)["back"], CYCLE);
  assert.doesNotMatch(
    JSON.stringify(projected),
    /never emit these characters|provider bytes|nested secret|arbitrary header/iu,
  );

  const proxy = new Proxy(
    {},
    {
      ownKeys() {
        throw new Error("hostile proxy");
      },
    },
  );
  assert.equal(projectHostileValue(proxy), OPAQUE);
  assert.deepEqual(projectHostileValue(new Error("hostile")), OPAQUE);
});

test("redaction budgets are deterministic and safe-error detail never hashes hostile input", () => {
  const projected = projectHostileValue(
    { alpha: { beta: { gamma: 1 } }, delta: 2 },
    { maxDepth: 2, maxMembers: 10, maxOutputBytes: 24 },
  );
  assert.match(
    JSON.stringify(projected),
    new RegExp(`${BYTE_LIMIT.slice(1, -1)}|depth-limit`, "u"),
  );
  const first = safeAcquisitionError("retention-erasure-failed", "retention-erase");
  const second = safeAcquisitionError("retention-erasure-failed", "retention-erase");
  assert.deepEqual(first, second);
  assert.match(first.detailHash, /^[0-9a-f]{64}$/u);
  assert.equal(Object.getPrototypeOf(first), Object.prototype);
  assert.equal(Object.isFrozen(first), true);
});
