// Running the gate, and parsing what came back — honestly.
// SPDX-License-Identifier: MIT
//
// The gate is whatever set of commands the project already trusts: test, lint,
// typecheck. This module runs them and normalises the result. The one rule it
// holds to throughout: NEVER claim more precision than the output supports.
// Every result carries a `confidence`, and a red-proof built on
// `exit-code-only` evidence says so out loud rather than quietly implying it
// knew which test failed.

import { spawnSync } from 'node:child_process';
import { CONFIDENCE, VERDICT } from './types.mjs';

/** Run one shell command, capturing everything. Never throws. */
export function run(command, cwd, timeoutMs = 600000) {
  const started = Date.now();
  const r = spawnSync(command, {
    cwd,
    shell: true,
    encoding: 'utf8',
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' },
  });
  return {
    command,
    code: r.status,
    signal: r.signal ?? null,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    durationMs: Date.now() - started,
    // status null means the process never produced an exit code: it was killed,
    // timed out, or the shell could not launch it. That is BLOCKED, not FAIL -
    // we learned nothing about the code.
    spawnError: r.error ? String(r.error.message ?? r.error) : null,
  };
}

/* ------------------------- failing-test extraction ------------------------ */

/**
 * Per-runner extractors for the names of failing tests.
 * Ordered from structured to scraped; each returns null when it cannot tell,
 * so the caller can fall back and downgrade confidence rather than guess.
 */
const EXTRACTORS = {
  vitest(out) {
    // Vitest text reporter: "  x  path > suite > name" / "FAIL  path > name"
    const names = new Set();
    for (const line of out.split('\n')) {
      let m = line.match(/^\s*(?:FAIL|[x×✕❌])\s+(.+?)(?:\s+\d+ms)?\s*$/);
      if (m && !/^\s*FAIL\s+\S+\.[cm]?[jt]sx?\s*$/.test(line)) {
        names.add(m[1].trim());
      }
    }
    return names.size ? { names: [...names], confidence: CONFIDENCE.heuristic } : null;
  },

  jest(out) {
    const names = new Set();
    for (const line of out.split('\n')) {
      const m = line.match(/^\s*[●×x]\s+(.+?)(?:\s+\(\d+\s*ms\))?\s*$/);
      if (m) names.add(m[1].trim());
    }
    return names.size ? { names: [...names], confidence: CONFIDENCE.heuristic } : null;
  },

  'node-test': (out) => {
    // node:test emits either TAP ("not ok 3 - name") or the spec reporter
    // ("x name (1.2ms)"), depending on version and flags. Handle both.
    //
    // The spec reporter also emits a line for the FILE itself when any test in
    // it fails, so a bare path would otherwise be recorded as a failing test
    // name and match nothing. Filter those out rather than let a phantom name
    // into a red proof.
    const names = new Set();
    for (const line of out.split('\n')) {
      let m = line.match(/^\s*not ok\s+\d+\s*-\s*(.+?)\s*$/);
      if (m) { names.add(m[1].trim()); continue; }
      m = line.match(/^\s*[x×✖✕]\s+(.+?)(?:\s+\([\d.]+m?s\))?\s*$/);
      if (m) {
        const name = m[1].trim();
        if (/^[\w./\\-]+\.[cm]?[jt]sx?$/.test(name)) continue;  // a file, not a test
        if (/^failing tests:?$/i.test(name)) continue;          // the section header
        names.add(name);
      }
    }
    return names.size ? { names: [...names], confidence: CONFIDENCE.exact } : null;
  },

  pytest(out) {
    const names = new Set();
    for (const line of out.split('\n')) {
      // "FAILED tests/test_x.py::test_name - AssertionError"
      let m = line.match(/^FAILED\s+(\S+?)(?:\s+-.*)?$/);
      if (m) { names.add(m[1]); continue; }
      // Short summary style: "tests/test_x.py::test_name FAILED"
      m = line.match(/^(\S+::\S+)\s+FAILED/);
      if (m) names.add(m[1]);
    }
    return names.size ? { names: [...names], confidence: CONFIDENCE.exact } : null;
  },

  cargo(out) {
    const names = new Set();
    for (const line of out.split('\n')) {
      const m = line.match(/^\s*test\s+(\S+)\s+\.\.\.\s+FAILED/);
      if (m) names.add(m[1]);
    }
    return names.size ? { names: [...names], confidence: CONFIDENCE.exact } : null;
  },

  gotest(out) {
    const names = new Set();
    for (const line of out.split('\n')) {
      const m = line.match(/^\s*---\s+FAIL:\s+(\S+)/);
      if (m) names.add(m[1]);
    }
    return names.size ? { names: [...names], confidence: CONFIDENCE.exact } : null;
  },

  dotnet(out) {
    const names = new Set();
    for (const line of out.split('\n')) {
      const m = line.match(/^\s*(?:Failed|X)\s+(\S+)/);
      if (m) names.add(m[1]);
    }
    return names.size ? { names: [...names], confidence: CONFIDENCE.heuristic } : null;
  },
};

