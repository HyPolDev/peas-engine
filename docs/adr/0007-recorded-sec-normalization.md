# ADR 0007: Recorded SEC normalization and bounded evidence bundles

- Status: Accepted
- Date: 2026-07-13
- Accepted: 2026-07-13 after independent contract review
- Decision owner: HyPolDev
- Target: PR 2B
- Depends on: Kernel V2 RC.2 and merged PR 2A artifact vault

## Context

PR 2B proves one provider path without introducing live network access:

```text
recorded SEC entity bytes -> ArtifactStore -> verified evidence bundle -> pure SEC normalizer
  -> bounded EventDraft -> trusted capture -> earnings reducer -> audited cluster
```

The kernel, `EventDraft` resource boundary, and provider-neutral artifact vault are complete. An SEC
filing is not one artifact: submissions metadata, filing index, primary document, earnings exhibit,
XBRL, and a related 10-Q or 10-K may all be required to explain one source observation. The current
schema-V1 source event retains only one artifact digest and cannot freeze that complete evidence set.

Independent review required the contract to close evidence membership, V1/V2 compatibility,
historical checkpoints, source-to-analysis provenance, aggregate size, SEC identity, fiscal linkage,
publication time, observation selection, parser allocation, decoder aliases, transcript hashing,
and effect isolation. This accepted decision incorporates those dispositions. It changes provider
and domain behavior only; no frozen kernel or artifact-vault port changes.

## Scope

PR 2B includes:

- reviewed synthetic or explicitly redistribution-approved recorded SEC structures;
- submissions metadata, filing index, 8-K Item 2.02, EX-99.1, 10-Q/10-K, and XBRL linkage;
- deterministic evidence assembly, verified loading, decoding, parsing, normalization, and reason
  codes;
- schema-V2 source events that freeze complete multi-artifact evidence;
- schema-V1 replay compatibility from genesis, without checkpoint migration;
- memory and SQLite capture plus live-style/replay equivalence tests; and
- adversarial missing, malformed, duplicated, amended, conflicting, future, and oversized input.

PR 2B excludes:

- live HTTP, SEC Latest/RSS polling, API rate limiting, credentials, or a general crawler;
- FMP and issuer-IR adapters;
- LLMs, extraction, estimates, market data, brokerage, portfolio state, or trading; and
- durable operational telemetry export, which remains binding before live reads.

## Decision 1: explicit, hash-bound evidence bundles

Add an `earnings.source.observed` schema-V2 form while retaining schema V1 as a distinct legacy
variant.

```ts
type SecEvidenceRole =
  | "sec.submissions"
  | "sec.filing-index"
  | "sec.primary-document"
  | "sec.exhibit-99.1"
  | "sec.periodic-report"
  | "sec.xbrl-instance";

type EvidenceReference = Readonly<{
  role: string;
  artifactHash: string;
}>;

type EarningsSourceObservedV2 = Readonly<{
  issuerCik: string;
  fiscalPeriod: string;
  sourceKind: "sec_8k" | "filing";
  primaryArtifactHash: string;
  evidenceBundleHash: string;
  evidence: readonly EvidenceReference[];
  publishedAtMs: number | null;
  timestampConfidence: "exact" | "provider" | "inferred" | "unknown";
  originalTimestamp: string | null;
}>;
```

### Canonical membership

- A V2 bundle contains 1 through 16 evidence references.
- Artifact digests are unique within one bundle. A digest cannot be assigned multiple roles.
- The primary digest appears exactly once under the required primary role.
- Raw member presentation order is never semantic. Assembly sorts by `(role, artifactHash)` before
  validation and hashing; a noncanonical input order is not an error.
- A provider-neutral role is 1 through 64 ASCII characters matching
  `^[a-z0-9]+(?:[._-][a-z0-9]+)*$`. The SEC normalizer further restricts it to
  `SecEvidenceRole`.
- No URL, path, query, provider filename, response body, credential, arbitrary header, retrieval
  time, or observation ID enters domain membership.
- Every artifact whose bytes, metadata, or parsed structure affects classification, identity,
  fiscal focus, publication time, or output must be retained.

### Required SEC role matrix

A V2 `sec_8k` bundle requires:

- exactly one `sec.submissions`;
- exactly one `sec.filing-index`;
- exactly one `sec.primary-document`;
- one or more `sec.exhibit-99.1`; and
- at least one `sec.xbrl-instance` or `sec.periodic-report` that supplies structured fiscal focus.

