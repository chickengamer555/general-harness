// Tests for the integrity checks — the harness's own lie-catchers.
// SPDX-License-Identifier: MIT
//
// These matter more than most: the integrity leg is the part of the harness
// with no external oracle. If it silently stops catching something, every run
// afterwards is still reported green.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runIntegrity, isTestFile } from '../kernel/core/quality.mjs';
import { tempProject, marker, realTest } from './helpers.mjs';

const HEAD = "import { test, it, describe } from 'node:test';\nimport assert from 'node:assert/strict';\nfunction go() { return 1; }\n";

function scan(files, bars = {}) {
  const p = tempProject(files);
  try {
    const r = runIntegrity(p.root, bars, {});
    return {
      ...r,
      failed: r.checks.filter((c) => c.status === 'fail'),
      warned: r.checks.filter((c) => c.status === 'warn'),
      labels: r.checks.map((c) => c.label),
    };
  } finally { p.cleanup(); }
}

/* ------------------------- test-file recognition -------------------------- */

test('isTestFile recognises the conventional layouts', () => {
  for (const p of [
    'test/thing.test.mjs',
    'tests/thing_test.py',
    'src/__tests__/thing.js',
    'spec/thing.js',
    'src/thing.spec.ts',
    'tests/test_thing.py',
  ]) {
    assert.ok(isTestFile(p), 'expected to be recognised as a test file: ' + p);
  }
});

test('isTestFile recognises a python test file at the project root', () => {
  // Python convention allows test_foo.py anywhere, not only under tests/. If
  // this is missed, the file is scanned as SOURCE - so a skipped test in it is
  // never reported, and the debug-leftover check fires on ordinary test prints.
  assert.ok(isTestFile('test_slugify.py'), 'test_slugify.py at the root must be a test file');
  assert.ok(isTestFile('src/test_slugify.py'), 'src/test_slugify.py must be a test file');
});

test('isTestFile does not mistake ordinary source for tests', () => {
  for (const p of ['src/testUtils.js', 'src/contest.js', 'src/latest.py', 'lib/attest.rs']) {
    assert.ok(!isTestFile(p), 'expected NOT to be treated as a test file: ' + p);
  }
});

/* --------------------------- the three shortcuts -------------------------- */

test('integrity fails on a focused test', () => {
  const r = scan({ 'test/a.test.mjs': HEAD + marker.focusedTest('only me') });
  assert.equal(r.stats.focused, 1);
  assert.ok(r.failed.some((c) => /focused/.test(c.label)),
    'a focused test must FAIL, not warn: it stops every other test in the file from running while the suite still reports green');
});

test('integrity fails on a skipped test', () => {
  const r = scan({ 'test/a.test.mjs': HEAD + marker.skippedTest('later') });
  assert.equal(r.stats.skipped, 1);
  assert.ok(r.failed.some((c) => /skipped/.test(c.label)));
});

test('integrity finds a test with no assertion', () => {
  const r = scan(
    { 'test/a.test.mjs': HEAD + realTest('asserts properly') + '\n' + marker.assertionFree('asserts nothing') },
    { forbidAssertionFreeTests: true }
  );
  assert.equal(r.stats.assertionFree, 1,
    'expected exactly the one assertion-free test, got ' + r.stats.assertionFree);
});

test('integrity finds an assertion-free test even when it is also focused', () => {
  // A focused test that also asserts nothing is the worst combination available
  // and must not fall through the gap between the two checks.
  const r = scan(
    { 'test/a.test.mjs': HEAD + 'it' + '.only("does nothing at all", () => { const r = go(); });\n' },
    { forbidAssertionFreeTests: true }
  );
  assert.equal(r.stats.focused, 1, 'the focus must be caught');
  assert.equal(r.stats.assertionFree, 1, 'the missing assertion must ALSO be caught');
});

test('integrity does not flag a test that asserts', () => {
  const r = scan(
    { 'test/a.test.mjs': HEAD + realTest('genuinely asserts') },
    { forbidAssertionFreeTests: true }
  );
  assert.equal(r.stats.assertionFree, 0, 'false positive on a test that does assert');
  assert.equal(r.failed.length, 0, 'clean test file produced failures: ' + r.failed.map((c) => c.label).join('; '));
});

/* --------------------------- other languages ------------------------------ */

