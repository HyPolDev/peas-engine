/**
 * This module is selected only by Node's explicit `p1-10-test` condition. It is not reachable by
 * changing process environment data and is never selected by the production/default build path.
 */
export const P1_10_TEST_AUTHORITY: Readonly<{ kind: "p1-10-test-authority" }> = Object.freeze({
  kind: "p1-10-test-authority",
});