A V2 `filing` bundle requires exactly one `sec.submissions`, one `sec.filing-index`, and one
`sec.primary-document`. It also requires one `sec.xbrl-instance` when the primary document does not
itself contain the complete structured fiscal-focus pair.

`sec.submissions`, `sec.filing-index`, `sec.primary-document`, `sec.xbrl-instance`, and
`sec.periodic-report` are singleton roles when present. `sec.exhibit-99.1` is the only repeating PR
2B role. Missing required evidence is `sec.required-member-missing`; duplicate singleton roles,
duplicate digests, unknown roles, invalid membership, and primary-role mismatches are
`sec.bundle-invalid`.

For `sec_8k`, the primary artifact is the lowest positive SEC sequence among qualifying EX-99.1
members. Tied or conflicting sequence metadata is invalid. For `filing`, the primary artifact is
`sec.primary-document`.

### Bundle identity

The bundle hash uses `peas/provider-evidence-bundle/v1` over the exact canonical object:

```text
provider
source
recordId
revisionId
subject
issuerCik
fiscalPeriod
sourceKind
primaryArtifactHash
evidence[] sorted by role then artifactHash
```

The reducer independently recomputes this hash. For V2 it requires:

- `EventDraft.provider.artifactHash === primaryArtifactHash`;
- the primary digest is present exactly once under the correct role;
- `causationId === evidenceBundleHash`;
- provider, source, record, revision, subject, correlation, issuer, period, and source-kind identity
  satisfy the SEC policy; and
- the received bundle hash equals the recomputed hash.

Same provider record/revision with changed content continues to fail closed at trusted capture.

### Frozen analysis provenance and bounds

`SourceObservation`, each `AnalysisInput`, branch state, job payload, and result provenance retain:

- event ID, event hash, and event position;
- source kind and provider record/revision identity;
- primary artifact digest and nullable V1/non-null V2 bundle hash; and
- complete role-to-artifact membership for that source.

Every source observation remains represented. A separately sorted artifact catalog deduplicates
digests for reads without dropping source/event provenance. A secondary-evidence-only change changes
the analysis input-bundle and branch hashes.

The fixed domain ceilings are:

- 16 evidence references per source;
- 32 sources per cluster;
- 512 source-to-evidence memberships per analysis input;
- 512 unique analysis artifacts;
- 32 analysis branches;
- 16,384 retained branch memberships; and
- 8 MiB canonical UTF-8 for the complete schema-4 earnings aggregate state.

The existing 1 MiB `EventDraft` boundary remains frozen. Every state, job-payload, and
result-provenance schema enforces the matching applicable ceiling.

Before returning any transition, reducer 3.0 measures the proposed schema-4 state. Source or branch
additions that would exceed 8 MiB are rejected without adding them. If a mirror timer cannot add a
branch, it is marked fired and emits `earnings.analysis.capacity-exhausted` when that bounded
fallback fits. If even the fallback would exceed the ceiling, aggregate state remains byte-identical
to the prior state. Source, timer, lease, success, failure, finalization, and every other transition
perform the projected-state check.

### Historical compatibility

V1 and V2 are separate discriminated inputs:

- V1 uses event `schemaVersion: 1`, maps internally to one `legacy.primary` reference, and has
  `evidenceBundleHash: null`.
- `legacy.primary` is not a `SecEvidenceRole`; V1 does not execute V2 role, V2 bundle-hash, or V2 SEC
  envelope validation. Existing V1 primary artifact/provider checks still apply.
- V2 uses event `schemaVersion: 2`, requires a non-null bundle hash, and executes all V2 checks.
- The reducer version becomes `3.0.0`; aggregate state becomes schema 4.
- Reducer 3.0 starts only from schema-4 genesis state. Reducer-2.2 checkpoints are neither migrated
  nor resumed under reducer 3.0.
- New runs can replay V1 events from position zero, including mixed V1/V2 streams.

RC.2 release assets and goldens remain immutable. PR 2B adds new vectors and a golden-change
explanation.

## Decision 2: selected observations, verified loading, then pure normalization

Loading and normalization remain separate boundaries.

### Recorded manifest and observation selection

A recorded bundle manifest declares one logical `asOfMs`, 1 through 16 canonical evidence members,
and exactly one `selectedObservationId` per member. Selection is explicit replay input; the recorded
adapter never scans `ArtifactStore.readObservations()` and has no “earliest observation” rule.

