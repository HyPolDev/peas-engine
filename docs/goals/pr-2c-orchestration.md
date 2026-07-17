# PR 2C contract-and-fixture orchestration

- Status: Active
- Branch: `dev/pr-2c-recorded-mirrors`
- Base: `origin/main` at `41f19b83e104857ed32b45fa5838c8199f5467ab`
- Base evidence: merge commit for pull request #3, recorded SEC end-to-end
- Outcome: draft pull request; do not merge

## Objective

Deliver the recorded/offline contract and fixture gate for Financial Modeling Prep press releases
and the NVIDIA investor-relations press-release RSS adapter. Preserve independent SEC, FMP, and
issuer-IR source provenance while making mirror, correction, revision, timestamp, observation, and
replay semantics executable and reviewable.

## Isolation and baseline

The integration branch was created from the exact base above in the isolated worktree
`C:\Users\HyPol\AppData\Local\Temp\peas-pr2c-recorded-mirrors`. The pre-existing checkout was dirty
on a PR 2B branch and was not cleaned, staged, reset, reused, or modified.

Phase 0 read the complete ADR set, roadmap, project board, PR 2B orchestration and implementation
prompts, provider evidence-bundle and SEC contracts, the SEC normalizer, the recorded loader, and
the recorded acceptance tests. The clean-base checks were:

- `npm.cmd run format:check` — passed;
- `npm.cmd run lint` — passed;
- `npm.cmd run typecheck` — passed;
- `npm.cmd run build` — passed; and
- the compiled provider-evidence, SEC-normalizer, and recorded-SEC acceptance suites — 38 passed,
  0 failed.

## Contract gates

1. Three independent analysts research the official FMP contract, the official NVIDIA IR RSS and
   linked-release structure, and the provider-neutral observation/clock ledger.
2. The integration owner reconciles their reports into ADR 0008, ADR 0009, the fixture-manifest
   specification, reason-code table, acceptance matrix, and provider/source identity table.
3. A fresh read-only reviewer audits deterministic identity, provenance, mirrors, bounds, replay,
   timestamps, redistribution, effect isolation, and frozen-port compatibility. Implementation
   begins only after a binary `GO`.
4. Fixture/test writers use non-overlapping ownership for FMP, NVIDIA IR, and cross-source replay
   cases. Checked-in provider bodies are synthetic unless redistribution approval is explicit.
5. A final independent audit and the complete repository gate precede an intentional commit,
   push, and draft pull request.

Any `NO_GO` returns exact findings to the relevant owner and repeats review after repair. The loop
stops only for a decision that would change provider identity, licensing, frozen ports, or scope.

Contract review reached `GO` on the eighth fresh pass. The complete review trail and resolved
finding classes are recorded in [`pr-2c-contract-review.md`](pr-2c-contract-review.md).

## Binding boundaries

- Recorded/offline execution only; tests must not reach the network.
- No HTTP client, polling loop, credentials, committed API keys, Docker change, LLM, market-data,
  broker, portfolio, trading, or financial-effect code.
- No frozen kernel or `ArtifactStore` port change.
- URLs, credentials, arbitrary headers, retrieval times, and observation IDs are excluded from
  deterministic domain and evidence-bundle identities.
- Identical bytes from different providers may share one artifact digest but remain independent
  observations with independent provider provenance.
- Byte-different corrections or revisions have deterministic new source revision identities.
- Every manifest, collection, parser, transcript, and ledger schema has explicit item, byte, depth,
  token, and string limits with exact and one-over tests where executable.

## Publication gate

The branch may be pushed and a draft pull request may be opened only after the final audit returns
`GO`, intentional files are reviewed, and validation confirms no live HTTP surface, secret,
financial effect, frozen-port change, or fixture licensing violation. The pull request must remain
unmerged.

That gate is satisfied: the fresh independent final audit returned `GO`; format, lint, typecheck,
and build pass; and the final focused compatibility run passed 69 tests with zero failures. Source
inspection found no live HTTP/polling surface, credential, financial effect, Docker change, or
frozen kernel/`ArtifactStore` port change. All checked-in FMP and NVIDIA bodies are synthetic.