test('integrity finds skips across python, rust and go', () => {
  const py = scan({ 'tests/test_a.py': marker.pytestSkip() });
  assert.ok(py.stats.skipped >= 1, 'pytest skip marker missed');

  const rs = scan({ 'tests/a_test.rs': marker.rustIgnore() });
  assert.ok(rs.stats.skipped >= 1, 'rust #[ignore] missed');

  const go = scan({ 'a_test.go': marker.goSkip() });
  assert.ok(go.stats.skipped >= 1, 't.Skip missed');
});

/* ----------------------------- source checks ------------------------------ */

test('integrity finds suppressions, debug leftovers and swallowed errors in source', () => {
  const r = scan(
    { 'src/a.mjs': marker.tsIgnore() + marker.eslintDisable() + marker.consoleLog() + marker.emptyCatch() },
    { forbidSuppressions: true, forbidDebugLeftovers: true }
  );
  assert.ok(r.stats.suppressions >= 2, 'suppressions missed: ' + r.stats.suppressions);
  assert.ok(r.stats.debugLeftovers >= 1, 'debug leftovers missed');
  assert.equal(r.stats.swallowedErrors, 1, 'empty catch missed');
});

test('integrity does not report source-side checks against test files', () => {
  // A console.log inside a test is ordinary debugging output, not shipped code.
  // Reporting it trains people to ignore the check, and an ignored check is not
  // a check.
  const r = scan(
    { 'test/a.test.mjs': HEAD + realTest('x') + '\n' + marker.consoleLog() },
    { forbidDebugLeftovers: true }
  );
  assert.equal(r.stats.debugLeftovers, 0,
    'debug output inside a test file must not be reported as a source leftover');
});

/* ------------------------------ reporting --------------------------------- */

test('integrity warns rather than passes silently when there are no tests at all', () => {
  const r = scan({ 'src/a.mjs': 'export const a = 1;\n' });
  assert.ok(r.warned.some((c) => /no test files/.test(c.label)),
    'a project with no tests must say so - nothing here can go green in a way that means anything');
});

test('integrity reports a clean project as clean', () => {
  const r = scan({
    'src/a.mjs': 'export function go() { return 1; }\n',
    'test/a.test.mjs': HEAD + realTest('works'),
  });
  assert.equal(r.failed.length, 0, 'false positives: ' + r.failed.map((c) => c.label).join('; '));
});

test('every integrity failure names the file and line it found', () => {
  // A finding you cannot navigate to is a finding people learn to skip past.
  const r = scan({ 'test/a.test.mjs': HEAD + marker.focusedTest('only me') });
  const f = r.failed.find((c) => /focused/.test(c.label));
  assert.ok(f, 'expected a focused-test failure');
  assert.match(f.detail, /test[\\/]a\.test\.mjs:\d+/, 'detail must contain file:line, got: ' + f.detail);
});

test('a bar set to false disables its check entirely', () => {
  const r = scan({ 'test/a.test.mjs': HEAD + marker.skippedTest('later') }, { forbidSkippedTests: false });
  assert.equal(r.failed.length, 0, 'a disabled check must not fail the run');
});

test('scanDirs limits what is scanned', () => {
  const p = tempProject({
    'good/test/a.test.mjs': HEAD + realTest('fine'),
    'fixtures/test/bad.test.mjs': HEAD + marker.focusedTest('ignore me'),
  });
  try {
    const r = runIntegrity(p.root, { scanDirs: ['good'] }, {});
    assert.equal(r.stats.focused, 0, 'scanDirs must exclude the fixtures directory');
  } finally { p.cleanup(); }
});

test('integrity does not analyse test-support modules for missing assertions', () => {
  // A helpers/fixtures module lives in the test directory but is not a test.
  // It routinely contains test source as STRINGS, which is exactly the shape
  // that fools a text-based analysis. A false positive here is worse than a
  // miss: the first thing anyone does with a check that cries wolf is turn it
  // off, and then it catches nothing at all.
  const r = scan(
    {
      'test/helpers.mjs':
        "export const build = (name) => 'test(' + JSON.stringify(name) + ', () => {});';\n" +
        "export const real = (name) => 'test(' + JSON.stringify(name) + ', () => { assert.ok(1); });';\n",
      'test/a.test.mjs': HEAD + realTest('works'),
    },
    { forbidAssertionFreeTests: true }
  );
  assert.equal(r.stats.assertionFree, 0,
    'a test-support module must not be analysed as though it were a test file');
});

/* ------------------- literals, comments and opt-outs ---------------------- */

