// DELIBERATELY BAD. This file is never executed — it is the fixture the
// integrity checks are graded against, and every line of it is a shortcut the
// harness must still be able to find.
//
// One instance per shortcut class, so when the self-test says a class is no
// longer caught you know exactly which check lost its teeth.

import { describe, it, test } from 'node:test';
import assert from 'node:assert/strict';

/* --- shortcut 1: a focused test --------------------------------------------
   The worst of the three, because it is the quietest. One `.only` left behind
   silently stops every other test in this file from running, and the suite
   still reports green with a smaller number nobody reads. */
it.only('only this one runs, and nobody notices the rest stopped', () => {
  assert.equal(1, 1);
});

/* --- shortcut 2: a skipped test --------------------------------------------
   A requirement that quietly stopped being checked. It reads as temporary and
   is almost never temporary. */
it.skip('this requirement is no longer verified by anything', () => {
  assert.equal(compute(), 42);
});

describe.skip('a whole suite nobody is running', () => {
  it('would have caught the regression', () => {
    assert.ok(false);
  });
});

/* --- shortcut 3: a test with no assertion ----------------------------------
   Passes as long as nothing throws. Shows up in coverage, proves nothing at
   all, and is the hardest of the three to spot in review. */
test('processes the input', () => {
  const result = compute();
  console.log(result);
});

test('handles the edge case', () => {
  compute();
});

function compute() {
  return 42;
}
