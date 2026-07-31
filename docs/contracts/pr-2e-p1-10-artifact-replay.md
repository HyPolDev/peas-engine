# PR 2E P1-10 artifact, journal, restart, and replay contract

- Status: proposed contract-only checkpoint; implementation remains `NO_GO`
- Scope: P1-10 historical market-reference acquisition only
- Authority: accepted PR 2D provider-neutral contracts, ADR-0006, ADR-0009, and the
  P1-09 final authorization/GO chain
- Production namespace reserved for a later authorized PR 2F:
  `src/adapters/market-acquisition/**`

This document defines how a later live Alpaca historical-SIP acquisition may cross the existing
private artifact boundary, how an acquisition journal makes page progress resumable, and how
accepted PR 2D normalization and selection are replayed without changing their semantics. It is
documentation and contract evidence only. It does not authorize or contain transport code,
credential loading, provider requests, provider payloads, a provider witness, retention deletion,
or an FMP client.

The accepted PR 2D `ArtifactStore` port, observation-ledger fact shapes, source identities,
normalization policy, correction policy, selection policy, and recorded synthetic loader remain
frozen. The later implementation must add an acquisition-owned journal beside those ports. It
must not repurpose `src/adapters/market-reference/recorded-market-loader.ts`, place network code in
a PR 2D namespace, or claim that an in-memory PR 2D replay boundary is already a durable live
checkpoint.

## 1. Normative language and authority

`MUST`, `MUST NOT`, `REQUIRED`, `FORBIDDEN`, `SHALL`, and `SHALL NOT` are normative.

This contract is subordinate to, and must be read with:

1. `docs/adr/0010-market-reference-contract.md`;
2. `docs/contracts/pr-2d-provider-source-identity.md`;
3. `docs/contracts/pr-2d-timestamp-trust.md`;
4. `docs/contracts/pr-2d-market-eligibility.md`;
5. `docs/contracts/pr-2d-reason-codes.md`;
6. `docs/contracts/pr-2d-resource-bounds.md`;
7. `docs/contracts/pr-2d-fixture-manifest.md`;
8. `docs/contracts/pr-2d-acceptance-matrix.md`;
9. `docs/contracts/pr-2d-study-freeze-manifest.md`;
10. `docs/adr/0006-provider-neutral-artifact-vault.md`;
11. `docs/adr/0009-observation-telemetry-and-clock-contract.md`;
12. `docs/contracts/pr-2e-p1-10-entitlement-identity.md`;
13. `docs/contracts/pr-2e-p1-10-acquisition-state-machine.md`; and
14. `docs/contracts/pr-2e-p1-10-credential-privacy-retention.md`.

P1-09 final GO and closure supersede historical prose that still says P1-09 is pending. That
historical prose is not edited by PR 2E. If this document conflicts with an accepted PR 2D byte or
the final P1-09 authorization, the accepted authority wins and P1-10 stops for a prospective
contract amendment.

## 2. Scope and non-ownership

P1-10 owns only:

- declared historical market-reference acquisition;
- private raw-page capture;
- page-chain verification and durable restart state;
- deterministic replay of those verified artifacts; and
- translation into the already accepted provider-neutral PR 2D boundary.

P1-10 does not own SEC, earnings-related FMP mirror, issuer-IR, or calendar acquisition. It does
not own a generic arbitrary-route client, event-study calculation, a new source-selection policy,
or a new correction interpretation.

The first implementation wave may implement only the frozen Alpaca primary lane. FMP remains
contract-tested private-discrepancy scope: never primary, never fallback, never SIP/NBBO
equivalent, never able to alter an Alpaca selection, and never present in public output. No FMP
production file may be added in PR 2F.

## 3. Existing boundary facts and explicit gaps

The current `ArtifactStore` port exposes:

- `store`;
- `stat`;
- verified `read`;
- `getAttempt`;
- `getObservation`;
- paged `readObservations`; and
- bounded `reconcile`.

It exposes no delete method and no P1-10 journal method. Migration 005 installs immutable
observation and vault evidence with no-update/no-delete triggers. ADR-0006 deliberately deferred
retention deletion. Therefore:

- the journal must be additive and owned by
  `src/adapters/market-acquisition/**`;
- the accepted `ArtifactStore` interface must not be silently extended;
- migration 005 must not be rewritten;
- recorded-loader projections and function returns are not durable live journal entries; and
- retention deletion cannot be claimed as implemented by marking a journal row terminal.

An additive P1-10 journal store may have memory and SQLite implementations after all entry gates
pass. Its schema and migration, if any, must be declared in the PR 2F ownership map and reviewed as
new P1-10 state. It must not change frozen artifact-vault or observation-ledger semantics. Any
port, migration, reconciliation, or vault-semantic change required specifically to implement
retention deletion is `HUMAN_AUTHORIZATION_REQUIRED`; until that authorization exists, PR 2F is
`NO_GO`.

## 4. Identity separation

Every identity in this section uses the accepted PR 2D framing, without a second interpretation:

```text
utf8(s) = exact UTF-8 bytes of s
lp(b) = uint64be(byteLength(b)) || b
H(domain, preimage) =
  SHA-256(lp(utf8(domain)) || lp(utf8(RFC8785(preimage))))
```

`uint64be` is exactly eight unsigned big-endian bytes. Each displayed preimage is one exact inert
JSON object, not a positional argument list. It has exactly the shown field names and no inherited,
missing, extra, accessor, symbol, sparse, proxy, cyclic, unsafe-number, or silently defaulted value.
Set-like arrays are dense, unique, and sorted by unsigned UTF-8 bytes before hashing. The lowercase
64-hex digest returned by `H` is used directly unless a literal prefix is shown.

The P1-10-only domain strings are closed to these exact values:

```text
"peas/market-acquisition-request/v1"
"peas/market-acquisition-configuration/v1"
"peas/market-acquisition-logical-page/v1"
"peas/market-acquisition-attempt-control/v1"
"peas/market-acquisition-journal/v1"
"peas/market-acquisition-private-token/v1"
"peas/market-acquisition-continuation-binding/v1"
"peas/market-acquisition-journal-entry/v1"
"peas/market-acquisition-page-chain/v1"
```

An unknown version, domain, prefix, field, field spelling, enum value, canonicalizer, or framing
fails closed before credential read or dispatch.

### 4.1 Stable request and configuration identities

`requestIdentityHash` is the acquisition-wide P1-10 hash of this exact non-secret object:

