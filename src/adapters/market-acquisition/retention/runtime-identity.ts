import { dirname, resolve } from "node:path";

const runtimeIdentities = new Map<string, object>();

function normalized(path: string): string {
  const value = resolve(path);
  return process.platform === "win32" ? value.toLowerCase() : value;
}

/** Opaque process-local identity; possessing it grants no authority and only proves root equality. */
export function retentionRuntimeIdentity(runtimeRoot: string): object {
  const root = normalized(runtimeRoot);
  const existing = runtimeIdentities.get(root);
  if (existing !== undefined) return existing;
  const identity = Object.freeze({});
  runtimeIdentities.set(root, identity);
  return identity;
}

export function retentionDatabaseIdentity(databaseFilename: string): object {
  if (databaseFilename === ":memory:") return Object.freeze({});
  return retentionRuntimeIdentity(dirname(dirname(resolve(databaseFilename))));
}
