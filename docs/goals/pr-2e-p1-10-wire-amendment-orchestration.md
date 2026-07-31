# PR 2E P1-10 Alpaca wire-grammar amendment orchestration

Status: human-authorized timing-gate reproducibility repair in validation; PR 2F remains stopped

## Frozen base and preservation boundary

- accepted PR 2E candidate: `038fb381963cd822d2e7f81e55d45d26f1d2c9e5`
- accepted PR 2E tree: `d6fb3258c29c5b97f5cf7edab6d74c0d80386c16`
- amendment branch: `dev/pr-2e-p1-10-historical-sip-acquisition-contract`
- isolated amendment worktree:
  `C:\Users\HyPol\.codex\worktrees\ff4b\PEAS`
- stopped PR 2F checkpoint:
  `da6bc096215ca8e4047fcac10fec3c1357589a91`
- stopped PR 2F tree:
  `faa4d7bdaeb7c87c14b62aba9a51d9054fa1d825`

The stopped PR 2F worktree and its six untracked Lane E files are read-only throughout this
amendment. No amendment agent may inspect credentials or accounts, call a provider API, retrieve
market data, or edit that worktree.

## Authorized amendment

Freeze only the officially documented Alpaca historical multi-symbol quotes, trades, and raw
one-minute bars response grammar and its deterministic translation into the accepted
`RecordedMarketRecordV1` boundary. The amendment may add original synthetic fixtures, deterministic
doubles, contract tests, evidence mapping, and review records. It may not broaden any accepted
route, request field, feed, provider role, cost, threshold, port, migration, FMP, P1-06, P2, study,
or financial-effect authority.

If official Alpaca documentation is contradictory or insufficient for a material grammar or
translation decision, work stops rather than inferring provider behavior.

## Human-authorized narrowed disposition

Official-document mapping reached a human stop because the historical REST schemas do not prove
the mandatory PR 2D quote condition/halt/LULD state, general trade consolidated-Last state, or the
revision linkage for the documented trade update field. The owner subsequently authorized the
following exact narrowing:

- raw one-minute bars may translate to `RecordedMarketRecordV1` only when every mandatory accepted
  field is proven;
- schema-valid historical quotes remain bounded private-acquisition inputs but deterministically
  produce no record and enter the closed quote quarantine;
- schema-valid historical trades without the update field remain bounded private-acquisition
  inputs but deterministically produce no record and enter the closed trade quarantine;
- a historical trade with the update field terminates as `correction-unsupported`, with no
  revision edge, record, fact, replacement, mutation, or selection;
- quotes and trades never become fallback, alter bar selection, or contribute public output; and
- later quote/trade translation is deferred until adequate static authority and a separately
  accepted contract authorization exist.

This direction authorizes only the offline PR 2E amendment. It does not authorize provider calls,
credentials, account inspection, a new endpoint, FMP transport, spending, a witness, PR 2F,
P1-06, P2, outcomes, financial effects, or merge.

## Exclusive ownership

| Owner | Exclusive files |
| --- | --- |
| official-document evidence mapper | `docs/research/p1-10-alpaca-wire-grammar-authority.md` |
| grammar/translation contract owner | `docs/contracts/pr-2e-p1-10-alpaca-wire-translation.md` |
| original-synthetic fixture owner | `fixtures/market-acquisition/v1/wire-grammar/**`; amendment-only additions to `fixtures/market-acquisition/v1/README.md` and `fixtures/market-acquisition/v1/manifest.json` |
| executable acceptance owner | `docs/contracts/pr-2e-p1-10-wire-acceptance-matrix.md`; `test/p1-10-wire-translation-contract.test.ts` |
| integration/status owner | this orchestration record, draft PR metadata, amendment status evidence, and only predeclared project-board/roadmap status edits |
| independent external auditor | audit report only; no amendment edits |

Owners may read all accepted authority but may not edit files outside their exclusive assignment.
The integration owner resolves cross-file terminology after owners stop editing. Any material
contract, fixture, or executable-test change invalidates a prior audit decision.

## Pre-candidate integrity review and closure map

The integration checkpoint was deliberately reviewed before any candidate commit. No reviewed
candidate or external decision existed for these draft bytes. The following findings were repaired
under the same exclusive ownership boundaries and must be challenged again by the external
auditor:

| Finding | Closure |
| --- | --- |
| Page-local parsing could emit bars before the complete chain and could not resolve duplicate/conflicting bars across pages. | The journal now checkpoints verified raw pages only, returns zero for incomplete prefixes, parses only after a terminal chain, resolves every bar key chain-wide, and persists the complete outcome before return. |
| A trade `u` outcome did not stop later item parsing. | Any admitted `u` records terminal `correction-unsupported`, emits no record, and stops before a later page's items are parsed. |
| Returned-token history was ephemeral across restart. | The checkpoint persists raw private continuation material plus exact token hashes/history and independently reconstructs the chain on every load. |
| The private `wireRecordDigest` was under-specified and raw-spelling-sensitive. | The contract now freezes its domain, length framing, exact per-kind preimages, canonical UTC/decimal/integer forms, RFC 8785 key order, and private unprefixed encoding; the test uses a separate canonicalizer and framed-hash implementation. |
| Research prose conflicted with the exact bar record and overstated provider-example isolation. | The authority map now records `venueTapeId:null`, separates the reduced accepted bar-payload digest from the complete private wire digest, and states precisely that embedded examples were neither used nor copied even though containing public documentation bytes were hashed. |
| Pagination fixtures were catalogued without all literal operations executing, and trade ID was incorrectly treated as a stable duplicate/conflict identity. | Every one of 19 pagination/delivery operations executes; same-ID trades remain independent no-record quarantines with no record/sequence/revision identity. |
| The semantic invariance comparison omitted undisclosed neutral fields. | It retains every `RecordedMarketRecordV1` field except the two contract-authorized delivery-local fields, `rawArtifactId` and `memberKey`. |
| Hostile-object and tokenizer bounds were incomplete. | Proxy/cycle/accessor/sparse/inherited inputs reject inertly; depth, node, parser-token, key, array, text, token, page, aggregate, and fact ceilings have distinct exact/one-over proofs. |
| Persisted terminal outcomes and context were trusted without complete independent reconstruction. | Every load validates exact checkpoint shape, page bytes/digests, token continuity, endpoint kind, complete context identity, budgets, and recomputed terminal outcome in both memory and SQLite; only page-local `rawArtifactId` is excluded from context identity. |
| Only five of 50 grammar-fault fixtures were consumed, and two literal recipes contradicted their claimed boundary. | All 50 cases now execute every expanded literal operation. Bar negative/zero prices reject under the strict-positive grammar, and the grouped record recipe now totals exactly 10,000/10,001. |

## First external amendment review and bounded repair

Exact amendment candidate `add3bc99862eaa2998b3dee0bbc0004b4b5f1e23`, tree
`515d46a938023c52b031c51383ba6f315c255b3c`, passed the complete local sequence
and same-SHA GitHub Actions run `30587959302` (Windows `91023676959`, Ubuntu
`91023677016`, and scale-10k `91028992510` succeeded; the release-policy-only
scale-100k and reconciliation jobs skipped). The existing external audit task reviewed that exact
candidate in a fresh detached clean worktree and returned `CONTRACT_NO_GO`. The report is
immutable and identified these two findings:

| Finding | Authority and failure | Exclusive repair and claimed closure |
| --- | --- | --- |
| P0: `u` did not stop same-page item parsing. | The human-authorized disposition and this amendment require the first fully validated documented update marker to terminate `correction-unsupported`. The reviewed model validated every item before detecting `u`, so a malformed later same-page item overrode the terminal outcome as `schema-invalid`. | The executable owner changed descriptor-ordered traversal to return immediately after the first fully validated `u`, clear continuation, durably persist/reconstruct the terminal outcome, and reject a checkpoint containing any later page. Cartesian `canceled`/`incorrect`/`corrected` × first/middle/last vectors prove zero later same-item/symbol/page reads and zero record/replacement/selection/reversible state. |
| P1: nested hostile arrays and values could execute user code. | The accepted inert-rejection claim requires recursive zero getter/Proxy-trap execution. Array index descriptors, custom prototypes, extra properties, and nested Proxy values were not all rejected before access. | The executable owner added passive-Proxy-first recursive descriptor admission; exact array prototype, length, dense own data indexes, and no extra/symbol/accessor properties; descriptor-only child reads; and zero-call nested accessor/Proxy tests. The fixture owner added an original-synthetic 8-case/10-recipe hostile-atomicity catalog, and the matrix owner lists and executes every literal recipe. |

The repair changes only the same authorized contract, original-synthetic fixture, executable-test,
and integration-status paths. It adds no provider call, credential access, production transport,
provider payload, migration, port, FMP implementation, outcome, financial effect, or PR 2F change.
The first focused integration rerun passed `26/26`; complete same-SHA local and hosted evidence
must be regenerated after the new repair candidate is frozen. A fresh whole-package re-review by
the same external task remains mandatory.

## Recurring P0 review and sole authorized repair

