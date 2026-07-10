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

for (const mutant of mutants) {
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
    const mutatedPath = join(resolvedTemporary, mutant.file);
    let source = readFileSync(mutatedPath, "utf8");
    for (const change of mutant.changes) source = replaceChecked(source, change, mutant.name);
    writeFileSync(mutatedPath, source, "utf8");

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

console.log(`Targeted mutation gate passed: ${mutants.length}/${mutants.length} killed`);
writeFileSync(
  join(workspace, "audit-mutation-results.json"),
  `${JSON.stringify(
    {
      resultVersion: 1,
      status: "passed",
      killed: mutants.length,
      total: mutants.length,
      mutants: mutants.map(({ name, test }) => ({ name, test })),
    },
    null,
    2,
  )}\n`,
  "utf8",
);
