import { z } from "zod";

import type { EventLog, StoredEvent } from "./event.js";
import { validateStoredEvent, verifyStoredEvent } from "./event.js";
import { canonicalHash, hashParts } from "./hash.js";
import {
  assertJson,
  assertJsonWithinLimits,
  assertSchemaPrototypeSafety,
  canonicalJson,
  cloneJson,
  deepFreezeJson,
  inertJsonSnapshot,
  parseJsonWithinLimits,
  type JsonLimits,
  type JsonObject,
  type JsonValue,
} from "./json.js";

export type RunKind = "live" | "replay" | "shadow" | "research" | "paper";

export type RunIdentities = Readonly<{
  extractorVersion: string;
  featureSetId: string | null;
  modelId: string | null;
  promptId: string | null;
  datasetId: string | null;
}>;

export type RunBehavior<TConfig extends JsonObject = JsonObject> = Readonly<{
  reducerName: string;
  reducerVersion: string;
  buildDigest: string;
  schemaRegistryDigest: string;
  configuration: TConfig;
  identities: RunIdentities;
}>;

export type RunManifest<TConfig extends JsonObject = JsonObject> = Readonly<{
  manifestVersion: 2;
  runId: string;
  kind: RunKind;
  effectsAllowed: boolean;
  canonicalizationVersion: "peas-json-v1";
  behavior: RunBehavior<TConfig>;
}>;

export type RunRegistration<TConfig extends JsonObject = JsonObject> = Readonly<{
  manifest: RunManifest<TConfig>;
  manifestHash: string;
  behaviorHash: string;
}>;

export type DecisionDraft = Readonly<{
  type: string;
  payload: JsonObject;
}>;

export type JobDraft = Readonly<{
  jobId: string;
  type: string;
  dedupeKey: string;
  notBeforeLogicalMs: number;
  inputBundleHash: string;
  payload: JsonObject;
}>;

export type OutboxDraft = Readonly<{
  messageId: string;
  topic: string;
  dedupeKey: string;
  payload: JsonObject;
}>;

export type Transition<TState extends JsonObject> = Readonly<{
  state: TState;
  decisions: readonly DecisionDraft[];
  jobs: readonly JobDraft[];
  outbox: readonly OutboxDraft[];
}>;

export type ReducerContext<TConfig extends JsonObject> = Readonly<{
  nowMs: number;
  runId: string;
  behaviorHash: string;
  identities: Readonly<RunIdentities>;
  config: Readonly<TConfig>;
  configHash: string;
}>;

export interface Reducer<TState extends JsonObject, TConfig extends JsonObject> {
  readonly name: string;
  readonly version: string;
  route(event: Readonly<StoredEvent>): string;
  parseState(value: unknown): TState;
  initialState(aggregateId: string, config: Readonly<TConfig>): TState;
  apply(
    state: Readonly<TState>,
    event: Readonly<StoredEvent>,
    context: ReducerContext<TConfig>,
  ): Transition<TState>;
}

export type OutputCategory = "decision" | "job" | "outbox";

export type ImmutableOutput = Readonly<{
  outputId: string;
  runId: string;
  inputEventId: string;
  inputPosition: string;
  aggregateId: string;
  category: OutputCategory;
  ordinal: number;
  dedupeKey: string | null;
  notBeforeLogicalMs: number | null;
  body: JsonObject;
  bodyHash: string;
}>;

export type StoredOutput = ImmutableOutput & Readonly<{ sequence: string }>;

export type RunCursor = Readonly<{
  runId: string;
  manifestHash: string;
  behaviorHash: string;
  processedPosition: string;
  logicalAtMs: number;
  lastEventHash: string;
  stateHead: string;
  decisionHead: string;
  cursorHash: string;
}>;

export type AggregateCheckpoint<TState extends JsonObject> = Readonly<{
  runId: string;
  aggregateId: string;
  version: string;
  lastInputPosition: string;
  state: TState;
  stateHash: string;
  checkpointHash: string;
}>;

export type ProcessingCommit<TState extends JsonObject> = Readonly<{
  expectedPosition: string;
  event: StoredEvent;
  cursor: RunCursor;
  aggregate: AggregateCheckpoint<TState>;
  outputs: readonly ImmutableOutput[];
}>;

export type OutputPage = Readonly<{
  outputs: readonly StoredOutput[];
  nextSequence: string;
  hasMore: boolean;
}>;

export type AggregatePage<TState extends JsonObject> = Readonly<{
  aggregates: readonly AggregateCheckpoint<TState>[];
  nextAggregateId: string;
  hasMore: boolean;
}>;

export interface ProcessingStore<TState extends JsonObject> {
  ensureRun(registration: RunRegistration): Promise<void>;
  loadCursor(runId: string): Promise<RunCursor | undefined>;
  loadAggregate(
    runId: string,
    aggregateId: string,
  ): Promise<AggregateCheckpoint<TState> | undefined>;
  commit(value: ProcessingCommit<TState>): Promise<void>;
  readOutputsAfter(runId: string, sequence: string, limit: number): Promise<OutputPage>;
  readAggregatesAfter(
    runId: string,
    aggregateId: string,
    limit: number,
  ): Promise<AggregatePage<TState>>;
}

const runKinds = new Set<RunKind>(["live", "replay", "shadow", "research", "paper"]);

const hashSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const nonEmptyStringSchema = z.string().min(1).max(512);
const jsonObjectSchema = z.custom<JsonObject>(
  (value) =>
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === null,
  "Expected an inert JSON object",
);
const runIdentitiesSchema = z
  .object({
    extractorVersion: z.string().min(1, "Extractor version cannot be empty").max(512),
    featureSetId: nonEmptyStringSchema.nullable(),
    modelId: nonEmptyStringSchema.nullable(),
    promptId: nonEmptyStringSchema.nullable(),
    datasetId: nonEmptyStringSchema.nullable(),
  })
  .strict();
const runBehaviorSchema = z
  .object({
    reducerName: nonEmptyStringSchema,
    reducerVersion: nonEmptyStringSchema,
    buildDigest: hashSchema,
    schemaRegistryDigest: hashSchema,
    configuration: jsonObjectSchema,
    identities: runIdentitiesSchema,
  })
  .strict();
const runManifestV2Schema = z
  .object({
    manifestVersion: z.literal(2),
    runId: nonEmptyStringSchema,
    kind: z.enum(["live", "replay", "shadow", "research", "paper"]),
    effectsAllowed: z.boolean(),
    canonicalizationVersion: z.literal("peas-json-v1"),
    behavior: runBehaviorSchema,
  })
  .strict();
const runRegistrationSchema = z
  .object({
    manifest: z.unknown(),
    manifestHash: hashSchema,
    behaviorHash: hashSchema,
  })
  .strict();
