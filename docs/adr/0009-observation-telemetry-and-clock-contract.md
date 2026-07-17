# ADR 0009: Observation telemetry and clock contract

- Status: Accepted after independent contract review `GO`
- Date: 2026-07-16
- Compatibility: additive adapter-side contract; no port, reducer, migration, or manifest change

## Closed causal ledger

Telemetry is an immutable bounded execution bundle. Identity flows only forward:

```text
retrieval attempt -> acquisition observation -> raw artifact links
  -> derived projection -> provider source record/version
  -> normalized source observation -> trusted captured event
```

Each exact inert entry contains schema version 1, execution ID, derived entry ID/hash, sorted unique
parent IDs, a closed clock stamp, and one `ObservationLedgerFactsV1` variant. The normative exact
types, parent transition matrix, and bounds are in
[`pr-2c-observation-ledger-schema.md`](../contracts/pr-2c-observation-ledger-schema.md). `facts.kind`
is the only discriminant. Unknown fields/kinds, invalid transitions, missing/cross-execution/self
parents, and cycles reject before materialization.

The closed fact kinds and fields are:

- `clock-basis.declared`: complete ClockBasis;
- `acquisition.declared`: acquisition ID, provider, retrieval attempt, sanitized request hash,
  safe route label;
- `request.started`: acquisition ID;
- `request.succeeded`: acquisition ID and safe response-metadata hash;
- `artifact.committed`: acquisition ID, vault observation ID/hash, digest, size, exact
  `live|recorded|replay` acquisition mode, and nullable retrieval epoch;
- `artifact.verified`: acquisition ID, vault observation ID, digest, metadata and consumed sizes;
- `normalization.emitted`: projection ID/digest, source observation and complete source identity,
  publication, issuer mapping, subject/period, nullable evidence bundle, raw/derived primary
  discriminant/hash, 1-16 raw links, loader/selection/transcript/normalizer hashes, draft output hash;
- `normalization.ignored`: raw links, loader/selection/transcript/normalizer hashes and reason;
- `normalization.quarantined`: raw links, loader/selection/transcript, nullable normalizer/transcript,
  and reason;
- `capture.appended` or `capture.redelivered`: source observation/version, event ID/hash/position,
  received and logical times;
- `selection.recorded`: purpose, `capture|retrieval` basis and typed trusted-basis value, selected
  source observation/version, subject, issuer mapping, as-of, nullable branch and market join key;
- `failure.recorded`: stage, exact `failedAfter` predecessor kind, nullable acquisition/source
  observation under the normative stage matrix, reason and nullable bounded detail hash; and
- `clock.regression`: prior and regressing entry IDs, prior/current wall time, monotonic-order flag.

Unknown metadata maps, raw headers, URLs, or exception text are forbidden. Ignored/quarantined/
failure facts have no projection, source version/observation, or output hash. Request failure
prohibits commit; store/read failure prohibits normalization; ignored/quarantine prohibits capture.
Successful sibling evidence remains visible after one member fails, but no partial source emits.

Raw links are exact `{role,acquisitionObservationId,vaultObservationId,vaultObservationHash,
artifactDigest,sizeBytes}`. One acquisition commits at most one vault observation/digest; one vault
observation cannot name two digests. Links sort by role/acquisition ID/vault observation ID and
duplicates reject.
Verified metadata, consumed, and committed sizes are equal.

## Acyclic identities

```text
acquisitionObservationId = "aob1_" + H("peas/acquisition-observation/v1", {
  provider,retrievalAttemptId,sanitizedRequestIdentityHash,routeLabel
})
rawEvidenceSetHash = H("peas/raw-evidence-set/v1", sorted {role,artifactDigest})
projectionDigest = H("peas/provider-derived-content/v1", canonicalProjection)
projectionId = "prj1_" + H("peas/provider-derived-projection/v1", {
  loaderIdentity,normalizerIdentity,rawEvidenceSetHash,projectionDigest
})
sourceRecordIdentity = "src1_" + H("peas/provider-source-record/v1", {provider,source,providerRecordId})
sourceVersionIdentity = "svr1_" + H("peas/provider-source-version/v1", {
  sourceRecordIdentity,providerRevisionId,projectionDigest,evidenceBundleHash
})
revisionFamilyIdentity = "rvf1_" + H("peas/provider-revision-family/v1", {
  provider,source,providerStableRecordFamily
})
sourceObservationId = "sob1_" + H("peas/normalized-source-observation/v1", {
  sourceVersionIdentity,projectionId,sortedUniqueAcquisitionObservationIds
})
entryHash = H("peas/observation-ledger-entry/v1", {
  schemaVersion,executionId,parentEntryIds,clock,facts
})
entryId = "ole1_" + entryHash
```

