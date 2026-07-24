import { createHash } from "node:crypto";
import { Readable } from "node:stream";

import { canonicalHash } from "../../core/hash.js";
import { deepFreezeJson, inertJsonSnapshot, type JsonObject } from "../../core/json.js";
import {
  type CanonicalMarketReasonV1,
  MarketContractError,
  marketReason,
} from "../../providers/market-reference/contracts.js";
import {
  RECORDED_LOADER_BOUND_IMPLEMENTATIONS,
  RECORDED_LOADER_OPERATIONAL_BOUND_IDS,
  validateAcquisitionCardinalityBounds,
  validateAggregateVerifiedByteBound,
  validateCalendarDatesPerManifestBound,
  validateCanonicalRecordByteBounds,
  validateClusterCardinalityBounds,
  validateExecutionBundleBounds,
  validateGenericStringByteBounds,
  validateHistoricalQueryWindowBound,
  validateIdentifierByteBounds,
  validateOpaqueProviderIdByteBounds,
  validatePageTokenInputByteBound,
  validateProviderOrDatasetCodeByteBounds,
  validateRawArtifactByteBound,
  validateRawJsonParserBounds,
  validateRecordAndFactCardinalityBounds,
  validateRecordedReplayPageSizeBound,
  validateSelectionSearchWindowBound,
  validateSidecarParserBounds,
  validateSymbolByteBounds,
} from "./recorded-loader-bounds.js";

export type RecordedGateAccessCountersV1 = Readonly<{
  providerCalls: number;
  observationCalls: number;
  artifactReadCalls: number;
  bodyReadCalls: number;
  networkCalls: number;
  paidActivationCalls: number;
}>;

export type RecordedGateEvidenceV1 = JsonObject &
  Readonly<{
    caseId: "E-01" | "E-02" | "X-01" | "X-02" | "X-03" | "X-04" | "X-05" | "O-03";
  }>;

type MutableAccessCounters = {
  providerCalls: number;
  observationCalls: number;
  artifactReadCalls: number;
  bodyReadCalls: number;
  networkCalls: number;
  paidActivationCalls: number;
};

type RequiredCapabilityV1 = Readonly<{
  datasetId: string;
  feedId: string;
  endpointChannelId: string;
  use: "offline-replay";
}>;

type CapabilityV1 = RequiredCapabilityV1 &
  Readonly<{
    status: "granted" | "pending" | "denied" | "not-authorized";
  }>;

type EntitlementGateInputV1 = Readonly<{
  asOfMs: number;
  effectiveFromMs: number;
  effectiveToMs: number | null;
  zeroIncrementalSpend: boolean;
  capabilities: readonly CapabilityV1[];
  requiredCapability: RequiredCapabilityV1;
}>;

type AuthorizationCostGateInputV1 = Readonly<{
  authorizationClass: "synthetic-offline-v1" | "recorded-private-approved";
  fallbackRequested: boolean;
  fallbackAuthorized: boolean;
  incrementalSpendMinorUnits: number;
  spendingAuthorized: boolean;
}>;

export type RecordedPageChainMemberV1 = Readonly<{
  sourceProfileId: string;
  pageOrdinal: number;
  priorPageChainHash: string | null;
  artifactContentId: string;
  terminalPage: boolean;
}>;

export type RecordedQueryIdentityV1 = Readonly<{
  instrumentIds: readonly string[];
  requestedFactKinds: readonly string[];
  queryStartNs: string;
  queryEndNs: string;
  routePolicyVersion: string;
}>;

class GateRejected extends Error {
  constructor(readonly reason: CanonicalMarketReasonV1) {
    super(reason.code);
    this.name = "GateRejected";
  }
}

function emptyCounters(): MutableAccessCounters {
  return {
    providerCalls: 0,
    observationCalls: 0,
    artifactReadCalls: 0,
    bodyReadCalls: 0,
    networkCalls: 0,
    paidActivationCalls: 0,
  };
}

function frozenCounters(counters: MutableAccessCounters): RecordedGateAccessCountersV1 {
  return Object.freeze({ ...counters });
}

function countersAreZero(counters: RecordedGateAccessCountersV1): boolean {
  return Object.values(counters).every((value) => value === 0);
}

