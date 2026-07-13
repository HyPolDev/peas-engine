# ADR 0007: Recorded SEC normalization and bounded evidence bundles

- Status: Proposed
- Date: 2026-07-13
- Decision owner: HyPolDev
- Target: PR 2B
- Depends on: Kernel V2 RC.2 and merged PR 2A artifact vault

## Context

PR 2B must prove one provider path without introducing live network access:

```text
recorded SEC entity bytes -> ArtifactStore -> verified evidence bundle -> pure SEC normalizer
  -> bounded EventDraft -> trusted capture -> earnings reducer -> audited cluster
```

The kernel, `EventDraft` resource boundary, and provider-neutral artifact vault are complete. The
remaining architectural gap is that an SEC filing is not one artifact. Discovery metadata, filing
index, primary document, earnings exhibit, and a related 10-Q or 10-K may all be required to explain
one source observation. The current `earnings.source.observed` schema and reducer retain only one
artifact digest per source, so they cannot freeze the complete evidence set for future extraction.

This ADR is proposed rather than accepted so bundle representation, fiscal-period policy, and
normalization outcomes can be agreed before implementation agents modify contracts or fixtures.

## Scope

PR 2B includes:

- recorded or reviewed synthetic SEC structures only;
- submissions/filing metadata, filing index, 8-K Item 2.02, EX-99.1, and 10-Q/10-K linkage;
- deterministic bundle assembly, text decoding, parsing, normalization, and reason codes;
- a versioned source-event schema that freezes every evidence artifact;
- memory and SQLite capture plus live-style/replay equivalence tests; and
- adversarial tests for missing, malformed, duplicated, amended, conflicting, and oversized input.

PR 2B excludes:

- live HTTP, SEC Latest/RSS polling, API rate limiting, or credentials;
- FMP and issuer-IR adapters;
- LLMs, language extraction, numerical extraction, estimates, market data, and trading;
- a general crawler, browser, API, or user interface; and
- financial effects of any kind.

## Decision 1: provider evidence bundles are explicit domain evidence

Add a bounded schema-V2 form of `earnings.source.observed`. Keep the existing schema-V1 form
readable while new SEC observations use V2.

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

Contract rules:

- `EventDraft.provider.artifactHash` equals `primaryArtifactHash` and identifies a verified vault
  artifact, never a synthetic hash.
- `causationId` equals the canonical evidence-bundle hash.
- Evidence references are sorted by role then artifact hash before hashing. The role is a portable
  provider-qualified ASCII identifier; the SEC normalizer restricts it to `SecEvidenceRole`, while
  the earnings-domain schema stays provider-neutral for later FMP and issuer-IR bundles.
- The bundle hash uses domain `peas/provider-evidence-bundle/v1` and covers provider, subject
  identity, provider record/revision identity, source kind, primary digest, and the ordered evidence
  references. The SEC contract maps accession and form into those provider fields.
- No raw URL, path, query, provider filename, response body, credential, or arbitrary header enters
  the bundle or event.
- A source contains at most 16 evidence references. Roles that may repeat, such as EX-99.1, are
  ordered by SEC sequence and then digest before provider filenames are discarded.
- The primary artifact for an Item 2.02 observation is the lowest-sequence qualifying EX-99.1;
  the primary artifact for a periodic filing is its primary document.
- Vault observation IDs belong in the normalization transcript, not the domain event or bundle
  hash. Re-fetching identical bytes must produce the same normalized draft and bundle identity;
  the later telemetry ledger links the chosen retrieval observations to the captured event.
- `SourceObservation`, frozen analysis inputs, analysis bundle hashing, and result provenance retain
  all unique evidence digests, not only the primary digest.
- The total frozen artifact limit is explicit: at most 32 sources times 16 artifacts per source.
  Every state, job-payload, and result-provenance schema must enforce the same ceiling.

This evolves earnings-domain behavior, not the frozen kernel ports. The reducer and state schema
must receive new versions. The RC.2 release remains immutable historical evidence; PR 2B adds a new
acceptance vector and a golden-change explanation rather than rewriting release assets.

## Decision 2: bundle loading and normalization are separate boundaries

Use two layers:

1. A recorded adapter consumes every `ArtifactStore.read()` stream completely and produces a
   detached `VerifiedSecBundle`. If any read fails verification, normalization is never called.
2. A pure `normalizeSecBundle(bundle, policy)` function performs no I/O and returns one detached
   normalization result.

```ts
type SecNormalizationResult =
  | Readonly<{ status: "emitted"; draft: EventDraft; transcript: NormalizationTranscript }>
  | Readonly<{ status: "ignored"; reasonCode: string; transcript: NormalizationTranscript }>
  | Readonly<{ status: "quarantined"; reasonCode: string; transcript: NormalizationTranscript }>;
```

The transcript is bounded canonical JSON containing the normalizer version, bundle hash, input
digests, chosen evidence, reason code, and output hash. PR 2B pins transcript goldens. Durable live
storage of all normalization outcomes belongs to the observation-telemetry task before live reads;
the transcript contract is fixed here so that later persistence does not change normalization.

