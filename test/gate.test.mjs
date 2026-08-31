// Tests for the gate: running commands and parsing what came back.
// SPDX-License-Identifier: MIT
//
// The property under test throughout: the gate must NEVER claim more than the
// output supports, and must never confuse "could not run" with "ran and failed".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTests, runAux, excerpt, looksLikeMissingToolchain } from '../kernel/core/gate.mjs';
import { VERDICT, CONFIDENCE } from '../kernel/core/types.mjs';
import { tempProject } from './helpers.mjs';

/* ------------------------- blocked vs failed ------------------------------ */

test('gate reports a missing command as BLOCKED, not FAIL', () => {
  const p = tempProject();
  try {
    const r = runTests('this-command-definitely-does-not-exist-xyz', p.root, null);
    assert.equal(r.verdict, VERDICT.BLOCKED,
      'a command that cannot run taught us nothing about the code; calling it FAIL sends someone to debug working code');
    assert.ok(r.blockedReason, 'BLOCKED must always carry a reason');
  } finally { p.cleanup(); }
});

test('gate reports a missing import in the code under test as FAIL, not BLOCKED', () => {
  // This is the classic TDD starting state: the test file exists, the module it
  // imports does not yet. That is a genuine RED - the whole point of writing the
  // test first - and it must be recordable as such. Classifying it BLOCKED
  // breaks the primary workflow, because `general-verify red` refuses to record
  // anything from a blocked run.
  const p = tempProject({
    'test/thing.test.mjs':
      "import { test } from 'node:test';\n" +
      "import { thing } from '../src/thing.mjs';\n" +
      "test('thing works', () => { thing(); });\n",
  });
  try {
    const r = runTests('node --test test/thing.test.mjs', p.root, 'node-test');
    assert.equal(r.verdict, VERDICT.FAIL,
      'the runner ran and the test failed because the implementation does not exist yet - that is red, not blocked');
  } finally { p.cleanup(); }
});

test('gate reports a genuinely absent toolchain as BLOCKED', () => {
  const p = tempProject();
  try {
    const r = runTests('definitely-not-a-real-runner-9f3a --version', p.root, null);
    assert.equal(r.verdict, VERDICT.BLOCKED);
  } finally { p.cleanup(); }
});

// "command not found" wears a different message in every shell, and the one that
// matters is the one this project is never developed on. spawnSync runs commands
// through /bin/sh, which on Ubuntu - and so on CI - is dash, and dash says
// "/bin/sh: 1: x: not found", with no "command" in it at all. Matching on prose
// alone made a missing toolchain read as a failing suite on every Linux machine:
// the exact BLOCKED/FAIL confusion this gate exists to prevent.

test('classifies a dash-style missing command as a missing toolchain', () => {
  assert.equal(looksLikeMissingToolchain('/bin/sh: 1: pytest: not found', 127), true);
});

test('classifies a bash-style missing command as a missing toolchain', () => {
  assert.equal(looksLikeMissingToolchain('bash: line 1: pytest: command not found', 127), true);
});

test('treats exit 127 as a missing toolchain whatever the shell printed', () => {
  // 127 is the POSIX code for "could not find the command"; a runner that got as
  // far as running tests does not exit with it. Reading the code is more durable
  // than reading a message that changes with the shell.
  assert.equal(looksLikeMissingToolchain('', 127), true);
});

test('does not mistake a suite that ran and failed for a missing toolchain', () => {
  assert.equal(
    looksLikeMissingToolchain("Cannot find module - 1 failing, AssertionError", 1), false,
    'the classic TDD red state must stay recordable as FAIL');
});

/* --------------------------- passing runs --------------------------------- */

test('gate reports a passing suite as PASS with no failing names', () => {
  const p = tempProject({
    'test/ok.test.mjs':
      "import { test } from 'node:test';\n" +
      "import assert from 'node:assert/strict';\n" +
      "test('adds up', () => { assert.equal(1 + 1, 2); });\n",
  });
  try {
    const r = runTests('node --test test/ok.test.mjs', p.root, 'node-test');
    assert.equal(r.verdict, VERDICT.PASS);
    assert.deepEqual(r.failing, []);
  } finally { p.cleanup(); }
});

/* ----------------------- failing-name extraction -------------------------- */

test('gate extracts individual failing test names from node --test', () => {
  const p = tempProject({
    'test/mixed.test.mjs':
      "import { test } from 'node:test';\n" +
      "import assert from 'node:assert/strict';\n" +
      "test('this one passes', () => { assert.ok(true); });\n" +
      "test('slugify handles empty input', () => { assert.equal(1, 2); });\n",
  });
  try {
    const r = runTests('node --test test/mixed.test.mjs', p.root, 'node-test');
    assert.equal(r.verdict, VERDICT.FAIL);
    assert.ok(
      r.failing.some((n) => n.includes('slugify handles empty input')),
      'expected the failing test name to be extracted, got: ' + JSON.stringify(r.failing)
    );
    assert.ok(
      !r.failing.some((n) => n.includes('this one passes')),
      'a passing test must never appear in the failing list'
    );
  } finally { p.cleanup(); }
});