For each canonical member the adapter performs exactly one `getObservation()` and one verified
`read()`, at most 16 of each. Before normalization it requires:

- the selected observation exists and is not reused by another member;
- `observation.provider === "sec-edgar"`;
- `observation.retrievedAtMs <= asOfMs`;
- declared `artifactHash`, `observation.artifactDigest`, and
  `VerifiedArtifactRead.artifact.digest` are equal;
- the verified stream is consumed completely;
- consumed bytes equal `VerifiedArtifactRead.artifact.sizeBytes`; and
- authoritative metadata sizes satisfy per-member and total-bundle limits.

`ArtifactObservation` has no size field and is never treated as size evidence. The verified
`ArtifactMetadata.sizeBytes` and fully consumed stream are authoritative.

A missing, mismatched, duplicated, wrong-provider, or future observation is
`sec.observation-invalid`. A verified-read failure is `sec.artifact-read-failed`. Either prevents
normalizer invocation. A future live fetch will use the exact observation returned by `store()`;
it will not search observation history.

Observation ID, retrieval time, and observation hash enter the loader transcript in canonical
role/artifact order, never the domain event or bundle hash. Choosing another eligible observation
for identical bytes preserves bundle/draft identity but intentionally changes the loader transcript.

### Pure normalization result

After all members verify, the adapter produces a detached `VerifiedSecBundle`. The pure
`normalizeSecBundle(bundle, policy)` performs no I/O and returns exactly one result:

```ts
type SecNormalizationResult =
  | Readonly<{ status: "emitted"; draft: EventDraft; transcript: NormalizationTranscript }>
  | Readonly<{ status: "ignored"; reasonCode: string; transcript: NormalizationTranscript }>
  | Readonly<{ status: "quarantined"; reasonCode: string; transcript: NormalizationTranscript }>;
```

Loader and normalization transcripts are canonical JSON, contain no raw artifact text, retain at
most 16 input/observation selections, and have a 256 KiB canonical UTF-8 ceiling. They include
loader/normalizer/decoder identities, bundle hash, selected evidence, status, reason code,
`limitKind` when applicable, and `outputHash`.

`outputHash` is `string | null`. For `emitted` it equals:

```ts
canonicalHash(
  "peas/sec-normalized-event-draft/v1",
  validateEventDraft(result.draft),
)
```

For ignored, quarantined, and loader-failure outcomes it is `null`. It never hashes an exception,
partial draft, error message, or raw provider text. PR 2B pins transcript goldens. Durable telemetry
storage/export remains deferred but binding before live reads.

## Decision 3: deterministic SEC semantic policy

### Filing and exhibit classification

- Allowed current forms are `8-K` and `8-K/A`; Item 2.02 must be explicitly present in structural
  submissions/index metadata.
- The PR 2B qualifying exhibit type is exactly `EX-99.1`. This is a versioned coverage boundary, not
  a claim that all real earnings releases use that type.
- Provider filenames and loose prose/keyword searches never classify a filing.
- An 8-K without Item 2.02 is ignored as `sec.not-earnings-related`.
- Item 2.02 with missing required role evidence is quarantined as
  `sec.required-member-missing`.
- Allowed periodic forms are `10-Q`, `10-Q/A`, `10-K`, and `10-K/A`; they emit independent
  `sourceKind: "filing"` observations.

### Issuer and accession identity

- Canonicalize the subject-company CIK to ten digits.
- Never derive subject CIK from the accession prefix; the prefix may identify a filing agent.
- Conflicting subject CIKs are `sec.subject-cik-conflict`.
- A canonical accession matches `^\d{10}-\d{2}-\d{6}$`.
- An amendment has its own accession and therefore its own provider record.

### Fiscal focus and periodic linkage

- Accept only a consistent structured pair of `dei:DocumentFiscalYearFocus` and
  `dei:DocumentFiscalPeriodFocus`.
- Map `Q1`, `Q2`, `Q3`, `Q4`, and `FY` directly to `YYYY-Qn` / `YYYY-FY`; never infer a quarter from
  calendar month, filing date, issuer name, or release prose.
- Every structured pair found in included XBRL or periodic evidence must agree. Missing or
  conflicting focus is ignored as `sec.fiscal-period-ambiguous`.
- A `sec.periodic-report` linked into an 8-K bundle must independently establish an allowed periodic
  form, the same canonical subject CIK, and the consensus final fiscal period.
- Every selected member must satisfy the adapter’s observation-as-of rule. A later periodic filing
  cannot enrich an earlier event. A next-morning filing normally emits its own filing observation
  and never retroactively modifies a captured 8-K.

