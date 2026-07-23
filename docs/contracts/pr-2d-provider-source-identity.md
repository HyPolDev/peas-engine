# PR 2D provider, source, and identity contract

- Status: proposed P1-07 contract
- Schema version: 1
- Canonicalization: RFC 8785 through the repository `canonicalHash` implementation
- Human decision: H-001 approved 2026-07-23
- Entitlement gate: P1-09 `PENDING`; no provider, feed, endpoint, or fallback is authorized
- Scope: provider-neutral recorded normalization, selection, replay, and study sidecars only

## Normative identity function

Every displayed V1 identity is recomputed from an exact inert JSON preimage:

```text
utf8(s) = the exact UTF-8 bytes of s
lp(b) = uint64be(byteLength(b)) || b
hashParts(domain, ...parts) =
  SHA-256(lp(utf8(domain)) || lp(bytes(parts[0])) || ... || lp(bytes(parts[n])))
H(domain, preimage) = hashParts(domain, utf8(RFC8785(preimage)))
id = literalPrefix || H(literalDomainSeparator, exactPreimage)
```

`uint64be` is exactly eight unsigned big-endian bytes. This is the repository
`src/core/hash.ts` `hashParts`/`canonicalHash` framing; no zero separator, concatenation-only frame,
hex-text length, character count, native-endian integer, or alternate canonicalizer is permitted.
The domain separator and prefix in this document are literal. A preimage has exactly the shown
fields. Unknown, missing, extra, inherited, accessor, symbol, sparse, proxy, cyclic, non-finite,
negative-zero, and unsafe-integer values reject before canonicalization. Arrays are dense. Set-like
arrays are unique and sorted by unsigned UTF-8 bytes before hashing. An implementation must not
silently add defaults.

Literal framing vectors:

```text
canonical ordinary
domain UTF-8: 706561732f676f6c64656e2f7631
canonical JSON UTF-8: 7b2261223a2278222c226e223a317d
preimage: {"a":"x","n":1}
frame:
000000000000000e706561732f676f6c64656e2f7631
000000000000000f7b2261223a2278222c226e223a317d
SHA-256: 6b2d9419f583fd8f1e317a03a25f14dbcaeb06a3e63bfe566ab9f33b1e39de97

framing collision witness: unframed parts ["ab","c"] and ["a","bc"] both concatenate to 616263
domain: peas/frame-collision/v1
left frame:
0000000000000017706561732f6672616d652d636f6c6c6973696f6e2f7631
00000000000000026162000000000000000163
left SHA-256: 4e38029c6f73af0004b786cb417eaf3f4b06d9c4c23477e65a6a0136f0ef6ff8
right frame:
0000000000000017706561732f6672616d652d636f6c6c6973696f6e2f7631
00000000000000016100000000000000026263
right SHA-256: 31b5b621ccf61824923b45fb664e683a1f719e61aebe63cca5ebe1bbcf910ae3
```

The line breaks in displayed frames are presentation only; the hashed frame is their exact
concatenation. Golden tests must compare the literal frame bytes and digests above and must also
prove the two collision-witness digests differ.

Strings are NFC-normalized only when the field contract explicitly says so; V1 identifiers,
provider codes, symbols, condition codes, decimal strings, timestamps, hashes, and enum values are
ASCII and receive no Unicode transformation. Hashes are lowercase 64-hex. Null is a semantic value,
not an empty string, zero, `unknown`, current value, or omitted property.

Prices, sizes, ratios, and quantities are canonical decimal records:

```ts
type CanonicalDecimalV1 = Readonly<{
  coefficient: string; // "0" or nonzero base-10 digits without a leading zero
  scale: number;
  negative: boolean;
}>;
```

Trailing fractional zeroes are removed by reducing `coefficient` and `scale`; zero always has
`negative:false` and `scale:0`. Eligible market prices and sizes are positive. Binary floating point
must not enter parsing, comparison, midpoint, return, or identity derivation. Market timestamps are
signed 64-bit UTC epoch nanoseconds encoded as canonical decimal strings. Every timestamp has an
adjacent semantic and precision field. PEAS wall times remain non-negative safe integer epoch
milliseconds under an existing clock basis. Monotonic time is session-local telemetry and never a
cross-session or market-fact identity component.

## Immutable contract authority registry

A logical contract name is never authority by itself. Every accepted PR 2D policy, fixture, result,
study design, and dataset freeze carries one immutable registry:

```ts
type ContractLogicalIdV1 =
  | "peas/adr-0010/v1"
  | "peas/market-provider-source-identity/v1"
  | "peas/market-timestamp-trust/v1"
  | "peas/market-eligibility/v1"
  | "peas/market-reason-catalog/v1"
  | "peas/study-reason-catalog/v1"
  | "peas/market-resource-bounds/v1"
  | "peas/market-fixture-manifest/v1"
  | "peas/study-freeze-manifest/v1"
  | "peas/market-acceptance-matrix/v1";

type ContractAuthorityEntryV1 = Readonly<{
  logicalContractId: ContractLogicalIdV1;
  repositoryPath:
    | "docs/adr/0010-market-reference-contract.md"
    | "docs/contracts/pr-2d-provider-source-identity.md"
    | "docs/contracts/pr-2d-timestamp-trust.md"
    | "docs/contracts/pr-2d-market-eligibility.md"
    | "docs/contracts/pr-2d-reason-codes.md"
    | "docs/contracts/pr-2d-resource-bounds.md"
    | "docs/contracts/pr-2d-fixture-manifest.md"
    | "docs/contracts/pr-2d-study-freeze-manifest.md"
    | "docs/contracts/pr-2d-acceptance-matrix.md";
  documentSha256: string;
  gitBlobOid: string;
  contractContentCommit: string;
}>;

type ContractAuthorityRegistryV1 = Readonly<{
  schemaVersion: 1;
  contractContentCommit: string;
  entries: readonly ContractAuthorityEntryV1[];
  contractAuthorityRegistryId: string;
}>;

contractAuthorityRegistryId =
  "car1_" + H("peas/contract-authority-registry/v1", {
    schemaVersion,contractContentCommit,entries
  })
```

The logical-ID/path mapping is exact:

| Logical contract ID | Repository path |
| --- | --- |
| `peas/adr-0010/v1` | `docs/adr/0010-market-reference-contract.md` |
| `peas/market-provider-source-identity/v1` | `docs/contracts/pr-2d-provider-source-identity.md` |
| `peas/market-timestamp-trust/v1` | `docs/contracts/pr-2d-timestamp-trust.md` |
| `peas/market-eligibility/v1` | `docs/contracts/pr-2d-market-eligibility.md` |
| `peas/market-reason-catalog/v1` | `docs/contracts/pr-2d-reason-codes.md` |
| `peas/study-reason-catalog/v1` | `docs/contracts/pr-2d-reason-codes.md` |
| `peas/market-resource-bounds/v1` | `docs/contracts/pr-2d-resource-bounds.md` |
| `peas/market-fixture-manifest/v1` | `docs/contracts/pr-2d-fixture-manifest.md` |
| `peas/study-freeze-manifest/v1` | `docs/contracts/pr-2d-study-freeze-manifest.md` |
| `peas/market-acceptance-matrix/v1` | `docs/contracts/pr-2d-acceptance-matrix.md` |

`entries` contains exactly the ten logical IDs above, sorted by unsigned UTF-8 bytes of
`logicalContractId`. Both reason-catalog IDs intentionally bind the same reason-catalog document
bytes. Duplicate logical IDs, any other duplicate path, missing or extra entries, path
substitutions, a non-64-lowercase-hex document SHA-256, or a
non-40-lowercase-hex Git SHA-1 blob/commit rejects. Every per-entry `contractContentCommit` must
equal the registry value. The
validator reads every blob from `contractContentCommit`, verifies its Git blob OID and SHA-256, then
recomputes `car1_`. It never resolves `HEAD`, a branch, `latest`, a working-tree path, or a mutable
title.

The registry record is materialized at
`docs/audit/pr-2d-contract-authority.json`. It is publication evidence external to the nine
distinct document blobs and ten logical authorities it binds; embedding it in
one bound document would create a self-digest cycle. P1-07 cannot become accepted and no
implementation policy may validate until the integration owner publishes this record for the exact
contract-content commit. The registry may be committed one commit later; the independent audit
record binds that registry ID and content commit externally, avoiding an audit/registry cycle.

## Identity registry

### Provider and authorization

```text
marketProviderId = "mpv1_" + H("peas/market-provider/v1", {
  providerCode, serviceOperatorCode
})
```

`providerCode` is a stable PEAS code such as `alpaca` or `financial-modeling-prep`.
`serviceOperatorCode` distinguishes a legally or operationally separate service. Plan name,
account ID, display label, URL, and credential material are excluded.

```ts
type EntitlementCapabilityV1 = Readonly<{
  datasetId: string;
  feedId: string;
  endpointChannelId: string;
  use: "acquire" | "private-retain" | "offline-replay" | "automated-research" |
    "retain-derived" | "publish-aggregate" | "redistribute-raw";
  status: "granted" | "pending" | "denied" | "not-authorized";
  maximumRawRetentionDays: number | null;
  survivesTermination: boolean | null;
}>;

entitlementSnapshotId = "ent1_" + H("peas/market-entitlement-snapshot/v1", {
  providerId, productCode, accountClass, professionalStatus,
  effectiveFromMs, effectiveToMs, capabilities,
  permissionEvidenceHash, humanApprovalId, zeroIncrementalSpend
})
```

`capabilities` is sorted by `{datasetId,feedId,endpointChannelId,use}` and contains exactly one row
per declared capability. Pending and prohibited capabilities are explicit. `permissionEvidenceHash`
is a sanitized opaque digest or null; `humanApprovalId` is a bounded repository decision identity or
null. No correspondence, person, email, account, invoice, billing, credential, or provider payload
enters this preimage. P1-09 pending means real-provider acquisition fails before a read; synthetic
offline fixtures may use a separately identified project-owned synthetic entitlement.

### Dataset, feed, endpoint, and venue/tape

```text
marketDatasetId = "mds1_" + H("peas/market-dataset/v1", {
  providerId, assetClass, coverageRegion, productFamily,
  apiGeneration, recordFamily, datasetDocumentationVersion
})

marketFeedId = "mfd1_" + H("peas/market-feed/v1", {
  datasetId, providerFeedCode, consolidationKind, delayClass,
  adjustmentMode, correctionRepresentation
})

endpointChannelId = "mec1_" + H("peas/market-endpoint-channel/v1", {
  feedId, channelKind, methodKind, safeRouteLabel, endpointDocumentationVersion,
  paginationKind, factKinds
})
```

Closed V1 enums are:

- `assetClass`: `us-equity`;
- `consolidationKind`: `sip-consolidated|single-venue|provider-aggregate|derived|unknown`;
- `delayClass`: `real-time|delayed-15m|historical|provider-defined|unknown`;
- `adjustmentMode`: `raw|split|dividend|spin-off|all|provider-defined|unknown`;
- `correctionRepresentation`: `original-stream|revision-stream|final-corrected|unknown`;
- `channelKind`: `historical-rest|latest-rest|snapshot-rest|websocket|recorded-synthetic`;
- `methodKind`: `get|stream|recorded`; and
- `paginationKind`: `opaque-token|none-documented|stream-sequence|recorded-manifest`.

`factKinds` is a sorted nonempty subset of
`quote|trade|bar|prior-close|status|luld|corporate-action|correction|cancellation`.
`safeRouteLabel` is a provider-neutral label, never a URL or path with parameters. Historical
Alpaca `feed=sip`, WebSocket `v2/delayed_sip`, latest `feed=delayed_sip`, IEX, BOATS, derived
overnight, and every FMP endpoint family therefore have different feed and/or endpoint/channel
identities. No default or automatic feed is valid.

```text
venueTapeId = "mvt1_" + H("peas/market-venue-tape/v1", {
  planCode, networkCode, participantCode, venueCode,
  protocolName, protocolVersion
})
```