## Decision 3: deterministic SEC semantic policy

### Filing and exhibit classification

- Use submissions/filing metadata and the filing index as authoritative structural inputs.
- An 8-K or 8-K/A is earnings-related only when Item 2.02 is explicitly present and at least one
  qualifying earnings exhibit is identified from the filing-index type/sequence metadata.
- Do not classify a filing from a provider filename or a loose keyword search alone.
- A non-earnings 8-K is `ignored` with `sec.not-earnings-related`.
- An index that claims a required exhibit whose artifact is absent is `quarantined` with
  `sec.required-member-missing`.
- 10-Q and 10-K bundles emit separate `sourceKind: "filing"` observations and may share the same
  earnings correlation identity as a preceding 8-K.

The official Form 8-K instructions say Item 2.02 covers a public announcement concerning results
for a completed quarter or fiscal year and includes the announcement text as an exhibit. That rule,
not prose heuristics, is the initial deterministic classifier.

### Issuer identity

- Canonicalize the subject-company CIK to ten digits.
- Do not derive issuer CIK from the first ten digits of an accession number. SEC documentation notes
  that the accession prefix can belong to a third-party filing agent.
- Reject conflicting subject CIKs across bundle members with `sec.subject-cik-conflict`.

### Fiscal period

- Accept a fiscal period only from a consistent structured pair of
  `dei:DocumentFiscalYearFocus` and `dei:DocumentFiscalPeriodFocus`, including a linked periodic
  filing or XBRL instance.
- Map `Q1`, `Q2`, `Q3`, and `FY` directly to the existing `YYYY-Qn` / `YYYY-FY` contract.
- Do not infer fiscal quarter from calendar month, filing date, issuer name, or unstructured release
  prose in PR 2B.
- Missing or conflicting structured focus is `ignored` with `sec.fiscal-period-ambiguous`.

### Publication time

- Preserve the provider timestamp string exactly in `originalTimestamp`.
- Emit `publishedAtMs` only when the recorded source includes an unambiguous offset/UTC value or a
  versioned SEC-time conversion policy can resolve it deterministically.
- Filing date alone is not a publication timestamp. If acceptance time cannot be resolved,
  `publishedAtMs` is null and confidence is `unknown`.
- Retrieval time remains retrieval evidence and is never substituted for publication time.

### Provider identity

- `provider`: `sec-edgar`
- `recordId`: `sec:<canonical-accession>:earnings-source-v2` for Item 2.02, with an equivalent
  versioned suffix for a periodic filing
- `revisionId`: `1`; an amendment is a separate accession and therefore a separate record
- `source`: `sec:normalizer-v1`
- `subject`: `earnings:<10-digit-cik>:<fiscal-period>`
- `correlationId`: the same deterministic earnings subject identity
- `causationId`: the evidence-bundle hash

Exact redelivery must return the original captured event. Reusing the same provider record/revision
with different primary bytes must fail at trusted capture.

## Decision 4: parsers are bounded before semantic extraction

- Read verified streams with fixed per-member and total-bundle byte ceilings before decoding.
- Use strict, versioned character-decoding policy. Unsupported or malformed encoding is a stable
  quarantine reason; replacement-character decoding is not permitted silently.
- Parse JSON with the existing bounded inert-JSON utilities and provider-specific structural limits.
- Use a version-pinned streaming HTML/XML tokenizer with explicit token, nesting, attribute, and
  extracted-text budgets. A regex-only HTML parser is not acceptable.
- Never construct an unbounded DOM before limits are enforced.
- Canonical output must not depend on input member order, object insertion order, locale, wall time,
  environment, filesystem order, or network state.

Initial proposed ceilings, to be confirmed against fixture sizes before acceptance:

- 16 bundle members;
- 10 MiB per member;
- 32 MiB total verified bytes;
- 250,000 markup tokens;
- nesting depth 256;
- 256 attributes per tag; and
- 4 MiB extracted text per member.

The ceilings are safeguards, not target sizes. Exact and one-over tests are required for every
dimension that implementation exposes.

## Decision 5: failure taxonomy

Stable initial reason codes:

| Status | Reason code | Meaning |
| --- | --- | --- |
| ignored | `sec.not-earnings-related` | Filing has no deterministic Item 2.02 earnings classification |
| ignored | `sec.fiscal-period-ambiguous` | Structured fiscal focus is absent or insufficient |
| quarantined | `sec.bundle-invalid` | Bundle shape, ordering, hash, or role contract is invalid |
| quarantined | `sec.required-member-missing` | Index identifies evidence that was not verified into the bundle |
| quarantined | `sec.subject-cik-conflict` | Bundle members disagree on subject issuer |
| quarantined | `sec.timestamp-conflict` | Provider timestamps conflict beyond policy |
| quarantined | `sec.unsupported-encoding` | Character encoding is unsupported or malformed |
| quarantined | `sec.parse-limit-exceeded` | A fixed parser/resource ceiling is exceeded |
| quarantined | `sec.malformed-json` | SEC JSON is malformed or structurally invalid |
| quarantined | `sec.malformed-markup` | Required markup cannot be tokenized under policy |

