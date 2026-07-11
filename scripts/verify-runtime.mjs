import { readFileSync } from "node:fs";

const expectedNode = readFileSync(new URL("../.node-version", import.meta.url), "utf8").trim();
const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const expectedPackageManager = packageJson.packageManager;

if (typeof expectedPackageManager !== "string") {
  throw new Error("package.json must declare an exact packageManager");
}

const separator = expectedPackageManager.lastIndexOf("@");
const expectedManager = expectedPackageManager.slice(0, separator);
const expectedManagerVersion = expectedPackageManager.slice(separator + 1);
const userAgent = process.env.npm_config_user_agent ?? "";
const actualManager = userAgent.match(/^([^/\s]+)\/([^\s]+)/u);

if (process.versions.node !== expectedNode) {
  throw new Error(
    `Node runtime mismatch: expected ${expectedNode}, received ${process.versions.node}`,
  );
}
if (actualManager?.[1] !== expectedManager || actualManager[2] !== expectedManagerVersion) {
  throw new Error(
    `Package manager mismatch: expected ${expectedPackageManager}, received ${userAgent || "unknown"}`,
  );
}

console.log(`Runtime verified: node@${expectedNode}, ${expectedPackageManager}`);
