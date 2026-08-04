export interface P1_10ProvisioningAuthority {
  claim(runtimeRoot: string): void;
}

/** Ordinary production builds have no first-boot authority. */
export const P1_10_PROVISIONING_AUTHORITY: P1_10ProvisioningAuthority | undefined = undefined;
