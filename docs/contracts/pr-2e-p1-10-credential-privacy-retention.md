# PR 2E P1-10 credential, privacy, and retention contract

## Document control

- Milestone: `P1-10`
- Wave: `PR 2E`
- Status: `CONTRACT_CANDIDATE`
- Scope: recorded/offline contract, architecture, and synthetic-test authority only
- Production transport: `PROHIBITED`
- Provider request: `PROHIBITED`
- Provider payload or provider-derived example in Git: `PROHIBITED`
- FMP transport in the first PR 2F wave: `PROHIBITED`
- Retention implementation authority: `HUMAN_AUTHORIZATION_REQUIRED`
- PR 2F entry decision: `NO_GO` until the retention authority described in this document is
  separately granted and the exact PR 2E candidate receives independent `GO`

This contract preserves the accepted PR 2D provider-neutral ports and the P1-09 final authority.
It does not amend the accepted PR 2D contract bytes, implement a credential reader, add a transport,
inspect an account, or authorize a witness. Stale historical prose that says P1-09 is pending does
not supersede the P1-09 final `GO`.

## 1. Binding security invariants

The PR 2F implementation and any later separately authorized FMP implementation must preserve all
of these invariants:

1. Every non-secret authorization, identity, route, query, value, clock, historical-age, bound,
   quota, zero-spend, retention-readiness, and run-enable gate passes before a credential value is
   read.
2. A credential is read only at the runtime boundary for one already-authorized attempt. It is
   never read by configuration parsing, identity derivation, documentation generation, tests,
   replay, normalization, selection, evidence reconciliation, or CI.
3. Credentials, credential hashes, credential-derived identifiers, provider authorization
   headers, raw page tokens, query strings, and provider bytes never enter Git, fixtures, logs,
   ledger facts, exceptions, evidence packages, metrics, traces, or public output.
4. Provider bytes are private, content-addressed artifacts beneath the configured
   `PEAS_RUNTIME_ROOT`. They are never written beneath, through, or into the repository worktree.
5. A failure exposes only the closed safe-error shape defined in section 5. Raw provider or library
   error text is never an error field or a hash input.
6. A stop trigger blocks new reads, replay, normalization, selection, derivation, publication, and
   acquisition before deletion work begins. Deletion is not a license to continue use during a
   grace period.
7. Content-addressed deduplication never extends retention. If an affected provider observation
   refers to bytes shared with another observation, the affected bytes are erased conservatively;
   any still-authorized lane must reacquire them under its own authority.
8. Failure to prove credential isolation, redaction, private placement, retention eligibility, or
   completed deletion is terminal and fail-closed.

## 2. Non-secret preflight precedes credential access

The implementation must use this ordering. A later stage cannot mask an earlier failure.

1. Parse a closed configuration object and reject unknown fields.
2. Prove that live acquisition is explicitly enabled for this run.
3. Validate the accepted policy version and `authorizationMode=p1-09-approved`.
4. Validate the exact provider, dataset, feed, endpoint-channel, method, route, provider role, and
   no-fallback identity.
5. Validate the closed query-field set and every frozen value.
6. Validate symbol count, requested limit, historical span, page position, token provenance, and
   all remaining project and entitlement bounds.
7. Prove zero incremental spend from the accepted sanitized policy. Unknown cost status rejects.
8. Prove concurrency, attempt, rolling quota, and deadline capacity.
9. Sample and validate trusted `request.started` wall and monotonic time, durably record it, and
   prove the 15-minute historical boundary from that exact time.
10. Prove the private runtime root and retention controller are configured, healthy, current, and
    capable of meeting the applicable deadline.
11. Only then enter the runtime credential boundary.
12. After a credential is present, construct the exact authorization headers in memory and invoke
    only the already-bound transport operation.

Steps 1 through 10 must not obtain a credential provider, enumerate environment variables, read a
credential file, inspect a process environment value, instantiate a provider SDK, open a socket,
resolve DNS, or obtain a generic HTTP client. Every rejection through step 10 has
`credentialReadCount=0` and `transportCallCount=0`.

The durable `request.started` event contains only the accepted sanitized request identity and
trusted clock evidence. It contains no authorization header, credential availability bit, symbol,
raw token, URL, query, or provider body.

## 3. Closed credential boundary

### 3.1 Alpaca

The only Alpaca credential environment names are:

```text
PEAS_ALPACA_API_KEY_ID
PEAS_ALPACA_API_SECRET_KEY
```

The only Alpaca authentication header names are:

```text
APCA-API-KEY-ID
APCA-API-SECRET-KEY
```

Both credential values must be present for one authorized attempt. Missing, empty, inaccessible, or
non-string values produce `credential-unavailable` at `credential-load` and zero transport calls.
The boundary must read only these two exact names, at most once each per physical attempt. It must
not enumerate the environment, search aliases, accept a file, command-line value, URL value,
generic header map, cookie, SDK profile, fallback credential, or provider account object.

### 3.2 FMP reservation

The only reserved FMP credential environment name is:

```text
PEAS_FMP_API_KEY
```

The only permitted future FMP authentication header name is `apikey`. Authentication in a URL,
query field, cookie, generic authorization header, or SDK profile is prohibited.

PR 2F must contain no FMP production file or FMP credential reader. A P1-10 attempt selecting the
FMP lane terminates as `lane-not-implemented` before reading `PEAS_FMP_API_KEY`. A later,
separately scoped and independently reviewed private-discrepancy change may activate this boundary
only after exact human scope approval, an active-subscription attestation, and proven retention
enforcement. It may not make FMP primary, fallback, SIP-equivalent, or public.

### 3.3 Lifetime and destruction

Credential values are runtime-only, memory-only, attempt-scoped capabilities:

- do not copy them into configuration, state-machine, journal, retry, quota, artifact, ledger,
  metric, trace, or error objects;
- do not persist, serialize, compare across attempts, hash, fingerprint, normalize, trim, transform,
  cache, memoize, refresh, or return them;
- do not include them in any identity preimage, including provider, dataset, feed, endpoint,
  request, attempt, page, acquisition, artifact, observation, or evidence identities;
- do not pass them to generic logging, inspection, telemetry, retry, exception-wrapping, URL, or
  string-formatting facilities;
- construct an exact frozen header record only at the transport call boundary;
- keep that record out of request snapshots and clear all mutable containers in a `finally` path;
  and
- release all references when the physical attempt settles.

JavaScript strings cannot be proven physically zeroized. The security claim is therefore bounded:
PEAS prevents intentional persistence and secondary copies, keeps the reference lifetime within one
settled attempt, and never claims heap zeroization. If an implementation introduces a runtime that
can guarantee zeroization, that may strengthen this contract but may not weaken any other rule.

Credential presence or absence is not an identity field. Evidence may record only the closed
terminal reason `credential-unavailable`; it may not record which name was missing, a length,
prefix, suffix, hash, account identifier, or header fact.

## 4. Private provider-byte boundary

All successful raw response bytes must pass directly from the bounded response stream into the
private ArtifactStore. Before transport can be obtained, runtime initialization must:

1. require an explicitly configured, trimmed, absolute, supported local `PEAS_RUNTIME_ROOT`;
2. resolve and verify the runtime root without following a repository-controlled symlink,
   junction, device path, UNC path, or redirected mount;
3. prove that the canonical runtime root and canonical repository root do not equal, contain, or
   descend from one another;
4. prove the SQLite database, WAL, artifact content, staging, snapshots, quarantine, locks, and
   retention journal remain on the accepted runtime-root boundary; and
5. reject any path that escapes that boundary before opening it.

Raw response bytes, partial bytes, content-addressed objects, staging files, snapshots, quarantined
objects, resumable token material, and private normalized facts are all private content for this
rule. None may be uploaded as CI evidence. Partial bytes are destroyed and their streams and sibling
streams are settled before return. A partial body is never committed, normalized, selected, or
retained as a successful artifact.

Persisted request metadata remains limited to the existing safe ArtifactStore projection: method,
sanitized origin, path hash, reviewed route label, request identity hash, and allowlisted response
facts. A raw path, full URL, URL user information, query, fragment, provider filename, arbitrary
header, credential, cookie, token, symbol, or provider text is prohibited.

## 5. Closed safe-error contract

The only externally observable P1-10 error value is an exact object with these three fields:

```text
reasonCode
operationStage
detailHash
```

- `reasonCode` is one value from the acquisition state machine's closed terminal classification
  set. A retention-only controller, once separately authorized, uses only the proposed
  `retention-policy-invalid`, `retention-stop-required`, `retention-deadline-breached`,
  `retention-erasure-failed`, and `retention-erasure-unprovable` values.
- `operationStage` is exactly one of `configuration`, `authority`, `identity`,
  `request-preflight`, `trusted-time`, `request-started`, `credential-load`, `dispatch`,
  `response-headers`, `response-body`, `cleanup`, `artifact-commit`, `artifact-verify`,
  `checkpoint`, `normalization`, `selection`, `retention-stop`, `retention-plan`,
  `retention-erase`, or `retention-verify`.
