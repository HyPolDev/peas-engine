# Calendar Event Provider Readiness

Configuration digest: `791b2bdc50fb7edc6317d0ae573c5e555701166e071628eb14012e15c5c4f4c5`

| Source | Material | Capability | Provider / identity | Requirement | Status | Blocker | Credentials | Entitlement | Live access |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| calendar-identity | Deterministic calendar identity | calendar-discovery | calendar.synthetic / fixture://calendar/example-2027-q3 | mandatory | ready | — | no | no | no |
| estimates-snapshot | Prospective estimates snapshot | expectations-snapshot | market.placeholder / market://EXMPL/expectations | optional | separately-authorized | credential-and-entitlement-authorization-required | yes | yes | yes |
| issuer-market-bars | Issuer one-minute market bars | market-bars | market.placeholder / instrument-example-common | mandatory | separately-authorized | credential-and-entitlement-authorization-required | yes | yes | yes |
| issuer-presentation | Issuer presentation or slides | issuer-slides | issuer.ir-placeholder / issuer-ir://EXMPL/presentations | optional | separately-authorized | live-access-authorization-required | no | no | yes |
| issuer-release | Issuer press release | issuer-release | issuer.ir-placeholder / issuer-ir://EXMPL/releases | mandatory | separately-authorized | live-access-authorization-required | no | no | yes |
| issuer-webcast | Issuer webcast metadata | webcast-metadata | issuer.ir-placeholder / issuer-ir://EXMPL/webcasts | optional | separately-authorized | live-access-authorization-required | no | no | yes |
| prepared-remarks | Prepared remarks | prepared-remarks | transcript.placeholder / — | optional | missing | configured-identity-or-path-missing | no | yes | yes |
| sec-filing-exhibit | SEC filing and earnings exhibit | filing-exhibit | sec.official-placeholder / CIK0000000123/accession-placeholder | mandatory | separately-authorized | live-access-authorization-required | no | no | yes |
| sec-submissions | SEC submissions feed | sec-filing | sec.official-placeholder / CIK0000000123 | mandatory | separately-authorized | live-access-authorization-required | no | no | yes |
| sector-market-bars | Sector-benchmark one-minute bars | benchmark-market-data | market.placeholder / XLK | mandatory | separately-authorized | credential-and-entitlement-authorization-required | yes | yes | yes |
| spy-market-bars | SPY one-minute benchmark bars | benchmark-market-data | market.placeholder / SPY | mandatory | separately-authorized | credential-and-entitlement-authorization-required | yes | yes | yes |
| transcript | Transcript | transcript | transcript.placeholder / — | optional | missing | configured-identity-or-path-missing | no | yes | yes |
