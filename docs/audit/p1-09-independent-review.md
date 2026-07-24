# P1-09 independent review

## Candidate

- Branch: `codex/p1-09-owner-authorization`
- Candidate commit: `d034b5e5d6632d6a1e875fa6b0221d1c8185c92d`
- Review mode: fresh independent, review-only
- Decision: `NO_GO`

The reviewer verified that the specified worktree was clean and matched the candidate commit.

## Findings

### P1-09-AUD-001 — exact endpoint policy was not frozen

The owner record froze the provider, product, Alpaca historical REST `feed=sip`, and timing rule but
did not enumerate exact endpoint/path/version identities for every approved lane. The accepted
provider/source contract requires an explicit `endpointChannelId` per capability.

Required remediation:

- enumerate exact provider, product, dataset, feed, endpoint/path/version, fact, allowed use, and
  status for every approved lane; and
- require P1-10 to reject every endpoint outside that allowlist.

### P1-09-AUD-002 — Alpaca retention duration was not fixed

The owner authorization allowed retention without a fixed expiry. The P1-09 exit conditions require
a fixed duration or formally bounded termination rule covering account closure, subscription
termination, owner revocation, contrary guidance, and project-classification change.

Required remediation:

- define an explicit maximum duration and bounded deletion/cessation deadlines for every stop
  trigger.

### P1-09-AUD-003 — superseded pending language remained operationally contradictory

Historical public-document findings still said account-specific confirmation was required before
P1-10 and that FMP private capture/replay/aggregate publication remained pending. Those statements
conflicted with the later owner-approved residual-risk decision.

Required remediation:

- label the original statements as superseded historical findings;
- remove them as operative preconditions; and
- retain the narrower owner-approved status without mislabeling it as provider-granted.

## Positive checks

The reviewer confirmed:

- owner attribution is recorded;
- FMP is discrepancy-only and no-fallback;
- one-minute FMP use and public FMP-derived outputs are prohibited;
- zero incremental spending is binding;
- raw data and credentials remain private;
- P1-10 and P2 remain blocked;
- ADR/source identities and frozen ports are preserved; and
- no personal correspondence, email address, credential, account identifier, or provider payload
  appears in the candidate.

## Binary decision

`NO_GO`

P1-09 remained open and P1-10 remained blocked pending repair and fresh independent re-audit.
