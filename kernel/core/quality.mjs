// The integrity checks — this harness's lie-catchers.
// SPDX-License-Identifier: MIT
//
// general-harness-disable-file: this file IS the detector. Its pattern tables
// are regular-expression literals containing every marker it looks for, and a
// regex literal cannot be distinguished from a division operator without real
// parsing - so blanking, which handles strings and comments, cannot help here.
// Scanning this file reports its own definitions as violations. The exemption
// is declared with a reason and is reported in every run. The cost is that a
// genuine shortcut taken IN THIS FILE would go uncaught, which is why the tests
// in test/quality.test.mjs exercise every check from the outside.
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

/**
 * Is this a test file?
 *
 * Recognition is split between the PATH and the BASENAME on purpose. A single
 * regex over the whole path anchors `^test_` to the start of the path, so
 * `test_slugify.py` at a project root - a completely standard Python layout -
 * was never matched. A missed test file is then scanned as source, which breaks
 * the check in both directions at once: its skipped tests go unreported, and its
 * ordinary print statements get reported as shipped debug leftovers.
 */
const TEST_DIR_RE = /(^|\/)(tests?|spec|specs|__tests__)(\/|$)/i;
const TEST_BASE_RE = /\.(test|spec)\.|^test_.*\.(py|rb|lua)$|_test\.[a-z]+$|Tests?\.(cs|java|kt)$/i;

function basenameOf(path) {
  const p = String(path).replace(/\\/g, '/');
  return p.slice(p.lastIndexOf('/') + 1);
}

export function isTestFile(path) {
  const p = String(path).replace(/\\/g, '/');
  return TEST_DIR_RE.test(p) || TEST_BASE_RE.test(basenameOf(p));
}

/**
 * Test-support modules: helpers, fixtures, factories, mocks. They live in test
 * directories and are not tests.
 *
 * They matter here because they routinely contain test source as STRING
 * LITERALS - which is precisely the shape that fools a text-based assertion
 * analysis, producing a confident finding about a file that contains no tests
 * at all. A false positive is worse than a miss: the first thing anyone does
 * with a check that cries wolf is switch it off, after which it catches nothing.
 */
const SUPPORT_BASE_RE =
  /^(helpers?|utils?|test-?utils?|fixtures?|factor(y|ies)|mocks?|stubs?|setup|teardown|conftest|support|common)\.[a-z]+$/i;

