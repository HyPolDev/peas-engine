import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { assertCredentialAndAccountAbsence, canonicalBytes, readJson } from "./contract.mjs";
import {
  executeSyntheticMatrix,
  provisionValidationRuntime,
  validateCheckoutAttestation,
} from "./runtime.mjs";

const input = readJson(process.env.PEAS_LOCAL_VALIDATION_WORKER_INPUT);
const credentialProof = assertCredentialAndAccountAbsence();
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
const candidateAttestation = validateCheckoutAttestation(
  input.candidateAttestation,
  input.identity,
);
const firstBoot = provisionValidationRuntime(input.runtimeRoot, input.identity);
const result = executeSyntheticMatrix(input.runtimeRoot, input.manifest, {
  ...(input.limit === null ? {} : { limit: input.limit }),
  candidateAttestation,
  credentialPresentCount: credentialProof.present.length,
});
mkdirSync(dirname(input.outputPath), { recursive: true });
writeFileSync(
  input.outputPath,
  canonicalBytes({
    ...result,
    firstBoot,
    effectsProof: {
      credentialAndAccountAbsence: credentialProof,
      effectsAllowed: false,
      successfulOutboundTransports:
        globalThis.__PEAS_NETWORK_DENIAL__.successfulOutboundTransports(),
      outboundTransportAttempts: globalThis.__PEAS_NETWORK_DENIAL__.outboundTransportAttempts(),
      deniedOutboundTransportAttempts:
        globalThis.__PEAS_NETWORK_DENIAL__.deniedOutboundTransportAttempts(),
      deniedOutboundAttempts: globalThis.__PEAS_NETWORK_DENIAL__.attempts(),
      executableSourcesProviderFree: input.manifest.cases.every(
        ({ executable }) =>
          !/(?:fmp|sec|nvidia|alpaca|provider|credential)/iu.test(executable.sourcePath),
      ),
    },
    networkDenial: {
      installed: true,
      boundary: globalThis.__PEAS_NETWORK_DENIAL__.boundary,
      childDenialInherited: globalThis.__PEAS_NETWORK_DENIAL__.childDenialInherited,
      deniedSurfaces: globalThis.__PEAS_NETWORK_DENIAL__.deniedSurfaces,
      probe: denialProbe,
    },
  }),
  "utf8",
);