const safeNonnegativeIntegerSchema = z.number().int().nonnegative().safe();
const positiveDecimalSchema = z.string().regex(/^[1-9]\d*$/u);
const nonnegativeDecimalSchema = z.string().regex(/^(?:0|[1-9]\d*)$/u);
const aggregateIdSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9._:-]+$/u, "Aggregate ID must use the portable ASCII identifier alphabet");
const decisionBodySchema = z
  .object({
    type: nonEmptyStringSchema,
    payload: jsonObjectSchema,
  })
  .strict();
const jobBodySchema = z
  .object({
    jobId: hashSchema,
    type: nonEmptyStringSchema,
    dedupeKey: nonEmptyStringSchema,
    notBeforeLogicalMs: safeNonnegativeIntegerSchema,
    inputBundleHash: hashSchema,
    payload: jsonObjectSchema,
  })
  .strict();
const outboxBodySchema = z
  .object({
    messageId: hashSchema,
    topic: nonEmptyStringSchema,
    dedupeKey: nonEmptyStringSchema,
    payload: jsonObjectSchema,
  })
  .strict();
const outputCommonShape = {
  outputId: hashSchema,
  runId: nonEmptyStringSchema,
  inputEventId: hashSchema,
  inputPosition: positiveDecimalSchema,
  aggregateId: aggregateIdSchema,
  ordinal: safeNonnegativeIntegerSchema,
  bodyHash: hashSchema,
} as const;
const decisionOutputSchema = z
  .object({
    ...outputCommonShape,
    category: z.literal("decision"),
    dedupeKey: z.null(),
    notBeforeLogicalMs: z.null(),
    body: decisionBodySchema,
  })
  .strict();
const jobOutputSchema = z
  .object({
    ...outputCommonShape,
    category: z.literal("job"),
    dedupeKey: nonEmptyStringSchema,
    notBeforeLogicalMs: safeNonnegativeIntegerSchema,
    body: jobBodySchema,
  })
  .strict();
const outboxOutputSchema = z
  .object({
    ...outputCommonShape,
    category: z.literal("outbox"),
    dedupeKey: nonEmptyStringSchema,
    notBeforeLogicalMs: z.null(),
    body: outboxBodySchema,
  })
  .strict();
const immutableOutputSchema = z.discriminatedUnion("category", [
  decisionOutputSchema,
  jobOutputSchema,
  outboxOutputSchema,
]);
const storedOutputSchema = z.discriminatedUnion("category", [
  decisionOutputSchema.extend({ sequence: positiveDecimalSchema }).strict(),
  jobOutputSchema.extend({ sequence: positiveDecimalSchema }).strict(),
  outboxOutputSchema.extend({ sequence: positiveDecimalSchema }).strict(),
]);
const runCursorSchema = z
  .object({
    runId: nonEmptyStringSchema,
    manifestHash: hashSchema,
    behaviorHash: hashSchema,
    processedPosition: nonnegativeDecimalSchema,
    logicalAtMs: safeNonnegativeIntegerSchema,
    lastEventHash: hashSchema,
    stateHead: hashSchema,
    decisionHead: hashSchema,
    cursorHash: hashSchema,
  })
  .strict();
const aggregateCheckpointSchema = z
  .object({
    runId: nonEmptyStringSchema,
    aggregateId: aggregateIdSchema,
    version: nonnegativeDecimalSchema,
    lastInputPosition: nonnegativeDecimalSchema,
    state: jsonObjectSchema,
    stateHash: hashSchema,
    checkpointHash: hashSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.version === "0") !== (value.lastInputPosition === "0")) {
      context.addIssue({
        code: "custom",
        path: ["version"],
        message: "Aggregate checkpoint must be exact 0/0 genesis or positive/positive",
      });
    }
  });
const committedAggregateCheckpointSchema = aggregateCheckpointSchema
  .safeExtend({
    version: positiveDecimalSchema,
    lastInputPosition: positiveDecimalSchema,
  })
  .strict();
const processingCommitSchema = z
  .object({
    expectedPosition: nonnegativeDecimalSchema,
    event: z.unknown(),
    cursor: runCursorSchema,
    aggregate: committedAggregateCheckpointSchema,
    outputs: z.array(immutableOutputSchema).max(100_000),
  })
  .strict();
const PROCESSOR_SCHEMA_FIELDS = Object.freeze([
  "extractorVersion",
  "featureSetId",
  "modelId",
  "promptId",
  "datasetId",
  "reducerName",
  "reducerVersion",
  "buildDigest",
  "schemaRegistryDigest",
  "configuration",
  "identities",
  "manifestVersion",
  "runId",
  "kind",
  "effectsAllowed",
  "canonicalizationVersion",
  "behavior",
  "manifest",
  "manifestHash",
  "behaviorHash",
  "type",
  "payload",
  "jobId",
  "dedupeKey",
  "notBeforeLogicalMs",
  "inputBundleHash",
  "messageId",
  "topic",
  "outputId",
  "inputEventId",
  "inputPosition",
  "aggregateId",
  "ordinal",
  "bodyHash",
  "category",
  "body",
  "sequence",
  "processedPosition",
  "logicalAtMs",
  "lastEventHash",
  "stateHead",
  "decisionHead",
  "cursorHash",
  "version",
  "lastInputPosition",
  "state",
  "stateHash",
  "checkpointHash",
  "expectedPosition",
  "event",
  "cursor",
  "aggregate",
  "outputs",
]);

function processorSchemaSnapshot(value: unknown): JsonValue {
  assertSchemaPrototypeSafety(PROCESSOR_SCHEMA_FIELDS);
  return inertJsonSnapshot(value as JsonValue);
}
const RUN_CONFIGURATION_LIMITS = Object.freeze({
  maxDepth: 32,
  maxNodes: 50_000,
  maxArrayLength: 10_000,
  maxObjectKeys: 10_000,
  maxStringBytes: 1_048_576,
  maxCanonicalBytes: 1_048_576,
}) satisfies JsonLimits;
const RUN_MANIFEST_LIMITS = Object.freeze({
  maxDepth: RUN_CONFIGURATION_LIMITS.maxDepth + 2,
  maxNodes: RUN_CONFIGURATION_LIMITS.maxNodes + 64,
  maxArrayLength: RUN_CONFIGURATION_LIMITS.maxArrayLength,
  maxObjectKeys: RUN_CONFIGURATION_LIMITS.maxObjectKeys,
  maxStringBytes: RUN_CONFIGURATION_LIMITS.maxStringBytes,
  maxCanonicalBytes: RUN_CONFIGURATION_LIMITS.maxCanonicalBytes + 16_384,
}) satisfies JsonLimits;
export const RUN_MANIFEST_SERIALIZED_LIMIT_BYTES = RUN_MANIFEST_LIMITS.maxCanonicalBytes;
const RUN_REGISTRATION_LIMITS = Object.freeze({
  ...RUN_MANIFEST_LIMITS,
  maxDepth: RUN_CONFIGURATION_LIMITS.maxDepth + 3,
  maxNodes: RUN_CONFIGURATION_LIMITS.maxNodes + 72,
  maxCanonicalBytes: RUN_CONFIGURATION_LIMITS.maxCanonicalBytes + 17_408,
}) satisfies JsonLimits;

