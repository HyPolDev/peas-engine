import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { DurableArtifactStore } from "../src/adapters/artifacts/durable-artifact-store.js";
import { artifactRuntimePaths } from "../src/adapters/artifacts/runtime-root.js";
import { SqliteArtifactRepository } from "../src/adapters/artifacts/sqlite-artifact-repository.js";
import {
  createSecSourceClient,
  SEC_READ_EFFECTS_ZERO,
  SecSourceBoundaryError,
} from "../src/adapters/read-only-capture/sec-source-client.js";
import {
  decideSecWindow,
  planSecBundleMembers,
  SecForwardPlanError,
  selectSec8kCandidate,
  type SecForwardConfig,
} from "../src/adapters/read-only-capture/sec-forward-plan.js";
import { retainSecSourceResult } from "../src/adapters/read-only-capture/sec-artifact-bridge.js";
import { retainSecForwardOfflineBundle } from "../src/adapters/read-only-capture/sec-forward-offline-pipeline.js";
import { runRecordedSecPipeline } from "../src/adapters/sec/recorded-sec-pipeline.js";
import { loadMigrations, openSqliteDatabase } from "../src/adapters/sqlite/database.js";
import { SqliteEventLog } from "../src/adapters/sqlite/event-log.js";
import type { ArtifactStore, StoreArtifactResult } from "../src/artifacts/artifact-store.js";
import { ManualClock } from "../src/core/clock.js";

const CONFIG: SecForwardConfig = Object.freeze({
  enabled: false,
  issuerCik: "0000909832",
  expectedFiscalPeriod: "2026-FY",
  windowStartMs: Date.parse("2026-09-24T20:00:00Z"),
  windowEndMs: Date.parse("2026-09-25T04:00:00Z"),
  pollIntervalMs: 60_000,
});

function boundaryCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof SecSourceBoundaryError && error.code === code;
}

test("committed Costco observation configuration is disabled and exact", async () => {
  const raw = await readFile("config/sec-first/costco-2026-09-24.disabled.json", "utf8");
  const config = JSON.parse(raw) as Record<string, unknown>;
  assert.equal(config["enabled"], false);
  assert.equal(config["issuerCik"], CONFIG.issuerCik);
  assert.equal(config["expectedFiscalPeriod"], CONFIG.expectedFiscalPeriod);
  assert.equal(config["windowStartMs"], CONFIG.windowStartMs);
  assert.equal(config["windowEndMs"], CONFIG.windowEndMs);
  assert.deepEqual(config["origins"], ["https://data.sec.gov", "https://www.sec.gov"]);
  assert.deepEqual(SEC_READ_EFFECTS_ZERO, {
    credential: 0,
    account: 0,
    subscription: 0,
    spending: 0,
    broker: 0,
    order: 0,
    portfolio: 0,
    position: 0,
    fill: 0,
    financialEffect: 0,
  });
});

test("disabled production boundary fails before fetch", async () => {
  let calls = 0;
  const client = createSecSourceClient(
    {
      enabled: false,
      issuerCik: CONFIG.issuerCik,
      userAgent: "PEAS offline test test@example.invalid",
      timeoutMs: 1_000,
      maxResponseBytes: 1_024,
    },
    {
      fetch: async () => {
        calls += 1;
        return new Response("unexpected");
      },
      nowMs: () => CONFIG.windowStartMs,
    },
  );
  await assert.rejects(
    client.read("https://data.sec.gov/submissions/CIK0000909832.json"),
    boundaryCode("sec-source.disabled"),
  );
  assert.equal(calls, 0);
});

