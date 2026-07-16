# Golden change log

Golden vectors are reviewed behavioral evidence. They must never be updated solely to make a test
pass.

## Earnings cluster V2: reducer 2.1.0 -> 2.2.0

- Event head: unchanged at `f8dfdb7463a99bbbc02f743c5ce9a44d3e86d396af6d8840ad5a17a78b5c40a2`
- Previous state head: `20a44b5b48abb56e3d6d94d1f2e1f1923bef5a4d5c1e20e4f8353591b2e4f3a1`
- New state head: `367f028726824a36859c5a5a6694804173581ccc4ba935984744257ba9b32a6c`
- Previous decision head: `e3bf7b1288bd7601afeb98865812c40736a081c2faa09b3be9c587ebbaa76466`
- New decision head: `c7f1e64abf42673241d10d6218ec7b4e5412bc5c4c24b5b3673ccea79ba95453`

Reason: reducer 2.2.0 makes the intended 32-source and 32-analysis-branch bounds hard behavior
contracts across configuration, persisted state, frozen branch inputs, and submitted provenance.
The captured input bytes are unchanged. State and decision heads change because the reducer version
is part of the immutable run behavior identity and therefore the genesis hash chains.

## Earnings evidence V2: reducer 3.0.0 / aggregate schema 4

- Frozen reducer-2.2 RC.2 capture: `fixtures/earnings-cluster.v2.captured.ndjson`, unchanged at
  SHA-256 `0803d3b49d42e5f91391755b361c9b02e6ea35ab378239e7f5a8b0851f0ddc2f`.
- Frozen reducer-2.2 RC.2 golden: `fixtures/earnings-cluster.v2.golden.json`, unchanged at SHA-256
  `9dcdaabbca76f73bee9539957136bc6d539168e65fe9c3b667e34a63d0169ff2`.
- Current reducer-3.0/state-schema-4 capture:
  `fixtures/earnings-cluster.pr2b-reducer-3.0-state-4.captured.ndjson`, SHA-256
  `9ddaf070e244d71022a4c5308482a58bd4e54888fa51de0df2af166deb490837`.
- Current reducer-3.0/state-schema-4 golden:
  `fixtures/earnings-cluster.pr2b-reducer-3.0-state-4.golden.json`, SHA-256
  `db68db31c7ee3f41cb5ec58a78753429a9da675de1d2f5228873de8d369f37a0`.
- Current heads are event
  `fda2f33758ae476def10f4bd04ec7c19759ce2c8179bcf58e90e10f012919e10`, state
  `2a58a708473322645da6cb039d5437e01e39dfa06462dcb64285471db8a21012`, and decision
  `d59fbc496190b91938244dc540943266ad730c755e9ab6a91b1f8715dc1b6288`.

Reason: reducer 3.0.0 intentionally refuses reducer-2.2/schema-3 checkpoints and starts new runs from
schema-4 genesis. Schema-V1 source events remain replayable from position zero and map to one
`legacy.primary` evidence member; schema-V2 events independently verify and retain their complete
SEC evidence membership. Updating the immutable RC.2 scenario or heads would misrepresent historical
2.2.0 release evidence. Current acceptance therefore uses separately named PR 2B assets and never
submits the historical RC.2 worker-result payloads to reducer 3.0. The versioned PR 2B scenario also
leases and succeeds its `source_confirmation` job before lifecycle finalization, so all three retained
analysis branches are succeeded.

## Recorded SEC end-to-end: PR 2B loader and replay vectors

- Recorded capture: `fixtures/recorded-sec-pr2b.captured.ndjson`, SHA-256
  `91e304d4ef2bfad49e6f4192e369d476d85ccaf037dca0aa1782a33c6c8e953b`.
- Recorded golden: `fixtures/recorded-sec-pr2b.golden.json`, SHA-256
  `634ffcd00ee15ad8ae152ed352ec777e30daff77cfbf12292ebfe403a9831310`.
- The capture has 7 schema-V2 events and 18 immutable outputs across 2 aggregates.
- Heads are event `873765eff24bcd96133de49c10409adca082e7be5a047b030d5fe8147ba3e446`,
  state `37d18a4a7b1e45f881aceb96764611a6ce656348fe05903d0e4fe1ab139b57a5`, and
  decision `7ea573b6021c0fbbe772518f83a3439003b169b3b6f3ed8e433711e2f4379806`.

Reason: this separately named vector proves the PR 2B path from synthetic SEC bytes through durable
artifact storage, close/reopen, exact selected-observation loading, complete verified reads, pure
normalization, trusted capture, and reducer-3.0 replay. Its seven fixture cases use distinct durable
provider record identities; exact redelivery is tested separately so one revision is never
reinterpreted as different content. The acceptance suite recomputes the capture, loader and
normalizer transcript hashes, and full processing snapshot, then compares them byte-for-byte with
the checked-in files. Memory and SQLite are compared at page sizes 1, 2, 7, and 10,000 with a
close/reopen boundary. Replay, shadow, research, and paper manifests all set `effectsAllowed: false`
and produce zero dispatchable jobs or outbox rows. Normal test execution is compare-only; a vector
change requires an intentional review of this explanation and both new hashes.

## Recorded SEC fixture generator: Windows path identity repair

- Generator source hash: `a23146ce81be01ddc4808929b5e791bc81a83bfa5c101ca43f437436c9794f19`
  -> `8b4b61096748186af5ba64d49b6fcea535ccd412d506e7e1f2e8de2c1f5b1edc`.
- Fixture manifest hash: `a1c1bbe68b38bf4869c4587a162ca667773aab495e40df307dfc82e12c1c5dac`
  -> `ed35f9964a25be7c609988bd50510c5e6ececec145b1b6984d9d1c0e1781d540`.
- Fixture artifact bytes, case semantics, evidence identities, and recorded PR 2B replay vectors are
  unchanged.

Reason: GitHub's Windows runner exposes the system temporary directory through an 8.3 alias while
`realpath` returns its long identity. The generator now canonicalizes both sides of path comparisons
only after proving every existing ancestor is a plain directory and not a Windows reparse point. A
focused 8.3 test proves the protected default fixture tree cannot be targeted through an alternate
short/long spelling. The manifest hash changes only because it binds the generator source hash.