/** Shared write/read budget for persisted aggregate state and processing-output bodies. */
export const PERSISTED_PROCESSING_JSON_LIMITS = Object.freeze({
  maxDepth: 64,
  maxNodes: 500_000,
  maxArrayLength: 100_000,
  maxObjectKeys: 100_000,
  maxStringBytes: 4 * 1_048_576,
  maxCanonicalBytes: 16 * 1_048_576,
}) satisfies JsonLimits;
const PERSISTED_PROCESSING_COMMIT_LIMITS = Object.freeze({
  maxDepth: PERSISTED_PROCESSING_JSON_LIMITS.maxDepth + 3,
  maxNodes: 1_000_000,
  maxArrayLength: PERSISTED_PROCESSING_JSON_LIMITS.maxArrayLength,
  maxObjectKeys: PERSISTED_PROCESSING_JSON_LIMITS.maxObjectKeys,
  maxStringBytes: PERSISTED_PROCESSING_JSON_LIMITS.maxStringBytes,
  maxCanonicalBytes: 64 * 1_048_576,
}) satisfies JsonLimits;

function snapshotRunManifestWithinLimits(value: unknown): JsonValue {
  assertJsonWithinLimits(value, RUN_MANIFEST_LIMITS, "$.manifest");
  const snapshot = processorSchemaSnapshot(value);
  if (snapshot === null || typeof snapshot !== "object" || Array.isArray(snapshot)) return snapshot;
  const behavior = (snapshot as Record<string, unknown>)["behavior"];
  if (behavior === null || typeof behavior !== "object" || Array.isArray(behavior)) return snapshot;
  if (!Object.hasOwn(behavior, "configuration")) return snapshot;
  assertJsonWithinLimits(
    (behavior as Record<string, unknown>)["configuration"],
    RUN_CONFIGURATION_LIMITS,
    "$.behavior.configuration",
  );
  return snapshot;
}

/** Strictly validates the complete supported run-manifest contract at runtime. */
export function validateRunManifest<TConfig extends JsonObject = JsonObject>(
  value: unknown,
): RunManifest<TConfig> {
  const snapshot = snapshotRunManifestWithinLimits(value);
  const parsed = runManifestV2Schema.parse(snapshot);
  assertJsonWithinLimits(
    parsed.behavior.configuration,
    RUN_CONFIGURATION_LIMITS,
    "$.behavior.configuration",
  );
  assertJson(parsed);
  return cloneJson(parsed as unknown as JsonValue) as RunManifest<TConfig>;
}

export function validateRunManifestJson<TConfig extends JsonObject = JsonObject>(
  serialized: string,
): RunManifest<TConfig> {
  return validateRunManifest<TConfig>(
    parseJsonWithinLimits(serialized, RUN_MANIFEST_LIMITS, "$.manifest"),
  );
}

/** Derives, rather than accepts, the immutable identity hashes for a valid V2 manifest. */
export function deriveRunRegistration<TConfig extends JsonObject = JsonObject>(
  value: unknown,
): RunRegistration<TConfig> {
  const manifest = validateRunManifest<TConfig>(value);
  assertRunEffectPolicy(manifest);
  return {
    manifest,
    manifestHash: canonicalHash("peas/run-manifest/v2", manifest),
    behaviorHash: canonicalHash("peas/run-behavior/v2", manifest.behavior),
  };
}

/** Recomputes and verifies caller-supplied registration hashes at a persistence boundary. */
export function validateRunRegistration<TConfig extends JsonObject = JsonObject>(
  value: unknown,
): RunRegistration<TConfig> {
  assertJsonWithinLimits(value, RUN_REGISTRATION_LIMITS, "$.registration");
  const parsed = runRegistrationSchema.parse(processorSchemaSnapshot(value));
  const derived = deriveRunRegistration<TConfig>(parsed.manifest);
  if (parsed.manifestHash !== derived.manifestHash) {
    throw new Error("Run manifest hash mismatch");
  }
  if (parsed.behaviorHash !== derived.behaviorHash) {
    throw new Error("Run behavior hash mismatch");
  }
  return derived;
}

/** Rejects active or pathologically large commit envelopes before adapters inspect any field. */
export function assertProcessingCommitEnvelope(value: unknown): void {
  assertJsonWithinLimits(value, PERSISTED_PROCESSING_COMMIT_LIMITS, "$.processingCommit");
}

export function validateAggregateId(value: unknown): string {
  return aggregateIdSchema.parse(value);
}

export function validateRunCursor(value: unknown): RunCursor {
  assertJsonWithinLimits(value, PERSISTED_PROCESSING_JSON_LIMITS, "$.runCursor");
  const parsed = runCursorSchema.parse(processorSchemaSnapshot(value));
  return cloneJson(parsed as unknown as JsonValue) as RunCursor;
}

export function validateAggregateCheckpoint<TState extends JsonObject = JsonObject>(
  value: unknown,
): AggregateCheckpoint<TState> {
  assertJsonWithinLimits(value, PERSISTED_PROCESSING_JSON_LIMITS, "$.aggregateCheckpoint");
  const parsed = aggregateCheckpointSchema.parse(processorSchemaSnapshot(value));
  return cloneJson(parsed as unknown as JsonValue) as AggregateCheckpoint<TState>;
}

export function validateCommittedAggregateCheckpoint<TState extends JsonObject = JsonObject>(
  value: unknown,
): AggregateCheckpoint<TState> {
  assertJsonWithinLimits(value, PERSISTED_PROCESSING_JSON_LIMITS, "$.aggregateCheckpoint");
  const parsed = committedAggregateCheckpointSchema.parse(processorSchemaSnapshot(value));
  return cloneJson(parsed as unknown as JsonValue) as AggregateCheckpoint<TState>;
}

export type StoredOutputBodyMetadata = Readonly<{
  runId: string;
  dedupeKey: string | null;
  notBeforeLogicalMs: number | null;
}>;