test("enabled test seam permits only exact SEC CIK/path families and credential-free GET", async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const client = createSecSourceClient(
    {
      enabled: true,
      issuerCik: CONFIG.issuerCik,
      userAgent: "PEAS offline test test@example.invalid",
      timeoutMs: 1_000,
      maxResponseBytes: 1_024,
    },
    {
      fetch: async (input, init) => {
        calls.push({ input: String(input), ...(init === undefined ? {} : { init }) });
        return new Response('{"ok":true}', {
          status: 200,
          headers: { "content-type": "application/json", "content-length": "11" },
        });
      },
      nowMs: () => CONFIG.windowStartMs,
    },
  );
  const result = await client.read("https://data.sec.gov/submissions/CIK0000909832.json");
  assert.equal(result.status, "found");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.init?.credentials, "omit");
  assert.equal(calls[0]?.init?.redirect, "manual");
  assert.equal(calls[0]?.init?.method, "GET");
  const headers = new Headers(calls[0]?.init?.headers);
  assert.equal(headers.has("authorization"), false);
  assert.equal(headers.has("cookie"), false);

  for (const denied of [
    "https://example.com/submissions/CIK0000909832.json",
    "https://data.sec.gov/submissions/CIK0000000001.json",
    "https://www.sec.gov/Archives/edgar/data/909832/../../secret",
    "https://www.sec.gov/Archives/edgar/data/909832/000090983226000001/index.json?x=1",
  ]) {
    await assert.rejects(client.read(denied), SecSourceBoundaryError);
  }
  assert.equal(calls.length, 1);
});

test("redirects, oversized declarations, oversized streams, and unexpected statuses fail closed", async () => {
  const responses = [
    new Response(null, { status: 302, headers: { location: "https://example.com" } }),
    new Response(null, { status: 200, headers: { "content-length": "11" } }),
    new Response("12345678901", { status: 200 }),
    new Response(null, { status: 500 }),
  ];
  const client = createSecSourceClient(
    {
      enabled: true,
      issuerCik: CONFIG.issuerCik,
      userAgent: "PEAS offline test test@example.invalid",
      timeoutMs: 1_000,
      maxResponseBytes: 10,
    },
    { fetch: async () => responses.shift() as Response, nowMs: () => CONFIG.windowStartMs },
  );
  const url = "https://data.sec.gov/submissions/CIK0000909832.json";
  await assert.rejects(client.read(url), boundaryCode("sec-source.redirect-denied"));
  await assert.rejects(client.read(url), boundaryCode("sec-source.response-too-large"));
  await assert.rejects(client.read(url), boundaryCode("sec-source.response-too-large"));
  await assert.rejects(client.read(url), boundaryCode("sec-source.status-denied"));
});

test("one deadline owns response-body lifetime and cleanup", async () => {
  let aborted = false;
  const client = createSecSourceClient(
    {
      enabled: true,
      issuerCik: CONFIG.issuerCik,
      userAgent: "PEAS offline test test@example.invalid",
      timeoutMs: 100,
      maxResponseBytes: 1_024,
    },
    {
      fetch: async (_input, init) => {
        const signal = init?.signal;
        return new Response(
          new ReadableStream({
            start(controller) {
              signal?.addEventListener(
                "abort",
                () => {
                  aborted = true;
                  controller.error(new Error("aborted"));
                },
                { once: true },
              );
            },
          }),
          { status: 200 },
        );
      },
      nowMs: () => CONFIG.windowStartMs,
    },
  );
  await assert.rejects(
    client.read("https://data.sec.gov/submissions/CIK0000909832.json"),
    boundaryCode("sec-source.timeout"),
  );
  assert.equal(aborted, true);
});

test("404 is a stable missing result and window decisions are deterministic", async () => {
  const client = createSecSourceClient(
    {
      enabled: true,
      issuerCik: CONFIG.issuerCik,
      userAgent: "PEAS offline test test@example.invalid",
      timeoutMs: 1_000,
      maxResponseBytes: 1_024,
    },
    { fetch: async () => new Response(null, { status: 404 }), nowMs: () => CONFIG.windowStartMs },
  );
  const missing = await client.read(
    "https://www.sec.gov/Archives/edgar/data/909832/000090983226000001/index.json",
  );
  assert.equal(missing.status, "missing");
  assert.deepEqual(decideSecWindow(CONFIG, CONFIG.windowStartMs - 1), {
    status: "before-window",
    nextAtMs: CONFIG.windowStartMs,
  });
  assert.deepEqual(decideSecWindow(CONFIG, CONFIG.windowStartMs), {
    status: "poll",
    nextAtMs: CONFIG.windowStartMs + 60_000,
  });
  assert.deepEqual(decideSecWindow(CONFIG, CONFIG.windowEndMs + 1), {
    status: "expired",
    reasonCode: "sec-forward.window-expired",
  });
});