No ignored or quarantined result may partially append an earnings source event.

## Package layout

```text
fixtures/sec/v1/                         reviewed synthetic/recorded fixture cases
src/providers/evidence-bundle.ts         provider-neutral bundle assembly and hashing
src/providers/sec/contracts.ts           SEC roles, limits, identities, reason codes
src/providers/sec/parsers/               bounded JSON and markup parsing
src/providers/sec/normalizer.ts           pure normalization policy
src/adapters/sec/recorded-sec-pipeline.ts verified artifact loading and capture orchestration
test/provider-evidence-bundle.test.ts     bundle ordering, hashes, limits, identity
test/sec-normalizer.test.ts               semantic and parser matrix
test/sec-recorded-acceptance.test.ts      vault-to-cluster live/replay acceptance
fixtures/sec/v1/golden/                   normalization transcripts and PR 2B audit heads
```

Provider code must not be placed in `src/core/` or coupled to SQLite implementation classes.

## Implementation sequence

1. **Contract gate** — accept or amend this ADR, select parser/decoder policy, and freeze schemas,
   reason codes, limits, and fixture redistribution policy.
2. **Fixture gate** — land fixture manifests and expected hashes before production parsing logic.
3. **Bundle gate** — implement canonical bundle validation/hash and permutation/resource tests.
4. **Normalizer gate** — implement pure parsing and normalization with transcript goldens.
5. **Reducer gate** — add source schema V2, bounded evidence sets, reducer/state versioning, and
   frozen analysis provenance.
6. **Integration gate** — store/reopen/read artifacts, normalize, capture, process, and replay using
   both memory and SQLite paths.
7. **Adversarial gate** — independent review, mutation targets, full `npm run check`, Linux and
   Windows CI, and explicit golden-change explanation.

Fixture and pure-parser work may proceed in parallel only after the contract gate. Reducer and
integration work should be sequential because both touch event identity and golden evidence.

## Acceptance matrix

| Case | Expected result |
| --- | --- |
| Item 2.02 + valid EX-99.1 + structured fiscal focus | One schema-V2 `sec_8k` source and replay-identical cluster |
| Valid 10-Q/10-K bundle | One `filing` source linked to the same issuer/fiscal period |
| Exact artifact and event redelivery | Original observation/event returned; no duplicate source |
| Amendment accession | Separate deterministic source record and revision evidence |
| Input members presented in any order | Identical bundle, transcript, draft, state, and decision hashes |
| Filing index names two EX-99.1 exhibits | Deterministic primary selection; both evidence digests retained |
| Missing claimed exhibit | Quarantined outcome; no partial earnings event |
| Non-earnings 8-K | Ignored outcome; no earnings event |
| Malformed HTML tolerated within parser rules | Same result on Windows and Linux |
| Malformed/oversized input beyond policy | Stable quarantine reason before unbounded processing |
| Padded/unpadded subject CIK | Same canonical issuer and aggregate |
| Accession prefix differs from subject CIK | Subject CIK wins; no aggregate split |
| Conflicting fiscal focus or timestamps | Stable ignored/quarantine result; no guessed value |
| Next-morning periodic filing within lifecycle | Incremental filing branch; no new cluster |
| Artifact corruption after storage | Verified read fails; normalizer is not invoked |
| Live/replay processing and page-size variation | Complete audited snapshots are byte-identical |
| Replay, shadow, research, and paper manifests | Zero dispatchable work |

## Required evidence before merge

- New checked-in PR 2B captured stream and golden normalization/audit vectors.
- Existing RC.2 acceptance vector remains explained and reviewable.
- Bundle permutation and exact/one-over property tests.
- Memory/SQLite differential capture and replay tests.
- Artifact reopen, corruption, missing-member, redelivery, and conflict tests.
- Dense maximum source/artifact state-size test.
- Targeted mutations for evidence omission, bundle-order dependence, fiscal inference, primary
  selection, artifact-provenance mismatch, and partial-event emission.
- `npm run check` passes on Linux and Windows.

## Deferred but binding before forward observation

- Durable storage/export of emitted, ignored, and quarantined normalization transcripts.
- Live SEC fetch policy, identified user agent, fair-access throttling, backoff, and dispatcher
  effect allowlist.
- SEC Latest/RSS discovery and submissions API reconciliation.
- Clock synchronization evidence and observation telemetry.
- Retention policy and licensed market-reference strategy.

## Primary references

- [SEC EDGAR APIs](https://www.sec.gov/search-filings/edgar-application-programming-interfaces)
- [SEC Accessing EDGAR Data](https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data)
- [Official Form 8-K](https://www.sec.gov/files/form8-k.pdf)
- [SEC EDGAR XBRL Guide](https://www.sec.gov/file/xbrl-guide)
