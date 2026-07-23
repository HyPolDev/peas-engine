# PR 2D exact resource-bound contract

- Status: proposed P1-07 contract
- Bounds policy: `market-reference-bounds-v1`
- Scope: recorded market parsing, identities, selection state, replay, and study manifests
- Failure behavior: preflight, atomic, no partial fact/result/manifest emission

## Reconciliation rule

The four research reports proposed different limits because they described different boundaries.
V1 resolves them by naming each boundary explicitly and using the stricter practical value where
two reports described the same boundary:

- raw artifact bytes are `10 MiB`, not the alternative `16 MiB`, matching the existing recorded
  loader member ceiling;
- normalized records per artifact/page are `10,000`, not `100,000`;
- provider raw JSON may be depth `32`, while detached market sidecars are depth `8` and study
  manifests are depth `12`; these are separate parsers, not conflicting defaults;
- primary condition arrays use `8` members of `8` bytes, stricter than the proposed `16/16`;
- raw provider decimals admit a bounded `32`-byte, scale-12 token, but primary normalized prices
  must satisfy the stricter 20-digit, scale-6 market contract; midpoint scale 7 is derived;
- artifacts/pages per acquisition are `16`, consistent with the inherited ledger's 16 raw links;
- revisions per family are `16` and deliveries per provider observation are `32`, the stricter
  proposals; and
- study-specific 32 MiB manifest and 64 MiB dataset-freeze ceilings remain distinct from 64 KiB
  individual sidecar records and 64 MiB execution bundles.

Provider-advertised rate, bandwidth, symbol, window, and page limits are entitlement facts, not
permission and not substitutes for these project ceilings. A future live adapter must apply the
lesser of an independently approved entitlement limit and this policy. PR 2D contains no transport.

## Validation and failure semantics

Every untrusted public constructor/parser must inspect own data descriptors and preflight applicable
byte, depth, node, key, item, token, and declared-count totals before recursive descent,
canonicalization, allocation proportional to input, sorting, hashing, stream consumption, or state
mutation. Actual stream bytes and item counts are checked again during consumption. An in-limit
declaration with one-over actual bytes fails.

A multi-artifact/page/window operation validates and acquires all required authority first, then
settles cancellation/close of every acquired stream on any failure. It emits either one complete
validated result set or none. No sibling read, normalization, selection, missing result, manifest,
or later asynchronous activity may survive a failed atomic boundary.

The stable failure is:

- `market.bound-exceeded` for market input, parser, identity, state, selection, replay, and artifact
  boundaries;
- `study.bound-exceeded` for design, frame, cluster, manifest, dataset-freeze, analysis, and study
  collection boundaries; and
- the inherited `observation.entry-limit-exceeded`, `observation.bundle-limit-exceeded`, or
  `observation.page-size-invalid` for unchanged PR 2C ledger boundaries.

Errors may name the public bound key and actual/maximum counts, but never echo raw bytes, provider
text, URL, token, credential, account fact, path, or secret. There is no truncation, eviction of an
active session, partial success, retry-to-a-larger-limit, or silent split. Deterministic split is
allowed only before acquisition under a frozen query policy and creates separately identified
acquisitions.

## Exact market and parser bounds