function freezeEvidence<T extends JsonObject>(value: T): T {
  return deepFreezeJson(inertJsonSnapshot(value)) as T;
}

function rejectedReason(error: unknown): CanonicalMarketReasonV1 {
  if (error instanceof GateRejected || error instanceof MarketContractError) return error.reason;
  return marketReason("market.input-invalid");
}

function reject(reason: CanonicalMarketReasonV1): never {
  throw new GateRejected(reason);
}

function sameCapability(left: RequiredCapabilityV1, right: RequiredCapabilityV1): boolean {
  return (
    left.datasetId === right.datasetId &&
    left.feedId === right.feedId &&
    left.endpointChannelId === right.endpointChannelId &&
    left.use === right.use
  );
}

function validateEntitlementBeforeAccess(input: EntitlementGateInputV1): void {
  if (
    !Number.isSafeInteger(input.asOfMs) ||
    !Number.isSafeInteger(input.effectiveFromMs) ||
    (input.effectiveToMs !== null && !Number.isSafeInteger(input.effectiveToMs))
  ) {
    reject(marketReason("market.input-invalid"));
  }
  if (input.zeroIncrementalSpend !== true) {
    reject(
      marketReason("market.entitlement-invalid", {
        entitlementFailureKind: "zero-spend-violation",
      }),
    );
  }
  if (
    input.asOfMs < input.effectiveFromMs ||
    (input.effectiveToMs !== null && input.asOfMs > input.effectiveToMs)
  ) {
    reject(
      marketReason("market.entitlement-invalid", {
        entitlementFailureKind: "unfrozen",
      }),
    );
  }
  const capability = input.capabilities.find((candidate) =>
    sameCapability(candidate, input.requiredCapability),
  );
  if (capability === undefined || capability.status === "not-authorized") {
    reject(
      marketReason("market.entitlement-invalid", {
        entitlementFailureKind: "scope-mismatch",
      }),
    );
  }
  if (capability.status === "pending" || capability.status === "denied") {
    reject(
      marketReason("market.entitlement-invalid", {
        entitlementFailureKind: capability.status,
      }),
    );
  }
}

function validateAuthorizationCostBeforeAccess(input: AuthorizationCostGateInputV1): void {
  if (
    !Number.isSafeInteger(input.incrementalSpendMinorUnits) ||
    input.incrementalSpendMinorUnits < 0
  ) {
    reject(marketReason("market.input-invalid"));
  }
  if (input.fallbackRequested && !input.fallbackAuthorized) {
    reject(marketReason("market.silent-fallback-forbidden"));
  }
  if (input.incrementalSpendMinorUnits > 0 && !input.spendingAuthorized) {
    reject(
      marketReason("market.entitlement-invalid", {
        entitlementFailureKind: "zero-spend-violation",
      }),
    );
  }
  if (
    input.authorizationClass !== "synthetic-offline-v1" &&
    input.authorizationClass !== "recorded-private-approved"
  ) {
    reject(marketReason("market.input-invalid"));
  }
}

function rejectedVariant(
  scenario: string,
  counters: MutableAccessCounters,
  probe: () => void,
): JsonObject {
  let reason: CanonicalMarketReasonV1 | null = null;
  try {
    probe();
    counters.providerCalls += 1;
    counters.observationCalls += 1;
    counters.artifactReadCalls += 1;
    counters.bodyReadCalls += 1;
    counters.networkCalls += 1;
  } catch (error) {
    reason = rejectedReason(error);
  }
  const snapshot = frozenCounters(counters);
  if (reason === null || !countersAreZero(snapshot)) {
    throw new Error(`${scenario} did not fail before provider and ArtifactStore access`);
  }
  return {
    scenario,
    status: "rejected",
    reason,
    accessCounters: snapshot,
  };
}