/** Strict category-specific body validation shared by commits, audit reads, and claims. */
export function validateStoredOutputBody(
  category: OutputCategory,
  value: unknown,
  metadata: StoredOutputBodyMetadata,
): JsonObject {
  assertJsonWithinLimits(value, PERSISTED_PROCESSING_JSON_LIMITS, `$.output.${category}.body`);
  nonEmptyStringSchema.parse(metadata.runId);
  if (category === "decision") {
    if (metadata.dedupeKey !== null || metadata.notBeforeLogicalMs !== null) {
      throw new Error("Decision output has operational delivery metadata");
    }
    const body = decisionBodySchema.parse(processorSchemaSnapshot(value));
    return cloneJson(body as unknown as JsonValue) as JsonObject;
  }
  if (category === "job") {
    if (metadata.dedupeKey === null || metadata.notBeforeLogicalMs === null) {
      throw new Error("Job output requires dedupe and scheduling metadata");
    }
    const body = jobBodySchema.parse(processorSchemaSnapshot(value));
    if (body.dedupeKey !== metadata.dedupeKey) {
      throw new Error("Output dedupe metadata mismatch");
    }
    if (body.notBeforeLogicalMs !== metadata.notBeforeLogicalMs) {
      throw new Error("Job not-before metadata mismatch");
    }
    if (
      body.jobId !==
      deriveJobId(metadata.runId, body.dedupeKey, body.payload as unknown as JsonObject)
    ) {
      throw new Error("Job ID integrity mismatch");
    }
    return cloneJson(body as unknown as JsonValue) as JsonObject;
  }
  if (category !== "outbox") {
    throw new TypeError(`Unsupported output category ${String(category)}`);
  }
  if (metadata.dedupeKey === null || metadata.notBeforeLogicalMs !== null) {
    throw new Error("Outbox output delivery metadata mismatch");
  }
  const body = outboxBodySchema.parse(processorSchemaSnapshot(value));
  if (body.dedupeKey !== metadata.dedupeKey) {
    throw new Error("Output dedupe metadata mismatch");
  }
  if (
    body.messageId !==
    deriveMessageId(metadata.runId, body.dedupeKey, body.payload as unknown as JsonObject)
  ) {
    throw new Error("Message ID integrity mismatch");
  }
  return cloneJson(body as unknown as JsonValue) as JsonObject;
}

export function validateImmutableOutput(value: unknown): ImmutableOutput {
  assertJsonWithinLimits(value, PERSISTED_PROCESSING_JSON_LIMITS, "$.immutableOutput");
  const parsed = immutableOutputSchema.parse(processorSchemaSnapshot(value));
  const body = validateStoredOutputBody(parsed.category, parsed.body, {
    runId: parsed.runId,
    dedupeKey: parsed.dedupeKey,
    notBeforeLogicalMs: parsed.notBeforeLogicalMs,
  });
  return cloneJson({ ...parsed, body } as unknown as JsonValue) as ImmutableOutput;
}

export function validateStoredOutput(value: unknown): StoredOutput {
  assertJsonWithinLimits(value, PERSISTED_PROCESSING_JSON_LIMITS, "$.storedOutput");
  const parsed = storedOutputSchema.parse(processorSchemaSnapshot(value));
  const body = validateStoredOutputBody(parsed.category, parsed.body, {
    runId: parsed.runId,
    dedupeKey: parsed.dedupeKey,
    notBeforeLogicalMs: parsed.notBeforeLogicalMs,
  });
  return cloneJson({ ...parsed, body } as unknown as JsonValue) as StoredOutput;
}

/** Creates the only canonical snapshot that may be verified and persisted by a store. */
export function validateProcessingCommit<TState extends JsonObject = JsonObject>(
  value: unknown,
): ProcessingCommit<TState> {
  assertProcessingCommitEnvelope(value);
  const schemaValue = processorSchemaSnapshot(value);
  if (schemaValue !== null && typeof schemaValue === "object" && !Array.isArray(schemaValue)) {
    const candidates = (schemaValue as Record<string, unknown>)["outputs"];
    if (Array.isArray(candidates)) {
      for (const candidate of candidates) {
        if (candidate !== null && typeof candidate === "object" && !Array.isArray(candidate)) {
          const category = (candidate as Record<string, unknown>)["category"];
          if (category !== "decision" && category !== "job" && category !== "outbox") {
            throw new TypeError(`Unsupported output category ${String(category)}`);
          }
        }
      }
    }
  }
  const parsed = processingCommitSchema.parse(schemaValue);
  const snapshot = {
    expectedPosition: parsed.expectedPosition,
    event: validateStoredEvent(parsed.event),
    cursor: validateRunCursor(parsed.cursor),
    aggregate: validateAggregateCheckpoint<TState>(parsed.aggregate),
    outputs: parsed.outputs.map((output) => validateImmutableOutput(output)),
  } satisfies ProcessingCommit<TState>;
  return cloneJson(snapshot as unknown as JsonValue) as ProcessingCommit<TState>;
}

export function computeOutputDedupeIdentity(
  runId: string,
  category: Exclude<OutputCategory, "decision">,
  dedupeKey: string,
): string {
  return canonicalHash("peas/output-dedupe-identity/v2", { runId, category, dedupeKey });
}

export function assertRunEffectPolicy(manifest: RunManifest): void {
  if (!runKinds.has(manifest.kind)) throw new TypeError(`Unsupported run kind ${manifest.kind}`);
  if (typeof manifest.effectsAllowed !== "boolean") {
    throw new TypeError("Run effectsAllowed must be a boolean");
  }
  if (manifest.effectsAllowed && manifest.kind !== "live") {
    throw new Error(`Run kind ${manifest.kind} cannot dispatch external effects`);
  }
}

export function deriveJobId(runId: string, dedupeKey: string, payload: JsonObject): string {
  return canonicalHash("peas/job-id/v2", {
    runId,
    dedupeKey,
    payloadHash: canonicalHash("peas/job-payload/v2", payload),
  });
}

export function deriveMessageId(runId: string, dedupeKey: string, payload: JsonObject): string {
  return canonicalHash("peas/message-id/v2", {
    runId,
    dedupeKey,
    payloadHash: canonicalHash("peas/outbox-payload/v2", payload),
  });
}

export function computeRunCursorHash(cursor: Omit<RunCursor, "cursorHash">): string {
  return canonicalHash("peas/run-cursor/v2", {
    runId: cursor.runId,
    manifestHash: cursor.manifestHash,
    behaviorHash: cursor.behaviorHash,
    processedPosition: cursor.processedPosition,
    logicalAtMs: cursor.logicalAtMs,
    lastEventHash: cursor.lastEventHash,
    stateHead: cursor.stateHead,
    decisionHead: cursor.decisionHead,
  });
}

export function computeAggregateCheckpointHash<TState extends JsonObject>(
  checkpoint: Omit<AggregateCheckpoint<TState>, "checkpointHash">,
): string {
  return canonicalHash("peas/aggregate-checkpoint/v2", {
    runId: checkpoint.runId,
    aggregateId: checkpoint.aggregateId,
    version: checkpoint.version,
    lastInputPosition: checkpoint.lastInputPosition,
    stateHash: checkpoint.stateHash,
  });
}

export function createGenesisRunCursor(registration: RunRegistration): RunCursor {
  const withoutHash = {
    runId: registration.manifest.runId,
    manifestHash: registration.manifestHash,
    behaviorHash: registration.behaviorHash,
    processedPosition: "0",
    logicalAtMs: 0,
    lastEventHash: "0".repeat(64),
    stateHead: hashParts("peas/state-head/genesis/v2", registration.behaviorHash),
    decisionHead: hashParts("peas/decision-head/genesis/v2", registration.behaviorHash),
  } satisfies Omit<RunCursor, "cursorHash">;
  return { ...withoutHash, cursorHash: computeRunCursorHash(withoutHash) };
}