test("found bytes cross the existing artifact-store boundary before normalization", async () => {
  const expected = Object.freeze({
    artifact: {
      digest: "a".repeat(64),
      algorithm: "sha256" as const,
      sizeBytes: 3,
      committedAtMs: CONFIG.windowStartMs,
      provenance: "retrieval" as const,
    },
    observation: {} as StoreArtifactResult["observation"],
    disposition: "created" as const,
  });
  let retained = Buffer.alloc(0);
  const artifactStore = {
    async store(request) {
      const chunks: Buffer[] = [];
      for await (const chunk of request.entityBytes) chunks.push(Buffer.from(chunk));
      retained = Buffer.concat(chunks);
      assert.equal(request.attempt.provider, "sec-edgar");
      assert.equal(request.response.statusCode, 200);
      return expected;
    },
  } as Pick<ArtifactStore, "store"> as ArtifactStore;
  const result = await retainSecSourceResult({
    artifactStore,
    result: {
      status: "found",
      bytes: Uint8Array.from([1, 2, 3]),
      retrievedAtMs: CONFIG.windowStartMs,
      request: {
        method: "GET",
        origin: "https://data.sec.gov",
        pathHash: "b".repeat(64),
        routeLabel: "sec.submissions",
        identityHash: "c".repeat(64),
      },
      response: {
        statusCode: 200,
        etag: null,
        lastModified: null,
        mediaType: "application/json",
        contentEncoding: null,
        declaredContentLength: 3,
        transportDecoded: true,
      },
    },
    attemptId: "costco-submissions-1",
    recordId: "sec:costco:submissions",
    revisionId: "1",
    startedAtMs: CONFIG.windowStartMs - 1,
  });
  assert.equal(result, expected);
  assert.deepEqual(retained, Buffer.from([1, 2, 3]));
});

test("synthetic SEC submissions and filing index produce the existing normalizer role set", () => {
  const submissions = Buffer.from(
    JSON.stringify({
      cik: 909832,
      filings: {
        recent: {
          accessionNumber: ["0000909832-26-000101"],
          form: ["8-K"],
          items: ["2.02,9.01"],
          acceptanceDateTime: ["2026-09-24T20:15:00"],
          primaryDocument: ["cost-20260924.htm"],
        },
      },
    }),
  );
  const candidate = selectSec8kCandidate(submissions, CONFIG);
  assert.deepEqual(candidate, {
    accession: "0000909832-26-000101",
    acceptedAtMs: Date.parse("2026-09-24T20:15:00Z"),
    primaryDocument: "cost-20260924.htm",
  });
  assert.ok(candidate);
  const index = Buffer.from(`<!doctype html><table>
    <tr><th>Seq</th><th>Description</th><th>Document</th><th>Type</th><th>Size</th></tr>
    <tr><td>1</td><td>8-K</td><td><a href="cost-20260924.htm">cost-20260924.htm</a></td><td>8-K</td><td>1</td></tr>
    <tr><td>2</td><td>release</td><td><a href="exhibit991.htm">exhibit991.htm</a></td><td>EX-99.1</td><td>1</td></tr>
    <tr><td>3</td><td>instance</td><td><a href="cost-20260830.xml">cost-20260830.xml</a></td><td>EX-101.INS</td><td>1</td></tr>
  </table>`);
  const members = planSecBundleMembers(index, CONFIG, candidate);
  assert.deepEqual(
    members.map((member) => member.role),
    [
      "sec.submissions",
      "sec.filing-index",
      "sec.primary-document",
      "sec.exhibit-99.1",
      "sec.xbrl-instance",
    ],
  );
  assert.equal(new Set(members.map((member) => member.memberKey)).size, members.length);
  assert.ok(members.every((member) => member.url.startsWith("https://")));
  assert.equal(
    members.find((member) => member.role === "sec.filing-index")?.url,
    "https://www.sec.gov/Archives/edgar/data/909832/000090983226000101/0000909832-26-000101-index.htm",
  );
});