```text
requestIdentityHash =
  H("peas/market-acquisition-request/v1", {
    providerId,
    datasetId,
    feedId,
    endpointChannelId,
    entitlementSnapshotId,
    authorizationMode,
    instrumentIds,
    canonicalSymbols,
    factFamily,
    queryStartNs,
    queryEndNs,
    semanticFixedFields: {
      feed,
      sort,
      timeframe,
      adjustment
    },
    routePolicyVersion
  })
```

`authorizationMode` is exactly `p1-09-approved`. `instrumentIds` and `canonicalSymbols` are
independently validated, non-empty, sorted unique arrays with a one-to-one instrument/symbol
mapping; neither array may be derived from the other by string convention. `factFamily` is exactly
`quote`, `trade`, or `bar`, consistent with the endpoint channel. `queryStartNs` and `queryEndNs`
are canonical unsigned base-10 epoch-nanosecond strings. `semanticFixedFields.feed` is exactly
`sip`, and `semanticFixedFields.sort` is exactly `asc`. For `bar`,
`semanticFixedFields.timeframe` is exactly `1Min` and `adjustment` is exactly `raw`; both values are
JSON null for `quote` and `trade`. `routePolicyVersion` is exactly
`p1-10-frozen-historical-multi-symbol-v1`.

The endpoint-channel identity plus the frozen route policy binds the one authorized `GET` route.
Origin, URL, path, query serialization, headers, credentials, account state, response bytes, raw
or hashed page token, requested page limit, page ordinal, attempt, backend, and execution time are
not identity fields. Every page and retry for the unchanged logical query retains the same
`requestIdentityHash`.

The requested provider page limit and operational retry/quota/deadline ceilings are closed
configuration, not PR 2D semantic identity. `acquisitionConfigurationHash` is exactly:

```text
acquisitionConfigurationHash =
  H("peas/market-acquisition-configuration/v1", {
    requestIdentityHash,
    requestedPageLimit,
    effectiveLesserOfEntitlementAndProjectCeilings: {
      concurrentRequests,
      rawArtifactBytes,
      aggregateBytes,
      pages,
      recordsPerPage,
      facts,
      tokenBytes,
      instruments,
      spanDays,
      attempts,
      pageAttempts,
      retryAfterMs,
      attemptDeadlineMs,
      acquisitionDeadlineMs,
      rateAttempts,
      rateWindowMs
    },
    runScopedLiveEnableDecision,
    zeroSpendPolicyIdAndDecision: {
      policyId,
      decision
    },
    retryPolicyVersion,
    quotaPolicyVersion,
    deadlinePolicyVersion,
    retentionPolicyReadiness,
    journalSchemaVersion
  })
```

`requestedPageLimit` is a canonical JSON integer from 1 through 10,000.
`effectiveLesserOfEntitlementAndProjectCeilings` contains the effective value after taking the
lesser of the entitlement limit and project ceiling for every shown field. The project values are,
respectively, `1`, `10485760`, `67108864`, `16`, `10000`, `160000`, `4096`, `64`, `8`, `48`, `3`,
`30000`, `30000`, `300000`, `30`, and `60000`. A stricter entitlement changes the corresponding
effective field and therefore this hash.

`runScopedLiveEnableDecision` is exactly boolean. `zeroSpendPolicyIdAndDecision.policyId` is the
validated `mzp1_` identity and `decision` is exactly `allow` or `reject`; only `allow` can reach
dispatch, and only after the separately validated cost status is exactly
`zero-incremental-spend-approved`. Policy strings are exactly:

```text
retryPolicyVersion = "p1-10-deterministic-1s-2s-no-jitter-v1"
quotaPolicyVersion = "p1-10-30-per-rolling-60s-v1"
deadlinePolicyVersion = "p1-10-30s-attempt-300s-acquisition-v1"
retentionPolicyReadiness =
  "authorized" | "human-authorization-required-not-authorized"
journalSchemaVersion = 1
```

The retry policy literal binds total-attempt ceilings and exact `1000`/`2000` ms delays in section
12; the quota and deadline literals bind the exact values shown above. The current PR 2E value of
`retentionPolicyReadiness` is `human-authorization-required-not-authorized`, so implementation
remains `NO_GO`. Restart independently recomputes the complete object and rejects any changed
value as `journal-conflict`. The configuration hash contains no URL, credential, account, raw
token, or provider bytes and enters no PR 2D semantic identity.

### 4.2 Private logical-page identity

The token hash, logical page, attempt-control identity, and continuation binding are exactly:

```text
privateTokenHash =
  H("peas/market-acquisition-private-token/v1", {
    opaqueTokenMaterial
  })

logicalPageIdentityHash =
  H("peas/market-acquisition-logical-page/v1", {
    requestIdentityHash,
    pageOrdinal,
    currentTokenHash
  })

attemptControlHash =
  H("peas/market-acquisition-attempt-control/v1", {
    logicalPageIdentityHash,
    attemptOrdinal,
    runSessionNonce
  })

attemptId = "mat1_" + attemptControlHash
retrievalAttemptId = "rat1_" + attemptControlHash

continuationBindingHash =
  H("peas/market-acquisition-continuation-binding/v1", {
    precedingMarketAcquisitionId,
    requestIdentityHash,
    precedingLogicalPageIdentityHash,
    precedingPageOrdinal,
    precedingArtifactObservationId,
    precedingArtifactDigest,
    precedingPageChainHash,
    nextPageOrdinal,
    nextTokenHash
  })
```

`opaqueTokenMaterial` is the exact unmodified provider token after the 4,096-byte bound passes.
`pageOrdinal` and `attemptOrdinal` are non-negative canonical JSON safe integers. Page zero uses
the literal JSON string `no-token` for `currentTokenHash`; a verified terminal page uses the
literal JSON string `terminal` for `nextTokenHash`. Those markers are not hashes and cannot be
provider token material. A continuation uses the lowercase 64-hex `privateTokenHash`.

`runSessionNonce` is a new, non-secret, bounded identifier generated once when the run declaration
is durably created. It is persisted in the private declaration, remains unchanged across restart,
and is never regenerated for an existing journal. It prevents two independently declared runs
from sharing physical attempt IDs. It is not wall-clock time, process ID, backend row ID, raw
token, credential, or semantic provider evidence.

Every retry for a logical page retains:

- `requestIdentityHash`;
- `logicalPageIdentityHash`;
- page ordinal; and
- private current-token binding.

Every physical dispatch increments `attemptOrdinal` and therefore has a new `attemptId`,
`retrievalAttemptId`, acquisition observation, and `marketAcquisitionId`. A crashed or abandoned
ordinal is never reused. The continuation binding is created only by the verified preceding page
checkpoint and is recomputed before constructing the next request. Attempt/acquisition-observation
identity, trusted request-start evidence, retry ordinal, and delivery observation must never be
collapsed into logical request or logical-page identity.