function requiredObject(value: JsonValue | undefined, label: string): JsonObject {
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a JSON object`);
  }
  return value as JsonObject;
}

function requiredString(value: JsonValue | undefined, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string`);
  }
  return value;
}

export function verifyProcessingCommit<TState extends JsonObject>(
  value: ProcessingCommit<TState>,
  registration: RunRegistration,
): ProcessingCommit<TState> {
  value = validateProcessingCommit<TState>(value);
  verifyStoredEvent(value.event);
  const { cursorHash, ...cursorWithoutHash } = value.cursor;
  if (cursorHash !== computeRunCursorHash(cursorWithoutHash)) {
    throw new Error("Run cursor hash mismatch in commit");
  }
  if (
    value.cursor.runId !== registration.manifest.runId ||
    value.cursor.manifestHash !== registration.manifestHash ||
    value.cursor.behaviorHash !== registration.behaviorHash
  ) {
    throw new Error("Commit cursor does not match its immutable run manifest");
  }
  if (
    value.cursor.processedPosition !== value.event.position ||
    value.cursor.logicalAtMs !== value.event.logicalAtMs ||
    value.cursor.lastEventHash !== value.event.eventHash
  ) {
    throw new Error("Commit cursor does not match its input event");
  }

  const { checkpointHash, ...checkpointWithoutHash } = value.aggregate;
  if (checkpointHash !== computeAggregateCheckpointHash(checkpointWithoutHash)) {
    throw new Error("Aggregate checkpoint hash mismatch in commit");
  }
  if (
    value.aggregate.runId !== value.cursor.runId ||
    value.aggregate.lastInputPosition !== value.event.position
  ) {
    throw new Error("Aggregate checkpoint does not match its input event or run");
  }
  requiredString(value.aggregate.aggregateId, "Aggregate ID");
  if (typeof value.aggregate.version !== "string" || !/^[1-9]\d*$/u.test(value.aggregate.version)) {
    throw new TypeError("Aggregate version must be a canonical positive decimal integer");
  }
  requiredObject(value.aggregate.state, "Aggregate state");
  assertJsonWithinLimits(
    value.aggregate.state,
    PERSISTED_PROCESSING_JSON_LIMITS,
    "$.aggregate.state",
  );
  const expectedStateHash = canonicalHash(
    `peas/state/${registration.manifest.behavior.reducerName}/${registration.manifest.behavior.reducerVersion}`,
    value.aggregate.state,
  );
  if (value.aggregate.stateHash !== expectedStateHash) {
    throw new Error("Aggregate state hash mismatch in commit");
  }

  if (!Array.isArray(value.outputs)) throw new TypeError("Commit outputs must be an array");
  const categoryRanks = new Map<OutputCategory, number>([
    ["decision", 0],
    ["job", 1],
    ["outbox", 2],
  ]);
  const nextOrdinals = [0, 0, 0];
  const outputIds = new Set<string>();
  const dedupeIdentities = new Set<string>();
  let previousCategoryRank = -1;

  for (const output of value.outputs) {
    if (
      output.category !== "decision" &&
      output.category !== "job" &&
      output.category !== "outbox"
    ) {
      throw new TypeError(`Unsupported output category ${String(output.category)}`);
    }
    const categoryRank = categoryRanks.get(output.category);
    if (categoryRank === undefined) throw new TypeError("Unsupported output category");
    if (!Number.isSafeInteger(output.ordinal) || output.ordinal < 0) {
      throw new RangeError("Output ordinal must be a non-negative safe integer");
    }
    if (categoryRank < previousCategoryRank) {
      throw new Error("Outputs are not in canonical decision, job, outbox category order");
    }
    previousCategoryRank = categoryRank;
    if (outputIds.has(output.outputId)) {
      throw new Error(`Duplicate output ID ${output.outputId} in commit`);
    }
    outputIds.add(output.outputId);
    const expectedOrdinal = nextOrdinals[categoryRank];
    if (expectedOrdinal === undefined || output.ordinal !== expectedOrdinal) {
      throw new Error(
        `Non-contiguous ${output.category} output ordinal: expected ${String(expectedOrdinal)}, received ${output.ordinal}`,
      );
    }
    nextOrdinals[categoryRank] = expectedOrdinal + 1;

    if (
      output.runId !== value.cursor.runId ||
      output.inputEventId !== value.event.eventId ||
      output.inputPosition !== value.event.position ||
      output.aggregateId !== value.aggregate.aggregateId
    ) {
      throw new Error("Output metadata does not match its input event, aggregate, or run");
    }
    requiredObject(output.body, "Output body");
    assertJsonWithinLimits(
      output.body,
      PERSISTED_PROCESSING_JSON_LIMITS,
      `$.outputs[${output.category}:${output.ordinal}].body`,
    );
    const expectedBodyHash = canonicalHash(`peas/output-body/${output.category}/v2`, output.body);
    if (output.bodyHash !== expectedBodyHash) throw new Error("Output body hash mismatch");
    const expectedOutputId = canonicalHash("peas/output-id/v2", {
      runId: output.runId,
      manifestHash: registration.manifestHash,
      inputEventHash: value.event.eventHash,
      aggregateId: output.aggregateId,
      category: output.category,
      ordinal: output.ordinal,
      bodyHash: output.bodyHash,
    });
    if (output.outputId !== expectedOutputId) throw new Error("Output ID integrity mismatch");

    const body = validateStoredOutputBody(output.category, output.body, {
      runId: output.runId,
      dedupeKey: output.dedupeKey,
      notBeforeLogicalMs: output.notBeforeLogicalMs,
    });
    if (output.category === "decision") {
      continue;
    }
    const bodyDedupeKey = requiredString(body["dedupeKey"], "Output dedupe key");
    const dedupeIdentity = computeOutputDedupeIdentity(
      output.runId,
      output.category,
      bodyDedupeKey,
    );
    if (dedupeIdentities.has(dedupeIdentity)) {
      throw new Error(`Duplicate ${output.category} dedupe key in commit`);
    }
    dedupeIdentities.add(dedupeIdentity);
    if (output.category === "job") {
      requiredString(body["jobId"], "Job ID");
      requiredString(body["type"], "Job type");
      requiredString(body["inputBundleHash"], "Input bundle hash");
      continue;
    }
    requiredString(body["topic"], "Outbox topic");
    requiredString(body["messageId"], "Message ID");
  }
  return value;
}

