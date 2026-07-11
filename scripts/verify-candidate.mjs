import { execFileSync } from "node:child_process";

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", windowsHide: true }).trim();
}

const actualSha = git("rev-parse", "HEAD");
const expectedSha = process.env.PEAS_CANDIDATE_SHA;

if (process.env.CI === "true" && expectedSha === undefined) {
  throw new Error("CI must declare PEAS_CANDIDATE_SHA");
}
if (expectedSha !== undefined && actualSha !== expectedSha) {
  throw new Error(`Candidate SHA mismatch: expected ${expectedSha}, checked out ${actualSha}`);
}
if (git("status", "--porcelain").length !== 0) {
  throw new Error("Candidate worktree is not clean");
}

console.log(`Candidate verified: ${actualSha}`);