`planCode` is `cta|utp|finra|none|unknown`; `networkCode` is `A|B|C|null`.
`participantCode` and `venueCode` are independently nullable. A tape is not a venue. Daily
sequence scope is carried by the provider observation's `sequenceSessionDate`, not by silently
making a sequence global. Unknown venue/tape fields remain null and may make a fact ineligible.

### Issuer, instrument, share class, and symbol

The existing `imap1_` issuer mapping remains authoritative and unchanged. It identifies an issuer
mapping and bounded symbol set; it does not prove one security or share class.

```text
instrumentId = "min1_" + H("peas/market-instrument/v1", {
  issuerMappingId, securityAuthority, securityKey, issueType, shareClass,
  primaryListingVenueCode, currency, roundLotSize,
  effectiveFromNs, effectiveToNs, predecessorInstrumentId, transitionReason
})

symbolAliasId = "msa1_" + H("peas/market-symbol-alias/v1", {
  instrumentId, symbol, mappingAuthority, mappingVersion,
  mappingArtifactDigest, effectiveFromNs, effectiveToNs
})
```

`effectiveFromNs` is inclusive and `effectiveToNs` is exclusive or null. `securityKey` is an
authority-scoped stable or synthetic key; a licensed CUSIP must not enter a public fixture.
`predecessorInstrumentId` and `transitionReason` are both null or both non-null. Closed transition
reasons are `symbol-change`, `name-change`, `split`, `reverse-split`, `listing-transfer`,
`share-class-change`, `merger`, `spin-off`, `conversion`, and `adr-ratio-change`.

A symbol is only an effective-dated alias. A name change alone may preserve the instrument. A symbol
change bridges only when authoritative evidence proves the same issue/share class. A split normally
creates a new instrument version within one lineage. Ambiguous CUSIP, share-class, merger, spin-off,
conversion, ADR-ratio, listing, or symbol-reuse continuity never bridges by string similarity.

### Acquisition and artifact evidence

The inherited acquisition observation remains:

```text
acquisitionObservationId = "aob1_" + H("peas/acquisition-observation/v1", {
  provider,retrievalAttemptId,sanitizedRequestIdentityHash,routeLabel
})
```

PR 2D must not change that preimage. Its additive market sidecar is:

```text
marketAcquisitionId = "maq1_" + H("peas/market-acquisition-attempt/v1", {
  acquisitionObservationId, providerId, datasetId, feedId, endpointChannelId,
  entitlementSnapshotId, instrumentIds, requestedFactKinds,
  queryStartNs, queryEndNs, sortOrder, routePolicyVersion
})
```

`instrumentIds` and `requestedFactKinds` are sorted unique arrays. Page size, page number, page
token, response order, URL, query text, credentials, headers, account, local path, request/retrieval/
commit wall time, and backend are excluded. Page-chain evidence is observation telemetry.

```text
artifactContentId = "mac1_" + H("peas/market-artifact-content/v1", {
  sha256, sizeBytes, mediaType, contentEncoding
})

rawArtifactId = "mar1_" + H("peas/market-raw-artifact/v1", {
  artifactContentId, vaultObservationId, vaultObservationHash,
  acquisitionObservationId, role
})
```

`artifactContentId` may be shared by identical bytes. `rawArtifactId` cannot collapse across
ArtifactStore observation/acquisition evidence. Every raw artifact must reconcile through the exact
existing `artifact.committed -> artifact.verified -> normalization` chain and bounded complete
`ArtifactStore.read`. Manifest declarations are not authority. ArtifactStore digest, observation
ID/hash, provider, size, retrieval epoch, and consumed bytes must agree before normalization.

### Provider observation, delivery, and revision

```text
providerObservationId = "mob1_" + H("peas/market-provider-observation/v1", {
  providerId, datasetId, feedId, endpointChannelId, entitlementSnapshotId,
  instrumentId, venueTapeId, providerRecordKey, providerRevisionKey, eventKind, eventTime,
  providerSequence, sequenceSessionDate, canonicalProviderPayloadDigest
})

deliveryId = "mdl1_" + H("peas/market-delivery/v1", {
  providerObservationId, marketAcquisitionId, rawArtifactId,
  memberKey, occurrenceOrdinal
})
```

Nullable fields in `providerObservationId` are present as null. `eventTime` is
`{epochNs,semantic,precisionNs}` and is never PEAS retrieval/capture time. `providerSequence` is
`{value,scope,trustClass}|null`. `memberKey` is a stable record key or a canonical artifact-member
ordinal. It is not an HTTP page number. Page-size changes may change delivery/artifact evidence but
must not change provider observation or downstream semantic identities.

When provider record/revision keys are absent, derive a labeled fallback family:

```text
fallbackProviderFamily = H("peas/market-provider-fallback-family/v1", {
  providerId,datasetId,feedId,endpointChannelId,entitlementSnapshotId,
  instrumentId,eventKind,eventTime,venueTapeId,providerSequence,
  canonicalProviderPayloadDigest
})
```

This is PEAS-derived, never described as provider-issued. If equal-time conflicting records lack a
trusted sequence/tie-break, selection is missing rather than ordered by artifact or arrival.

```text
revisionFamilyId = "mrf1_" + H("peas/market-revision-family/v1", {
  providerId, datasetId, feedId, endpointChannelId,
  instrumentId, eventKind, providerStableRecordFamily
})

revisionId = "mrv1_" + H("peas/market-revision/v1", {
  revisionFamilyId, revisionKind, providerRevisionKey,
  supersedesRevisionId, effectiveEventTime, marketFactId
})
```

`revisionKind` is `original|correction|cancellation`. An original has null supersession. A
correction/cancellation names exactly one prior revision when the pinned source contract supplies
one. An original/correction has a non-null `marketFactId`; a cancellation has `marketFactId:null`.
The revision is therefore derived before, and never recursively from, `normalizedMarketFactId`.
Correction effective time is distinct from
delivery/retrieval/durable-capture time. Orphan, cycle, fork, reused revision key, and ambiguous
target fail closed. No last-writer-wins rule exists.

Equal provider observation ID and payload is redelivery: preserve each `mdl1_`, normalize once.
Equal provider/dataset/feed/endpoint/stable record/revision with different canonical evidence is a
same-provider conflict unless an explicit valid revision edge exists; quarantine the entire
equivalence class independent of arrival order. Equal bytes or economic facts across different
provider/dataset/feed/endpoint/entitlement observations remain independent evidence.

