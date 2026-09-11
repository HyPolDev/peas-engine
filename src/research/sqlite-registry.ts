import { assertOwnedSqliteDatabase, type SqliteDatabase } from "../adapters/sqlite/database.js";
import { canonicalJson } from "../core/json.js";
import { identity, json, parseResearchJson } from "./contracts.js";
import { type Evaluation, evaluateManifest, freezeManifest, type Manifest } from "./engine.js";

/** Uses the existing SQLite owner and migration runner; no network/effect adapter exists here. */
export class ResearchRegistry {
  constructor(private readonly database: SqliteDatabase) {
    assertOwnedSqliteDatabase(database);
  }

  register(input: Manifest): string {
    const manifest = freezeManifest(input.protocol, input.inputs);
    if (manifest.id !== input.id) throw new Error("research-manifest-tampered");
    const body = canonicalJson(json(manifest));
    const existing = this.database
      .prepare("SELECT id, body FROM research_manifests WHERE epoch = ?")
      .get(manifest.protocol.epoch) as { id: string; body: string } | undefined;
    if (existing !== undefined) {
      if (existing.id !== manifest.id || existing.body !== body)
        throw new Error("research-epoch-frozen-human-gate");
      return existing.id;
    }
    this.database
      .prepare("INSERT INTO research_manifests(id, epoch, body) VALUES (?, ?, ?)")
      .run(manifest.id, manifest.protocol.epoch, body);
    return manifest.id;
  }

  manifest(id: string): Manifest {
    const row = this.database.prepare("SELECT body FROM research_manifests WHERE id = ?").get(id) as
      | { body: string }
      | undefined;
    if (row === undefined) throw new Error("research-manifest-not-registered");
    const raw = parseResearchJson(row.body) as Manifest;
    const verified = freezeManifest(raw.protocol, raw.inputs);
    if (verified.id !== id || raw.id !== id) throw new Error("research-manifest-corrupt");
    return verified;
  }

  private append(manifestId: string, kind: string, key: string, value: unknown): void {
    const body = canonicalJson(json(value));
    const id = identity("registry-record", { manifestId, kind, key, body });
    const prior = this.database
      .prepare(
        "SELECT id FROM research_records WHERE manifest_id = ? AND kind = ? AND record_key = ?",
      )
      .get(manifestId, kind, key) as { id: string } | undefined;
    if (prior !== undefined) {
      if (prior.id !== id) throw new Error("research-record-conflict");
      return;
    }
    this.database
      .prepare(
        "INSERT INTO research_records(id, manifest_id, kind, record_key, body) VALUES (?, ?, ?, ?, ?)",
      )
      .run(id, manifestId, kind, key, body);
  }

  /** Attempt-start survives interruption. Resume appends a new attempt and retains the old one. */
  run(id: string): Evaluation {
    const manifest = this.manifest(id);
    const completed = this.database
      .prepare("SELECT body FROM research_records WHERE manifest_id = ? AND kind = 'evaluation'")
      .get(id);
    if (completed !== undefined) return this.replay(id);
    const attempt = this.database
      .transaction(() => {
        const row = this.database
          .prepare(
            "SELECT count(*) AS n FROM research_records WHERE manifest_id = ? AND kind = 'attempt-start'",
          )
          .get(id) as { n: bigint };
        const key = String(row.n + 1n);
        this.append(id, "attempt-start", key, {
          manifestId: id,
          attempt: key,
          status: "started",
          protocolId: identity("protocol", manifest.protocol),
        });
        return key;
      })
      .immediate();
    try {
      const result = evaluateManifest(manifest);
      this.database
        .transaction(() => {
          for (const kind of ["features", "labels", "trials", "signals"] as const)
            for (const record of result[kind]) this.append(id, kind, record.id, record);
          this.append(id, "evaluation", "result", result);
          this.append(id, "attempt-end", attempt, {
            manifestId: id,
            attempt,
            status: "completed",
            evaluationId: result.id,
          });
        })
        .immediate();
      return result;
    } catch (error) {
      this.append(id, "attempt-end", attempt, {
        manifestId: id,
        attempt,
        status: "failed",
        reason: "deterministic-evaluation-or-persistence-failed",
      });
      throw error;
    }
  }

  replay(id: string): Evaluation {
    const expected = evaluateManifest(this.manifest(id));
    const records = this.records(id);
    const result = records.find((r) => r.kind === "evaluation");
    if (result === undefined || result.body !== canonicalJson(json(expected)))
      throw new Error("research-replay-mismatch");
    for (const kind of ["features", "labels", "trials", "signals"] as const) {
      const saved = records.filter((r) => r.kind === kind);
      if (
        saved.length !== expected[kind].length ||
        expected[kind].some(
          (r) => !saved.some((s) => s.record_key === r.id && s.body === canonicalJson(json(r))),
        )
      )
        throw new Error("research-replay-inventory-mismatch");
    }
    return expected;
  }

  records(id: string): { kind: string; record_key: string; body: string }[] {
    return this.database
      .prepare(
        "SELECT kind, record_key, body FROM research_records WHERE manifest_id = ? ORDER BY sequence",
      )
      .all(id) as { kind: string; record_key: string; body: string }[];
  }
}
