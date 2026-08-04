import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import Database from "better-sqlite3";
import type { ClientRequest } from "node:http";
import { createServer, request as dispatchLocalRequest } from "node:https";
import { canonicalJson, type JsonValue } from "../src/core/json.js";

import {
  ALPACA_KEY_ID_ENV,
  ALPACA_SECRET_KEY_ENV,
  DurableCredentialAuthorizationBoundary,
  authorizeCredentialLoad,
  assertCredentialIsolatedAlpacaTransport,
  createProductionCredentialIsolatedAlpacaTransport,
  createTestNativeCredentialIsolatedAlpacaTransport,
  assertTestNativeAlpacaTransportReleased,
  createTestCredentialIsolatedAlpacaTransport,
  openSqliteDurableCredentialAuthorizationBoundary,
  openTestSqliteDurableCredentialAuthorizationBoundary,
  planCredentialAttemptAdmission,
  provisionSqliteDurableCredentialAuthorityRuntime,
  createTestDurableCredentialAuthorizationBoundary,
  fmpLaneDisabled,
  withAlpacaAuthorization,
  type AlpacaDispatchCapability,
  type RuntimeSecretSource,
} from "../src/adapters/market-acquisition/credentials.js";
import { MARKET_ACQUISITION_LIMITS } from "../src/adapters/market-acquisition/contracts.js";
import { buildAlpacaTransportRequest } from "../src/adapters/market-acquisition/alpaca/request.js";
import { appendTestAcquisitionWorkflowEvidence } from "../src/adapters/market-acquisition/journal.js";
import {
  MemoryAcquisitionJournal,
  createMemoryAcquisitionJournal,
} from "../src/adapters/market-acquisition/memory-journal.js";
import { createSqliteAcquisitionJournal } from "../src/adapters/market-acquisition/sqlite-journal.js";
import { MemoryArtifactRetentionJournal } from "../src/adapters/market-acquisition/retention/memory-journal.js";
import { createSqliteArtifactRetentionJournal } from "../src/adapters/market-acquisition/retention/sqlite-journal.js";
import { loadMigrations, openSqliteDatabase } from "../src/adapters/sqlite/database.js";
import { createSqliteAlpacaWireSemanticEvidenceStore } from "../src/adapters/market-acquisition/alpaca/wire-semantic-evidence.js";
import { SqliteArtifactRepository } from "../src/adapters/artifacts/sqlite-artifact-repository.js";
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

const LOCAL_HTTPS_KEY = `-----BEGIN PRIVATE KEY-----
MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDyEIZf+PLhNs3l
LMZkk67+fEnloYodhuTMtxLYQU7cC9R2Ibos7r8ogHTaIXwNvTjpi7/2Vvt94qwS
y9Kp0n0zandyu+nIrOzJlFj2t41dMRuxjvzQLIPE0noSeGdmKWgy/Ala8/eyu6mo
dErq4NfdmEp8QZnjg8kPbdYPjXD3Oo91ynu865bA7VUsBCI7aWJIYBODxXUReIVs
SabgRtCL1vggxKN5qMN14jb4my/5/9BKvd+LYnWiPmZf8C38eQ8ssJFwSnav0zyJ
XF4l7Yv3BD11US194F78zc4yoAV/qXk71agY4vmv75V357XVzkU4Qd8bBU+yI0Xp
runwRh1jAgMBAAECggEAH202zOn4unWPiKPmA/PKgd6oB2iQEmJLfSp9h1b/QoFE
rauWTLQYXE1FHna/cNcyttt+aiCD2SWfGnec25Bo0c6OQHaWFQgiW89nN2zALSut
gUFjoDFPUDPVRmWcYv6YORpQqp7G90z261hhy5myXOIjNXuc25Vl+ptTccR2uJoA
l2/vhbryZEWA40QZtY+t2OTJPJqbZp0/KvcUbCLhAYlYiDqe887wmIpJHGErkqqt
cWJ6NbBa1asjK842p8ux7jP/k1PtfbIuVolFy9G/D+zvRjn4rCwzrZGyJssXdum3
OX3K/xjreZTag4gESItYFZ24aG8gBwbB9ifFl42Y0QKBgQD6awWF2BcuH4WIKZ/P
9a97KRiOxjxU4BEv/KCPao99wcpsKm34t8xilSv7FzVdCJ8Y3jQkoS+IlgbJqO8k
m4MFUU8kvtnyVOZqEFHAKxIaYNW13sNEIt6GjP9k8MVRnBmm4PjfKP3rCzS+eWqa
BHjV+5wh6965nEWrSb7isqCU8wKBgQD3ddXLtMQJk8tD96qAWLrWmhfAJs06kreo
tlBOf57yvL1ehx2Cn2I9qTBW+CaJR0Uu3qXA/M5fZREPTheafaOXf0jhOjuF8jM9
tqCbz5MxJiLCZ4j+yd5clpPxw8uPlo/z9N12VcI6ios1VkxfVRVUP+NAlkKCORrJ
lDn9uS4x0QKBgH7ja9D+RgChCFCOhuQhYeHOWRs/Z6K6RvtBzzncjQj0AVX9yeuV
doMdg0Of5vJVRAidz14gLq3PF3FnoIW0Jxeys5+y9UzNqFNmIYZ2TJ4BI0kcr2T/
JjKXj3Hebp2Ds5vTs0egxckrzHYXn+SbD3+eFuc5VYpHnSXGIGtOh//xAoGBAO+B
JunADTTPzJ396RHLzxnBjlc1ttCIDCXIPrWbI3YAYrBIybERHf5b8CNcjb+0MSuJ
5peAlyURJo/Pn1yxWVJZqWoD+HRN1HZYed4T63xYUrAhkSA4tXSbcJlATZatvKn7
RxUvL4uFZ/K5kbV7Heeq5gIu7DQpnNmZEv+U6TbhAoGBAOET+cckf3+9Y/O0Ahs2
GsbcpGHHK4IgE7YSd1FgQqTCMoAlLV6F5tP9OKBvgvka1zXyt63yVHfsvW9N7e4o
0pV7k3vvaokGQ/WcODxU6oSQ+zTnfH70FV8guetKvmt6W/SYsnT55OKXSF3qObDv
4xLUnudow2dOcgGrc/4moVYC
-----END PRIVATE KEY-----`;

