import assert from "node:assert/strict";
import test from "node:test";

import fc from "fast-check";

import { CapturedEventLog } from "../src/adapters/memory/captured-event-log.js";
import { InMemoryEventLog } from "../src/adapters/memory/event-log.js";
import { ManualClock } from "../src/core/clock.js";
import type { EventDraft, StoredEvent } from "../src/core/event.js";
import { canonicalHash } from "../src/core/hash.js";
import type { JsonObject } from "../src/core/json.js";
import type { ReducerContext } from "../src/core/processor.js";
import {
  EarningsClusterReducer,
  type AnalysisBranch,
  type EarningsClusterConfig,
  type EarningsClusterState,
} from "../src/domain/earnings-cluster/reducer.js";
import { createProviderEvidenceBundle } from "../src/providers/evidence-bundle.js";
import { BASE_TIME_MS, FISCAL_PERIOD } from "./scenario.js";

const unicodeText = fc.string({ unit: "grapheme", minLength: 0, maxLength: 24 });
const directConfig: EarningsClusterConfig = {
  mirrorDebounceMs: 60_000,
  lifecycleMs: 3_600_000,
  maxSourcesPerCluster: 32,
  maxAnalysisBranches: 32,
  maxAnalysisResultBytes: 64_000,
};
const directIdentities = {
  extractorVersion: "property-extractor-v1",
  featureSetId: "property-features-v1",
  promptId: "property-prompt-v1",
  modelId: "property-model-v1",
  datasetId: "property-dataset-v1",
} as const;

function arbitraryDrafts(): fc.Arbitrary<readonly EventDraft[]> {
  return fc
    .array(
      fc.record({
        subjectSuffix: unicodeText,
        providerSuffix: unicodeText,
        revision: fc.integer({ min: 1, max: 10_000 }),
        text: unicodeText,
      }),
      { minLength: 1, maxLength: 30 },
    )
    .map((values) =>
      values.map((value, index) => {
        const payload: JsonObject = { index, text: value.text };
        const artifactHash = canonicalHash("peas/property-artifact/v2", payload);
        return {
          envelopeVersion: 2,
          type: "property.event",
          schemaVersion: 1,
          source: `property:${value.providerSuffix}`,
          subject: `subject:${value.subjectSuffix}`,
          occurredAtMs: null,
          correlationId: `property-${index}`,
          provider: {
            provider: `provider:${value.providerSuffix}`,
            recordId: `record-${index}`,
            revisionId: String(value.revision),
            artifactHash,
          },
          payload,
        } satisfies EventDraft;
      }),
    );
}

test("fast-check preserves event order, per-subject versions, redelivery, revisions, and Unicode", async () => {
  await fc.assert(
    fc.asyncProperty(arbitraryDrafts(), async (drafts) => {
      const clock = new ManualClock(BASE_TIME_MS);
      const eventLog = new InMemoryEventLog({ clock });
      const events: StoredEvent[] = [];
      const versions = new Map<string, bigint>();

      for (const [index, draft] of drafts.entries()) {
        const result = await eventLog.append(draft);
        assert.equal(result.disposition, "appended");
        assert.equal(result.event.position, String(index + 1));
        const expectedVersion = (versions.get(draft.subject) ?? 0n) + 1n;
        versions.set(draft.subject, expectedVersion);
        assert.equal(result.event.streamVersion, expectedVersion.toString());
        events.push(result.event);
        clock.advanceBy(1);
      }

      new CapturedEventLog(events);
      const firstDraft = drafts[0];
      const firstEvent = events[0];
      assert.ok(firstDraft);
      assert.ok(firstEvent);
      clock.advanceBy(10_000);
      const redelivery = await eventLog.append(firstDraft);
      assert.equal(redelivery.disposition, "redelivery");
      assert.deepEqual(redelivery.event, firstEvent);

      const changedArtifact = canonicalHash("peas/property-artifact-conflict/v2", {
        original: firstDraft.provider.artifactHash,
      });
      const conflicting: EventDraft = {
        ...firstDraft,
        provider: { ...firstDraft.provider, artifactHash: changedArtifact },
        payload: { ...firstDraft.payload, conflict: true },
      };
      await assert.rejects(
        () => eventLog.append(conflicting),
        /changed content without a new revision/u,
      );

      const nextRevision: EventDraft = {
        ...firstDraft,
        provider: {
          ...firstDraft.provider,
          revisionId: `${firstDraft.provider.revisionId}:next`,
          artifactHash: changedArtifact,
        },
        payload: { ...firstDraft.payload, revised: true },
      };
      const revised = await eventLog.append(nextRevision);
      assert.equal(revised.disposition, "appended");
      assert.notEqual(revised.event.eventId, firstEvent.eventId);
    }),
    { numRuns: 50 },
  );
});

