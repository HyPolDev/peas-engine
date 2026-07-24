# PR 2D timestamp, trust, session, and replay contract

Status: normative Wave 2 contract input
Decision checkpoint: cbec6e00259b17bdec59fcc20608f66f90896b71
Human decision: H-001 approved 2026-07-23

This contract closes every time, clock, precision, nullability, ordering, session, calendar,
correction-arrival, correction-effective, and replay rule used by PR 2D. It is additive to
[ADR 0009](../adr/0009-observation-telemetry-and-clock-contract.md) and the
[PR 2C observation-ledger schema](pr-2c-observation-ledger-schema.md). It does not change their
types, fields, identities, ports, or migration.

Related PR 2D contracts:

- [provider and source identity](pr-2d-provider-source-identity.md);
- [market eligibility and metric selection](pr-2d-market-eligibility.md);
- [closed reason catalog](pr-2d-reason-codes.md);
- [resource bounds](pr-2d-resource-bounds.md);
- [study freeze manifest](pr-2d-study-freeze-manifest.md); and
- [acceptance matrix](pr-2d-acceptance-matrix.md).

P1-09 remains pending. Nothing in this document authorizes a provider, feed, account, entitlement,
raw provider byte, live request, subscription change, or spend.

## 1. Approved anchor semantics

H-001 is closed as follows:

1. durable-capture is the primary first-observation anchor for the operational PEAS validation
   claim;
2. the exact existing retrieval basis is a mandatory sensitivity;
3. capture-minus-retrieval latency is recorded whenever both bases are trusted and comparable;
4. retrievedAtMs retains its exact existing meaning and MUST NOT be renamed, described, or used as
   transport response completion, first-byte time, last-byte time, request end, or verified-read
   completion; and
5. no new clock field, ledger variant, frozen-port change, or migration is authorized.

The primary basis is the existing exact value:

    {
      basisKind: "capture",
      eventId,
      receivedAtMs,
      logicalAtMs,
      clockBasisId
    }

The mandatory sensitivity basis is the existing exact value:

    {
      basisKind: "retrieval",
      role,
      acquisitionObservationId,
      vaultObservationId,
      retrievedAtMs,
      clockBasisId
    }

Every field MUST reconcile through the PR 2C causal ledger exactly as already specified. A PR 2D
sidecar may reference these values; it MUST NOT reconstruct, rename, reinterpret, or mutate them.

### 1.1 Market target derived from each basis

For the capture-primary branch:

    T0CaptureNs = exactBigInt(receivedAtMs) * 1_000_000

For the mandatory retrieval sensitivity:

    T0RetrievalNs = exactBigInt(retrievedAtMs) * 1_000_000

The conversion MUST be performed with exact integer arithmetic and MUST remain inside the signed
64-bit epoch-nanosecond range. Binary floating point MUST NOT hold the nanosecond result.

logicalAtMs is retained for reducer/event ordering and identity reconciliation. It is not UTC wall
time and MUST NOT replace receivedAtMs in a market selector, latency calculation, session
classification, or movement interval.

### 1.2 Anchor validity and study use

| Basis property | Primary capture branch | Retrieval sensitivity |
| --- | --- | --- |
| Exact PR 2C basis shape and causal reconciliation | required | required |
| Non-null clockBasisId | required | required |
| selected purpose is market-reference-anchor | required | required |
| asOfMs at or after basis wall time | required | required |
| exact raw-link commit/verification chain | inherited through selected source | additionally required for selected retrieval role |
| wall clock is system-utc with verified-bound synchronization | primary T0-verified use | sensitivity with verified latency |
| wall clock is system-utc with operator-asserted synchronization | degraded movement branch; no primary latency conclusion | degraded sensitivity; no trusted latency delta |
| wall clock synchronization is unspecified | primary study use forbidden | trusted sensitivity use forbidden |
| recorded-fixture or replayed-original with not-applicable synchronization | permitted only for deterministic offline fixtures/replay | permitted only for deterministic offline fixtures/replay |
| null or conflicting basis evidence | market.anchor-missing or market.clock-basis-invalid | same, without invalidating an otherwise valid capture result |