/** Binds a commit to the complete cursor that immediately precedes it. */
export function verifyProcessingTransition<TState extends JsonObject>(
  value: ProcessingCommit<TState>,
  registration: RunRegistration,
  previous: RunCursor,
): ProcessingCommit<TState> {
  value = verifyProcessingCommit(value, registration);
  previous = validateRunCursor(previous);

  const { cursorHash: previousCursorHash, ...previousWithoutHash } = previous;
  if (previousCursorHash !== computeRunCursorHash(previousWithoutHash)) {
    throw new Error("Prior run cursor hash mismatch in commit");
  }
  if (
    previous.runId !== registration.manifest.runId ||
    previous.manifestHash !== registration.manifestHash ||
    previous.behaviorHash !== registration.behaviorHash
  ) {
    throw new Error("Prior cursor does not match its immutable run manifest");
  }
  if (previous.processedPosition === "0") {
    const genesis = createGenesisRunCursor(registration);
    if (canonicalJson(previous as unknown as JsonValue) !== canonicalJson(genesis)) {
      throw new Error("Prior cursor is not the canonical run genesis");
    }
  }
  if (value.expectedPosition !== previous.processedPosition) {
    throw new Error("Commit expected position does not match the prior cursor");
  }
  const expectedEventPosition = BigInt(previous.processedPosition) + 1n;
  if (BigInt(value.event.position) !== expectedEventPosition) {
    throw new Error(
      `Non-contiguous processing position: expected ${expectedEventPosition}, received ${value.event.position}`,
    );
  }
  if (value.event.previousEventHash !== previous.lastEventHash) {
    throw new Error(`Event chain mismatch at position ${value.event.position}`);
  }
  if (value.event.logicalAtMs < previous.logicalAtMs) {
    throw new Error(`Logical clock regression at event position ${value.event.position}`);
  }

  const expectedStateHead = hashParts(
    "peas/state-head/step/v2",
    previous.stateHead,
    value.event.eventHash,
    value.aggregate.aggregateId,
    value.aggregate.stateHash,
  );
  if (value.cursor.stateHead !== expectedStateHead) {
    throw new Error("Run state head is not derived from the prior cursor");
  }
  const semanticOutputs = value.outputs.map(({ category, ordinal, body, bodyHash }) => ({
    category,
    ordinal,
    body,
    bodyHash,
  }));
  const expectedDecisionHead = hashParts(
    "peas/decision-head/step/v2",
    previous.decisionHead,
    value.event.eventHash,
    canonicalJson(semanticOutputs as unknown as JsonValue),
  );
  if (value.cursor.decisionHead !== expectedDecisionHead) {
    throw new Error("Run decision head is not derived from the prior cursor");
  }
  return value;
}

function assertNonEmpty(value: string, label: string): void {
  if (value.length === 0) throw new TypeError(`${label} cannot be empty`);
}

function assertHash(value: string, label: string): void {
  if (!/^[0-9a-f]{64}$/u.test(value)) throw new TypeError(`${label} must be a SHA-256 hex digest`);
}

function assertLogicalMs(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
}

function assertPageLimit(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
    throw new RangeError("Page limit must be an integer between 1 and 10,000");
  }
}

function outputBody(
  category: OutputCategory,
  draft: DecisionDraft | JobDraft | OutboxDraft,
  runId: string,
): Readonly<{
  body: JsonObject;
  dedupeKey: string | null;
  notBeforeLogicalMs: number | null;
}> {
  if (category === "decision") {
    const decision = draft as DecisionDraft;
    assertNonEmpty(decision.type, "Decision type");
    assertJsonWithinLimits(
      decision.payload,
      PERSISTED_PROCESSING_JSON_LIMITS,
      "$.decision.payload",
    );
    return {
      body: { type: decision.type, payload: decision.payload },
      dedupeKey: null,
      notBeforeLogicalMs: null,
    };
  }
  if (category === "job") {
    const job = draft as JobDraft;
    assertNonEmpty(job.type, "Job type");
    assertNonEmpty(job.dedupeKey, "Job dedupe key");
    assertHash(job.inputBundleHash, "Job input bundle hash");
    assertLogicalMs(job.notBeforeLogicalMs, "Job not-before time");
    assertJsonWithinLimits(job.payload, PERSISTED_PROCESSING_JSON_LIMITS, "$.job.payload");
    const expectedJobId = deriveJobId(runId, job.dedupeKey, job.payload);
    if (job.jobId !== expectedJobId) throw new Error(`Invalid deterministic job ID ${job.jobId}`);
    return {
      body: {
        jobId: job.jobId,
        type: job.type,
        dedupeKey: job.dedupeKey,
        notBeforeLogicalMs: job.notBeforeLogicalMs,
        inputBundleHash: job.inputBundleHash,
        payload: job.payload,
      },
      dedupeKey: job.dedupeKey,
      notBeforeLogicalMs: job.notBeforeLogicalMs,
    };
  }

  const outbox = draft as OutboxDraft;
  assertNonEmpty(outbox.topic, "Outbox topic");
  assertNonEmpty(outbox.dedupeKey, "Outbox dedupe key");
  assertJsonWithinLimits(outbox.payload, PERSISTED_PROCESSING_JSON_LIMITS, "$.outbox.payload");
  const expectedMessageId = deriveMessageId(runId, outbox.dedupeKey, outbox.payload);
  if (outbox.messageId !== expectedMessageId) {
    throw new Error(`Invalid deterministic message ID ${outbox.messageId}`);
  }
  return {
    body: {
      messageId: outbox.messageId,
      topic: outbox.topic,
      dedupeKey: outbox.dedupeKey,
      payload: outbox.payload,
    },
    dedupeKey: outbox.dedupeKey,
    notBeforeLogicalMs: null,
  };
}

export class DeterministicProcessor<TState extends JsonObject, TConfig extends JsonObject> {
  readonly #reducer: Reducer<TState, TConfig>;
  readonly #store: ProcessingStore<TState>;
  readonly #eventLog: EventLog;
  readonly #registration: RunRegistration<TConfig>;
  readonly #configHash: string;
  #initialized = false;

  constructor(options: {
    reducer: Reducer<TState, TConfig>;
    store: ProcessingStore<TState>;
    eventLog: EventLog;
    manifest: RunManifest<TConfig>;
  }) {
    this.#reducer = options.reducer;
    this.#store = options.store;
    this.#eventLog = options.eventLog;
    const registration = deriveRunRegistration<TConfig>(options.manifest);
    const manifest = registration.manifest;
    if (manifest.behavior.reducerName !== options.reducer.name) {
      throw new Error("Manifest reducer name does not match the reducer");
    }
    if (manifest.behavior.reducerVersion !== options.reducer.version) {
      throw new Error("Manifest reducer version does not match the reducer");
    }
    assertNonEmpty(manifest.runId, "Run ID");
    assertNonEmpty(manifest.behavior.identities.extractorVersion, "Extractor version");
    for (const [name, identity] of Object.entries(manifest.behavior.identities)) {
      if (identity !== null) assertNonEmpty(identity, `Run identity ${name}`);
    }
    assertHash(manifest.behavior.buildDigest, "Build digest");
    assertHash(manifest.behavior.schemaRegistryDigest, "Schema registry digest");
    this.#registration = registration;
    this.#configHash = canonicalHash("peas/reducer-config/v2", manifest.behavior.configuration);
  }

