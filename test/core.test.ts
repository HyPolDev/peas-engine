import assert from "node:assert/strict";
import test from "node:test";

import { ManualClock } from "../src/core/clock.js";
import { canonicalJson, type JsonValue } from "../src/core/json.js";

test("canonical JSON is independent of object insertion order", () => {
  assert.equal(canonicalJson({ z: 1, a: { y: 2, b: 3 } }), '{"a":{"b":3,"y":2},"z":1}');
});

test("canonical JSON rejects nondeterministic numeric and structural values", () => {
  assert.throws(() => canonicalJson({ value: Number.NaN }));
  assert.throws(() => canonicalJson({ value: -0 }));
  assert.throws(() => canonicalJson({ value: 1.5 }));
  const sparse = Array(2) as unknown as JsonValue;
  (sparse as unknown as number[])[1] = 1;
  assert.throws(() => canonicalJson(sparse));
});

test("manual clock is monotonic", () => {
  const clock = new ManualClock(100);
  clock.advanceBy(25);
  assert.equal(clock.nowMs(), 125);
  assert.throws(() => clock.advanceTo(124));
});
