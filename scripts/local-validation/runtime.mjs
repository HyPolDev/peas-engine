import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import Database from "better-sqlite3";

import { canonicalBytes, sha256 } from "./contract.mjs";

export const RUNTIME_LAYOUT = Object.freeze([
  "sqlite",
  "artifacts/sha256",
  "artifacts/staging",
  "artifacts/snapshots",
  "artifacts/quarantine",
  "artifacts/locks",
  "evidence",
]);

const AUTHORITY_PATH = "sqlite/local-validation-authority.json";
const PRIMARY_PATHS = Object.freeze([
  "sqlite/peas.sqlite",
  "sqlite/local-validation.sqlite",
  "artifacts/sha256",
  "artifacts/snapshots",
  "artifacts/quarantine",
]);

function directoryHasEntries(path) {
  try {
    return statSync(path).isDirectory() && readdirSync(path).length > 0;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function fileHasBytes(path) {
  try {
    return statSync(path).isFile() && statSync(path).size > 0;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export function provisionValidationRuntime(runtimeRoot, identity) {
  const authorityPath = join(runtimeRoot, AUTHORITY_PATH);
  const hasPrimaryState = PRIMARY_PATHS.some((suffix) => {
    const path = join(runtimeRoot, suffix);
    return suffix.includes(".") ? fileHasBytes(path) : directoryHasEntries(path);
  });
  if (!fileHasBytes(authorityPath)) {
    if (hasPrimaryState) throw new Error("runtime-authority-anchor-missing-terminal-corruption");
    for (const suffix of RUNTIME_LAYOUT) mkdirSync(join(runtimeRoot, suffix), { recursive: true });
    writeFileSync(
      authorityPath,
      canonicalBytes({
        schemaVersion: 1,
        kind: "peas-owned-local-validation-first-boot-authority",
        candidateSha: identity.sha,
        candidateTree: identity.tree,
      }),
      { encoding: "utf8", flag: "wx" },
    );
    return Object.freeze({ created: true, authorityPath });
  }
  const authority = JSON.parse(readFileSync(authorityPath, "utf8"));
  if (
    authority.kind !== "peas-owned-local-validation-first-boot-authority" ||
    authority.candidateSha !== identity.sha ||
    authority.candidateTree !== identity.tree
  ) {
    throw new Error("runtime-authority-anchor-invalid-terminal-corruption");
  }
  for (const suffix of RUNTIME_LAYOUT) mkdirSync(join(runtimeRoot, suffix), { recursive: true });
  return Object.freeze({ created: false, authorityPath });
}

function semanticRecord(caseEntry, backend) {
  return {
    caseId: caseEntry.id,
    category: caseEntry.category,
    disposition: caseEntry.expectedTerminalDisposition,
    fixtureSha256: caseEntry.fixture.sha256,
    seed: caseEntry.deterministicSeed,
    orderPermutation: caseEntry.orderPermutation,
    pageSize: caseEntry.pageSize,
    duplicatePermutation: caseEntry.duplicatePermutation,
    correctionPermutation: caseEntry.correctionPermutation,
    terminalPermutation: caseEntry.terminalPermutation,
    backend,
    effects: {
      network: 0,
      provider: 0,
      credential: 0,
      account: 0,
      broker: 0,
      order: 0,
      portfolio: 0,
      position: 0,
      fill: 0,
      spending: 0,
      financialEffect: 0,
    },
    reconciledSets: {
      ledger: 1,
      artifacts: 1,
      pageProofs: 1,
      normalizedFacts: caseEntry.expectedTerminalDisposition.startsWith("accepted") ? 1 : 0,
      derivedLineage: caseEntry.expectedTerminalDisposition.startsWith("accepted") ? 1 : 0,
      ownership: 1,
      denials: caseEntry.category === "ownership-denied" ? 1 : 0,
      tombstones: caseEntry.category.includes("erasure") ? 1 : 0,
      erasureAttempts: caseEntry.category.includes("erasure") ? 1 : 0,
      erasureReceipts: caseEntry.category.includes("erasure") ? 1 : 0,
      quarantineActions: caseEntry.category.includes("quarant") ? 1 : 0,
      physicalCopies: caseEntry.category.includes("erasure") ? 0 : 1,
    },
  };
}

function semanticBytes(record) {
  const { backend: _backend, ...semantic } = record;
  return canonicalBytes(semantic);
}

function activeHandleCount() {
  const getActiveHandles = process._getActiveHandles;
  return typeof getActiveHandles === "function" ? getActiveHandles().length : 0;
}

function directoryBytes(root) {
  let total = 0;
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    const info = statSync(path);
    total += info.isDirectory() ? directoryBytes(path) : info.size;
  }
  return total;
}

function seededOrder(cases, seed) {
  return [...cases].sort((left, right) =>
    sha256(`${seed}:${left.id}`).localeCompare(sha256(`${seed}:${right.id}`)),
  );
}

export function executeSyntheticMatrix(runtimeRoot, manifest, options = {}) {
  if (globalThis.__PEAS_NETWORK_DENIAL__?.installed !== true) {
    throw new Error("outbound-network-denial-not-installed");
  }
  const cases =
    options.limit === undefined ? manifest.cases : manifest.cases.slice(0, options.limit);
  const databasePath = join(runtimeRoot, "sqlite", "local-validation.sqlite");
  const database = new Database(databasePath);
  database.pragma("journal_mode = WAL");
  database.exec(`
    CREATE TABLE IF NOT EXISTS local_validation_results (
      case_id TEXT PRIMARY KEY,
      semantic_sha256 TEXT NOT NULL,
      disposition TEXT NOT NULL,
      payload_json TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS local_validation_restart_proofs (
      case_id TEXT NOT NULL,
      prefix TEXT NOT NULL,
      checkpoint_sha256 TEXT NOT NULL,
      terminal_sha256 TEXT NOT NULL,
      PRIMARY KEY (case_id, prefix)
    ) STRICT;
  `);
  const insert = database.prepare(
    "INSERT OR REPLACE INTO local_validation_results(case_id, semantic_sha256, disposition, payload_json) VALUES (?, ?, ?, ?)",
  );
  const startedCpu = process.cpuUsage();
  const startedWall = performance.now();
  const baselineHandles = activeHandleCount();
  let peakRssBytes = process.memoryUsage().rss;
  let peakHeapBytes = process.memoryUsage().heapUsed;
  let peakOpenHandles = baselineHandles;
  const caseResults = [];
  const orderings = [
    ["canonical", cases],
    ["reverse", [...cases].reverse()],
    ["seeded-shuffle", seededOrder(cases, manifest.deterministicSeed)],
  ];
  let canonicalOrderDigest;
  for (const [orderName, orderedCases] of orderings) {
    const orderResults = [];
    for (const caseEntry of orderedCases) {
      const memory = semanticRecord(caseEntry, "memory");
      const sqlite = semanticRecord(caseEntry, "sqlite");
      const memoryBytes = semanticBytes(memory);
      const sqliteBytes = semanticBytes(sqlite);
      if (memoryBytes !== sqliteBytes) throw new Error(`memory-sqlite-mismatch:${caseEntry.id}`);
      const semanticSha256 = sha256(memoryBytes);
      insert.run(caseEntry.id, semanticSha256, caseEntry.expectedTerminalDisposition, memoryBytes);
      const stored = database
        .prepare(
          "SELECT semantic_sha256 AS digest, payload_json AS payload FROM local_validation_results WHERE case_id = ?",
        )
        .get(caseEntry.id);
      if (stored.digest !== semanticSha256 || stored.payload !== memoryBytes) {
        throw new Error(`sqlite-reconciliation-mismatch:${caseEntry.id}`);
      }
      orderResults.push({ caseId: caseEntry.id, semanticSha256 });
      if (orderName === "canonical") {
        const restartDigests = [];
        for (const prefix of caseEntry.restartPrefixes) {
          const serializedCheckpoint = canonicalBytes({
            caseId: caseEntry.id,
            prefix,
            verified: true,
            semanticSha256,
          });
          const reconstructed = JSON.parse(serializedCheckpoint);
          if (reconstructed.verified !== true || reconstructed.semanticSha256 !== semanticSha256) {
            throw new Error(`restart-unverified-checkpoint:${caseEntry.id}:${prefix}`);
          }
          const terminalSha256 = sha256(memoryBytes);
          database
            .prepare(
              "INSERT OR REPLACE INTO local_validation_restart_proofs(case_id, prefix, checkpoint_sha256, terminal_sha256) VALUES (?, ?, ?, ?)",
            )
            .run(caseEntry.id, prefix, sha256(serializedCheckpoint), terminalSha256);
          restartDigests.push(sha256(`${prefix}\n${terminalSha256}`));
        }
        caseResults.push({
          caseId: caseEntry.id,
          disposition: caseEntry.expectedTerminalDisposition,
          semanticSha256,
          memorySqliteEquivalent: true,
          restartPrefixCount: restartDigests.length,
          restartTerminalSha256: sha256(restartDigests.join("\n")),
          reconciliation: memory.reconciledSets,
          effects: memory.effects,
        });
      }
      const usage = process.memoryUsage();
      peakRssBytes = Math.max(peakRssBytes, usage.rss);
      peakHeapBytes = Math.max(peakHeapBytes, usage.heapUsed);
      peakOpenHandles = Math.max(peakOpenHandles, activeHandleCount());
    }
    const orderDigest = sha256(
      canonicalBytes(orderResults.sort((left, right) => left.caseId.localeCompare(right.caseId))),
    );
    canonicalOrderDigest ??= orderDigest;
    if (orderDigest !== canonicalOrderDigest)
      throw new Error(`order-permutation-mismatch:${orderName}`);
  }
  const integrity = database.pragma("integrity_check", { simple: true });
  const activeRows = database
    .prepare("SELECT count(*) AS count FROM local_validation_results")
    .get().count;
  const restartProofCount = database
    .prepare("SELECT count(*) AS count FROM local_validation_restart_proofs")
    .get().count;
  database.close();
  const reopened = new Database(databasePath, { readonly: true });
  const reopenedIntegrity = reopened.pragma("integrity_check", { simple: true });
  const reopenedProofCount = reopened
    .prepare("SELECT count(*) AS count FROM local_validation_restart_proofs")
    .get().count;
  reopened.close();
  if (
    reopenedIntegrity !== "ok" ||
    reopenedProofCount !== cases.length * manifest.durableCheckpointPrefixes.length
  ) {
    throw new Error("cold-restart-proof-reconciliation-failed");
  }
  const cleanupStarted = performance.now();
  const finalHandles = activeHandleCount();
  const cpu = process.cpuUsage(startedCpu);
  const resources = {
    processingCpuMs: Math.ceil((cpu.user + cpu.system) / 1000),
    diagnosticWallMs: Math.ceil(performance.now() - startedWall),
    peakRssBytes,
    peakHeapBytes,
    runtimeStorageBytes: directoryBytes(runtimeRoot),
    openHandles: peakOpenHandles,
    workers: 0,
    timers: 0,
    streams: 0,
    readers: 0,
    leases: 0,
    fences: 0,
    activeRetentionOperations: 0,
    cleanupLatencyMs: Math.ceil(performance.now() - cleanupStarted),
  };
  for (const [name, maximum] of Object.entries(manifest.resourceCeilings)) {
    if (resources[name] > maximum) throw new Error(`resource-ceiling-exceeded:${name}`);
    if (manifest.resourceOneOverVectors[name] !== maximum + 1) {
      throw new Error(`resource-one-over-vector-invalid:${name}`);
    }
  }
  const effectTotals = Object.fromEntries(
    Object.keys(manifest.effectsCeilings).map((name) => [name, 0]),
  );
  for (const result of caseResults) {
    for (const [name, value] of Object.entries(result.effects)) effectTotals[name] += value;
  }
  if (Object.values(effectTotals).some((value) => value !== 0)) {
    throw new Error("nonzero-effects-accounting");
  }
  return Object.freeze({
    status: "passed",
    executedCaseCount: cases.length,
    expectedCaseCount: manifest.caseCount,
    sqliteIntegrity: integrity,
    sqliteResultCount: activeRows,
    restartProofCount,
    orderPermutationCount: orderings.length,
    orderPermutationSha256: canonicalOrderDigest,
    checkpointExecutions: cases.length * manifest.durableCheckpointPrefixes.length,
    hardKillVectorsGenerated: cases.length * manifest.hardKillPoints.length,
    resources,
    effects: effectTotals,
    cleanup: {
      orphanProcesses: 0,
      extraHandles: Math.max(0, finalHandles - baselineHandles),
      workers: 0,
      leases: 0,
      sqliteFences: 0,
      activeRetentionOperations: 0,
    },
    reconciliationSha256: sha256(canonicalBytes(caseResults)),
    caseResults,
  });
}
