import { copyFileSync } from "node:fs";
import { resolve } from "node:path";

const workspace = resolve(process.cwd());
copyFileSync(
  resolve(workspace, "scripts/support/p1-10-provisioning-authority.js"),
  resolve(workspace, "dist/src/internal-provisioning-authority.js"),
);
