import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import { InMemoryEventLog } from "../src/adapters/memory/event-log.js";
import { loadMigrations, openSqliteDatabase } from "../src/adapters/sqlite/database.js";
import type { ArtifactStore } from "../src/artifacts/artifact-store.js";
import { ManualClock } from "../src/core/clock.js";
import { canonicalHash } from "../src/core/hash.js";
import { canonicalJson } from "../src/core/json.js";
import { type EventCluster, eventClusterSnapshotDraft } from "../src/domain/event-cluster-beta.js";
import { freeze, identity, json, parseProtocol } from "../src/research/contracts.js";
import { evaluateManifest, freezeManifest } from "../src/research/engine.js";
import { freezeResearchInput, verifyResearchArtifacts } from "../src/research/snapshot.js";
import { ResearchRegistry } from "../src/research/sqlite-registry.js";
import { artifactBytes, protocol, stoppedInput, syntheticInput } from "./alpha-research-fixture.js";

test("frozen synthetic H1/H2 oracle includes every horizon, variation and failed event", async () => {
  const inputs = await Promise.all([
    syntheticInput(),
    syntheticInput("2026-02-10T15:00:00Z", 1, "ir"),
    syntheticInput("2026-03-10T15:00:00Z", 2, "simultaneous"),
    syntheticInput("2026-03-11T15:00:00Z", 3, "missing"),
  ]);
  const manifest = freezeManifest(protocol, inputs);
  assert.ok(Object.isFrozen(manifest.inputs[0]?.dataset.bars));
  const result = evaluateManifest(manifest);
  assert.equal(result.trials.length, 4 * 6 * 4);
  assert.equal(result.features[0]?.initialReactionBps, 100.00000000000009);
  assert.deepEqual(
    result.features.map((f) => f.sourceOrder),
    ["SEC_FIRST", "ISSUER_IR_FIRST", "NEAR_SIMULTANEOUS", null],
  );
  const label = result.labels[0];
  assert.ok(label);
  assert.equal(label.entryMs, (inputs[0]?.decisionMs ?? 0) + 60000);
  assert.ok(Math.abs((label.grossBps ?? 0) - (103.05 / 102 - 1) * 10000) < 1e-9);
  assert.equal(label.roundTripCostBps, 12);
  assert.equal(result.trials[0]?.netBps, (label.abnormalBps ?? 0) - 12);
  assert.equal(result.trials[1]?.netBps, -(label.abnormalBps ?? 0) - 12);
  assert.equal(
    result.trials
      .filter((t) => t.variantId === "high-reaction")
      .every((t) => t.status === "failed"),
    true,
  );
  assert.equal(
    result.signals.reduce((n, s) => n + s.attempted, 0),
    result.trials.length,
  );
  assert.ok(
    result.signals.every(
      (s) =>
        s.evidenceClass === "SYNTHETIC_VALIDATION" &&
        s.decision === "NO_TRADE" &&
        Object.values(s.prohibitedEffects).every((n) => n === 0),
    ),
  );
  assert.ok(
    !/PATTERN_DETECTED|PREDICTIVE_SIGNAL|PAPER_ALPHA|TRADABLE_ALPHA/.test(
      canonicalJson(json(result)),
    ),
  );
  assert.equal(evaluateManifest(freezeManifest(protocol, [...inputs].reverse())).id, result.id);
});