This split is required for consistency with PR 2D page-layout invariance. Any sibling contract
that uses `requestIdentityHash` to mean a page-and-token hash must be repaired before candidate
freeze; the accepted package must use the acquisition-wide meaning above and the distinct
`logicalPageIdentityHash`.

### 4.3 Frozen PR 2D acquisition identities

The acquisition-observation preimage remains byte-for-byte the accepted PR 2D object:

```text
acquisitionObservationId =
  "aob1_" + H("peas/acquisition-observation/v1", {
    provider,
    retrievalAttemptId,
    sanitizedRequestIdentityHash,
    routeLabel
  })
```

For the Alpaca lane, `provider` is exactly `alpaca`,
`sanitizedRequestIdentityHash` is exactly `requestIdentityHash`, and `routeLabel` is exactly one
of `alpaca-v2-historical-quotes`, `alpaca-v2-historical-trades`, or
`alpaca-v2-historical-bars`, matching the frozen endpoint channel. `retrievalAttemptId` is the
exact `rat1_` value above. PR 2E adds no field and makes no alternate acquisition-observation
derivation.

`marketAcquisitionId` remains byte-for-byte the accepted PR 2D identity:

```text
marketAcquisitionId =
  "maq1_" + H("peas/market-acquisition-attempt/v1", {
    acquisitionObservationId,
    providerId,
    datasetId,
    feedId,
    endpointChannelId,
    entitlementSnapshotId,
    instrumentIds,
    requestedFactKinds,
    queryStartNs,
    queryEndNs,
    sortOrder,
    routePolicyVersion
  })
```

`instrumentIds` is the same sorted unique array used by request identity.
`requestedFactKinds` is exactly the one-member array `["quote"]`, `["trade"]`, or `["bar"]`
consistent with `factFamily`; `sortOrder` is exactly `asc`; the other shared fields equal the
request preimage exactly. Because `acquisitionObservationId` binds the physical
`retrievalAttemptId`, a retry or different page has a new `marketAcquisitionId`. Page size,
ordinal, token, response order, URL, credentials, headers, account state, path, backend, and
execution time remain excluded. No PR 2E hash may substitute for either accepted identity.

### 4.4 Journal and checkpoint identities

The journal is addressed by this inert identifier:

```text
marketAcquisitionJournalId =
  H("peas/market-acquisition-journal/v1", {
    schemaVersion,
    requestIdentityHash,
    providerId,
    datasetId,
    feedId,
    endpointChannelId
  })
```

`schemaVersion` is the canonical JSON integer `1`; the remaining fields equal the request
preimage. The ID is the lowercase 64-hex digest with no prefix.

Each immutable journal entry has:

```text
journalEntryHash =
  H("peas/market-acquisition-journal-entry/v1", {
    marketAcquisitionJournalId,
    journalSequence,
    priorJournalEntryHash,
    entryKind,
    canonicalEntryBody
  })
```

`entryKind` equals the closed `checkpointKind`. `canonicalEntryBody` is a JSON string whose bytes
are exactly `utf8(RFC8785(body))`. `body` is the complete checkpoint object after removing exactly
these envelope fields: `marketAcquisitionJournalId`, `journalSequence`,
`priorJournalEntryHash`, `checkpointKind`, and `journalEntryHash`. No other field is removed.
Sequence zero uses the literal JSON string `genesis`; every later
`priorJournalEntryHash` is the exact lowercase 64-hex preceding hash.

`journalSequence` is a contiguous non-negative canonical JSON safe integer, but it is not a
semantic PR 2D identity. Validators independently reconstruct `body`, canonicalize it, recompute
the exact entry envelope, and compare the hash. Hashing a checkpoint with an empty or omitted
`journalEntryHash`, hashing a positional list, passing `body` as a JSON object instead of the
canonical string, or including any envelope field in `body` is invalid. Backend row IDs, insertion
order, process IDs, filesystem paths, and SQLite sequence values are forbidden from every identity
preimage.

The journal schema version, domain strings, canonical serialization, and hash algorithm are
closed configuration. Unknown versions or fields fail closed; they are never ignored or
best-effort upgraded.

On every append, load, restart, and replay, the validator independently reconstructs and compares
the request, configuration, logical-page, attempt-control, acquisition-observation,
market-acquisition, journal, private-token where material is available, continuation-binding,
page-chain, and journal-entry preimages. Comparing a stored identity to a second copied field,
accepting a caller-supplied digest without its preimage, or rehashing a toy/partial preimage is not
validation. Any single mismatch is terminal journal corruption before credential read, dispatch,
normalization, or selection.

## 5. Private durable acquisition journal

### 5.1 Storage and privacy

The live journal is private state beneath the configured `PEAS_RUNTIME_ROOT`, never the repository.
Its memory implementation is test-only and must expose the same state transitions and validation
outcomes as SQLite. The SQLite implementation must use durable transactions, foreign-key and
uniqueness constraints, and crash-safe commit settings appropriate to the existing persistence
policy.

Raw current and next page tokens are secret-like resumable control material. They may exist only:

- transiently in bounded memory;
- in the private journal record that authorizes exactly one continuation; and
- in the exact request-construction boundary immediately before dispatch.

Raw tokens, token hashes, resumable token references, and token lengths must not appear in logs,
ledger facts, safe errors, repository fixtures, uploaded evidence, PR bodies, or public output.
The journal must protect private token material at rest with the configured runtime-root access
boundary and any stronger mechanism required by the separately accepted credential/privacy
contract. A token must be destroyed from transient memory after terminal completion, terminal
failure, or successful consumption, subject to the authorized retention/deletion mechanism.

### 5.2 Required checkpoint body

Every durable checkpoint contains exactly the closed fields below. Nullable values are explicit;
missing fields are invalid.