### Publication time

Timestamp candidates come only from verified evidence for the exact source accession:

1. strict RFC 3339 `acceptanceDateTime` with an explicit UTC offset from `sec.submissions`; or
2. filing-header `ACCEPTANCE-DATETIME` in `YYYYMMDDHHmmss`, interpreted by
   `sec-eastern-post-2007-v1`.

`sec-eastern-post-2007-v1` is code-defined Gregorian US Eastern time: UTC-4 from the second Sunday
in March at 02:00 local through the first Sunday in November at 02:00 local, and UTC-5 otherwise. It
applies on or after 2007-03-11 and does not use locale, host timezone, `Intl` timezone data,
filesystem, or environment. Invalid, nonexistent, or ambiguous local values are
`sec.timestamp-invalid`.

Candidates compare by normalized epoch milliseconds, not raw string equality. All candidates must
represent the same instant or the result is `sec.timestamp-conflict`. `originalTimestamp` selects
submissions RFC 3339 first, then filing-header text. RFC 3339 confidence is `exact`; converted SEC
Eastern confidence is `provider`.

No usable candidate, including only unsupported pre-policy local time, emits `publishedAtMs: null`,
`timestampConfidence: "unknown"`, and `originalTimestamp: null`. Filing/report dates, HTTP Date,
Last-Modified, retrieval time, and linked-periodic timestamps are never publication candidates for
the source 8-K.

### Provider/event identity

- `provider`: `sec-edgar`
- `source`: `sec:normalizer-v1`
- Item 2.02 `recordId`: `sec:<accession>:earnings-source-v2`
- periodic `recordId`: `sec:<accession>:periodic-source-v2`
- `revisionId`: `1`
- `subject`: `earnings:<10-digit-cik>:<fiscal-period>`
- `correlationId`: the same earnings subject identity
- `causationId`: the evidence-bundle hash

Exact redelivery returns the original event. Reusing one provider record/revision with conflicting
content fails closed.

## Decision 4: bounded, version-pinned decoding and streaming parsing

### Byte ceilings

- 16 members;
- 10 MiB verified bytes per member;
- 32 MiB total verified bytes;
- 250,000 semantic markup tokens;
- markup depth 256;
- 256 attributes per tag; and
- 4 MiB extracted UTF-8 text per member.

Every exposed boundary requires exact and one-over tests. Limits are fixed safeguards, not target
sizes.

### Decoder policy

Decoder policy is `sec-decoder-v1`. Its sniff window is exactly raw bytes `[0, 1024)`, or the entire
member when shorter. Alias normalization only trims HTML ASCII whitespace (TAB, LF, FF, CR, SPACE)
and lowercases ASCII `A-Z`; it performs no locale or Unicode case conversion.

The complete UTF-8 label set is:

```text
utf-8
utf8
unicode-1-1-utf-8
```

The complete Windows-1252 label set is:

```text
windows-1252
cp1252
x-cp1252
iso-8859-1
iso8859-1
latin1
us-ascii
```

No other aliases are accepted. Implementations map an accepted label to canonical `utf-8` or
`windows-1252` before constructing `TextDecoder`; host alias recognition is not authoritative.

- JSON permits an optional UTF-8 BOM and fatal UTF-8 only.
- XML examines the UTF-8 BOM and XML declaration and permits only the UTF-8 label set.
- HTML uses a UTF-8 BOM first; otherwise it considers recognized meta charset/http-equiv
  declarations wholly contained in the sniff window. Conflicting or unsupported declarations are
  `sec.unsupported-encoding`.
- Undeclared HTML first attempts fatal UTF-8 and falls back to Windows-1252 only if fatal UTF-8
  fails. Silent replacement-character recovery is forbidden.
- A BOM/declaration conflict is `sec.unsupported-encoding`. A declaration beginning inside but
  ending outside the sniff window is not recognized.

Decoder aliases, precedence, sniff window, and golden byte vectors are part of normalizer identity.
The pinned Node runtime must pass a decoder capability probe.

### Streaming tokenizer

Pin exactly `htmlparser2@12.0.0` when Agent 3 receives separate authorization to modify dependency
files. Use `Parser` callbacks only; never use `DomHandler`, `parseDocument`, or another DOM-producing
helper. Production feeds decoded markup in fixed 32 KiB chunks.