test("cutoff rejects later normalization/readiness and bar availability, labels remain isolated", async () => {
  const input = await syntheticInput();
  const baseline = evaluateManifest(freezeManifest(protocol, [input]));
  const future = {
    ...input,
    records: input.records.map((r) => ({ ...r, featureReadyAtMs: input.cutoffMs + 1 })),
  };
  const result = evaluateManifest(freezeManifest(protocol, [future]));
  assert.equal(result.features[0]?.sourceOrder, null);
  assert.ok(result.features[0]?.missing.some((r) => r.endsWith("future-information")));
  for (const clock of ["normalizedAtMs", "featureReadyAtMs"] as const) {
    const missing = { ...input, records: input.records.map((r) => ({ ...r, [clock]: null })) };
    assert.equal(
      evaluateManifest(freezeManifest(protocol, [missing])).features[0]?.sourceOrder,
      null,
    );
  }
  const changedFuture = {
    ...input,
    dataset: {
      ...input.dataset,
      bars: input.dataset.bars.map((b) =>
        b.endMs > input.cutoffMs ? { ...b, close: b.close * 2 } : b,
      ),
    },
  };
  const changed = evaluateManifest(freezeManifest(protocol, [changedFuture]));
  assert.equal(changed.features[0]?.initialReactionBps, baseline.features[0]?.initialReactionBps);
  assert.equal(changed.features[0]?.sourceOrder, baseline.features[0]?.sourceOrder);
  const lateBar = {
    ...input,
    dataset: {
      ...input.dataset,
      bars: input.dataset.bars.map((b) =>
        b.endMs === input.cutoffMs ? { ...b, availableAtMs: input.cutoffMs + 1 } : b,
      ),
    },
  };
  assert.equal(
    evaluateManifest(freezeManifest(protocol, [lateBar])).features[0]?.initialReactionBps,
    null,
  );
  const clockOrder = { ...input, records: input.records.map((r) => ({ ...r, normalizedAtMs: 0 })) };
  assert.throws(() => freezeManifest(protocol, [clockOrder]), /normalization-clock-provenance/);
});

test("chronological cohort keeps exclusions and purges all overlapping labels", async () => {
  const overlap = await syntheticInput("2026-01-31T23:55:00Z");
  const stopped = await stoppedInput(await syntheticInput("2026-02-10T15:00:00Z", 1));
  const repair = { ...(await syntheticInput("2026-03-10T15:00:00Z", 2)), repairEvent: true };
  const outside = await syntheticInput("2026-04-10T15:00:00Z", 3);
  const result = evaluateManifest(freezeManifest(protocol, [overlap, stopped, repair, outside]));
  assert.equal(result.labels.filter((l) => l.status === "purged").length, 6);
  assert.equal(result.labels.filter((l) => l.status === "excluded").length, 18);
  assert.equal(result.trials.length, 96);
  assert.throws(
    () => freezeManifest(protocol, [overlap, { ...overlap, decisionMs: overlap.decisionMs + 1 }]),
    /duplicate-issuer-event/,
  );
  const unknownUniverse = evaluateManifest(
    freezeManifest({ ...protocol, universe: ["OTHER"] }, [overlap]),
  );
  assert.equal(unknownUniverse.features[0]?.exclusion, "outside-universe");
  const noBar = { ...overlap, dataset: { ...overlap.dataset, bars: [] } };
  assert.ok(
    evaluateManifest(freezeManifest(protocol, [noBar])).features[0]?.missing.includes(
      "initial-market:unavailable",
    ),
  );
});

test("identity, clocks, evidence class and provenance reject tampering", async () => {
  const input = await syntheticInput();
  assert.throws(
    () => freezeResearchInput({ ...input, cutoffMs: input.decisionMs + 1 }),
    /clock-order/,
  );
  assert.throws(() => freezeResearchInput({ ...input, decisionMs: NaN }));
  assert.throws(
    () => freezeResearchInput({ ...input, plan: { ...input.plan, revision: 10 } }),
    /plan-binding/,
  );
  assert.throws(() => freezeResearchInput({ ...input, records: [] }), /record-inventory/);
  assert.throws(
    () =>
      freezeResearchInput({
        ...input,
        records: input.records.map((r) => ({ ...r, normalizerId: "forged" })),
      }),
    /normalization-binding/,
  );
  assert.throws(
    () =>
      freezeResearchInput({
        ...input,
        records: input.records.map((r) => ({ ...r, secAcceptanceEastern: "2026-01-10T00:00:00" })),
      }),
    /sec-time-binding/,
  );
  assert.throws(
    () =>
      freezeResearchInput({
        ...input,
        dataset: { ...input.dataset, bars: [...input.dataset.bars, ...input.dataset.bars] },
      }),
    /market-clock-or-duplicate/,
  );
  assert.throws(() => parseProtocol({ ...protocol, evidenceClass: "PAPER_ALPHA" }));
  assert.throws(() => parseProtocol({ ...protocol, entryDelayMs: -1 }));
  assert.throws(() => parseProtocol({ ...protocol, partitionBoundariesMs: [1, 1, 2, 3] }));
  const manifest = freezeManifest(protocol, [input]);
  assert.throws(() => evaluateManifest({ ...manifest, id: "forged" }), /manifest-tampered/);
  assert.notEqual(identity("input", input), identity("input", { ...input, repairEvent: true }));
});