### Market and normalized facts

```text
marketFactId = "mft1_" + H("peas/market-fact/v1", {
  instrumentId, eventKind, eventTime, venueTapeId,
  sessionKind, currency, canonicalPayload
})

normalizedMarketFactId = "mnf1_" + H("peas/market-normalized-fact/v1", {
  marketFactId, providerObservationId, revisionId,
  normalizerVersion, conditionPolicyVersion,
  calendarVersion, parserContractVersion
})
```

`eventKind` is a closed quote/trade/bar/prior-close/auction/status/LULD/corporate-action kind.
Quote, trade, bar, prior-close, and auction payload shapes are disjoint. A bar can never have quote
identity; a trade/bar cannot fill a missing quote. `marketFactId` is provider-neutral and may agree
across providers. `normalizedMarketFactId` preserves provider/revision/policy provenance.

Provider, dataset, feed, endpoint, entitlement, acquisition, raw artifact, page/token/order,
retrieval, durable commit, normalization, selection, wall clock, URL, credential, and local path do
not enter `marketFactId`. A current corrected response does not rewrite a prior fact identity.

### Selection, missingness, and discrepancy

The following vocabulary is the only V1 vocabulary used by policy, fixture, result, acceptance, and
study records:

```ts
type MarketViewKindV1 = "recorded-primary" | "recorded-corrected";

type MarketReferenceKindV1 =
  | "quote-nbbo-midpoint"
  | "trade-last-eligible-consolidated"
  | "bar-one-minute-completed-close"
  | "prior-listing-official-close"
  | "listing-official-open"
  | "opening-trade"
  | "reopening-trade"
  | "closing-trade"
  | "final-eligible-trade-close"
  | "daily-bar-close"
  | "bolo";

type MarketReferenceResultStatusV1 =
  | "selected-complete"
  | "selected-degraded"
  | "missing";

type MarketEvaluationStatusV1 = MarketReferenceResultStatusV1 | "rejected";

type MarketBoundIdV1 =
  | "rawArtifactBytes"
  | "aggregateVerifiedBytes"
  | "artifactsPerAcquisition"
  | "pagesPerAcquisition"
  | "recordsPerArtifactOrPage"
  | "factsPerAcquisition"
  | "canonicalRecordBytes"
  | "rawJsonDepth"
  | "rawJsonNodes"
  | "rawJsonKeysPerObject"
  | "rawJsonArrayItems"
  | "parserTokensPerArtifact"
  | "sidecarDepth"
  | "sidecarNodes"
  | "sidecarKeysPerObject"
  | "sidecarGenericArrayItems"
  | "genericStringBytes"
  | "identifierBytes"
  | "providerOrDatasetCodeBytes"
  | "symbolBytes"
  | "timestampTextBytes"
  | "pageTokenInputBytes"
  | "opaqueProviderIdBytes"
  | "conditionMembers"
  | "conditionMemberBytes"
  | "rawDecimalTokenBytes"
  | "instrumentsPerAcquisition"
  | "providersPerSelectionPolicy"
  | "marketCentersPerInstrumentState"
  | "revisionDepthPerFamily"
  | "deliveriesPerProviderObservation"
  | "candidatesPerReferenceSelection"
  | "intervalsPerCluster"
  | "referenceResultsPerCluster"
  | "sidecarRecordsPerExecution"
  | "sidecarEdgesPerExecution"
  | "canonicalSidecarRecordBytes"
  | "canonicalExecutionBundleBytes"
  | "recordedReplayPageSize"
  | "historicalQueryWindow"
  | "selectionSearchWindowMs"
  | "primaryResidualTargets"
  | "primaryResidualHorizonNs"
  | "calendarDatesPerManifest";

type CanonicalReasonDetailV1 =
  | Readonly<{ limitKind: MarketBoundIdV1 }>
  | Readonly<{ sourceFailureKind: "incomplete" | "endpoint-unknown" | "spec-version-unknown" }>
  | Readonly<{ entitlementFailureKind: "unfrozen" | "pending" | "denied" | "scope-mismatch" | "zero-spend-violation" }>
  | Readonly<{ artifactFailureKind: "observation-invalid" | "digest-mismatch" | "size-mismatch" | "observation-hash-mismatch" | "media-or-encoding-mismatch" }>
  | Readonly<{ providerObservationFailureKind: "schema-invalid" | "identity-invalid" | "conflicting-content" }>
  | Readonly<{ revisionFailureKind: "orphan" | "fork" | "cycle" | "reused-key" | "chain-unresolved" | "unsupported-after-cancellation" }>
  | Readonly<{ timestampFailureKind: "missing" | "semantic-untrusted" | "precision-insufficient" | "capture-retrieval-lag-exceeded" }>
  | Readonly<{ sequenceFailureKind: "missing" | "gap" | "equal-time-ambiguous" }>
  | Readonly<{ instrumentFailureKind: "unmapped" | "ambiguous" | "outside-effective-window" | "symbol-continuity-unresolved" }>
  | Readonly<{ coverageFailureKind: "provider-unknown" | "instrument-not-covered" }>
  | Readonly<{ sessionFailureKind: "calendar-missing" | "boundary-ambiguous" | "timestamp-or-coverage-unknown" }>
  | Readonly<{ tradeConditionFailureKind: "does-not-update-last" | "state-insufficient" }>
  | Readonly<{ priorCloseFailureKind: "absent" | "ineligible" }>
  | Readonly<{ endpointKind: "pre-release" | "first-observation" | "plus-1m" | "plus-5m" | "plus-30m" | "sensitivity" }>
  | Readonly<{ qualityKind: "locked" | "slow" | "luld-limit-state" }>
  | Readonly<{ evidenceQualityKind: "sip-time-only" | "native-sequence-unchecked" }>;

type CanonicalMarketReasonV1 = Readonly<{
  code: string;
  detail: CanonicalReasonDetailV1 | null;
}>;
```

