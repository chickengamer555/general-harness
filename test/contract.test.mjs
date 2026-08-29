// Tests for the task contract and its completeness gate.
// SPDX-License-Identifier: MIT
//
// The gate exists to stop contract theatre. Each test below names one specific
// way a contract can look complete while agreeing to nothing checkable.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateContract, loadContract, loadAll, allCases } from '../kernel/core/contract.mjs';
import { canonicalHash, canonicalize } from '../kernel/core/canonical-hash.mjs';
import { tempProject } from './helpers.mjs';

const VALID = {
  task: 'slugify',
  title: 'Slug generator',
  description: 'Turn arbitrary text into a URL-safe slug that is never undefined.',
  tier: 'quick',
  clauses: [
    { id: 'A1', text: 'Ordinary text becomes a slug.', observable_by: 'a test named "handles ordinary input" passes' },
  ],
  units: [
    {
      id: 'slugify',
      cases: [
        { id: 'handles-ordinary-input', description: 'the normal path', maps_to_clause: 'A1' },
        { id: 'handles-empty-input', description: 'empty input', probe: true, maps_to_clause: 'A1' },
      ],
    },
  ],
};

const clone = (o) => JSON.parse(JSON.stringify(o));

function errorsFor(mutate) {
  const c = clone(VALID);
  mutate(c);
  return validateContract(c, 'x');
}

test('a complete contract validates', () => {
  assert.deepEqual(validateContract(clone(VALID), 'x'), []);
});

/* ------------------------- the completeness gate -------------------------- */

test('a clause with no observable_by is rejected', () => {
  const errs = errorsFor((c) => { delete c.clauses[0].observable_by; });
  assert.ok(errs.some((e) => /observable_by/.test(e)),
    'a clause nobody can check is a wish, not a requirement');
});

test('a unit with no probe case is rejected', () => {
  const errs = errorsFor((c) => { c.units[0].cases = [c.units[0].cases[0]]; });
  assert.ok(errs.some((e) => /probe/.test(e)),
    'a unit with only happy-path cases has tested the demo');
});

test('a clause with no case mapped to it is rejected', () => {
  const errs = errorsFor((c) => {
    c.clauses.push({ id: 'A2', text: 'Something else.', observable_by: 'a test passes' });
  });
  assert.ok(errs.some((e) => /A2/.test(e) && /no case/.test(e)),
    'an unmapped clause is agreed but unproven - the exact hole the contract exists to prevent');
});

test('a case mapping to a clause that does not exist is rejected', () => {
  const errs = errorsFor((c) => { c.units[0].cases[0].maps_to_clause = 'Z9'; });
  assert.ok(errs.some((e) => /Z9/.test(e)));
});

test('duplicate ids are rejected at every level', () => {
  assert.ok(errorsFor((c) => { c.clauses.push(clone(c.clauses[0])); }).some((e) => /duplicate clause/.test(e)));
  assert.ok(errorsFor((c) => { c.units.push(clone(c.units[0])); }).some((e) => /duplicate unit/.test(e)));
  assert.ok(errorsFor((c) => { c.units[0].cases.push(clone(c.units[0].cases[0])); }).some((e) => /duplicate case/.test(e)));
});

test('an empty contract is rejected with useful messages, not a crash', () => {
  const errs = validateContract({}, 'x');
  assert.ok(errs.length >= 3);
  assert.ok(errs.every((e) => e.startsWith('x: ')), 'every message must name where it came from');
});

test('validateContract never throws on malformed input', () => {
  for (const bad of [null, undefined, 42, 'a string', []]) {
    assert.doesNotThrow(() => validateContract(bad, 'x'));
  }
});

test('an unknown tier is rejected', () => {
  assert.ok(errorsFor((c) => { c.tier = 'enormous'; }).some((e) => /tier/.test(e)));
});

/* ------------------------------- loading ---------------------------------- */

test('loadContract reports invalid JSON as an error rather than throwing', () => {
  const p = tempProject({ 'verify/broken.task.json': '{ nope' });
  try {
    const r = loadContract(p.root + '/verify/broken.task.json');
    assert.equal(r.contract, null);
    assert.equal(r.hash, null);
    assert.ok(r.errors[0].includes('invalid JSON'));
  } finally { p.cleanup(); }
});

test('loadAll finds contracts and rejects a duplicate task id across files', () => {
  const p = tempProject({
    'verify/a.task.json': JSON.stringify(VALID),
    'verify/b.task.json': JSON.stringify(VALID),
  });
  try {
    const all = loadAll(p.root);
    assert.equal(all.length, 2);
    assert.ok(all.some((u) => u.errors.some((e) => /duplicate task id/.test(e))),
      'two contracts answering to one task id makes every proof and trace line ambiguous');
  } finally { p.cleanup(); }
});

test('loadAll ignores build output and dependency directories', () => {
  const p = tempProject({
    'verify/a.task.json': JSON.stringify(VALID),
    'node_modules/pkg/verify/b.task.json': JSON.stringify(VALID),
    'dist/c.task.json': JSON.stringify(VALID),
  });
  try {
    assert.equal(loadAll(p.root).length, 1, 'a vendored contract must not be picked up as this project\'s own');
  } finally { p.cleanup(); }
});

test('allCases flattens units into keyed cases', () => {
  const cases = allCases(VALID);
  assert.equal(cases.length, 2);
  assert.equal(cases[0].key, 'slugify/handles-ordinary-input');
  assert.equal(cases[0].unit, 'slugify');
});

/* ---------------------------- canonical hash ------------------------------ */

test('the canonical hash ignores key order', () => {
  assert.equal(
    canonicalHash({ a: 1, b: { c: 2, d: 3 } }),
    canonicalHash({ b: { d: 3, c: 2 }, a: 1 }),
    'a re-serialised contract must hash the same, or "locked" means nothing'
  );
});

test('the canonical hash respects array order', () => {
  assert.notEqual(canonicalHash({ a: [1, 2] }), canonicalHash({ a: [2, 1] }),
    'clause order is meaningful; reordering is a real change');
});

test('the canonical hash changes when a clause changes', () => {
  const a = clone(VALID);
  const b = clone(VALID);
  b.clauses[0].text = 'Something materially different.';
  assert.notEqual(canonicalHash(a), canonicalHash(b));
});

test('the canonical hash ignores fields that are not part of the agreement', () => {
  const a = clone(VALID);
  const b = clone(VALID);
  b.$schema = '../schema.json';
  b.canonicalHash = 'whatever';
  b.lockedAt = new Date().toISOString();
  assert.equal(canonicalHash(a), canonicalHash(b),
    'recording the lock must not change the thing being locked');
});

test('canonicalize handles null and nested empties without crashing', () => {
  assert.equal(canonicalize(null), 'null');
  assert.equal(canonicalize({ a: null, b: [], c: {} }), '{"a":null,"b":[],"c":{}}');
});
