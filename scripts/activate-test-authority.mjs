import { copyFileSync } from "node:fs";
import { resolve } from "node:path";

const workspace = resolve(process.cwd());
copyFileSync(
  resolve(workspace, "dist/test/support/p1-10-test-authority.js"),
  resolve(workspace, "dist/src/internal-test-authority.js"),
);