The primary study manifest MUST state primaryAnchorKind=capture and
alternateAnchorRequired=true. Any other value is market.anchor-policy-invalid.

### 1.3 Capture-minus-retrieval latency

captureMinusRetrievalMs is:

    receivedAtMs - retrievedAtMs

It is emitted only when:

- both exact bases validate;
- both wall stamps use the same clockBasisId;
- that basis is system-utc with verified-bound synchronization for a real study, or the same
  recorded-fixture/replayed-original basis for offline proof;
- both select the same source observation and the retrieval basis selects one raw link of that
  observation; and
- receivedAtMs is greater than or equal to retrievedAtMs.

Different basis IDs, operator-asserted or unspecified synchronization, a negative delta, different
source observations, or a non-reconciling raw link make the latency null with the applicable stable
reason. They do not rewrite either anchor and do not cause the more favorable anchor branch to be
selected.

The exact capture/retrieval timing-quality ceiling is 600,000 ms inclusive under the resource-bounds
contract. A comparable delta of exactly 600,000 ms is retained. A delta of 600,001 ms or greater
makes the latency-quality result missing with market.timestamp-insufficient and
timestampFailureKind=capture-retrieval-lag-exceeded. It does not rewrite either individually valid
anchor or market fact.

## 2. Canonical time representation

### 2.1 Units and ranges

Market, publication, corporate-action, bar, and session times are canonical signed 64-bit UTC epoch
nanosecond decimal strings. PEAS ledger wall clocks remain their inherited non-negative safe-integer
epoch milliseconds. Monotonic clocks remain their inherited non-negative safe-integer,
process-session-local microseconds.

The normalizer MUST:

1. preserve the bounded original timestamp text when present;
2. parse without binary floating-point conversion;
3. produce one canonical base-10 integer with no leading zero except zero itself;
4. record the source precision and semantic class;
5. reject values outside the signed 64-bit nanosecond range;
6. reject more than nine fractional-second digits;
7. reject local civil time unless a source grammar supplies an explicit offset or named-zone
   resolution policy; and
8. apply every byte/string bound in the resource-bounds contract before parsing.

In V1 the original timestamp token is at most 64 ASCII bytes. The canonical epoch-nanosecond value
must fit the signed 64-bit range. These limits are exact; byte/range overflow is never truncated.

Negative epoch nanoseconds are valid at the generic type boundary but are outside the version-1
study calendar. Study facts before the frozen coverage interval are ineligible rather than clamped.

### 2.2 Closed precision classes

| Precision class | Quantum | Primary market event use | Publication use |
| --- | ---: | --- | --- |
| nanosecond | 1 ns | permitted with sufficient semantic trust | permitted |
| microsecond | 1,000 ns | permitted with sufficient semantic trust | permitted |
| millisecond | 1,000,000 ns | permitted with sufficient semantic trust | permitted |
| second | 1,000,000,000 ns | sensitivity only unless a protocol-specific accepted rule proves deterministic order | permitted for exact/provider publication, with precision recorded |
| date | one source-calendar date | forbidden for point selection | inferred/insufficient only |
| unknown | unknown | forbidden | insufficient |

Precision describes the source value; it does not manufacture accuracy. Zero-padding a
millisecond value to nanoseconds does not change its precision. A timestamp with second precision
cannot be made primary by page order, provider receipt time, artifact order, or a later finer
timestamp from another source.

For two facts whose displayed event times are equal at their recorded precision, a trusted
source-native sequence or source-defined tie-break is required when their economic state differs.
Otherwise selection is missing with market.sequence-insufficient and
sequenceFailureKind=equal-time-ambiguous.

### 2.3 Closed semantic classes