- `detailHash` is a 64-character lowercase SHA-256 value derived with the domain
  `peas/market-acquisition-safe-detail/v1`.

The detail preimage is a closed canonical object containing only reviewed enum values, booleans,
bounded nonnegative counters, accepted policy/version identifiers, and already-sanitized identity
hashes. It must never contain or derive from a credential, credential hash, raw token, token hash,
symbol, price, provider byte, response body, URL, query, path, arbitrary header, account fact,
provider status text, exception message, exception name, stack, library code, rejected free text,
hostile object, current wall time, or filesystem name. If no reviewed detail applies, the preimage
is the constant `{detailKind:"none"}`; raw input is never hashed as a substitute.

No other own property, symbol property, prototype data, `message`, `name`, `stack`, `cause`,
provider response, or original thrown value may cross this boundary. Error rendering is a fixed
mapping from `reasonCode` and `operationStage`; it does not interpolate inputs.

## 6. Recursive redaction and hostile-value handling

Redaction is defense in depth. It does not make forbidden material safe to persist. A component
must avoid collecting forbidden material in the first place, and the redactor must collapse any
unexpected value before it reaches a logger, ledger, metric, trace, or error.

The redactor must be deterministic, cycle-safe, depth-bounded, member-count-bounded, byte-bounded,
and descriptor-safe:

1. Never use implicit string conversion, JSON serialization, object spread, iteration, inspection,
   `toJSON`, `toString`, `valueOf`, custom inspection, or property access on an untrusted value.
2. Do not walk a non-plain object. `Error`, `URL`, request/response, header, stream, buffer,
   typed-array, function, symbol, promise, proxy, and class-instance values collapse to a fixed
   opaque marker.
3. For a candidate plain object, obtain own property descriptors in one guarded operation. A thrown
   proxy trap collapses the whole value to the opaque marker.
4. Never invoke a getter or setter. An accessor descriptor becomes a fixed accessor marker.
5. Track object identity. A repeated object becomes a fixed cycle marker.
6. Sort safe property names by UTF-8 bytes, enforce the accepted depth/member/byte ceilings, and
   replace overflow with fixed markers.
7. A key matching, case-insensitively, credential, key, secret, password, token, authorization,
   proxy authorization, cookie, set-cookie, header, URL, URI, origin, path, query, search,
   fragment, body, payload, response, request, cause, message, stack, account, subscription,
   invoice, payment, price, or symbol collapses with its entire subtree to a fixed redacted marker.
8. Every string value, even under an apparently safe key, becomes only a fixed type marker and its
   bounded UTF-8 byte-count bucket. Its characters are never copied, matched, emitted, or hashed.
9. Finite booleans and reviewed bounded counters may survive. Non-finite numbers, bigint, binary
   values, functions, and symbols collapse to fixed type markers.
10. The redacted projection is never used as a safe-error detail preimage unless its complete
    schema is independently allowlisted. Generic redaction output is not evidence.

URLs are never recursively sanitized from an exception: the whole URL-bearing value is discarded.
The only URL processing allowed elsewhere is closed configuration validation that compares the
precompiled origin and path identity and emits no rejected value. Query strings, user information,
and fragments are never logged, even in redacted form.

Thrown response bodies, malformed bodies, declared-length mismatches, provider error objects,
library messages, nested causes, hostile getters, and cleanup errors all map to the safe-error
contract. Raw provider error/body text and raw library text must never appear in logs or
observation-ledger facts.

## 7. Binding retention rules

### 7.1 Alpaca

For each Alpaca raw artifact, normalized fact, and private derived dataset:

- maximum retention is `3650` days from the trusted capture time;
- expiry is the earlier of capture plus 3650 consecutive UTC 24-hour periods and any earlier
  provider or human deadline;
- effective account closure, owner revocation, contrary provider guidance, or loss of the accepted
  personal/individual/noncommercial classification immediately blocks new acquisition and use; and
- affected raw artifacts must be erased and affected normalized/derived use must cease no later
  than 30 consecutive UTC 24-hour periods after the effective stop time, or an earlier provider
  deadline.

Equality at the deadline is not a safe operating target. The controller must schedule work with a
reviewed safety margin and treat an unprovable deadline as a stop condition.

### 7.2 FMP

For each FMP raw artifact, normalized fact, and private derived dataset:

- maximum retention is `3650` days from trusted capture time;
- retention and use are permitted only while the accepted subscription remains active;
- raw erasure and normalized/derived cessation must complete no later than the effective
  subscription-termination time; and
- public output, including raw, row-level, aggregate, chart, table, statistic, report, or
  discrepancy output, remains prohibited.

An agent must not inspect an account, plan, invoice, dashboard, cookie, credential, or subscription
page. A future FMP implementation therefore requires a human-owned, run-scoped active-subscription
attestation with an explicit conservative use-not-after time and confirmation that no earlier
termination is scheduled. At the use-not-after time, PEAS blocks the lane and erases/ceases the
affected material even if no termination notice was received. The duration and renewal protocol
for that attestation must be frozen by the separately authorized FMP change; this document does not
activate FMP transport.

### 7.3 What “cease use” means

At or after a stop-effective time, affected normalized facts and derived datasets may not be read,
replayed, normalized again, selected, joined, aggregated, exported, published, or used to make a
scientific result. Sanitized, non-content audit receipts may remain only if they contain no provider
bytes, reconstructable facts, symbols, prices, credentials, tokens, query data, account evidence, or
provider-derived output.

## 8. Current vault incompatibility

The current `ArtifactStore` port has no deletion operation. Its accepted methods cover store, stat,
verified read, attempt/observation lookup, observation reads, and reconciliation only.

Migration `005_artifact_vault.sql` installs `BEFORE DELETE` no-delete triggers for the artifact
retrieval attempts, retrieval outcomes, blobs, install intents, install transitions, observations,
integrity incidents, reconciliation action plans, action applications, quarantine receipts, and
reconciliation receipts. The accepted vault treats immutable content and evidence as
non-destructive. ADR 0006 explicitly deferred deletion and retention policy.

Consequently, the retention requirements above cannot be claimed as implemented by the current
vault. Deleting a content file directly would make the present reconciliation path classify an
expected retention erasure as missing/corrupt content, while `stat` and durable metadata would still
describe the immutable blob. Silently doing that would violate the accepted vault semantics.

## 9. Proposed auditable deletion architecture

This is a contract proposal, not implementation authority.

### 9.1 Port and ownership

Keep the frozen consumer-facing `ArtifactStore` interface unchanged. Add a separate, internal
`ArtifactRetentionController` maintenance port in the P1-10 production namespace. Only the
retention worker may receive that port. Acquisition, replay, normalization, selection, and provider
adapters receive only the ordinary ArtifactStore and the read/use denial guard.

The controller accepts only a closed provider-policy ID, a trusted stop event, and immutable
artifact/derivation identifiers. It accepts no arbitrary filesystem path, SQL, URL, provider body,
credential, token, symbol, account object, or free-text reason.

### 9.2 Additive retention journal

A separately approved migration adds append-only tables for:

- provider-scoped artifact and derivation ownership;
- retention policy versions and capture expiry;
- trusted stop events and effective deadlines;
- immutable erasure plans;
- artifact tombstones and derivation-use denials; and
- erasure attempts and verified erasure receipts.

Every row uses canonical IDs and closed enums. Existing immutable evidence rows and existing
no-delete triggers remain intact. A plan binds the policy ID, provider/dataset/feed/channel IDs,
affected artifact observation IDs and digests, affected derived identifiers, stop-event ID,
effective time, deadline, plan hash, and predecessor receipt. It contains no raw content or account
evidence.

### 9.3 Stop, plan, erase, verify

Under the existing single-writer/lease discipline, the controller performs this exact sequence:

1. durably record the stop event;
2. atomically install provider-scoped acquisition, read, replay, normalization, selection,
   derivation, and publication denials;
3. enumerate a closed reference graph from provider observations to every physical digest and
   affected derived identifier;
4. freeze an immutable erasure plan and independently recompute it before execution;
5. settle active readers and writers; if settlement cannot be proved, keep all use denied and
   report terminal failure;
6. erase each physical content object plus every staging, snapshot, and quarantine copy beneath
   the runtime root, using only paths re-derived from accepted digest identities;
7. create an immutable artifact tombstone before any future read can open the erased path;
8. mark affected derived identifiers use-denied without retaining reconstructable values;
9. verify absence by a fresh bounded scan and verify that every affected identifier is denied;
10. append a non-content erasure receipt containing the plan hash, digest/observation identities,
    byte count from prior safe metadata, attempt count, closed outcome, and trusted completion
    evidence; and