test('integrity ignores a shortcut marker written inside a string literal', () => {
  // An assertion message, a documentation string, or a test named after the
  // thing it tests will all mention these markers. Matching inside a string
  // means the checks fire on projects that are talking ABOUT the shortcut
  // rather than taking it.
  // The fixture below genuinely contains `#[ignore]` inside a string literal -
  // the concatenation is only so that THIS file does not, which would make the
  // repository's own scan a confusing place to read the result from.
  const r = scan({
    'test/a.test.mjs': HEAD + realTest('works') + '\n' +
      "test('reports it', () => { assert.equal(msg, 'rust #" + "[ignore] missed'); });\n",
  });
  assert.equal(r.stats.skipped, 0,
    'a marker inside a string literal is discussion, not a skipped test');
});

test('integrity ignores a shortcut marker that is commented out', () => {
  const r = scan({
    'test/a.test.mjs': HEAD + realTest('works') + '\n' +
      '// ' + 'it' + '.only("we removed this", () => {});\n',
  });
  assert.equal(r.stats.focused, 0,
    'a commented-out focused test is not running, so it is not stopping anything');
});

test('integrity does not treat test source inside a string literal as a declaration', () => {
  // A test that builds fixture source containing test declarations - which is
  // exactly what a harness's own suite does - must not have its body truncated
  // at the fixture, hiding the real assertions that follow.
  const r = scan(
    {
      'test/a.test.mjs': HEAD +
        "test('mounts a fixture and checks it', () => {\n" +
        "  const src = \"test('inner', () => { doThing(); });\";\n" +
        '  assert.ok(src.length > 0);\n' +
        '});\n',
    },
    { forbidAssertionFreeTests: true }
  );
  assert.equal(r.stats.assertionFree, 0,
    'the real assertion after the fixture string must still be found');
});

test('integrity still detects a suppression, which is itself a comment', () => {
  // Guard against over-correcting: blanking comments everywhere would make the
  // suppression check - whose targets are all comments - silently detect nothing.
  const r = scan({ 'src/a.mjs': marker.tsIgnore() + 'export const a = 1;\n' }, { forbidSuppressions: true });
  assert.ok(r.stats.suppressions >= 1, 'suppressions are comments and must still be found');
});

test('a file can opt out of integrity scanning with a stated reason', () => {
  const optOut = '// general-harness-disable-file: this file holds the detector patterns themselves\n';
  const r = scan({ 'test/a.test.mjs': optOut + HEAD + marker.focusedTest('only me') });
  assert.equal(r.stats.focused, 0, 'an opted-out file must not be scanned');
  assert.equal(r.stats.optedOut, 1, 'the opt-out must be counted');
});

test('an opt-out is reported rather than applied silently', () => {
  const optOut = '// general-harness-disable-file: detector patterns\n';
  const r = scan({ 'test/a.test.mjs': optOut + HEAD + marker.focusedTest('only me') });
  assert.ok(r.checks.some((c) => /opted out/i.test(c.label)),
    'a silent opt-out is a hole; the run must say which files were skipped and why');
});

test('an opt-out without a reason is refused', () => {
  const r = scan({ 'test/a.test.mjs': '// general-harness-disable-file\n' + HEAD + marker.focusedTest('only me') });
  assert.equal(r.stats.focused, 1,
    'an opt-out with no stated reason must not take effect - otherwise it is just a way to switch the check off');
});

test('a catch that explains why it swallows is reported, but does not fail the run', () => {
  // An empty catch is an accident; a catch with a written reason is a decision.
  // The check should target the accident. Keeping the explained one visible as a
  // warning preserves the point - the failure is still invisible at runtime -
  // without blocking a deliberate, documented choice.
  const explained = 'try { go(); } catch {\n  // best effort: some globals are not writable here\n}\n';
  const r = scan({ 'src/a.mjs': explained });
  assert.equal(r.failed.filter((c) => /swallowed/.test(c.label)).length, 0,
    'a documented swallow must not fail the run');
  assert.ok(r.warned.some((c) => /swallowed/.test(c.label)),
    'it must still be visible - the error is silent at runtime either way');
});

test('an empty catch with no explanation still fails', () => {
  const r = scan({ 'src/a.mjs': 'try { go(); } catch (e) {\n}\n' });
  assert.ok(r.failed.some((c) => /swallowed/.test(c.label)),
    'an undocumented swallow is the accident this check exists for');
});
