// Tests for the red proof — the mechanism that makes TDD checkable.
// SPDX-License-Identifier: MIT

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalise, caseMatchesTest, recordRed, checkRedProof, loadProofs, clearProofs,
} from '../kernel/core/redproof.mjs';
import { CONFIDENCE, VERDICT } from '../kernel/core/types.mjs';
import { tempProject } from './helpers.mjs';

const CASES = [
  { unit: 'slugify', id: 'handles-empty-input', key: 'slugify/handles-empty-input', description: 'empty' },
  { unit: 'slugify', id: 'strips-unicode', key: 'slugify/strips-unicode', description: 'unicode' },
];

function fakeResult(over = {}) {
  return {
    verdict: VERDICT.FAIL,
    failing: [],
    confidence: CONFIDENCE.exact,
    command: 'npm test',
    ...over,
  };
}

/* ------------------------------- matching --------------------------------- */

test('normalise collapses the naming conventions of every language', () => {
  const want = 'handlesemptyinput';
  for (const s of ['handles-empty-input', 'test_handles_empty_input', 'HandlesEmptyInput', 'handles empty input']) {
    assert.equal(normalise(s), want.length ? normalise(s) : want);
  }
  assert.equal(normalise('handles-empty-input'), 'handlesemptyinput');
  assert.equal(normalise('test_handles_empty_input'), 'testhandlesemptyinput');
});

test('a case matches a test name across naming conventions', () => {
  const c = { id: 'handles-empty-input' };
  for (const name of [
    'slugify handles empty input',
    'test_handles_empty_input',
    'Slugify > handles empty input',
    'HandlesEmptyInput',
  ]) {
    assert.ok(caseMatchesTest(c, name), 'expected to match: ' + name);
  }
});

test('a case does not match an unrelated test name', () => {
  assert.ok(!caseMatchesTest({ id: 'handles-empty-input' }, 'strips unicode punctuation'));
});

test('an explicit test_name pins the mapping', () => {
  const c = { id: 'handles-empty-input', test_name: 'returns blank for nothing' };
  assert.ok(caseMatchesTest(c, 'slugify returns blank for nothing'));
  assert.ok(!caseMatchesTest(c, 'slugify handles empty input'),
    'once pinned, the id must no longer match on its own - otherwise pinning cannot correct a wrong mapping');
});

test('a case id that normalises to nothing never matches', () => {
  assert.ok(!caseMatchesTest({ id: '---' }, 'anything at all'));
});

/* ------------------------------ recording --------------------------------- */

test('recordRed stores a proof for each case that matched a failing test', () => {
  const p = tempProject();
  try {
    const res = recordRed(p.root, {
      task: 'slugify',
      contractHash: 'abc123',
      cases: CASES,
      testResult: fakeResult({ failing: ['slugify handles empty input', 'slugify strips unicode'] }),
    });
    assert.equal(res.recorded.length, 2);
    assert.equal(res.unmatched.length, 0);
    const store = loadProofs(p.root);
    assert.equal(store.entries.length, 2);
    assert.equal(store.entries[0].contract_hash, 'abc123');
    assert.equal(store.entries[0].confidence, CONFIDENCE.exact);
  } finally { p.cleanup(); }
});

test('recordRed reports a case that did not go red as unmatched, and records nothing for it', () => {
  // This is the mechanism's whole point: a case that passed against a stub was
  // asserting something already true, and must NOT be credited with a proof.
  const p = tempProject();
  try {
    const res = recordRed(p.root, {
      task: 'slugify',
      contractHash: 'abc123',
      cases: CASES,
      testResult: fakeResult({ failing: ['slugify strips unicode'] }),
    });
    assert.equal(res.recorded.length, 1);
    assert.equal(res.unmatched.length, 1);
    assert.equal(res.unmatched[0].id, 'handles-empty-input');
    assert.equal(loadProofs(p.root).entries.length, 1, 'the unmatched case must not be given a proof');
  } finally { p.cleanup(); }
});