`MarketBoundIdV1` is the exact market-scoped bound-ID subset whose enforcement-ledger disposition
uses `market.bound-exceeded` in `market-reference-bounds-v1`; no fixture alias or study bound is
accepted. `code` is one exact `market.*` value from `market-reasons-v1`. It has the one matching
direct-key detail shape above exactly when that catalog requires it and otherwise has
`detail:null`. A non-null detail has exactly one own property. A `{field,value}` wrapper,
top-level/separate `limitKind`, or any second detail channel is invalid. Diagnostics use
`CanonicalMarketReasonV1`, are limited to degraded/annotation dispositions, are unique, and sort by
unsigned UTF-8 bytes of RFC 8785 `{code,detail}`. Any alternate names, untyped reason strings, or
abbreviated reference kinds are invalid V1 values.

#### Exact interval registry

```ts
type MarketIntervalDefinitionV1 = Readonly<{
  intervalKey: string;
  intervalKind: "prior-close" | "publication-pre" | "t0" | "t1" | "t5" | "t30";
  anchorKind: "previous-eligible-listing-session" | "earnings-publication" | "h001-selected-basis";
  offsetNs: string | null;
  comparator: "authoritative-prior-close" | "strictly-before" | "at-or-before";
  sessionRule: "prior-eligible-session" | "cross-session-allowed" | "anchor-session" | "same-session-as-t0";
}>;

intervalKey = "mik1_" + H("peas/market-reference-interval/v1", {
  intervalKind,anchorKind,offsetNs,comparator,sessionRule
})
```

The registry contains exactly these six rows:

| intervalKind | anchorKind | offsetNs | comparator | sessionRule |
| --- | --- | ---: | --- | --- |
| prior-close | previous-eligible-listing-session | null | authoritative-prior-close | prior-eligible-session |
| publication-pre | earnings-publication | `0` | strictly-before | cross-session-allowed |
| t0 | h001-selected-basis | `0` | at-or-before | anchor-session |
| t1 | h001-selected-basis | `60000000000` | at-or-before | same-session-as-t0 |
| t5 | h001-selected-basis | `300000000000` | at-or-before | same-session-as-t0 |
| t30 | h001-selected-basis | `1800000000000` | at-or-before | same-session-as-t0 |

Every row recomputes `mik1_`; `intervalDefinitions` contains the six complete rows sorted by
`intervalKey`. A name, array position, target time, or caller-provided ID cannot replace that
derivation.

#### Exact policy components

```ts
type MarketSourceKeyV1 = Readonly<{
  providerId: string;
  datasetId: string;
  feedId: string;
  endpointChannelId: string;
  entitlementSnapshotId: string;
}>;

type MarketSourcePolicyV1 = Readonly<{
  policyVersion: "market-source-policy-v1";
  authorizationMode: "p1-09-approved" | "synthetic-offline-only";
  primarySource: MarketSourceKeyV1;
  comparisonSources: readonly MarketSourceKeyV1[];
  fallbackKind: "none";
  selectionIsolation: "per-source";
}>;

type MarketProviderPriorityV1 = Readonly<{
  policyVersion: "market-provider-priority-v1";
  entries: readonly Readonly<{
    source: MarketSourceKeyV1;
    role: "primary" | "discrepancy-only";
    rank: number;
  }>[];
  missingPrimaryBehavior: "typed-missing-no-fallback";
}>;

type MarketEligibilityPolicyV1 = Readonly<{
  policyVersion: "market-eligibility-v1";
  referenceKinds: readonly MarketReferenceKindV1[];
  primaryReferenceKind: "quote-nbbo-midpoint";
  currency: "USD";
  completeWindowRequired: true;
  referenceSubstitution: "forbidden";
  unknownConditionBehavior: "ineligible";
  strictExecutableDiagnostics: readonly ["locked", "luld-limit-state", "slow"];
}>;

type MarketStalenessPolicyV1 = Readonly<{
  policyVersion: "market-staleness-v1";
  regularQuoteAgeNs: "5000000000";
  extendedQuoteAgeNs: "30000000000";
  regularTradeAgeNs: "5000000000";
  extendedTradeAgeNs: "30000000000";
  completedBarAgeNs: "60000000000";
  boundary: "inclusive";
  negativeAgeBehavior: "ineligible";
  overnightPrimaryAgeNs: null;
}>;

type MarketCorrectionPolicyV1 = Readonly<{
  policyVersion: "market-correction-policy-v1";
  primaryCorpusSnapshotId: string;
  corpusCutoffId: string;
}> &
  (
    | Readonly<{
        viewKind: "recorded-primary";
        admissionKind: "member-of-primary-recorded-corpus";
        correctedOffsetNs: null;
        finalCorrectedOnlyBehavior: "recorded-primary-unavailable";
      }>
    | Readonly<{
        viewKind: "recorded-corrected";
        admissionKind: "member-of-primary-or-durably-recorded-by-corrected-cutoff";
        correctedOffsetNs: "604800000000000";
        finalCorrectedOnlyBehavior: "recorded-corrected-only-if-corpus-closed-by-cutoff";
      }>
  );

type MarketTieBreakPolicyV1 = Readonly<{
  policyVersion: "market-tie-break-v1";
  trustedOrder: readonly ["source-native-total-order", "identical-economic-state", "missing"];
  identicalEconomicRepresentative: "smallest-normalized-market-fact-id";
  unresolvedDifferingState: "market.sequence-insufficient/equal-time-ambiguous";
  forbiddenOrders: readonly ["arrival", "artifact", "hash", "page", "provider-priority", "row"];
}>;

type MarketDiscrepancyPolicyV1 = Readonly<{
  policyVersion: "market-discrepancy-v1";
  comparisonKind: "exact-reduced-rational";
  compareIndependentSources: true;
  equalValueMergesProvenance: false;
  missingBehavior: "not-comparable";
  disagreementChangesPrimary: false;
}>;
```

Set-like source/reference arrays are unique and sorted by canonical UTF-8 bytes. Priority entries
sort by ascending contiguous `rank` beginning at zero, then canonical source bytes; exactly one is
`primary`, all others are `discrepancy-only`, and no entry is a fallback. The reference-kind array
contains all eleven registry values sorted by unsigned UTF-8. The three fixed tie-break arrays have
exactly the displayed order. Any null, extra value, reordered fixed array, omitted/auto-selected
provider, feed, anchor, reference, or fallback rejects.

