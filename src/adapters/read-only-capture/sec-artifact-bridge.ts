import { Readable } from "node:stream";
import type { ArtifactStore, StoreArtifactResult } from "../../artifacts/artifact-store.js";
import type { ReadOnlySourceResult } from "./source-client.js";

export async function retainSecSourceResult(
  options: Readonly<{
    artifactStore: ArtifactStore;
    result: ReadOnlySourceResult;
    attemptId: string;
    recordId: string;
    revisionId: string;
    startedAtMs: number;
  }>,
): Promise<StoreArtifactResult | undefined> {
  if (options.result.status === "missing") return undefined;
  return options.artifactStore.store({
    attempt: {
      attemptId: options.attemptId,
      provider: "sec-edgar",
      recordId: options.recordId,
      revisionId: options.revisionId,
      startedAtMs: options.startedAtMs,
      request: options.result.request,
    },
    response: options.result.response,
    entityBytes: Readable.from([options.result.bytes]),
  });
}
