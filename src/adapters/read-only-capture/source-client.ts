import type {
  SafeHttpResponseMetadata,
  SanitizedRequestIdentity,
} from "../../artifacts/artifact-store.js";

export type ReadOnlySourceResult =
  | Readonly<{
      status: "found";
      bytes: Uint8Array;
      retrievedAtMs: number;
      request: SanitizedRequestIdentity;
      response: SafeHttpResponseMetadata;
    }>
  | Readonly<{
      status: "missing";
      retrievedAtMs: number;
      request: SanitizedRequestIdentity;
      response: SafeHttpResponseMetadata;
    }>;

export interface ReadOnlySourceClient {
  readonly kind: string;
  read(url: string): Promise<ReadOnlySourceResult>;
}
