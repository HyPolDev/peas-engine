import { createHash } from "node:crypto";

import { canonicalHash } from "../../core/hash.js";
import { inertJsonSnapshot, type JsonValue } from "../../core/json.js";
import {
  P1_03_EFFECTS_ZERO,
  P1_03_LIMITS,
  P1_03_SOURCE_IDS,
  P103CaptureContractError,
  type P103AllowlistEntry,
  type P103CaptureReceipt,
  type P103CaptureRequest,
  type P103CaptureSnapshot,
  type P103Fixture,
  type P103ReasonCode,
  type P103SessionInput,
  type P103SourceId,
  type ProviderFreeCaptureSession,
} from "./contracts.js";

const SESSION_KIND = "p1-03-provider-free-capture-session-v1" as const;
const SHA256 = /^[a-f0-9]{64}$/u;
const ALLOWLIST_FIELDS = Object.freeze(["issuerId", "resourceId", "sourceId"]);
const FIXTURE_FIELDS = Object.freeze([
  "bytes",
  "contentType",
  "issuerId",
  "publishedAtMs",
  "recordId",
  "resourceId",
  "retrievedAtMs",
  "revisionId",
  "sourceId",
]);
const INPUT_FIELDS = Object.freeze(["allowlist", "entitlementMode", "fixtures"]);
const REQUEST_FIELDS = Object.freeze([
  "issuerId",
  "recordId",
  "resourceId",
  "revisionId",
  "sourceId",
]);

type DetachedFixture = Omit<P103Fixture, "bytes"> & Readonly<{ bytes: readonly number[] }>;

function fail(reasonCode: P103ReasonCode): never {
  throw new P103CaptureContractError(reasonCode);
}

function snapshot<T>(value: T): T {
  try {
    return inertJsonSnapshot(value as unknown as JsonValue) as unknown as T;
  } catch {
    return fail("p1-03.input-invalid");
  }
}

function exactFields(value: object, fields: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const expected = [...fields].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail("p1-03.input-invalid");
  }
}

function requiredString(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    Buffer.byteLength(value, "utf8") > P1_03_LIMITS.maxStringBytes
  ) {
    fail("p1-03.string-limit");
  }
  return value;
}

function sourceId(value: unknown): P103SourceId {
  if (typeof value !== "string" || !P1_03_SOURCE_IDS.includes(value as P103SourceId)) {
    fail("p1-03.source-invalid");
  }
  return value as P103SourceId;
}

function timestamp(value: unknown, nullable: boolean): number | null {
  if (nullable && value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    fail("p1-03.timestamp-invalid");
  }
  return value;
}

function allowlistKey(value: P103AllowlistEntry): string {
  return canonicalHash("peas/p1-03/allowlist-key/v1", {
    sourceId: value.sourceId,
    issuerId: value.issuerId,
    resourceId: value.resourceId,
  });
}

function fixtureKey(value: P103CaptureRequest): string {
  return canonicalHash("peas/p1-03/fixture-key/v1", {
    sourceId: value.sourceId,
    issuerId: value.issuerId,
    resourceId: value.resourceId,
    recordId: value.recordId,
    revisionId: value.revisionId,
  });
}

function detachAllowlistEntry(value: P103AllowlistEntry): P103AllowlistEntry {
  exactFields(value, ALLOWLIST_FIELDS);
  return Object.freeze({
    sourceId: sourceId(value.sourceId),
    issuerId: requiredString(value.issuerId),
    resourceId: requiredString(value.resourceId),
  });
}

function detachFixture(value: P103Fixture): DetachedFixture {
  exactFields(value, FIXTURE_FIELDS);
  if (!Array.isArray(value.bytes)) fail("p1-03.input-invalid");
  if (value.bytes.length > P1_03_LIMITS.maxFixtureBytes) {
    fail("p1-03.fixture-byte-limit");
  }
  const bytes = value.bytes.map((byte) => {
    if (!Number.isInteger(byte) || byte < 0 || byte > 255) fail("p1-03.input-invalid");
    return byte;
  });
  return Object.freeze({
    sourceId: sourceId(value.sourceId),
    issuerId: requiredString(value.issuerId),
    resourceId: requiredString(value.resourceId),
    recordId: requiredString(value.recordId),
    revisionId: requiredString(value.revisionId),
    publishedAtMs: timestamp(value.publishedAtMs, true),
    retrievedAtMs: timestamp(value.retrievedAtMs, false) as number,
    contentType: requiredString(value.contentType),
    bytes: Object.freeze(bytes),
  });
}

function detachRequest(value: P103CaptureRequest): P103CaptureRequest {
  const detached = snapshot(value);
  exactFields(detached, REQUEST_FIELDS);
  return Object.freeze({
    sourceId: sourceId(detached.sourceId),
    issuerId: requiredString(detached.issuerId),
    resourceId: requiredString(detached.resourceId),
    recordId: requiredString(detached.recordId),
    revisionId: requiredString(detached.revisionId),
  });
}

function digest(bytes: readonly number[]): string {
  return createHash("sha256").update(Uint8Array.from(bytes)).digest("hex");
}

function freezeReceipt(receipt: P103CaptureReceipt): P103CaptureReceipt {
  return Object.freeze(receipt);
}

class ProviderFreeCaptureSessionV1 implements ProviderFreeCaptureSession {
  readonly kind = SESSION_KIND;
  readonly #allowlist: ReadonlySet<string>;
  readonly #fixtures: ReadonlyMap<string, DetachedFixture>;
  readonly #receipts = new Map<string, P103CaptureReceipt>();
  readonly #rawByDigest = new Map<string, Uint8Array>();
  #retainedBytes = 0;

