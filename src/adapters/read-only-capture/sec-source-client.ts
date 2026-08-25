import { canonicalHash } from "../../core/hash.js";
import type { ReadOnlySourceClient, ReadOnlySourceResult } from "./source-client.js";

export const SEC_OFFICIAL_ORIGINS = Object.freeze([
  "https://data.sec.gov",
  "https://www.sec.gov",
] as const);

export const SEC_READ_EFFECTS_ZERO = Object.freeze({
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
} as const);

export type SecSourceClientConfig = Readonly<{
  enabled: boolean;
  issuerCik: string;
  userAgent: string;
  timeoutMs: number;
  maxResponseBytes: number;
}>;

export type SecSourceClientDependencies = Readonly<{
  fetch: typeof globalThis.fetch;
  nowMs: () => number;
}>;

export class SecSourceBoundaryError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "SecSourceBoundaryError";
  }
}

function fail(code: string): never {
  throw new SecSourceBoundaryError(code);
}

function validateConfig(config: SecSourceClientConfig): void {
  if (!/^\d{10}$/u.test(config.issuerCik)) fail("sec-source.cik-invalid");
  if (
    typeof config.userAgent !== "string" ||
    config.userAgent.length < 8 ||
    Buffer.byteLength(config.userAgent, "utf8") > 256 ||
    /[\r\n]/u.test(config.userAgent)
  ) {
    fail("sec-source.user-agent-invalid");
  }
  if (
    !Number.isSafeInteger(config.timeoutMs) ||
    config.timeoutMs < 100 ||
    config.timeoutMs > 30_000
  ) {
    fail("sec-source.timeout-invalid");
  }
  if (
    !Number.isSafeInteger(config.maxResponseBytes) ||
    config.maxResponseBytes < 1 ||
    config.maxResponseBytes > 10 * 1024 * 1024
  ) {
    fail("sec-source.response-limit-invalid");
  }
}

function validateUrl(rawUrl: string, issuerCik: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return fail("sec-source.url-invalid");
  }
  if (!SEC_OFFICIAL_ORIGINS.includes(url.origin as (typeof SEC_OFFICIAL_ORIGINS)[number])) {
    fail("sec-source.destination-denied");
  }
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    fail("sec-source.url-component-denied");
  }
  if (url.pathname.includes("%") || url.pathname.includes("//")) fail("sec-source.path-invalid");

  const unpaddedCik = String(Number.parseInt(issuerCik, 10));
  const submissions = `/submissions/CIK${issuerCik}.json`;
  const archivePrefix = `/Archives/edgar/data/${unpaddedCik}/`;
  const archiveSuffix = url.pathname.slice(archivePrefix.length);
  const archiveAllowed =
    url.origin === "https://www.sec.gov" &&
    url.pathname.startsWith(archivePrefix) &&
    /^\d{18}\/[A-Za-z0-9][A-Za-z0-9._-]{0,254}$/u.test(archiveSuffix);
  if (
    !((url.origin === "https://data.sec.gov" && url.pathname === submissions) || archiveAllowed)
  ) {
    fail("sec-source.path-denied");
  }
  return url;
}

function requestIdentity(url: URL) {
  const pathHash = canonicalHash("peas/sec-source/path/v1", { path: url.pathname });
  return Object.freeze({
    method: "GET",
    origin: url.origin,
    pathHash,
    routeLabel: url.origin === "https://data.sec.gov" ? "sec.submissions" : "sec.archive",
    identityHash: canonicalHash("peas/sec-source/request/v1", {
      method: "GET",
      origin: url.origin,
      pathHash,
    }),
  });
}

async function readBounded(response: Response, maximum: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (reader === undefined) return fail("sec-source.body-missing");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > maximum) fail("sec-source.response-too-large");
      chunks.push(result.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

export function createSecSourceClient(
  config: SecSourceClientConfig,
  dependencies: SecSourceClientDependencies = { fetch: globalThis.fetch, nowMs: Date.now },
): ReadOnlySourceClient {
  validateConfig(config);
  return Object.freeze({
    kind: "sec-read-only-source-client-v1",
    async read(rawUrl: string): Promise<ReadOnlySourceResult> {
      if (!config.enabled) fail("sec-source.disabled");
      const url = validateUrl(rawUrl, config.issuerCik);
      const request = requestIdentity(url);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
      let response: Response | undefined;
      try {
        response = await dependencies.fetch(url, {
          method: "GET",
          headers: Object.freeze({
            Accept: "application/json,text/html,application/xml;q=0.9",
            "User-Agent": config.userAgent,
          }),
          redirect: "manual",
          credentials: "omit",
          referrerPolicy: "no-referrer",
          signal: controller.signal,
        });
        if (response.status >= 300 && response.status < 400) fail("sec-source.redirect-denied");
        if (response.status !== 200 && response.status !== 404) fail("sec-source.status-denied");
        const declared = response.headers.get("content-length");
        const declaredContentLength = declared === null ? null : Number.parseInt(declared, 10);
        if (
          declaredContentLength !== null &&
          (!Number.isSafeInteger(declaredContentLength) || declaredContentLength < 0)
        ) {
          fail("sec-source.content-length-invalid");
        }
        if (declaredContentLength !== null && declaredContentLength > config.maxResponseBytes) {
          fail("sec-source.response-too-large");
        }
        const metadata = Object.freeze({
          statusCode: response.status,
          etag: response.headers.get("etag"),
          lastModified: response.headers.get("last-modified"),
          mediaType: response.headers.get("content-type")?.split(";", 1)[0] ?? null,
          contentEncoding: response.headers.get("content-encoding"),
          declaredContentLength,
          transportDecoded: true as const,
        });
        const retrievedAtMs = dependencies.nowMs();
        if (response.status === 404) {
          await response.body?.cancel();
          return Object.freeze({ status: "missing", retrievedAtMs, request, response: metadata });
        }
        const bytes = await readBounded(response, config.maxResponseBytes);
        return Object.freeze({
          status: "found",
          bytes,
          retrievedAtMs,
          request,
          response: metadata,
        });
      } catch (error) {
        await response?.body?.cancel().catch(() => undefined);
        if (controller.signal.aborted) fail("sec-source.timeout");
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    },
  });
}