Exact repaired amendment candidate `1bdfe46947be842655bc630556163fc2c24f342e`, tree
`ef0c66ef079bd0cef06b014bfc2f89039d95911a`, preserved every accepted authority byte and passed
the complete same-SHA local and hosted matrix. The same independent external audit task nevertheless
returned `CONTRACT_NO_GO` with `SAME_MATERIAL_FINDING_RECURRENCE`:

1. `admitPage` traversed symbol groups in JSON insertion order instead of canonical requested-symbol
   unsigned-UTF-8 order, so reversing two properties allowed malformed later-canonical input to
   override a canonical-earlier fully validated `u`; and
2. `runChain` recursively modeled and encoded the complete semantic page before the terminal scan,
   so a hostile later item could reject the integrated path before the valid `u` was observed.

The immutable external report remains in task
`019f9dbb-d604-75c2-9447-18044f9b5c91`. Human direction subsequently authorized exactly one
bounded repair/re-review cycle for this recurring P0. Sole repair ownership is limited to:

- canonical unsigned-UTF-8 descriptor traversal independent of JSON property order;
- a verified-raw-text chain boundary that performs no whole-page semantic modeling or encoding
  before the terminal scan; and
- exhaustive original-synthetic direct/integrated, uninterrupted/every-prefix, memory/SQLite
  evidence across every `canceled|incorrect|corrected` and `first|middle|last` placement, reversed
  group order, malformed/getter-hostile/Proxy-hostile later-canonical items or groups, and exact
  zero later-output/mutation/getter/trap counters.

The accepted wire contract already requires those semantics and remains byte-identical. This
repair changes only the executable model and its acceptance/status evidence. If the same P0 recurs,
if any new material finding requires authority beyond those three items, or if exact same-SHA
evidence cannot be proved, work stops for human direction with no further repair.

## External recurrence re-review and timing-gate repair

Exact sole recurrence-repair candidate `8f21b13b7d3ad837b89d715b625cc8db0dea6a1d`,
tree `956de717f36294a114193d21c540f3d648b2b4ee`, closed the recurring wire P0. The existing
independent audit task reproduced the focused wire suite `27/27`, the combined P1-10 suite `53/53`,
and all 27 original-synthetic vectors / 162 integrated memory/SQLite restart runs. It found no
recurrence, accepted-contract change, provider scope, or new wire-authority need.

The immutable final report nevertheless returned `CONTRACT_NO_GO` because the complete Windows
coverage gate could not independently reproduce the unrelated legacy 300-cluster timing assertion
in `test/audit.test.ts`. Two complete coverage runs measured `19,998 ms` and `15,204 ms` against
the unchanged `<15,000 ms` bound. The identical isolated test passed in `10,631 ms`, an earlier
unchanged full-wrapper run passed in `8,684 ms`, and same-SHA hosted Ubuntu and Windows were green.
The report therefore classified this as host-load-sensitive wall-clock evidence, not a functional
wire-contract failure, but correctly blocked merge and PR 2F because the required complete local
same-SHA gate was not reproducible.

The human owner subsequently authorized one new repair limited to that timing-gate
non-reproducibility. The repair may:

- retain the exact `15,000 ms` processing-work bound while replacing scheduler-contaminated wall
  time with narrowly equivalent process CPU time;
- retain wall elapsed time as an explicit diagnostic and expose whether host delay crossed the
  unchanged CPU budget;
- add a focused regression proving that external wall delay does not pass a true CPU overage; and
- update only the timing test and bounded status/evidence metadata.

It may not inflate, weaken, skip, delete, or bypass the performance assertion; alter production
code or accepted contract bytes; conceal host-load sensitivity; or broaden any provider, route,
field, capability, cost, migration, port, P1-06, P2, outcome, financial-effect, or PR 2F scope.
The complete clean-process isolated, full-file coverage, full repository coverage/check, hosted
Ubuntu/Windows/10k, accepted-byte, and PR 2F proofs must be regenerated at one new exact candidate.
If the same timing failure recurs after this repair or any broader authority is required, work
stops for human direction.

## Validation and review sequence

1. Preserve the immutable `8f21b13b...` `CONTRACT_NO_GO` report and all accepted wire bytes.
2. Run the focused timing-policy regression, clean-process isolated scale gate, full audit-file
   coverage, and complete offline repository gates.
3. Freeze a clean candidate SHA and tree.
4. Push only the amendment branch and require same-SHA Ubuntu, Windows, and scale evidence.
5. Submit the entire exact candidate exactly once to external audit task
   `019f9dbb-d604-75c2-9447-18044f9b5c91`.
6. Require a binary decision on the complete package. A repeated timing failure, recurring wire
   P0, or new material finding is a stop condition.
7. On `CONTRACT_GO`, verify local head, remote head, reviewed SHA/tree, and CI SHA are identical,
   then stop for human merge authorization. Do not merge.
