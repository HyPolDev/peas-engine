# Effects-disabled local-validation manifest and automation contract V1

Status: implementation contract; corpus execution requires separate authorization

Published baseline: `3084f4362fb94a62f1ff0ddd416b3957484d3893`

Published baseline tree: `19a9a0f40c6d6a37d4237e322c8f18950673170f`

Frozen corpus: `config/local-validation/manifest.v1.json` and its adjacent SHA-256 file

## Scope and authority

The manifest freezes 216 unique, project-authored, offline software-validation test identities. It
does not contain issuers, observed earnings, provider records, or the later 180 prospective earnings
clusters. This milestone does not authorize provider access, prospective recording, P1-03, P1-04,
P1-06, or any financial effect.

The authority rule is fail-closed. The explicit PEAS-owned first-boot path may create
`sqlite/local-validation-authority.json` only when no durable content exists below `sqlite/` or
`artifacts/`. Any file or directory entry—including staging, locks, snapshots, quarantine, or a
future layout addition—with a missing anchor is terminal corruption. An existing anchor must bind
the exact candidate SHA and tree.

## Exact executable manifest

The canonical compiler discovers repository `test/**/*.test.ts` files, excludes local-automation
self-tests and named provider suites, extracts literal `node:test` identities, prioritizes the
durability/equivalence/resource/effects cases, and freezes exactly 216 selectors. Each case contains:

- a unique case ID and identity SHA-256;
- category and expected terminal disposition;
- exact TypeScript source path, compiled JavaScript path, test name and anchored regex selector;
- source-file SHA-256, byte size and media type;
- a deterministic per-case seed.

The five categories are `accepted-behavior`, `accepted-idempotence-or-revision`, `quarantine`,
`retention-erasure`, and `fail-closed-rejection`. Dispositions are `accepted`,
`accepted-deduplicated`, `accepted-corrected`, `terminal-quarantined`, `terminal-erased`, and
`terminal-denied`. They are derived deterministically from the executable test identity; the test's
production assertions remain authoritative.

`executableCoverage` names the exact case IDs that execute memory/SQLite equivalence, restart and
recovery, hard kills, page sizes, duplicate delivery, corrections/revisions, terminal behavior,
reconciliation, exact/one-over resource bounds, ownership, erasure/tombstones and quarantine.
Manifest verification rejects an empty required coverage class or fewer than three physical
hard-kill test identities. The order permutations are canonical, reverse, and SHA-256 seeded; page
sizes are 1, 2, 7, and 10,000. The durable prefixes and approved hard-kill points are immutable
manifest inputs. The runner does not manufacture expected PEAS rows or multiply coverage claims.

`npm run manifest:local-validation` recompiles the manifest, compares its exact canonical bytes,
verifies the adjacent digest, enforces 216 unique identities, re-hashes every source fixture and
checks all required coverage classes.

## Candidate and platform identity

Corpus and evidence commands require `PEAS_LOCAL_VALIDATION_CANDIDATE_SHA` and
`PEAS_LOCAL_VALIDATION_CANDIDATE_TREE`. Both must equal clean `HEAD`/`HEAD^{tree}`. Evidence records
the exact package lock, Node/npm constraints and actual versions, SQLite version, ordered migration
inventory and hashes, OS/release/architecture, timezone and monotonic/diagnostic clock basis.

Every run atomically acquires an exclusive `wx` gate lock. A stale owner is recovered by atomically
renaming the observed stale inode to a unique quarantine name before retrying, so concurrent
recoverers cannot unlink a new live claim. Malformed, live, or unexpired locks fail closed.

The gate creates one temporary `PEAS_RUNTIME_ROOT` containing `sqlite/`, `artifacts/{sha256,staging,
snapshots,quarantine,locks}/`, and `evidence/`. It is removed only after child settlement.

## Denial and effects accounting

Before an executable case loads, Node preloads `network-deny.cjs`. It denies TCP, TLS, HTTP/1,
HTTP/2, UDP, DNS, fetch and WebSocket entry points. Shell execution is denied. Only Node child
processes carrying the same preload capability may be created, which permits owned hard-kill
workers without creating an outbound escape. Built-in ESM exports are synchronized after patching.
A deliberate `.invalid` probe must produce `PEAS_NETWORK_DENIED` before case execution.

The parent and worker reject all enumerated credential/account variables. Executable source paths
are provider-suite-free, `PEAS_EFFECTS_ALLOWED=false`, and production effect-policy tests are part of
the frozen corpus. Successful network, provider, credential, account, broker, order, portfolio,
position, fill, spending and financial-effect totals must all be exactly zero. Denied attempts are
reported separately and do not count as activity.

## Execution, restarts, hard kills and resources

`gate:integration` compiles the production and test artifacts and runs two real acceptance selectors
under the denial boundary. It is not the corpus. A separately authorized corpus runs all 216 exact
selectors in canonical, reverse and seeded order. Each invocation must exit zero with exactly one
selected test pass; the transcript is hashed. The selected production tests themselves execute the
memory/SQLite, pagination, duplicate, correction, restart-prefix, reconciliation, retention,
ownership, erasure, quarantine, physical-copy and integrity assertions identified by
`executableCoverage`.

The hard-kill gate executes the frozen hard-kill test selectors. Those tests spawn and terminate
owned worker processes at their real durable checkpoints and prove recovery. The automation reports
only executed selector identities and transcript hashes; it never substitutes serialized objects or
multiplies one kill by the corpus size.

CPU, diagnostic wall time, RSS, heap, runtime storage and handle classes are sampled from the runner.
Child PIDs are checked after settlement. Exact/one-over bound proof identities come from the executed
production tests. In addition, every automation ceiling is passed at its exact maximum and invoked
again at maximum plus one through the same `enforceResourceCeilings` decision function; the latter
must throw that ceiling's exact rejection. At the terminal decision there must be zero
orphan child PIDs, extra workers, leases, SQLite fences and active retention operations. A failed
production assertion, ceiling, cleanup, integrity or effects check is `LOCAL_TEST_NO_GO`.

## Evidence and decision

Commands:

```text
npm run manifest:local-validation
npm run gate:integration
npm run gate:local-validation
npm run evidence:bundle
npm run evidence:verify
```

The corpus command additionally requires:

```text
PEAS_LOCAL_VALIDATION_AUTHORIZATION=EXECUTE_FROZEN_EFFECTS_DISABLED_LOCAL_VALIDATION_V1
```

`evidence:bundle` never runs the corpus. On one clean candidate it runs manifest validation,
integration, format, lint, typecheck, build, the unchanged unit/integration/restart package,
coverage, reconciliation, mutation, hard-kill, scale and the unmodified `npm run check`. It records
all commands, exit codes, signals, elapsed times and transcripts, plus platform/input/migration
identity, the real integration proof, and effects totals.

`evidence:verify` requires the complete ordered command set, zero exits, null signals/errors, the
exact current clean SHA/tree, exact manifest/package-lock/matrix/migration/platform identities, a
two-case real integration proof, zero effects, `corpusExecuted=false`, a complete regular-file
inventory and every file/root hash. Missing, added, changed, linked, forged, stale or partial bundles
are rejected.

There is no partial success. The authorized corpus returns one machine-readable `LOCAL_TEST_GO` only
after every frozen executable and terminal invariant passes; every other outcome is
`LOCAL_TEST_NO_GO`. This milestone stops before that corpus and requests separate authorization for
the exact frozen SHA/tree.
