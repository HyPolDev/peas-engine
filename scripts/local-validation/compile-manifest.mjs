import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

import {
  MANIFEST_DIGEST_PATH,
  MANIFEST_PATH,
  MATRIX_PATH,
  canonicalBytes,
  compileManifest,
  readJson,
  sha256,
  verifyFrozenManifest,
} from "./contract.mjs";

if (process.argv.includes("--check")) {
  const { manifest, digest } = verifyFrozenManifest();
  process.stdout.write(
    `${JSON.stringify({ status: "passed", caseCount: manifest.caseCount, manifestSha256: digest })}\n`,
  );
} else {
  const matrix = readJson(MATRIX_PATH);
  const bytes = canonicalBytes(compileManifest(matrix));
  writeFileSync(MANIFEST_PATH, bytes, "utf8");
  const digest = sha256(readFileSync(MANIFEST_PATH));
  writeFileSync(MANIFEST_DIGEST_PATH, `${digest}  ${MANIFEST_PATH}\n`, "utf8");
  process.stdout.write(`${JSON.stringify({ status: "written", manifestSha256: digest })}\n`);
}
