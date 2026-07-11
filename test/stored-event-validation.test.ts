import assert from "node:assert/strict";
import test from "node:test";

import { CapturedEventLog } from "../src/adapters/memory/captured-event-log.js";
import { InMemoryProcessingStore } from "../src/adapters/memory/processing-store.js";
import {
  type CapturedEvent,
  computeContentHash,
  computeEventHash,
  deriveEventId,
  type EventLog,
  type ProviderIdentity,
  type StoredEvent,
  validateStoredEvent,
  verifyStoredEvent,
} from "../src/core/event.js";
import { canonicalHash } from "../src/core/hash.js";
import { DeterministicProcessor } from "../src/core/processor.js";
import {
  EarningsClusterReducer,
  type EarningsClusterState,
} from "../src/domain/earnings-cluster/reducer.js";
import { makeManifest } from "./scenario.js";

const RECEIVED_AT_MS = 1_900_000_000_000;
const ARTIFACT_HASH = canonicalHash("peas/stored-envelope-test/v1", {
  artifact: "issuer-release",
});

type MutableStoredEvent = Record<string, unknown> & {
  provider: Record<string, unknown>;
};

function storedEvent(): StoredEvent {
  const provider: ProviderIdentity = {
    provider: "issuer-ir",
    recordId: "release-2026-q2",
    revisionId: "1",
    artifactHash: ARTIFACT_HASH,
  };
  const captured: CapturedEvent = {
    envelopeVersion: 2,
    eventId: deriveEventId(provider),
    type: "earnings.source.observed",
    schemaVersion: 1,
    source: "issuer-ir-adapter",
    subject: "earnings:0000123456:2026-Q2",
    streamVersion: "1",
    occurredAtMs: RECEIVED_AT_MS - 1_000,
    receivedAtMs: RECEIVED_AT_MS,
    logicalAtMs: RECEIVED_AT_MS,
    correlationId: "release-2026-q2",
    provider,
    payload: {
      issuerCik: "0000123456",
      fiscalPeriod: "2026-Q2",
      sourceKind: "issuer_release",
      artifactHash: ARTIFACT_HASH,
      publishedAtMs: RECEIVED_AT_MS - 1_000,
      timestampConfidence: "exact",
      originalTimestamp: "2030-03-01T20:00:00Z",
    },
  };
  const contentHash = computeContentHash(captured);
  const withoutEventHash = {
    ...captured,
    position: "1",
    contentHash,
    previousEventHash: "0".repeat(64),
  };
  return { ...withoutEventHash, eventHash: computeEventHash(withoutEventHash) };
}

function malformed(
  mutate: (event: MutableStoredEvent) => void,
  refreshEventId = false,
): StoredEvent {
  const event = structuredClone(storedEvent()) as unknown as MutableStoredEvent;
  mutate(event);
  if (refreshEventId) {
    event["eventId"] = deriveEventId(event.provider as unknown as ProviderIdentity);
  }
  event["contentHash"] = computeContentHash(event as unknown as CapturedEvent);
  event["eventHash"] = computeEventHash(event as unknown as Omit<StoredEvent, "eventHash">);
  return event as unknown as StoredEvent;
}

const malformedCases: readonly (readonly [string, StoredEvent])[] = [
  ["wrong envelope version", malformed((event) => (event["envelopeVersion"] = 3))],
  ["empty event type", malformed((event) => (event["type"] = ""))],
  ["non-positive schema version", malformed((event) => (event["schemaVersion"] = 0))],
  ["empty source", malformed((event) => (event["source"] = ""))],
  ["empty subject", malformed((event) => (event["subject"] = ""))],
  ["negative occurred time", malformed((event) => (event["occurredAtMs"] = -1))],
  ["negative received time", malformed((event) => (event["receivedAtMs"] = -1))],
  ["negative logical time", malformed((event) => (event["logicalAtMs"] = -1))],
  ["empty correlation ID", malformed((event) => (event["correlationId"] = ""))],
  ["empty causation ID", malformed((event) => (event["causationId"] = ""))],
  ["empty provider name", malformed((event) => (event.provider["provider"] = ""), true)],
  ["empty provider record ID", malformed((event) => (event.provider["recordId"] = ""), true)],
  ["empty provider revision ID", malformed((event) => (event.provider["revisionId"] = ""), true)],
  [
    "invalid provider artifact digest",
    malformed((event) => (event.provider["artifactHash"] = "not-a-digest"), true),
  ],
  ["non-canonical stream version", malformed((event) => (event["streamVersion"] = "01"))],
  ["non-canonical position", malformed((event) => (event["position"] = "01"))],
  [
    "invalid previous-event digest",
    malformed((event) => (event["previousEventHash"] = "not-a-digest")),
  ],
  ["non-object payload", malformed((event) => (event["payload"] = []))],
  ["unknown top-level field", malformed((event) => (event["untrusted"] = true))],
  ["unknown provider field", malformed((event) => (event.provider["untrusted"] = true))],
];

test("strict stored-envelope validation accepts a canonical captured event", () => {
  const event = storedEvent();
  assert.deepEqual(validateStoredEvent(event), event);
  assert.doesNotThrow(() => verifyStoredEvent(event, "0".repeat(64)));
  assert.doesNotThrow(() => new CapturedEventLog([event]));
});

test("self-rehashed malformed stored envelopes are rejected before replay admission", () => {
  for (const [label, event] of malformedCases) {
    assert.throws(() => verifyStoredEvent(event), label);
    assert.throws(() => new CapturedEventLog([event]), `captured replay: ${label}`);
  }
});

test("processor rejects a malformed event even when its event log returns the exact same bytes", async () => {
  const event = malformed((candidate) => (candidate["envelopeVersion"] = 3));
  const eventLog: EventLog = {
    async append() {
      throw new Error("test log is read-only");
    },
    async get(position) {
      return position === event.position ? structuredClone(event) : undefined;
    },
    async readAfter(position) {
      return { events: [], nextPosition: position, hasMore: false };
    },
  };
  const processor = new DeterministicProcessor({
    reducer: new EarningsClusterReducer(),
    store: new InMemoryProcessingStore<EarningsClusterState>(eventLog),
    eventLog,
    manifest: makeManifest("strict-stored-envelope", "research", false),
  });

  await assert.rejects(() => processor.process(event));
});
