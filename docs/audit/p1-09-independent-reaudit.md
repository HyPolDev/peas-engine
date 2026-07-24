# P1-09 independent re-audit

## Candidate

- Branch: `codex/p1-09-owner-authorization`
- Candidate commit: `ce92cb46e3fd9957f9b9c6834bb8217a2c987ac5`
- Review mode: fresh independent, review-only
- Decision: `NO_GO`

The reviewer verified that the specified worktree was clean and matched the candidate commit.

## Original-finding adjudication

- Exact endpoint allowlist: materially repaired, but identity-preimage reproducibility remained
  incomplete.
- Retention and termination: repaired.
- Superseded language: partially repaired, but one stale status table remained ambiguous.

## Findings

### P1-09-REAUD-001 — identity preimages were not fully reproducible

The candidate listed exact IDs and routes but described dataset/feed/endpoint preimages in prose.
It did not publish every exact inert field required to recompute all provider, dataset, feed, and
endpoint-channel identities, including `safeRouteLabel`, documentation version, pagination kind,
and `factKinds`.

Required remediation:

- publish canonical JSON preimages for every listed `mpv1_`, `mds1_`, `mfd1_`, and `mec1_`;
- verify every identity with the accepted PR 2D derivation functions; and
- keep URLs outside identity preimages.

### P1-09-REAUD-002 — FMP capability status was overbroad

The exact allowlist authorized only Aftermarket Quote and Aftermarket Trade, while the capability
matrix broadly marked FMP Premium market endpoints `GRANTED`, including additional reported
surfaces.

Required remediation:

- replace the broad row with route-specific capability rows; and
- mark every other FMP surface `NOT_AUTHORIZED`.

### P1-09-REAUD-003 — a stale pending-status table remained ambiguous

The Alpaca public-document identity table still labeled historical `feed=sip`,
`v2/delayed_sip`, and latest-endpoint `delayed_sip` as `PENDING`, conflicting with the frozen
current decision.

Required remediation:

- replace those values with the frozen PEAS statuses or label the entire table as historical.

## Positive checks

The reviewer confirmed:

- explicit `feed=sip` and the 15-minute boundary;
- exactly three Alpaca and two FMP routes;
- fail-closed treatment of unlisted routes;
- bounded retention and termination rules;
- zero spending, privacy, no fallback, and no NBBO substitution;
- private-only FMP discrepancy use;
- correct owner-risk labeling;
- P1-10 and P2 remained blocked; and
- no private correspondence, credential, account identifier, or provider payload entered Git.

## Binary decision

`NO_GO`

P1-09 remained open and P1-10 remained blocked pending repair and fresh independent re-audit.