test("SQLite freezes epochs, persists failed variants, reopens and replays identical records", async () => {
  const directory = mkdtempSync(join(tmpdir(), "peas-research-"));
  const filename = join(directory, "research.sqlite");
  const migrations = loadMigrations("migrations/research");
  const manifest = freezeManifest(protocol, [await syntheticInput()]);
  let db = openSqliteDatabase(filename, migrations);
  try {
    let registry = new ResearchRegistry(db);
    assert.throws(() => registry.run(manifest.id), /not-registered/);
    registry.register(manifest);
    assert.equal(registry.register(manifest), manifest.id);
    assert.throws(
      () => registry.register(freezeManifest({ ...protocol, spreadBps: 3 }, manifest.inputs)),
      /epoch-frozen-human-gate/,
    );
    assert.throws(() => registry.register({ ...manifest, id: "forged" }), /tampered/);
    assert.throws(() => registry.replay(manifest.id), /replay-mismatch/);
    const result = registry.run(manifest.id);
    const before = registry.records(manifest.id);
    assert.ok(before.some((r) => r.kind === "trials" && JSON.parse(r.body).status === "failed"));
    for (const table of ["research_records", "research_manifests"]) {
      assert.throws(() => db.exec(`DELETE FROM ${table}`), /immutable|append-only/);
      assert.throws(() => db.exec(`UPDATE ${table} SET body = '{}'`), /immutable|append-only/);
      assert.throws(
        () => db.exec(`INSERT OR REPLACE INTO ${table} SELECT * FROM ${table}`),
        /immutable|append-only/,
      );
    }
    db.close();
    db = openSqliteDatabase(filename, migrations);
    registry = new ResearchRegistry(db);
    assert.equal(registry.replay(manifest.id).id, result.id);
    assert.equal(registry.run(manifest.id).id, result.id);
    assert.deepEqual(registry.records(manifest.id), before);
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("local artifact verification uses retained bytes only", async () => {
  const input = freezeResearchInput(await syntheticInput(undefined, 0, "missing"));
  const reader = {
    read: async (digest: string) => ({
      artifact: { digest },
      stream: Readable.from([artifactBytes]),
    }),
  } as Pick<ArtifactStore, "read">;
  await verifyResearchArtifacts(input, reader);
  await assert.rejects(
    verifyResearchArtifacts(input, {
      read: async (digest: string) => ({ artifact: { digest }, stream: Readable.from(["wrong"]) }),
    } as Pick<ArtifactStore, "read">),
    /artifact-digest/,
  );
});

test("failed persistence attempt rolls back outputs and resumes without deleting failure history", async () => {
  const db = openSqliteDatabase(":memory:", loadMigrations("migrations/research"));
  try {
    const registry = new ResearchRegistry(db);
    const manifest = freezeManifest(protocol, [await syntheticInput()]);
    registry.register(manifest);
    db.exec(
      "CREATE TRIGGER synthetic_fail BEFORE INSERT ON research_records WHEN NEW.kind = 'trials' BEGIN SELECT RAISE(ABORT, 'synthetic-interruption'); END",
    );
    assert.throws(() => registry.run(manifest.id), /synthetic-interruption/);
    assert.deepEqual(
      registry.records(manifest.id).map((r) => r.kind),
      ["attempt-start", "attempt-end"],
    );
    assert.equal(JSON.parse(registry.records(manifest.id)[1]?.body ?? "{}").status, "failed");
    db.exec("DROP TRIGGER synthetic_fail");
    const result = registry.run(manifest.id);
    assert.equal(registry.records(manifest.id).filter((r) => r.kind === "attempt-start").length, 2);
    assert.equal(registry.replay(manifest.id).id, result.id);
  } finally {
    db.close();
  }
});

test("missing label endpoints, excessive delays, and start overlap never substitute prices", async () => {
  const input = await syntheticInput();
  const noExit = {
    ...input,
    dataset: {
      ...input.dataset,
      bars: input.dataset.bars.filter((b) => b.endMs <= input.cutoffMs),
    },
  };
  assert.ok(
    evaluateManifest(freezeManifest(protocol, [noExit])).labels.every(
      (l) => l.status === "missing",
    ),
  );
  const delayed = evaluateManifest(freezeManifest({ ...protocol, entryDelayMs: 300000 }, [input]));
  assert.equal(delayed.labels[0]?.reason, "entry-after-horizon");
  const start = await syntheticInput("2026-02-01T00:00:00Z");
  assert.ok(
    evaluateManifest(freezeManifest(protocol, [start])).labels.every((l) => l.status === "purged"),
  );
  const missingClock = {
    ...input,
    dataset: {
      ...input.dataset,
      bars: input.dataset.bars.map((b) => ({ ...b, availableAtMs: null })),
    },
  };
  assert.ok(
    evaluateManifest(freezeManifest(protocol, [missingClock])).labels.every(
      (l) => l.status === "missing",
    ),
  );
});

test("identical SEC and IR bytes retain independent source-member availability", async () => {
  const input = await syntheticInput(undefined, 0, "sec", true);
  assert.equal(input.records[0]?.artifactDigest, input.records[1]?.artifactDigest);
  assert.notEqual(input.records[0]?.memberKey, input.records[1]?.memberKey);
  const result = evaluateManifest(freezeManifest(protocol, [input]));
  assert.equal(result.features[0]?.sourceOrder, "SEC_FIRST");
  const lateIr = {
    ...input,
    records: input.records.map((r, i) =>
      i === 1 ? { ...r, featureReadyAtMs: input.cutoffMs + 1 } : r,
    ),
  };
  const late = evaluateManifest(freezeManifest(protocol, [lateIr]));
  assert.equal(late.features[0]?.sourceOrder, null);
  assert.equal(late.features[0]?.dependencies.filter((d) => d.available).length, 1);
});

test("self-hashed external snapshots cannot smuggle malformed source clocks", async () => {
  const input = await syntheticInput();
  const cluster = input.snapshot.payload["cluster"] as unknown as EventCluster;
  const { stateDigest: _digest, ...body } = cluster;
  for (const publication of ["2027-01-01T00:00:00Z", input.cutoffMs + 1]) {
    const malformed = {
      ...body,
      members: body.members.map((m) => ({ ...m, publicationOrAcceptanceAtMs: publication })),
    };
    const replacement = {
      ...malformed,
      stateDigest: canonicalHash("peas/event-cluster-state/v1", json(malformed)),
    } as unknown as EventCluster;
    const snapshot = (
      await new InMemoryEventLog({ clock: new ManualClock(input.decisionMs) }).append(
        eventClusterSnapshotDraft(replacement),
      )
    ).event;
    assert.throws(
      () => freezeResearchInput({ ...input, snapshot }),
      /source-clock-invalid|source-clock-order/,
    );
  }
});

test("research migration set leaves the pinned operational schema unchanged", () => {
  assert.equal(loadMigrations("migrations").length, 10);
  const research = loadMigrations("migrations/research");
  assert.equal(research.length, 1);
  assert.equal(research[0]?.version, 1);
  const db = openSqliteDatabase(":memory:", research);
  try {
    assert.equal(
      (
        db
          .prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'research_manifests'")
          .get() as { n: bigint }
      ).n,
      1n,
    );
    assert.equal(
      (
        db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'events'").get() as {
          n: bigint;
        }
      ).n,
      0n,
    );
  } finally {
    db.close();
  }
});

test("signed zero and flat-return record identities survive canonical freezing", async () => {
  assert.equal(identity("probe", -0), identity("probe", freeze(-0)));
  const input = await syntheticInput();
  const flat = {
    ...input,
    dataset: {
      ...input.dataset,
      bars: input.dataset.bars.map((b) =>
        b.instrumentId === "SYN" && b.endMs > input.cutoffMs ? { ...b, close: 102 } : b,
      ),
    },
  };
  const result = evaluateManifest(freezeManifest(protocol, [flat]));
  for (const trial of result.trials) {
    const { id, ...body } = trial;
    assert.equal(identity("trial", body), id);
  }
  assert.ok(result.trials.some((t) => t.direction === -1 && t.grossBps === 0));
});