export function isTestSupportFile(path) {
  const base = basenameOf(path);
  // A file that also carries a test-file naming convention is a test, not
  // support: `helpers.test.js` really does contain tests about the helpers.
  if (/\.(test|spec)\./i.test(base)) return false;
  return SUPPORT_BASE_RE.test(base);
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
  { re: /@(?:Ignore|Disabled)\b/g, lang: 'jvm' },
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

/**
 * Declarations that start a test, per language. Used to slice test bodies.
 *
 * The JS pattern accepts any chain of modifiers (`.only`, `.skip`, `.each(...)`)
 * because a modified declaration is still a declaration. Missing them left a gap
 * between two checks: a focused test that ALSO asserted nothing - the worst
 * combination available - was reported by the focused check and invisible to the
 * assertion-free one.
 */
const TEST_DECL = [
  /\b(?:it|test)(?:\.(?:only|skip|todo|failing|concurrent|sequential|serial|runIf|skipIf|each\s*\([^)]*\)|for\s*\([^)]*\)))*\s*\(\s*[`'"]([^`'"]*)[`'"]/g,
  /^\s*(?:async\s+)?def\s+(test_\w+)\s*\(/gm,
  /#\[\s*test\s*\][\s\S]{0,120}?fn\s+(\w+)/g,
  /^\s*func\s+(Test\w+)\s*\(/gm,
  /\[\s*(?:Fact|Test|TestMethod|Theory)\s*\][\s\S]{0,200}?(?:void|Task)\s+(\w+)\s*\(/g,
];

/**
 * Blank out string literals and (optionally) comments, replacing every blanked
 * character with a space so that **every offset and line number is preserved**.
 *
 * This is the single most important function in this file, because scanning raw
 * text gets both directions wrong:
 *
 *  - Matching inside STRINGS reports code that merely *discusses* a shortcut.
 *    An assertion message quoting a skip marker, a test named after the thing it
 *    tests, or a fixture that builds test source all get flagged. This harness's
 *    own suite tripped every one of those.
 *  - Matching inside COMMENTS reports a shortcut that is not running at all. A
 *    commented-out focused test stops nothing.
 *
 * Blanking rather than deleting keeps `file:line` accurate, which is what makes
 * a finding something you can navigate to rather than argue with.
 *
 * Not everything can be handled this way: regular-expression literals holding
 * these patterns are indistinguishable from division without real parsing. That
 * case is covered by the declared, reported file-level opt-out instead.
 */
const JS_LIKE = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts', '.go', '.rs', '.cs', '.fs', '.java', '.kt', '.swift', '.php']);
const HASH_COMMENT = new Set(['.py', '.rb', '.sh', '.bash', '.pl', '.r']);

function blankRun(match) {
  // Keep newlines so line numbering is untouched; blank everything else.
  return match.replace(/[^\n]/g, ' ');
}

export function blank(text, { ext = '.js', strings = true, comments = true } = {}) {
  let out = String(text);
  const apply = (re) => { out = out.replace(re, blankRun); };

  // Blank a string's CONTENTS but keep its quotes. The delimiters are syntax,
  // not content: the test-declaration scanner recognises a test by the quoted
  // argument that follows `test(`, so blanking the quotes away would make every
  // declaration invisible and the assertion check silently vacuous.
  const applyString = (re) => {
    out = out.replace(re, (m) => (m.length >= 2 ? m[0] + blankRun(m.slice(1, -1)) + m[m.length - 1] : blankRun(m)));
  };

  // Strings first: a `//` inside a string must not be mistaken for a comment.
  if (strings) {
    applyString(/`(?:\\[\s\S]|[^`\\])*`/g);
    applyString(/'(?:\\[\s\S]|[^'\\\n])*'/g);
    applyString(/"(?:\\[\s\S]|[^"\\\n])*"/g);
  }

  if (comments) {
    if (JS_LIKE.has(ext)) {
      apply(/\/\*[\s\S]*?\*\//g);
      apply(/\/\/[^\n]*/g);
    }
    if (HASH_COMMENT.has(ext)) {
      // `#[...]` is a Rust attribute, not a comment - and `#[ignore]` is one of
      // the markers being detected, so blanking it would blind the check.
      apply(/#(?!\[)[^\n]*/g);
    }
  }
  return out;
}

/**
 * A file may declare itself out of scope, but only with a stated reason.
 *
 * Some files legitimately contain every pattern here: a detector, a linter rule
 * set, a security signature list, this file. No amount of literal-blanking helps
 * when the patterns are regex literals, so an escape hatch is necessary.
 *
 * Two properties keep it from becoming a hole: it costs a written reason, and
 * every use is reported in the run. A silent exemption is how a check quietly
 * stops covering half a codebase.
 */
const OPT_OUT_RE = /general-harness-disable-file[^\S\n]*:[^\S\n]*(\S[^\n]*)/;

export function optOutReason(text) {
  const head = String(text).split('\n', 20).join('\n');
  const m = head.match(OPT_OUT_RE);
  return m ? m[1].trim() : null;
}

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

/**
 * Match `patterns` against `searchable` (blanked text) but report the matched
 * characters from `original`. Blanking preserves offsets, so the two line up
 * exactly - and the person reading the finding sees the real code, not spaces.
 */
function scan(searchable, patterns, original = searchable) {
  const hits = [];
  for (const p of patterns) {
    p.re.lastIndex = 0;
    let m;
    while ((m = p.re.exec(searchable)) !== null) {
      hits.push({
        line: lineOf(searchable, m.index),
        match: original.slice(m.index, m.index + m[0].length).trim(),
        what: p.what ?? p.lang,
      });
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
/**
 * @param {string} blanked  text with strings and comments blanked (offsets preserved)
 * @param {string} original the raw source, used only to recover readable names
 */
function findAssertionFreeTests(blanked, original) {
  const decls = [];
  for (const re of TEST_DECL) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(blanked)) !== null) {
      // The name lives inside a string literal, which is blank in `blanked` -
      // so read it back out of the original at the same offsets.
      const declText = original.slice(m.index, m.index + m[0].length);
      const nameMatch = declText.match(/[`'"]([^`'"]*)[`'"]\s*$/);
      decls.push({
        name: nameMatch ? nameMatch[1] : (m[1] || '(anonymous)'),
        index: m.index,
        // The body starts AFTER the declaration, so a test's own name is never
        // part of what gets searched for assertions.
        bodyStart: m.index + m[0].length,
      });
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
  decls.sort((a, b) => a.index - b.index);

  const bare = [];
  for (let i = 0; i < decls.length; i++) {
    const end = i + 1 < decls.length ? decls[i + 1].index : blanked.length;
    const body = blanked.slice(decls[i].bodyStart, end);
    const hasAssertion = ASSERTION_TOKENS.some((t) => body.includes(t));
    if (!hasAssertion) {
      bare.push({ name: decls[i].name, line: lineOf(blanked, decls[i].index) });
    }
  }
  return bare;
}

/**
 * Catch/except blocks that swallow the error without handling or rethrowing.
 *
 * Classified into two kinds, because they are two different things:
 *
 *  - `silent`    — nothing in the block at all. An accident: the error vanishes
 *                  and nobody decided that it should.
 *  - `explained` — the block carries a written reason. A deliberate decision:
 *                  best-effort cleanup, a restore that may legitimately fail.
 *
 * The check targets the accident, and keeps the deliberate one visible as a
 * warning - because the failure is silent at runtime either way, and that is
 * worth seeing even when it was chosen on purpose.
 *
 * @param {string} withComments strings blanked, comments PRESERVED
 */
function findSwallowedErrors(withComments) {
  const out = [];
  const seen = new Set();
  const record = (index, body) => {
    if (seen.has(index)) return;
    seen.add(index);
    const commentText = (body.match(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|#[^\n]*/g) ?? []).join(' ');
    const reason = commentText.replace(/[^A-Za-z0-9]/g, '');
    out.push({
      line: lineOf(withComments, index),
      // A token comment like `// noop` is not a reason. The bar is deliberately
      // the same one the file-level opt-out sets: say why, in words.
      kind: reason.length >= 12 ? 'explained' : 'silent',
    });
  };

  // JS-family: catch with an empty or comment-only body.
  const jsCatch = /catch\s*(?:\([^)]*\))?\s*\{([^{}]*)\}/g;
  let m;
  while ((m = jsCatch.exec(withComments)) !== null) {
    const body = m[1];
    const withoutComments = body.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '');
    if (withoutComments.trim() === '') record(m.index, body);
    if (m.index === jsCatch.lastIndex) jsCatch.lastIndex++;
  }

  // Python: `except ...:` whose whole body is `pass`.
  const pyExcept = /except[^\n:]*:[ \t]*\n((?:[ \t]*(?:#[^\n]*)?\n)*[ \t]*pass\b[^\n]*)/g;
  while ((m = pyExcept.exec(withComments)) !== null) {
    record(m.index, m[1]);
    if (m.index === pyExcept.lastIndex) pyExcept.lastIndex++;
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

  // A declared, reasoned opt-out removes a file from every check below - and is
  // reported, so it can never quietly hollow the scan out.
  const optedOut = [];
  const scannable = [];
  for (const f of files) {
    let text;
    try { text = readFileSync(f, 'utf8'); } catch { continue; }
    const reason = optOutReason(text);
    if (reason) optedOut.push({ file: rel(f), reason });
    else scannable.push({ path: f, text, ext: extname(f) });
  }

  const testFiles = scannable.filter((f) => isTestFile(f.path));
  const sourceFiles = scannable.filter((f) => !isTestFile(f.path));
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
  for (const { path: f, text, ext } of testFiles) {
    const code = blank(text, { ext, strings: true, comments: true });
    for (const h of scan(code, FOCUSED, text)) focused.push({ file: rel(f), ...h });
    for (const h of scan(code, SKIPPED, text)) skipped.push({ file: rel(f), ...h });
    // Skip/focus detection is safe on support modules (a real `.only` there
    // would still be a problem), but assertion analysis is not: helpers hold
    // test source as strings and would be flagged for having no assertions of
    // their own, which they are not supposed to have.
    if (!isTestSupportFile(f)) {
      for (const h of findAssertionFreeTests(code, text)) bare.push({ file: rel(f), ...h });
    }
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
  for (const { path: f, text, ext } of sourceFiles) {
    // Suppressions and TODO markers ARE comments, so only strings are blanked
    // for them. Blanking comments here would make the suppression check - whose
    // every target is a comment - silently detect nothing, which trades a
    // false-positive problem for a far worse false-negative one.
    const withComments = blank(text, { ext, strings: true, comments: false });
    const code = blank(text, { ext, strings: true, comments: true });

    for (const h of scan(withComments, SUPPRESSIONS, text)) suppressions.push({ file: rel(f), ...h });
    for (const h of scan(code, DEBUG_LEFTOVERS, text)) debug.push({ file: rel(f), ...h });
    // Comments preserved here: a catch's comment is the difference between a
    // decision and an accident, and this check needs to tell them apart.
    for (const h of findSwallowedErrors(withComments)) swallowed.push({ file: rel(f), ...h });
    TODO_MARKERS.lastIndex = 0;
    todos += (withComments.match(TODO_MARKERS) ?? []).length;
  }

  emit(b.forbidSuppressions, 'linter/type suppression(s)', suppressions, (h) =>
    h.slice(0, 5).map((x) => x.file + ':' + x.line + ' ' + x.what).join('  |  ') +
    ' - each one turns a tool that was working off. Sometimes right, never free; every one should be deliberate and commented.');

  emit(b.forbidDebugLeftovers, 'debug statement(s) in source', debug, (h) =>
    h.slice(0, 5).map((x) => x.file + ':' + x.line + ' ' + x.what).join('  |  ') +
    ' - left over from working it out. Harmless individually, and collectively how output becomes unreadable.');

  const silentSwallows = swallowed.filter((s) => s.kind === 'silent');
  const explainedSwallows = swallowed.filter((s) => s.kind === 'explained');

  emit(b.forbidSwallowedErrors, 'swallowed error(s)', silentSwallows, (h) =>
    h.slice(0, 5).map((x) => x.file + ':' + x.line).join('  |  ') +
    ' - an empty catch turns a failure into silence, which is strictly worse than a crash: the system carries on in a state nobody designed. If the swallow is deliberate, say why in the block.');

  if (explainedSwallows.length) {
    checks.push(
      check(ID, STATUS.warn, explainedSwallows.length + ' deliberate swallowed error(s)',
        explainedSwallows.slice(0, 5).map((x) => x.file + ':' + x.line).join('  |  ') +
          ' - each carries a stated reason, so these are decisions rather than accidents. Still listed, because the failure is invisible at runtime either way.',
        explainedSwallows)
    );
  }

  if (b.maxTodoMarkers >= 0 && todos > b.maxTodoMarkers) {
    checks.push(check(ID, STATUS.warn, todos + ' TODO/FIXME marker(s)',
      'over the configured budget of ' + b.maxTodoMarkers));
  }

  if (optedOut.length) {
    checks.push(
      check(ID, STATUS.warn, optedOut.length + ' file(s) opted out of integrity scanning',
        optedOut.map((o) => o.file + ' (' + o.reason + ')').join('  |  ') +
          ' - reported rather than applied silently, because an unreported exemption is how a check quietly stops covering a codebase',
        optedOut)
    );
  }

  return {
    checks,
    optedOut,
    stats: {
      files: files.length,
      optedOut: optedOut.length,
      testFiles: testFiles.length,
      sourceFiles: sourceFiles.length,
      focused: focused.length,
      skipped: skipped.length,
      assertionFree: bare.length,
      suppressions: suppressions.length,
      debugLeftovers: debug.length,
      swallowedErrors: silentSwallows.length,
      explainedSwallows: explainedSwallows.length,
      todos,
    },
  };
}

export { DEFAULT_BARS };