#### Immutable recorded corpus and cutoff evidence

```ts
type RecordedRevisionEvidenceV1 = Readonly<{
  revisionId: string;
  deliveryId: string;
  rawArtifactId: string;
  durablyRecordedAtMs: number;
  logicalAtMs: number;
  clockBasisId: string;
  durableEvidenceHash: string;
}>;

type RecordedCorpusSnapshotV1 = Readonly<{
  schemaVersion: 1;
  marketReferenceJoinKey: string;
  sourcePolicy: MarketSourcePolicyV1;
  marketAcquisitionIds: readonly string[];
  rawArtifactIds: readonly string[];
  providerObservationIds: readonly string[];
  revisionEvidence: readonly RecordedRevisionEvidenceV1[];
  corpusClosedAtMs: number;
  corpusClosedLogicalAtMs: number;
  corpusClockBasisId: string;
  corpusClosureEvidenceHash: string;
}>;

recordedCorpusSnapshotId = "mcs1_" + H("peas/market-recorded-corpus/v1", {
  schemaVersion,marketReferenceJoinKey,sourcePolicy,marketAcquisitionIds,
  rawArtifactIds,providerObservationIds,revisionEvidence,
  corpusClosedAtMs,corpusClosedLogicalAtMs,corpusClockBasisId,
  corpusClosureEvidenceHash
})

type RecordedCorpusCutoffV1 = Readonly<{
  corpusSnapshotId: string;
  cutoffObservationEvidenceHash: string;
  admittedRevisionSetHash: string;
}> &
  (
    | Readonly<{
        viewKind: "recorded-primary";
        cutoffKind: "primary-corpus-closure";
        cutoffTargetNs: null;
      }>
    | Readonly<{
        viewKind: "recorded-corrected";
        cutoffKind: "capture-t0-plus-seven-days";
        cutoffTargetNs: string;
      }>
  );

corpusCutoffId = "mcc1_" + H("peas/market-corpus-cutoff/v1", {
  corpusSnapshotId,viewKind,cutoffKind,cutoffTargetNs,
  cutoffObservationEvidenceHash,admittedRevisionSetHash
})
```

All ID arrays and `revisionEvidence` are unique and sorted respectively by ID and
`{revisionId,deliveryId}`. Every evidence row reconciles an immutable delivery/raw artifact and the
original preserved PEAS durable wall/logical/clock evidence; provider-native arrival is neither
claimed nor inferred. `recorded-primary` requires `primary-corpus-closure`, null target, and an
admitted set exactly equal to valid revisions in the first complete verified corpus.
`recorded-corrected` requires `capture-t0-plus-seven-days`, exact
`T0CaptureNs+604800000000000`, and admits the primary set plus valid revisions whose
`durablyRecordedAtMs*1000000 <= cutoffTargetNs`. Equality is included. A value one nanosecond later
is mathematically outside the cutoff; PEAS evidence is millisecond-resolution, so the executable
one-over vector is the next millisecond. Final-corrected/corrected-in-place evidence with unknown revision membership cannot
produce `recorded-primary`; it can produce `recorded-corrected` only when the complete corpus itself
was durably closed at or before the corrected cutoff.

This is an as-recorded scientific claim about immutable PEAS corpus membership. It is not a claim
that PEAS or the native provider knew the revision at the market target.

#### Selection and result preimages

```ts
type MarketResultAsOfBasisV1 = Readonly<{
  anchorRole: "h001-primary-durable-capture" | "h001-mandatory-retrieval-sensitivity";
  trustedObservationBasis:
    | Readonly<{ basisKind: "capture"; eventId: string; receivedAtMs: number; logicalAtMs: number; clockBasisId: string }>
    | Readonly<{ basisKind: "retrieval"; role: string; acquisitionObservationId: string; vaultObservationId: string; retrievedAtMs: number; clockBasisId: string }>;
  targetTimeNs: string;
  comparator: "authoritative-prior-close" | "strictly-before" | "at-or-before";
  viewKind: MarketViewKindV1;
  recordedCorpusSnapshotId: string;
  corpusCutoffId: string;
  admittedRevisionSetHash: string;
}>;

type MarketSelectionPolicyPreimageV1 = Readonly<{
  contractAuthorityRegistryId: string;
  primaryAnchorKind: "capture";
  alternateAnchorKind: "retrieval";
  alternateAnchorRequired: true;
  intervalDefinitions: readonly MarketIntervalDefinitionV1[];
  targetSelector: "last-eligible-at-or-before";
  publicationOriginSelector: "last-eligible-strictly-before-publication";
  sourcePolicy: MarketSourcePolicyV1;
  providerPriority: MarketProviderPriorityV1;
  eligibilityPolicy: MarketEligibilityPolicyV1;
  stalenessPolicy: MarketStalenessPolicyV1;
  correctionPolicy: MarketCorrectionPolicyV1;
  tieBreakPolicy: MarketTieBreakPolicyV1;
  discrepancyPolicy: MarketDiscrepancyPolicyV1;
  reasonCatalogId: "market-reasons-v1";
  boundsPolicyId: "market-reference-bounds-v1";
}>;

selectionPolicyId =
  "msp1_" + H("peas/market-selection-policy/v1", selectionPolicyPreimage)
```

H-001 fields are exact literals
`capture`, `retrieval`, `true`, `last-eligible-at-or-before`, and
`last-eligible-strictly-before-publication`. An omitted or inferred anchor rejects. Each named
policy field is exactly the complete closed object above; `reasonCatalogId` is
`market-reasons-v1`; `boundsPolicyId` is `market-reference-bounds-v1`; and
`contractAuthorityRegistryId` must validate against the exact accepted checkpoint.