| Semantic class | Meaning | Permitted substitution |
| --- | --- | --- |
| participant-publication | Exchange matching-engine publication timestamp under a pinned CTA/UTP mapping | no substitution |
| member-execution | FINRA/TRF member-reported execution time under a pinned mapping | no substitution |
| sip-publication | SIP block processing/output timestamp | sensitivity/latency evidence only |
| provider-documented-event | Provider field with a pinned official semantic mapping to the fact kind | only within that exact mapping |
| provider-receive | Provider-side receipt or processing time | never market event time or PEAS receipt |
| earnings-publication | Exact/provider/inferred issuer-source publication time from PR 2C | release/latency rules below |
| peas-retrieval | Existing retrievedAtMs basis | retrieval sensitivity only |
| peas-durable-capture | Existing receivedAtMs capture basis | primary T0 wall target |
| correction-effective | Economic time/relation the revision changes | never correction arrival |
| correction-arrival | Preserved PEAS durable recorded evidence for the revision; not provider-native arrival | recorded-corpus view admission only |
| bar-start | Inclusive start of an aggregate interval | bar identity only |
| bar-end | Exclusive end of an aggregate interval | completed-bar selection only |
| calendar-boundary | Frozen UTC boundary derived from official calendar and tzdb | session classification only |
| replay-preserved | Original semantic timestamp re-emitted by replay | same use as original |

No semantic class may silently substitute for another. A source mapping that omits or conflates
classes fails closed.

## 3. Nullability and trust matrix

| Fact | Nullability | Required trust for primary use | If absent or insufficient |
| --- | --- | --- | --- |
| earnings publication time | inherited nullable PR 2C union | exact or provider confidence under frozen grammar for primary release gap/latency | release gap/latency missing; inferred sensitivity MAY remain |
| quote event time | required for eligible quote | participant-publication or provider-documented-event, precision millisecond or finer | quote ineligible |
| trade event time | required for eligible trade | participant-publication or member-execution, or exact provider mapping, precision millisecond or finer | trade ineligible |
| SIP dissemination time | nullable | never primary market event time | retain null or sensitivity telemetry |
| provider receive time | nullable | never primary | retain null; do not infer |
| provider sequence | nullable by source dialect | required when equal-time state or correction order cannot otherwise be proved | state missing/ambiguous |
| bar start/end | both required | documented one-minute interval, exact boundary semantics | bar ineligible |
| official open/close event time | required | listing-market official condition and trusted event time | official fact missing |
| session boundary | required for study date | official calendar plus pinned tzdb | session unknown/missing |
| corporate-action declaration time | nullable if source omits | descriptive only | retain null |
| corporate-action provider arrival | nullable if source omits | not PEAS arrival | retain null |
| corporate-action effective time/date | required for cross-boundary primary comparison | authoritative market/listing source | comparison missing |
| correction effective time | required when the source supplies it; otherwise explicit null | source revision relation must still identify the affected fact | unresolved revision if neither relation nor time suffices |
| correction PEAS durable recorded evidence | required to prove corpus membership/corrected-cutoff admission | preserved wall/logical/clock evidence reconciled to immutable delivery/artifact | requested recorded view unavailable |
| capture receivedAtMs/logicalAtMs | both required by capture basis | exact PR 2C reconciliation | primary anchor missing |
| retrieval retrievedAtMs | required by retrieval basis | exact PR 2C raw-link reconciliation | mandatory sensitivity missing |
| monotonicTimeUs | nullable | same process session only | no monotonic comparison |
| replay time | must not be invented | original stamps only | replay incompatible |

Null means unavailable. Empty string, zero, current time, neighboring fact time, page time, file
mtime, request time, retrieval time, capture time, bar boundary, or another provider MUST NOT fill a
null timestamp.

## 4. Market-time and sequence trust

Timestamp trust and sequence trust are orthogonal.

### 4.1 Timestamp trust classes

Ordered only for eligibility policy, not for timestamp replacement:

1. participant-publication;
2. member-execution, for trade semantics only;
3. provider-documented-event;
4. sip-publication;
5. provider-receive;
6. inferred;
7. unknown.