| Bound key | Exact V1 value | Boundary and one-over vector |
| --- | ---: | --- |
| `rawArtifactBytes` | 10,485,760 bytes | One member at exact bytes succeeds; 10,485,761 rejects before partial normalization. |
| `aggregateVerifiedBytes` | 67,108,864 bytes | Exact aggregate succeeds; +1 byte cancels/settles all members and emits nothing. |
| `artifactsPerAcquisition` | 16 | 16 exact; 17 rejects before lookup/read/sort. |
| `pagesPerAcquisition` | 16 | 16 exact; 17 rejects and cannot silently start another acquisition. |
| `recordsPerArtifactOrPage` | 10,000 | 10,000 exact; 10,001 rejects before canonical fact emission. |
| `factsPerAcquisition` | 160,000 | 16 pages x 10,000 exact; 160,001 rejects atomically. |
| `canonicalRecordBytes` | 65,536 bytes | Exact canonical bytes succeed; 65,537 rejects. |
| `rawJsonDepth` | 32 | Depth 32 exact; 33 rejects before recursion. |
| `rawJsonNodes` | 250,000 | Node 250,000 exact; 250,001 rejects. |
| `rawJsonKeysPerObject` | 64 | 64 exact; 65 rejects. This supersedes the 128-field proposal. |
| `rawJsonArrayItems` | 10,000 | 10,000 exact; 10,001 rejects unless a stricter named array applies. |
| `parserTokensPerArtifact` | 250,000 | Token 250,000 exact; 250,001 rejects before further parse. |
| `sidecarDepth` | 8 | Exact detached market sidecar depth 8; 9 rejects. |
| `sidecarNodes` | 512 | 512 exact; 513 rejects. |
| `sidecarKeysPerObject` | 64 | 64 exact; 65 rejects. |
| `sidecarGenericArrayItems` | 32 | 32 exact; 33 rejects unless a named array below applies. |
| `genericStringBytes` | 1,024 UTF-8 bytes | 1,024 exact; 1,025 rejects. |
| `identifierBytes` | 512 UTF-8 bytes | 512 exact; 513 rejects. |
| `providerOrDatasetCodeBytes` | 128 ASCII bytes | 128 exact; 129 rejects. |
| `symbolBytes` | 32 ASCII bytes | 32 exact; 33 rejects. Effective symbol grammar may be stricter. |
| `timestampTextBytes` | 64 ASCII bytes | 64 exact; 65 rejects as timestamp invalid/bound exceeded. |
| `pageTokenInputBytes` | 4,096 UTF-8 bytes | Exact private token input may be hashed; 4,097 rejects before hashing or logging. |
| `opaqueProviderIdBytes` | 128 ASCII bytes | 128 exact; 129 rejects. |
| `conditionMembers` | 8 | 8 unique canonical codes exact; ninth rejects. |
| `conditionMemberBytes` | 8 ASCII bytes | 8 exact; 9 rejects. |
| `rawDecimalTokenBytes` | 32 ASCII bytes | 32 exact; 33 rejects before numeric conversion. |
| `rawDecimalScale` | 12 | Scale 12 may be retained as provider evidence; 13 rejects. |
| `primaryCoefficientDigits` | 20 | 20 exact; 21 makes the fact ineligible/rejected under decimal contract. |
| `primarySourceScale` | 6 | Scale 6 exact; 7 rejects for primary source price/size. |
| `derivedMidpointScale` | 7 | Scale 7 exact; scale 8 rejects. No rounding is allowed. |
| `rationalComponentBytes` | 32 ASCII bytes | Exact numerator/denominator component; 33 or arithmetic overflow invalidates the metric. |
| `instrumentsPerAcquisition` | 64 | 64 exact; 65 requires a pre-acquisition deterministic split. |
| `providersPerSelectionPolicy` | 8 | 8 exact; 9 rejects. |
| `marketCentersPerInstrumentState` | 64 | 64 exact; 65 rejects; no eviction from active session state. |
| `revisionDepthPerFamily` | 16 | Original plus bounded chain at exact contract count; link 17 rejects the family. |
| `deliveriesPerProviderObservation` | 32 | 32 exact redeliveries retained; 33 rejects before retention. |
| `candidatesPerReferenceSelection` | 10,000 | 10,000 exact; 10,001 emits no winner or missing result. |
| `intervalsPerCluster` | 16 | 16 exact; 17 rejects. V1 primary set remains stricter. |
| `referenceResultsPerCluster` | 64 | 64 exact selected/missing/discrepancy IDs; 65 rejects. |
| `sidecarRecordsPerExecution` | 4,096 | 4,096 exact; 4,097 rejects. |
| `sidecarEdgesPerExecution` | 12,279 | 12,279 exact; 12,280 rejects. |
| `canonicalSidecarRecordBytes` | 65,536 bytes | Exact succeeds; +1 rejects. |
| `canonicalExecutionBundleBytes` | 67,108,864 bytes | Exact succeeds; +1 rejects before graph validation. |
| `recordedReplayPageSize` | 1..10,000 | 1 and 10,000 succeed; 0 and 10,001 reject. |
| `historicalQueryWindow` | 1..8 consecutive calendar dates | 1 and 8 dates succeed; 0 or a ninth date rejects or requires a frozen pre-acquisition split. This is a calendar-date count, not elapsed nanoseconds. |
| `selectionSearchWindowMs` | 0..86,400,000 ms | 0 and 86,400,000 succeed; -1 or 86,400,001 rejects the selection request. |