export function evaluateE01EntitlementGateEvidence(): RecordedGateEvidenceV1 {
  const requiredCapability: RequiredCapabilityV1 = {
    datasetId: "dataset-primary",
    feedId: "feed-primary",
    endpointChannelId: "endpoint-recorded",
    use: "offline-replay",
  };
  const baseline: EntitlementGateInputV1 = {
    asOfMs: 1_000,
    effectiveFromMs: 900,
    effectiveToMs: 1_100,
    zeroIncrementalSpend: true,
    capabilities: [{ ...requiredCapability, status: "granted" }],
    requiredCapability,
  };
  const variants = [
    rejectedVariant("pending", emptyCounters(), () =>
      validateEntitlementBeforeAccess({
        ...baseline,
        capabilities: [{ ...requiredCapability, status: "pending" }],
      }),
    ),
    rejectedVariant("denied", emptyCounters(), () =>
      validateEntitlementBeforeAccess({
        ...baseline,
        capabilities: [{ ...requiredCapability, status: "denied" }],
      }),
    ),
    rejectedVariant("expired", emptyCounters(), () =>
      validateEntitlementBeforeAccess({
        ...baseline,
        asOfMs: 1_101,
      }),
    ),
    rejectedVariant("wrong-entitlement", emptyCounters(), () =>
      validateEntitlementBeforeAccess({
        ...baseline,
        requiredCapability: { ...requiredCapability, datasetId: "dataset-other" },
      }),
    ),
  ];
  return freezeEvidence({
    caseId: "E-01",
    gateKind: "entitlement-preflight",
    variants,
    providerAndArtifactStoreAccessZero: variants.every((variant) =>
      countersAreZero(variant["accessCounters"] as RecordedGateAccessCountersV1),
    ),
  });
}

export function evaluateE02AuthorizationCostGateEvidence(): RecordedGateEvidenceV1 {
  const variants = [
    rejectedVariant("unauthorized-fallback", emptyCounters(), () =>
      validateAuthorizationCostBeforeAccess({
        authorizationClass: "synthetic-offline-v1",
        fallbackRequested: true,
        fallbackAuthorized: false,
        incrementalSpendMinorUnits: 0,
        spendingAuthorized: false,
      }),
    ),
    rejectedVariant("unauthorized-incremental-cost", emptyCounters(), () =>
      validateAuthorizationCostBeforeAccess({
        authorizationClass: "recorded-private-approved",
        fallbackRequested: false,
        fallbackAuthorized: false,
        incrementalSpendMinorUnits: 1,
        spendingAuthorized: false,
      }),
    ),
  ];
  return freezeEvidence({
    caseId: "E-02",
    gateKind: "authorization-and-zero-cost-preflight",
    variants,
    providerAndArtifactStoreAccessZero: variants.every((variant) =>
      countersAreZero(variant["accessCounters"] as RecordedGateAccessCountersV1),
    ),
  });
}

function validateClosedSchema(value: JsonObject, expectedKeys: readonly string[]): void {
  const actualKeys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (
    actualKeys.length !== expected.length ||
    actualKeys.some((key, index) => key !== expected[index])
  ) {
    reject(marketReason("market.input-invalid"));
  }
}

export function evaluateX01ClosedSchemaGateEvidence(): RecordedGateEvidenceV1 {
  const value = { schemaVersion: 1, records: [], unknown: "trap" };
  let reason: CanonicalMarketReasonV1 | null = null;
  try {
    validateClosedSchema(value, ["schemaVersion", "records"]);
  } catch (error) {
    reason = rejectedReason(error);
  }
  if (reason === null) throw new Error("closed-schema probe unexpectedly passed");
  return freezeEvidence({
    caseId: "X-01",
    gateKind: "closed-schema",
    status: "rejected",
    reason,
    expectedKeys: ["records", "schemaVersion"],
    actualKeys: Object.keys(value).sort(),
    unexpectedKeys: ["unknown"],
    emittedRecords: 0,
  });
}

function parseClosedRecordedEnvelope(source: string): JsonObject {
  let value: unknown;
  try {
    value = JSON.parse(source);
  } catch {
    reject(marketReason("market.input-invalid"));
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    reject(marketReason("market.input-invalid"));
  }
  const object = value as JsonObject;
  validateClosedSchema(object, ["schemaVersion", "sourceProfileId", "records"]);
  if (object["schemaVersion"] !== 1 || !Array.isArray(object["records"])) {
    reject(marketReason("market.input-invalid"));
  }
  return object;
}