test('gate does not report the test FILE as a failing test name', () => {
  // node's reporter emits a line for the file itself when any test in it fails.
  // Letting that through would put a phantom "name" into a red proof that
  // matches no declared case and confuses every downstream reader.
  const p = tempProject({
    'test/one.test.mjs':
      "import { test } from 'node:test';\n" +
      "import assert from 'node:assert/strict';\n" +
      "test('breaks', () => { assert.equal(1, 2); });\n",
  });
  try {
    const r = runTests('node --test test/one.test.mjs', p.root, 'node-test');
    assert.ok(
      !r.failing.some((n) => /\.test\.mjs$/.test(n)),
      'a file path leaked into the failing-test list: ' + JSON.stringify(r.failing)
    );
  } finally { p.cleanup(); }
});

test('gate reports exit-code-only confidence when no names can be parsed', () => {
  const p = tempProject();
  try {
    // A command that fails with output containing nothing name-shaped.
    const r = runTests('node -e "process.exit(3)"', p.root, null);
    assert.equal(r.verdict, VERDICT.FAIL);
    assert.equal(r.confidence, CONFIDENCE.exitCodeOnly,
      'with nothing parseable, the gate must say so rather than imply it knew which test failed');
  } finally { p.cleanup(); }
});

test('gate reports counts for node --test', () => {
  const p = tempProject({
    'test/counted.test.mjs':
      "import { test } from 'node:test';\n" +
      "import assert from 'node:assert/strict';\n" +
      "test('a', () => { assert.ok(true); });\n" +
      "test('b', () => { assert.ok(true); });\n" +
      "test('c fails', () => { assert.ok(false); });\n",
  });
  try {
    const r = runTests('node --test test/counted.test.mjs', p.root, 'node-test');
    assert.equal(r.counts.passed, 2, 'expected 2 passed, got ' + JSON.stringify(r.counts));
    assert.equal(r.counts.failed, 1, 'expected 1 failed, got ' + JSON.stringify(r.counts));
  } finally { p.cleanup(); }
});

/* ------------------------------ pytest ------------------------------------ */

test('gate extracts pytest failing node ids', () => {
  // Parsed from captured output rather than by running pytest, so the test does
  // not silently skip on a machine without Python - a test that quietly does
  // nothing is worse than no test.
  const captured = [
    'tests/test_slug.py::test_ordinary PASSED',
    'FAILED tests/test_slug.py::test_empty - AssertionError: assert None == ""',
    'FAILED tests/test_slug.py::test_unicode',
    '2 failed, 1 passed in 0.12s',
  ].join('\n');
  const { extractForRunner } = requireInternal();
  const got = extractForRunner('pytest', captured);
  assert.ok(got, 'expected pytest names to be extracted');
  assert.ok(got.names.includes('tests/test_slug.py::test_empty'));
  assert.ok(got.names.includes('tests/test_slug.py::test_unicode'));
  assert.equal(got.names.length, 2, 'a passing test leaked in: ' + JSON.stringify(got.names));
});

test('gate extracts go and cargo failing test names', () => {
  const { extractForRunner } = requireInternal();
  const go = extractForRunner('gotest', '--- FAIL: TestSlugEmpty (0.00s)\n--- PASS: TestSlugOK (0.00s)\nFAIL\n');
  assert.deepEqual(go.names, ['TestSlugEmpty']);

  const cargo = extractForRunner('cargo', 'test slug::empty ... FAILED\ntest slug::ok ... ok\n');
  assert.deepEqual(cargo.names, ['slug::empty']);
});

/* ------------------------------- aux legs --------------------------------- */

test('runAux passes on a zero exit and fails on a non-zero one', () => {
  const p = tempProject();
  try {
    assert.equal(runAux('node -e "0"', p.root).verdict, VERDICT.PASS);
    assert.equal(runAux('node -e "process.exit(1)"', p.root).verdict, VERDICT.FAIL);
  } finally { p.cleanup(); }
});

/* ------------------------------- excerpt ---------------------------------- */

test('excerpt keeps the tail of the output and drops package-manager noise', () => {
  const text = [
    'npm notice something irrelevant',
    'npm WARN deprecated thing',
    'AssertionError: expected 1 to equal 2',
    '    at Object.<anonymous>',
  ].join('\n');
  const out = excerpt(text, 5);
  assert.ok(out.includes('AssertionError'), 'the actual error must survive');
  assert.ok(!out.includes('npm notice'), 'package-manager noise must be dropped');
});

/* -------------------------------------------------------------------------- */

/**
 * The per-runner extractors are an internal detail, but they are the part most
 * likely to rot silently as runners change their output format, so they are
 * tested directly rather than only through a live run.
 */
function requireInternal() {
  return { extractForRunner: gateExtract };
}

let gateExtract;
const mod = await import('../kernel/core/gate.mjs');
gateExtract = mod.extractForRunner;

test('the per-runner extractors are exported for direct testing', () => {
  assert.equal(typeof gateExtract, 'function',
    'gate.mjs must export extractForRunner so output parsing can be tested without spawning every toolchain');
});