`rawJsonArrayItems` does not authorize 10,000 values in every sidecar field. Named arrays use their
stricter limits. `rawDecimalScale=12` preserves a provider token but does not make it eligible for
the primary microstructure contract, which requires at most scale 6. Conversion may normalize
trailing zeroes; it may not round.

## Exact market-time and state policy bounds

| Bound key | Exact V1 value | Boundary and one-over vector |
| --- | ---: | --- |
| `primaryResidualTargets` | exactly 4: `T0,T1,T5,T30` | Duplicate, omitted, reordered-semantic, or fifth primary target rejects. |
| `primaryResidualHorizonNs` | 1,800,000,000,000 ns | Exact +30 minutes succeeds; +1 ns rejects primary configuration. |
| `regularQuoteAgeNs` | 5,000,000,000 ns inclusive | Exact age eligible; +1 ns yields `market.quote-stale`. |
| `extendedQuoteAgeNs` | 30,000,000,000 ns inclusive | Exact age eligible; +1 ns yields `market.quote-stale`. |
| `barDurationNs` | exactly 60,000,000,000 ns | 60 seconds exact; +/-1 ns is not a V1 one-minute bar. |
| `captureRetrievalLagMs` | 600,000 ms inclusive | Exact retained; +1 ms is a timing-quality failure, never a fact rewrite. |
| `calendarDatesPerManifest` | 400 | 400 exact; 401 rejects. |

Quote-age and capture/retrieval-lag thresholds are study-quality rules, not parser truncation and
not exchange/provider facts. H-001 still uses durable capture as primary and the exact inherited
retrieval basis as mandatory sensitivity. The lag ceiling never renames `retrievedAtMs` response
completion.

## Exact study and analysis bounds

