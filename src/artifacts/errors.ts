export type ArtifactErrorCode =
  | "invalid-input"
  | "writer-lease-unavailable"
  | "artifact-too-large"
  | "vault-quota-exceeded"
  | "artifact-not-found"
  | "artifact-integrity-failure"
  | "unsafe-filesystem-object"
  | "attempt-already-terminal";

export class ArtifactVaultError extends Error {
  readonly code: ArtifactErrorCode;

  constructor(code: ArtifactErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ArtifactVaultError";
    this.code = code;
  }
}
