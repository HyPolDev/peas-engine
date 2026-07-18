# PR 2C reason-code table

Provider-specific reasons are stable transcript values. Neutral observation reasons classify the
stage without erasing the provider reason. No ignored/quarantined outcome emits a partial candidate
or event.

## FMP

| Status | Code | Meaning |
| --- | --- | --- |
| ignored | `fmp.not-earnings-related` | Valid item is outside the frozen classifier |
| ignored | `fmp.issuer-unmapped` | Explicit symbol/CIK mapping is absent |
| quarantined | `fmp.response-invalid` | Acquisition variant or public outer/nested normalizer input is not exact inert data |
| quarantined | `fmp.item-invalid` | Closed item field/type contract is invalid |
| quarantined | `fmp.identity-invalid` | Symbol or record/revision identity cannot be formed |
| quarantined | `fmp.duplicate-conflict` | Same logical record/revision conflicts |
| quarantined | `fmp.observation-invalid` | Selected observation absent, reused, future, wrong-provider, or digest-mismatched |
| quarantined | `fmp.artifact-read-failed` | Verified bytes cannot be completely read |
| quarantined | `fmp.bundle-hash-mismatch` | Declared projection/evidence hash disagrees |
| quarantined | `fmp.response-byte-limit-exceeded` | Collection exceeds 10 MiB |
| quarantined | `fmp.item-limit-exceeded` | Collection exceeds 1,000 items |
| quarantined | `fmp.parse-limit-exceeded` | JSON token/depth/key/decoded-string aggregate exceeded |
| quarantined | `fmp.string-limit-exceeded` | A fixed field bound is exceeded |
| quarantined | `fmp.unsupported-encoding` | Input is not permitted fatal UTF-8 |
| quarantined | `fmp.malformed-json` | Syntax, duplicate key, or inert-object policy fails |
| quarantined | `fmp.timestamp-invalid` | Any present explicit or naive candidate is malformed or out of Gregorian/calendar/clock range |

FMP `limitKind`: `json-tokens`, `json-depth`, `object-keys`, or `decoded-string-bytes`.

## NVIDIA IR

| Status | Code | Meaning |
| --- | --- | --- |
| ignored | `ir.not-financial-results` | Valid item is outside the frozen classifier |
| ignored | `ir.fiscal-period-ambiguous` | Synthetic mapping/structured focus is absent or conflicts |
| quarantined | `ir.bundle-invalid` | Membership/primary/projection or public input/parser-options contract is invalid |
| quarantined | `ir.bundle-hash-mismatch` | Declared projection/evidence hash disagrees |
| quarantined | `ir.observation-invalid` | Selected observation absent, reused, future, wrong-provider, or digest-mismatched |
| quarantined | `ir.artifact-read-failed` | Verified bytes cannot be completely read |
| quarantined | `ir.feed-malformed` | RSS/XML syntax, DTD/entity, or singleton policy fails |
| quarantined | `ir.item-limit-exceeded` | Feed exceeds 256 items |
| quarantined | `ir.item-invalid` | Selected item shape is invalid |
| quarantined | `ir.record-family-ambiguous` | Same non-URL title/publication family has conflicting selected projections |
| quarantined | `ir.duplicate-guid-conflict` | Duplicate item key has different retained semantics |
| quarantined | `ir.link-invalid` | Scheme/host/port/userinfo/path policy fails |
| quarantined | `ir.canonical-conflict` | Feed/link/page canonical item keys disagree |
| quarantined | `ir.timestamp-invalid` | Present item publication time violates pinned GMT grammar |
| quarantined | `ir.release-malformed` | Linked synthetic HTML cannot be parsed under policy |
| quarantined | `ir.release-title-conflict` | RSS title and linked release H1 disagree |
| quarantined | `ir.unsupported-encoding` | XML/HTML encoding policy fails |
| quarantined | `ir.member-limit-exceeded` | A member exceeds 10 MiB or membership is over cap |
| quarantined | `ir.bundle-byte-limit-exceeded` | Aggregate verified bytes exceed 20 MiB |
| quarantined | `ir.parser-limit-exceeded` | Token/depth/attribute/text/category bound exceeded |
| quarantined | `ir.identity-mismatch` | Provider/source/issuer/record/revision contract disagrees |

IR `limitKind`: `xml-tokens`, `xml-depth`, `xml-attributes`, `html-tokens`, `html-depth`,
`html-attributes`, `extracted-text-bytes`, or `categories`.

## Observation ledger

`observation.identity-invalid`, `observation.revision-conflict`,
`observation.mapping-missing`, `observation.mapping-conflict`,
`observation.publication-time-unknown`, `observation.publication-time-invalid`,
`observation.publication-time-conflict`, `observation.clock-basis-invalid`,
`observation.clock-regression-invalid`, `observation.clock-regressed`, `observation.request-failed`,
`observation.request-abandoned`, `observation.request-expired`,
`observation.artifact-missing`, `observation.artifact-mismatch`,
`observation.artifact-limit-exceeded`, `observation.verified-read-failed`,
`observation.verified-byte-count-mismatch`, `observation.normalization-ignored`,
`observation.normalization-quarantined`, `observation.capture-conflict`,
`observation.selection-invalid`, `observation.selection-future`,
`observation.fact-limit-exceeded`, `observation.entry-limit-exceeded`, and
`observation.page-size-invalid`.

`observation.publication-time-unknown` is informational and does not itself quarantine a valid
provider item.