| Field | Rule |
| --- | --- |
| `schemaVersion` | exactly the accepted journal schema version |
| `marketAcquisitionJournalId` | recomputed from the stable declaration |
| `runSessionNonce` | exact non-secret run nonce persisted at declaration |
| `acquisitionObservationId` | exact attempt-scoped acquisition observation for the entry |
| `marketAcquisitionId` | exact PR 2D identity recomputed from that acquisition observation |
| `admittedMarketAcquisitionIds` | canonical page-order IDs for durably admitted pages; empty before first admission |
| `requestIdentityHash` | stable across the entire page chain |
| `acquisitionConfigurationHash` | exact journal-only page-limit and operational-policy binding |
| `providerId` | exact frozen provider identity |
| `datasetId` | exact frozen dataset identity |
| `feedId` | exact frozen feed identity |
| `endpointChannelId` | exact frozen channel identity |
| `authorizationMode` | exactly `p1-09-approved` |
| `logicalPageIdentityHash` | page ordinal plus authorized current-token hash |
| `pageOrdinal` | contiguous, zero-based, never reused for another logical page |
| `checkpointKind` | one closed value from section 5.3 |
| `currentTokenHash` | private `no-token` marker for page zero or exact authorized hash |
| `currentResumableTokenMaterial` | private null for page zero; exact opaque continuation material otherwise |
| `nextTokenHash` | null before body verification; afterward exact private hash or explicit terminal marker |
| `nextResumableTokenMaterial` | null before body verification and for a verified terminal page; otherwise exact opaque material |
| `currentContinuationBindingHash` | null for page zero; otherwise exact preceding-page binding that authorized this page |
| `nextContinuationBindingHash` | null before admission and for a terminal page; otherwise exact section 4.2 hash authorizing the next page |
| `attemptId` | exact `mat1_` physical attempt-control identity associated with this entry |
| `retrievalAttemptId` | exact `rat1_` identity used by the frozen acquisition-observation preimage |
| `attemptOrdinal` | zero-based for this logical page; never decremented or reused |
| `artifactObservationId` | null before a reconciled store receipt; exact observation afterward |
| `artifactDigest` | null before a reconciled store receipt; exact digest afterward |
| `artifactSizeBytes` | null before a reconciled store receipt; receipt size after commit; admitted size only after fresh verification and page checkpoint |
| `artifactObservationHash` | null before a reconciled store receipt; exact observation hash afterward |
| `artifactContentId` | null before commit; recomputed PR 2D content identity afterward |
| `rawArtifactId` | null before commit; recomputed PR 2D raw-artifact identity afterward |
| `stageLedgerFactId` | null for a journal-only stage; otherwise the exact `ole1_` ledger entry ID containing the stage fact |
| `causalParentFactIds` | canonical empty/sorted exact causal `ole1_` parent entry IDs, excluding any required clock-basis declaration parent |
| `pageRecordCount` | null before schema verification; exact count afterward |
| `pageNormalizedFactCount` | null before normalization; exact admitted count afterward |
| `pageChainHash` | prior value before admission; newly computed value after page checkpoint |
| `cumulativeSuccessfulPages` | pages durably admitted, maximum 16 |
| `cumulativeVerifiedBytes` | admitted artifact bytes, maximum 64 MiB |
| `cumulativeRecords` | all verified records before semantic deduplication |
| `cumulativeNormalizedFacts` | all durable emitted facts so far, zero until normalization, maximum 160,000 |
| `cumulativeAttempts` | all physical attempts including retries, maximum 48 |
| `acquisitionDeadlineBasis` | immutable original whole-acquisition deadline basis |
| `quotaWindowEvidence` | private bounded attempt timestamps needed to preserve the rolling ceiling |
| `terminalState` | null while incomplete; otherwise one closed terminal state |
| `terminalReasonCode` | null while incomplete; otherwise one closed non-secret code |
| `incomplete` | true until one terminal checkpoint commits |
| `priorJournalEntryHash` | `genesis` or exact preceding entry hash |
| `journalSequence` | contiguous journal position |
| `journalEntryHash` | recomputed from the exact section 4.4 envelope and body split |

Attempt/page entries contain the attempt-scoped `acquisitionObservationId` and
`marketAcquisitionId` for that entry. Aggregate normalization and terminal entries carry the final
admitted page's values and an ordered, immutable `admittedMarketAcquisitionIds` sidecar covering
every admitted page. Failed retries remain in journal history but never enter that admitted
sidecar. Every persisted `marketAcquisitionId` is independently recomputed from its own
acquisition observation and the frozen PR 2D preimage.

The cumulative fields are cached proofs, not independent sources of truth. On load they must equal
the sum of the applicable immutable attempt receipts, `page-checkpointed` admission receipts, and
normalization receipts. `artifact-committed` and `artifact-verified` rows alone are not page
admission receipts and contribute zero successful pages, verified bytes, and verified records.
Arithmetic uses checked non-negative integers; overflow, decrease, mismatch, omission, or
one-over value is terminal journal corruption. The lesser of the approved entitlement bound and
project ceiling always wins.

`cumulativeNormalizedFacts` remains zero in acquisition and page checkpoints because
normalization is forbidden before `chain-complete`. Normalization entries advance it
monotonically as the complete corpus is produced. The page-chain hash therefore commits the
pre-normalization value; later normalization journal entries, rather than a rewrite of an admitted
page, commit the emitted-fact total. A first fact beyond the accepted limit terminates
normalization and permits no selection.

The journal must retain the original acquisition deadline and rolling quota evidence across a
restart. Restart never resets an acquisition deadline, attempt budget, per-page retry budget,
rolling quota window, page budget, byte budget, record budget, fact budget, or stop state.

### 5.3 Closed checkpoint kinds

Only these checkpoint kinds exist:

| Checkpoint kind | Required durable proof |
| --- | --- |
| `acquisition-declared` | immutable declaration, identities, bounds, zero-spend decision, and `acquisition.declared` ledger fact |
| `attempt-started` | logical page, new attempt identity, trusted `request.started`, deadline, quota, and budget reservation |
| `request-succeeded` | complete acceptable response status/headers and `request.succeeded` ledger fact; no body is admitted |
| `artifact-committed` | `ArtifactStore.store` receipt, artifact observation/digest/size/hash, and live `artifact.committed` ledger fact |
| `artifact-verified` | a fresh verified read, exact consumed size/digest, page schema/count, token relation, and `artifact.verified` ledger fact |
| `page-checkpointed` | atomic page-chain advance, cumulative budgets, and one authoritative next-token or terminal marker |
| `chain-complete` | contiguous page zero through one terminal page; all artifacts reverified; no in-flight page |
| `normalization-started` | complete-chain identity and normalization-input identity |
| `normalization-complete` | complete canonical emitted/ignored/quarantined corpus and cumulative fact count |
| `selection-started` | durable complete normalization corpus and unchanged PR 2D selection authority |
| `completed` | durable `selection.recorded` or typed missing result and no active resource |
| `stopped` | policy/authorization/quota/deadline/operator terminal outcome and no active resource |
| `failed-clean` | closed failure stage after all streams, timers, callbacks, and partial state settle |
| `quarantined` | immutable conflict/unsupported-mutation evidence and zero affected primary selection |

A checkpoint kind may only follow the matching state-machine transition. A later kind cannot
retroactively manufacture a missing earlier ledger fact or journal entry.

### 5.4 Write ordering and cross-store admission

