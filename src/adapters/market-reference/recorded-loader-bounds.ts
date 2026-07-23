import { Buffer } from "node:buffer";

import { canonicalJson, type JsonValue } from "../../core/json.js";
import { LOADER_OWNED_BOUND_IDS } from "../../providers/market-reference/bounds.js";
import {
  type MarketBoundIdV1,
  MarketContractError,
  marketReason,
} from "../../providers/market-reference/contracts.js";

export const RECORDED_LOADER_OPERATIONAL_BOUND_IDS = Object.freeze([
  "rawArtifactBytes",
  "aggregateVerifiedBytes",
  "artifactsPerAcquisition",
  "pagesPerAcquisition",
  "recordsPerArtifactOrPage",
  "factsPerAcquisition",
  "canonicalRecordBytes",
  "rawJsonDepth",
  "rawJsonNodes",
  "rawJsonKeysPerObject",
  "rawJsonArrayItems",
  "parserTokensPerArtifact",
  "sidecarDepth",
  "sidecarNodes",
  "sidecarKeysPerObject",
  "sidecarGenericArrayItems",
  "genericStringBytes",
  "identifierBytes",
  "providerOrDatasetCodeBytes",
  "symbolBytes",
  "pageTokenInputBytes",
  "opaqueProviderIdBytes",
  "instrumentsPerAcquisition",
  "intervalsPerCluster",
  "referenceResultsPerCluster",
  "sidecarRecordsPerExecution",
  "sidecarEdgesPerExecution",
  "canonicalSidecarRecordBytes",
  "canonicalExecutionBundleBytes",
  "recordedReplayPageSize",
  "historicalQueryWindow",
  "selectionSearchWindowMs",
  "calendarDatesPerManifest",
] as const);

export type RecordedLoaderBoundIdV1 = (typeof RECORDED_LOADER_OPERATIONAL_BOUND_IDS)[number];

export const RECORDED_LOADER_OPERATIONAL_LIMITS = Object.freeze({
  rawArtifactBytes: 10_485_760,
  aggregateVerifiedBytes: 67_108_864,
  artifactsPerAcquisition: 16,
  pagesPerAcquisition: 16,
  recordsPerArtifactOrPage: 10_000,
  factsPerAcquisition: 160_000,
  canonicalRecordBytes: 65_536,
  rawJsonDepth: 32,
  rawJsonNodes: 250_000,
  rawJsonKeysPerObject: 64,
  rawJsonArrayItems: 10_000,
  parserTokensPerArtifact: 250_000,
  sidecarDepth: 8,
  sidecarNodes: 512,
  sidecarKeysPerObject: 64,
  sidecarGenericArrayItems: 32,
  genericStringBytes: 1_024,
  identifierBytes: 512,
  providerOrDatasetCodeBytes: 128,
  symbolBytes: 32,
  pageTokenInputBytes: 4_096,
  opaqueProviderIdBytes: 128,
  instrumentsPerAcquisition: 64,
  intervalsPerCluster: 16,
  referenceResultsPerCluster: 64,
  sidecarRecordsPerExecution: 4_096,
  sidecarEdgesPerExecution: 12_279,
  canonicalSidecarRecordBytes: 65_536,
  canonicalExecutionBundleBytes: 67_108_864,
  recordedReplayPageSize: 10_000,
  historicalQueryWindow: 8,
  selectionSearchWindowMs: 86_400_000,
  calendarDatesPerManifest: 400,
} as const satisfies Readonly<Record<RecordedLoaderBoundIdV1, number>>);

export type RecordedLoaderBoundEvidenceV1 = Readonly<{
  boundId: RecordedLoaderBoundIdV1;
  path: string;
  observed: number;
  minimum: number;
  maximum: number;
}>;

export type RecordedArtifactByteInputV1 = Readonly<{
  role: string;
  declaredSizeBytes: number;
  verifiedSizeBytes: number;
}>;

export type RecordedArtifactPageInputV1 = Readonly<{
  role: string;
  pageOrdinal: number;
  records: readonly JsonValue[];
}>;

export type RecordedTextFieldV1 = Readonly<{
  path: string;
  value: string;
}>;

export type RecordedProviderDatasetCodeInputV1 = Readonly<{
  providerCode: string;
  datasetCode: string;
}>;

export type RecordedSymbolAliasInputV1 = Readonly<{
  path: string;
  symbol: string;
}>;

