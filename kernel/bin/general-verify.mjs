#!/usr/bin/env node
// general-verify — the matrix runner. This is the oracle.
// SPDX-License-Identifier: MIT
//
//   general-verify                  run the gate + integrity + red-proof, print the verdict
//   general-verify detect           show the detected stack and the gate it implies
//   general-verify init             scaffold config and a first task contract
//   general-verify lint             validate task contracts without running anything
//   general-verify red --task t     run the gate and record which declared cases were RED
//   general-verify integrity        run only the static integrity checks
//   general-verify lock             print the canonical hash of each contract
//   general-verify selftest         prove the integrity checks still catch shortcuts
//
// Exit code: 0 green, 1 red, 2 usage error.

import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMatrix, loadConfig, resolveGate, CONFIG_FILE } from '../matrix.mjs';
import { loadAll, allCases } from '../core/contract.mjs';
import { runTests } from '../core/gate.mjs';
import { runIntegrity } from '../core/quality.mjs';
import { recordRed, clearProofs } from '../core/redproof.mjs';
import { detectStack } from '../core/stacks.mjs';
import { VERDICT } from '../core/types.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const KERNEL = resolve(HERE, '..');
const REPO = resolve(KERNEL, '..');

/* --------------------------------- args --------------------------------- */

function parseArgs(argv) {
  const out = { _: [], dir: '.', task: null, json: null, requireRedProof: false, verbose: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir' || a === '-d') out.dir = argv[++i];
    else if (a === '--task' || a === '-t') out.task = argv[++i];
    else if (a === '--json') out.json = argv[++i];
    else if (a === '--require-red-proof') out.requireRedProof = true;
    else if (a === '--verbose' || a === '-v') out.verbose = true;
    else if (a === '--force') out.force = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else if (a.startsWith('-')) out.badFlag = a;
    else out._.push(a);
  }
  return out;
}