For each page attempt the required order is:

1. derive the new acquisition observation and frozen attempt-scoped `marketAcquisitionId`, then
   append `acquisition-declared`;
2. append `attempt-started`;
3. dispatch exactly once for that attempt;
4. append `request-succeeded` only after acceptable complete status/header evidence;
5. stream the bounded body into the private `ArtifactStore`;
6. obtain the reconciled `StoreArtifactResult`;
7. append `artifact-committed` with the returned observation, digest, size, and observation hash;
8. read the artifact through `ArtifactStore.read` and consume the stream completely;
9. verify digest, declared and consumed size, observation, request identity, schema, counts,
   page position, and token relation without advancing an admitted counter;
10. append `artifact-verified`; and
11. compute the prospective page, byte, and record totals from the prior admitted-page receipts
    plus this verified receipt, reject one-over before mutation, then atomically append
    `page-checkpointed`, advance those cumulative budgets exactly once, and authorize either the
    next page or terminal closure.

`artifact-committed` is an acquisition state only when both the immutable vault result and its
durable journal/ledger receipt exist. A crash after the vault completes but before that receipt is
an unadmitted vault side effect, not a resumably committed page. It must be handled by existing
bounded reconciliation, must never be normalized or selected, and may physically deduplicate with
a later successful delivery. This rule makes the cross-store crash gap explicit without changing
the frozen `ArtifactStore` port.

Once `artifact-committed` is durable, restart must use its observation and digest to verify the
artifact; it must not redispatch that page. Once `artifact-verified` is durable, restart must
reverify and write only the missing page checkpoint; it must not redispatch. Neither checkpoint
may pre-increment `cumulativeSuccessfulPages`, `cumulativeVerifiedBytes`, or `cumulativeRecords`.

Journal failure never deletes, mutates, or guesses artifact evidence. It records
`failure.recorded` at the exact journal stage when possible, settles resources, and exposes no
normalization or selection.

## 6. Exact causal ledger contract

### 6.1 Successful live acquisition

For each successful live page, the externally visible request/artifact prefix is:

```text
acquisition.declared
-> request.started
-> request.succeeded
-> artifact.committed
-> artifact.verified
```

Only after every page prefix is durable, the complete page chain is proven, and every admitted
artifact is reverified does each page proceed in canonical page order:

```text
artifact.verified
-> normalization.emitted | normalization.ignored | normalization.quarantined
```

Only after all page normalization outcomes are durable and the complete corpus validates may the
single terminal acquisition result proceed:

```text
normalization.*
-> selection.recorded
```

Together these are the required order projection; they do not permit page-local normalization or
selection before chain completion. `stageLedgerFactId` and `causalParentFactIds` are journal field
names; their non-null values are actual observation-ledger `ole1_` entry IDs, not a second
synthetic fact-ID family. For a non-null clock basis, the ledger entry also directly parents its
matching `clock-basis.declared` entry as ADR-0009 requires. That clock parent is not a causal stage
parent and is excluded from `causalParentFactIds`; validators reconstruct and validate both the
causal set below and the clock-basis parent independently. ADR-0009 remains authoritative for the
exact causal direct parents:

| Fact | Exact direct-parent rule |
| --- | --- |
| `acquisition.declared` | no causal parent |
| `request.started` | its own `acquisition.declared` |
| `request.succeeded` | its own `request.started` |
| live `artifact.committed` | its own `acquisition.declared` and `request.succeeded` |
| `artifact.verified` | its own `artifact.committed` |
| each `normalization.*` | exactly one `artifact.verified` for each raw-artifact link |
| capture appended/redelivered | its `normalization.emitted` |
| capture superseded/cancelled | its immediately preceding capture fact |
| selection on capture basis | the authoritative capture appended/redelivered fact |
| selection on retrieval basis | its `normalization.emitted` and selected `artifact.verified` |

Journal-only kinds `page-checkpointed`, `chain-complete`, `normalization-started`, and
`selection-started` have `stageLedgerFactId=null` and `causalParentFactIds=[]`; they do not invent
ledger facts. A terminal checkpoint carrying `selection.recorded` uses only the exact parent set
for its chosen basis. It does not parent every normalization or verification fact in the
acquisition. A failure checkpoint carrying `failure.recorded` has exactly the one last valid
stage parent required by section 6.3. Arrays are sorted unique by complete `ole1_` bytes, and an
extra, missing, adjacent-row, cross-attempt, cross-artifact, or fabricated parent rejects even
when journal hashes are otherwise self-consistent.

Each physical request attempt has its own acquisition observation,
attempt-scoped `marketAcquisitionId`, and `acquisition.declared` fact. Its `request.started` fact
must parent only that declaration; its request success and artifact commit must remain inside the
same attempt chain. A failed retry chain cannot parent the successful retry's artifact. A page's
verified artifact may parent only normalization outcomes derived from that artifact.

Normalization begins only after the complete chain is durable and every admitted artifact has
been reverified. `normalization.ignored` and `normalization.quarantined` are explicit outcomes, not
silently dropped rows. Only emitted, eligible, non-conflicting evidence may support selection.
Selection runs only after all page outcomes are durable and the entire fact/revision corpus
passes the accepted PR 2D rules.

### 6.2 Recorded and replay mode

Recorded and replay modes do not invent network provenance:

- they emit `acquisition.declared`;
- they emit no `request.started` or `request.succeeded`;
- their `artifact.committed` has only the acquisition declaration as its causal parent;
- they verify the original immutable observation/digest/size/retrieval evidence before use; and
- they continue through the same PR 2D normalization, capture, correction, and selection parent
  rules.

A replay must never transform an original live commit into a new live request, use replay time as
trusted retrieval time, or replace immutable provider evidence with local file metadata.

### 6.3 Failure ordering and downstream prohibition

`failure.recorded` uses the exact closed ADR-0009 stage and last valid direct parent:

| Failure point | Required stage/parent | Forbidden successors |
| --- | --- | --- |
| after declaration, before request start | request / acquisition declaration | request success, commit, normalization, selection |
| after `request.started`, before request success | request / request started | commit, normalization, selection |
| body or store failure after `request.succeeded` and before commit receipt | artifact-store / request succeeded | `artifact.committed`, verification, normalization, selection |
| verified read, digest, size, or page validation failure after commit | verified-read / artifact committed | normalization, capture, selection |
| normalization failure after verification | normalization / artifact verified | capture and selection for affected evidence |
| capture failure after normalization emitted | capture / normalization emitted | selection from the absent capture |
| selection failure after complete admitted corpus | selection / required normalization or capture basis | completed result |