export type RecordedAcquisitionCardinalityInputV1 = Readonly<{
  artifactMembers: readonly unknown[];
  expectedPageCount: number;
  instrumentIds: readonly string[];
}>;

export type RecordedClusterCardinalityInputV1 = Readonly<{
  intervalDefinitions: readonly unknown[];
  referenceResults: readonly unknown[];
}>;

export type RecordedExecutionEdgeV1 = Readonly<{
  fromRecordId: string;
  toRecordId: string;
  edgeKind: string;
}>;

export type RecordedExecutionBundleInputV1 = Readonly<{
  records: readonly JsonValue[];
  edges: readonly RecordedExecutionEdgeV1[];
}>;

export type RecordedReplayRequestInputV1 = Readonly<{
  acquisitionMode: "recorded" | "replay";
  declaredPageSize: number;
}>;

export type RecordedHistoricalQueryInputV1 = Readonly<{
  consecutiveCalendarDates: readonly string[];
}>;

export type RecordedSelectionWindowInputV1 = Readonly<{
  windowStartMs: number;
  windowEndMs: number;
}>;

export type RecordedCalendarManifestInputV1 = Readonly<{
  dates: readonly unknown[];
}>;

export type RecordedJsonBoundSummaryV1 = Readonly<{
  maxDepth: number;
  nodes: number;
  maxKeysPerObject: number;
  maxArrayItems: number;
  parserTokens: number;
  maxStringBytes: number;
}>;

function inputInvalid(): never {
  throw new MarketContractError(marketReason("market.input-invalid"));
}

function boundExceeded(boundId: RecordedLoaderBoundIdV1): never {
  throw new MarketContractError(
    marketReason("market.bound-exceeded", {
      limitKind: boundId as MarketBoundIdV1,
    }),
  );
}

function safeCount(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) inputInvalid();
  return value;
}

function evidence(
  boundId: RecordedLoaderBoundIdV1,
  path: string,
  observed: number,
  minimum = 0,
): RecordedLoaderBoundEvidenceV1 {
  safeCount(observed);
  const maximum = RECORDED_LOADER_OPERATIONAL_LIMITS[boundId];
  if (observed < minimum) inputInvalid();
  if (observed > maximum) boundExceeded(boundId);
  return Object.freeze({ boundId, path, observed, minimum, maximum });
}

function utf8Bytes(value: string): number {
  if (typeof value !== "string") inputInvalid();
  return Buffer.byteLength(value, "utf8");
}

function asciiBytes(value: string): number {
  if (typeof value !== "string") inputInvalid();
  for (const character of value) {
    if (character.codePointAt(0) !== undefined && (character.codePointAt(0) as number) > 0x7f) {
      inputInvalid();
    }
  }
  return Buffer.byteLength(value, "ascii");
}

export function validateRawArtifactByteBound(
  artifact: RecordedArtifactByteInputV1,
): readonly RecordedLoaderBoundEvidenceV1[] {
  return Object.freeze([
    evidence(
      "rawArtifactBytes",
      `$.retrievedMembers[${artifact.role}].declaredSizeBytes`,
      safeCount(artifact.declaredSizeBytes),
    ),
    evidence(
      "rawArtifactBytes",
      `$.verifiedReads[${artifact.role}].sizeBytes`,
      safeCount(artifact.verifiedSizeBytes),
    ),
  ]);
}

export function validateAggregateVerifiedByteBound(
  artifacts: readonly RecordedArtifactByteInputV1[],
): RecordedLoaderBoundEvidenceV1 {
  let total = 0;
  for (const artifact of artifacts) {
    total += safeCount(artifact.verifiedSizeBytes);
    if (!Number.isSafeInteger(total)) boundExceeded("aggregateVerifiedBytes");
  }
  return evidence("aggregateVerifiedBytes", "$.verifiedReads", total);
}

export function validateAcquisitionCardinalityBounds(
  acquisition: RecordedAcquisitionCardinalityInputV1,
): readonly RecordedLoaderBoundEvidenceV1[] {
  return Object.freeze([
    evidence(
      "artifactsPerAcquisition",
      "$.acquisition.artifactMembers",
      acquisition.artifactMembers.length,
    ),
    evidence(
      "pagesPerAcquisition",
      "$.acquisition.expectedPageCount",
      safeCount(acquisition.expectedPageCount),
      1,
    ),
    evidence(
      "instrumentsPerAcquisition",
      "$.acquisition.marketAcquisitionPreimage.instrumentIds",
      acquisition.instrumentIds.length,
      1,
    ),
  ]);
}