Validators recompute every displayed identity. `providerStableRecordFamily` is exactly
`providerRecordId` for PR 2C and the
merged SEC path. Acquisition ID is known before bytes/normalization. New
attempts change acquisition/source-observation telemetry but preserve semantic projection/version.
URLs, paths, queries, credentials, headers, times, and observation IDs enter none of the raw-
evidence/projection/record/version/family hashes. Provider-stable family is defined by ADR 0008;
supersession is never guessed. Same provider record/revision plus changed projection is
`observation.revision-conflict` and cannot capture. Different providers retain distinct source
identities even with equal raw/projection digests.

`domainPrimaryArtifactKind:raw-artifact` requires the primary digest exactly once in raw links.
`derived-projection` requires primary equal projection digest and never describes it as retrieval.
PR 2C FMP/NVIDIA drafts use raw primary artifacts; projections remain transcript/telemetry.

## Publication, mapping, and clocks

Publication is exactly null/unknown/null-original; non-null exact-or-provider with non-null
original; or non-null inferred under a named policy with nullable original. ADR 0008 defines no
FMP/NVIDIA inferred time. Mapping freezes ten-digit CIK, up to eight sorted symbols, selected symbol,
authority/version, and nullable effective bounds.

A clock stamp is either all-null; basis+wall with null monotonic; or basis+wall+monotonic. All values
are non-negative safe integers; wall is epoch milliseconds and monotonic is session-local
microseconds. Basis is:

```text
{clockBasisId, wallClock:system-utc|recorded-fixture|replayed-original,
 synchronization:verified-bound|operator-asserted|unspecified|not-applicable,
 maximumErrorMs, monotonicClock:process-monotonic-us|none, monotonicSessionId}
```

Basis ID hashes the other fields under `peas/clock-basis/v1`. Null basis iff both times null;
monotonic implies wall+basis. `none` iff session null; process monotonic iff session non-null.
Maximum error non-null iff verified-bound. Recorded/replayed require not-applicable; system UTC
permits only verified-bound, operator-asserted, or unspecified. A basis declaration is all-null;
every non-null-basis entry has its matching declaration as a direct parent. Wall regression appends one clock-regression fact and
does not reorder causal facts; same-session monotonic regression fails closed. Capture times equal
the stored event; kernel logical time remains reducer order, not wall time. Recorded fixtures do not
invent request intervals; replay references original retrieval/capture facts.

## Explicit selection and future market join

Selection references causally prior verified evidence, satisfies retrieval `<= asOfMs`, never scans
history, persists first winner/comparison set, and is never recomputed. The telemetry-only future
join is:

```text
marketReferenceJoinKey = "mrj1_" + H("peas/market-reference-join/v1", {
  subject,issuerMappingId,selectedSourceObservationId,
  selectedSourceVersionIdentity,trustedObservationBasis
})
```

A capture basis is `{basisKind:"capture",eventId,receivedAtMs,logicalAtMs,clockBasisId}`. A
retrieval basis is one identified primary raw artifact `{basisKind:"retrieval",role,
acquisitionObservationId,vaultObservationId,retrievedAtMs,clockBasisId}`. Retrieval selection
directly parents both its normalization and selected artifact verification; every basis field
reconciles to the causal commit/verification chain. Only market-reference selection may have a
non-null join key. It contains no quote, price, venue, vendor, session, or market implementation.
A leased branch freezes its source observation/version, event, artifacts, and join key; later
arrivals cannot mutate them.

## Bounds and replay

```text
entry bytes/depth/nodes/keys/array items  64 KiB / 8 / 512 / 64 / 32
string/identifier/original timestamp      4 KiB / 512 / 256 bytes
raw artifacts/symbols/parents             16 / 8 / 32
causal depth                              16
entries per acquisition                   32
source projections per subject/execution 32
entries/edges per execution bundle        4,096 / 12,279
clock bases per bundle                    32
page size                                 1..10,000
```

Totals preflight before recursion/sort. Parents are same-execution unique/sorted. Cross-execution
replay uses typed identities, not parents. Pagination uses immutable storage order plus entry-ID
reconciliation; page size changes no fact/hash. Global repository access is always paged. Every
bound has exact/one-over tests.

Replay re-emits each original acquisition declaration unchanged, preserving retrieval-attempt and
acquisition IDs, then replay-mode commit and verification facts for each immutable original raw
vault observation. It preserves original clock bases/stamps and re-emits capture when needed by a
capture-basis selection, then emits normalization/selection facts with same-execution causal
parents. Projection/source/version/observation identities, selection facts, and join keys remain
stable; ledger entry IDs change with execution ID. Original entry IDs are typed evidence values
only, never causal parents. Raw member/
fixture order canonicalizes. Same captured sequence produces identical
projections, versions, selections, draft hashes, and reducer snapshots at all page sizes. Missing
telemetry can reduce measurement completeness but cannot alter domain behavior.

Current vault/SEC contracts already expose attempt start/outcome, selected vault observation,
retrieved time, digest/size/verified reads, explicit selection/as-of, normalization transcript, and
trusted capture. Transport end is not separately exposed and is never equated with retrieval.
Future live orchestration may append request facts without a port change. Telemetry is not an
EventDraft/reducer/manifest field and authorizes no effect.
