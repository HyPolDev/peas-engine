import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const workspace = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const typescriptCli = join(workspace, "node_modules", "typescript", "bin", "tsc");

const mutants = [
  {
    name: "effect-policy-gate",
    file: "src/core/processor.ts",
    changes: [
      {
        from: 'if (manifest.effectsAllowed && manifest.kind !== "live") {',
        to: 'if (false && manifest.effectsAllowed && manifest.kind !== "live") {',
      },
    ],
    test: "run-policy.test.js",
  },
  {
    name: "event-chain-verification",
    file: "src/core/event.ts",
    changes: [
      {
        from: "if (validated.eventHash !== computeEventHash(validated)) {",
        to: "if (false && validated.eventHash !== computeEventHash(validated)) {",
      },
    ],
    test: "audit.test.js",
  },
  {
    name: "migration-plan-transaction",
    file: "src/adapters/sqlite/database.ts",
    changes: [
      { from: "  database\n    .transaction(() => {", to: "  (() => {" },
      { from: "    })\n    .immediate();", to: "    })();" },
    ],
    test: "sqlite-integrity.test.js",
  },
  {
    name: "analysis-branch-cap",
    file: "src/domain/earnings-cluster/reducer.ts",
    changes: [
      {
        from: "cluster.analysisBranches.length >= context.config.maxAnalysisBranches",
        to: "cluster.analysisBranches.length > context.config.maxAnalysisBranches",
        expectedOccurrences: 2,
        occurrence: 1,
      },
    ],
    test: "reducer-contracts.test.js",
  },
  {
    name: "lease-fencing-equality",
    file: "src/domain/earnings-cluster/reducer.ts",
    changes: [
      {
        from: "payload.fencingToken <= branch.expectedFencingToken",
        to: "payload.fencingToken < branch.expectedFencingToken",
      },
      {
        from: "payload.attempt <= branch.expectedAttempt",
        to: "payload.attempt < branch.expectedAttempt",
      },
    ],
    test: "property.test.js",
  },
  {
    name: "inert-own-property-enumeration",
    file: "src/core/json.ts",
    changes: [
      {
        from: "const ownKeys = Reflect.ownKeys(value);",
        to: "const ownKeys = Object.keys(value);",
        expectedOccurrences: 2,
        occurrence: 1,
      },
    ],
    test: "json-inert-boundary.test.js",
  },
  {
    name: "strict-processing-commit-shape",
    file: "src/core/processor.ts",
    changes: [
      {
        from: "const parsed = processingCommitSchema.parse(schemaValue);",
        to: "const parsed = schemaValue as unknown as z.infer<typeof processingCommitSchema>;",
      },
    ],
    test: "processing-store-boundary.test.js",
  },
  {
    name: "memory-stored-event-verification",
    edits: [
      {
        file: "src/core/processor.ts",
        changes: [
          {
            from: "event: validateStoredEvent(parsed.event),",
            to: "event: parsed.event as StoredEvent,",
          },
          {
            from: "verifyStoredEvent(value.event);",
            to: "if (false) verifyStoredEvent(value.event);",
          },
        ],
      },
      {
        file: "src/adapters/memory/processing-store.ts",
        changes: [
          {
            from: "const persistedEvent = validateStoredEvent(storedEvent);",
            to: "const persistedEvent = storedEvent;",
          },
          {
            from: "verifyStoredEvent(persistedEvent);",
            to: "if (false) verifyStoredEvent(persistedEvent);",
          },
        ],
      },
    ],
    test: "processing-store-boundary.test.js",
  },
  {
    name: "stored-output-category-contract",
    edits: [
      {
        file: "src/core/processor.ts",
        changes: [
          {
            from: "const parsed = storedOutputSchema.parse(processorSchemaSnapshot(value));",
            to: "const parsed = processorSchemaSnapshot(value) as unknown as z.infer<typeof storedOutputSchema>;",
          },
          {
            from: `const body = validateStoredOutputBody(parsed.category, parsed.body, {
    runId: parsed.runId,
    dedupeKey: parsed.dedupeKey,
    notBeforeLogicalMs: parsed.notBeforeLogicalMs,
  });`,
            to: "const body = parsed.body as JsonObject;",
            expectedOccurrences: 2,
            occurrence: 2,
          },
        ],
      },
      {
        file: "src/adapters/sqlite/processing-store.ts",
        changes: [
          {
            from: `const body = validateStoredOutputBody(row.category, parsedBody, {
      runId: row.run_id,
      dedupeKey: row.dedupe_key,
      notBeforeLogicalMs,
    });`,
            to: "const body = parsedBody;",
          },
        ],
      },
    ],
    test: "sqlite-output-contracts.test.js",
  },
  {
    name: "migration-output-upgrade-preflight",
    file: "migrations/004_processing_output_upgrade_guards.sql",
    changes: [
      {
        from: "SELECT CASE\n  WHEN EXISTS (",
        to: "SELECT CASE\n  WHEN 0 AND EXISTS (",
      },
    ],
    test: "sqlite-output-contracts.test.js",
  },
  {
    name: "canonical-aggregate-state-read",
    file: "src/adapters/sqlite/processing-store.ts",
    changes: [
      {
        from: "if (canonicalJson(state) !== row.state_json) {",
        to: "if (false && canonicalJson(state) !== row.state_json) {",
      },
    ],
    test: "sqlite-output-contracts.test.js",
  },
  {
    name: "portable-aggregate-identifier",
    file: "src/core/processor.ts",
    changes: [
      {
        from: "return aggregateIdSchema.parse(value);",
        to: "return String(value);",
      },
    ],
    test: "processing-store-boundary.test.js",
  },
  {
    name: "canonical-dedupe-tuple",
    file: "src/adapters/memory/processing-store.ts",
    changes: [
      {
        from: "const key = computeOutputDedupeIdentity(output.runId, output.category, output.dedupeKey);",
        to: 'const key = output.runId + "\\u0000" + output.category + "\\u0000" + output.dedupeKey;',
      },
    ],
    test: "processing-store-boundary.test.js",
  },
  {
    name: "serialized-json-byte-preflight",
    file: "src/core/json.ts",
    changes: [
      {
        from: "assertSerializedJsonWithinLimit(serialized, limits.maxCanonicalBytes, rootPath);",
        to: "if (false) assertSerializedJsonWithinLimit(serialized, limits.maxCanonicalBytes, rootPath);",
      },
    ],
    test: "json-inert-boundary.test.js",
  },
  {
    name: "vault-lease-preinstall-fence",
    category: "vault",
    file: "src/adapters/artifacts/durable-artifact-store.ts",
    changes: [
      {
        from: "await this.#lease.renewAndAssert();\n      let converged = false;",
        to: "let converged = false;",
      },
    ],
    test: "artifact-vault.test.js",
  },
  {
    name: "vault-exact-redelivery-content",
    category: "vault",
    file: "src/adapters/artifacts/durable-artifact-store.ts",
    changes: [
      {
        from: 'hash.digest("hex") !== completed.artifact.digest',
        to: "completed.artifact.digest !== completed.artifact.digest",
      },
    ],
    test: "artifact-vault.test.js",
  },
  {
    name: "vault-corrupt-read-byte-cap",
    category: "vault",
    file: "src/adapters/artifacts/durable-artifact-store.ts",
    changes: [
      {
        from: "if (sizeBytes > artifact.sizeBytes) {",
        to: "if (sizeBytes > Number.MAX_SAFE_INTEGER) {",
      },
    ],
    test: "artifact-vault.test.js",
  },
  {
    name: "vault-verified-before-delivery",
    category: "vault",
    file: "src/adapters/artifacts/durable-artifact-store.ts",
    changes: [
      {
        from: "if (digestRead !== artifact.digest || sizeBytes !== artifact.sizeBytes) {",
        to: "if (artifact.digest !== artifact.digest || sizeBytes !== artifact.sizeBytes) {",
      },
    ],
    test: "artifact-vault.test.js",
  },
  {
    name: "vault-relational-reconciliation",
    category: "vault",
    file: "src/adapters/artifacts/sqlite-artifact-repository.ts",
    changes: [
      {
        from: "if (pairs.some(([canonical, relational]) => canonical !== relational))",
        to: "if (false && pairs.some(([canonical, relational]) => canonical !== relational))",
      },
    ],
    test: "artifact-vault.test.js",
  },
  {
    name: "vault-orphan-digest-classification",
    category: "vault",
    file: "src/adapters/artifacts/durable-artifact-store.ts",
    changes: [
      {
        from: 'if (verified.digest !== name) throw new Error("digest mismatch");',
        to: 'if (false && verified.digest !== name) throw new Error("digest mismatch");',
      },
    ],
    test: "artifact-vault.test.js",
  },
  {
    name: "vault-filesystem-ancestor-rejection",
    category: "vault",
    file: "src/adapters/artifacts/durable-artifact-store.ts",
    changes: [
      {
        from: "if (!info.isDirectory() || info.isSymbolicLink() || info.dev !== device)",
        to: "if (info.dev !== device)",
      },
    ],
    test: "artifact-vault.test.js",
  },
  {
    name: "vault-reconciliation-item-budget",
    category: "vault",
    file: "src/adapters/artifacts/durable-artifact-store.ts",
    changes: [{ from: "processed >= maxItems ||", to: "false ||" }],
    test: "artifact-vault.test.js",
  },
  {
    name: "vault-nested-runtime-ancestor-rejection",
    category: "vault",
    file: "src/adapters/artifacts/durable-artifact-store.ts",
    changes: [
      {
        from: "for (const ancestor of ancestors.reverse()) {",
        to: "for (const ancestor of [resolved]) {",
      },
    ],
    test: "artifact-vault.test.js",
  },
  {
    name: "vault-transaction-fresh-expiry",
    category: "vault",
    file: "src/adapters/artifacts/sqlite-artifact-repository.ts",
    changes: [{ from: "const nowMs = fence.nowMs();", to: "const nowMs = 0;" }],
    test: "artifact-vault.test.js",
  },
  {
    name: "vault-opaque-identifier-persistence",
    category: "vault",
    file: "src/artifacts/validation.ts",
    changes: [
      {
        from:
          "return `" +
          "$" +
          "{prefix}_" +
          "$" +
          "{canonicalHash(`peas/artifact-" +
          "$" +
          "{kind}-identifier/v1`, { value })}`;",
        to: "return `" + "$" + "{prefix}_" + "$" + "{value}`;",
      },
    ],
    test: "artifact-vault.test.js",
  },
  {
    name: "vault-raw-repository-identity-acceptance",
    category: "vault",
    file: "src/adapters/artifacts/sqlite-artifact-repository.ts",
    changes: [{ from: "assertPersistedRetrievalAttempt(attempt);", to: "" }],
    test: "artifact-vault.test.js",
  },
  {
    name: "vault-domain-prefix-sql-validation",
    category: "vault",
    file: "migrations/005_artifact_vault.sql",
    changes: [
      {
        from: "substr(provider_revision_id, 1, 5) = 'rev1_' AND",
        to: "1 AND",
        expectedOccurrences: 2,
        occurrence: 1,
      },
    ],
    test: "artifact-vault.test.js",
  },
  {
    name: "vault-redelivery-outcome-reconciliation",
    category: "vault",
    file: "src/adapters/artifacts/sqlite-artifact-repository.ts",
    changes: [
      {
        from: "const outcome = this.#getOutcome(attemptId);",
        to: 'const outcome = { outcome: "succeeded" as const };',
      },
    ],
    test: "artifact-vault.test.js",
  },
  {
    name: "vault-stale-failure-outcome-fence",
    category: "vault",
    edits: [
      {
        file: "src/adapters/artifacts/durable-artifact-store.ts",
        changes: [
          {
            from: "await this.#lease.renewAndAssert();",
            to: "",
            expectedOccurrences: 9,
            occurrence: 4,
          },
        ],
      },
      {
        file: "src/adapters/artifacts/sqlite-artifact-repository.ts",
        changes: [
          {
            from: "this.assertWriter(fence);",
            to: "",
            expectedOccurrences: 8,
            occurrence: 5,
          },
        ],
      },
    ],
    test: "artifact-vault.test.js",
  },
  {
    name: "vault-stale-reconciliation-fence",
    category: "vault",
    edits: [
      {
        file: "src/adapters/artifacts/durable-artifact-store.ts",
        changes: [
          {
            from: "await this.#lease.renewAndAssert();",
            to: "",
            expectedOccurrences: 9,
            occurrence: 5,
          },
        ],
      },
      {
        file: "src/adapters/artifacts/sqlite-artifact-repository.ts",
        changes: [
          {
            from: "this.assertWriter(fence);",
            to: "",
            expectedOccurrences: 8,
            occurrence: 1,
          },
        ],
      },
    ],
    test: "artifact-vault.test.js",
  },
  {
    name: "vault-success-transaction-atomicity",
    category: "vault",
    file: "src/adapters/artifacts/sqlite-artifact-repository.ts",
    changes: [
      {
        from: "return this.#database\n      .transaction(() => {\n        this.assertWriter(fence);\n        const attempt = this.getAttempt(observation.attemptId);",
        to: "return (() => {\n        this.assertWriter(fence);\n        const attempt = this.getAttempt(observation.attemptId);",
      },
      {
        from: "return disposition;\n      })\n      .immediate();",
        to: "return disposition;\n      })();",
      },
    ],
    test: "artifact-vault.test.js",
  },
  {
    name: "vault-incident-update-immutability",
    category: "vault",
    file: "migrations/005_artifact_vault.sql",
    changes: [
      {
        from: "CREATE TRIGGER artifact_incidents_no_update BEFORE UPDATE ON artifact_integrity_incidents",
        to: "CREATE TRIGGER artifact_incidents_no_update BEFORE UPDATE ON artifact_integrity_incidents WHEN 0",
      },
    ],
    test: "artifact-vault.test.js",
  },
  {
    name: "vault-reconciliation-sql-limit",
    category: "vault",
    file: "src/adapters/artifacts/sqlite-artifact-repository.ts",
    changes: [
      {
        from: "WHERE attempt_id > ? ORDER BY attempt_id LIMIT ?",
        to: "WHERE attempt_id > ? ORDER BY attempt_id",
      },
      {
        from: ".all(afterKey, limit)",
        to: ".all(afterKey)",
        expectedOccurrences: 2,
        occurrence: 1,
      },
    ],
    test: "artifact-vault.test.js",
  },
  {
    name: "vault-reconciliation-generation-check",
    category: "vault",
    file: "src/adapters/artifacts/sqlite-artifact-repository.ts",
    changes: [
      {
        from: "WHERE singleton = 1 AND generation = ? AND cursor_token = ?",
        to: "WHERE singleton = 1 AND ? IS NOT NULL AND ? IS NOT NULL",
        expectedOccurrences: 2,
        occurrence: 1,
      },
    ],
    test: "artifact-vault.test.js",
  },
  {
    name: "vault-unbounded-directory-enumeration",
    category: "vault",
    file: "src/adapters/artifacts/durable-artifact-store.ts",
    changes: [
      {
        from: "if (names.length > MAX_RECONCILIATION_DIRECTORY_ENTRIES)",
        to: "if (false && names.length > MAX_RECONCILIATION_DIRECTORY_ENTRIES)",
      },
    ],
    test: "artifact-vault.test.js",
  },
  {
    name: "vault-cursor-advance-before-action",
    category: "vault",
    file: "src/adapters/artifacts/durable-artifact-store.ts",
    changes: [
      {
        from: "await this.#quarantine(path, id);",
        to: "await advance(state.phase, 0, name);\n            await this.#quarantine(path, id);",
        expectedOccurrences: 3,
        occurrence: 1,
      },
    ],
    test: "artifact-vault.test.js",
  },
];