test("SEC EX-99 earnings releases map to the canonical exhibit evidence role", () => {
  const candidate = {
    accession: "0000764478-26-000099",
    acceptedAtMs: Date.parse("2026-09-24T20:15:00Z"),
    primaryDocument: "bby-20260924.htm",
  };
  const config = { ...CONFIG, issuerCik: "0000764478" };
  const index = Buffer.from(`<!doctype html><table>
    <tr><th>Seq</th><th>Description</th><th>Document</th><th>Type</th><th>Size</th></tr>
    <tr><td>1</td><td>8-K</td><td><a href="bby-20260924.htm">bby-20260924.htm</a></td><td>8-K</td><td>1</td></tr>
    <tr><td>2</td><td>release</td><td><a href="bby-release.htm">bby-release.htm</a></td><td>EX-99</td><td>1</td></tr>
    <tr><td>3</td><td>instance</td><td><a href="bby-20260924.xml">bby-20260924.xml</a></td><td>EX-101.INS</td><td>1</td></tr>
  </table>`);

  const members = planSecBundleMembers(index, config, candidate);
  const exhibit = members.find((member) => member.role === "sec.exhibit-99.1");
  assert.equal(exhibit?.memberKey, "bby-release.htm");
});

test("no qualifying post-activation filing returns stable absence", () => {
  const submissions = Buffer.from(
    JSON.stringify({
      cik: "0000909832",
      filings: {
        recent: {
          accessionNumber: ["0000909832-26-000100"],
          form: ["8-K"],
          items: ["5.02"],
          acceptanceDateTime: ["2026-09-24T20:10:00"],
          primaryDocument: ["cost-20260924.htm"],
        },
      },
    }),
  );
  assert.equal(selectSec8kCandidate(submissions, CONFIG), undefined);
  assert.equal(selectSec8kCandidate(submissions, CONFIG), undefined);
});

test("historical third-party accession prefixes do not block an in-window issuer filing", () => {
  const submissions = Buffer.from(
    JSON.stringify({
      cik: CONFIG.issuerCik,
      filings: {
        recent: {
          accessionNumber: ["0001104659-25-045244", "0000909832-26-000101"],
          form: ["8-K", "8-K"],
          items: ["2.02,9.01", "2.02,9.01"],
          acceptanceDateTime: ["2025-05-07T10:03:11.000Z", "2026-09-24T20:15:00.000Z"],
          primaryDocument: ["tm2514190d1_8k.htm", "cost-20260924.htm"],
        },
      },
    }),
  );

  assert.deepEqual(selectSec8kCandidate(submissions, CONFIG), {
    accession: "0000909832-26-000101",
    acceptedAtMs: Date.parse("2026-09-24T20:15:00.000Z"),
    primaryDocument: "cost-20260924.htm",
  });
});

test("an in-window third-party accession prefix remains invalid", () => {
  const submissions = Buffer.from(
    JSON.stringify({
      cik: CONFIG.issuerCik,
      filings: {
        recent: {
          accessionNumber: ["0001104659-26-045244"],
          form: ["8-K"],
          items: ["2.02,9.01"],
          acceptanceDateTime: ["2026-09-24T20:15:00.000Z"],
          primaryDocument: ["tm2614190d1_8k.htm"],
        },
      },
    }),
  );

  assert.throws(
    () => selectSec8kCandidate(submissions, CONFIG),
    (error: unknown) =>
      error instanceof SecForwardPlanError && error.code === "sec-forward.filing-invalid",
  );
});