The first three can support the exact fact kinds listed in the nullability table. sip-publication
supports a labeled sensitivity only. provider-receive, inferred, and unknown cannot support a
primary point-market selector.

### 4.2 Sequence trust classes

| Class | Exact evidence | Effect |
| --- | --- | --- |
| native-gap-checked | complete source-native channel/session sequence with resets, gaps, and retransmissions reconciled | primary state ordering permitted |
| provider-stable-sequence | officially documented stable sequence with exact provider/dataset/feed/protocol scope | ordering permitted only in that scope |
| native-unchecked | sequence present but completeness/reset handling unproved | degraded; cannot bridge a gap or resolve primary state after it |
| deterministic-artifact-order | stable validated record ordinal only | replay evidence, never market arrival evidence |
| none | no trusted order | equal-time conflicting state is ambiguous |

CTA block/message sequence is scoped by protocol, line/channel, and trading date. UTP transport
sequence is scoped by its documented session/channel. A participant token, internal trading-action
sequence, HTTP page token, response order, SQL row ID, file path, or artifact ordinal MUST NOT be
promoted to market sequence.

### 4.3 Deterministic event ordering

Within one exact source/protocol session:

1. validate the sequence scope and reset/retransmission rules;
2. process native-gap-checked or provider-stable sequence in its documented order;
3. otherwise compare canonical event time only;
4. use a documented source-native tie-break for equal-time differing state;
5. collapse exact redelivery only after identity/content equality is proved; and
6. return market.sequence-insufficient with sequenceFailureKind=equal-time-ambiguous when
   differing equal-time facts can change selection and no trusted tie-break exists.

Artifact digest, record ordinal, normalized fact ID, and revision ID may make diagnostic output
stable. They MUST NOT decide which conflicting market fact happened later.

A sequence gap, unexpected reset, duplicate sequence with conflicting content, or out-of-contract
regression invalidates state from the defect through the next authoritative source reset/snapshot.
Sorting by timestamp cannot heal it.

## 5. Publication and exact target times

Let Tpub be the canonical trusted earnings publication time. Primary release-gap use requires PR 2C
timestampConfidence exact or provider and its frozen source grammar. inferred and unknown cannot
support the primary release-gap origin.

Let T0 be the capture-primary target. Exact targets are:

    T0  = T0CaptureNs
    T1  = T0 + 60_000_000_000
    T5  = T0 + 300_000_000_000
    T30 = T0 + 1_800_000_000_000

The mandatory retrieval sensitivity derives its own T0/T1/T5/T30 from T0RetrievalNs. Every addition
uses exact signed-integer arithmetic and rejects overflow.

Targets are elapsed UTC durations. They MUST NOT be:

- rounded to a minute;
- snapped to a quote, trade, bar, auction, session, or provider timestamp;
- shifted to the first fact after the target;
- shifted across a halt, close, open, or session boundary; or
- changed because a later correction or secondary provider looks preferable.

Point selection uses the last eligible fact whose applicable event/completion time is less than or
equal to the target. The release-gap origin uses the last eligible quote whose event time is
strictly less than Tpub. Equality with Tpub is excluded. First-after and nearest-on-either-side
selectors are forbidden.

Tpub greater than T0 makes release-gap ordering invalid. A negative latency interval is not clamped.
The latency uncertainty calculations and 15-minute study threshold are frozen by the study
contract, not altered here.

## 6. Session, calendar, holiday, early-close, and DST rules

### 6.1 Closed session kinds

| Session kind | Exact version-1 meaning |
| --- | --- |
| regular-continuous | [09:30:00, officialClose) America/New_York on an official eligible session |
| official-open-auction | separately identified primary-listing official opening fact |
| official-close-auction | separately identified primary-listing official closing fact |
| extended-pre | [04:00:00,09:30:00) local, subject to exact source/venue coverage |
| extended-post | [officialClose,20:00:00) local, subject to exact source/venue coverage |
| overnight | any separately identified BOATS, 24X, derived overnight, or other approved overnight regime |
| halted | cross-SRO or market-wide pause at the target |
| calendar-closed | no eligible official session at the target |
| unknown | calendar, timezone, source coverage, or timestamp insufficient |