test("fast-check padded and unpadded CIKs route to one aggregate", async () => {
  await fc.assert(
    fc.asyncProperty(fc.integer({ min: 0, max: 9_999_999_999 }), async (numericCik) => {
      const compact = String(numericCik);
      const padded = compact.padStart(10, "0");
      const clock = new ManualClock(BASE_TIME_MS);
      const eventLog = new InMemoryEventLog({ clock });
      const reducer = new EarningsClusterReducer();

      const capture = async (issuerCik: string, recordId: string): Promise<StoredEvent> => {
        const payload: JsonObject = {
          issuerCik,
          fiscalPeriod: FISCAL_PERIOD,
          sourceKind: "issuer_release",
          artifactHash: canonicalHash("peas/property-cik-artifact/v2", { issuerCik, recordId }),
          publishedAtMs: BASE_TIME_MS,
          timestampConfidence: "exact",
          originalTimestamp: null,
        };
        const artifactHashValue = payload["artifactHash"];
        if (typeof artifactHashValue !== "string") throw new Error("Artifact hash is missing");
        const artifactHash = artifactHashValue;
        const appended = await eventLog.append({
          envelopeVersion: 2,
          type: "earnings.source.observed",
          schemaVersion: 1,
          source: "property:cik",
          subject: `earnings:${issuerCik}:${FISCAL_PERIOD}`,
          occurredAtMs: BASE_TIME_MS,
          correlationId: `cik-${recordId}`,
          provider: {
            provider: "property",
            recordId,
            revisionId: "1",
            artifactHash,
          },
          payload,
        });
        return appended.event;
      };

      const compactEvent = await capture(compact, "compact");
      const paddedEvent = await capture(padded, "padded");
      assert.equal(reducer.route(compactEvent), reducer.route(paddedEvent));
    }),
    { numRuns: 100 },
  );
});

function directContext(nowMs: number): ReducerContext<EarningsClusterConfig> {
  return {
    nowMs,
    runId: "property-direct-run",
    behaviorHash: canonicalHash("peas/property-behavior/v1", directIdentities),
    identities: directIdentities,
    config: directConfig,
    configHash: canonicalHash("peas/property-config/v1", directConfig),
  };
}