Register `onopentagname`, `onattribute`, `onclosetag`, `ontext`, `oncomment`,
`onprocessinginstruction`, `oncdatastart`, `oncdataend`, `onerror`, and `onend`. Do not register
`onopentag`; application code never receives or retains an aggregated attribute map. Reset the
attribute counter at `onopentagname`, count each `onattribute`, retain only allowlisted bounded
attributes, and abort on the 257th attribute. The 10 MiB member ceiling remains the absolute bound
on any one callback input.

One semantic token is one open tag, attribute, close tag, comment, processing instruction, CDATA
section, or contiguous text run. `oncdatastart` adds one token; `oncdataend` adds none; text inside
the CDATA section contributes extracted-text bytes but no second token. Adjacent `ontext` callbacks
outside CDATA coalesce until a markup boundary or parser end, so feed boundaries do not change the
token count. The 250,001st token aborts.

JSON uses existing bounded inert-JSON utilities plus SEC structural schemas. Canonical output is
independent of raw member order, object insertion order, locale, wall time, environment, filesystem
order, feed boundary, or network state.

## Decision 5: failure taxonomy

Stable provider/pipeline outcomes are:

| Status | Reason code | Meaning |
| --- | --- | --- |
| ignored | `sec.not-earnings-related` | No deterministic Item 2.02 classification |
| ignored | `sec.fiscal-period-ambiguous` | Structured fiscal focus is missing or conflicting |
| quarantined | `sec.bundle-invalid` | Canonical membership, role, primary, or sequence is invalid |
| quarantined | `sec.bundle-hash-mismatch` | Declared and recomputed bundle hashes differ |
| quarantined | `sec.identity-mismatch` | SEC provider/event identity is inconsistent |
| quarantined | `sec.required-member-missing` | Required role evidence is absent |
| quarantined | `sec.observation-invalid` | Selected retrieval observation is absent, mismatched, reused, or future |
| quarantined | `sec.artifact-read-failed` | A selected artifact cannot complete verified read |
| quarantined | `sec.member-limit-exceeded` | Member count or one member exceeds its byte ceiling |
| quarantined | `sec.bundle-byte-limit-exceeded` | Total verified bytes exceed the bundle ceiling |
| quarantined | `sec.subject-cik-conflict` | Evidence disagrees on subject issuer |
| quarantined | `sec.timestamp-conflict` | Valid publication candidates represent different instants |
| quarantined | `sec.timestamp-invalid` | A timestamp candidate is malformed or locally ambiguous |
| quarantined | `sec.unsupported-encoding` | Encoding declaration or byte policy is unsupported/conflicting |
| quarantined | `sec.parse-limit-exceeded` | A fixed markup ceiling is exceeded |
| quarantined | `sec.malformed-json` | SEC JSON is malformed or structurally invalid |
| quarantined | `sec.malformed-markup` | Required markup cannot be tokenized under policy |

`sec.parse-limit-exceeded` has exactly one `limitKind`: `markup-tokens`, `markup-depth`,
`attributes-per-tag`, or `extracted-text-bytes`. Member and total-byte breaches use their dedicated
codes. Raw input order never produces `sec.bundle-invalid`.

Reducer-side V2 rejection reasons remain provider-neutral and distinguish invalid payload,
primary-artifact provenance, invalid evidence membership, bundle-hash mismatch, source identity,
source evidence capacity, analysis artifact capacity, and projected state capacity.

No ignored, quarantined, or rejected result partially appends an earnings source event.

## Decision 6: effect isolation

Every PR 2B execution uses a non-live manifest with `effectsAllowed: false`. “Live-style” means
incremental shadow-style processing, not a live manifest. Jobs and outbox messages may be retained
as immutable audit outputs but cannot become dispatchable. PR 2B has no HTTP or financial-effect
reachability. Live operational effect allowlists remain deferred and binding before forward reads.

## Package layout

```text
fixtures/sec/v1/                         reviewed synthetic fixture cases
src/providers/evidence-bundle.ts         provider-neutral bundle assembly and hashing
src/providers/sec/contracts.ts           SEC roles, limits, identities, reason codes
src/providers/sec/parsers/               bounded JSON and streaming markup parsing
src/providers/sec/normalizer.ts          pure normalization policy
src/adapters/sec/recorded-sec-pipeline.ts selected observation loading and capture orchestration
test/sec-fixtures.test.ts                fixture manifests, bytes, paths, and expected hashes
test/provider-evidence-bundle.test.ts     bundle ordering, hashes, limits, identity
test/sec-normalizer.test.ts              semantic, timestamp, decoder, and parser matrix
test/sec-recorded-acceptance.test.ts      vault-to-cluster live-style/replay acceptance
fixtures/sec/v1/golden/                  normalization transcripts and PR 2B audit heads
```