  get registration(): RunRegistration<TConfig> {
    return cloneJson(this.#registration as unknown as JsonValue) as RunRegistration<TConfig>;
  }

  async process(event: StoredEvent): Promise<RunCursor> {
    await this.#initialize();
    event = validateStoredEvent(event);
    verifyStoredEvent(event);
    let previous =
      (await this.#store.loadCursor(this.#registration.manifest.runId)) ?? this.#genesis();
    previous = this.#verifyCursor(previous);

    const currentPosition = BigInt(event.position);
    const previousPosition = BigInt(previous.processedPosition);
    if (currentPosition <= previousPosition) {
      const expectedPreviousHash = await this.#persistedPredecessorHash(currentPosition);
      await this.#verifyExactPersistedEvent(event, expectedPreviousHash);
      await this.#verifyProcessedSuffix(currentPosition, event.eventHash, previous);
      return previous;
    }
    if (currentPosition !== previousPosition + 1n) {
      throw new Error(
        `Non-contiguous processing position: expected ${previousPosition + 1n}, received ${currentPosition}`,
      );
    }
    await this.#verifyExactPersistedEvent(event, previous.lastEventHash);
    if (event.logicalAtMs < previous.logicalAtMs) {
      throw new Error(`Logical clock regression at event position ${event.position}`);
    }

    const aggregateId = validateAggregateId(this.#reducer.route(event));
    const priorAggregate =
      (await this.#store.loadAggregate(this.#registration.manifest.runId, aggregateId)) ??
      this.#aggregateGenesis(aggregateId);
    const parsedPriorState = this.#verifyAggregate(priorAggregate);
    const transition = this.#reducer.apply(deepFreezeJson(cloneJson(parsedPriorState)), event, {
      nowMs: event.logicalAtMs,
      runId: this.#registration.manifest.runId,
      behaviorHash: this.#registration.behaviorHash,
      identities: deepFreezeJson(
        cloneJson(this.#registration.manifest.behavior.identities as unknown as JsonValue),
      ) as Readonly<RunIdentities>,
      config: deepFreezeJson(cloneJson(this.#registration.manifest.behavior.configuration)),
      configHash: this.#configHash,
    });
    assertJsonWithinLimits(
      transition.state,
      PERSISTED_PROCESSING_JSON_LIMITS,
      "$.aggregate.transitionState",
    );
    const nextState = this.#reducer.parseState(transition.state);
    requiredObject(nextState, "Aggregate state");
    assertJsonWithinLimits(nextState, PERSISTED_PROCESSING_JSON_LIMITS, "$.aggregate.state");
    assertJson(nextState);
    const canonicalState = cloneJson(nextState);
    const stateHash = canonicalHash(
      `peas/state/${this.#reducer.name}/${this.#reducer.version}`,
      canonicalState,
    );
    const aggregateWithoutHash = {
      runId: this.#registration.manifest.runId,
      aggregateId,
      version: (BigInt(priorAggregate.version) + 1n).toString(),
      lastInputPosition: event.position,
      state: canonicalState,
      stateHash,
    } satisfies Omit<AggregateCheckpoint<TState>, "checkpointHash">;
    const aggregate: AggregateCheckpoint<TState> = {
      ...aggregateWithoutHash,
      checkpointHash: computeAggregateCheckpointHash(aggregateWithoutHash),
    };
    const outputs = this.#materialize(event, aggregateId, transition);
    const semanticOutputs = outputs.map(({ category, ordinal, body, bodyHash }) => ({
      category,
      ordinal,
      body,
      bodyHash,
    }));
    const cursorWithoutHash = {
      runId: this.#registration.manifest.runId,
      manifestHash: this.#registration.manifestHash,
      behaviorHash: this.#registration.behaviorHash,
      processedPosition: event.position,
      logicalAtMs: event.logicalAtMs,
      lastEventHash: event.eventHash,
      stateHead: hashParts(
        "peas/state-head/step/v2",
        previous.stateHead,
        event.eventHash,
        aggregateId,
        aggregate.stateHash,
      ),
      decisionHead: hashParts(
        "peas/decision-head/step/v2",
        previous.decisionHead,
        event.eventHash,
        canonicalJson(semanticOutputs as unknown as JsonValue),
      ),
    } satisfies Omit<RunCursor, "cursorHash">;
    const cursor: RunCursor = {
      ...cursorWithoutHash,
      cursorHash: computeRunCursorHash(cursorWithoutHash),
    };

    await this.#store.commit({
      expectedPosition: previous.processedPosition,
      event,
      cursor,
      aggregate,
      outputs,
    });
    return cursor;
  }

  async #persistedPredecessorHash(position: bigint): Promise<string> {
    if (position === 1n) return "0".repeat(64);
    const predecessorPosition = (position - 1n).toString();
    const predecessor = await this.#eventLog.get(predecessorPosition);
    if (predecessor === undefined) {
      throw new Error(`Persisted event predecessor ${predecessorPosition} does not exist`);
    }
    if (predecessor.position !== predecessorPosition) {
      throw new Error(`Event log returned the wrong predecessor for position ${position}`);
    }
    verifyStoredEvent(predecessor);
    return predecessor.eventHash;
  }

  async #verifyExactPersistedEvent(
    event: StoredEvent,
    expectedPreviousHash: string,
  ): Promise<void> {
    verifyStoredEvent(event, expectedPreviousHash);
    const persisted = await this.#eventLog.get(event.position);
    if (persisted === undefined) {
      throw new Error(`Event ${event.position} is not persisted`);
    }
    verifyStoredEvent(persisted, expectedPreviousHash);
    if (
      canonicalJson(persisted as unknown as JsonValue) !==
      canonicalJson(event as unknown as JsonValue)
    ) {
      throw new Error(`Event ${event.position} is not the exact persisted event`);
    }
  }

  async #verifyProcessedSuffix(
    startPosition: bigint,
    startEventHash: string,
    cursor: RunCursor,
  ): Promise<void> {
    const cursorPosition = BigInt(cursor.processedPosition);
    let position = startPosition;
    let eventHash = startEventHash;
    while (position < cursorPosition) {
      const remaining = cursorPosition - position;
      const limit = Number(remaining < 1_000n ? remaining : 1_000n);
      const page = await this.#eventLog.readAfter(position.toString(), limit);
      if (page.events.length === 0) {
        throw new Error(`Persisted event chain ends before cursor position ${cursorPosition}`);
      }
      for (const event of page.events) {
        const expectedPosition = position + 1n;
        if (event.position !== expectedPosition.toString()) {
          throw new Error(
            `Persisted event chain position mismatch: expected ${expectedPosition}, received ${event.position}`,
          );
        }
        verifyStoredEvent(event, eventHash);
        position = expectedPosition;
        eventHash = event.eventHash;
      }
      if (page.nextPosition !== position.toString()) {
        throw new Error(`Persisted event page cursor mismatch after position ${position}`);
      }
    }
    if (position !== cursorPosition || eventHash !== cursor.lastEventHash) {
      throw new Error(
        `Persisted event chain does not match cursor head at position ${cursorPosition}`,
      );
    }
  }