`request.succeeded` does not mean that a response body is committed. A response-body or store
failure after it must destroy partial bytes, settle every stream and callback, record the exact
terminal stage, and emit no artifact commit, normalization, capture, or selection for that
attempt.

No terminal journal state has an outgoing provider, normalization, or selection transition. A
safe-error detail hash may summarize only closed non-secret structure; it must not hash or retain
credentials, raw tokens, provider bodies, query-bearing URLs, headers, thrown library strings, or
hostile accessor values.

## 7. Pagination and page-chain admission

### 7.1 Token authority

Pagination begins at page ordinal zero with no token. A first-request token is invalid. A returned
token remains untrusted provider material until:

1. its containing body is completely stored;
2. the artifact is verified;
3. the closed schema and record bounds pass;
4. the token length is at most 4,096 bytes before hashing or persistence;
5. the logical request is unchanged;
6. the token and token hash have not appeared anywhere else in the acquisition; and
7. `page-checkpointed` atomically binds it to the immediately preceding verified page.

The token is then usable exactly once and only for the next ordinal of the same request identity.
It is passed byte-for-byte without parsing, trimming, decoding, normalization, or interpretation.

The continuation binding is the exact
`peas/market-acquisition-continuation-binding/v1` hash in section 4.2. Its fields map as follows:

```text
preceding successful page's marketAcquisitionId
requestIdentityHash
preceding logicalPageIdentityHash
preceding page ordinal
preceding artifact observation ID
preceding artifact digest
preceding page's resulting admitted page-chain hash
next page ordinal
next private token hash
```

The resulting hash is durably stored as `nextContinuationBindingHash` on the preceding
`page-checkpointed` entry. It is copied without change to the next page's
`currentContinuationBindingHash` and recomputed from the preceding admitted receipt before the
next `logicalPageIdentityHash` is admitted. A raw token, next-page request, or independently
self-consistent token hash without that exact binding has no continuation authority.

### 7.2 Page-chain hash

Page zero starts with the closed `genesis` marker. Each admitted page computes:

```text
pageChainHash =
  H("peas/market-acquisition-page-chain/v1", {
    priorPageChainHash,
    marketAcquisitionId,
    requestIdentityHash,
    logicalPageIdentityHash,
    pageOrdinal,
    artifactObservationId,
    artifactDigest,
    artifactSizeBytes,
    artifactObservationHash,
    artifactContentId,
    rawArtifactId,
    currentTokenHash,
    nextTokenHash,
    pageRecordCount,
    cumulativeSuccessfulPages,
    cumulativeVerifiedBytes,
    cumulativeRecords,
    cumulativeNormalizedFacts,
    cumulativeAttempts
  })
```

For page zero, `priorPageChainHash` is the literal JSON string `genesis`. Later values are the
lowercase 64-hex preceding page-chain hash. `currentTokenHash` is the literal `no-token` only for
page zero and otherwise the exact private token hash. `nextTokenHash` is the literal `terminal`
only for the terminal page and otherwise the exact next private token hash.
`cumulativeSuccessfulPages`, `cumulativeVerifiedBytes`, and `cumulativeRecords` are the
prospective admitted totals including this page. `cumulativeNormalizedFacts` is exactly zero
because normalization cannot precede complete-chain admission. `cumulativeAttempts` includes
every started physical attempt through this admission, including failed retries.

The derivation order is acyclic and mandatory:

1. compute `pageChainHash` from the exact object above, which includes the admitted page's
   `nextTokenHash` but does not include a continuation-binding hash;
2. for a nonterminal page, compute `nextContinuationBindingHash` from section 4.2 with
   `precedingPageChainHash` equal to that newly computed admitted-page `pageChainHash`; for a
   terminal page, set `nextContinuationBindingHash` to JSON null; and
3. atomically persist the page admission, resulting `pageChainHash`, and resulting
   `nextContinuationBindingHash` in one `page-checkpointed` entry.

Computing either hash from a provisional, self-referential, or prior-input substitution is
invalid. An `artifact-committed` or `artifact-verified` entry retains the prior admitted
page-chain hash and cannot advance any admission total. Page size, provider response order,
backend row order, local path, execution time, and raw token are not substituted for the exact
values.

### 7.3 Complete-chain proof

Reject and terminally fail before any next dispatch on:

- first-page token;
- oversized token;
- repeated token or token hash;
- token loop;
- missing, gapped, or skipped ordinal;
- duplicate page position;
- cross-acquisition or cross-query token;
- changed request configuration;
- token substitution;
- token not bound to the immediately preceding verified checkpoint;
- nonterminal page without exactly one valid next token;
- terminal page with a token;
- empty-string token;
- any page after terminal; or
- any page or cumulative value beyond the accepted ceiling.

Only null/absence is the terminal token marker. Complete means exactly one contiguous chain from
page zero through exactly one terminal page, every page committed and reverified, every checkpoint
hash and cumulative budget reconciled, and no attempt, stream, timer, retry, or page left in
flight. No normalization or selection may begin before a durable `chain-complete` entry.

## 8. Restart algorithm

Every restart follows this exact fail-closed algorithm:

1. Load the closed journal by `marketAcquisitionJournalId`. Reject duplicate journals, unknown
   schema versions, noncanonical serialization, sequence gaps, hash-chain failure, or multiple
   terminal entries.
2. Recompute stable `requestIdentityHash` from the current inert logical-query declaration.
   Compare exact authority, provider/dataset/feed/channel identities, authorization mode, symbols,
   query bounds, semantic fixed fields, zero-spend policy, project bounds, and route policy.
   Independently recompute every persisted attempt-scoped `marketAcquisitionId` from its own
   acquisition observation and the frozen PR 2D preimage. Recompute
   `acquisitionConfigurationHash` and compare the requested page limit, resource ceilings,
   live-enable decision, zero-spend decision, retry, quota, deadline, retention readiness, and
   journal schema policies. Any difference is `journal-conflict`; do not dispatch.
3. Recompute every logical-page identity, continuation binding, page-chain hash, cumulative
   budget, attempt count, deadline, and rolling-quota window from immutable entries. Never trust a
   cached counter without reconciliation.
4. For every durably committed page, obtain the exact observation by ID, reconcile its attempt,
   request identity, provider, digest, observation hash, and response metadata, then perform a
   fresh verified read. Consume and settle every stream. A missing or different artifact,
   observation, digest, size, or identity is terminal and produces no downstream result.
5. If the journal is terminal, perform no new request. A completed journal may return only its
   revalidated deterministic result; a stopped, failed, or quarantined journal returns only its
   closed terminal outcome.
