import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

test("generated output-integrity workspace is ignored", () => {
  const result = spawnSync(
    "git",
    ["check-ignore", "--quiet", ".tmp-output-integrity/src/core/json.js"],
    {
      windowsHide: true,
    },
  );

  assert.equal(result.status, 0, result.stderr.toString());

  const biomeConfig = JSON.parse(readFileSync("biome.json", "utf8")) as {
    files: { includes: string[] };
  };
  assert.ok(biomeConfig.files.includes.includes("!!.tmp-output-integrity"));
});