function directHarness(): Readonly<{
  reducer: EarningsClusterReducer;
  initial: EarningsClusterState;
  event: (options: {
    type: string;
    payload: JsonObject;
    nowMs: number;
    causationId?: string;
    artifactHash?: string;
  }) => StoredEvent;
}> {
  const reducer = new EarningsClusterReducer();
  let sequence = 0;
  const event = (options: {
    type: string;
    payload: JsonObject;
    nowMs: number;
    causationId?: string;
    artifactHash?: string;
  }): StoredEvent => {
    sequence += 1;
    const identity = canonicalHash("peas/property-direct-event/v1", {
      sequence,
      type: options.type,
      payload: options.payload,
    });
    return {
      envelopeVersion: 2,
      eventId: identity,
      type: options.type,
      schemaVersion: 1,
      source: "property:direct",
      subject: `earnings:0000123456:${FISCAL_PERIOD}`,
      streamVersion: String(sequence),
      occurredAtMs: options.nowMs,
      receivedAtMs: options.nowMs,
      logicalAtMs: options.nowMs,
      correlationId: "property-direct",
      ...(options.causationId === undefined ? {} : { causationId: options.causationId }),
      provider: {
        provider: "property-direct",
        recordId: `record-${sequence}`,
        revisionId: "1",
        artifactHash: options.artifactHash ?? identity,
      },
      payload: options.payload,
      position: String(sequence),
      contentHash: identity,
      previousEventHash: canonicalHash("peas/property-previous/v1", { sequence }),
      eventHash: canonicalHash("peas/property-chain/v1", { sequence, identity }),
    };
  };

  const artifactHash = canonicalHash("peas/property-direct-artifact/v1", { source: "first" });
  const first = event({
    type: "earnings.source.observed",
    nowMs: BASE_TIME_MS,
    artifactHash,
    payload: {
      issuerCik: "0000123456",
      fiscalPeriod: FISCAL_PERIOD,
      sourceKind: "issuer_release",
      artifactHash,
      publishedAtMs: BASE_TIME_MS,
      timestampConfidence: "exact",
      originalTimestamp: null,
    },
  });
  const aggregateId = reducer.route(first);
  const initial = reducer.apply(
    reducer.initialState(aggregateId, directConfig),
    first,
    directContext(BASE_TIME_MS),
  ).state;
  return { reducer, initial, event };
}

function requiredBranch(state: EarningsClusterState): AnalysisBranch {
  const branch = state.cluster?.analysisBranches[0];
  if (branch === undefined) throw new Error("Property harness analysis branch is missing");
  return branch;
}

test("fast-check early, stale, and duplicate timer sequences always retain finalization", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 1, max: 59_999 }),
      fc.integer({ min: 0, max: 5 }),
      fc.integer({ min: 0, max: 5 }),
      (earlyByMs, staleCount, duplicateCount) => {
        const harness = directHarness();
        let state = harness.initial;
        const original = state.cluster?.timers.find(
          (timer) => timer.timerType === "earnings.lifecycle-finalize",
        );
        assert.ok(original);
        const originalJobId = original.jobId;
        const early = harness.event({
          type: "kernel.timer.fired",
          nowMs: original.scheduledForLogicalMs - earlyByMs,
          causationId: original.jobId,
          payload: {
            timerType: original.timerType,
            clusterId: state.cluster?.clusterId ?? "",
            jobId: original.jobId,
            scheduledForLogicalMs: original.scheduledForLogicalMs,
            fencingToken: 1,
          },
        });
        state = harness.reducer.apply(state, early, directContext(early.logicalAtMs)).state;
        const replacement = state.cluster?.timers.find(
          (timer) => timer.timerType === "earnings.lifecycle-finalize",
        );
        assert.ok(replacement);
        assert.notEqual(replacement.jobId, originalJobId);

        for (let index = 0; index < staleCount; index += 1) {
          const stale = harness.event({
            type: "kernel.timer.fired",
            nowMs: replacement.scheduledForLogicalMs,
            causationId: originalJobId,
            payload: {
              timerType: replacement.timerType,
              clusterId: state.cluster?.clusterId ?? "",
              jobId: originalJobId,
              scheduledForLogicalMs: replacement.scheduledForLogicalMs,
              fencingToken: index + 1,
            },
          });
          state = harness.reducer.apply(state, stale, directContext(stale.logicalAtMs)).state;
          assert.equal(state.cluster?.status, "open");
        }

        const onTimePayload: JsonObject = {
          timerType: replacement.timerType,
          clusterId: state.cluster?.clusterId ?? "",
          jobId: replacement.jobId,
          scheduledForLogicalMs: replacement.scheduledForLogicalMs,
          fencingToken: staleCount + 2,
        };
        const onTime = harness.event({
          type: "kernel.timer.fired",
          nowMs: replacement.scheduledForLogicalMs,
          causationId: replacement.jobId,
          payload: onTimePayload,
        });
        state = harness.reducer.apply(state, onTime, directContext(onTime.logicalAtMs)).state;
        assert.equal(state.cluster?.status, "finalized");

        for (let index = 0; index < duplicateCount; index += 1) {
          const duplicate = harness.event({
            type: "kernel.timer.fired",
            nowMs: replacement.scheduledForLogicalMs + index + 1,
            causationId: replacement.jobId,
            payload: onTimePayload,
          });
          state = harness.reducer.apply(
            state,
            duplicate,
            directContext(duplicate.logicalAtMs),
          ).state;
          assert.equal(state.cluster?.status, "finalized");
        }
      },
    ),
    { numRuns: 50 },
  );
});