6. If an attempt is durably started but lacks a committed artifact receipt, mark that attempt
   abandoned or failed after bounded reconciliation and cleanup. If its original failure class,
   deadlines, cost, authorization, quota, and budgets allow continuation, create a new attempt for
   the same logical page. Never reuse the attempt identity.
7. If an artifact commit receipt exists without verification, verify that artifact and do not
   redispatch.
8. If artifact verification exists without page admission, reverify and atomically append the
   missing page checkpoint. Do not redispatch.
9. If a page checkpoint exists with a valid continuation, resume only the immediately following
   ordinal with its exact private token binding. If it is terminal, prove `chain-complete`.
10. If normalization was interrupted, reverify the entire chain and restart deterministic
    normalization from the canonical page-zero input. Do not contact a provider.
11. If normalization is complete and selection is not, revalidate the complete corpus and run
    unchanged PR 2D selection. Do not contact a provider.
12. Before returning, settle all streams, timers, abort controllers, callbacks, SQLite work, and
    queued continuations. The post-return activity witness must remain zero.

Restart never:

- re-requests an already durably committed and verified page;
- skips or speculates about a page;
- resets an attempt, quota, deadline, or resource budget;
- resumes under changed configuration or query identity;
- trusts a raw file or database row without artifact verification;
- normalizes an uncheckpointed vault side effect;
- uses response/replay/database time for historical authorization;
- treats a partial body as an artifact; or
- exposes a partial fact corpus or selection.

## 9. Crash-point decision table

| Crash point | Durable evidence required on restart | Exact action |
| --- | --- | --- |
| before request | declaration only | rerun all non-secret preflight; no attempt is presumed |
| after `request.started` | attempt-started receipt | reconcile and close old attempt; new attempt only if retry/stop gates allow |
| during body | attempt/request receipts, no artifact receipt | destroy/reconcile partial stage; never parse; retry only if eligible |
| after vault side effect but before artifact receipt | no admitted commit | treat as unadmitted/orphan evidence; reconcile; new attempt may physically deduplicate |
| after `artifact-committed` receipt | exact observation/digest/size/hash | verified read of that artifact; no request |
| after `artifact-verified` receipt | exact verified page evidence | reverify and append missing page checkpoint; no request |
| after `page-checkpointed` | exact page chain and budgets | resume only next ordinal, or close terminal chain |
| during normalization | complete chain plus incomplete normalization | reverify all pages; restart normalization canonically; no request |
| after normalization, before selection | durable complete corpus | revalidate corpus; run selection; no request |
| after selection, before return | completed receipt | revalidate result, settle resources, return identical result; no request |

The test phrase “after artifact commit” means after the acquisition's durable
`artifact-committed` receipt, not merely after an unrecorded filesystem side effect.

## 10. Normalization, replay, and deterministic equivalence

### 10.1 Canonical live-to-neutral translation

After `chain-complete`, the implementation:

1. sorts admitted pages by verified page ordinal;
2. verifies every artifact again through `ArtifactStore.read`;
3. feeds each verified page into the accepted PR 2D parser and normalization boundary;
4. preserves trusted source order only as defined by the accepted provider-neutral contract;
5. emits explicit emitted, ignored, or quarantined outcomes;
6. constructs the complete immutable revision/correction graph;
7. applies resource bounds before semantic deduplication where PR 2D requires it;
8. persists and revalidates the complete normalized corpus; and
9. invokes unchanged PR 2D selection exactly once for the complete eligible corpus.

Provider response order, JSON property order, artifact enumeration order, database insertion
order, backend row order, retry order, physical deduplication, and replay consumption page size
must not change normalized facts or selection/missing output.

### 10.2 Replay invariants

Replay must:

- validate the original complete bounded ledger and sidecars before execution;
- preserve every semantic PR 2D ID and trusted stamp;
- change only execution-scoped observation-ledger fact IDs and remap their parent or
  clock-regression witness IDs as ADR-0009 permits;
- use original immutable artifact observation, digest, byte size, and retrieval evidence;
- emit no request facts;
- verify each artifact before normalization;
- preserve capture, correction, cancellation, redelivery, and conflict semantics; and
- produce byte-identical normalized facts and selection/missing results for replay page sizes
  1, 2, 7, and 10,000.

Replay page size is a local bounded iteration size. It is not the provider page size and must not
alter provider observation, delivery, fact, capture, revision, selection, or missing-result
identities.

### 10.3 Memory and SQLite equivalence

For the same canonical journal history and artifacts, memory and SQLite implementations must
produce byte-identical:

- accepted/rejected journal decisions;
- next valid state and page ordinal;
- page-chain and journal-entry hashes;
- cumulative budget values;
- restart decisions at every checkpoint;
- normalized fact/capture/revision records;
- selected or typed missing result; and
- closed terminal reason.

The comparison excludes only backend-internal row IDs, SQLite sequence values, transaction IDs,
paths, and timing. Those values must never enter semantic output or public evidence.

The equivalence suite must close and reopen SQLite at every durable checkpoint and compare against
a fresh memory reconstruction of the same journal. It must permute provider response order,
artifact enumeration order, duplicate delivery order, replay page size, and backend page size.

## 11. Duplicate, redelivery, conflict, and correction behavior

### 11.1 Exact duplicate and redelivery

Exact duplicate bytes may deduplicate to one physical content object. Every distinct provider
delivery still retains:

- its own attempt;
- request and causal ledger evidence;
- artifact observation;
- delivery observation; and
- page-chain position.

An exact replay of an already persisted store attempt may return its original result but must not
fabricate a new delivery. A genuinely redelivered provider response has a new attempt and
observation even when physical bytes deduplicate. Exact semantic duplicates normalize once under
the accepted PR 2D rules, while their immutable delivery observations remain auditable.

Duplicate records count against page and aggregate record/fact bounds before a permitted semantic
collapse. Deduplication is never a way to evade a resource ceiling.

### 11.2 Conflicting bytes

If the same asserted logical delivery or revision identity is associated with conflicting bytes
or economic content:

- quarantine the whole equivalence class independent of arrival order;
- retain immutable private evidence;
- emit no primary selection that depends on the class;
- do not choose first, last, largest, latest-arriving, or backend order;
- do not use FMP to break the conflict; and
- stop for a prospective contract amendment if the accepted PR 2D rules cannot classify it.

### 11.3 Corrections and mutations

A provider replacement, correction, or cancellation is accepted only when the complete immutable
revision relationship required by PR 2D is present and supported. Original facts are never
overwritten.

Orphan corrections, forks, cycles, ambiguous targets, unsupported revision kinds, changed stable
keys, correction-in-place without revision evidence, and unknown provider mutation semantics are
quarantined. They are never guessed from arrival order, request time, response time, page order,
or a discrepancy provider. Affected evidence produces no primary selection.