Provider code must not be placed in `src/core/` or coupled to SQLite implementation classes.

## Implementation sequence

1. **Contract gate — complete:** this accepted ADR freezes schemas, identities, reason codes,
   parsers, decoder aliases, limits, compatibility, and fixture policy.
2. **Fixture gate:** land deterministic synthetic manifests, bytes, expected artifact/observation
   identities, bundle hashes, and boundary generators before production parsing.
3. **Bundle gate:** implement canonical bundle validation/hash and permutation/resource tests.
4. **Normalizer gate:** implement pure parsing and normalization with transcript goldens.
5. **Reducer gate:** add V2 evidence, reducer/state versioning, projected-state bounds, and complete
   frozen analysis provenance.
6. **Integration gate:** store/reopen/read selected artifacts, normalize, capture, process, and replay
   through memory and SQLite.
7. **Adversarial gate:** independent review, mutations, full `npm run check`, Windows/Linux CI, and
   explicit golden-change explanation.

Fixture and evidence-bundle agents may proceed in parallel from the same accepted-contract SHA.
Reducer and integration work remain sequential where they touch event identity and goldens.

## Acceptance matrix

Required cases include:

- valid Item 2.02 + EX-99.1 + structured focus and valid 10-Q/10-K;
- exact redelivery, amendment accession, and conflicting provider content;
- arbitrary member permutations and multiple EX-99.1 primary selection;
- every missing/duplicate required role and observation mismatch;
- selected observation exactly at/after as-of and no future evidence leakage;
- same/different CIK and fiscal-period linkage and no retroactive 8-K enrichment;
- padded CIK and accession-prefix mismatch;
- absent, equivalent, conflicting, malformed, daylight, and standard-time timestamps;
- every accepted/near-miss encoding alias, BOM/declaration conflict, sniff boundary, and
  UTF-8/Windows-1252 fallback;
- every semantic token callback, CDATA non-double-counting, fixed/alternate chunk invariance, and
  exact/one-over parser limits;
- V1, V2, mixed-stream replay and reducer-2.2 checkpoint refusal;
- complete source-to-evidence membership and exact artifact-catalog union;
- projected-state checks for source, timer, lease, success, and failure;
- corruption or missing content preventing normalizer invocation;
- memory/SQLite and page-size/reopen equivalence; and
- replay, shadow, research, and paper runs producing zero dispatchable work.

## Fixture and evidence policy

- Checked-in provider bodies are minimal reviewed synthetic data unless redistribution is explicitly
  approved per artifact.
- Fixture paths are local loading instructions only and cannot enter bundle/event hashes.
- Fixture tests recompute every body digest, observation identity/hash, and expected bundle hash.
- Large exact/one-over bodies are generated deterministically in tests rather than checked in.
- No fixture or golden contains credentials, signed URLs, provider filenames, or prohibited request
  identity.

## Required evidence before merge

- checked-in PR 2B captured stream and normalization/audit goldens;
- immutable RC.2 evidence plus a written golden-change explanation;
- fixture integrity, bundle permutation, and exact/one-over property tests;
- memory/SQLite differential capture and replay;
- reopen, corruption, missing-member, observation, redelivery, and conflict tests;
- dense state-size and projected-transition tests;
- mutations for evidence omission/substitution, order dependence, fiscal inference, primary
  selection, artifact mismatch, timestamp substitution, and partial-event emission; and
- `npm run check` on Windows and Linux.

## Deferred but binding before forward observation

- durable storage/export of emitted, ignored, quarantined, and loader transcripts;
- live SEC fetch policy, identified user agent, fair-access throttling, backoff, and dispatcher
  allowlist;
- SEC Latest/RSS discovery and submissions reconciliation;
- clock synchronization and complete observation telemetry;
- retention policy and licensed market-reference strategy; and
- empirical review of accepted size limits against forward artifacts before widening source scope.

## Primary references

- [SEC EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
- [SEC Accessing EDGAR Data](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data)
- [Official Form 8-K](https://www.sec.gov/files/form8-k.pdf)
- [SEC EDGAR XBRL Guide](https://www.sec.gov/file/xbrl-guide)
- [htmlparser2](https://www.npmjs.com/package/htmlparser2)
