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
id = prefix + SHA-256(domainSeparator || 0x00 || RFC8785(preimage))
```

The domain separator and prefix in this document are literal. A preimage has exactly the shown
fields. Unknown, missing, extra, inherited, accessor, symbol, sparse, proxy, cyclic, non-finite,
negative-zero, and unsafe-integer values reject before canonicalization. Arrays are dense. Set-like
arrays are unique and sorted by unsigned UTF-8 bytes before hashing. An implementation must not
silently add defaults.

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

```text
selectionPolicyId = "msp1_" + H("peas/market-selection-policy/v1", {
  contractVersion, viewKind, primaryAnchorKind, alternateAnchorKind,
  alternateAnchorRequired, intervalDefinitions, targetSelector,
  publicationOriginSelector, sourcePolicy, providerPriority,
  eligibilityPolicy, stalenessPolicy, correctionPolicy,
  tieBreakPolicy, reasonCatalogVersion, boundsPolicyId
})
```

H-001 fixes:

- `primaryAnchorKind:"capture"` using the existing capture basis;
- `alternateAnchorKind:"retrieval"` and `alternateAnchorRequired:true`;
- `targetSelector:"last-eligible-at-or-before"`; and
- `publicationOriginSelector:"last-eligible-strictly-before-publication"`.

The exact existing retrieval basis is a mandatory sensitivity and is never renamed transport
response completion. Anchor, view (`as-known|corrected`), as-of selectors, provider priority,
fallback, interval, staleness, and correction cutoffs enter selection policy identity, never market
fact identity. Primary source/fallback remains fail closed until P1-09 approval.

```text
candidateSetHash = H("peas/market-candidate-set/v1", sorted {
  providerObservationId,revisionId,normalizedMarketFactId,
  eligibilityOutcome:{status,reasonCode,reasonDetail,diagnosticCodes}
})

selectedReferenceId = "msr1_" + H("peas/market-selected-reference/v1", {
  marketReferenceJoinKey, intervalKey, referenceKind, selectionPolicyId,
  asOfBasis, selectedNormalizedMarketFactId, selectedRevisionId, candidateSetHash
})

missingReferenceId = "mmr1_" + H("peas/market-missing-reference/v1", {
  marketReferenceJoinKey, intervalKey, referenceKind, selectionPolicyId,
  asOfBasis, reasonCode, reasonDetail, candidateSetHash
})

providerDiscrepancyId = "mdp1_" + H("peas/market-provider-discrepancy/v1", {
  marketReferenceJoinKey, intervalKey, referenceKind, selectionPolicyId,
  providerResultIds, comparisonPolicyVersion, comparisonResult
})
```

`eligibilityOutcome.status` is `eligible|degraded|ineligible|rejected`. `reasonCode` and
`reasonDetail` are both null for eligible/degraded candidates except that degradation is retained
in sorted `diagnosticCodes`; terminal/ineligible outcomes carry the canonical reason and its exact
closed detail object or null. `missingReferenceId.reasonDetail` is the same exact closed detail
object or null required by the reason catalog. This prevents two causes sharing one consolidated
reason string from colliding.

`providerResultIds` is sorted and keeps equal cross-provider values separate. `comparisonResult` is
`agree|disagree|not-comparable`. Missing is a stable first-class result retained in denominators.
The candidate set includes rejected candidates so ordering, paging, or missingness cannot hide
evidence. A selected/missing result is persisted once and never recomputed after later arrival.

As-known selection admits only revisions authoritatively durably captured by its cutoff. A
later-arriving correction with earlier effective time remains excluded. Corrected selection uses
only the revisions named by the frozen dataset manifest through its exact seven-day cutoff. The two
views have different selection policy IDs even when their prices agree.

### Study design, frame, cluster, manifest, and dataset freeze

```text
studyDesignId = "std1_" + H("peas/study-design/v1", {
  designVersion, acceptedContractIds, algorithms, metricDefinitions,
  gateThresholds, missingPolicyId, outlierPolicyId, multiplicityPolicyId,
  correctionPolicyId, sensitivityPolicyId, boundsPolicyId, analysisCodeDigest
})

frameSnapshotId = "sfs1_" + H("peas/study-frame-snapshot/v1", {
  studyDesignId, samplingFrameAsOfMs, calendarSnapshotId,
  scheduleSourcePolicyId, frameConstructionCodeDigest,
  configurationDigest, candidates, dispositions
})

clusterCandidateId = "scc1_" + H("peas/event-study-cluster-candidate/v1", {
  scheduleSourceObservationId, issuerMappingId, instrumentId,
  plannedFiscalPeriod, plannedReleaseDate, plannedSession
})

studyClusterId = "scl1_" + H("peas/study-cluster/v1", {
  clusterCandidateId, frameSnapshotId, lane, controlGroup,
  strata, rank, allocationCell, selectionFraction
})

studyManifestId = "sfm1_" + H("peas/study-freeze-manifest/v1", {
  studyDesignId, codeCommit, configurationDigest, contractIds,
  calendarSnapshotId, entitlementSnapshotIds, providerSourcePolicyId,
  selectionPolicyId, primaryAnchorKind, alternateAnchorRequired,
  readyAtMs, samplingFrameAsOfMs, freezePublishedAtMs,
  collectionSessions, correctionLagMs, rankSeedHex,
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

All set-like arrays are sorted unique. `candidates` includes frame facts only; no outcome,
provider success, price, actual latency, event-time condition, correction, result, or conclusion may
enter design/frame/cluster/manifest identities. `StudyDatasetFreezeV1` is the first study identity
that may name collected market outcomes and typed missing results. It cannot alter any design,
frame, cluster, lane, threshold, provider, anchor, or selection-policy field.

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
- null and absent differ; unknown and current values cannot substitute;
- same content under different provider/feed/endpoint/entitlement observations shares only
  content/fact identities allowed by this contract;
- exact redelivery collapses semantically while preserving delivery evidence;
- same-provider conflicts reject in every order;
- correction effective time and durable arrival produce distinct as-known/corrected views;
- symbol continuity requires an exact effective mapping and share-class evidence;
- quote, trade, bar, and prior close cannot collide or substitute;
- H-001 capture-primary and retrieval-sensitivity branches have distinct policy/result IDs but the
  same fact identities;
- page, order, restart, replay, backend, and clock-regression remapping invariance; and
- URL, query, credential, header, account, path, wall-clock telemetry, provider bytes, and outcome
  conclusions cannot enter forbidden preimages.