## 12. Resource and atomicity requirements

The journal and replay layer enforce, at minimum:

- one concurrent provider request;
- 10 MiB maximum raw artifact per page;
- 64 MiB maximum aggregate verified bytes;
- 16 maximum successful pages/artifacts;
- 10,000 maximum requested records and records per page;
- 160,000 maximum normalized facts;
- 4,096 maximum token bytes before hashing/persistence;
- 64 maximum instruments;
- eight consecutive calendar dates maximum query span;
- 48 maximum attempts including retries;
- three attempts maximum for one logical page;
- the accepted attempt/acquisition deadlines and rolling quota; and
- the lesser approved entitlement value whenever it is stricter.

The exact limit succeeds only if every other gate passes. The first one-over value fails closed.
There is no truncation, partial selection, budget reset, split acquisition, silent continuation,
or “best available” return.

Artifact bytes are admitted only after complete body receipt within both declared and consumed
length limits. A declared-length mismatch, truncation, late stream failure, timeout, sibling
failure, digest failure, store failure, or cleanup uncertainty produces no admitted artifact.
Partial bytes are destroyed through the existing staging/reconciliation process and never parsed,
normalized, selected, checkpointed, or used for a token.

## 13. Retention and deletion gate

Private raw artifacts and journal control material live only beneath `PEAS_RUNTIME_ROOT`. The
contractual maxima are:

- Alpaca: at most 3,650 days, with stop-trigger deletion/cessation within 30 calendar days or an
  earlier provider deadline; and
- FMP: at most 3,650 days and only while the subscription remains active, with
  deletion/cessation no later than effective termination.

The current implementation cannot prove those deletion obligations:

- `ArtifactStore` has no deletion API;
- migration 005 installs no-delete triggers;
- ADR-0006 deferred deletion; and
- journal termination does not delete content-addressed bytes or immutable observations.

An exact auditable deletion design must identify the affected digest and all observations,
atomically prevent new use, preserve a non-sensitive tombstone/audit receipt, remove private
bytes and resumable token material by deadline, distinguish shared deduplicated content from
all logical references, conservatively deny every reference when an affected observation shares
physical content, update reconciliation behavior, and prove memory/SQLite/platform equivalence.
That design necessarily affects at least a port, migration, reconciliation rule, or vault
semantic unless a separately accepted additive mechanism proves otherwise.

Disposition: `HUMAN_AUTHORIZATION_REQUIRED`. Independent contract GO must state whether this
retention implementation is authorized. If it is not explicitly authorized, PR 2F must not begin.
This document does not select or authorize a destructive migration.

## 14. Required executable evidence

Before this contract can receive GO, original synthetic tests must prove:

1. exact causal order and ADR-0009 direct parents in live and replay modes;
2. body/store failure after request success emits no commit, normalization, or selection;
3. verified-read failure after commit emits no normalization or selection;
4. stable acquisition/request identity and distinct page/attempt identities;
5. closed journal schema, canonical hashes, sequence/hash-chain validation, and unknown-field
   rejection;
6. exact checkpoint body and cumulative-budget reconciliation;
7. first-page token rejection and opaque one-use continuation binding;
8. loop, repetition, gap, skip, duplicate page, cross-query token, substitution, and
   post-terminal rejection;
9. commit and verification before page checkpoint;
10. complete page chain before normalization or selection;
11. restart from every row in section 9 with no repeated verified-page request;
12. an unadmitted post-store crash cannot enter normalization and is boundedly reconciled;
13. exact duplicate physical deduplication with distinct delivery observations;
14. conflicting bytes quarantine independently of arrival order;
15. supported immutable correction/revision behavior and quarantine of every unknown mutation;
16. exact-limit and one-over behavior for every section 12 bound;
17. partial body destruction and first/middle/last sibling stream settlement;
18. zero normalized/selection output after any incomplete or failed chain;
19. replay at page sizes 1, 2, 7, and 10,000;
20. provider-response-order and artifact-enumeration-order invariance;
21. memory/SQLite close/reopen equivalence at every durable checkpoint;
22. byte-identical normalized facts and selection/missing results across repeat runs;
23. no raw token, token hash, credential, query-bearing URL, provider body, or provider byte in
    logs, errors, ledger facts, fixtures, evidence, or public output;
24. FMP cannot enter primary/fallback selection or public output;
25. global network witness count remains zero in the PR 2E/default-CI package; and
26. no timers, callbacks, streams, promises, SQLite work, or transport activity after return.

All fixtures are original and synthetic. No test may depend on credentials or provider
availability, and no skipped-when-missing-credentials path substitutes for the required
pre-dispatch failure test.

## 15. Stop conditions

Stop and return a closed non-secret outcome when:

- stable acquisition/request identity cannot be recomputed exactly;
- a journal version, field, sequence, hash, checkpoint, counter, or terminal state is invalid;
- configuration/query identity differs from the durable journal;
- an artifact observation, digest, size, or verified read differs;
- page-chain completeness or token provenance cannot be proved;
- a bound, deadline, quota, cost, or authorization decision is unknown or exceeded;
- a response is partial or any resource cannot be settled;
- provider schema/correction behavior is outside the accepted contract;
- a secret, raw token, query-bearing URL, provider body, or provider byte crosses a public
  boundary;
- any fallback or FMP-primary/public-output path is proposed;
- implementation would alter an accepted PR 2D port or contract;
- retention deletion cannot be implemented under separately approved authority; or
- any request asks for P2 collection or outcome calculation.

No stop path silently advances a checkpoint, manufactures a missing causal fact, resets a budget,
deletes immutable evidence, or returns a partial selection.

## 16. Gate disposition

This contract package remains `NO_GO` for implementation until all of the following are true:

1. the exact PR 2E candidate SHA receives independent binary GO;
2. the auditor independently validates every frozen identity and records file-and-line findings;
3. the orchestration owner acknowledges that exact checkpoint;
4. every offline contract/CI acceptance test passes on that SHA;
5. the `requestIdentityHash` versus `logicalPageIdentityHash` terminology is consistent across
   every PR 2E contract and executable test;
6. the audit explicitly records whether retention implementation is authorized; and
7. any required retention port, migration, reconciliation, or vault-semantic change receives
   renewed human authorization.

Contract GO alone authorizes no provider call. A provider witness still requires separate written
human approval of the exact implementation candidate, lane, routes, symbols, time range, maximum
calls, and execution window. FMP witness and FMP transport remain outside this milestone. Neither
PR may be merged without separate human-owner authorization.