Ordinary officialClose is 16:00:00 local. An official early-close calendar entry replaces it, often
with 13:00:00 local. Weekday arithmetic and a fixed UTC offset are forbidden.

### 6.2 Frozen calendar construction

For each instrument version and study date:

1. resolve primary listing exchange from the frozen instrument mapping;
2. load the exact official calendar record and calendar version/digest;
3. load America/New_York through the exact tzdb version/digest;
4. reject missing, duplicate, overlapping, or contradictory boundaries;
5. convert every named local boundary to a unique UTC epoch-nanosecond value;
6. freeze half-open UTC intervals plus original local date and UTC offset; and
7. classify facts only against those frozen intervals.

Nonexistent or ambiguous local civil time rejects unless the official source gives an explicit
offset that resolves it. DST is never inferred from the event date alone. A fact exactly at a
boundary belongs to the interval beginning there. A fact exactly at officialClose is not
regular-continuous.

### 6.3 Session transitions and overnight

A primary residual endpoint must remain in the same session kind as T0. Crossing from extended-pre
to regular, regular to extended-post, or any session to closed/overnight yields
market.session-transition. A separately frozen transition sensitivity may calculate the endpoint
but cannot replace the primary result.

BOATS, 24X overnight, Alpaca-derived overnight, and any other overnight feed require distinct
provider, dataset, feed, venue, trading-date, calendar, entitlement, and session identities. They
are excluded from primary and ordinary pre/post-market state. An overnight fact cannot update a
regular or extended state machine.

## 7. Correction arrival, effective time, and views

Corrections and cancellations are immutable revisions. Three times remain separate:

- original fact event time;
- correction effective time or explicit source relation; and
- correction PEAS durable recorded-evidence time.

Effective time determines what economic fact the revision affects. Durable recorded evidence proves
when PEAS added the revision to an immutable recorded corpus. It is not provider-native arrival,
exchange dissemination, or proof that PEAS knew the revision at a market target. Neither time
substitutes for the other.

The only V1 view names are `recorded-primary` and `recorded-corrected`. Their complete corpus and
cutoff schemas, `mcs1_`/`mcc1_` identities, and result `asOfBasis` are normative in the
provider/source identity contract.

### 7.1 Recorded-primary admission

`recorded-primary` is the as-recorded primary scientific view. It admits exactly each valid
original, correction, or cancellation revision named in the first complete, bounded, verified,
immutable recorded corpus for the exact market-reference join/source/query policy. Its cutoff is
`primary-corpus-closure`; `cutoffTargetNs` is null. Admission is set membership, not a comparison
with T0/T1/T5/T30 and not a reconstruction of native provider-known state.

The first corpus is accepted only when all declared acquisition members have settled, ArtifactStore
observation/hash/digest/size evidence reconciles, every revision relation is preserved, and the
corpus closure carries its original PEAS wall/logical/clock evidence. A later artifact or revision
cannot mutate it. Corrections and cancellations already present are applied by revision graph and
effective relation. A revision absent from the first corpus is excluded even when its effective
time precedes a selected fact.

Historical data exposing only final-corrected state, corrected-in-place bytes, or unknown revision
membership cannot produce `recorded-primary`; it yields `market.correction-view-unknown`. This does
not make the provider unusable for all purposes, but it makes the primary correction view missing.

### 7.2 Recorded-corrected admission

`recorded-corrected` starts with the immutable `recorded-primary` set and admits additional valid
revision evidence durably recorded no later than:

    TcorrectedCutoff = T0Capture + 604_800_000_000_000 ns