| Bound key | Exact V1 value | Boundary and one-over vector |
| --- | ---: | --- |
| `targetClusters` | exactly 180; schema range 100..200 | 180 succeeds; 179/181 fail this design and 99/201 fail schema. |
| `laneTargets` | exactly 120/40/20 | Any lane +/-1 rejects before collection. |
| `controlTargets` | exactly 5/5/5/5 | Any control +/-1 rejects before collection. |
| `candidateFrameMembers` | 8,192 | 8,192 exact; 8,193 yields `study.bound-exceeded`. |
| `frameDispositionOrStratumCells` | 2,048 | 2,048 exact; 2,049 rejects. |
| `selectedClusterEntryBytes` | 65,536 bytes | Exact canonical entry succeeds; +1 rejects. |
| `completeStudyManifestBytes` | 33,554,432 bytes | Exact manifest succeeds; +1 rejects before ID derivation. |
| `datasetFreezeBundleBytes` | 67,108,864 bytes | Exact bundle succeeds; +1 rejects atomically. |
| `studyJsonDepth` | 12 | 12 exact; 13 rejects. |
| `studyJsonNodesTotal` | 500,000 | 500,000 exact; 500,001 rejects before allocation/sort/hash. |
| `studyKeysPerObject` | 64 | 64 exact; 65 rejects. |
| `studyGenericArrayItems` | 256 | 256 exact; 257 rejects unless a named frame/cluster array applies. |
| `studyStringBytes` | 4,096 UTF-8 bytes | 4,096 exact; +1 rejects. |
| `studyIdentifierBytes` | 512 UTF-8 bytes | 512 exact; +1 rejects. |
| `contractSourceEntitlementIds` | 64 per named set | 64 exact unique sorted IDs; 65 rejects. |
| `reasonDefinitions` | 64 | 64 exact; 65 rejects. |
| `metricDefinitions` | 32 | 32 exact; 33 rejects. |
| `sensitivityDefinitions` | 32 | 32 exact; 33 rejects. |
| `referencesPerCluster` | 64 | 64 exact; 65 rejects. |
| `referencesTotal` | 12,800 | 12,800 exact; 12,801 rejects. |
| `annotationsPerCluster` | 64 | 64 exact; 65 rejects without truncation. |
| `revisionsReferencedPerCluster` | 32 | 32 exact across families; 33 rejects. Each family is still limited to 16. |
| `strataDimensions` | 8 | 8 exact; 9 rejects. |
| `collectionSessions` | exactly 65 | 65 succeeds; 64 or 66 invalidates this design. |
| `collectionCalendarSpanMs` | 10,368,000,000 ms (120 days) | Exact span succeeds; +1 ms rejects. |
| `liquidityHistorySessions` | exactly 20 | Requesting 21 changes the design and rejects. |
| `minimumValidLiquiditySessions` | at least 15 of 20 | 15 supports known liquidity; 14 forces `unknown`, not rejection/removal. |
| `timelyObservationMs` | 900,000 ms inclusive | Conservative upper bound 900,000 is timely; 900,001 is not. |
| `correctionLagMs` | 604,800,000 ms inclusive | Revision at exact cutoff included; +1 ms excluded and annotated. |
| `bootstrapReplicates` | exactly 10,000 | 10,000 exact; 10,001 or 9,999 changes/rejects frozen analysis. |
| `holmSlots` | exactly 24 | 24 exact; 25 or 23 rejects; unavailable slots remain with p=1. |

The frame's 8,192 members and manifest's 180 selected clusters are named arrays exempt from the
generic 256-item array ceiling but subject to their explicit limits. The dataset freeze may contain
up to 12,800 reference IDs but still must satisfy total nodes and canonical bytes.

## Deterministic retention and completion

Bounded state may be released only after an immutable session/window is complete and every selected
or missing result that depends on it is persisted. Eviction order is the canonical completed-session
key, never arrival order, memory pressure, database row order, or wall clock. Active session,
correction chain, candidate set, and analysis-lease state cannot be evicted to satisfy a limit; the
operation fails atomically instead.

Page, artifact, fixture, delivery, and correction arrival order must not affect the bound measured
or the failure reason. Preflight set-like collections after inert snapshot but before sort; count
duplicates as input items for resource safety even when exact semantic duplicates later collapse.

## Required exact/one-over coverage

Every numeric row in all three matrices requires an executable pair:

1. a real value at the exact ceiling or required equality that reaches and succeeds at the public
   validator/selector; and
2. the same value with exactly one byte, item, key, token, digit, scale unit, nanosecond,
   millisecond, session, replicate, slot, edge, or record over that fails with the stable reason.

Ranges require both legal endpoints and one below/above. Minimums require equality and one below.
Exact-count designs require equality and both +/-1. Cross-products require one factor over while all
others remain exact. Declared-byte tests must include actual stream growth/replacement over the
limit, digest substitution, and an in-limit metadata declaration paired with one-over consumed
bytes. Multi-member failures must test each member position and prove settle-before-return,
zero partial normalization/selection, and no post-return activity.

Coverage must also prove identical accepted bytes and failure reasons across fixture order,
redelivery order, correction order consistent with the same captured facts, restart, replay page
sizes `1`, `2`, `7`, `10,000`, repeated execution, and memory/SQLite backends. A row without both
public exact and one-over vectors is not implemented and cannot be marked accepted.
