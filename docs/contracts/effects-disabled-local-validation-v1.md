# Effects-disabled local-validation manifest and automation contract V1

Status: implementation contract, corpus execution separately authorized  
Published baseline: `3084f4362fb94a62f1ff0ddd416b3957484d3893`  
Published baseline tree: `19a9a0f40c6d6a37d4237e322c8f18950673170f`  
Corpus manifest: `config/local-validation/manifest.v1.json`  
Manifest digest: `3f5a3d8a0f9975c7bc231cca5d55fdf4beabc593c7252e7b5d24b73c32faedd8`

## Scope and authority

This contract defines the offline automation required before the effects-disabled local-validation
milestone may be run. Its 216 cases are unique original-synthetic software-validation identities.
They are not issuer identities, observed releases, P2 `StudyManifest` members, or the later exact
180 prospective earnings clusters. This work does not authorize provider access, issuer selection,
prospective recording, P1-03, P1-04, P1-06, or P2.

The accepted fail-closed authority rule is immutable. The owned explicit first-boot path may create
the authority anchor only when the complete runtime layout is absent and no primary acquisition or
retention state exists. If any primary SQLite state, artifact content, snapshot, or quarantine state
exists while the authority anchor is missing, the only disposition is terminal corruption. Neither
the gate nor a restart may reconstruct authority from mutable primary records.

The final corpus command is disabled until the owner supplies the exact separate authorization
value documented below. Implementation tests exercise only two-case probes and manifest/matrix
generation; they do not execute the frozen 216-case corpus.

## Immutable corpus

The source matrix is `config/local-validation/matrix.v1.json`. The committed canonical compiler is
`scripts/local-validation/compile-manifest.mjs`. Compilation produces 216 explicit case objects
(18 categories times 12 variants), each with a unique case ID and SHA-256 identity, fixture identity,
fixture SHA-256 and exact canonical byte size, deterministic seed, expected terminal disposition,
backend set, order/page/duplicate/correction/terminal permutation, and every durable restart prefix.

The categories and terminal dispositions are:

| Category | Expected terminal disposition |
| --- | --- |
| accepted | `accepted` |
| missing | `terminal-missing` |
| malformed | `terminal-malformed` |
| duplicate | `accepted-deduplicated` |
| corrected | `accepted-corrected` |
| quarantined | `terminal-quarantined` |
| terminal-page | `terminal-page-complete` |
| expiry | `terminal-expired` |
| erasure-reappearance | `terminal-erased` |
| stop-race | `terminal-stopped` |
| page-chain-invalid | `terminal-page-chain-invalid` |
| lineage-mismatch | `terminal-corruption` |
| ownership-denied | `terminal-denied` |
| receipt-revalidation | `terminal-erased` |
| clock-regression | `terminal-clock-invalid` |
| quota-exhausted | `terminal-budget-exhausted` |
| deadline | `terminal-deadline` |
| authority-corruption | `terminal-corruption` |

`npm run manifest:local-validation` recompiles in memory, compares exact canonical bytes, verifies
the committed digest file, enforces at least 200 unique IDs, and rejects any drift. Corpus edits after
evidence begins invalidate all evidence.

## Exact candidate and execution identity

Every candidate or evidence run must set both `PEAS_LOCAL_VALIDATION_CANDIDATE_SHA` and
`PEAS_LOCAL_VALIDATION_CANDIDATE_TREE`. The gate compares them with `HEAD` and `HEAD^{tree}` and
rejects a mismatch or any tracked/untracked non-ignored worktree byte. Evidence records:

- executable commit and tree;
- `package-lock.json` digest and exact `package.json` Node/npm constraints;
- actual Node, npm, `better-sqlite3` SQLite, OS type/release/build, architecture and logical CPU count;
- timezone plus the trusted monotonic clock basis and diagnostic-only wall-clock basis;
- every ordered SQL migration path, size and SHA-256;
- matrix, manifest, digest-file, schema, runtime-root and evidence-format identities.

The supported runtime is the repository-pinned Node `24.17.0`, npm `12.0.0`, locked dependencies,
Windows or Linux, and the SQLite version reported by the locked `better-sqlite3` binary. A different
identity is a new candidate and receives new evidence.

## Runtime root and exclusive ownership

The gate obtains an exclusive `wx` lock before provisioning. A live owner or unexpired lock rejects
the run. A stale lock is recoverable only when its PID is absent and its six-hour bound has expired;
malformed lock state fails closed. Release is idempotent.

Each run creates one isolated temporary `PEAS_RUNTIME_ROOT`. Its exact layout is:

```text
PEAS_RUNTIME_ROOT/
  sqlite/
    local-validation-authority.json
    local-validation.sqlite
  artifacts/
    sha256/
    staging/
    snapshots/
    quarantine/
    locks/
  evidence/
```

No shared or pre-existing provider/account root is accepted. SQLite runs in WAL mode and must pass
`PRAGMA integrity_check`. The root is removed after settlement; evidence is written outside it.