  constructor(allowlist: ReadonlySet<string>, fixtures: ReadonlyMap<string, DetachedFixture>) {
    this.#allowlist = allowlist;
    this.#fixtures = fixtures;
    Object.freeze(this);
  }

  capture(requestValue: P103CaptureRequest): P103CaptureReceipt {
    const request = detachRequest(requestValue);
    if (!this.#allowlist.has(allowlistKey(request))) fail("p1-03.capture-not-allowlisted");
    const key = fixtureKey(request);
    const fixture = this.#fixtures.get(key);
    if (fixture === undefined) fail("p1-03.fixture-missing");

    const rawSha256 = digest(fixture.bytes);
    const captureId = canonicalHash("peas/p1-03/capture-id/v1", {
      sourceId: fixture.sourceId,
      issuerId: fixture.issuerId,
      resourceId: fixture.resourceId,
      recordId: fixture.recordId,
      revisionId: fixture.revisionId,
      publishedAtMs: fixture.publishedAtMs,
      retrievedAtMs: fixture.retrievedAtMs,
      contentType: fixture.contentType,
      rawSha256,
      rawSizeBytes: fixture.bytes.length,
    });
    const prior = this.#receipts.get(captureId);
    if (prior !== undefined) return freezeReceipt({ ...prior, duplicate: true });

    if (!this.#rawByDigest.has(rawSha256)) {
      if (this.#retainedBytes > P1_03_LIMITS.maxRetainedBytes - fixture.bytes.length) {
        fail("p1-03.retained-byte-limit");
      }
      this.#rawByDigest.set(rawSha256, Uint8Array.from(fixture.bytes));
      this.#retainedBytes += fixture.bytes.length;
    }
    const receipt = freezeReceipt({
      captureId,
      sourceId: fixture.sourceId,
      issuerId: fixture.issuerId,
      resourceId: fixture.resourceId,
      recordId: fixture.recordId,
      revisionId: fixture.revisionId,
      publishedAtMs: fixture.publishedAtMs,
      retrievedAtMs: fixture.retrievedAtMs,
      contentType: fixture.contentType,
      rawSha256,
      rawSizeBytes: fixture.bytes.length,
      duplicate: false,
      effects: P1_03_EFFECTS_ZERO,
    });
    this.#receipts.set(captureId, receipt);
    return receipt;
  }

  readRaw(value: string): Uint8Array | undefined {
    if (typeof value !== "string" || !SHA256.test(value)) fail("p1-03.digest-invalid");
    const bytes = this.#rawByDigest.get(value);
    return bytes === undefined ? undefined : Uint8Array.from(bytes);
  }

  snapshot(): P103CaptureSnapshot {
    const receipts = [...this.#receipts.values()].sort((left, right) =>
      left.captureId < right.captureId ? -1 : left.captureId > right.captureId ? 1 : 0,
    );
    return Object.freeze({
      entitlementMode: "provider-free-local-fixture",
      receipts: Object.freeze(receipts),
      totalUniqueCaptures: receipts.length,
      uniqueRetainedDigests: this.#rawByDigest.size,
      retainedBytes: this.#retainedBytes,
      effects: P1_03_EFFECTS_ZERO,
    });
  }
}

export function createProviderFreeCaptureSession(
  inputValue: P103SessionInput,
): ProviderFreeCaptureSession {
  const input = snapshot(inputValue);
  exactFields(input, INPUT_FIELDS);
  if (input.entitlementMode !== "provider-free-local-fixture") fail("p1-03.input-invalid");
  if (!Array.isArray(input.allowlist) || input.allowlist.length < 1) fail("p1-03.input-invalid");
  if (input.allowlist.length > P1_03_LIMITS.maxAllowlistEntries) {
    fail("p1-03.allowlist-limit");
  }
  if (!Array.isArray(input.fixtures) || input.fixtures.length < 1) fail("p1-03.input-invalid");
  if (input.fixtures.length > P1_03_LIMITS.maxFixtures) fail("p1-03.fixture-limit");

  const allowlist = new Set<string>();
  for (const rawEntry of input.allowlist) {
    const entry = detachAllowlistEntry(rawEntry);
    const key = allowlistKey(entry);
    if (allowlist.has(key)) fail("p1-03.duplicate-allowlist-entry");
    allowlist.add(key);
  }

  const fixtures = new Map<string, DetachedFixture>();
  const plannedDigests = new Set<string>();
  let retainedBytes = 0;
  for (const rawFixture of input.fixtures) {
    const fixture = detachFixture(rawFixture);
    if (!allowlist.has(allowlistKey(fixture))) fail("p1-03.fixture-not-allowlisted");
    const key = fixtureKey(fixture);
    if (fixtures.has(key)) fail("p1-03.duplicate-fixture-identity");
    const rawSha256 = digest(fixture.bytes);
    if (!plannedDigests.has(rawSha256)) {
      if (retainedBytes > P1_03_LIMITS.maxRetainedBytes - fixture.bytes.length) {
        fail("p1-03.retained-byte-limit");
      }
      retainedBytes += fixture.bytes.length;
      plannedDigests.add(rawSha256);
    }
    fixtures.set(key, fixture);
  }
  return new ProviderFreeCaptureSessionV1(allowlist, fixtures);
}
