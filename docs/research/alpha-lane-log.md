# Lane A execution log

2026-09-11: Read complete authorization and PM decisions. No applicable AGENTS.md found.
Fresh fetch verified base fc364fff482131473588c7acb9a1b438ef8bdb59,
tree dfdc1c729a3bff7664094af7ce4e7f7b66b563d7; no open PRs.
Sole implementation owner: Lane A; independent reviewer will be assigned at frozen candidate.

## Protocol freeze (before any synthetic evaluation)

`fixtures/alpha-research/protocol.v1.json` freezes H1 continuation/reversal, H2 observed usable
source order with 1-second simultaneity, six horizons, 1-minute delayed entry, per-side
2 bps spread + 3 slippage + 1 fee, zero impact assumption, equal SPY/sector benchmark,
January train / February validation / March 2026 untouched test. Labels crossing the next
partition boundary are purged, including terminal test labels. Every event/horizon/variant
is retained, including missing, excluded, purged and failed high-threshold trials.
Synthetic cohort uses SYN only; stopped and repair events are excluded visibly. No imputation.
Expectations unavailable; LLM disabled. Capacity unknown, no tradability inference.
No parameter changes after results without PM human gate. Numerical fixtures are correctness
oracles, not statistical evidence. Only SYNTHETIC_VALIDATION / NO_TRADE permitted.

No provider, credential, financial, live-controller or merge authority. No recurring jobs.

## Implementation and independent review preparation

Provider-free implementation adds content-addressed manifest/snapshot, feature/label/trial/signal
records and SQLite registry migration 011. Original normalized events are verified and retained;
SEC clocks use the existing DST-aware parser. Research decimal encoding leaves kernel JSON intact.
Initial six focused tests passed; additional rollback/missing-endpoint tests passed in full suite.
One independent reviewer found a member-identity compatibility defect: identical raw artifact
bytes may belong to SEC and IR independently. Repaired joins to lane/provider/record/revision keys,
with a shared-bytes availability regression. Reviewer confirmed that finding resolved read-only.
Added INSERT OR REPLACE guards so SQLite replacement cannot bypass append-only invariants.
Full final checks and frozen-head CI/review remain required before terminal disposition.

## Synthetic evidence (final source, separate compilation)

Nine focused tests passed. Separate-process SQLite replay returned identical result bytes.
Protocol ID: b9f9edfcddb310dcc36bc2420b6242cd51257b131c700952845ac21f793a2334.
Manifest ID: ea13c8aa398437d341834e7edd1d72bd016d5abc70b98125fd3e96cee2d5500d.
Evaluation ID: fc2f0f7441751059896445533557fb273ecc9ec4717c53422e70094f6c73f102.
Four inputs produced 4 features, 24 labels, 96 trials (36 failed), and 96 partition/horizon signals.
Result bytes SHA-256: 34aaf86646e54e0ff078421f8c2926ec4929d2af67c984317b451bd7980a362c.
Artifacts retained outside repository at C:/Users/HyPol/alpha-research-evidence/.
All results remain SYNTHETIC_VALIDATION / NO_TRADE. These counts are correctness evidence only.
Final source-clock boundary check rejects malformed numeric/civil input even when an external
snapshot has a consistent content/state hash. Ten focused tests now pass; synthetic result
identities are unchanged. Frozen protocol parsed-content equality with 6d47226821e1f3729c82167062cf7de77bd48ce7 was verified.

## Failed integration gate and isolated storage repair

The initial full local suite completed with seven migration-integration failures. Appending research
DDL as operational migration 011 invalidated the explicitly pinned ten-migration credential schema
and a retention upgrade assertion. The repair moves research DDL to
migrations/research/001_alpha_research.sql and opens a separate research database with the existing
SQLite runner. Operational migrations and credential code are unchanged. This supersedes earlier
migration-011 notes and requires no protocol or provider authority change. The old draft-head CI
run 34611011090 was cancelled; new exact-head checks and independent review remain required.
The isolated-storage repair passed all 94 targeted research/adapter/credential/retention tests,
including all seven former failures. A fresh dedicated synthetic-isolated.sqlite database was
created and reopened in a separate process; manifest/evaluation/result identities above are
unchanged. The operational directory still contains exactly ten migrations, and research has its
own single migration. No operational credential or provider implementation was modified.

## Canonical signed-zero repair

A direct invariant probe found identity(-0) differed from identity(freeze(-0)). This could make a
flat-return reversal's trial ID non-recomputable from returned fields. Signed zero now normalizes
to numeric zero before canonical hashing. The regression checks both freeze identity-idempotence
and all flat-return trial IDs. This is serialization correctness, not a protocol or result-driven
parameter change. The sole reviewer independently confirmed the repair requirement. CI run
34612904282 was cancelled before superseding its head. The healthy full local regression run
continues; final exact-head CI will be authoritative for the one-line serialization repair.