export function validateRecordAndFactCardinalityBounds(
  pages: readonly RecordedArtifactPageInputV1[],
  normalizedFacts: readonly unknown[],
): readonly RecordedLoaderBoundEvidenceV1[] {
  const rows: RecordedLoaderBoundEvidenceV1[] = [];
  for (const page of pages) {
    safeCount(page.pageOrdinal);
    rows.push(
      evidence(
        "recordsPerArtifactOrPage",
        `$.verifiedMembers[${page.pageOrdinal}].records`,
        page.records.length,
      ),
    );
  }
  rows.push(evidence("factsPerAcquisition", "$.normalizedFacts", normalizedFacts.length));
  return Object.freeze(rows);
}

export function validateCanonicalRecordByteBounds(
  records: readonly JsonValue[],
): readonly RecordedLoaderBoundEvidenceV1[] {
  return Object.freeze(
    records.map((record, index) =>
      evidence(
        "canonicalRecordBytes",
        `$.recordedMarketRecords[${index}]`,
        Buffer.byteLength(canonicalJson(record), "utf8"),
      ),
    ),
  );
}

type JsonVisitFrame = Readonly<{
  value: JsonValue;
  path: string;
  depth: number;
}>;

function jsonBoundSummary(
  value: JsonValue,
  mode: "raw" | "sidecar",
  rootPath: string,
): RecordedJsonBoundSummaryV1 {
  const frames: JsonVisitFrame[] = [{ value, path: rootPath, depth: 1 }];
  const seen = new Set<object>();
  let maxDepth = 0;
  let nodes = 0;
  let maxKeysPerObject = 0;
  let maxArrayItems = 0;
  let parserTokens = 0;
  let maxStringBytes = 0;

  while (frames.length > 0) {
    const frame = frames.pop();
    if (frame === undefined) inputInvalid();
    const { value: current, path, depth } = frame;
    maxDepth = Math.max(maxDepth, depth);
    nodes += 1;
    parserTokens += 1;
    const depthBound = mode === "raw" ? "rawJsonDepth" : "sidecarDepth";
    const nodesBound = mode === "raw" ? "rawJsonNodes" : "sidecarNodes";
    evidence(depthBound, path, depth);
    evidence(nodesBound, rootPath, nodes);

    if (typeof current === "string") {
      const bytes = utf8Bytes(current);
      maxStringBytes = Math.max(maxStringBytes, bytes);
      evidence("genericStringBytes", path, bytes);
      continue;
    }
    if (current === null || typeof current !== "object") continue;
    if (seen.has(current)) inputInvalid();
    seen.add(current);

    if (Array.isArray(current)) {
      maxArrayItems = Math.max(maxArrayItems, current.length);
      evidence(
        mode === "raw" ? "rawJsonArrayItems" : "sidecarGenericArrayItems",
        path,
        current.length,
      );
      for (let index = current.length - 1; index >= 0; index -= 1) {
        const child = current[index];
        if (child === undefined) inputInvalid();
        frames.push({ value: child, path: `${path}[${index}]`, depth: depth + 1 });
      }
    } else {
      const keys = Object.keys(current);
      maxKeysPerObject = Math.max(maxKeysPerObject, keys.length);
      evidence(mode === "raw" ? "rawJsonKeysPerObject" : "sidecarKeysPerObject", path, keys.length);
      parserTokens += keys.length;
      for (const key of keys) {
        const keyBytes = utf8Bytes(key);
        maxStringBytes = Math.max(maxStringBytes, keyBytes);
        evidence("genericStringBytes", `${path} key`, keyBytes);
      }
      for (let index = keys.length - 1; index >= 0; index -= 1) {
        const key = keys[index];
        if (key === undefined) inputInvalid();
        const child = (current as Readonly<Record<string, JsonValue>>)[key];
        if (child === undefined) inputInvalid();
        frames.push({ value: child, path: `${path}.${key}`, depth: depth + 1 });
      }
    }
  }

  if (mode === "raw") {
    evidence("parserTokensPerArtifact", rootPath, parserTokens);
  }
  return Object.freeze({
    maxDepth,
    nodes,
    maxKeysPerObject,
    maxArrayItems,
    parserTokens,
    maxStringBytes,
  });
}

export function validateRawJsonParserBounds(
  parsedArtifact: JsonValue,
  artifactRole: string,
): RecordedJsonBoundSummaryV1 {
  return jsonBoundSummary(parsedArtifact, "raw", `$.verifiedArtifacts[${artifactRole}]`);
}

