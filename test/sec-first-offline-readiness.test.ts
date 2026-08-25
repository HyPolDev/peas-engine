import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  createSecSourceClient,
  SEC_READ_EFFECTS_ZERO,
  SecSourceBoundaryError,
} from "../src/adapters/read-only-capture/sec-source-client.js";
import {
  decideSecWindow,
  planSecBundleMembers,
  selectSec8kCandidate,
  type SecForwardConfig,
} from "../src/adapters/read-only-capture/sec-forward-plan.js";
import { retainSecSourceResult } from "../src/adapters/read-only-capture/sec-artifact-bridge.js";
import type { ArtifactStore, StoreArtifactResult } from "../src/artifacts/artifact-store.js";

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
  const index = Buffer.from(
    JSON.stringify({
      directory: {
        item: [
          { name: "cost-20260924.htm", type: "8-K" },
          { name: "exhibit991.htm", type: "EX-99.1" },
          { name: "cost-20260830.xml", type: "EX-101.INS" },
        ],
      },
    }),
  );
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