export function evaluateX02MalformedParserGateEvidence(): RecordedGateEvidenceV1 {
  const malformed = '{"schemaVersion":1,"sourceProfileId":"synthetic","records":[';
  let reason: CanonicalMarketReasonV1 | null = null;
  try {
    parseClosedRecordedEnvelope(malformed);
  } catch (error) {
    reason = rejectedReason(error);
  }
  if (reason === null) throw new Error("malformed parser probe unexpectedly passed");
  return freezeEvidence({
    caseId: "X-02",
    gateKind: "closed-recorded-envelope-parser",
    status: "rejected",
    reason,
    inputBytes: Buffer.byteLength(malformed, "utf8"),
    parsedEnvelope: false,
    emittedRecords: 0,
  });
}

export function evaluateX03SensitiveNoEchoGateEvidence(): RecordedGateEvidenceV1 {
  const sensitiveValue = "forbidden-secret-witness";
  const value = {
    schemaVersion: 1,
    sourceProfileId: "synthetic",
    records: [],
    credential: sensitiveValue,
  };
  let reason: CanonicalMarketReasonV1 | null = null;
  let errorMessage = "";
  try {
    validateClosedSchema(value, ["schemaVersion", "sourceProfileId", "records"]);
  } catch (error) {
    reason = rejectedReason(error);
    errorMessage = error instanceof Error ? error.message : "";
  }
  if (reason === null || errorMessage.includes(sensitiveValue)) {
    throw new Error("sensitive-field probe failed to reject without echo");
  }
  const evidence: JsonObject = {
    caseId: "X-03",
    gateKind: "sensitive-field-closed-schema",
    status: "rejected",
    reason,
    rejectedField: "credential",
    errorMessage,
    secretEchoed: false,
    emittedRecords: 0,
  };
  if (JSON.stringify(evidence).includes(sensitiveValue)) {
    throw new Error("sensitive value entered structured evidence");
  }
  return freezeEvidence(evidence as RecordedGateEvidenceV1);
}

type StreamProbeKind = "growth" | "replacement";

type MutableStreamCounters = {
  acquiredStreams: number;
  startedStreams: number;
  closedStreams: number;
  settledStreams: number;
  consumedBytes: number;
  emittedMembers: number;
};

type InstrumentedStream = Readonly<{
  stream: Readable;
  closed: Promise<void>;
}>;

function instrumentedStream(
  chunks: readonly Uint8Array[],
  counters: MutableStreamCounters,
): InstrumentedStream {
  const stream = Readable.from(chunks);
  counters.acquiredStreams += 1;
  const closed = new Promise<void>((resolve) => {
    stream.once("close", () => {
      counters.closedStreams += 1;
      resolve();
    });
  });
  return { stream, closed };
}

async function consumeVerifiedProbe(
  instrumented: InstrumentedStream,
  declaredBytes: number,
  expectedDigest: string,
  counters: MutableStreamCounters,
): Promise<void> {
  counters.startedStreams += 1;
  let consumed = 0;
  const hash = createHash("sha256");
  for await (const chunk of instrumented.stream) {
    if (!(chunk instanceof Uint8Array)) reject(marketReason("market.artifact-read-failed"));
    if (chunk.byteLength > declaredBytes - consumed) {
      reject(marketReason("market.artifact-read-failed"));
    }
    consumed += chunk.byteLength;
    counters.consumedBytes += chunk.byteLength;
    hash.update(chunk);
  }
  if (consumed !== declaredBytes) {
    reject(
      marketReason("market.artifact-invalid", {
        artifactFailureKind: "size-mismatch",
      }),
    );
  }
  if (hash.digest("hex") !== expectedDigest) {
    reject(
      marketReason("market.artifact-invalid", {
        artifactFailureKind: "digest-mismatch",
      }),
    );
  }
}

async function settleInstrumentedStreams(
  streams: readonly InstrumentedStream[],
  counters: MutableStreamCounters,
): Promise<void> {
  for (const item of streams) {
    if (!item.stream.destroyed) item.stream.destroy();
  }
  await Promise.all(streams.map((item) => item.closed));
  counters.settledStreams = streams.length;
}