function replaceChecked(source, change, mutantName) {
  const pieces = source.split(change.from);
  const occurrences = pieces.length - 1;
  const expectedOccurrences = change.expectedOccurrences ?? 1;
  if (occurrences !== expectedOccurrences) {
    throw new Error(
      `${mutantName}: expected ${expectedOccurrences} mutation anchors, found ${occurrences}`,
    );
  }
  const occurrence = change.occurrence ?? 1;
  if (occurrence < 1 || occurrence > occurrences) {
    throw new Error(`${mutantName}: requested mutation occurrence is out of range`);
  }
  let seen = 0;
  return pieces
    .map((piece, index) => {
      if (index === pieces.length - 1) return piece;
      seen += 1;
      return `${piece}${seen === occurrence ? change.to : change.from}`;
    })
    .join("");
}

function copyAuditWorkspace(target) {
  for (const entry of [
    "src",
    "test",
    "fixtures",
    "migrations",
    "package.json",
    "tsconfig.json",
    "tsconfig.build.json",
  ]) {
    cpSync(join(workspace, entry), join(target, entry), { recursive: true });
  }
}

function run(command, args, cwd) {
  return spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
  });
}

const selectedMutants = process.env["PEAS_MUTATION_NAME"]
  ? mutants.filter(({ name }) => name === process.env["PEAS_MUTATION_NAME"])
  : process.env["PEAS_MUTATION_CATEGORY"] === "vault"
    ? mutants.filter(({ category }) => category === "vault")
    : mutants;