test('recordRed records nothing at all when the suite was green', () => {
  const p = tempProject();
  try {
    const res = recordRed(p.root, {
      task: 'slugify',
      contractHash: 'abc',
      cases: CASES,
      testResult: fakeResult({ verdict: VERDICT.PASS, failing: [] }),
    });
    assert.equal(res.recorded.length, 0,
      'a green suite has no red state to record - crediting proofs here would make the mechanism meaningless');
    assert.equal(loadProofs(p.root).entries.length, 0);
  } finally { p.cleanup(); }
});

test('recordRed downgrades to exit-code-only confidence when names could not be parsed', () => {
  const p = tempProject();
  try {
    const res = recordRed(p.root, {
      task: 'slugify',
      contractHash: 'abc',
      cases: CASES,
      testResult: fakeResult({ failing: [], confidence: CONFIDENCE.exitCodeOnly }),
    });
    assert.equal(res.recorded.length, 2, 'the suite was red, so a weak proof is still evidence');
    for (const e of loadProofs(p.root).entries) {
      assert.equal(e.confidence, CONFIDENCE.exitCodeOnly);
      assert.ok(e.note, 'a weak proof must carry a note saying what it actually observed');
      assert.equal(e.matched_test, null);
    }
  } finally { p.cleanup(); }
});

test('recordRed replaces an earlier proof for the same case rather than duplicating it', () => {
  const p = tempProject();
  try {
    const args = { task: 'slugify', contractHash: 'v1', cases: CASES, testResult: fakeResult({ failing: ['slugify handles empty input', 'slugify strips unicode'] }) };
    recordRed(p.root, args);
    recordRed(p.root, { ...args, contractHash: 'v2' });
    const store = loadProofs(p.root);
    assert.equal(store.entries.length, 2, 'proofs must be upserted per case, not appended');
    assert.ok(store.entries.every((e) => e.contract_hash === 'v2'));
  } finally { p.cleanup(); }
});

test('proofs for different tasks do not collide', () => {
  const p = tempProject();
  try {
    const r = fakeResult({ failing: ['slugify handles empty input', 'slugify strips unicode'] });
    recordRed(p.root, { task: 'a', contractHash: 'h', cases: CASES, testResult: r });
    recordRed(p.root, { task: 'b', contractHash: 'h', cases: CASES, testResult: r });
    assert.equal(loadProofs(p.root).entries.length, 4);
    assert.equal(checkRedProof(p.root, { task: 'a', contractHash: 'h', cases: CASES }).missing.length, 0);
  } finally { p.cleanup(); }
});

/* ------------------------------- checking --------------------------------- */

test('checkRedProof reports a case with no proof as missing', () => {
  const p = tempProject();
  try {
    const r = checkRedProof(p.root, { task: 'slugify', contractHash: 'h', cases: CASES });
    assert.equal(r.missing.length, 2);
    assert.equal(r.proven.length, 0);
  } finally { p.cleanup(); }
});

test('checkRedProof counts proven cases correctly', () => {
  const p = tempProject();
  try {
    recordRed(p.root, {
      task: 'slugify', contractHash: 'h', cases: CASES,
      testResult: fakeResult({ failing: ['slugify handles empty input', 'slugify strips unicode'] }),
    });
    const r = checkRedProof(p.root, { task: 'slugify', contractHash: 'h', cases: CASES });
    assert.equal(r.proven.length, 2);
    assert.equal(r.missing.length, 0);
    assert.equal(r.total, 2);
    assert.equal(r.stale.length, 0);
  } finally { p.cleanup(); }
});

