import { canonicalHash } from "../../core/hash.js";
import type { ReadOnlySourceClient, ReadOnlySourceResult } from "./source-client.js";

export const ISSUER_READ_EFFECTS_ZERO = Object.freeze({
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

export type IssuerSourceClientConfig = Readonly<{
  enabled: boolean;
  officialOrigin: string;
  allowedPathPrefixes: readonly string[];
  userAgent: string;
  timeoutMs: number;
  maxResponseBytes: number;
}>;

export type IssuerSourceClientDependencies = Readonly<{
  fetch: typeof globalThis.fetch;
  nowMs: () => number;
}>;

export class IssuerSourceBoundaryError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "IssuerSourceBoundaryError";
  }
}

function fail(code: string): never {
  throw new IssuerSourceBoundaryError(code);
}

function validateConfig(config: IssuerSourceClientConfig): Readonly<{
  origin: string;
  pathPrefixes: readonly string[];
}> {
  let origin: URL;
  try {
    origin = new URL(config.officialOrigin);
  } catch {
    return fail("issuer-source.origin-invalid");
  }
  if (
    origin.protocol !== "https:" ||
    origin.username !== "" ||
    origin.password !== "" ||
    origin.pathname !== "/" ||
    origin.search !== "" ||
    origin.hash !== ""
  ) {
    fail("issuer-source.origin-invalid");
  }
  if (
    !Array.isArray(config.allowedPathPrefixes) ||
    config.allowedPathPrefixes.length < 1 ||
    config.allowedPathPrefixes.length > 8 ||
    new Set(config.allowedPathPrefixes).size !== config.allowedPathPrefixes.length ||
    config.allowedPathPrefixes.some(
      (prefix) =>
        typeof prefix !== "string" ||
        !/^\/[A-Za-z0-9][A-Za-z0-9._~!$&'()*+,;=:@/-]{0,511}$/u.test(prefix) ||
        prefix.includes("//") ||
        prefix.includes("..") ||
        prefix.includes("%"),
    )
  ) {
    fail("issuer-source.path-prefix-invalid");
  }
  if (
    typeof config.userAgent !== "string" ||
    config.userAgent.length < 8 ||
    Buffer.byteLength(config.userAgent, "utf8") > 256 ||
    /[\r\n]/u.test(config.userAgent)
  ) {
    fail("issuer-source.user-agent-invalid");
  }
  if (
    !Number.isSafeInteger(config.timeoutMs) ||
    config.timeoutMs < 100 ||
    config.timeoutMs > 30_000
  ) {
    fail("issuer-source.timeout-invalid");
  }
  if (
    !Number.isSafeInteger(config.maxResponseBytes) ||
    config.maxResponseBytes < 1 ||
    config.maxResponseBytes > 10 * 1024 * 1024
  ) {
    fail("issuer-source.response-limit-invalid");
  }
  return Object.freeze({
    origin: origin.origin,
    pathPrefixes: Object.freeze([...config.allowedPathPrefixes].sort()),
  });
}

function validateUrl(
  rawUrl: string,
  boundary: Readonly<{ origin: string; pathPrefixes: readonly string[] }>,
): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return fail("issuer-source.url-invalid");
  }
  if (url.origin !== boundary.origin) fail("issuer-source.destination-denied");
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    fail("issuer-source.url-component-denied");
  }
  if (
    url.pathname.includes("%") ||
    url.pathname.includes("//") ||
    url.pathname.includes("..") ||
    !boundary.pathPrefixes.some(
      (prefix) => url.pathname === prefix || url.pathname.startsWith(`${prefix}/`),
    )
  ) {
    fail("issuer-source.path-denied");
  }
  return url;
}

function requestIdentity(url: URL) {
  const pathHash = canonicalHash("peas/issuer-source/path/v1", { path: url.pathname });
  return Object.freeze({
    method: "GET",
    origin: url.origin,
    pathHash,
    routeLabel: "issuer.official-read",
    identityHash: canonicalHash("peas/issuer-source/request/v1", {
      method: "GET",
      origin: url.origin,
      pathHash,
    }),
  });
}

async function readBounded(response: Response, maximum: number): Promise<Uint8Array> {
  const reader = response.body?.getReader();
  if (reader === undefined) return fail("issuer-source.body-missing");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const result = await reader.read();
      if (result.done) break;
      total += result.value.byteLength;
      if (total > maximum) fail("issuer-source.response-too-large");
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

export function createIssuerSourceClient(
  config: IssuerSourceClientConfig,
  dependencies: IssuerSourceClientDependencies = { fetch: globalThis.fetch, nowMs: Date.now },
): ReadOnlySourceClient {
  const boundary = validateConfig(config);
  return Object.freeze({
    kind: "issuer-official-read-only-source-client-v1",
    async read(rawUrl: string): Promise<ReadOnlySourceResult> {
      if (!config.enabled) fail("issuer-source.disabled");
      const url = validateUrl(rawUrl, boundary);
      const request = requestIdentity(url);
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
      let response: Response | undefined;
      try {
        response = await dependencies.fetch(url, {
          method: "GET",
          headers: Object.freeze({
            Accept: "text/html,application/json,application/pdf;q=0.9",
            "User-Agent": config.userAgent,
          }),
          redirect: "manual",
          credentials: "omit",
          referrerPolicy: "no-referrer",
          signal: controller.signal,
        });
        if (response.status >= 300 && response.status < 400) {
          fail("issuer-source.redirect-denied");
        }
        if (response.status !== 200 && response.status !== 404) {
          fail("issuer-source.status-denied");
        }
        const declared = response.headers.get("content-length");
        const declaredContentLength = declared === null ? null : Number.parseInt(declared, 10);
        if (
          declaredContentLength !== null &&
          (!Number.isSafeInteger(declaredContentLength) || declaredContentLength < 0)
        ) {
          fail("issuer-source.content-length-invalid");
        }
        if (declaredContentLength !== null && declaredContentLength > config.maxResponseBytes) {
          fail("issuer-source.response-too-large");
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
        if (controller.signal.aborted) fail("issuer-source.timeout");
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    },
  });
}
