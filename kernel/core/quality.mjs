// The integrity checks — this harness's lie-catchers.
// SPDX-License-Identifier: MIT
//
// A test suite cannot audit itself. It reports green when every test that RAN
// passed, and it has no opinion at all about the tests that were skipped,
// focused out, or written with no assertion in them. Those are the three ways a
// suite goes green while proving nothing, and they are exactly the shortcuts
// available to anyone - human or model - under pressure to make red go away.
//
// So these checks sit beside the gate rather than inside it, and they look at
// the source rather than the results. They are the general-purpose equivalent
// of the web harness's drift probes: cheap, structural, and aimed squarely at
// the failure modes that make a green verdict meaningless.
//
// Everything here is a heuristic over text, and says so. A heuristic that
// catches four real shortcuts and occasionally asks about a fifth is worth far
// more than a perfect check nobody wrote.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, extname } from 'node:path';
import { check, STATUS } from './types.mjs';

const ID = 'integrity';

const IGNORE_DIRS = new Set([
  'node_modules', 'dist', 'build', 'out', 'target', 'bin', 'obj',
  'coverage', 'vendor', '__pycache__', '.venv', 'venv', 'htmlcov',
]);

const CODE_EXT = new Set([
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts',
  '.py', '.rs', '.go', '.cs', '.fs', '.java', '.rb', '.php', '.swift', '.kt',
]);

export function walkFiles(root, acc = []) {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    const p = join(root, e.name);
    if (e.isDirectory()) {
      if (IGNORE_DIRS.has(e.name) || e.name.startsWith('.')) continue;
      walkFiles(p, acc);
    } else if (CODE_EXT.has(extname(e.name))) {
      acc.push(p);
    }
  }
  return acc;
}

const TEST_NAME_RE = /(^|[\\/])(tests?|spec|__tests__)([\\/]|$)|\.(test|spec)\.|^test_|_test\.|Tests?\.(cs|java)$/i;

export function isTestFile(path) {
  return TEST_NAME_RE.test(path.replace(/\\/g, '/'));
}

/* --------------------------- the pattern tables --------------------------- */

/**
 * Focused tests are the most dangerous of the three, and the least noticed: a
 * single `.only` left in a file silently stops every other test in that file
 * from running, and the suite still reports green.
 */