```text
candidateSetHash = H("peas/market-candidate-set/v1", candidates)

selectedReferenceId = "msr1_" + H("peas/market-selected-reference/v1", {
  marketReferenceJoinKey,intervalKey,referenceKind,selectionPolicyId,
  asOfBasis,resultStatus,selectedNormalizedMarketFactId,selectedRevisionId,
  candidateSetHash,diagnostics
})

missingReferenceId = "mmr1_" + H("peas/market-missing-reference/v1", {
  marketReferenceJoinKey,intervalKey,referenceKind,selectionPolicyId,
  asOfBasis,resultStatus,reason,candidateSetHash
})

providerDiscrepancyId = "mdp1_" + H("peas/market-provider-discrepancy/v1", {
  marketReferenceJoinKey,intervalKey,referenceKind,selectionPolicyId,
  providerResultIds,discrepancyPolicy,comparisonResult
})
```

`candidates` is an array of exact
`{providerObservationId,revisionId,normalizedMarketFactId,eligibilityStatus,reason,diagnostics}`
objects sorted lexicographically by the three IDs and then RFC 8785 bytes of the remaining fields.
`eligibilityStatus` is `eligible|degraded|ineligible`; `reason` is
`CanonicalMarketReasonV1|null`; and `diagnostics` uses the exact sorted representation above.
Eligible/degraded has null reason; ineligible has one reason. The array includes every candidate
outcome and rejects duplicate tuples. An operation-terminal rejection aborts before
`candidateSetHash` and produces no candidate array.

A selected result has `resultStatus:selected-complete|selected-degraded`; complete has empty
diagnostics and degraded has at least one. A missing result has `resultStatus:"missing"` and one
canonical reason. Rejected operations emit neither `msr1_` nor `mmr1_`. `referenceKind` is one of
the eleven exact values and `asOfBasis` is the complete object above. `providerResultIds` is unique
and UTF-8 sorted; `comparisonResult` is `agree|disagree|not-comparable`. Equal cross-provider values
remain independent. Persisted results are immutable.

An operation-terminal rejection is not a reference result and cannot enter `referenceResultIds`,
denominator accounting, or study-reason preservation through a fabricated ID. If any required
market-reference operation rejects, the proposed dataset freeze is invalid as a whole and no
`sdf1_` is derived or persisted. The precommitted cluster remains in the study design/frame; a
repaired execution must reproduce the same frozen design before a dataset freeze can validate.

### Study design, frame, cluster, manifest, and dataset freeze

```text
studyDesignId = "std1_" + H("peas/study-design/v1", {
  designVersion, contractAuthorityRegistryId, acceptedContractIds,
  algorithms, metricDefinitions,
  gateThresholds, missingPolicyId, outlierPolicyId, multiplicityPolicyId,
  correctionPolicyId, sensitivityPolicyId, boundsPolicyId, analysisCodeDigest
})

frameSnapshotId = "sfs1_" + H("peas/study-frame-snapshot/v1", {
  studyDesignId, contractAuthorityRegistryId, samplingFrameAsOfMs,
  calendarSnapshotId, scheduleSourcePolicyId,
  frameConstructionCodeDigest, configurationDigest,
  preFrameEvidenceSnapshotId, rankSeedMaterialId, rankSeedHex,
  seedCommittedAtMs, frameConstructedAtMs, candidates, dispositions
})

clusterCandidateId = "scc1_" + H("peas/event-study-cluster-candidate/v1", {
  scheduleSourceObservationId, issuerMappingId, instrumentId,
  releaseKind, releaseClusterKey,
  plannedFiscalPeriod, plannedReleaseDate, plannedSession
})

studyClusterId = "scl1_" + H("peas/study-cluster/v1", {
  clusterCandidateId, frameSnapshotId, lane, controlGroup,
  strata, rank, allocationCell, selectionFraction
})

studyManifestId = "sfm1_" + H("peas/study-freeze-manifest/v1", {
  studyDesignId, codeCommit, configurationDigest,
  contractAuthorityRegistryId, contractIds,
  calendarSnapshotId, entitlementSnapshotIds, providerSourcePolicyId,
  selectionPolicyId, primaryAnchorKind, alternateAnchorRequired,
  readyAtMs, samplingFrameAsOfMs, freezePublishedAtMs,
  collectionSessions, correctionLagMs, rankSeedMaterialId, rankSeedHex,
  frameSnapshotId, selectedClusters, expectedCounts
})

datasetFreezeId = "sdf1_" + H("peas/study-dataset-freeze/v1", {
  studyManifestId, freezeCutoffMs, collectionCodeCommit,
  collectionConfigurationDigest, executionIds, artifactInventoryDigest,
  sourceObservationIds, revisionIds, marketReferenceJoinKeys,
  referenceResultIds, discrepancyIds, metricRecordIds,
  denominatorAccounting, datasetFreezePolicyVersion
})
```

`acceptedContractIds` and `contractIds` are exactly the ten logical IDs in the validated
`contractAuthorityRegistryId`, sorted by unsigned UTF-8. `StudyDesignV1`/`std1_`,
`StudyFrameSnapshotV1`/`sfs1_`, and `StudyFreezeManifestV1`/`sfm1_` must each contain the same non-null
`contractAuthorityRegistryId`; omission or a different registry rejects before hashing. Golden
vectors cover ten exact entries, nine missing, eleven with an extra, a duplicate, and all
noncanonical orders. All other set-like arrays are sorted unique. `candidates` includes frame facts
only; no outcome,
provider success, price, actual latency, event-time condition, correction, result, or conclusion may
enter design/frame/cluster/manifest identities. `StudyDatasetFreezeV1` is the first study identity
that may name collected selected/missing outcomes. It rejects an operation-terminal market outcome
because no result ID exists. It cannot alter any design, frame, cluster, lane, threshold, provider,
anchor, or selection-policy field.

For `scc1_`, `releaseKind` is exactly `quarterly|annual`. The primitive
`StudyReleaseClusterBasisV1` selected and retained in the frame is exactly one of
`{kind:"fiscal-period",plannedFiscalPeriod}`,
`{kind:"cross-source",crossSourceReleaseKeyHash}`, or
`{kind:"native-date",plannedReleaseDate,nativeScheduleIdHash}`. The candidate
`releaseClusterKey` must equal lowercase hexadecimal
`SHA-256(RFC8785({issuerMappingId,releaseKind,clusterBasis}))`; this inner release-cluster digest is
raw SHA-256 over the canonical JSON bytes, not `H`, and has no domain/prefix frame.

