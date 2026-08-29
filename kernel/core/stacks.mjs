// Stack detection and the gate commands each one implies.
// SPDX-License-Identifier: MIT
//
// This harness deliberately does NOT ship its own test runner. The project
// already has one, the team already trusts it, and replacing it would be the
// fastest way to make the harness something people route around. What the
// harness adds is everything the runner does not do: a contract agreed up
// front, a proof that the test failed before it passed, integrity checks the
// runner cannot perform on itself, and one folded verdict.
//
// So: detect the stack, borrow its runner, normalise the output.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

function has(dir, ...names) {
  return names.some((n) => existsSync(join(dir, n)));
}

function readJSON(p) {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function anyFileMatching(dir, re, depth = 2) {
  const walk = (d, left) => {
    if (left < 0) return false;
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
        if (walk(join(d, e.name), left - 1)) return true;
      } else if (re.test(e.name)) return true;
    }
    return false;
  };
  return walk(dir, depth);
}

/**
 * Ordered detectors. First match wins, so the more specific ones come first.
 * Each returns the gate: the commands whose combined result IS the verdict.
 */
const DETECTORS = [
  {
    id: 'node',
    label: 'Node / JavaScript / TypeScript',
    detect: (dir) => has(dir, 'package.json'),
    gate(dir) {
      const pkg = readJSON(join(dir, 'package.json')) ?? {};
      const scripts = pkg.scripts ?? {};
      const runner = detectNodeRunner(dir, pkg);
      const gate = {};

      if (scripts.test) gate.test = 'npm test --silent';
      else if (runner === 'vitest') gate.test = 'npx vitest run';
      else if (runner === 'jest') gate.test = 'npx jest';
      else gate.test = 'node --test';

      if (scripts.lint) gate.lint = 'npm run lint --silent';
      else if (existsSync(join(dir, 'eslint.config.js')) || existsSync(join(dir, '.eslintrc.json'))) {
        gate.lint = 'npx eslint .';
      }

      if (scripts.typecheck) gate.typecheck = 'npm run typecheck --silent';
      else if (has(dir, 'tsconfig.json')) gate.typecheck = 'npx tsc --noEmit';

      return { gate, runner };
    },
    testFileRe: /\.(test|spec)\.[cm]?[jt]sx?$/,
    sourceRe: /\.[cm]?[jt]sx?$/,
  },
  {
    id: 'python',
    label: 'Python',
    detect: (dir) => has(dir, 'pyproject.toml', 'setup.py', 'setup.cfg', 'pytest.ini', 'requirements.txt', 'tox.ini'),
    gate(dir) {
      const gate = { test: 'python -m pytest -q' };
      if (has(dir, 'ruff.toml', '.ruff.toml') || /ruff/.test(safeRead(join(dir, 'pyproject.toml')))) {
        gate.lint = 'python -m ruff check .';
      }
      if (/mypy/.test(safeRead(join(dir, 'pyproject.toml'))) || has(dir, 'mypy.ini')) {
        gate.typecheck = 'python -m mypy .';
      }
      return { gate, runner: 'pytest' };
    },
    testFileRe: /^test_.*\.py$|_test\.py$/,
    sourceRe: /\.py$/,
  },
  {
    id: 'rust',
    label: 'Rust',
    detect: (dir) => has(dir, 'Cargo.toml'),
    gate: () => ({
      gate: {
        test: 'cargo test',
        lint: 'cargo clippy -- -D warnings',
        typecheck: 'cargo check',
      },
      runner: 'cargo',
    }),
    testFileRe: /\.rs$/,
    sourceRe: /\.rs$/,
  },
  {
    id: 'go',
    label: 'Go',
    detect: (dir) => has(dir, 'go.mod'),
    gate: () => ({
      gate: { test: 'go test ./...', lint: 'go vet ./...', typecheck: 'go build ./...' },
      runner: 'gotest',
    }),
    testFileRe: /_test\.go$/,
    sourceRe: /\.go$/,
  },
  {
    id: 'dotnet',
    label: '.NET',
    detect: (dir) => anyFileMatching(dir, /\.(csproj|sln|fsproj)$/, 1),
    gate: () => ({ gate: { test: 'dotnet test', typecheck: 'dotnet build' }, runner: 'dotnet' }),
    testFileRe: /Tests?\.cs$/,
    sourceRe: /\.(cs|fs)$/,
  },
  {
    id: 'make',
    label: 'Make',
    detect: (dir) => has(dir, 'Makefile'),
    gate(dir) {
      const mk = safeRead(join(dir, 'Makefile'));
      const gate = {};
      if (/^test\s*:/m.test(mk)) gate.test = 'make test';
      if (/^lint\s*:/m.test(mk)) gate.lint = 'make lint';
      return { gate, runner: 'make' };
    },
    testFileRe: /test/i,
    sourceRe: /.*/,
  },
];

function safeRead(p) {
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}

function detectNodeRunner(dir, pkg) {
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  const script = pkg.scripts?.test ?? '';
  if (deps.vitest || /vitest/.test(script) || has(dir, 'vitest.config.ts', 'vitest.config.js')) return 'vitest';
  if (deps.jest || /jest/.test(script) || has(dir, 'jest.config.js', 'jest.config.mjs')) return 'jest';
  if (/node --test|node:test/.test(script)) return 'node-test';
  return 'node-test';
}

/**
 * Detect the stack and propose a gate.
 * Returns `null` for `stack` when nothing is recognised - which is a real answer,
 * not a failure. The user then declares the gate explicitly in the config, and
 * the harness works exactly as well.
 */
export function detectStack(dir) {
  for (const d of DETECTORS) {
    if (!d.detect(dir)) continue;
    const { gate, runner } = d.gate(dir);
    return {
      stack: d.id,
      label: d.label,
      runner,
      gate,
      testFileRe: d.testFileRe,
      sourceRe: d.sourceRe,
    };
  }
  return {
    stack: null,
    label: 'unrecognised',
    runner: null,
    gate: {},
    testFileRe: /\.(test|spec)\./,
    sourceRe: /.*/,
  };
}

export { DETECTORS };