const FOCUSED = [
  { re: /\b(?:describe|it|test|context|suite)\.only\s*\(/g, lang: 'js' },
  { re: /\bf(?:describe|it|test)\s*\(/g, lang: 'js' },
  { re: /#\[\s*test\s*\][\s\S]{0,80}?#\[\s*ignore/g, lang: 'rust-ignore-pair' },
];

const SKIPPED = [
  { re: /\b(?:describe|it|test|context|suite)\.(?:skip|todo)\s*\(/g, lang: 'js' },
  { re: /\bx(?:describe|it|test)\s*\(/g, lang: 'js' },
  { re: /@(?:pytest\.mark\.(?:skip|skipif|xfail)|unittest\.skip)/g, lang: 'py' },
  { re: /#\[\s*ignore\s*[\]\(]/g, lang: 'rust' },
  { re: /\bt\.Skip(?:Now)?\s*\(/g, lang: 'go' },
  { re: /\[\s*(?:Ignore|Skip)\s*[\]\(]/g, lang: 'dotnet' },
];

const SUPPRESSIONS = [
  { re: /@ts-(?:ignore|expect-error|nocheck)/g, what: '@ts-ignore' },
  { re: /eslint-disable(?!-next-line\s+no-console)/g, what: 'eslint-disable' },
  { re: /#\s*type:\s*ignore/g, what: 'type: ignore' },
  { re: /#\s*noqa/g, what: 'noqa' },
  { re: /#\[\s*allow\s*\(/g, what: '#[allow(...)]' },
  { re: /@SuppressWarnings/g, what: '@SuppressWarnings' },
  { re: /#pragma\s+warning\s+disable/g, what: 'pragma warning disable' },
];

const DEBUG_LEFTOVERS = [
  { re: /\bconsole\.(?:log|debug|dir|trace)\s*\(/g, what: 'console.log' },
  { re: /\bdebugger\s*;/g, what: 'debugger' },
  { re: /^\s*print\s*\(/gm, what: 'print()' },
  { re: /\bpdb\.set_trace\s*\(|\bbreakpoint\s*\(\s*\)/g, what: 'pdb/breakpoint' },
  { re: /\bdbg!\s*\(|\bprintln!\s*\(/g, what: 'dbg!/println!' },
  { re: /\bfmt\.Print(?:ln|f)?\s*\(/g, what: 'fmt.Print' },
];

const TODO_MARKERS = /\b(?:TODO|FIXME|XXX|HACK)\b/g;

/** Declarations that start a test, per language. Used to slice test bodies. */
const TEST_DECL = [
  /\b(?:it|test)\s*(?:\.each\([^)]*\))?\s*\(\s*[`'"]([^`'"]*)[`'"]/g,
  /^\s*(?:async\s+)?def\s+(test_\w+)\s*\(/gm,
  /#\[\s*test\s*\][\s\S]{0,120}?fn\s+(\w+)/g,
  /^\s*func\s+(Test\w+)\s*\(/gm,
  /\[\s*(?:Fact|Test|TestMethod|Theory)\s*\][\s\S]{0,200}?(?:void|Task)\s+(\w+)\s*\(/g,
];

const ASSERTION_TOKENS = [
  'expect(', 'assert', 'should', '.to.', 'chai',
  't.is(', 't.deepEqual(', 't.throws(',
  'self.assert', 'pytest.raises', 'pytest.approx',
  'assert_eq!', 'assert_ne!', 'panic!',
  't.Error', 't.Fatal', 't.Errorf', 't.Fatalf',
  'Assert.', 'Should()', 'verify(', 'toEqual', 'toBe', 'toThrow', 'toMatch',
  'strictEqual', 'deepEqual', 'ok(', 'throws(', 'rejects',
];

/* ------------------------------ the checks ------------------------------- */

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

function scan(text, patterns) {
  const hits = [];
  for (const p of patterns) {
    p.re.lastIndex = 0;
    let m;
    while ((m = p.re.exec(text)) !== null) {
      hits.push({ line: lineOf(text, m.index), match: m[0].trim(), what: p.what ?? p.lang });
      if (m.index === p.re.lastIndex) p.re.lastIndex++;
    }
  }
  return hits;
}

/**
 * Find tests whose body contains no assertion of any kind.
 *
 * The body is taken as the text between one test declaration and the next,
 * which is approximate but reliable in practice - a test with no assertion
 * token anywhere in that span is almost never actually asserting anything.
 * False positives are possible where assertions hide behind a custom helper, so
 * this reports as a warning by default and can be promoted by config.
 */
function findAssertionFreeTests(text) {
  const decls = [];
  for (const re of TEST_DECL) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      decls.push({ name: m[1] ?? '(anonymous)', index: m.index });
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
  decls.sort((a, b) => a.index - b.index);

  const bare = [];
  for (let i = 0; i < decls.length; i++) {
    const start = decls[i].index;
    const end = i + 1 < decls.length ? decls[i + 1].index : text.length;
    const body = text.slice(start, end);
    const hasAssertion = ASSERTION_TOKENS.some((t) => body.includes(t));
    if (!hasAssertion) {
      bare.push({ name: decls[i].name, line: lineOf(text, start) });
    }
  }
  return bare;
}

/** Catch/except blocks that swallow the error without handling or rethrowing. */
function findSwallowedErrors(text) {
  const out = [];
  const patterns = [
    /catch\s*(?:\([^)]*\))?\s*\{\s*\}/g,
    /except[^\n:]*:\s*\n\s*pass\b/g,
    /catch\s*(?:\([^)]*\))?\s*\{\s*(?:\/\/[^\n]*\s*)+\}/g,
  ];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      out.push({ line: lineOf(text, m.index) });
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
  return out;
}

const DEFAULT_BARS = {
  forbidFocusedTests: true,
  forbidSkippedTests: true,
  forbidAssertionFreeTests: 'warn',
  forbidDebugLeftovers: 'warn',
  forbidSuppressions: 'warn',
  forbidSwallowedErrors: true,
  maxTodoMarkers: -1,
  scanDirs: null,
};

/**
 * Run every integrity check over the project.
 * `bars` values are `true` (fail), `'warn'`, or `false` (skip the check).
 */
export function runIntegrity(root, bars = {}, opts = {}) {
  const b = { ...DEFAULT_BARS, ...bars };
  const roots = (b.scanDirs ?? opts.scanDirs ?? [root]).map((d) => (d === root ? root : join(root, d)));

  const files = [];
  for (const r of roots) {
    try {
      if (statSync(r).isDirectory()) files.push(...walkFiles(r));
    } catch { /* a configured dir that does not exist is not a code defect */ }
  }
  const rel = (p) => relative(root, p).replace(/\\/g, '/');

  const testFiles = files.filter((f) => isTestFile(f));
  const sourceFiles = files.filter((f) => !isTestFile(f));
  const checks = [];

  const emit = (bar, label, hits, detail) => {
    if (!bar || !hits.length) return;
    const status = bar === 'warn' ? STATUS.warn : STATUS.fail;
    checks.push(check(ID, status, hits.length + ' ' + label, detail(hits), hits.slice(0, 40)));
  };

  /* --- the three ways a suite goes green while proving nothing --- */

  const focused = [];
  const skipped = [];
  const bare = [];
  for (const f of testFiles) {
    let text;
    try { text = readFileSync(f, 'utf8'); } catch { continue; }
    for (const h of scan(text, FOCUSED)) focused.push({ file: rel(f), ...h });
    for (const h of scan(text, SKIPPED)) skipped.push({ file: rel(f), ...h });
    for (const h of findAssertionFreeTests(text)) bare.push({ file: rel(f), ...h });
  }

  emit(b.forbidFocusedTests, 'focused test(s)', focused, (h) =>
    h.slice(0, 5).map((x) => x.file + ':' + x.line + ' ' + x.match).join('  |  ') +
    ' - a focused test silently stops every other test in its file from running, and the suite still reports green. This is the single most effective way to fake a passing build.');

  emit(b.forbidSkippedTests, 'skipped test(s)', skipped, (h) =>
    h.slice(0, 5).map((x) => x.file + ':' + x.line + ' ' + x.match).join('  |  ') +
    ' - a skipped test is a requirement that stopped being checked. If it is genuinely obsolete, delete it; if it is temporarily broken, that belongs in the report, not hidden in a green run.');

  emit(b.forbidAssertionFreeTests, 'test(s) with no assertion', bare, (h) =>
    h.slice(0, 5).map((x) => x.file + ':' + x.line + ' ' + x.name).join('  |  ') +
    ' - a test that asserts nothing passes as long as the code does not throw. It looks like coverage and is not. (Heuristic: assertions behind a custom helper can be missed.)');

  if (focused.length === 0 && skipped.length === 0 && bare.length === 0 && testFiles.length) {
    checks.push(check(ID, STATUS.ok, 'no focused, skipped or assertion-free tests across ' + testFiles.length + ' test file(s)'));
  }
  if (testFiles.length === 0) {
    checks.push(check(ID, STATUS.warn, 'no test files found',
      'nothing here can go green in a way that means anything. Check the scan directories, or write the first test.'));
  }

  /* --- everything else --- */

  const suppressions = [];
  const debug = [];
  const swallowed = [];
  let todos = 0;
  for (const f of sourceFiles) {
    let text;
    try { text = readFileSync(f, 'utf8'); } catch { continue; }
    for (const h of scan(text, SUPPRESSIONS)) suppressions.push({ file: rel(f), ...h });
    for (const h of scan(text, DEBUG_LEFTOVERS)) debug.push({ file: rel(f), ...h });
    for (const h of findSwallowedErrors(text)) swallowed.push({ file: rel(f), ...h });
    TODO_MARKERS.lastIndex = 0;
    todos += (text.match(TODO_MARKERS) ?? []).length;
  }

  emit(b.forbidSuppressions, 'linter/type suppression(s)', suppressions, (h) =>
    h.slice(0, 5).map((x) => x.file + ':' + x.line + ' ' + x.what).join('  |  ') +
    ' - each one turns a tool that was working off. Sometimes right, never free; every one should be deliberate and commented.');

  emit(b.forbidDebugLeftovers, 'debug statement(s) in source', debug, (h) =>
    h.slice(0, 5).map((x) => x.file + ':' + x.line + ' ' + x.what).join('  |  ') +
    ' - left over from working it out. Harmless individually, and collectively how output becomes unreadable.');

  emit(b.forbidSwallowedErrors, 'swallowed error(s)', swallowed, (h) =>
    h.slice(0, 5).map((x) => x.file + ':' + x.line).join('  |  ') +
    ' - an empty catch turns a failure into silence, which is strictly worse than a crash: the system carries on in a state nobody designed.');

  if (b.maxTodoMarkers >= 0 && todos > b.maxTodoMarkers) {
    checks.push(check(ID, STATUS.warn, todos + ' TODO/FIXME marker(s)',
      'over the configured budget of ' + b.maxTodoMarkers));
  }

  return {
    checks,
    stats: {
      files: files.length,
      testFiles: testFiles.length,
      sourceFiles: sourceFiles.length,
      focused: focused.length,
      skipped: skipped.length,
      assertionFree: bare.length,
      suppressions: suppressions.length,
      debugLeftovers: debug.length,
      swallowedErrors: swallowed.length,
      todos,
    },
  };
}

export { DEFAULT_BARS };