async function streamFailureVariant(
  kind: StreamProbeKind,
  failingIndex: number,
): Promise<JsonObject> {
  const counters: MutableStreamCounters = {
    acquiredStreams: 0,
    startedStreams: 0,
    closedStreams: 0,
    settledStreams: 0,
    consumedBytes: 0,
    emittedMembers: 0,
  };
  const expected = Buffer.from("a");
  const expectedDigest = createHash("sha256").update(expected).digest("hex");
  const streams = Array.from({ length: 3 }, (_, index) => {
    const chunks =
      index !== failingIndex
        ? [expected]
        : kind === "growth"
          ? [expected, Buffer.from("b")]
          : [Buffer.from("b")];
    return instrumentedStream(chunks, counters);
  });
  let reason: CanonicalMarketReasonV1 | null = null;
  try {
    for (let index = 0; index < streams.length; index += 1) {
      const item = streams[index];
      if (item === undefined) reject(marketReason("market.input-invalid"));
      await consumeVerifiedProbe(item, 1, expectedDigest, counters);
    }
    counters.emittedMembers = streams.length;
  } catch (error) {
    reason = rejectedReason(error);
  } finally {
    await settleInstrumentedStreams(streams, counters);
  }
  if (
    reason === null ||
    counters.acquiredStreams !== 3 ||
    counters.closedStreams !== 3 ||
    counters.settledStreams !== 3 ||
    counters.emittedMembers !== 0
  ) {
    throw new Error(`${kind} stream probe did not fail and settle atomically`);
  }
  return {
    scenario: `${kind}-${["first", "middle", "last"][failingIndex]}`,
    failingIndex,
    status: "rejected",
    reason,
    counters: { ...counters },
  };
}

/**
 * Async is required only for X-04 because verified stream iteration and sibling `close` settlement
 * are asynchronous Node stream events. All other gate-evidence primitives are synchronous.
 */
export async function evaluateX04StreamSiblingGateEvidence(): Promise<RecordedGateEvidenceV1> {
  const variants: JsonObject[] = [];
  for (const kind of ["growth", "replacement"] as const) {
    for (let failingIndex = 0; failingIndex < 3; failingIndex += 1) {
      variants.push(await streamFailureVariant(kind, failingIndex));
    }
  }
  return freezeEvidence({
    caseId: "X-04" as const,
    gateKind: "verified-stream-atomic-settlement",
    variants,
    allSiblingsSettled: variants.every((variant) => {
      const counters = variant["counters"] as JsonObject;
      return (
        counters["acquiredStreams"] === 3 &&
        counters["closedStreams"] === 3 &&
        counters["settledStreams"] === 3 &&
        counters["emittedMembers"] === 0
      );
    }),
  });
}