const LOCAL_HTTPS_CERT = `-----BEGIN CERTIFICATE-----
MIIDCTCCAfGgAwIBAgIUTuCwAsFNw2QH0+QyJG3KzMissj8wDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJMTI3LjAuMC4xMB4XDTI2MDgwMjEyMDc1NVoXDTM2MDcz
MDEyMDc1NVowFDESMBAGA1UEAwwJMTI3LjAuMC4xMIIBIjANBgkqhkiG9w0BAQEF
AAOCAQ8AMIIBCgKCAQEA8hCGX/jy4TbN5SzGZJOu/nxJ5aGKHYbkzLcS2EFO3AvU
diG6LO6/KIB02iF8Db046Yu/9lb7feKsEsvSqdJ9M2p3crvpyKzsyZRY9reNXTEb
sY780CyDxNJ6EnhnZiloMvwJWvP3srupqHRK6uDX3ZhKfEGZ44PJD23WD41w9zqP
dcp7vOuWwO1VLAQiO2liSGATg8V1EXiFbEmm4EbQi9b4IMSjeajDdeI2+Jsv+f/Q
Sr3fi2J1oj5mX/At/HkPLLCRcEp2r9M8iVxeJe2L9wQ9dVEtfeBe/M3OMqAFf6l5
O9WoGOL5r++Vd+e11c5FOEHfGwVPsiNF6a7p8EYdYwIDAQABo1MwUTAdBgNVHQ4E
FgQUfFGc2ER5StOu+fW0KeHTx4cABdMwHwYDVR0jBBgwFoAUfFGc2ER5StOu+fW0
KeHTx4cABdMwDwYDVR0TAQH/BAUwAwEB/zANBgkqhkiG9w0BAQsFAAOCAQEAV3Kr
yNJUjM0ORdkQtkdZmMbgAKepPzxBt96+uUByeXppozA4hgys5tV9z40bd3FeXgG5
xKM3lpB/J4azdNdvoPQdPB2+hf/hnd/WFNT35bYbQtQ79+p5odyFbDZ9U0SPNyc4
AMyqtHfFD8hzaqOdKs110ahSgzO6dHBipw3HvZixIqVklItz0r6a4TuhzxMQPT6b
GCH4cbvb5GF24Zw81s3hDZEfDaI9WA31EA55Naq6xeY0pSPuWbzW7eqgnJLyiyE0
skPypOpnkvhtO6ZqISH1/jnW8NXPAtoG9QEDx5DhXYFzlGgdA0AOcoEbEwq5+f+q
26C+E6T96MU0JlJd8w==
-----END CERTIFICATE-----`;

function firstRequest(plan: ReturnType<typeof validatedRepairPlan>) {
  return buildAlpacaTransportRequest(
    plan,
    { kind: "first-page", pageOrdinal: 0 },
    new AbortController().signal,
  ).request;
}

function eraseAdmissionRowsAndRestoreExactSchema(filename: string): void {
  const hostile = new Database(filename);
  try {
    const immutableDeleteTriggers = hostile
      .prepare(`SELECT name, sql FROM sqlite_schema
        WHERE name IN (
          'market_acquisition_owned_attempt_claims_no_delete',
          'market_acquisition_owned_request_started_no_delete'
        ) ORDER BY name`)
      .all() as Array<{ name: string; sql: string }>;
    assert.equal(immutableDeleteTriggers.length, 2);
    hostile.exec(`
      DROP TRIGGER market_acquisition_owned_attempt_claims_no_delete;
      DROP TRIGGER market_acquisition_owned_request_started_no_delete;
      DELETE FROM market_acquisition_owned_attempt_claims;
      DELETE FROM market_acquisition_owned_request_started;
    `);
    for (const trigger of immutableDeleteTriggers) hostile.exec(trigger.sql);
  } finally {
    hostile.close();
  }
}

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
  const result = await withAlpacaAuthorization(
    permit,
    source,
    requestLease.request,
    async (capability) => {
      assert.equal(Object.isFrozen(capability), true);
      assert.deepEqual(Object.keys(capability), ["kind"]);
      retained = capability;
      await transport.dispatch(capability);
      await assert.rejects(() => transport.dispatch(capability), /dispatch-capability-invalid/u);
      return "settled";
    },
  );
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
    () => transport.dispatch(retained as AlpacaDispatchCapability),
    /dispatch-capability-invalid/u,
  );
  await assert.rejects(() =>
    withAlpacaAuthorization(permit, source, requestLease.request, async () => "reused"),
  );
  const credentials = await import("../src/adapters/market-acquisition/credentials.js");
  assert.equal("resolveAlpacaDispatchCapability" in credentials, false);
});

