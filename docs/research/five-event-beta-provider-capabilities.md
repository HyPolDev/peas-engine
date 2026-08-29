# Five-event beta provider-capability selection

Status: provider-free configuration only. No provider access, credential read, account action, subscription, spend, or financial effect is authorized by this document.

## Frozen candidate order

1. AVGO — 2026-09-02 after market
2. HPE — 2026-09-02 after market
3. CIEN — 2026-09-03 before market
4. DOCU — 2026-09-03 after market
5. LULU — 2026-09-03 after market

The authoritative mapping and provider declarations are in
`config/event-beta/2026-09-02-to-2026-09-03.provider-capabilities.json`. The generator refuses an original packet whose plan or configuration identity differs from the frozen input.

## Selected capabilities

| Material | Selection | Configuration state | Future live gate |
| --- | --- | --- | --- |
| SEC submissions, filing, and exhibit | Existing official SEC read-only boundary | Ready to configure for each frozen CIK | Exact-packet live SEC authorization |
| Official issuer release | Narrow exact-origin/path issuer boundary | Ready to configure for all five official IR hosts | Exact-packet issuer live authorization |
| Issuer, SPY, and sector one-minute bars | Existing Alpaca historical SIP bars capability | Exact provider/dataset/feed/channel, canonical instruments, alias-authority catalog, and symbols configured | Credential, entitlement, zero-spend, and live authorization |
| Estimates snapshot | FMP not accepted for this capability | Optional missing | Separate capability acceptance and live authorization; absence blocks expectation-surprise analysis only |
| Transcript or prepared remarks | No accepted repository capability | Optional missing | Separate capability selection and authorization |
| Slides and webcast metadata | Same official issuer boundary | Optional configured paths | Exact-packet issuer live authorization |

No commercial provider was added. FMP's already-known provider identity for market-reference discrepancy work is not treated as an accepted estimates capability, and no transcript placeholder is promoted into a provider.

## Enforced boundaries

- SEC remains limited to `data.sec.gov` submissions and `www.sec.gov` filing paths, credential-free, redirects denied, bounded by the packet's five-minute polling and 64-request ceiling.
- Issuer reads are limited to one exact HTTPS origin and 1–8 declared path prefixes per issuer. Query strings, fragments, credentials, redirects, and undeclared destinations are rejected.
- Alpaca bars remain the existing historical `sip`, `1Min`, `raw`, ascending route. Future live use requires the existing credential and entitlement gates; this package never reads either.
- AVGO, HPE, CIEN, DOCU, LULU, SPY, XLK, and XLY are bound to frozen `min1_…` identities in one exact `maac1_…` alias-authority catalog. Provider-free structural tests inject a deliberately non-authorizing test entitlement identity only to prove these mappings pass the existing acquisition validator.
- All unavailable optional capabilities settle explicitly as missing. They cannot make a mandatory lane provider-ambiguous.
- Raw artifacts and EventCluster outputs retain the existing immutable artifact and SQLite provenance policies.

## Evidence standard

The five official issuer mappings are exercised with local mocked responses. Packet generation is run twice into independent temporary roots and compared byte-for-byte. Repository tests retain zero provider/network effects, while any real provider access remains a separate human gate.