export function validateSidecarParserBounds(
  sidecar: JsonValue,
  sidecarPath: string,
): RecordedJsonBoundSummaryV1 {
  return jsonBoundSummary(sidecar, "sidecar", sidecarPath);
}

export function validateGenericStringByteBounds(
  fields: readonly RecordedTextFieldV1[],
): readonly RecordedLoaderBoundEvidenceV1[] {
  return Object.freeze(
    fields.map((field) => evidence("genericStringBytes", field.path, utf8Bytes(field.value))),
  );
}

export function validateIdentifierByteBounds(
  fields: readonly RecordedTextFieldV1[],
): readonly RecordedLoaderBoundEvidenceV1[] {
  return Object.freeze(
    fields.map((field) => evidence("identifierBytes", field.path, utf8Bytes(field.value))),
  );
}

export function validateProviderOrDatasetCodeByteBounds(
  input: RecordedProviderDatasetCodeInputV1,
): readonly RecordedLoaderBoundEvidenceV1[] {
  return Object.freeze([
    evidence(
      "providerOrDatasetCodeBytes",
      "$.sourceProfile.provider.preimage.providerCode",
      asciiBytes(input.providerCode),
    ),
    evidence(
      "providerOrDatasetCodeBytes",
      "$.sourceProfile.dataset.preimage.datasetCode",
      asciiBytes(input.datasetCode),
    ),
  ]);
}

export function validateSymbolByteBounds(
  aliases: readonly RecordedSymbolAliasInputV1[],
): readonly RecordedLoaderBoundEvidenceV1[] {
  return Object.freeze(
    aliases.map((alias) => evidence("symbolBytes", alias.path, asciiBytes(alias.symbol))),
  );
}

export function validatePageTokenInputByteBound(
  pageToken: RecordedTextFieldV1 | null,
): RecordedLoaderBoundEvidenceV1 | null {
  return pageToken === null
    ? null
    : evidence("pageTokenInputBytes", pageToken.path, utf8Bytes(pageToken.value));
}

export function validateOpaqueProviderIdByteBounds(
  fields: readonly RecordedTextFieldV1[],
): readonly RecordedLoaderBoundEvidenceV1[] {
  return Object.freeze(
    fields.map((field) => evidence("opaqueProviderIdBytes", field.path, asciiBytes(field.value))),
  );
}

export function validateClusterCardinalityBounds(
  cluster: RecordedClusterCardinalityInputV1,
): readonly RecordedLoaderBoundEvidenceV1[] {
  return Object.freeze([
    evidence(
      "intervalsPerCluster",
      "$.selectionPolicy.intervalDefinitions",
      cluster.intervalDefinitions.length,
    ),
    evidence("referenceResultsPerCluster", "$.selectionResults", cluster.referenceResults.length),
  ]);
}

export function validateSidecarRecordByteBounds(
  records: readonly JsonValue[],
): readonly RecordedLoaderBoundEvidenceV1[] {
  return Object.freeze(
    records.map((record, index) =>
      evidence(
        "canonicalSidecarRecordBytes",
        `$.executionBundle.records[${index}]`,
        Buffer.byteLength(canonicalJson(record), "utf8"),
      ),
    ),
  );
}

export function validateExecutionBundleBounds(
  bundle: RecordedExecutionBundleInputV1,
): readonly RecordedLoaderBoundEvidenceV1[] {
  const canonicalBundle = {
    records: bundle.records,
    edges: bundle.edges,
  } as const;
  return Object.freeze([
    evidence("sidecarRecordsPerExecution", "$.executionBundle.records", bundle.records.length),
    evidence("sidecarEdgesPerExecution", "$.executionBundle.edges", bundle.edges.length),
    ...validateSidecarRecordByteBounds(bundle.records),
    evidence(
      "canonicalExecutionBundleBytes",
      "$.executionBundle",
      Buffer.byteLength(canonicalJson(canonicalBundle as unknown as JsonValue), "utf8"),
    ),
  ]);
}

export function validateRecordedReplayPageSizeBound(
  request: RecordedReplayRequestInputV1,
): RecordedLoaderBoundEvidenceV1 {
  if (request.acquisitionMode !== "recorded" && request.acquisitionMode !== "replay")
    inputInvalid();
  return evidence(
    "recordedReplayPageSize",
    "$.acquisition.declaredPageSize",
    safeCount(request.declaredPageSize),
    1,
  );
}

