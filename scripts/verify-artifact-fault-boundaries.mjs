import { readFileSync } from "node:fs";
import { join } from "node:path";

const workspace = process.cwd();
const inventory = JSON.parse(
  readFileSync(join(workspace, "config", "artifact-fault-boundaries.json"), "utf8"),
);
if (inventory.schemaVersion !== 1 || !Array.isArray(inventory.boundaries))
  throw new Error("Artifact fault-boundary inventory is invalid");
const names = inventory.boundaries.map(({ name }) => name);
if (new Set(names).size !== names.length)
  throw new Error("Artifact fault-boundary inventory contains duplicates");

const sources = [
  "src/adapters/artifacts/durable-artifact-store.ts",
  "src/adapters/artifacts/writer-lease.ts",
].map((path) => readFileSync(join(workspace, path), "utf8"));
const combined = sources.join("\n");
const hardKillTests = readFileSync(join(workspace, "test", "artifact-vault.test.ts"), "utf8");
for (const name of names) {
  if (name.endsWith(":*")) {
    const prefix = name.slice(0, -1);
    if (!combined.includes(`\`${prefix}$`))
      throw new Error(`Fault boundary wildcard ${name} has no production anchor`);
    if (!hardKillTests.includes(`"${prefix}`))
      throw new Error(`Fault boundary wildcard ${name} has no hard-kill matrix case`);
  } else if (!combined.includes(`"${name}"`)) {
    throw new Error(`Fault boundary ${name} has no production anchor`);
  } else if (!hardKillTests.includes(`"${name}"`)) {
    throw new Error(`Fault boundary ${name} has no hard-kill matrix case`);
  }
}

const discovered = [
  ...combined.matchAll(/(?:#checkpoint|faultBoundary\??\.)\("([a-z0-9:-]+)"\)/gu),
].map((match) => match[1]);
for (const name of discovered)
  if (!names.includes(name))
    throw new Error(`Production fault boundary ${name} is not inventoried`);

console.log(`Artifact fault-boundary inventory verified: ${names.length} named boundaries`);