test("live-shaped synthetic SEC bytes survive vault restart and normalize once into SQLite", async (context) => {
  const root = mkdtempSync(path.join(tmpdir(), "peas-sec-first-"));
  context.after(async () =>
    rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }),
  );
  const retrievedAtMs = Date.parse("2026-09-24T20:16:00Z");
  const submissions = Buffer.from(
    JSON.stringify({
      cik: 909832,
      name: "Costco Wholesale Corporation",
      filings: {
        recent: {
          accessionNumber: ["0000909832-26-000101"],
          form: ["8-K"],
          items: ["2.02,9.01"],
          acceptanceDateTime: ["2026-09-24T20:15:00Z"],
          primaryDocument: ["cost-20260924.htm"],
        },
      },
    }),
  );
  const filingIndex = Buffer.from(`<!doctype html><html><body><table>
    <tr><th>Seq</th><th>Description</th><th>Document</th><th>Type</th><th>Size</th></tr>
    <tr><td>1</td><td>8-K</td><td><a href="cost-20260924.htm">cost-20260924.htm</a></td><td>8-K</td><td>1</td></tr>
    <tr><td>2</td><td>EX-99.1</td><td><a href="exhibit991.htm">exhibit991.htm</a></td><td>EX-99.1</td><td>1</td></tr>
    <tr><td>3</td><td>instance</td><td><a href="cost-20260830_htm.xml">cost-20260830_htm.xml</a></td><td>XML</td><td>1</td></tr>
  </table></body></html>`);
  const candidate = selectSec8kCandidate(submissions, CONFIG);
  assert.ok(candidate);
  const members = planSecBundleMembers(filingIndex, CONFIG, candidate);
  const bodies = new Map<string, Uint8Array>();
  for (const member of members) {
    if (member.role === "sec.submissions") bodies.set(member.url, submissions);
    if (member.role === "sec.filing-index") bodies.set(member.url, filingIndex);
    if (member.role === "sec.primary-document") {
      bodies.set(
        member.url,
        Buffer.from(
          '<html><body><ix:nonNumeric name="dei:DocumentType">8-K</ix:nonNumeric><ix:nonNumeric name="dei:EntityCentralIndexKey">0000909832</ix:nonNumeric><ACCEPTANCE-DATETIME>20260924161500</ACCEPTANCE-DATETIME></body></html>',
        ),
      );
    }
    if (member.role === "sec.exhibit-99.1") {
      bodies.set(
        member.url,
        Buffer.from("<!doctype html><p>synthetic Costco earnings release</p>"),
      );
    }
    if (member.role === "sec.xbrl-instance") {
      bodies.set(
        member.url,
        Buffer.from(
          '<?xml version="1.0" encoding="UTF-8"?><xbrl><dei:EntityCentralIndexKey>0000909832</dei:EntityCentralIndexKey><dei:DocumentFiscalYearFocus>2026</dei:DocumentFiscalYearFocus><dei:DocumentFiscalPeriodFocus>FY</dei:DocumentFiscalPeriodFocus></xbrl>',
        ),
      );
    }
  }
  const client = createSecSourceClient(
    {
      enabled: true,
      issuerCik: CONFIG.issuerCik,
      userAgent: "PEAS offline test test@example.invalid",
      timeoutMs: 1_000,
      maxResponseBytes: 1024 * 1024,
    },
    {
      fetch: async (input) => {
        const body = bodies.get(String(input));
        return body === undefined
          ? new Response(null, { status: 404 })
          : new Response(Buffer.from(body), {
              status: 200,
              headers: {
                "content-type": String(input).endsWith(".xml")
                  ? "application/xml"
                  : String(input).includes("submissions")
                    ? "application/json"
                    : "text/html",
                "content-length": String(body.byteLength),
              },
            });
      },
      nowMs: () => retrievedAtMs,
    },
  );
  const results = new Map<string, Awaited<ReturnType<typeof client.read>>>();
  for (const member of members) results.set(member.url, await client.read(member.url));

  const paths = artifactRuntimePaths(root);
  mkdirSync(paths.databaseDirectory, { recursive: true });
  const migrations = loadMigrations(path.join(process.cwd(), "migrations"));
  const open = async () => {
    const database = openSqliteDatabase(paths.databasePath, migrations);
    const clock = new ManualClock(retrievedAtMs);
    const store = await DurableArtifactStore.open({
      repository: new SqliteArtifactRepository(database),
      clock,
      config: {
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
      },
    });
    return { database, store, eventLog: new SqliteEventLog(database, { clock }) };
  };

  let vault = await open();
  const retained = await retainSecForwardOfflineBundle({
    config: CONFIG,
    candidate,
    members,
    results,
    artifactStore: vault.store,
  });
  assert.equal(retained.status, "complete");
  if (retained.status !== "complete") assert.fail("expected complete SEC bundle");
  await vault.store.close();
  vault.database.close();

  vault = await open();
  const first = await runRecordedSecPipeline({
    artifactStore: vault.store,
    eventLog: vault.eventLog,
    manifest: retained.manifest,
  });
  assert.equal(first.status, "emitted");
  assert.equal((await vault.eventLog.readAfter("0", 10)).events.length, 1);
  await vault.store.close();
  vault.database.close();

  vault = await open();
  const restarted = await runRecordedSecPipeline({
    artifactStore: vault.store,
    eventLog: vault.eventLog,
    manifest: retained.manifest,
  });
  assert.equal(restarted.status, "emitted");
  assert.equal((await vault.eventLog.readAfter("0", 10)).events.length, 1);
  assert.equal(vault.database.pragma("integrity_check", { simple: true }), "ok");
  await vault.store.close();
  vault.database.close();
});
