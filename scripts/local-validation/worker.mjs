import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { assertCredentialAndAccountAbsence, canonicalBytes, readJson } from "./contract.mjs";
import { executeSyntheticMatrix, provisionValidationRuntime } from "./runtime.mjs";

const input = readJson(process.env.PEAS_LOCAL_VALIDATION_WORKER_INPUT);
assertCredentialAndAccountAbsence();
if (globalThis.__PEAS_NETWORK_DENIAL__?.installed !== true) {
  throw new Error("outbound-network-denial-not-installed-before-worker");
}
let denialProbe = "not-attempted";
try {
  globalThis.fetch("https://example.invalid/");
} catch (error) {
  if (error?.code !== "PEAS_NETWORK_DENIED") throw error;
  denialProbe = "blocked";
}
if (denialProbe !== "blocked") throw new Error("outbound-network-denial-probe-failed");
const firstBoot = provisionValidationRuntime(input.runtimeRoot, input.identity);
const result = executeSyntheticMatrix(input.runtimeRoot, input.manifest, {
  ...(input.limit === null ? {} : { limit: input.limit }),
});
mkdirSync(dirname(input.outputPath), { recursive: true });
writeFileSync(
  input.outputPath,
  canonicalBytes({ ...result, firstBoot, networkDenial: { installed: true, probe: denialProbe } }),
  "utf8",
);