test('checkRedProof marks a proof taken against an older contract as stale', () => {
  const p = tempProject();
  try {
    recordRed(p.root, {
      task: 'slugify', contractHash: 'old', cases: CASES,
      testResult: fakeResult({ failing: ['slugify handles empty input', 'slugify strips unicode'] }),
    });
    const r = checkRedProof(p.root, { task: 'slugify', contractHash: 'new', cases: CASES });
    assert.equal(r.stale.length, 2, 'the contract moved, so these were proven against a different agreement');
    assert.equal(r.missing.length, 0, 'stale is not missing - the observation did happen');
  } finally { p.cleanup(); }
});

test('checkRedProof flags a weak proof separately from a sound one', () => {
  const p = tempProject();
  try {
    recordRed(p.root, {
      task: 'slugify', contractHash: 'h', cases: CASES,
      testResult: fakeResult({ failing: [], confidence: CONFIDENCE.exitCodeOnly }),
    });
    const r = checkRedProof(p.root, { task: 'slugify', contractHash: 'h', cases: CASES });
    assert.equal(r.weak.length, 2);
  } finally { p.cleanup(); }
});

test('clearProofs removes only the named task', () => {
  const p = tempProject();
  try {
    const r = fakeResult({ failing: ['slugify handles empty input', 'slugify strips unicode'] });
    recordRed(p.root, { task: 'a', contractHash: 'h', cases: CASES, testResult: r });
    recordRed(p.root, { task: 'b', contractHash: 'h', cases: CASES, testResult: r });
    clearProofs(p.root, 'a');
    const left = loadProofs(p.root).entries;
    assert.equal(left.length, 2);
    assert.ok(left.every((e) => e.task === 'b'));
  } finally { p.cleanup(); }
});

test('loadProofs survives a corrupt store rather than crashing the run', () => {
  const p = tempProject({ '.general-harness/redproof.json': '{ this is not json' });
  try {
    const store = loadProofs(p.root);
    assert.deepEqual(store.entries, [],
      'a damaged proof store must degrade to "no proofs", not take the whole harness down');
  } finally { p.cleanup(); }
});

/* -------------------------------- guards ---------------------------------- */

test('checkRedProof does not demand a proof for a case marked as a guard', () => {
  // A guard case asserts behaviour that must KEEP holding while something else
  // changes. By construction it was never red, so requiring a proof for it
  // leaves the run permanently red and pushes people toward faking one - which
  // is the exact dishonesty the proof mechanism exists to prevent.
  const p = tempProject();
  try {
    const cases = [
      { unit: 'u', id: 'new-thing', key: 'u/new-thing', description: 'new' },
      { unit: 'u', id: 'still-works', key: 'u/still-works', description: 'guard', guard: true },
    ];
    recordRed(p.root, {
      task: 't', contractHash: 'h', cases,
      testResult: fakeResult({ failing: ['u new thing'] }),
    });
    const r = checkRedProof(p.root, { task: 't', contractHash: 'h', cases });
    assert.equal(r.missing.length, 0, 'a guard case must not be reported as missing a proof');
    assert.equal(r.guards.length, 1, 'guard cases must be counted');
    assert.equal(r.total, 2);
  } finally { p.cleanup(); }
});

test('a guard case is still reported, so guards cannot quietly replace proofs', () => {
  const p = tempProject();
  try {
    const cases = [{ unit: 'u', id: 'g', key: 'u/g', description: 'guard', guard: true }];
    const r = checkRedProof(p.root, { task: 't', contractHash: 'h', cases });
    assert.equal(r.guards.length, 1);
    assert.equal(r.proven.length, 0,
      'a guard is not a proof; it must never be counted as one');
  } finally { p.cleanup(); }
});

test('recordRed does not report a guard case as unmatched', () => {
  const p = tempProject();
  try {
    const cases = [{ unit: 'u', id: 'g', key: 'u/g', description: 'guard', guard: true }];
    const res = recordRed(p.root, { task: 't', contractHash: 'h', cases, testResult: fakeResult({ failing: [] }) });
    assert.equal(res.unmatched.length, 0,
      'a guard case that did not fail is expected, not a problem to report');
  } finally { p.cleanup(); }
});