  async processAvailable(pageSize = 1_000): Promise<RunCursor> {
    assertPageLimit(pageSize);
    await this.#initialize();
    let cursor =
      (await this.#store.loadCursor(this.#registration.manifest.runId)) ?? this.#genesis();
    while (true) {
      const page = await this.#eventLog.readAfter(cursor.processedPosition, pageSize);
      for (const event of page.events) cursor = await this.process(event);
      if (!page.hasMore) return cursor;
    }
  }

  async snapshot(pageSize = 1_000): Promise<
    Readonly<{
      cursor: RunCursor;
      outputs: readonly StoredOutput[];
      aggregates: readonly AggregateCheckpoint<TState>[];
    }>
  > {
    assertPageLimit(pageSize);
    await this.#initialize();
    const cursor =
      (await this.#store.loadCursor(this.#registration.manifest.runId)) ?? this.#genesis();
    const outputs: StoredOutput[] = [];
    let outputCursor = "0";
    while (true) {
      const page = await this.#store.readOutputsAfter(
        this.#registration.manifest.runId,
        outputCursor,
        pageSize,
      );
      outputs.push(...page.outputs);
      outputCursor = page.nextSequence;
      if (!page.hasMore) break;
    }
    const aggregates: AggregateCheckpoint<TState>[] = [];
    let aggregateCursor = "";
    while (true) {
      const page = await this.#store.readAggregatesAfter(
        this.#registration.manifest.runId,
        aggregateCursor,
        pageSize,
      );
      aggregates.push(...page.aggregates);
      aggregateCursor = page.nextAggregateId;
      if (!page.hasMore) break;
    }
    return { cursor, outputs, aggregates };
  }

  async #initialize(): Promise<void> {
    if (this.#initialized) return;
    await this.#store.ensureRun(this.#registration);
    this.#initialized = true;
  }

  #genesis(): RunCursor {
    return createGenesisRunCursor(this.#registration);
  }

  #aggregateGenesis(aggregateId: string): AggregateCheckpoint<TState> {
    const initialState = this.#reducer.initialState(
      aggregateId,
      this.#registration.manifest.behavior.configuration,
    );
    assertJsonWithinLimits(
      initialState,
      PERSISTED_PROCESSING_JSON_LIMITS,
      "$.aggregate.initialState",
    );
    const state = this.#reducer.parseState(initialState);
    requiredObject(state, "Initial aggregate state");
    assertJsonWithinLimits(state, PERSISTED_PROCESSING_JSON_LIMITS, "$.aggregate.initialState");
    const stateHash = canonicalHash(
      `peas/state/${this.#reducer.name}/${this.#reducer.version}`,
      state,
    );
    const withoutHash = {
      runId: this.#registration.manifest.runId,
      aggregateId,
      version: "0",
      lastInputPosition: "0",
      state,
      stateHash,
    } satisfies Omit<AggregateCheckpoint<TState>, "checkpointHash">;
    return { ...withoutHash, checkpointHash: computeAggregateCheckpointHash(withoutHash) };
  }

  #verifyCursor(cursor: RunCursor): RunCursor {
    cursor = validateRunCursor(cursor);
    if (cursor.runId !== this.#registration.manifest.runId)
      throw new Error("Run cursor ID mismatch");
    if (cursor.manifestHash !== this.#registration.manifestHash) {
      throw new Error("Run manifest does not match the stored cursor");
    }
    if (cursor.behaviorHash !== this.#registration.behaviorHash) {
      throw new Error("Run behavior does not match the stored cursor");
    }
    const { cursorHash, ...withoutHash } = cursor;
    if (cursorHash !== computeRunCursorHash(withoutHash))
      throw new Error("Run cursor hash mismatch");
    return cursor;
  }

  #verifyAggregate(checkpoint: AggregateCheckpoint<TState>): TState {
    checkpoint = validateAggregateCheckpoint<TState>(checkpoint);
    assertJsonWithinLimits(
      checkpoint.state,
      PERSISTED_PROCESSING_JSON_LIMITS,
      "$.aggregate.storedState",
    );
    const state = this.#reducer.parseState(checkpoint.state);
    requiredObject(state, "Stored aggregate state");
    assertJsonWithinLimits(state, PERSISTED_PROCESSING_JSON_LIMITS, "$.aggregate.storedState");
    const expectedStateHash = canonicalHash(
      `peas/state/${this.#reducer.name}/${this.#reducer.version}`,
      state,
    );
    if (checkpoint.stateHash !== expectedStateHash) {
      throw new Error(`Aggregate state hash mismatch for ${checkpoint.aggregateId}`);
    }
    const { checkpointHash, ...withoutHash } = checkpoint;
    if (checkpointHash !== computeAggregateCheckpointHash(withoutHash)) {
      throw new Error(`Aggregate checkpoint hash mismatch for ${checkpoint.aggregateId}`);
    }
    return state;
  }

  #materialize(
    event: StoredEvent,
    aggregateId: string,
    transition: Transition<TState>,
  ): readonly ImmutableOutput[] {
    const groups: readonly [OutputCategory, readonly (DecisionDraft | JobDraft | OutboxDraft)[]][] =
      [
        ["decision", transition.decisions],
        ["job", transition.jobs],
        ["outbox", transition.outbox],
      ];
    const outputs: ImmutableOutput[] = [];
    const dedupe = new Set<string>();

    for (const [category, drafts] of groups) {
      for (let ordinal = 0; ordinal < drafts.length; ordinal += 1) {
        const draft = drafts[ordinal];
        if (draft === undefined)
          throw new Error(`Missing ${category} output at ordinal ${ordinal}`);
        const materialized = outputBody(category, draft, this.#registration.manifest.runId);
        assertJsonWithinLimits(
          materialized.body,
          PERSISTED_PROCESSING_JSON_LIMITS,
          `$.outputs[${category}:${ordinal}].body`,
        );
        assertJson(materialized.body);
        if (materialized.dedupeKey !== null) {
          if (category === "decision") {
            throw new Error("Decision output cannot have a dedupe key");
          }
          const identity = computeOutputDedupeIdentity(
            this.#registration.manifest.runId,
            category,
            materialized.dedupeKey,
          );
          if (dedupe.has(identity))
            throw new Error(`Duplicate ${category} dedupe key in transition`);
          dedupe.add(identity);
        }
        const bodyHash = canonicalHash(`peas/output-body/${category}/v2`, materialized.body);
        const outputId = canonicalHash("peas/output-id/v2", {
          runId: this.#registration.manifest.runId,
          manifestHash: this.#registration.manifestHash,
          inputEventHash: event.eventHash,
          aggregateId,
          category,
          ordinal,
          bodyHash,
        });
        outputs.push({
          outputId,
          runId: this.#registration.manifest.runId,
          inputEventId: event.eventId,
          inputPosition: event.position,
          aggregateId,
          category,
          ordinal,
          dedupeKey: materialized.dedupeKey,
          notBeforeLogicalMs: materialized.notBeforeLogicalMs,
          body: cloneJson(materialized.body),
          bodyHash,
        });
      }
    }
    return outputs;
  }
}