Cross-field validation precedes `scc1_` derivation. `scheduleSourceEvidence` is nonempty and contains
exactly the cluster's contributing retained-revision rows. Every row has the candidate's issuer and
release kind. A non-null `plannedFiscalPeriod` selects only the fiscal-period basis and every row
has that exact period; quarterly accepts only `YYYY-Q1` through `YYYY-Q4`, and annual accepts only
`YYYY-FY`. With null fiscal period, a proved non-null cross-source key selects only the cross-source
basis and every row has that exact key; without it, the native-date basis is required and every row
has its exact `plannedReleaseDate` and `nativeScheduleIdHash`. These three alternatives are disjoint
and selected in that precedence.

The representative is the contributing row with lowest precedence ordinal, greatest effective
time with null below every integer, greatest durable-capture time, smallest observation ID, smallest
native schedule ID, then smallest canonical nullable cross-source key, using unsigned UTF-8 for
strings. Its observation ID, issuer, release kind, planned fiscal period/date/session byte-match the
candidate. Multiple schedule items may share one `scheduleSourceObservationId`; item identity comes
from the selected fiscal-period, cross-source, or native-schedule primitive, never from observation
uniqueness. Missing, mismatched, mixed, empty, ambiguous, wrong-precedence, or unproved
basis/evidence rejects before an `scc1_` is derived.

Changing either `releaseKind` or the recomputed `releaseClusterKey` changes `scc1_`. Because the
frame binds the complete candidate, selected basis, retained evidence, and recomputed candidate ID,
that mutation also changes `sfs1_`; it then changes every dependent `scl1_`, `sfm1_`, and `sdf1_`.
Golden and mutation vectors must recompute this full dependency chain rather than substituting an
old displayed child ID.

## Relationship to inherited PR 2C identities and ports

The existing `mrj1_` formula remains exactly:

```text
marketReferenceJoinKey = "mrj1_" + H("peas/market-reference-join/v1", {
  subject,issuerMappingId,selectedSourceObservationId,
  selectedSourceVersionIdentity,trustedObservationBasis
})
```

It identifies the earnings observation anchor, not market evidence. `msr1_`, `mmr1_`, `mdp1_`,
`scl1_`, and `sdf1_` point to `mrj1_`; prices and market-provider identities never flow backward
into it. `aob1_`, `imap1_`, source/version/observation identities, ledger entry IDs, ArtifactStore
observation/hash/digest, and frozen port signatures remain unchanged.

Implementation must use additive provider-neutral source modules and sidecar/manifest records. It
must not add an observation-ledger fact kind, alter `ArtifactStore`, `EventLog`, or `ProcessingStore`,
add/rewrite a migration, add a dependency, or put market telemetry into earnings `EventDraft`,
evidence-bundle identity, reducer state, broker/order code, or financial effects.

## Replay and storage invariants

1. Validate the original complete bounded ledger and sidecars before replay.
2. Preserve every semantic identity above and the original trusted clock stamps.
3. Change only execution-scoped `ole1_` entries and remap every causal parent and clock-regression
   witness to the replay execution.
4. Preserve `aob1_`; replay commit/verification refers to the immutable original ArtifactStore
   observation/hash/digest/size/retrieval epoch.
5. Never derive an identity from SQL row ID, storage sequence, filesystem path, insertion/fixture/
   artifact order, iterator, page size, page token, or backend.
6. Exact duplicate redelivery, restart, page sizes `1`, `2`, `7`, and `10,000`, repeated execution,
   and memory/SQLite storage produce byte-identical provider observation, fact, revision,
   candidate-set, selected/missing, discrepancy, study-manifest, and dataset-freeze identities.
7. An active analysis lease freezes its join and result IDs. Later evidence may create a new branch
   or view but cannot mutate the leased branch.

## Required identity vectors

The executable suite must pin canonical preimage bytes and IDs for every prefix/domain above, then
prove at minimum:

- every displayed ID rejects a forged value;
- the literal ordinary and collision-witness frame bytes/digests at the top of this contract match
  repository `hashParts` and differ from concatenation/zero-separator framing;
- every `car1_` entry rejects a forged blob, digest, path, commit, missing logical
  ID, extra logical ID, `HEAD`, branch, or `latest`, including exact ten/nine/eleven cardinality
  and noncanonical-order vectors;
- every `mik1_`, `mcs1_`, `mcc1_`, component-policy field, candidate tuple, as-of field, reference
  kind, result status, reason detail, and diagnostic rejects missing/extra/forged values in both
  directions;
- every direct reason detail rejects `{field,value}`, wrong key/value, two keys, top-level
  `limitKind`, and a bound ID not authorized for the exact reason/ledger row;
- `scc1_` literal golden and mutation vectors distinguish quarterly from annual, two non-null
  cross-source keys, two native schedule IDs, fiscal-period from native-date basis, and multiple
  schedule items carried by one observation; each vector proves exact basis/evidence validation and
  propagates the changed candidate ID through `sfs1_`, `scl1_`, `sfm1_`, and `sdf1_`;
- null and absent differ; unknown and current values cannot substitute;
- same content under different provider/feed/endpoint/entitlement observations shares only
  content/fact identities allowed by this contract;
- exact redelivery collapses semantically while preserving delivery evidence;
- same-provider conflicts reject in every order;
- correction effective time, durable recorded evidence, and immutable corpus membership produce
  distinct `recorded-primary`/`recorded-corrected` views without a provider-known claim;
- symbol continuity requires an exact effective mapping and share-class evidence;
- quote, trade, bar, and prior close cannot collide or substitute;
- H-001 capture-primary and retrieval-sensitivity branches have distinct policy/result IDs but the
  same fact identities;
- `recorded-primary` admits exactly first-corpus membership and `recorded-corrected` includes
  durable evidence one millisecond before/at its cutoff while excluding one millisecond after;
- page, order, restart, replay, backend, and clock-regression remapping invariance; and
- URL, query, credential, header, account, path, wall-clock telemetry, provider bytes, and outcome
  conclusions cannot enter forbidden preimages.
