# PR 2D market identity, telemetry, and replay architecture

- Role: independent identity, telemetry, and replay architect (Terra C)
- Research date: 2026-07-23
- Repository base: `0377323b5486a8ad3b8e2631d4c8559760893be6`
- Phase 0 checkpoint: `06e7559`
- Scope: provider-neutral recorded contracts and synthetic tests only
- Entitlement state: P1-09 `PENDING`; no provider is authorized
- Anchor verdict: `HUMAN_DECISION_REQUIRED` before the P1-07 contract can select a primary anchor

## Executive decision

PR 2D should add a versioned market sidecar that joins to, but does not alter, PR 2C's closed
observation ledger. The sidecar must distinguish provider, entitlement, dataset, feed, venue/tape,
instrument, artifact content, provider observation, delivery, revision, normalized fact, selection
policy, selected or missing result, discrepancy, and study-manifest identities. Identical bytes or
economic values may share content/fact identities; they must not collapse provider, feed,
entitlement, observation, delivery, or revision identity.

The existing `marketReferenceJoinKey` remains the earnings-observation join. It must not absorb a
price, provider, dataset, feed, entitlement, venue, market fact, selection result, or study outcome.
PR 2D market results point to the existing join key, never the reverse.

The primary-anchor choice is scientifically material. A retrieval-completion anchor can precede
verified durable normalization and measures market state closer to byte availability. A durable
capture anchor is the first point at which PEAS has an immutable normalized event and therefore
measures operationally usable information, but it includes acquisition, verification,
normalization, and append delay. Price movement during that interval is assigned to different
study windows under the two choices. The contract must stop for a human decision; it must not hide
the choice in a selector version. My recommendation, if the study's claim is about actionable PEAS
knowledge, is durable capture as primary and retrieval completion as a mandatory sensitivity. If
the claim is about provider-delivery latency or earliest byte availability, use retrieval completion
as primary and explicitly state that the bytes were not yet durably normalized at that instant.

## Evidence boundary

### Repository-derived facts

These are inherited project decisions, not claims about provider behavior:

- ADR 0009 and
  [`pr-2c-observation-ledger-schema.md`](../contracts/pr-2c-observation-ledger-schema.md) define an
  immutable, bounded, closed V1 causal ledger.
- `ObservationLedgerFactsV1` cannot gain market fields or new fact variants in PR 2D.
- `marketReferenceJoinKey` already binds `subject`, `issuerMappingId`, selected source observation
  and version, and the exact trusted capture or retrieval basis.
- Replay preserves acquisition, projection, source/version/observation, selection, and join
  identities while remapping execution-scoped ledger entry IDs and causal parents.
- `ArtifactStore` is authoritative. A recorded loader must perform an exact observation lookup and
  a bounded verified complete read. A manifest declaration is not authority.
- The frozen `EventLog`, `ProcessingStore`, `ArtifactStore`, observation-ledger, and kernel port
  signatures must not change. Migration 005 is immutable and no new migration is proposed.
- P1-09 permits provider-neutral contracts, synthetic fixtures, and offline tests, but no provider
  access, credential/account inspection, licensed bytes, subscription change, or spend.

### Official externally defined facts

The following facts constrain the model; they do not authorize acquisition:

- Alpaca names `v2/sip`, `v2/iex`, `v2/delayed_sip`, `v1beta1/boats`, and
  `v1beta1/overnight` as distinct feeds. Its trade and quote schemas include exchange, condition,
  timestamp, and tape fields, and its stream has distinct correction and cancel/error messages.
  Consequently, provider, dataset, feed, channel, and revision identities cannot be inferred from
  the provider name alone. See [Alpaca Real-time Stock Data](https://docs.alpaca.markets/us/docs/real-time-stock-pricing-data),
  continuously updated documentation, accessed 2026-07-23.
- Alpaca's corporate-actions reference warns that provider receipt and processing can delay
  creation, and exposes types including splits and name changes. Corporate-action effective time,
  provider arrival time, and PEAS capture time are therefore separate facts. See
  [Alpaca Corporate Actions](https://docs.alpaca.markets/us/reference/corporateactions-1), accessed
  2026-07-23.
- The UTP plan identifies Tape C as the consolidated service for Nasdaq-listed securities, while
  its current participant input specification carries originator, feed sequence, participant
  token, timestamps, security identifier, trade ID, and original trade ID for corrections and
  cancellations. A correction targets an original trade rather than rewriting it anonymously.
  See [UTP technical overview](https://utpplan.com/PageParts/Technical.html) and
  [UTP Participant Input Specification, July 2026](https://www.utpplan.com/DOC/UtpBinaryInputSpec.pdf),
  accessed 2026-07-23.
- The CTA CQS output specification defines a per-line block sequence, daily reset behavior,
  retransmissions, and reset messages. Sequence values are meaningful only with protocol,
  channel/line, and trading date context. See
  [CTA CQS Pillar Output Specification](https://www.ctaplan.com/publicdocs/ctaplan/CQS_Pillar_Output_Specification.pdf),
  accessed 2026-07-23.
- FINRA distinguishes corrections, cancellations, and reversals and documents that tape-eligible
  odd lots are disseminated but generally do not update high, low, or last sale. A trade's
  eligibility cannot be derived from size alone or from its mere presence in a feed. See
  [FINRA Trade Reporting FAQ](https://www.finra.org/filing-reporting/market-transparency-reporting/trade-reporting-faq),
  accessed 2026-07-23.
- SEC Rule 613 requires synchronized business clocks and millisecond-or-finer event timestamps.
  That supports recording a clock basis and error bound; it does not make timestamps from different
  systems interchangeable. See [SEC Rule 613](https://www.sec.gov/about/divisions-offices/division-trading-markets/rule-613-consolidated-audit-trail),
  accessed 2026-07-23.
- NYSE corporate-action specification v2.2.5 gives a corporate-action ID specifically so recipients
  can detect changes to an already declared action and separately carries symbol and CUSIP. Symbol
  is an effective-dated alias, not sufficient instrument identity. See
  [NYSE Group Corporate Actions Client Specification v2.2.5](https://www.nyse.com/publicdocs/NYSE_Group_Corporate_Actions_Client_Specification.pdf),
  accessed 2026-07-23.

Provider-specific completeness, entitlements, retention rights, and as-known historical revision
availability remain unresolved. No successful-access inference is permitted.

## Identity graph and canonical rules

```text
provider + entitlement snapshot
  -> dataset -> feed -> venue/tape
  -> acquisition attempt -> raw artifact evidence -> delivery
  -> provider observation -> revision -> normalized fact
  -> deterministic candidate set + selection policy
  -> selected reference | stable missing reference
  -> provider discrepancy -> study-manifest entry

earnings observation -> existing marketReferenceJoinKey --------------------^
```

All proposed identities use:

```text
prefix + SHA-256(domainSeparator || 0x00 || RFC8785(canonicalPreimage))
```

The implementation should reuse the repository's `canonicalHash` rather than create another
canonicalizer. Preimages contain only exact, inert JSON primitives, arrays, and objects. Numbers in
identity preimages are non-negative safe integers. Prices and fractional sizes are canonical base-10
strings, never binary floating point. Timestamps are integer epoch nanoseconds represented as
canonical decimal strings when nanosecond precision is retained, or non-negative safe integer
milliseconds when the source supplies only milliseconds. A precision enum is always adjacent to a
timestamp. Sets are sorted by unsigned UTF-8 bytes and reject duplicates. Unknown or nullable
provider fields stay explicitly null; absence is never replaced by an empty string, zero, inferred
venue, default feed, current symbol, or wall clock.

An identity version changes whenever any preimage field, canonicalization rule, semantic meaning,
or provider mapping changes. Display labels are not identity authority.

## Proposed V1 identity registry

| Identity | Prefix and domain | Primitive preimage | Stability and separation rule |
| --- | --- | --- | --- |
| Market provider | `mpv1_`, `peas/market-provider/v1` | `{providerCode,serviceOperatorCode}` | One provider service operator; no plan/account/display label. |
| Entitlement snapshot | `ent1_`, `peas/market-entitlement-snapshot/v1` | `{providerId,productCode,accountClass,professionalStatus,effectiveFromMs,effectiveToMs,capabilities,permissionEvidenceHash,humanApprovalId,zeroIncrementalSpend}` | Immutable capability-by-capability authorization. `PENDING` and `NOT_AUTHORIZED` are real values, not null. No account ID or correspondence. |
| Dataset | `mds1_`, `peas/market-dataset/v1` | `{providerId,assetClass,productFamily,apiGeneration,recordFamily,coverageRegion}` | Historical SIP, latest delayed SIP, delayed stream, IEX, overnight, and FMP endpoint families remain distinct. |
| Feed | `mfd1_`, `peas/market-feed/v1` | `{datasetId,channelKind,providerFeedCode,consolidationKind,delayClass,adjustmentMode}` | Channel and feed selection are explicit; null/default feed is forbidden for study evidence. |
| Venue/tape | `mvt1_`, `peas/market-venue-tape/v1` | `{planCode,networkCode,participantCode,venueCode,protocolVersion,tradingDate}` | Network A/B/C and a venue are not interchangeable. Nullable fields remain null. Trading date scopes daily sequence resets. |
| Instrument/share class | `min1_`, `peas/market-instrument/v1` | `{issuerMappingId,securityAuthority,securityKey,shareClass,listingVenueCode,currency,effectiveFromMs,effectiveToMs}` | Symbol is an effective-dated alias. A CUSIP change may create a new instrument even if issuer continuity remains. |
| Acquisition attempt | existing `aob1_` plus `maq1_`, `peas/market-acquisition-attempt/v1` | `{acquisitionObservationId,providerId,datasetId,feedId,entitlementSnapshotId,instrumentIds,requestedWindow,routePolicyVersion}` | `aob1_` remains unchanged. Additive sidecar binds market scope without altering ArtifactStore or ledger ports. Requested window is semantic; URL, token, headers, credentials, and page size are excluded. |
| Artifact content | `mac1_`, `peas/market-artifact-content/v1` | `{sha256,sizeBytes,mediaType,contentEncoding}` | Identical bytes may share this content identity. |
| Raw artifact evidence | `mar1_`, `peas/market-raw-artifact/v1` | `{artifactContentId,vaultObservationId,vaultObservationHash,acquisitionObservationId,role}` | Provider/acquisition evidence remains distinct even for identical content. Must reconcile to commit and verified-read facts. |
| Provider observation | `mob1_`, `peas/market-provider-observation/v1` | `{providerId,datasetId,feedId,entitlementSnapshotId,instrumentId,venueTapeId,providerRecordKey,eventKind,eventTime,providerSequence,providerRevisionKey}` | Stable source assertion, independent of delivery attempt. Null provider keys remain null and trigger the declared fallback identity rule below. |
| Delivery | `mdl1_`, `peas/market-delivery/v1` | `{providerObservationId,acquisitionAttemptId,rawArtifactId,memberKey,occurrenceOrdinal}` | Redelivery has a new delivery ID but the same provider-observation ID. Ordinal is within the canonical artifact member sequence, not HTTP page number. |
| Revision family | `mrf1_`, `peas/market-revision-family/v1` | `{providerId,datasetId,feedId,instrumentId,eventKind,providerStableRecordFamily}` | Corrections/cancellations never cross provider, dataset, feed, or instrument identity. |
| Revision | `mrv1_`, `peas/market-revision/v1` | `{revisionFamilyId,revisionKind,providerRevisionKey,supersedesRevisionId,effectiveEventTime,normalizedFactId}` | `revisionKind` is `original|correction|cancellation`; cancellation has null fact. Arrival/capture time is evidence, not revision identity. |
| Market fact | `mft1_`, `peas/market-fact/v1` | `{instrumentId,eventKind,eventTime,venueTapeId,canonicalPayload}` | Provider-neutral economic assertion. Equal facts can occur at independent providers. |
| Normalized fact | `mnf1_`, `peas/market-normalized-fact/v1` | `{marketFactId,providerObservationId,revisionId,normalizerVersion,conditionPolicyVersion,calendarVersion}` | Keeps provenance and policy while sharing a provider-neutral fact identity. |
| Selection policy | `msp1_`, `peas/market-selection-policy/v1` | `{contractVersion,viewKind,anchorKind,intervalDefinitions,sourcePolicy,eligibilityPolicy,tieBreakPolicy,reasonCatalogVersion,boundsVersion}` | Provider ordering/fallback and anchor semantics are frozen before outcomes. |
| Selected reference | `msr1_`, `peas/market-selected-reference/v1` | `{marketReferenceJoinKey,intervalKey,referenceKind,selectionPolicyId,asOfBasis,selectedNormalizedFactId,selectedRevisionId,candidateSetHash}` | Quote, trade, bar, and prior close have different `referenceKind` values and cannot substitute silently. |
| Missing reference | `mmr1_`, `peas/market-missing-reference/v1` | `{marketReferenceJoinKey,intervalKey,referenceKind,selectionPolicyId,asOfBasis,reasonCode,candidateSetHash}` | Stable, first-class result retained in denominators. No random/error text. |
| Provider discrepancy | `mdp1_`, `peas/market-provider-discrepancy/v1` | `{marketReferenceJoinKey,intervalKey,referenceKind,selectionPolicyId,sortedProviderResults,comparisonPolicyVersion}` | Provider results stay distinct; agreement does not merge observations. |
| Study-manifest entry | `sme1_`, `peas/market-study-entry/v1` | `{studyManifestId,clusterId,marketReferenceJoinKey,issuerMappingId,instrumentId,selectionPolicyId,entitlementSnapshotIds,referenceResultIds,discrepancyIds}` | Freezes exact market evidence or missingness per precommitted cluster. |

### Fallback provider-observation key

If an official provider record/trade/quote ID is absent, use:

```text
providerRecordKey = null
providerRevisionKey = null
providerStableRecordFamily = H("peas/market-provider-fallback-family/v1", {
  providerId,datasetId,feedId,instrumentId,eventKind,eventTime,
  venueTapeId,providerSequence,canonicalProviderPayload
})
```

This is a PEAS synthetic family, explicitly labeled `fallback-derived`; it is not represented as a
provider-issued identity. If both provider sequence and stable key are null, byte-different
payloads at the same event time remain distinct observations and the equivalence class is
quarantined from deterministic last-selection unless the selection policy defines an exact
provider-specific disambiguator before outcomes.

## Existing identities that remain authoritative

PR 2D must reference, not replace:

- `aob1_`: acquisition observation from provider, retrieval attempt, sanitized request hash, and
  route label;
- `src1_`, `svr1_`, `rvf1_`, `sob1_`: earnings source record/version/family/observation;
- `imap1_`: effective-dated issuer/symbol mapping;
- `ole1_`: execution-scoped ledger entry;
- ArtifactStore observation ID/hash and SHA-256 artifact digest; and
- `mrj1_`: the existing earnings-observation market join.

The proposed `min1_` instrument identity references `imap1_` but does not claim that an issuer is
one security or share class. `msr1_` and `mmr1_` reference `mrj1_`; neither changes its preimage.

## Nullability and timestamp trust

| Time or ordering fact | Nullability | Trust/use | Identity rule |
| --- | --- | --- | --- |
| Exchange/participant event time | Required for quote/trade; required bar start for a bar; may be null only for a quarantined input | Primary market ordering only with declared precision, venue/tape, protocol, and condition semantics | Included in observation and fact identities |
| SIP/provider dissemination time | Nullable | Evidence of source latency; never silently substituted for exchange event time | Included only if the provider contract defines it as a record field |
| Provider receive time | Nullable | Provider-side telemetry; not PEAS receipt and not inferred | Excluded from market fact; may enter provider observation if provider-stable |
| Provider sequence/token | Nullable | Orders messages only in its explicit protocol/channel/trading-date scope | Included in provider observation when present |
| Request start/end | Nullable in the inherited ledger | Transport telemetry only; current `request.*` facts do not expose a distinct end time | Excluded from semantic market identities |
| Retrieval completion (`retrievedAtMs`) | Required for retrieval-basis selection | Trusted only after exact ArtifactStore commit/verification reconciliation and non-null clock basis | Already included in `marketReferenceJoinKey` retrieval basis |
| Artifact committed time | Required in ArtifactStore metadata; not currently a field in ledger commit facts | Durability telemetry, distinct from retrieval completion | Do not add to frozen ledger; additive sidecar may reference verified metadata |
| Normalization time | Nullable | Processing telemetry; never event time | Excluded from fact/selection identity |
| Durable capture (`receivedAtMs`,`logicalAtMs`) | Required for capture-basis selection | Operational first trusted normalized event; wall and logical time remain distinct | Already included in `marketReferenceJoinKey` capture basis |
| Correction effective time | Required when source supplies one; otherwise null plus reason | Determines which original fact a revision affects | Included in revision identity |
| Correction arrival/durable capture | Required for as-known use | Determines when PEAS could know the revision | Evidence/cutoff, not economic fact identity |
| Replay remap time | Null; replay preserves original stamps | Replay must not invent a new semantic observation time | Excluded from semantic identities |
| Monotonic time | Nullable; session-local | Orders events/durations within one process session and detects wall regression | Excluded from cross-session and semantic identities |

Wall time and monotonic time answer different questions. The local Node runtime's high-resolution
performance clock is process-relative, not an epoch timestamp; see
[Node.js v24 performance APIs](https://nodejs.org/docs/latest-v24.x/api/perf_hooks.html), accessed
2026-07-23. A monotonic value must therefore carry a session ID, cannot be compared across sessions,
and cannot be converted into market event time. Wall-clock regression requires the existing
`clock.regression` witness. A same-session monotonic regression fails closed.

## Human anchor decision record

### Alternative A: durable capture primary

- Definition: existing capture basis `{eventId,receivedAtMs,logicalAtMs,clockBasisId}`.
- Scientific meaning: market state when a normalized earnings observation was durably captured and
  operationally available to PEAS.
- Bias: shifts anchors later by provider, network, persistence, verified-read, normalization, and
  append latency; fast early market movement may be counted as pre-anchor.
- Strength: no claim that unverified or not-yet-normalized bytes were usable.

### Alternative B: retrieval completion primary

- Definition: existing retrieval basis `{role,acquisitionObservationId,vaultObservationId,
  retrievedAtMs,clockBasisId}` reconciled to an exact raw link.
- Scientific meaning: market state when acquisition of the selected raw artifact completed.
- Bias: shifts anchors earlier than durable normalized availability and may treat later-failing or
  later-quarantined bytes as if already usable unless selection requires the completed verification
  chain (it must).
- Strength: reduces contamination from local normalization/capture latency.

### Materiality test and recommendation

Run only original synthetic fixtures at deltas of `0`, `1`, `999`, `1,000`, `4,999`, `5,000`,
`29,999`, and `30,000` milliseconds between retrieval and capture, with quote changes between the
two anchors. If any reference at first, +1, +5, or +30 minutes changes, the choice is materially
different by construction. It does, so this report records `HUMAN_DECISION_REQUIRED`.

Recommended decision for an operational PEAS validation claim: Alternative A primary, Alternative B
mandatory sensitivity, plus a recorded `captureMinusRetrievalMs` distribution. This is a
recommendation only; integration must obtain the human decision before accepting ADR 0010.

## Deterministic revisions and views

### Duplicate classification

1. Validate all input and authority before sorting or hashing.
2. Group deliveries by `providerObservationId`.
3. Equal observation ID and equal canonical payload are redeliveries; preserve every `mdl1_` but
   pass one observation to normalization.
4. Equal provider/dataset/feed/stable record/revision key with different canonical payload,
   artifact evidence, or normalized fact is `market.provider-observation-conflict`; quarantine the
   whole equivalence class independent of arrival order.
5. Equal bytes from different provider, dataset, feed, entitlement, or observation identities are
   independent evidence. Never deduplicate them across those boundaries.

### Revision graph

- Every correction/cancellation is immutable and names exactly one prior revision when the source
  provides a target.
- Orphan targets, cycles, forks under one provider revision key, and correction of a cancellation
  without an explicitly allowed provider rule fail closed.
- A cancellation creates an `mrv1_` with `normalizedFactId:null`; it does not delete the original.
- A correction creates a new fact and revision, preserving original and corrected price, size,
  condition, effective time, and source target evidence.
- Arrival order never defines revision order. The provider target/revision relation is primary;
  correction effective time is secondary; the deterministic revision ID breaks an otherwise equal
  tie. An unresolved fork is a conflict, not “last writer wins.”

### As-known view

At an immutable study cutoff, admit only deliveries whose authoritative PEAS durable capture is at
or before the cutoff. Apply only revisions that were durably known by that cutoff. A later-arriving
correction whose effective time precedes the cutoff remains absent. This prevents correction
look-ahead.

### Corrected view

Use a separately frozen correction cutoff from the study manifest. Admit all revisions durably
captured by that cutoff, then apply their effective relation to the original event. Never describe
this as what PEAS knew at event time. The as-known and corrected result IDs differ through
`selectionPolicyId.viewKind` even if the selected value happens to agree.

## Deterministic selection and stable missingness

For each `{marketReferenceJoinKey,intervalKey,referenceKind,selectionPolicyId}`:

1. Validate the complete bounded manifest, identities, entitlement statuses, clock bases, raw
   authority, normalized facts, and revision graph before materializing a candidate set.
2. Reject an entitlement snapshot unless the exact provider/dataset/feed capability is allowed for
   the current recorded mode. While P1-09 is pending, only original synthetic fixtures with an
   explicit `synthetic-offline` entitlement snapshot may execute.
3. Filter by exact instrument effective interval, source policy, event-time window, session, trust
   level, reference kind, condition policy, and as-known/corrected cutoff.
4. Collapse exact redeliveries but retain delivery evidence.
5. Quarantine same-provider conflicts before any provider priority or timestamp tie-break.
6. Apply revisions without rewriting originals.
7. Build `candidateSetHash` from sorted tuples
   `{providerObservationId,revisionId,normalizedFactId,eligibilityCode}` including rejected
   candidates. Missingness is therefore reproducible and pagination cannot hide evidence.
8. Sort eligible candidates by the exact policy tuple, proposed as
   `{absoluteDistanceToTarget,eventTime,providerPriority,venueTapeId,providerSequence,
   providerObservationId,revisionId}`. Every direction and null ordering is fixed in the policy.
9. Persist the first `msr1_` or `mmr1_`; never rescan or recompute it after later arrival.

A later provider observation creates a new as-of selection or corrected-view selection. It cannot
mutate an existing selected or missing identity. Quote, trade, bar, and prior-close selectors run
independently and emit separately labeled results. No fallback changes `referenceKind`.

## Replay, restart, paging, and backend invariance

- Replay validates the original ledger first, preserves all semantic and market sidecar identities,
  changes only execution-scoped `ole1_` entries, and remaps every causal parent and regression
  witness to the new execution.
- Original entry IDs may appear only as typed evidence references, never as replay causal parents.
- `aob1_` is preserved by replay. Replay-mode commit/verification facts point to the same immutable
  original vault observation/hash/digest/size/retrieval epoch.
- Sidecar identity derivation consumes the validated semantic projection, never storage sequence,
  SQL row ID, filesystem path, page token, HTTP page size, iterator order, or insertion order.
- A page token is transport telemetry. `requestedWindow` enters acquisition policy identity;
  provider page size does not. Varying page size may change raw acquisition evidence but cannot
  change provider observation, fact, revision, candidate-set, selection, missing, discrepancy, or
  study-entry identity.
- A restart resumes from immutable cursor plus entry-ID reconciliation. It must not select before
  all declared pages/artifacts for the bounded window are verified, or after a selection was
  persisted.
- Memory and SQLite must produce byte-identical canonical sidecar records, candidate hashes, result
  IDs, and study entries. Backend sequence values are pagination evidence only.
- Active analysis leases freeze the already selected join and market result IDs. Later evidence may
  create a new branch/result but cannot mutate the leased branch.

## Closed reason-code proposal

| Code | Meaning |
| --- | --- |
| `market.identity-invalid` | Any displayed identity does not recompute from its exact V1 preimage. |
| `market.entitlement-unfrozen` | Required entitlement snapshot is missing or mutable. |
| `market.entitlement-not-authorized` | Exact provider/dataset/feed/use capability is pending, denied, or outside zero-spend policy. |
| `market.dataset-feed-mismatch` | Provider, dataset, channel, feed, consolidation, or adjustment identity conflicts. |
| `market.instrument-unmapped` | No effective instrument/share-class mapping exists. |
| `market.instrument-ambiguous` | More than one effective mapping is eligible. |
| `market.instrument-outside-effective-window` | Event time is outside the selected mapping interval. |
| `market.venue-tape-invalid` | Venue/tape/protocol/date scope is missing, invalid, or inconsistent. |
| `market.timestamp-missing` | Required source event time is absent. |
| `market.timestamp-untrusted` | Clock/precision/sequence evidence cannot satisfy the selected trust level. |
| `market.clock-basis-invalid` | Wall/monotonic/basis/nullability contract fails. |
| `market.artifact-observation-invalid` | Exact ArtifactStore observation is absent, forged, wrong-provider, or inconsistent. |
| `market.artifact-read-failed` | Verified complete read does not settle successfully. |
| `market.artifact-mismatch` | Digest, size, observation, or consumed bytes disagree. |
| `market.input-invalid` | Input is not exact inert data or violates the closed schema. |
| `market.parser-limit-exceeded` | Byte/token/depth/key/item/string/window bound is exceeded. |
| `market.duplicate-redelivery` | Informational: an exact provider observation was delivered again. |
| `market.provider-observation-conflict` | Same provider stable record/revision binds conflicting evidence. |
| `market.revision-orphan` | Correction/cancellation target is absent. |
| `market.revision-conflict` | Revision fork, cycle, or reused revision key conflicts. |
| `market.correction-after-cutoff` | Informational: revision is excluded from the as-known view. |
| `market.no-eligible-quote` | Candidate set contains no eligible quote. |
| `market.no-eligible-trade` | Candidate set contains no eligible trade. |
| `market.no-eligible-bar` | Candidate set contains no eligible bar. |
| `market.no-prior-close` | No eligible prior-close fact exists. |
| `market.selection-conflict` | Exact policy tuple cannot produce one winner without an unfrozen rule. |
| `market.selection-limit-exceeded` | Candidate or comparison-set bound is exceeded. |
| `market.provider-disagreement` | Independently selected provider results disagree under the frozen comparison rule. |
| `market.replay-incompatible` | Replay cannot preserve required semantic identity or remap all causal evidence. |

`market.duplicate-redelivery`, `market.correction-after-cutoff`, and
`market.provider-disagreement` may be annotations. All other rows fail closed or produce the exact
typed missing result specified by the selection policy. No provider error text enters a reason code
or identity.

## Proposed exact bounds

These values are conservative PR 2D contract recommendations, not provider maximums. The
integration owner may reconcile them with the other reports before the contract checkpoint, but
must not leave any dimension unbounded.

| Boundary | Exact maximum |
| --- | ---: |
| Canonical sidecar record / bundle | 64 KiB / 64 MiB |
| JSON depth / nodes / keys / array items per record | 8 / 512 / 64 / 32 |
| Identifier / general string / original timestamp | 512 / 4,096 / 256 UTF-8 bytes |
| Canonical decimal price / size | 32 / 32 ASCII bytes |
| Condition codes per observation / bytes per condition | 16 / 8 |
| Raw artifacts per acquisition batch | 16 |
| Verified member / aggregate bytes | 10 MiB / 64 MiB |
| Parser tokens per artifact / record items per artifact | 250,000 / 10,000 |
| Instruments per acquisition / providers per policy | 256 / 8 |
| Revisions per family / deliveries per provider observation | 32 / 32 |
| Candidates per reference selection | 10,000 |
| Reference intervals per cluster / reference results per cluster | 16 / 64 |
| Sidecar records per execution / causal edges | 4,096 / 12,279 |
| Page size | 1..10,000 |
| Selection time window | 0..86,400,000 ms |

Totals are preflighted before recursion, parsing, allocation, sorting, or hashing. An exact-bound
test must succeed and the same fixture with exactly one byte/item/key/token/depth/condition/
instrument/revision/delivery/candidate/interval/record/edge/page/window unit over must fail with the
stable limit reason. A declaration within limit paired with actual bytes over limit must fail on
the actual read.

## Redistribution-safe synthetic executable cases

1. Golden preimage for every prefix/domain above, including RFC 8785 bytes and digest.
2. Historical REST SIP, delayed SIP stream, latest delayed SIP, IEX, and a synthetic FMP aggregate
   produce different dataset/feed IDs under one or different providers.
3. Same SHA-256 bytes under two providers share `mac1_` but have different `mar1_`, `mob1_`,
   entitlement, and delivery IDs.
4. Same provider observation delivered twice has two `mdl1_` values, one `mob1_`, one normalized
   candidate, and `market.duplicate-redelivery` evidence.
5. Same stable provider record/revision with byte- or fact-different evidence quarantines in both
   arrival orders.
6. Provider-issued correction targets the original trade; original and corrected revision IDs are
   immutable. Cancellation produces a null-fact revision.
7. Orphan correction, revision fork, cycle, cancel-then-unsupported-correct, and reused provider
   revision key fail closed.
8. Correction effective before the event but captured after the as-known cutoff is absent from
   as-known and present in corrected view.
9. Equal event times with different venue/tape/sequence identities sort deterministically; missing
   sequence follows the exact null ordering.
10. Tape A/B/C, daily sequence reset, retransmission, and protocol-version changes cannot collapse
    venue/tape identity.
11. Symbol-only change keeps instrument identity only when an effective mapping explicitly says the
    underlying security key/share class is continuous; CUSIP/share-class change creates a new
    instrument identity.
12. Corporate action announced, revised, received late, and captured later preserves declaration,
    effective, provider-arrival, and PEAS-capture times separately.
13. Retrieval and capture anchors separated by every interval boundary demonstrate the required
    human decision and produce different selection policy/result IDs.
14. Wall regression with preserved monotonic order requires an exact witness; monotonic regression
    fails. Cross-session monotonic comparison rejects.
15. Replay preserves every semantic/market/result/study identity and remaps every `ole1_` parent and
    regression ID.
16. All input orders, duplicate redelivery orders, correction arrival orders consistent with the
    same captured facts, and page sizes `1`, `2`, `7`, `10,000` produce identical canonical results.
17. Restart before/after each artifact verification and before/after selection produces one result,
    never a partial candidate set.
18. Memory/SQLite output is byte-identical after per-record reopen and active-lease later arrival.
19. Quote, trade, bar, and prior-close results remain separately typed; a missing quote cannot be
    filled by an available trade or bar.
20. Every bound above has exact/one-over coverage, including actual-stream growth and malformed
    nested inert-data hostility with zero getter/proxy execution.
21. Pending/denied/expired entitlement, wrong dataset/feed, and unauthorized fallback produce a
    stable missing/failure result without provider access.
22. Provider disagreement preserves both selected provider results and yields one deterministic
    `mdp1_`; equal economic facts do not merge provenance.

All committed payloads must be original fictitious data, invalid domains, synthetic symbols and
security keys, and a provenance declaration with `classification:"synthetic"`. No real provider
body, headline, quote, trade, credential, URL token, account fact, or licensed identifier set is
needed.

## Frozen-port compatibility and implementation placement

The design is additive:

- keep `ObservationLedgerFactsV1` and `deriveMarketReferenceJoinKey` unchanged;
- keep `ArtifactStore`, `EventLog`, and `ProcessingStore` interfaces unchanged;
- do not add or rewrite a migration;
- model market contracts in new source modules and bounded sidecar/manifest values;
- persist through existing approved repository patterns only if the accepted contract shows that
  no port or migration change is required; otherwise stop for a human-approved contract amendment;
- keep market telemetry out of earnings `EventDraft`, reducer identity, evidence-bundle identity,
  and financial-effect paths; and
- make acquisition an excluded future effect boundary. PR 2D normalization and selection consume
  only verified recorded artifacts.

## Required integration decisions

1. **Human:** choose durable capture or retrieval completion as primary, with the other retained as
   a sensitivity. Record the intended scientific claim and expected bias.
2. **Contract integration:** reconcile exact source/feed/instrument fields with the provider and
   microstructure reports without weakening their separation.
3. **Contract integration:** freeze whether the corrected view cutoff is a fixed duration or a
   fixed timestamp in the dataset freeze manifest. It cannot be chosen after outcomes.
4. **Human/P1-09:** authorize no provider until the exact entitlement snapshot is approved. FMP
   cannot become fallback automatically.
5. **Contract amendment only if necessary:** any new migration, dependency, or frozen-port change
   is outside this proposal and requires explicit human approval plus fresh contract review.

Until item 1 is decided, research and non-anchor-dependent recorded/offline contract work may
continue, but ADR 0010 must not be accepted with an implicit primary anchor.