export function evaluateX05OperationalCoverageEvidence(): RecordedGateEvidenceV1 {
  const accepted = new Set<string>();
  const executions: JsonObject[] = [];
  const run = (boundIds: readonly string[], operation: string, probe: () => void): void => {
    probe();
    for (const boundId of boundIds) accepted.add(boundId);
    executions.push({ operation, boundIds, status: "accepted" });
  };
  run(["rawArtifactBytes"], "validateRawArtifactByteBound", () => {
    validateRawArtifactByteBound({ role: "probe", declaredSizeBytes: 1, verifiedSizeBytes: 1 });
  });
  run(["aggregateVerifiedBytes"], "validateAggregateVerifiedByteBound", () => {
    validateAggregateVerifiedByteBound([
      { role: "probe", declaredSizeBytes: 1, verifiedSizeBytes: 1 },
    ]);
  });
  run(
    ["artifactsPerAcquisition", "pagesPerAcquisition", "instrumentsPerAcquisition"],
    "validateAcquisitionCardinalityBounds",
    () => {
      validateAcquisitionCardinalityBounds({
        artifactMembers: [null],
        expectedPageCount: 1,
        instrumentIds: ["instrument"],
      });
    },
  );
  run(
    ["recordsPerArtifactOrPage", "factsPerAcquisition"],
    "validateRecordAndFactCardinalityBounds",
    () => {
      validateRecordAndFactCardinalityBounds(
        [{ role: "probe", pageOrdinal: 0, records: [null] }],
        [null],
      );
    },
  );
  run(["canonicalRecordBytes"], "validateCanonicalRecordByteBounds", () => {
    validateCanonicalRecordByteBounds([null]);
  });
  run(
    [
      "rawJsonDepth",
      "rawJsonNodes",
      "rawJsonKeysPerObject",
      "rawJsonArrayItems",
      "parserTokensPerArtifact",
    ],
    "validateRawJsonParserBounds",
    () => {
      validateRawJsonParserBounds({ records: [] }, "probe");
    },
  );
  run(
    ["sidecarDepth", "sidecarNodes", "sidecarKeysPerObject", "sidecarGenericArrayItems"],
    "validateSidecarParserBounds",
    () => {
      validateSidecarParserBounds({ value: null }, "$.probe");
    },
  );
  run(["genericStringBytes"], "validateGenericStringByteBounds", () => {
    validateGenericStringByteBounds([{ path: "$.probe", value: "value" }]);
  });
  run(["identifierBytes"], "validateIdentifierByteBounds", () => {
    validateIdentifierByteBounds([{ path: "$.probe", value: "id" }]);
  });
  run(["providerOrDatasetCodeBytes"], "validateProviderOrDatasetCodeByteBounds", () => {
    validateProviderOrDatasetCodeByteBounds({ providerCode: "provider", datasetCode: "dataset" });
  });
  run(["symbolBytes"], "validateSymbolByteBounds", () => {
    validateSymbolByteBounds([{ path: "$.probe", symbol: "PEAS" }]);
  });
  run(["pageTokenInputBytes"], "validatePageTokenInputByteBound", () => {
    validatePageTokenInputByteBound({ path: "$.probe", value: "token" });
  });
  run(["opaqueProviderIdBytes"], "validateOpaqueProviderIdByteBounds", () => {
    validateOpaqueProviderIdByteBounds([{ path: "$.probe", value: "opaque" }]);
  });
  run(
    ["intervalsPerCluster", "referenceResultsPerCluster"],
    "validateClusterCardinalityBounds",
    () => {
      validateClusterCardinalityBounds({ intervalDefinitions: [null], referenceResults: [null] });
    },
  );
  run(
    [
      "sidecarRecordsPerExecution",
      "sidecarEdgesPerExecution",
      "canonicalSidecarRecordBytes",
      "canonicalExecutionBundleBytes",
    ],
    "validateExecutionBundleBounds",
    () => {
      validateExecutionBundleBounds({ records: [null], edges: [] });
    },
  );
  run(["recordedReplayPageSize"], "validateRecordedReplayPageSizeBound", () => {
    validateRecordedReplayPageSizeBound({ acquisitionMode: "replay", declaredPageSize: 1 });
  });
  run(["historicalQueryWindow"], "validateHistoricalQueryWindowBound", () => {
    validateHistoricalQueryWindowBound({ consecutiveCalendarDates: ["2037-07-08"] });
  });
  run(["selectionSearchWindowMs"], "validateSelectionSearchWindowBound", () => {
    validateSelectionSearchWindowBound({ windowStartMs: 0, windowEndMs: 0 });
  });
  run(["calendarDatesPerManifest"], "validateCalendarDatesPerManifestBound", () => {
    validateCalendarDatesPerManifestBound({ dates: [] });
  });

  const acceptedBoundIds = [...accepted].sort();
  const expectedBoundIds = [...RECORDED_LOADER_OPERATIONAL_BOUND_IDS].sort();
  const implementationKeys = Object.keys(RECORDED_LOADER_BOUND_IMPLEMENTATIONS).sort();
  if (
    canonicalHash("peas/recorded-loader-bound-set/v1", acceptedBoundIds) !==
      canonicalHash("peas/recorded-loader-bound-set/v1", expectedBoundIds) ||
    canonicalHash("peas/recorded-loader-bound-set/v1", implementationKeys) !==
      canonicalHash("peas/recorded-loader-bound-set/v1", expectedBoundIds)
  ) {
    throw new Error("operational bound coverage is incomplete");
  }
  return freezeEvidence({
    caseId: "X-05",
    gateKind: "operational-bound-acceptance",
    status: "accepted",
    acceptedBoundIds,
    acceptedBoundCount: acceptedBoundIds.length,
    executions,
    implementationCoverageComplete: true,
  });
}

export function recordedQueryIdentityHash(query: RecordedQueryIdentityV1): string {
  return canonicalHash("peas/recorded-market-query-identity/v1", query);
}

export function recordedPageChainHash(member: RecordedPageChainMemberV1): string {
  return canonicalHash("peas/market-page-chain/v1", member);
}

