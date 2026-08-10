import { writeFileSync } from "node:fs";

import { canonicalBytes, readJson, sha256 } from "./contract.mjs";

const input = readJson(process.env.PEAS_LOCAL_VALIDATION_HARD_KILL_INPUT);
const durable = {
  schemaVersion: 1,
  point: input.point,
  cases: input.caseIds.map((caseId) => ({
    caseId,
    checkpointSha256: sha256(`${input.point}:${caseId}`),
  })),
};
writeFileSync(input.statePath, canonicalBytes(durable), { encoding: "utf8", flag: "wx" });
process.stdout.write("READY\n");
setInterval(() => {}, 60_000);
