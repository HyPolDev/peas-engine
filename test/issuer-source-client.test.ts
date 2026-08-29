import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  createIssuerSourceClient,
  ISSUER_READ_EFFECTS_ZERO,
  IssuerSourceBoundaryError,
} from "../src/adapters/read-only-capture/issuer-source-client.js";

const NOW = Date.parse("2026-09-02T20:00:00Z");

function boundaryCode(code: string): (error: unknown) => boolean {
  return (error) => error instanceof IssuerSourceBoundaryError && error.code === code;
}

test("disabled issuer boundary fails before transport and declares zero effects", async () => {
  let calls = 0;
  const client = createIssuerSourceClient(
    {
      enabled: false,
      officialOrigin: "https://investors.example.test",
      allowedPathPrefixes: ["/news"],
      userAgent: "PEAS provider-free test",
      timeoutMs: 1_000,
      maxResponseBytes: 1_024,
    },
    {
      fetch: async () => {
        calls += 1;
        return new Response("unexpected");
      },
      nowMs: () => NOW,
    },
  );
  await assert.rejects(
    client.read("https://investors.example.test/news/earnings"),
    boundaryCode("issuer-source.disabled"),
  );
  assert.equal(calls, 0);
  assert.deepEqual(ISSUER_READ_EFFECTS_ZERO, {
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

test("enabled issuer boundary permits one official host and declared path families only", async () => {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const client = createIssuerSourceClient(
    {
      enabled: true,
      officialOrigin: "https://investors.example.test",
      allowedPathPrefixes: ["/news", "/events"],
      userAgent: "PEAS provider-free test",
      timeoutMs: 1_000,
      maxResponseBytes: 1_024,
    },
    {
      fetch: async (input, init) => {
        calls.push({ input: String(input), ...(init === undefined ? {} : { init }) });
        return new Response("release", {
          status: 200,
          headers: { "content-type": "text/html", "content-length": "7" },
        });
      },
      nowMs: () => NOW,
    },
  );
  const result = await client.read("https://investors.example.test/news/earnings");
  assert.equal(result.status, "found");
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.init?.credentials, "omit");
  assert.equal(calls[0]?.init?.redirect, "manual");
  assert.equal(calls[0]?.init?.method, "GET");
  const headers = new Headers(calls[0]?.init?.headers);
  assert.equal(headers.has("authorization"), false);
  assert.equal(headers.has("cookie"), false);

  for (const denied of [
    "https://example.test/news/earnings",
    "https://investors.example.test/financials/earnings",
    "https://investors.example.test/news/earnings?token=forbidden",
    "https://investors.example.test/news/../secret",
  ]) {
    await assert.rejects(client.read(denied), IssuerSourceBoundaryError);
  }
  assert.equal(calls.length, 1);
});

test("all five frozen issuer mappings pass provider-free official-boundary mocks", async () => {
  const catalog = JSON.parse(
    readFileSync(
      path.join(
        process.cwd(),
        "config",
        "event-beta",
        "2026-09-02-to-2026-09-03.provider-capabilities.json",
      ),
      "utf8",
    ),
  ) as {
    candidates: Array<{
      ticker: string;
      issuerOrigin: string;
      issuerPathPrefixes: string[];
    }>;
  };
  assert.deepEqual(
    catalog.candidates.map(({ ticker }) => ticker),
    ["AVGO", "HPE", "CIEN", "DOCU", "LULU"],
  );
  for (const candidate of catalog.candidates) {
    let calls = 0;
    const client = createIssuerSourceClient(
      {
        enabled: true,
        officialOrigin: candidate.issuerOrigin,
        allowedPathPrefixes: candidate.issuerPathPrefixes,
        userAgent: "PEAS five-event provider-free mock",
        timeoutMs: 1_000,
        maxResponseBytes: 1_024,
      },
      {
        fetch: async () => {
          calls += 1;
          return new Response(`fixture:${candidate.ticker}`, { status: 200 });
        },
        nowMs: () => NOW,
      },
    );
    const result = await client.read(
      `${candidate.issuerOrigin}${candidate.issuerPathPrefixes[0]}/provider-free-fixture`,
    );
    assert.equal(result.status, "found");
    assert.equal(calls, 1);
  }
});

test("redirect, response limits, stable missing, and timeouts fail closed", async () => {
  const responses = [
    new Response(null, { status: 302, headers: { location: "https://example.test" } }),
    new Response(null, { status: 200, headers: { "content-length": "11" } }),
    new Response("12345678901", { status: 200 }),
    new Response(null, { status: 404 }),
  ];
  const client = createIssuerSourceClient(
    {
      enabled: true,
      officialOrigin: "https://investors.example.test",
      allowedPathPrefixes: ["/news"],
      userAgent: "PEAS provider-free test",
      timeoutMs: 1_000,
      maxResponseBytes: 10,
    },
    { fetch: async () => responses.shift() as Response, nowMs: () => NOW },
  );
  const url = "https://investors.example.test/news/earnings";
  await assert.rejects(client.read(url), boundaryCode("issuer-source.redirect-denied"));
  await assert.rejects(client.read(url), boundaryCode("issuer-source.response-too-large"));
  await assert.rejects(client.read(url), boundaryCode("issuer-source.response-too-large"));
  assert.equal((await client.read(url)).status, "missing");

  let aborted = false;
  const timeoutClient = createIssuerSourceClient(
    {
      enabled: true,
      officialOrigin: "https://investors.example.test",
      allowedPathPrefixes: ["/news"],
      userAgent: "PEAS provider-free test",
      timeoutMs: 100,
      maxResponseBytes: 1_024,
    },
    {
      fetch: async (_input, init) =>
        new Response(
          new ReadableStream({
            start(controller) {
              init?.signal?.addEventListener(
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
        ),
      nowMs: () => NOW,
    },
  );
  await assert.rejects(timeoutClient.read(url), boundaryCode("issuer-source.timeout"));
  assert.equal(aborted, true);
});