test("spoofed NODE_TEST_CONTEXT cannot mint any test root or credential transport", () => {
  const moduleUrl = (path: string): string => pathToFileURL(resolve(path)).href;
  const urls = {
    credentials: moduleUrl("dist/production/src/adapters/market-acquisition/credentials.js"),
    acquisition: moduleUrl("dist/production/src/adapters/market-acquisition/memory-journal.js"),
    retentionJournal: moduleUrl(
      "dist/production/src/adapters/market-acquisition/retention/memory-journal.js",
    ),
    retentionController: moduleUrl(
      "dist/production/src/adapters/market-acquisition/retention/controller.js",
    ),
    artifactAccess: moduleUrl(
      "dist/production/src/adapters/market-acquisition/retention/artifact-access.js",
    ),
    retainedSink: moduleUrl(
      "dist/production/src/adapters/market-acquisition/alpaca/retained-sink.js",
    ),
    wire: moduleUrl("dist/production/src/adapters/market-acquisition/alpaca/wire.js"),
    semantics: moduleUrl(
      "dist/production/src/adapters/market-acquisition/alpaca/wire-semantic-evidence.js",
    ),
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
    if ("createAlpacaWireSemanticAuthority" in s) throw new Error("public-corpus-authority-export");
    let copied = false;
    const driver = { dispatch(_request, headers) { copied = Boolean(headers?.["APCA-API-KEY-ID"]); }, abort() {}, settle() {} };
    const attempts = [
      () => c.createTestCredentialIsolatedAlpacaTransport(driver),
      () => c.createTestNativeCredentialIsolatedAlpacaTransport(driver),
      () => c.assertTestNativeAlpacaTransportReleased({}),
      () => c.createTestDurableCredentialAuthorizationBoundary({}, {}),
      () => c.openTestSqliteDurableCredentialAuthorizationBoundary("ignored", [], {}),
      () => c.provisionSqliteDurableCredentialAuthorityRuntime([]),
      () => a.createMemoryAcquisitionJournal({}),
      () => rj.createMemoryArtifactRetentionJournal(),
      () => rc.createTestArtifactRetentionController({}),
      () => aa.createTestRetentionEnforcedArtifactStore({}, {}),
      () => rs.createTestAlpacaArtifactCommitSink({}),
      () => w.createTestDurableAlpacaWireAdmissionBoundary({}, {}),
      () => s.createTestDurableAlpacaWireSemanticEvidenceBoundary({}, {}, {}),
      () => s.appendTestAlpacaWireSemanticEvidence({}, {}),
      () => s.createTestAlpacaWireSemanticAuthority({}),
      () => c.createProductionCredentialIsolatedAlpacaTransport(driver),
    ];
    for (const attempt of attempts) {
      let rejected = false;
      try { attempt(); } catch { rejected = true; }
      if (!rejected) throw new Error("spoofed-test-root-admitted");
    }
    if (copied) throw new Error("plaintext-copied");
  `;
  for (const attack of [
    { cli: ["--conditions=p1-10-test"], nodeOptions: "" },
    { cli: [], nodeOptions: "--conditions=p1-10-test" },
  ]) {
    const result = spawnSync(
      process.execPath,
      [...attack.cli, "--input-type=module", "--eval", probe, JSON.stringify(urls)],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          NODE_TEST_CONTEXT: "peas-spoof",
          NODE_OPTIONS: attack.nodeOptions,
        },
        encoding: "utf8",
        windowsHide: true,
      },
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  }
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

test("owned first boot provisions only a completely absent trusted runtime layout", async (t) => {
  const runtimeRoot = await mkdtemp(join(tmpdir(), "peas-owned-first-boot-"));
  const nonEmptyRoot = await mkdtemp(join(tmpdir(), "peas-owned-first-boot-nonempty-"));
  const danglingRoot = await mkdtemp(join(tmpdir(), "peas-owned-first-boot-dangling-"));
  const danglingTarget = await mkdtemp(join(tmpdir(), "peas-owned-first-boot-target-"));
  const priorRoot = process.env["PEAS_RUNTIME_ROOT"];
  t.after(async () => {
    if (priorRoot === undefined) delete process.env["PEAS_RUNTIME_ROOT"];
    else process.env["PEAS_RUNTIME_ROOT"] = priorRoot;
    await rm(runtimeRoot, { recursive: true, force: true });
    await rm(nonEmptyRoot, { recursive: true, force: true });
    await rm(danglingRoot, { recursive: true, force: true });
    await rm(danglingTarget, { recursive: true, force: true });
  });
  const migrations = loadMigrations(join(process.cwd(), "migrations"));
  process.env["PEAS_RUNTIME_ROOT"] = runtimeRoot;
  provisionSqliteDurableCredentialAuthorityRuntime(migrations);
  const primary = join(runtimeRoot, "sqlite", "market-acquisition-authority.sqlite");
  const anchor = join(runtimeRoot, "sqlite", "market-acquisition-authority-anchor.sqlite");
  assert.equal(existsSync(primary), true);
  assert.equal(existsSync(anchor), true);
  assert.equal(existsSync(join(runtimeRoot, "sqlite", "peas.sqlite")), false);
  assert.throws(() => openSqliteDatabase(primary, migrations), /protected-sqlite-database-path/u);
  assert.throws(
    () => provisionSqliteDurableCredentialAuthorityRuntime(migrations),
    /credential-authority-provisioning-layout-not-empty/u,
  );

  process.env["PEAS_RUNTIME_ROOT"] = nonEmptyRoot;
  await mkdir(join(nonEmptyRoot, "artifacts"));
  assert.throws(
    () => provisionSqliteDurableCredentialAuthorityRuntime(migrations),
    /credential-authority-provisioning-layout-not-empty/u,
  );
  assert.equal(existsSync(join(nonEmptyRoot, "sqlite")), false);

  process.env["PEAS_RUNTIME_ROOT"] = danglingRoot;
  const danglingArtifacts = join(danglingRoot, "artifacts");
  await symlink(
    danglingTarget,
    danglingArtifacts,
    process.platform === "win32" ? "junction" : "dir",
  );
  await rm(danglingTarget, { recursive: true, force: true });
  assert.equal((await lstat(danglingArtifacts)).isSymbolicLink(), true);
  assert.equal(existsSync(danglingArtifacts), false);
  assert.throws(
    () => provisionSqliteDurableCredentialAuthorityRuntime(migrations),
    /credential-authority-provisioning-layout-not-empty/u,
  );
  assert.equal(existsSync(join(danglingRoot, "sqlite")), false);
});

test("owned initializer keeps first-boot authority private, root-bound, and ephemeral", async (t) => {
  const runtimeRoot = await mkdtemp(join(tmpdir(), "peas-owned-initializer-root-"));
  const alternateRoot = await mkdtemp(join(tmpdir(), "peas-owned-initializer-alternate-"));
  const failedRoot = await mkdtemp(join(tmpdir(), "peas-owned-initializer-failure-"));
  const privateTemp = await mkdtemp(join(tmpdir(), "peas-owned-initializer-temp-"));
  t.after(async () => {
    await rm(runtimeRoot, { recursive: true, force: true });
    await rm(alternateRoot, { recursive: true, force: true });
    await rm(failedRoot, { recursive: true, force: true });
    await rm(privateTemp, { recursive: true, force: true });
  });
  const policyBytes = await readFile("config/artifact-vault-deployment-policy.v1.json");
  const policySha256 = createHash("sha256").update(policyBytes).digest("hex");
  const validationPath = join(privateTemp, "runtime-validation.json");
  const writeValidation = async (root: string): Promise<void> => {
    await writeFile(
      validationPath,
      JSON.stringify({
        status: "passed",
        runtimeRoot: resolve(root),
        policySha256,
        layout: { database: join(resolve(root), "sqlite", "peas.sqlite") },
      }),
    );
  };
  const runInitializer = (root: string) =>
    spawnSync(process.execPath, ["scripts/initialize-vault-runtime.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PEAS_RUNTIME_ROOT: root,
        PEAS_RUNTIME_VALIDATION_PATH: validationPath,
        TEMP: privateTemp,
        TMP: privateTemp,
      },
      encoding: "utf8",
      windowsHide: true,
      timeout: 60_000,
    });
  const productionAuthorityPath = join(
    process.cwd(),
    "dist",
    "production",
    "src",
    "internal-provisioning-authority.js",
  );
  const productionAuthorityBefore = await readFile(productionAuthorityPath);
  const provisioningParent = join(process.cwd(), ".tmp-output-integrity");
  const privateProvisioningCopies = async (): Promise<string[]> =>
    existsSync(provisioningParent)
      ? (await readdir(provisioningParent)).filter((entry) =>
          entry.startsWith("p1-10-provisioning-"),
        )
      : [];

  await writeValidation(runtimeRoot);
  const initialized = runInitializer(runtimeRoot);
  assert.equal(initialized.status, 0, `${initialized.stdout}\n${initialized.stderr}`);
  assert.equal(
    existsSync(join(runtimeRoot, "sqlite", "market-acquisition-authority.sqlite")),
    true,
  );
  assert.equal(
    existsSync(join(runtimeRoot, "sqlite", "market-acquisition-authority-anchor.sqlite")),
    true,
  );
  assert.deepEqual(await readFile(productionAuthorityPath), productionAuthorityBefore);
  assert.deepEqual(await privateProvisioningCopies(), []);

  const publicProbe = `
    import { join } from "node:path";
    import { provisionSqliteDurableCredentialAuthorityRuntime } from "./dist/production/src/adapters/market-acquisition/credentials.js";
    import { loadMigrations } from "./dist/production/src/adapters/sqlite/database.js";
    process.env.PEAS_RUNTIME_ROOT = process.argv[1];
    let outcome = "unexpected-success";
    try { provisionSqliteDurableCredentialAuthorityRuntime(loadMigrations(join(process.cwd(), "migrations"))); }
    catch (error) { outcome = error instanceof Error ? error.message : String(error); }
    process.stdout.write(JSON.stringify({ outcome }));
  `;
  const publicAttempt = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", publicProbe, alternateRoot],
    { cwd: process.cwd(), encoding: "utf8", windowsHide: true, timeout: 60_000 },
  );
  assert.equal(publicAttempt.status, 0, `${publicAttempt.stdout}\n${publicAttempt.stderr}`);
  assert.deepEqual(JSON.parse(publicAttempt.stdout), {
    outcome: "credential-authority-provisioning-unavailable",
  });
  assert.equal(existsSync(join(alternateRoot, "sqlite")), false);

  await mkdir(join(failedRoot, "artifacts"));
  await writeValidation(failedRoot);
  const failed = runInitializer(failedRoot);
  assert.notEqual(failed.status, 0, `${failed.stdout}\n${failed.stderr}`);
  assert.match(failed.stderr, /credential-authority-provisioning-layout-not-empty/u);
  assert.deepEqual(await readFile(productionAuthorityPath), productionAuthorityBefore);
  assert.deepEqual(await privateProvisioningCopies(), []);
  assert.equal(existsSync(join(failedRoot, "sqlite")), false);
});

test("cold restart never reconstructs a missing anchor or replaced primary", async (t) => {
  const anchorRoot = await mkdtemp(join(tmpdir(), "peas-anchor-deletion-restart-"));
  const primaryRoot = await mkdtemp(join(tmpdir(), "peas-primary-replacement-restart-"));
  t.after(async () => {
    await rm(anchorRoot, { recursive: true, force: true });
    await rm(primaryRoot, { recursive: true, force: true });
  });
  const probe = `
    import { join } from "node:path";
    import {
      openSqliteDurableCredentialAuthorizationBoundary,
      provisionSqliteDurableCredentialAuthorityRuntime,
    } from "./dist/src/adapters/market-acquisition/credentials.js";
    import { loadMigrations } from "./dist/src/adapters/sqlite/database.js";
    import { credentialAuthorizationFixture, validatedRepairPlan } from "./dist/test/p1-10-repair-fixtures.js";
    const root = process.argv[1];
    const action = process.argv[2];
    process.env.PEAS_RUNTIME_ROOT = root;
    const migrations = loadMigrations(join(process.cwd(), "migrations"));
    let outcome = "ok";
    let authority;
    try {
      if (action === "provision-admit") {
        provisionSqliteDurableCredentialAuthorityRuntime(migrations);
        const plan = validatedRepairPlan();
        const fixture = await credentialAuthorizationFixture(plan);
        authority = openSqliteDurableCredentialAuthorizationBoundary(migrations, plan);
        await authority.establish(fixture.request);
      } else if (action === "provision") {
        provisionSqliteDurableCredentialAuthorityRuntime(migrations);
      } else {
        authority = openSqliteDurableCredentialAuthorizationBoundary(migrations, validatedRepairPlan());
      }
    } catch (error) {
      outcome = error instanceof Error ? error.message : String(error);
    } finally {
      authority?.close();
    }
    process.stdout.write(JSON.stringify({ outcome }));
  `;
  const run = (root: string, action: string) => {
    const result = spawnSync(
      process.execPath,
      ["--input-type=module", "--eval", probe, root, action],
      {
        cwd: process.cwd(),
        env: { ...process.env, PEAS_RUNTIME_ROOT: root },
        encoding: "utf8",
        windowsHide: true,
        timeout: 60_000,
      },
    );
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    return JSON.parse(result.stdout) as { outcome: string };
  };

  assert.deepEqual(run(anchorRoot, "provision-admit"), { outcome: "ok" });
  await rm(join(anchorRoot, "sqlite", "market-acquisition-authority-anchor.sqlite"), {
    force: true,
  });
  assert.deepEqual(run(anchorRoot, "open"), {
    outcome: "credential-authority-layout-corrupt",
  });
  assert.deepEqual(run(anchorRoot, "provision"), {
    outcome: "credential-authority-provisioning-layout-not-empty",
  });
  assert.equal(
    existsSync(join(anchorRoot, "sqlite", "market-acquisition-authority-anchor.sqlite")),
    false,
  );

  assert.deepEqual(run(primaryRoot, "provision-admit"), { outcome: "ok" });
  eraseAdmissionRowsAndRestoreExactSchema(
    join(primaryRoot, "sqlite", "market-acquisition-authority.sqlite"),
  );
  assert.deepEqual(run(primaryRoot, "open"), {
    outcome: "credential-admission-state-invalid",
  });
  assert.deepEqual(run(primaryRoot, "provision"), {
    outcome: "credential-authority-provisioning-layout-not-empty",
  });
});

test("live credential admission has one canonical non-shardable protected durable root", async (t) => {
  const firstRoot = await mkdtemp(join(tmpdir(), "peas-live-credential-root-"));
  const alternateRoot = await mkdtemp(join(tmpdir(), "peas-live-credential-alternate-"));
  const priorRoot = process.env["PEAS_RUNTIME_ROOT"];
  t.after(async () => {
    if (priorRoot === undefined) delete process.env["PEAS_RUNTIME_ROOT"];
    else process.env["PEAS_RUNTIME_ROOT"] = priorRoot;
    await rm(firstRoot, { recursive: true, force: true });
    await rm(alternateRoot, { recursive: true, force: true });
  });
  process.env["PEAS_RUNTIME_ROOT"] = firstRoot;
  const plan = validatedRepairPlan();
  const fixture = await credentialAuthorizationFixture(plan);
  const migrations = loadMigrations(join(process.cwd(), "migrations"));
  const authorityPath = join(firstRoot, "sqlite", "market-acquisition-authority.sqlite");
  const anchorPath = join(firstRoot, "sqlite", "market-acquisition-authority-anchor.sqlite");
  assert.throws(
    () => openSqliteDurableCredentialAuthorizationBoundary(migrations, plan),
    /credential-authority-not-provisioned/u,
  );
  assert.throws(
    () => openSqliteDatabase(authorityPath, migrations),
    /protected-sqlite-database-path/u,
  );
  assert.throws(
    () => openSqliteDatabase(anchorPath, migrations),
    /protected-sqlite-database-path/u,
  );
  assert.throws(
    () =>
      openSqliteDurableCredentialAuthorizationBoundary(
        migrations.map((migration, index) =>
          index === 0 ? { ...migration, sql: `${migration.sql}\nSELECT 1;` } : migration,
        ),
        plan,
      ),
    /live-credential-migrations-invalid/u,
  );
  provisionSqliteDurableCredentialAuthorityRuntime(migrations);
  assert.throws(
    () => provisionSqliteDurableCredentialAuthorityRuntime(migrations),
    /credential-authority-provisioning-layout-not-empty/u,
  );
  const authority = openSqliteDurableCredentialAuthorizationBoundary(migrations, plan);
  await authority.establish(fixture.request);
  assert.throws(
    () => openSqliteDatabase(authorityPath, migrations),
    /protected-sqlite-database-path/u,
  );
  process.env["PEAS_RUNTIME_ROOT"] = alternateRoot;
  for (let attempt = 1; attempt < 49; attempt += 1) {
    assert.throws(
      () => openSqliteDurableCredentialAuthorizationBoundary(migrations, plan),
      /live-credential-authorization-root-already-opened/u,
    );
  }

  eraseAdmissionRowsAndRestoreExactSchema(authorityPath);
  await assert.rejects(
    () => authority.establish(fixture.request),
    /credential-admission-state-invalid/u,
  );
  authority.close();
});

test("separate processes cannot replace the canonical credential runtime root", async (t) => {
  const firstRoot = await mkdtemp(join(tmpdir(), "peas-live-process-root-a-"));
  const secondRoot = await mkdtemp(join(tmpdir(), "peas-live-process-root-b-"));
  t.after(async () => {
    await rm(firstRoot, { recursive: true, force: true });
    await rm(secondRoot, { recursive: true, force: true });
  });
  const probe = `
    import { join } from "node:path";
    import { openSqliteDurableCredentialAuthorizationBoundary, provisionSqliteDurableCredentialAuthorityRuntime } from "./dist/src/adapters/market-acquisition/credentials.js";
    import { loadMigrations } from "./dist/src/adapters/sqlite/database.js";
    import { credentialAuthorizationFixture, validatedRepairPlan } from "./dist/test/p1-10-repair-fixtures.js";
    const root = process.argv[1];
    const attempts = Number(process.argv[2]);
    const provision = process.argv[3] === "provision";
    process.env.PEAS_RUNTIME_ROOT = root;
    const plan = validatedRepairPlan();
    const fixture = await credentialAuthorizationFixture(plan);
    let admitted = 0;
    let denied = null;
    let authority;
    try {
      if (provision) provisionSqliteDurableCredentialAuthorityRuntime(
        loadMigrations(join(process.cwd(), "migrations")),
      );
      authority = openSqliteDurableCredentialAuthorizationBoundary(
        loadMigrations(join(process.cwd(), "migrations")),
        plan,
      );
      for (let index = 0; index < attempts; index += 1) {
        await authority.establish(fixture.request);
        admitted += 1;
      }
    } catch (error) {
      denied = error instanceof Error ? error.message : String(error);
    } finally {
      authority?.close();
    }
    process.stdout.write(JSON.stringify({ admitted, denied }));
  `;
  const run = (root: string, attempts: number, provision = false) =>
    spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        probe,
        root,
        String(attempts),
        provision ? "provision" : "open",
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, PEAS_RUNTIME_ROOT: root },
        encoding: "utf8",
        windowsHide: true,
        timeout: 60_000,
      },
    );
  const first = run(firstRoot, 1, true);
  assert.equal(first.status, 0, `${first.stdout}\n${first.stderr}`);
  assert.deepEqual(JSON.parse(first.stdout), {
    admitted: 1,
    denied: null,
  });
  const second = run(secondRoot, 1);
  assert.equal(second.status, 0, `${second.stdout}\n${second.stderr}`);
  assert.deepEqual(JSON.parse(second.stdout), {
    admitted: 0,
    denied: "credential-authority-not-provisioned",
  });
});

test("native HTTPS request/response ownership detaches on success, error, and abort", async (t) => {
  const retainedPlatformRequests: ClientRequest[] = [];
  const server = createServer(
    { key: LOCAL_HTTPS_KEY, cert: LOCAL_HTTPS_CERT },
    (request, response) => {
      if (request.url?.includes("mode=error")) {
        request.socket.destroy();
        return;
      }
      if (request.url?.includes("mode=abort")) return;
      response.writeHead(200, { "content-length": "2" });
      response.end("ok");
    },
  );
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  t.after(() => new Promise<void>((resolveClose) => server.close(() => resolveClose())));
  const address = server.address();
  assert.ok(address !== null && typeof address === "object");
  const nativeTransport = (mode: "success" | "error" | "abort") =>
    createTestNativeCredentialIsolatedAlpacaTransport((url, options) => {
      const physical = dispatchLocalRequest({
        hostname: "127.0.0.1",
        port: address.port,
        method: options.method,
        path: `${url.pathname}?mode=${mode}`,
        headers: options.headers,
        signal: options.signal,
        rejectUnauthorized: false,
      });
      retainedPlatformRequests.push(physical);
      return physical;
    });
  const run = async (mode: "success" | "error" | "abort") => {
    const plan = validatedRepairPlan();
    const fixture = await credentialAuthorizationFixture(plan);
    const permit = authorizeCredentialLoad(await fixture.authorization.establish(fixture.request));
    const request = firstRequest(plan);
    const transport = nativeTransport(mode);
    const result = await withAlpacaAuthorization(
      permit,
      {
        read(name) {
          return name === ALPACA_KEY_ID_ENV ? "native-key-sentinel" : "native-secret-sentinel";
        },
      },
      request,
      async (capability) => {
        const responsePromise = transport.dispatch(capability);
        if (mode === "abort") {
          await new Promise<void>((resolveTurn) => setImmediate(resolveTurn));
          await transport.abort();
          return await responsePromise;
        }
        const response = await responsePromise;
        if (mode === "error") return response;
        for (;;) {
          const read = await response.body.read();
          if (read.done) break;
        }
        await response.body.settle();
        await transport.settle();
        return response;
      },
    );
    assertTestNativeAlpacaTransportReleased(transport);
    return result;
  };
  const success = await run("success");
  assert.equal(success.ok, true);
  // ClientRequest may retain outgoing platform headers; PEAS owns no reference after settlement.
  assert.equal(retainedPlatformRequests[0]?.getHeader("APCA-API-KEY-ID"), "native-key-sentinel");
  const errored = await run("error");
  assert.equal(errored.ok, false);
  const aborted = await run("abort");
  assert.equal(aborted.ok, false);
});

test("all production SQLite wrappers reject structural, raw, proxied, and shadowed adapters", async (t) => {
  const fixture = await credentialAuthorizationFixture(validatedRepairPlan());
  const raw = new Database(":memory:");
  t.after(() => raw.close());
  const fake = {
    exec() {},
    prepare() {
      throw new Error("hostile database adapter invoked");
    },
    transaction() {
      throw new Error("hostile database adapter invoked");
    },
  };
  const factories = [
    (database: never) => createSqliteAcquisitionJournal(database, fixture.request.journalIdentity),
    (database: never) => createSqliteArtifactRetentionJournal(database),
    (database: never) => createSqliteAlpacaWireSemanticEvidenceStore(database),
    (database: never) => new SqliteArtifactRepository(database),
  ];
  for (const hostile of [fake, raw, new Proxy(raw, {})]) {
    for (const factory of factories) {
      assert.throws(() => factory(hostile as never), /owned-sqlite-database-required/u);
    }
  }
  const directory = await mkdtemp(join(tmpdir(), "peas-owned-sqlite-root-"));
  const owned = openSqliteDatabase(
    join(directory, "owned.sqlite"),
    loadMigrations(join(process.cwd(), "migrations")),
  );
  t.after(async () => {
    if (owned.open) owned.close();
    await rm(directory, { recursive: true, force: true });
  });
  assert.throws(
    () => Object.defineProperty(owned, "prepare", { value: fake.prepare }),
    /not extensible|Cannot define property/u,
  );
  assert.doesNotThrow(() => createSqliteAcquisitionJournal(owned, fixture.request.journalIdentity));
  assert.doesNotThrow(() => createSqliteArtifactRetentionJournal(owned));
  assert.doesNotThrow(() => createSqliteAlpacaWireSemanticEvidenceStore(owned));
  assert.doesNotThrow(() => new SqliteArtifactRepository(owned));
});

test("missing credentials return a closed error and never invoke transport", async () => {
  const plan = validatedRepairPlan();
  const fixture = await credentialAuthorizationFixture(plan);
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
    firstRequest(plan),
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

test("destination and complete ordered query are capability-bound before every secret read", async () => {
  const plan = validatedRepairPlan();
  const baseRequest = (): ReturnType<typeof firstRequest> => firstRequest(plan);
  const structuralAttacks: readonly Readonly<{
    name: string;
    mutate(request: ReturnType<typeof firstRequest>): unknown;
  }>[] = [
    { name: "origin", mutate: (request) => ({ ...request, origin: "https://example.invalid" }) },
    {
      name: "port",
      mutate: (request) => ({ ...request, origin: "https://data.alpaca.markets:444" }),
    },
    {
      name: "protocol",
      mutate: (request) => ({ ...request, origin: "http://data.alpaca.markets" }),
    },
    {
      name: "encoded-host",
      mutate: (request) => ({ ...request, origin: "https://data%2ealpaca.markets" }),
    },
    { name: "path", mutate: (request) => ({ ...request, path: "/v2/stocks/bars" }) },
    {
      name: "duplicate-query",
      mutate: (request) => ({ ...request, query: [...request.query, request.query[0]] }),
    },
    {
      name: "reordered-query",
      mutate: (request) => ({ ...request, query: [...request.query].reverse() }),
    },
    {
      name: "extra-query",
      mutate: (request) => ({ ...request, query: [...request.query, ["feed", "sip"]] }),
    },
  ];
  for (const attack of structuralAttacks) {
    const fixture = await credentialAuthorizationFixture(plan);
    const permit = authorizeCredentialLoad(await fixture.authorization.establish(fixture.request));
    let reads = 0;
    let dispatches = 0;
    await assert.rejects(
      () =>
        withAlpacaAuthorization(
          permit,
          {
            read() {
              reads += 1;
              return "must-not-be-read";
            },
          },
          attack.mutate(baseRequest()) as never,
          async () => {
            dispatches += 1;
          },
        ),
      /dispatch-destination-invalid/u,
      attack.name,
    );
    assert.equal(reads, 0, attack.name);
    assert.equal(dispatches, 0, attack.name);
  }
  const fixture = await credentialAuthorizationFixture(plan);
  const permit = authorizeCredentialLoad(await fixture.authorization.establish(fixture.request));
  const mutated = baseRequest();
  (mutated.query[0] as [string, string])[1] = "QA,QB,EXTRA";
  let reads = 0;
  await assert.rejects(
    () =>
      withAlpacaAuthorization(
        permit,
        {
          read() {
            reads += 1;
            return "must-not-be-read";
          },
        },
        mutated,
        async () => undefined,
      ),
    /dispatch-destination-invalid/u,
  );
  assert.equal(reads, 0);
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
        firstRequest(plan),
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
  const plan = validatedRepairPlan();
  const fixture = await credentialAuthorizationFixture(plan);
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
    firstRequest(plan),
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

test("SQLite restart advances one owned attempt ordinal without reminting caller identity", async (t) => {
  const fixture = await credentialAuthorizationFixture(validatedRepairPlan());
  const directory = await mkdtemp(join(tmpdir(), "peas-p1-10-credential-claim-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = join(directory, "claim.sqlite");
  const migrations = loadMigrations(join(process.cwd(), "migrations"));
  const first = openTestSqliteDurableCredentialAuthorizationBoundary(
    filename,
    migrations,
    fixture.request.plan,
  );
  await first.establish(fixture.request);
  first.close();
  const restarted = openTestSqliteDurableCredentialAuthorizationBoundary(
    filename,
    migrations,
    fixture.request.plan,
  );
  await restarted.establish(fixture.request);
  restarted.close();
  const database = openSqliteDatabase(filename, migrations);
  const claims = database
    .prepare(`SELECT attempt_ordinal, retrieval_attempt_id
      FROM market_acquisition_owned_attempt_claims ORDER BY attempt_ordinal`)
    .all() as Array<{ attempt_ordinal: bigint; retrieval_attempt_id: string }>;
  assert.deepEqual(
    claims.map((claim) => claim.attempt_ordinal),
    [0n, 1n],
  );
  assert.equal(new Set(claims.map((claim) => claim.retrieval_attempt_id)).size, 2);
  assert.equal(
    claims.some((claim) => claim.retrieval_attempt_id === fixture.request.retrievalAttemptId),
    false,
  );
  database.close();
});

test("owned production admission caps caller-selected workflows before secret reads", async (t) => {
  const fixture = await credentialAuthorizationFixture(validatedRepairPlan());
  const directory = await mkdtemp(join(tmpdir(), "peas-p1-10-owned-admission-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = join(directory, "admission.sqlite");
  const migrations = loadMigrations(join(process.cwd(), "migrations"));
  const authorization = openTestSqliteDurableCredentialAuthorizationBoundary(
    filename,
    migrations,
    fixture.request.plan,
  );
  let reads = 0;
  const admittedRetrievalIds = new Set<string>();
  for (let index = 0; index < MARKET_ACQUISITION_LIMITS.rateAttempts; index += 1) {
    const callerRetrievalAttemptId = `rat1_${index.toString(16).padStart(64, "0")}`;
    const evidence = await authorization.establish({
      ...fixture.request,
      retrievalAttemptId: callerRetrievalAttemptId,
      acquisitionObservationId: index.toString(16).padStart(64, "f"),
    });
    const permit = authorizeCredentialLoad(evidence);
    admittedRetrievalIds.add(permit.retrievalAttemptId);
    assert.notEqual(permit.retrievalAttemptId, callerRetrievalAttemptId);
    const result = await withAlpacaAuthorization(
      permit,
      {
        read(name) {
          reads += 1;
          return name === ALPACA_KEY_ID_ENV ? "synthetic-key" : "synthetic-secret";
        },
      },
      firstRequest(fixture.request.plan),
      async () => "admitted",
    );
    assert.deepEqual(result, { ok: true, value: "admitted" });
  }
  for (
    let index = MARKET_ACQUISITION_LIMITS.rateAttempts;
    index < MARKET_ACQUISITION_LIMITS.attemptsPerAcquisition + 1;
    index += 1
  ) {
    await assert.rejects(
      () =>
        authorization.establish({
          ...fixture.request,
          retrievalAttemptId: `rat1_${index.toString(16).padStart(64, "0")}`,
        }),
      /credential-quota-exhausted/u,
    );
  }
  assert.equal(reads, MARKET_ACQUISITION_LIMITS.rateAttempts * 2);
  assert.equal(admittedRetrievalIds.size, MARKET_ACQUISITION_LIMITS.rateAttempts);
  authorization.close();

  const restarted = openTestSqliteDurableCredentialAuthorizationBoundary(
    filename,
    migrations,
    fixture.request.plan,
  );
  await assert.rejects(() => restarted.establish(fixture.request), /credential-quota-exhausted/u);
  restarted.close();
  const database = openSqliteDatabase(filename, migrations);
  const claims = database
    .prepare(`SELECT COUNT(*) AS count, COUNT(DISTINCT acquisition_id) AS acquisitions,
      MIN(attempt_ordinal) AS minimum_ordinal, MAX(attempt_ordinal) AS maximum_ordinal
      FROM market_acquisition_owned_attempt_claims`)
    .get() as {
    count: bigint;
    acquisitions: bigint;
    minimum_ordinal: bigint;
    maximum_ordinal: bigint;
  };
  assert.deepEqual(claims, {
    count: BigInt(MARKET_ACQUISITION_LIMITS.rateAttempts),
    acquisitions: 1n,
    minimum_ordinal: 0n,
    maximum_ordinal: BigInt(MARKET_ACQUISITION_LIMITS.rateAttempts - 1),
  });
  database.close();
});

test("cold restart rejects reset admission rows with the exact official schema restored", async (t) => {
  const fixture = await credentialAuthorizationFixture(validatedRepairPlan());
  const directory = await mkdtemp(join(tmpdir(), "peas-p1-10-admission-reset-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = join(directory, "admission.sqlite");
  const migrations = loadMigrations(join(process.cwd(), "migrations"));
  const authority = openTestSqliteDurableCredentialAuthorizationBoundary(
    filename,
    migrations,
    fixture.request.plan,
  );
  await authority.establish(fixture.request);
  authority.close();

  eraseAdmissionRowsAndRestoreExactSchema(filename);
  assert.throws(
    () =>
      openTestSqliteDurableCredentialAuthorizationBoundary(
        filename,
        migrations,
        fixture.request.plan,
      ),
    /credential-admission-state-invalid/u,
  );
});

test("owned credential admission planner enforces exact quota, attempt, and deadline edges", () => {
  const base = {
    nowMs: 1_000,
    acquisitionStartedMs: 1_000,
    lastAttemptStartedMs: 1_000,
    attemptsStarted: 0,
    rollingProjectAttempts: 0,
  } as const;
  assert.deepEqual(
    planCredentialAttemptAdmission({
      ...base,
      nowMs: base.acquisitionStartedMs + MARKET_ACQUISITION_LIMITS.acquisitionDeadlineMs - 1,
    }),
    { kind: "admit", attemptOrdinal: 0, attemptBudgetMs: 1 },
  );
  assert.deepEqual(
    planCredentialAttemptAdmission({
      ...base,
      nowMs: base.acquisitionStartedMs + MARKET_ACQUISITION_LIMITS.acquisitionDeadlineMs,
    }),
    { kind: "stop", reason: "acquisition-deadline" },
  );
  assert.deepEqual(
    planCredentialAttemptAdmission({
      ...base,
      attemptsStarted: MARKET_ACQUISITION_LIMITS.attemptsPerAcquisition - 1,
    }),
    {
      kind: "admit",
      attemptOrdinal: MARKET_ACQUISITION_LIMITS.attemptsPerAcquisition - 1,
      attemptBudgetMs: MARKET_ACQUISITION_LIMITS.attemptDeadlineMs,
    },
  );
  assert.deepEqual(
    planCredentialAttemptAdmission({
      ...base,
      attemptsStarted: MARKET_ACQUISITION_LIMITS.attemptsPerAcquisition,
    }),
    { kind: "stop", reason: "attempt-budget-exhausted" },
  );
  assert.deepEqual(
    planCredentialAttemptAdmission({
      ...base,
      rollingProjectAttempts: MARKET_ACQUISITION_LIMITS.rateAttempts - 1,
    }),
    {
      kind: "admit",
      attemptOrdinal: 0,
      attemptBudgetMs: MARKET_ACQUISITION_LIMITS.attemptDeadlineMs,
    },
  );
  assert.deepEqual(
    planCredentialAttemptAdmission({
      ...base,
      rollingProjectAttempts: MARKET_ACQUISITION_LIMITS.rateAttempts,
    }),
    { kind: "stop", reason: "quota-exhausted" },
  );
  assert.deepEqual(
    planCredentialAttemptAdmission({ ...base, nowMs: base.lastAttemptStartedMs - 1 }),
    { kind: "stop", reason: "clock-regression" },
  );
});

test("an alternate raw-handle chain cannot satisfy the opaque production credential root", async (t) => {
  const fixture = await credentialAuthorizationFixture(validatedRepairPlan());
  const directory = await mkdtemp(join(tmpdir(), "peas-p1-10-raw-forgery-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = join(directory, "forged.sqlite");
  const migrations = loadMigrations(join(process.cwd(), "migrations"));
  const database = openSqliteDatabase(filename, migrations);
  createSqliteAcquisitionJournal(database, fixture.request.journalIdentity);
  database.exec(`
    DROP TRIGGER market_acquisition_workflow_journal_entries_owned_insert;
    DROP TRIGGER market_acquisition_workflow_journal_proofs_owned_insert;
    DROP TRIGGER market_acquisition_workflow_ledger_entries_owned_insert;
    DROP TRIGGER market_acquisition_workflow_ledger_proofs_owned_insert;
  `);
  const insertLedger = database.prepare(`INSERT INTO market_acquisition_ledger_entries
    (market_acquisition_journal_id, execution_id, ledger_sequence, entry_id, entry_json, entry_hash)
    VALUES (?, ?, ?, ?, ?, ?)`);
  const insertLedgerProof = database.prepare(`INSERT INTO market_acquisition_workflow_ledger_proofs
    (market_acquisition_journal_id, entry_id) VALUES (?, ?)`);
  for (const [index, entry] of fixture.ledgerEntries.entries()) {
    insertLedger.run(
      fixture.request.marketAcquisitionJournalId,
      entry.executionId,
      BigInt(index),
      entry.entryId,
      canonicalJson(entry as unknown as JsonValue),
      entry.entryHash,
    );
    insertLedgerProof.run(fixture.request.marketAcquisitionJournalId, entry.entryId);
  }
  const insertJournal = database.prepare(`INSERT INTO market_acquisition_journal_entries
    (market_acquisition_journal_id, journal_sequence, prior_journal_entry_hash,
     journal_entry_hash, checkpoint_kind, entry_json) VALUES (?, ?, ?, ?, ?, ?)`);
  const insertJournalProof =
    database.prepare(`INSERT INTO market_acquisition_workflow_journal_proofs
    (market_acquisition_journal_id, journal_entry_hash) VALUES (?, ?)`);
  for (const entry of fixture.entries) {
    insertJournal.run(
      fixture.request.marketAcquisitionJournalId,
      BigInt(entry.journalSequence),
      entry.priorJournalEntryHash,
      entry.journalEntryHash,
      entry.checkpointKind,
      canonicalJson(entry as unknown as JsonValue),
    );
    insertJournalProof.run(fixture.request.marketAcquisitionJournalId, entry.journalEntryHash);
  }
  database.close();
  const authorization = openTestSqliteDurableCredentialAuthorizationBoundary(
    filename,
    migrations,
    fixture.request.plan,
  );
  await authorization.establish({
    ...fixture.request,
    acquisitionObservationId: "f".repeat(64),
    retrievalAttemptId: `rat1_${"e".repeat(64)}`,
  });
  authorization.close();
  const owned = openSqliteDatabase(filename, migrations);
  const admitted = owned
    .prepare(`SELECT retrieval_attempt_id, acquisition_observation_id
      FROM market_acquisition_owned_attempt_claims`)
    .get() as { retrieval_attempt_id: string; acquisition_observation_id: string };
  assert.notEqual(admitted.retrieval_attempt_id, `rat1_${"e".repeat(64)}`);
  assert.notEqual(admitted.acquisition_observation_id, "f".repeat(64));
  owned.close();
});

test("public journals cannot author coherent credential prerequisite facts", async (t) => {
  const fixture = await credentialAuthorizationFixture(validatedRepairPlan());
  const memory = createMemoryAcquisitionJournal(fixture.request.journalIdentity);
  for (const authority of [undefined, {}, new Proxy({}, {})]) {
    await assert.rejects(
      () => memory.appendLedgerEntries(fixture.ledgerEntries, authority),
      /owned-acquisition-workflow-producer-required/u,
    );
    await assert.rejects(
      () => memory.append(fixture.entries[0] as never, authority),
      /owned-acquisition-workflow-producer-required/u,
    );
  }
  await appendTestAcquisitionWorkflowEvidence(memory, fixture.ledgerEntries, fixture.entries);
  assert.equal(
    await memory.isWorkflowProducedJournalEntry(
      (fixture.entries.at(-1) as NonNullable<(typeof fixture.entries)[number]>).journalEntryHash,
    ),
    true,
  );

  const directory = await mkdtemp(join(tmpdir(), "peas-credential-forged-chain-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filename = join(directory, "forged.sqlite");
  const migrations = loadMigrations(join(process.cwd(), "migrations"));
  let database = openSqliteDatabase(filename, migrations);
  assert.throws(
    () =>
      database
        .prepare(`INSERT INTO market_acquisition_workflow_journal_proofs
          (market_acquisition_journal_id, journal_entry_hash) VALUES (?, ?)`)
        .run(fixture.request.marketAcquisitionJournalId, "f".repeat(64)),
    /no such function|workflow proof write denied/u,
  );
  let journal = createSqliteAcquisitionJournal(database, fixture.request.journalIdentity);
  assert.throws(
    () =>
      database.function(
        "peas_acquisition_workflow_proof_authorized",
        { deterministic: false },
        () => 1,
      ),
    /reserved-sqlite-function-registration-denied/u,
  );
  const forgedJournalEntry = fixture.entries[0] as NonNullable<(typeof fixture.entries)[number]>;
  assert.throws(
    () =>
      database
        .prepare(`INSERT INTO market_acquisition_journal_entries (
          market_acquisition_journal_id, journal_sequence, prior_journal_entry_hash,
          journal_entry_hash, checkpoint_kind, entry_json
        ) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(
          fixture.request.marketAcquisitionJournalId,
          0n,
          forgedJournalEntry.priorJournalEntryHash,
          forgedJournalEntry.journalEntryHash,
          forgedJournalEntry.checkpointKind,
          JSON.stringify(forgedJournalEntry),
        ),
    /workflow journal write denied/u,
  );
  await assert.rejects(
    () => journal.appendLedgerEntries(fixture.ledgerEntries),
    /owned-acquisition-workflow-producer-required/u,
  );
  for (const entry of fixture.entries) {
    await assert.rejects(
      () => journal.append(entry),
      /owned-acquisition-workflow-producer-required/u,
    );
  }
  assert.throws(
    () =>
      database
        .prepare(`INSERT INTO market_acquisition_workflow_journal_proofs
          (market_acquisition_journal_id, journal_entry_hash) VALUES (?, ?)`)
        .run(
          fixture.request.marketAcquisitionJournalId,
          (fixture.entries.at(-1) as NonNullable<(typeof fixture.entries)[number]>)
            .journalEntryHash,
        ),
    /workflow proof write denied/u,
  );
  assert.throws(
    () =>
      database
        .prepare(`INSERT INTO market_acquisition_workflow_ledger_proofs
          (market_acquisition_journal_id, entry_id) VALUES (?, ?)`)
        .run(fixture.request.marketAcquisitionJournalId, fixture.ledgerEntries.at(-1)?.entryId),
    /workflow proof write denied/u,
  );
  database.close();
  const sqliteAuthorization = openTestSqliteDurableCredentialAuthorizationBoundary(
    filename,
    migrations,
    fixture.request.plan,
  );
  await sqliteAuthorization.establish(fixture.request);
  sqliteAuthorization.close();
  database = openSqliteDatabase(filename, migrations);
  journal = createSqliteAcquisitionJournal(database, fixture.request.journalIdentity);
  assert.deepEqual(await journal.load(fixture.request.marketAcquisitionJournalId), []);
  assert.deepEqual(await journal.loadLedgerEntries(), []);
  const ownedRows = database
    .prepare(`SELECT COUNT(*) AS count FROM market_acquisition_owned_request_started`)
    .get() as { count: bigint };
  assert.equal(ownedRows.count, 1n);
  assert.throws(
    () =>
      database
        .prepare(`INSERT INTO market_acquisition_workflow_ledger_proofs
          (market_acquisition_journal_id, entry_id) VALUES (?, ?)`)
        .run(fixture.request.marketAcquisitionJournalId, `ole1_${"f".repeat(64)}`),
    /workflow proof write denied/u,
  );
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
  assert.equal("createDurableCredentialAuthorizationBoundary" in credentials, false);
  const journal = await import("../src/adapters/market-acquisition/journal.js");
  assert.equal("createDurableAcquisitionWorkflowProducer" in journal, false);
  const wire = await import("../src/adapters/market-acquisition/alpaca/wire.js");
  assert.equal("createDurableAlpacaWireAdmissionBoundary" in wire, false);
  const semantics = await import(
    "../src/adapters/market-acquisition/alpaca/wire-semantic-evidence.js"
  );
  assert.equal("createDurableAlpacaWireSemanticEvidenceBoundary" in semantics, false);
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