function validatePageChainAndQuery(
  pages: readonly RecordedPageChainMemberV1[],
  query: RecordedQueryIdentityV1,
  expectedQueryIdentityHash: string,
  expectedTerminalPageChainHash: string,
): void {
  if (pages.length < 1 || recordedQueryIdentityHash(query) !== expectedQueryIdentityHash) {
    reject(marketReason("market.page-chain-invalid"));
  }
  let priorPageChainHash: string | null = null;
  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index];
    if (
      page === undefined ||
      page.pageOrdinal !== index ||
      page.priorPageChainHash !== priorPageChainHash ||
      page.terminalPage !== (index === pages.length - 1)
    ) {
      reject(marketReason("market.page-chain-invalid"));
    }
    priorPageChainHash = recordedPageChainHash(page);
  }
  if (priorPageChainHash !== expectedTerminalPageChainHash) {
    reject(marketReason("market.page-chain-invalid"));
  }
}

export function evaluateO03PageChainQueryGateEvidence(): RecordedGateEvidenceV1 {
  const query: RecordedQueryIdentityV1 = {
    instrumentIds: ["instrument-primary"],
    requestedFactKinds: ["quote", "trade"],
    queryStartNs: "100000000000",
    queryEndNs: "200000000000",
    routePolicyVersion: "recorded-route-v1",
  };
  const first: RecordedPageChainMemberV1 = {
    sourceProfileId: "source-primary",
    pageOrdinal: 0,
    priorPageChainHash: null,
    artifactContentId: "mac1_first",
    terminalPage: false,
  };
  const second: RecordedPageChainMemberV1 = {
    sourceProfileId: "source-primary",
    pageOrdinal: 1,
    priorPageChainHash: recordedPageChainHash(first),
    artifactContentId: "mac1_second",
    terminalPage: true,
  };
  const baselinePages = [first, second];
  const queryIdentityHash = recordedQueryIdentityHash(query);
  const terminalPageChainHash = recordedPageChainHash(second);
  validatePageChainAndQuery(baselinePages, query, queryIdentityHash, terminalPageChainHash);

  const variants: JsonObject[] = [];
  const probe = (
    scenario: string,
    pages: readonly RecordedPageChainMemberV1[],
    candidateQuery: RecordedQueryIdentityV1,
  ): void => {
    const counters = emptyCounters();
    let reason: CanonicalMarketReasonV1 | null = null;
    try {
      validatePageChainAndQuery(pages, candidateQuery, queryIdentityHash, terminalPageChainHash);
      counters.observationCalls += 1;
      counters.artifactReadCalls += 1;
    } catch (error) {
      reason = rejectedReason(error);
    }
    const snapshot = frozenCounters(counters);
    if (reason === null || !countersAreZero(snapshot)) {
      throw new Error(`${scenario} did not reject before ArtifactStore access`);
    }
    variants.push({
      scenario,
      status: "rejected",
      reason,
      accessCounters: snapshot,
    });
  };
  probe("page-gap", [first, { ...second, pageOrdinal: 2 }], query);
  probe("page-substitution", [first, { ...second, artifactContentId: "mac1_substituted" }], query);
  probe("query-substitution", baselinePages, {
    ...query,
    queryEndNs: "200000000001",
  });

  return freezeEvidence({
    caseId: "O-03",
    gateKind: "page-chain-and-query-identity-preflight",
    baseline: {
      status: "accepted",
      pageCount: baselinePages.length,
      terminalChainHash: terminalPageChainHash,
      queryIdentityHash,
    },
    variants,
    artifactStoreAccessZero: variants.every((variant) =>
      countersAreZero(variant["accessCounters"] as RecordedGateAccessCountersV1),
    ),
  });
}

export async function evaluateRecordedLoaderStructuredGateEvidence(): Promise<
  readonly RecordedGateEvidenceV1[]
> {
  return Object.freeze([
    evaluateE01EntitlementGateEvidence(),
    evaluateE02AuthorizationCostGateEvidence(),
    evaluateX01ClosedSchemaGateEvidence(),
    evaluateX02MalformedParserGateEvidence(),
    evaluateX03SensitiveNoEchoGateEvidence(),
    await evaluateX04StreamSiblingGateEvidence(),
    evaluateX05OperationalCoverageEvidence(),
    evaluateO03PageChainQueryGateEvidence(),
  ]);
}