const C = process.stdout.isTTY
  ? { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', b: '\x1b[34m', d: '\x1b[2m', bold: '\x1b[1m', x: '\x1b[0m' }
  : { g: '', r: '', y: '', b: '', d: '', bold: '', x: '' };

const MARK = {
  PASS: C.g + 'PASS' + C.x,
  FAIL: C.r + 'FAIL' + C.x,
  BLOCKED: C.y + 'BLOCKED' + C.x,
  SKIP: C.d + 'SKIP' + C.x,
};

function pad(s, n) {
  return String(s) + ' '.repeat(Math.max(1, n - String(s).length));
}

function indent(text, prefix) {
  return String(text).split('\n').map((l) => prefix + l).join('\n');
}

/* --------------------------------- report -------------------------------- */

function printReport(report, { verbose }) {
  console.log('');
  console.log(C.bold + 'general-verify' + C.x + C.d + '  ' + report.stackLabel +
    (report.runner ? ' (' + report.runner + ')' : '') + ', gate ' + report.gateSource + C.x);
  console.log('');

  for (const l of report.legs) {
    if (l.leg === 'integrity') {
      console.log('  ' + pad('integrity', 14) + (MARK[l.verdict] ?? l.verdict) +
        C.d + '  ' + l.stats.testFiles + ' test file(s), ' + l.stats.sourceFiles + ' source file(s)' + C.x);
      for (const c of l.checks) {
        if (c.status === 'ok' && !verbose) continue;
        const sym = c.status === 'fail' ? C.r + 'x' : c.status === 'warn' ? C.y + '!' : C.g + 'v';
        console.log('      ' + sym + C.x + ' ' + c.label);
        if (c.detail) console.log(indent(wrap(c.detail, 92), '        ' + C.d) + C.x);
      }
      continue;
    }

    if (l.leg === 'red-proof') {
      const note = l.required ? '' : C.d + '  (advisory except for reported bugs - pass --require-red-proof to enforce)' + C.x;
      console.log('  ' + pad('red-proof', 14) + (MARK[l.verdict] ?? l.verdict) + note);
      for (const p of l.proofs) {
        const bits = [];
        bits.push(p.proven.length + '/' + p.total + ' proven');
        if (p.missing.length) bits.push(C.r + p.missing.length + ' never seen red' + C.x);
        if (p.stale.length) bits.push(C.y + p.stale.length + ' proven against an older contract' + C.x);
        if (p.weak.length) bits.push(C.y + p.weak.length + ' suite-level only' + C.x);
        // Guards are shown on their own so they can never be mistaken for proofs.
        if (p.guards?.length) bits.push(C.d + p.guards.length + ' guard' + C.x);
        console.log('      ' + pad(p.task, 22) + bits.join(', '));
        for (const m of p.missing.slice(0, 6)) {
          console.log('        ' + C.r + '?' + C.x + ' ' + m.key + C.d + ' - ' +
            (m.reported ? 'reported: "' + m.reported + '"' : m.description) + C.x);
        }
      }
      continue;
    }

    console.log('  ' + pad(l.leg, 14) + (MARK[l.verdict] ?? l.verdict) +
      C.d + (l.durationMs !== undefined ? '  ' + l.durationMs + 'ms' : '') +
      (l.command ? '  ' + l.command : '') + C.x);
    if (l.counts && (l.counts.passed !== undefined || l.counts.failed !== undefined)) {
      console.log('      ' + C.d + (l.counts.passed ?? '?') + ' passed, ' + (l.counts.failed ?? '?') + ' failed' + C.x);
    }
    if (l.blockedReason) console.log(indent(wrap(l.blockedReason, 92), '      ' + C.y) + C.x);
    if (l.failing?.length) {
      console.log('      ' + C.r + 'failing:' + C.x + ' ' + l.failing.slice(0, 8).join(', ') +
        (l.failing.length > 8 ? ' (+' + (l.failing.length - 8) + ' more)' : '') +
        C.d + '  [' + l.confidence + ']' + C.x);
    }
    if (l.output && verbose) console.log(indent(l.output, '      ' + C.d) + C.x);
  }

  if (report.contractErrors.length) {
    console.log('');
    console.log('  ' + C.y + 'contract problems:' + C.x);
    for (const e of report.contractErrors) console.log(indent(wrap('- ' + e, 92), '    '));
  }

  const s = report.summary;
  console.log('');
  console.log('  ' + (s.verdict === 'green' ? C.g + C.bold + 'GREEN' + C.x : C.r + C.bold + 'RED' + C.x) +
    '  ' + s.legs + ' leg(s), ' + s.failed + ' failed, ' + s.blocked + ' blocked, ' + s.contracts + ' contract(s)');
  if (s.reason) console.log('  ' + C.r + 'first breaker: ' + C.x + wrap(s.reason, 92).replace(/\n/g, '\n    '));
  console.log('');
}

function wrap(text, width) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const w of words) {
    if ((line + ' ' + w).trim().length > width) { lines.push(line.trim()); line = w; }
    else line += ' ' + w;
  }
  if (line.trim()) lines.push(line.trim());
  return lines.join('\n');
}

/* ------------------------------ subcommands ------------------------------ */

function cmdDetect(args) {
  const root = resolve(args.dir);
  const config = loadConfig(root);
  const r = resolveGate(root, config);

  console.log('');
  console.log('  stack   ' + C.bold + r.label + C.x + (r.stack ? '' : C.d + '  (nothing recognised - declare the gate explicitly)' + C.x));
  console.log('  runner  ' + (r.runner ?? '-'));
  console.log('  gate    ' + (r.gateSource === 'config' ? 'from ' + CONFIG_FILE : r.gateSource));
  console.log('');
  // A leg explicitly set to null in the config is disabled; showing it as
  // "lint  null" reads like a broken command rather than a deliberate choice.
  const entries = Object.entries(r.gate).filter(([, v]) => v);
  const disabled = Object.entries(r.gate).filter(([, v]) => !v).map(([k]) => k);
  if (!entries.length) {
    console.log('  ' + C.y + 'no gate commands resolved.' + C.x);
    console.log('  Declare them in ' + CONFIG_FILE + ':');
    console.log(C.d + '    { "gate": { "test": "...", "lint": "...", "typecheck": "..." } }' + C.x);
  } else {
    for (const [k, v] of entries) console.log('  ' + pad(k, 12) + v);
    for (const k of disabled) console.log('  ' + pad(k, 12) + C.d + '(disabled in ' + CONFIG_FILE + ')' + C.x);
  }
  console.log('');
  console.log(C.d + '  The harness runs the project\'s own tooling on purpose. It adds the' + C.x);
  console.log(C.d + '  contract, the red proof and the integrity checks around it - it does' + C.x);
  console.log(C.d + '  not replace a runner the team already trusts.' + C.x);
  console.log('');
  return 0;
}

async function cmdLint(args) {
  const root = resolve(args.dir);
  const config = loadConfig(root);
  const contractsDir = config.contractsDir ? resolve(root, config.contractsDir) : root;
  const units = await loadAll(contractsDir, args.task);

  if (!units.length) {
    console.log(C.y + 'no *.task.json found under ' + contractsDir + C.x);
    console.log(C.d + 'run `general-verify init` to scaffold one' + C.x);
    return 1;
  }
  let bad = 0;
  for (const u of units) {
    const name = u.contract?.task ?? u.path;
    if (u.errors.length) {
      bad++;
      console.log(C.r + 'x ' + C.x + C.bold + name + C.x);
      for (const e of u.errors) console.log(indent(wrap(e, 92), '    '));
    } else {
      const cases = allCases(u.contract);
      console.log(C.g + 'v ' + C.x + C.bold + name + C.x + C.d +
        '  tier ' + (u.contract.tier ?? 'quick') + ', ' + u.contract.clauses.length + ' clause(s), ' +
        cases.length + ' case(s), ' + cases.filter((c) => c.probe).length + ' probe(s), hash ' + u.hash.slice(0, 12) + C.x);
    }
  }
  console.log('');
  console.log(bad ? C.r + bad + ' of ' + units.length + ' contract(s) invalid' + C.x
                  : C.g + 'all ' + units.length + ' contract(s) valid' + C.x);
  return bad ? 1 : 0;
}

async function cmdRed(args) {
  const root = resolve(args.dir);
  const config = loadConfig(root);
  const resolved = resolveGate(root, config);
  const contractsDir = config.contractsDir ? resolve(root, config.contractsDir) : root;
  const units = (await loadAll(contractsDir, args.task)).filter((u) => u.contract);

  if (!units.length) { console.error('no task contract found' + (args.task ? ' for "' + args.task + '"' : '')); return 2; }
  if (!resolved.gate.test) { console.error('no test command resolved - declare one in ' + CONFIG_FILE); return 2; }

  console.log(C.d + 'running the gate to observe the red state: ' + resolved.gate.test + C.x);
  const testResult = runTests(resolved.gate.test, root, resolved.runner);

  if (testResult.verdict === VERDICT.BLOCKED) {
    console.log('');
    console.log(C.y + 'BLOCKED - ' + testResult.blockedReason + C.x);
    console.log(C.d + 'Nothing was learned about the code, so nothing was recorded.' + C.x);
    return 1;
  }

  if (testResult.verdict === VERDICT.PASS && !args.force) {
    console.log('');
    console.log(C.y + 'The suite is already GREEN.' + C.x);
    console.log('');
    console.log(wrap(
      'There is no red state to record. Either the tests for these cases have not been written yet ' +
      '(write them first - that is the point), or they were written after the implementation, in which ' +
      'case they have never been shown to be wired to anything. Nothing was recorded.', 92));
    console.log('');
    console.log(C.d + 'Use --force only if you know exactly why you are overriding this.' + C.x);
    return 1;
  }

  let anyUnmatched = false;
  for (const u of units) {
    const cases = allCases(u.contract);
    const res = recordRed(root, { task: u.contract.task, contractHash: u.hash, cases, testResult });
    console.log('');
    console.log('  ' + C.bold + u.contract.task + C.x + '  ' + res.recorded.length + '/' + cases.length + ' case(s) recorded red' +
      C.d + '  [' + testResult.confidence + ']' + C.x);
    if (!res.namesKnown && res.suiteWasRed) {
      console.log(indent(wrap(
        'This runner\'s output could not be parsed into individual test names, so these proofs record ' +
        'that the SUITE was red, not that each case was. That is weaker evidence and is stored as such.', 88), '    ' + C.y) + C.x);
    }
    for (const cs of res.unmatched) {
      anyUnmatched = true;
      console.log('    ' + C.y + '?' + C.x + ' ' + cs.key + C.d + ' - no failing test matched this case' + C.x);
    }
  }

  if (anyUnmatched) {
    console.log('');
    console.log(wrap(
      'Unmatched cases mean either the test does not exist yet, or its name differs enough from the case id ' +
      'that the mapping broke. Both are worth fixing now: add `"test_name": "..."` to the case to pin the ' +
      'mapping explicitly.', 92));
  }
  console.log('');
  return 0;
}

function cmdIntegrity(args) {
  const root = resolve(args.dir);
  const config = loadConfig(root);
  const r = runIntegrity(root, config.quality ?? {}, { scanDirs: config.scanDirs ?? null });

  console.log('');
  for (const c of r.checks) {
    if (c.status === 'ok' && !args.verbose) continue;
    const sym = c.status === 'fail' ? C.r + 'x' : c.status === 'warn' ? C.y + '!' : C.g + 'v';
    console.log('  ' + sym + C.x + ' ' + c.label);
    if (c.detail) console.log(indent(wrap(c.detail, 92), '      ' + C.d) + C.x);
  }
  const failed = r.checks.filter((c) => c.status === 'fail').length;
  console.log('');
  console.log('  ' + (failed ? C.r + C.bold + 'RED' + C.x : C.g + C.bold + 'GREEN' + C.x) +
    C.d + '  ' + r.stats.testFiles + ' test file(s), ' + r.stats.sourceFiles + ' source file(s)' + C.x);
  console.log('');
  return failed ? 1 : 0;
}

async function cmdLock(args) {
  const root = resolve(args.dir);
  const config = loadConfig(root);
  const contractsDir = config.contractsDir ? resolve(root, config.contractsDir) : root;
  const units = await loadAll(contractsDir, args.task);
  const out = {};
  for (const u of units) {
    if (!u.contract?.task) continue;
    out[u.contract.task] = u.hash ?? null;
    console.log(pad(u.contract.task, 24) + (u.hash ?? C.r + '(invalid - not hashable)' + C.x));
  }
  if (args.json) {
    writeFileSync(resolve(args.json), JSON.stringify({ contract_hashes: out, at: new Date().toISOString() }, null, 2));
  }
  return Object.values(out).some((v) => v === null) ? 1 : 0;
}

function cmdInit(args) {
  const root = resolve(args.dir);
  const detected = detectStack(root);
  const wrote = [];
  const write = (rel, content) => {
    const p = join(root, rel);
    if (existsSync(p)) { console.log(C.d + 'exists, left alone: ' + rel + C.x); return; }
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
    wrote.push(rel);
  };

  write(CONFIG_FILE, JSON.stringify({
    contractsDir: 'verify',
    // Leave "gate" out to use detection; declare it here to override.
    gate: detected.gate,
    scanDirs: null,
    quality: {
      forbidFocusedTests: true,
      forbidSkippedTests: true,
      forbidAssertionFreeTests: 'warn',
      forbidDebugLeftovers: 'warn',
      forbidSuppressions: 'warn',
      forbidSwallowedErrors: true,
      maxTodoMarkers: -1,
    },
  }, null, 2) + '\n');

  write(join('verify', 'example.task.json'), JSON.stringify({
    task: 'example',
    title: 'Example task',
    description: 'A starter contract showing the shape. Replace it with something real - what matters is that it is written BEFORE the code.',
    tier: 'quick',
    clauses: [
      {
        id: 'A1',
        text: 'The function returns the expected value for ordinary input.',
        observable_by: 'a test named "handles ordinary input" passes',
      },
      {
        id: 'A2',
        text: 'The function handles the empty case without throwing, and returns a documented value rather than undefined.',
        observable_by: 'a test named "handles empty input" passes',
      },
    ],
    units: [
      {
        id: 'example',
        surface: 'src/example.js',
        tests: 'test/example.test.js',
        cases: [
          { id: 'handles-ordinary-input', description: 'the normal path', maps_to_clause: 'A1' },
          { id: 'handles-empty-input', description: 'empty input - the case that ships broken most often', probe: true, maps_to_clause: 'A2' },
        ],
      },
    ],
  }, null, 2) + '\n');

  console.log('');
  if (wrote.length) {
    console.log(C.g + 'scaffolded:' + C.x);
    for (const w of wrote) console.log('  ' + w);
  }
  console.log('');
  console.log('  detected stack: ' + C.bold + detected.label + C.x);
  console.log('  gate: ' + (Object.keys(detected.gate).length
    ? Object.entries(detected.gate).map(([k, v]) => k + '=' + v).join(', ')
    : C.y + 'none - declare it in ' + CONFIG_FILE + C.x));
  console.log('');
  console.log('  Next:  ' + C.bold + 'general-verify lint' + C.x + '  then write the test, then ' +
    C.bold + 'general-verify red' + C.x);
  console.log('');
  return 0;
}

async function cmdSelftest() {
  // The integrity checks are the part of this harness that has no external
  // oracle, so they get their own. The bundled example ships a clean unit and a
  // `shortcuts/` directory containing one instance of every shortcut the checks
  // exist to catch. Each must be found.
  const dir = join(REPO, 'example');
  console.log(C.d + 'self-test against ' + dir + C.x);

  const clean = runIntegrity(join(dir, 'clean'), {}, {});
  const shortcuts = runIntegrity(join(dir, 'shortcuts'), {
    forbidAssertionFreeTests: true,
    forbidDebugLeftovers: true,
    forbidSuppressions: true,
  }, {});

  const problems = [];

  const cleanFails = clean.checks.filter((c) => c.status === 'fail');
  if (cleanFails.length) {
    problems.push('the clean example produced ' + cleanFails.length + ' failure(s) - false positives: ' +
      cleanFails.map((c) => c.label).join('; '));
  }

  const expected = [
    ['focused', 'focused test'],
    ['skipped', 'skipped test'],
    ['assertionFree', 'test(s) with no assertion'],
    ['suppressions', 'suppression'],
    ['debugLeftovers', 'debug statement'],
    ['swallowedErrors', 'silent swallowed error'],
    ['explainedSwallows', 'deliberate swallowed error'],
  ];
  for (const [stat, label] of expected) {
    if (!shortcuts.stats[stat]) {
      problems.push('the "' + label + '" check found nothing in the shortcuts example - that class of shortcut is no longer being caught');
    }
  }

  console.log('');
  console.log('  clean example     ' + (cleanFails.length ? C.r + cleanFails.length + ' false positive(s)' + C.x : C.g + 'no false positives' + C.x));
  console.log('  shortcuts example ' + Object.entries(shortcuts.stats)
    .filter(([k]) => expected.some(([s]) => s === k))
    .map(([k, v]) => k + '=' + (v ? C.g + v + C.x : C.r + '0' + C.x)).join('  '));
  console.log('');

  if (problems.length) {
    console.log(C.r + C.bold + 'SELF-TEST FAILED' + C.x);
    for (const p of problems) console.log(indent(wrap('- ' + p, 92), '  '));
    return 1;
  }
  console.log(C.g + C.bold + 'SELF-TEST PASSED' + C.x + '  every shortcut class is still caught, with no false positives on clean code.');
  return 0;
}

/* --------------------------------- main --------------------------------- */

const HELP = `
general-verify - the stack-agnostic harness matrix runner

  general-verify [options]        gate + integrity + red-proof, folded into one verdict
  general-verify detect           show the detected stack and the gate it implies
  general-verify init             scaffold config and a first task contract
  general-verify lint             validate task contracts without running anything
  general-verify red              run the gate and record which declared cases were RED
  general-verify integrity        run only the static integrity checks
  general-verify lock             print the canonical hash of each contract
  general-verify selftest         prove the integrity checks still catch shortcuts

Options
  -d, --dir <path>          project root (default: .)
  -t, --task <id>           limit to one task contract
      --json <path>         write the machine-readable rollup here
      --require-red-proof   fail the run if any case was never observed failing
      --force               (with red) record even though the suite is green
  -v, --verbose             show passing checks and full command output
  -h, --help                this

Exit code: 0 green, 1 red, 2 usage error.
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(HELP); return 0; }
  if (args.badFlag) { console.error('unknown flag: ' + args.badFlag); console.log(HELP); return 2; }

  const cmd = args._[0] ?? 'run';
  try {
    if (cmd === 'detect') return cmdDetect(args);
    if (cmd === 'init') return cmdInit(args);
    if (cmd === 'lint') return await cmdLint(args);
    if (cmd === 'red') return await cmdRed(args);
    if (cmd === 'integrity') return cmdIntegrity(args);
    if (cmd === 'lock') return await cmdLock(args);
    if (cmd === 'selftest') return await cmdSelftest();
    if (cmd === 'clear-proofs') { clearProofs(resolve(args.dir), args.task); console.log('cleared'); return 0; }
    if (cmd !== 'run') { console.error('unknown command: ' + cmd); console.log(HELP); return 2; }

    const report = await runMatrix({
      dir: args.dir,
      task: args.task,
      requireRedProof: args.requireRedProof,
    });

    if (args.json) {
      const p = resolve(args.json);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, JSON.stringify(report, null, 2));
    }
    printReport(report, { verbose: args.verbose });
    return report.summary.verdict === 'green' ? 0 : 1;
  } catch (e) {
    console.error(C.r + 'general-verify failed to run:' + C.x + ' ' + (e?.message ?? e));
    if (process.env.GENERAL_VERIFY_DEBUG) console.error(e?.stack);
    return 2;
  }
}

process.exit(await main());
