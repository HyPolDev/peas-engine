import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  acquireGateLock,
  canonicalBytes,
  compileManifest,
  listFiles,
  platformIdentity,
  readJson,
  repositoryIdentity,
  verifyCandidate,
  verifyFrozenManifest,
} from "../../scripts/local-validation/contract.mjs";
import {
  executeSyntheticMatrix,
  provisionValidationRuntime,
} from "../../scripts/local-validation/runtime.mjs";
import { executeHardKillMatrix } from "../../scripts/local-validation/hard-kill.mjs";

const [operation, argument] = process.argv.slice(2);

if (operation === "manifest") {
  const { manifest, digest } = verifyFrozenManifest();
  process.stdout.write(`${JSON.stringify({ count: manifest.caseCount, digest })}\n`);
} else if (operation === "compile") {
  process.stdout.write(canonicalBytes(compileManifest(readJson(argument))));
} else if (operation === "candidate") {
  process.stdout.write(`${JSON.stringify(verifyCandidate(argument))}\n`);
} else if (operation === "evidence-fixture-identity") {
  const { manifest, digest } = verifyFrozenManifest();
  process.stdout.write(
    canonicalBytes({
      candidate: repositoryIdentity(),
      manifest: { id: manifest.manifestId, caseCount: manifest.caseCount, sha256: digest },
      migrations: listFiles("migrations"),
      platform: platformIdentity(),
    }),
  );
} else if (operation === "lock-overlap") {
  const lock = acquireGateLock(argument);
  try {
    acquireGateLock(argument);
  } finally {
    lock.release();
  }
} else if (operation === "lock-stale") {
  mkdirSync(join(argument, ".."), { recursive: true });
  writeFileSync(
    argument,
    canonicalBytes({ schemaVersion: 1, pid: 2_147_483_647, createdAtMs: 1 }),
    "utf8",
  );
  const lock = acquireGateLock(argument, { nowMs: 30_000_000, staleAfterMs: 1 });
  lock.release();
  process.stdout.write("recovered\n");
} else if (operation === "runtime") {
  const root = argument;
  const identity = repositoryIdentity();
  const first = provisionValidationRuntime(root, identity);
  const second = provisionValidationRuntime(root, identity);
  process.stdout.write(`${JSON.stringify({ first, second })}\n`);
} else if (operation === "runtime-corrupt") {
  const root = argument;
  mkdirSync(join(root, "sqlite"), { recursive: true });
  writeFileSync(join(root, "sqlite", "peas.sqlite"), "primary-state", "utf8");
  process.stdout.write(
    `${JSON.stringify(provisionValidationRuntime(root, repositoryIdentity()))}\n`,
  );
} else if (operation === "runtime-corrupt-staging") {
  const root = argument;
  mkdirSync(join(root, "artifacts", "staging"), { recursive: true });
  writeFileSync(join(root, "artifacts", "staging", "existing.bin"), "primary-state", "utf8");
  process.stdout.write(
    `${JSON.stringify(provisionValidationRuntime(root, repositoryIdentity()))}\n`,
  );
} else if (operation === "execute") {
  const root = argument;
  const { manifest } = verifyFrozenManifest();
  provisionValidationRuntime(root, repositoryIdentity());
  const result = executeSyntheticMatrix(root, manifest, { limit: 2 });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} else if (operation === "hard-kill") {
  const { manifest } = verifyFrozenManifest();
  const hardKillCases = manifest.cases.filter(({ executable }) =>
    /hard.kill/iu.test(executable.testName),
  );
  const result = await executeHardKillMatrix(argument, {
    ...manifest,
    cases: hardKillCases.slice(0, 1),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} else if (operation === "read") {
  process.stdout.write(readFileSync(argument, "utf8"));
} else {
  throw new Error("probe-operation-invalid");
}