test("fast-check lease reclaim sequences fence stale work and accept only the latest result", () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 6 }), (leaseCount) => {
      const harness = directHarness();
      let state = harness.initial;
      let branch = requiredBranch(state);
      const clusterId = state.cluster?.clusterId;
      assert.ok(clusterId);

      for (let attempt = 1; attempt <= leaseCount; attempt += 1) {
        const leased = harness.event({
          type: "kernel.job.leased",
          nowMs: BASE_TIME_MS + attempt,
          causationId: branch.jobId,
          payload: {
            jobType: "earnings.cluster.analyze",
            clusterId,
            branchId: branch.branchId,
            jobId: branch.jobId,
            inputBundleHash: branch.inputBundleHash,
            attempt,
            fencingToken: attempt,
          },
        });
        state = harness.reducer.apply(state, leased, directContext(leased.logicalAtMs)).state;
        branch = requiredBranch(state);
      }

      const duplicateLease = harness.event({
        type: "kernel.job.leased",
        nowMs: BASE_TIME_MS + leaseCount + 1,
        causationId: branch.jobId,
        payload: {
          jobType: "earnings.cluster.analyze",
          clusterId,
          branchId: branch.branchId,
          jobId: branch.jobId,
          inputBundleHash: branch.inputBundleHash,
          attempt: leaseCount,
          fencingToken: leaseCount,
        },
      });
      const duplicateLeaseTransition = harness.reducer.apply(
        state,
        duplicateLease,
        directContext(duplicateLease.logicalAtMs),
      );
      assert.equal(
        duplicateLeaseTransition.decisions[0]?.payload["reason"],
        "analysis-stale-lease",
      );
      assert.equal(requiredBranch(duplicateLeaseTransition.state).expectedAttempt, leaseCount);
      assert.equal(requiredBranch(duplicateLeaseTransition.state).expectedFencingToken, leaseCount);

      if (leaseCount > 1) {
        const staleAttempt = leaseCount - 1;
        const stale = harness.event({
          type: "kernel.job.succeeded",
          nowMs: BASE_TIME_MS + leaseCount + 1,
          causationId: branch.jobId,
          payload: {
            jobType: "earnings.cluster.analyze",
            clusterId,
            branchId: branch.branchId,
            jobId: branch.jobId,
            inputBundleHash: branch.inputBundleHash,
            attempt: staleAttempt,
            fencingToken: staleAttempt,
            provenance: {
              ...branch.analysisContract,
              analysisContractHash: branch.analysisContractHash,
              inputSources: branch.inputSources,
              artifactCatalog: branch.artifactCatalog,
            },
            result: { verdict: "stale" },
          },
        });
        const staleTransition = harness.reducer.apply(
          state,
          stale,
          directContext(stale.logicalAtMs),
        );
        assert.equal(requiredBranch(staleTransition.state).status, "pending");
      }

      const latest = requiredBranch(state);
      const succeeded = harness.event({
        type: "kernel.job.succeeded",
        nowMs: BASE_TIME_MS + leaseCount + 2,
        causationId: latest.jobId,
        payload: {
          jobType: "earnings.cluster.analyze",
          clusterId,
          branchId: latest.branchId,
          jobId: latest.jobId,
          inputBundleHash: latest.inputBundleHash,
          attempt: leaseCount,
          fencingToken: leaseCount,
          provenance: {
            ...latest.analysisContract,
            analysisContractHash: latest.analysisContractHash,
            inputSources: latest.inputSources,
            artifactCatalog: latest.artifactCatalog,
          },
          result: { verdict: "latest" },
        },
      });
      const completed = harness.reducer.apply(
        state,
        succeeded,
        directContext(succeeded.logicalAtMs),
      );
      assert.equal(requiredBranch(completed.state).status, "succeeded");
    }),
    { numRuns: 50 },
  );
});