11. advance the durable controller checkpoint only after the receipt is committed and reread.

Content sharing does not postpone step 6. All references to an affected shared digest become
unavailable. Exact reacquisition under a still-authorized policy creates new delivery evidence; an
old tombstone is never removed or rewritten.

Crashes resume from the last durable step. Erasure and receipt insertion are idempotent. An absent
file with a matching committed tombstone is compliant; an absent file without one remains an
integrity incident. A present file after a committed erasure plan is a retention violation and
keeps the provider lane disabled.

### 9.4 Required vault-semantic and reconciliation changes

The ordinary vault adapter must consult the tombstone/use-denial index before `stat`, read,
reconciliation, replay, or derivation. A tombstoned artifact must fail closed before a file is
opened. Reconciliation must distinguish a verified retention tombstone from unexplained missing
content and must prove:

- every planned physical copy is absent;
- every affected logical reference is denied;
- no expired artifact remains readable;
- no deadline is overdue without a verified receipt; and
- the append-only stop-plan-attempt-receipt chain is complete.

This changes vault read/stat behavior and evidence-reconciliation semantics even though the frozen
ArtifactStore TypeScript interface need not gain a delete method. The migration, maintenance port,
path erasure, tombstone semantics, derived-use denial, reconciliation behavior, hard-kill behavior,
and memory/SQLite equivalence all require separate human authorization and fresh independent
review.

## 10. Required retention fault evidence

Before any PR 2F implementation can be accepted, the separately authorized retention work must
prove with synthetic bytes and both memory and SQLite backends:

- exact 3650-day expiry and one unit over;
- Alpaca stop at the exact 30-day deadline and one unit over;
- an earlier provider deadline winning;
- FMP use denial and erasure no later than its attested use-not-after/effective termination;
- immediate denial before physical deletion;
- crashes before and after every durable retention checkpoint;
- process hard-kill during every filesystem and SQLite boundary;
- shared-digest conservative erasure;
- content, staging, snapshot, and quarantine copy removal;
- active-reader and active-writer settlement;
- failure to settle remaining fail-closed;
- idempotent restart after the file is absent but before receipt commit;
- present-after-plan and absent-without-tombstone detection;
- no resurrection by replay, reconciliation, deduplication, or reacquisition;
- no provider byte, derived value, credential, token, account fact, or unsafe path in the journal,
  receipt, error, log, or CI evidence; and
- no asynchronous work after the controller returns.

Default CI remains offline, credential-free, and protected by a global network witness. No
retention test may use provider bytes or inspect a real account.

## 11. Authorization gate and decision

The proposed retention controller requires:

- a new maintenance port;
- a migration for the append-only retention journal and tombstone/use-denial index;
- controlled physical deletion beneath the vault runtime root;
- changed vault read/stat semantics for tombstoned content;
- changed evidence-reconciliation semantics; and
- new hard-kill, persistence, and platform evidence.

These are exactly the port, migration, reconciliation, and vault-semantic changes that the P1-10
authority reserves for renewed human authorization. No such implementation authorization is
recorded in this PR 2E contract.

Therefore:

```text
RETENTION_IMPLEMENTATION_AUTHORIZATION = HUMAN_AUTHORIZATION_REQUIRED
PR_2F_ENTRY = NO_GO
```

An independent PR 2E auditor must explicitly affirm or reject this conclusion. PR 2F may begin only
after the exact PR 2E candidate receives independent `GO`, the orchestration owner acknowledges
that checkpoint, and the human owner separately authorizes the exact retention architecture and
scope. A narrower authorization must be implemented narrowly. If the owner does not authorize the
required semantics, P1-10 remains in progress, P1-06 remains blocked, and no transport code or
provider witness may be started.

## 12. Deferred and prohibited scope

This contract does not authorize:

- a provider call or witness;
- account, credential, cookie, invoice, dashboard, plan, or subscription inspection;
- subscription, trial, upgrade, paid-feed, license, or account changes;
- incremental spending;
- arbitrary origins, paths, endpoints, query fields, headers, or provider SDK configuration;
- FMP production transport in the first PR 2F wave;
- public FMP evidence or FMP-derived output;
- credential, token, provider-byte, or provider-payload fixtures;
- edits to accepted PR 2D or P1-09 authority;
- event-study outcomes, P2 collection, or scientific-policy changes; or
- merge of PR 2E or PR 2F.

Any conflict between an implementation need and this accepted contract stops implementation and
returns to a new contract-amendment candidate and independent review.