export function validateHistoricalQueryWindowBound(
  request: RecordedHistoricalQueryInputV1,
): RecordedLoaderBoundEvidenceV1 {
  return evidence(
    "historicalQueryWindow",
    "$.acquisition.consecutiveCalendarDates",
    request.consecutiveCalendarDates.length,
    1,
  );
}

export function validateSelectionSearchWindowBound(
  request: RecordedSelectionWindowInputV1,
): RecordedLoaderBoundEvidenceV1 {
  const start = safeCount(request.windowStartMs);
  const end = safeCount(request.windowEndMs);
  if (end < start) inputInvalid();
  return evidence("selectionSearchWindowMs", "$.selectionRequest.searchWindow", end - start);
}

export function validateCalendarDatesPerManifestBound(
  calendar: RecordedCalendarManifestInputV1,
): RecordedLoaderBoundEvidenceV1 {
  return evidence("calendarDatesPerManifest", "$.calendarSnapshot.dates", calendar.dates.length);
}

export const RECORDED_LOADER_BOUND_IMPLEMENTATIONS = Object.freeze({
  rawArtifactBytes: "validateRawArtifactByteBound",
  aggregateVerifiedBytes: "validateAggregateVerifiedByteBound",
  artifactsPerAcquisition: "validateAcquisitionCardinalityBounds",
  pagesPerAcquisition: "validateAcquisitionCardinalityBounds",
  recordsPerArtifactOrPage: "validateRecordAndFactCardinalityBounds",
  factsPerAcquisition: "validateRecordAndFactCardinalityBounds",
  canonicalRecordBytes: "validateCanonicalRecordByteBounds",
  rawJsonDepth: "validateRawJsonParserBounds",
  rawJsonNodes: "validateRawJsonParserBounds",
  rawJsonKeysPerObject: "validateRawJsonParserBounds",
  rawJsonArrayItems: "validateRawJsonParserBounds",
  parserTokensPerArtifact: "validateRawJsonParserBounds",
  sidecarDepth: "validateSidecarParserBounds",
  sidecarNodes: "validateSidecarParserBounds",
  sidecarKeysPerObject: "validateSidecarParserBounds",
  sidecarGenericArrayItems: "validateSidecarParserBounds",
  genericStringBytes: "validateGenericStringByteBounds",
  identifierBytes: "validateIdentifierByteBounds",
  providerOrDatasetCodeBytes: "validateProviderOrDatasetCodeByteBounds",
  symbolBytes: "validateSymbolByteBounds",
  pageTokenInputBytes: "validatePageTokenInputByteBound",
  opaqueProviderIdBytes: "validateOpaqueProviderIdByteBounds",
  instrumentsPerAcquisition: "validateAcquisitionCardinalityBounds",
  intervalsPerCluster: "validateClusterCardinalityBounds",
  referenceResultsPerCluster: "validateClusterCardinalityBounds",
  sidecarRecordsPerExecution: "validateExecutionBundleBounds",
  sidecarEdgesPerExecution: "validateExecutionBundleBounds",
  canonicalSidecarRecordBytes: "validateSidecarRecordByteBounds",
  canonicalExecutionBundleBytes: "validateExecutionBundleBounds",
  recordedReplayPageSize: "validateRecordedReplayPageSizeBound",
  historicalQueryWindow: "validateHistoricalQueryWindowBound",
  selectionSearchWindowMs: "validateSelectionSearchWindowBound",
  calendarDatesPerManifest: "validateCalendarDatesPerManifestBound",
} as const satisfies Readonly<Record<RecordedLoaderBoundIdV1, string>>);

if (
  Object.keys(RECORDED_LOADER_BOUND_IMPLEMENTATIONS).length !== 33 ||
  RECORDED_LOADER_OPERATIONAL_BOUND_IDS.some(
    (boundId) => !(boundId in RECORDED_LOADER_BOUND_IMPLEMENTATIONS),
  ) ||
  LOADER_OWNED_BOUND_IDS.length !== RECORDED_LOADER_OPERATIONAL_BOUND_IDS.length ||
  RECORDED_LOADER_OPERATIONAL_BOUND_IDS.some(
    (boundId) => !(LOADER_OWNED_BOUND_IDS as readonly string[]).includes(boundId),
  )
) {
  throw new Error("recorded loader operational validators must cover exactly 33 owned bounds");
}