test("fast-check V2 evidence presentation permutations canonicalize at the reducer boundary", () => {
  const issuerCik = "0000123456";
  const subject = `earnings:${issuerCik}:${FISCAL_PERIOD}`;
  const primaryArtifactHash = canonicalHash("peas/property-v2/v1", { member: "exhibit" });
  const evidence = [
    {
      role: "sec.submissions",
      artifactHash: canonicalHash("peas/property-v2/v1", { member: "submissions" }),
    },
    {
      role: "sec.filing-index",
      artifactHash: canonicalHash("peas/property-v2/v1", { member: "index" }),
    },
    {
      role: "sec.primary-document",
      artifactHash: canonicalHash("peas/property-v2/v1", { member: "primary" }),
    },
    { role: "sec.exhibit-99.1", artifactHash: primaryArtifactHash },
    {
      role: "sec.xbrl-instance",
      artifactHash: canonicalHash("peas/property-v2/v1", { member: "xbrl" }),
    },
  ];
  const bundle = createProviderEvidenceBundle({
    provider: "sec-edgar",
    source: "sec:normalizer-v1",
    recordId: "sec:0000123456-27-000001:earnings-source-v2",
    revisionId: "1",
    subject,
    issuerCik,
    fiscalPeriod: FISCAL_PERIOD,
    sourceKind: "sec_8k",
    primaryArtifactHash,
    evidence,
  });

  fc.assert(
    fc.property(fc.integer({ min: 0, max: evidence.length - 1 }), (offset) => {
      const harness = directHarness();
      const memberOrder = [...evidence.slice(offset), ...evidence.slice(0, offset)];
      const raw = harness.event({
        type: "earnings.source.observed",
        nowMs: BASE_TIME_MS,
        artifactHash: primaryArtifactHash,
        payload: {
          issuerCik,
          fiscalPeriod: FISCAL_PERIOD,
          sourceKind: "sec_8k",
          primaryArtifactHash,
          evidenceBundleHash: bundle.evidenceBundleHash,
          evidence: memberOrder,
          publishedAtMs: BASE_TIME_MS,
          timestampConfidence: "exact",
          originalTimestamp: null,
        },
      });
      const event: StoredEvent = {
        ...raw,
        schemaVersion: 2,
        source: bundle.source,
        subject,
        correlationId: subject,
        causationId: bundle.evidenceBundleHash,
        provider: {
          provider: bundle.provider,
          recordId: bundle.recordId,
          revisionId: bundle.revisionId,
          artifactHash: primaryArtifactHash,
        },
      };
      const reducer = new EarningsClusterReducer();
      const transition = reducer.apply(
        reducer.initialState(reducer.route(event), directConfig),
        event,
        directContext(event.logicalAtMs),
      );
      const source = transition.state.cluster?.sources[0];
      assert.ok(source);
      assert.deepEqual(
        source.evidence.map((member) => member.role),
        [
          "sec.exhibit-99.1",
          "sec.filing-index",
          "sec.primary-document",
          "sec.submissions",
          "sec.xbrl-instance",
        ],
      );
    }),
    { numRuns: 25 },
  );
});