## Effects and network prohibition

Before the first case, the child process preloads `network-deny.cjs`. It denies `net`, TLS, HTTP,
HTTPS, UDP, DNS and global `fetch`; a deliberate `.invalid` probe must be rejected with the owned
denial code. The worker refuses to start without the installed marker. The parent and worker reject
all PEAS/Alpaca/FMP credential environment variables before reading case data.

The exact accepted totals are zero for network, provider, credential, account, broker, order,
portfolio, position, fill, spending and financial-effect activity. There is no broker/order surface
in this composition. Any nonzero counter is terminal `LOCAL_TEST_NO_GO`.

## Deterministic matrix, restart and hard-kill generation

Every case executes in memory and SQLite and compares canonical semantic bytes after removing only
the backend label. Case order is canonical, reverse or SHA-256-seeded shuffle. Page sizes are exactly
1, 2, 7 and 31. Duplicate, correction and terminal-first/terminal-last variants are frozen per case.

Every case generates a restart reproduction from each of these durable prefixes:

1. layout validated; authority anchored; acquisition declared; request started; attempt started;
2. page artifact committed; page proof verified; page ledger committed;
3. normalization committed; derived lineage registered; ownership registered;
4. provider denial committed; tombstone committed; erasure attempt committed; erasure receipt committed;
5. receipt revalidated; reconciliation plan committed; quarantine action committed;
6. reconciliation receipt committed; terminal committed.

Every case also generates the approved hard-kill matrix around credential claim-before-read, writer
lease claim/renewal/release, artifact link and commit/source-removal, ownership, denial, erasure
attempt and receipt-version commit, quarantine last-copy link, and reconciliation action commit. A
later authorized corpus run must execute all 4,320 prefix reproductions and generate all 2,592
hard-kill vectors. No restart may advance from an unverified prefix, and all terminal canonical
bytes must match the uninterrupted execution.

## Reconciliation and resource decisions

For every case the gate reconciles exact set counts and hashes for ledger rows, artifact identities,
page proofs, normalized facts, derived lineage, retention ownership, provider denials, tombstones,
unique physical `(digest, attemptOrdinal)` erasure attempts, versioned erasure receipts, quarantine
actions and physical copies. Existing receipts trigger absence/denial revalidation. Duplicates may
not create a second physical effect. Stop and terminal facts prohibit later-item access or mutation.

The exact ceilings and one-over rejection vectors are embedded in the manifest. They cover 15,000 ms
processing CPU, diagnostic 120,000 ms wall time, RSS, heap, runtime storage, open handles, workers,
timers, streams, readers, leases, fences, active retention operations and cleanup latency. The
15,000 ms CPU bound remains normative; wall time is retained only as host-isolation diagnostics.
At settlement the exact required counts are zero orphan processes, workers, leases, SQLite fences
and active retention operations. A value equal to its maximum passes; maximum plus one fails.

## Commands and evidence

The commands are:

```text
npm run manifest:local-validation
npm run gate:integration
npm run gate:local-validation
npm run evidence:bundle
npm run evidence:verify
```

`gate:integration` runs a two-case offline probe of manifest, denial, first boot, memory/SQLite,
reconciliation, resource and cleanup machinery. `gate:local-validation` is the 216-case corpus gate
and requires all of:

```text
PEAS_LOCAL_VALIDATION_AUTHORIZATION=EXECUTE_FROZEN_EFFECTS_DISABLED_LOCAL_VALIDATION_V1
PEAS_LOCAL_VALIDATION_CANDIDATE_SHA=<exact frozen SHA>
PEAS_LOCAL_VALIDATION_CANDIDATE_TREE=<exact frozen tree>
```

`evidence:bundle` does not run the corpus. On one clean exact candidate it runs manifest validation,
the integration probe, formatting, lint, typecheck, build, unchanged unit/integration/restart tests,
coverage, reconciliation, mutation, hard-kill, scale, and the unmodified `npm run check`. It stores
the exact command, exit code, signal, elapsed time and complete stdout/stderr transcript. The bundle
also contains platform identity, candidate identity, input/migration digests, effects totals, a
complete regular-file inventory, per-file sizes and hashes, an inventory hash and root bundle hash.
`evidence:verify` recalculates all hashes and rejects missing, added, changed, linked or non-regular
content.

The corpus decision procedure returns exactly one JSON decision. `LOCAL_TEST_GO` requires the exact
candidate/manifest, all 216 cases, memory/SQLite equivalence, every prefix and hard-kill vector,
SQLite integrity, reconciliation equality, all ceilings, zero effects and zero orphans. Every other
outcome is `LOCAL_TEST_NO_GO` with a nonzero exit. There is no warning or partial-success state.

At this milestone stopping gate, only a clean automation-evidence `GO` is permitted. The corpus must
remain unexecuted until the owner separately authorizes the exact command and frozen SHA/tree.