for (const mutant of selectedMutants) {
  const temporary = mkdtempSync(join(workspace, ".audit-mutation-"));
  const resolvedTemporary = resolve(temporary);
  if (
    !resolvedTemporary.startsWith(`${workspace}${sep}`) ||
    !resolvedTemporary.includes(".audit-mutation-")
  ) {
    throw new Error(`Unsafe mutation workspace ${resolvedTemporary}`);
  }
  try {
    copyAuditWorkspace(resolvedTemporary);
    const edits = mutant.edits ?? [{ file: mutant.file, changes: mutant.changes }];
    for (const edit of edits) {
      const mutatedPath = join(resolvedTemporary, edit.file);
      let source = readFileSync(mutatedPath, "utf8");
      for (const change of edit.changes) source = replaceChecked(source, change, mutant.name);
      writeFileSync(mutatedPath, source, "utf8");
    }

    const compile = run(
      process.execPath,
      [typescriptCli, "-p", "tsconfig.build.json"],
      resolvedTemporary,
    );
    if (compile.status !== 0) {
      throw new Error(
        `${mutant.name}: mutant did not compile\n${compile.stdout ?? ""}${compile.stderr ?? ""}`,
      );
    }
    const testFile = join(resolvedTemporary, "dist", "test", mutant.test);
    const tested = run(process.execPath, ["--test", testFile], resolvedTemporary);
    if (tested.status === 0) {
      throw new Error(`${mutant.name}: mutation survived ${relative(workspace, testFile)}`);
    }
    console.log(`Mutation killed: ${mutant.name}`);
  } finally {
    rmSync(resolvedTemporary, { recursive: true, force: true });
  }
}

const vaultMutants = mutants.filter(({ category }) => category === "vault");
const kernelMutants = mutants.filter(({ category }) => category !== "vault");
console.log(`Targeted mutation gate passed: ${mutants.length}/${mutants.length} killed`);
console.log(`Kernel mutations: ${kernelMutants.length}/${kernelMutants.length} killed`);
console.log(`Artifact-vault mutations: ${vaultMutants.length}/${vaultMutants.length} killed`);
writeFileSync(
  join(workspace, "audit-mutation-results.json"),
  `${JSON.stringify(
    {
      resultVersion: 1,
      status: "passed",
      killed: mutants.length,
      total: mutants.length,
      kernelKilled: kernelMutants.length,
      kernelTotal: kernelMutants.length,
      vaultKilled: vaultMutants.length,
      vaultTotal: vaultMutants.length,
      mutants: mutants.map(({ name, test }) => ({ name, test })),
    },
    null,
    2,
  )}\n`,
  "utf8",
);
