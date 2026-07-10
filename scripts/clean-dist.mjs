import { rmSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

const workspace = resolve(process.cwd());
const target = resolve(workspace, "dist");
if (basename(target) !== "dist" || dirname(target) !== workspace) {
  throw new Error(`Refusing to clean unexpected path: ${target}`);
}
rmSync(target, { recursive: true, force: true });