This is exactly seven 24-hour periods after the capture-primary anchor. Equality is included; one
nanosecond after is outside the mathematical cutoff. PEAS durable evidence is inherited
millisecond-resolution, so the next representable evidence value is one millisecond later. Each
admitted revision must carry immutable
`{revisionId,deliveryId,rawArtifactId,durablyRecordedAtMs,logicalAtMs,clockBasisId,
durableEvidenceHash}` and reconcile to the named corpus. Millisecond evidence is converted with
exact integer arithmetic before comparison. Evidence at the cutoff is included; evidence after it
is excluded with `market.correction-after-cutoff`. The dataset freeze occurs only after the last
selected cluster reaches this cutoff. A later correction never changes that dataset version.

A final-corrected-only corpus can support `recorded-corrected` only when its complete immutable
corpus was durably closed at or before `TcorrectedCutoff`; otherwise individual revision membership
cannot be proved and the view is missing with `market.correction-view-unknown`.

Revision target/relation establishes graph order. Arrival order is not revision order. Orphans,
cycles, forks, conflicting reused keys, and unsupported correction-after-cancellation fail closed.

### 7.3 Cutoff identity and market targets

The correction cutoff never replaces a market target. T0/T1/T5/T30 still restrict fact
event/completion time under the approved last-at-or-before selector. `recorded-primary` and
`recorded-corrected` decide only which immutable revisions exist before state reconstruction.

Every selection policy and selected/missing result carries the exact view, `recordedCorpusSnapshotId`,
`corpusCutoffId`, `admittedRevisionSetHash`, H-001 anchor basis, target time, and comparator. A
different corpus, closure observation, durable clock fact, admitted revision, cutoff, or view
therefore produces a different policy/result identity while leaving market-fact identity unchanged.

## 8. Replay and restart

Replay MUST:

- validate the original PR 2C ledger and market sidecar before selection;
- preserve publication, market event, SIP, provider, retrieval, capture, correction, bar, corporate
  action, and calendar times exactly;
- preserve their precision, semantic, trust, sequence, and clock-basis evidence;
- re-emit the original capture/retrieval facts under the existing PR 2C replay rules;
- create no current-time, replay-time, file-mtime, SQL-time, or iterator-time semantic field;
- preserve marketReferenceJoinKey, candidate-set, selected/missing result, and study identities;
- remap only execution-scoped ledger entry IDs and causal parents as PR 2C requires; and
- produce byte-identical results across page size, artifact order, restart, memory, and SQLite.

Monotonic values compare only inside the same monotonicSessionId. They cannot be converted to epoch
time or compared across sessions. Wall regression requires the exact inherited clock.regression
witness. Same-session monotonic regression fails closed.

Selection starts only after every declared artifact/page for the bounded window has completed
verified read and reconciliation. A restart cannot select a partial candidate set or recompute a
persisted immutable result after later arrival.

## 9. Validation obligations

The acceptance matrix MUST include:

- exact capture and retrieval bases, plus every null/conflicting field;
- receivedAtMs and retrievedAtMs conversion to nanoseconds and signed-range overflow;
- capture-minus-retrieval deltas at 0, 1, 999, 1,000, 4,999, 5,000, 29,999, and 30,000 ms;
- incompatible clock bases, operator-asserted clocks, wall regression, monotonic regression, and
  replayed-original clocks;
- every precision class and equal-time conflict with/without trusted sequence;
- quote exactly at T0/T1/T5/T30, one nanosecond after, and release quote exactly at Tpub;
- ordinary, holiday, early-close, both DST transitions, ambiguous/nonexistent local time, and every
  session boundary;
- regular/extended transition and overnight exclusion;
- first immutable corpus membership present/absent in both artifact and revision directions;
- `recorded-corrected` durable evidence one millisecond before, exactly at, and one millisecond after
  the seven-day cutoff;
- final-corrected-only history before/at/after corpus closure that cannot claim
  `recorded-primary`; and
- page/restart/backend replay with no invented clock.

Every failure or degradation uses the canonical market.* code in
[the PR 2D reason catalog](pr-2d-reason-codes.md). No mr.* alias or free-form provider text is an
emitted reason.
