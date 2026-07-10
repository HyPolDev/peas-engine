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