/** Last resort: any recognisable failure marker at all. */
function genericExtract(out) {
  const names = new Set();
  const patterns = [
    /^\s*(?:FAILED|FAIL|not ok\s+\d+\s*-|---\s*FAIL:)\s*(.+?)\s*$/,
    /^\s*×\s+(.+?)\s*$/,
  ];
  for (const line of out.split('\n')) {
    for (const re of patterns) {
      const m = line.match(re);
      if (m && m[1] && m[1].length < 200) names.add(m[1].trim());
    }
  }
  return names.size ? { names: [...names], confidence: CONFIDENCE.heuristic } : null;
}

/** Total/passed/failed counts, where the runner prints them. */
function extractCounts(out) {
  let m;
  if ((m = out.match(/Tests?:\s+(\d+)\s+failed[^\n]*?(\d+)\s+total/i))) {
    return { failed: +m[1], total: +m[2] };
  }
  if ((m = out.match(/(\d+)\s+passed(?:[^\n]*?(\d+)\s+failed)?/i))) {
    return { passed: +m[1], failed: m[2] ? +m[2] : 0 };
  }
  if ((m = out.match(/(\d+)\s+failed,\s*(\d+)\s+passed/i))) {
    return { failed: +m[1], passed: +m[2] };
  }
  if ((m = out.match(/test result:\s+\w+\.\s+(\d+)\s+passed;\s+(\d+)\s+failed/i))) {
    return { passed: +m[1], failed: +m[2] };
  }
  if ((m = out.match(/^#\s*pass\s+(\d+)$/m))) {
    const f = out.match(/^#\s*fail\s+(\d+)$/m);
    return { passed: +m[1], failed: f ? +f[1] : 0 };
  }
  return {};
}

/**
 * Run the test leg of the gate and normalise it.
 *
 * The verdict distinction that matters: a command that could not run at all
 * (missing toolchain, spawn failure, timeout) is BLOCKED. Reporting "your tests
 * failed" when pytest was never installed sends someone to debug working code.
 */
export function runTests(command, cwd, runner) {
  const r = run(command, cwd);
  const out = r.stdout + '\n' + r.stderr;

  if (r.spawnError || r.signal) {
    return {
      ...r,
      verdict: VERDICT.BLOCKED,
      blockedReason: r.spawnError ?? ('killed by signal ' + r.signal + ' (timeout?)'),
      failing: [],
      confidence: CONFIDENCE.exitCodeOnly,
      counts: {},
    };
  }
  if (looksLikeMissingToolchain(out, r.code)) {
    return {
      ...r,
      verdict: VERDICT.BLOCKED,
      blockedReason: 'the test command could not run - the toolchain looks missing or misconfigured. This is not a test failure; nothing was learned about the code.',
      failing: [],
      confidence: CONFIDENCE.exitCodeOnly,
      counts: {},
    };
  }

  const extracted =
    (runner && EXTRACTORS[runner] ? EXTRACTORS[runner](out) : null) ?? genericExtract(out);

  return {
    ...r,
    verdict: r.code === 0 ? VERDICT.PASS : VERDICT.FAIL,
    failing: extracted?.names ?? [],
    confidence: extracted?.confidence ?? CONFIDENCE.exitCodeOnly,
    counts: extractCounts(out),
  };
}

function looksLikeMissingToolchain(out, code) {
  if (code === 0) return false;
  return [
    /command not found/i,
    /is not recognized as an internal or external command/i,
    /No module named (pytest|mypy|ruff)/i,
    /ENOENT/,
    /could not determine executable to run/i,
    /npm ERR! Missing script/i,
    /cannot find module/i,
  ].some((re) => re.test(out));
}

/** Run a non-test leg (lint, typecheck). Simpler: pass/fail on exit code. */
export function runAux(command, cwd) {
  const r = run(command, cwd);
  const out = r.stdout + '\n' + r.stderr;
  if (r.spawnError || r.signal || looksLikeMissingToolchain(out, r.code)) {
    return { ...r, verdict: VERDICT.BLOCKED, blockedReason: r.spawnError ?? 'command could not run' };
  }
  return { ...r, verdict: r.code === 0 ? VERDICT.PASS : VERDICT.FAIL };
}

/** First few meaningful lines of output, for a report that stays readable. */
export function excerpt(text, lines = 12) {
  const useful = text
    .split('\n')
    .filter((l) => l.trim())
    .filter((l) => !/^\s*(npm|yarn|pnpm)\s+(notice|WARN)/.test(l));
  const head = useful.slice(-lines);
  return head.join('\n');
}
