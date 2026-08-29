// Tests for stack detection and gate resolution.
// SPDX-License-Identifier: MIT
//
// Detection has one safety property that matters more than accuracy: when it
// does not recognise a project it must say so and resolve NO command, rather
// than guessing. Running a guessed build command in an unfamiliar repository
// can be destructive, and "I don't know" costs the user one question.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectStack } from '../kernel/core/stacks.mjs';
import { resolveGate } from '../kernel/matrix.mjs';
import { tempProject } from './helpers.mjs';

function detect(files) {
  const p = tempProject(files);
  try {
    return detectStack(p.root);
  } finally { p.cleanup(); }
}

test('an unrecognised project resolves no gate rather than guessing one', () => {
  const d = detect({ 'readme.txt': 'hello' });
  assert.equal(d.stack, null);
  assert.deepEqual(d.gate, {},
    'guessing a build command in an unknown repo can be destructive; resolving nothing is the safe answer');
});

test('detects a node project and prefers its own test script', () => {
  const d = detect({ 'package.json': JSON.stringify({ scripts: { test: 'vitest run', lint: 'eslint .' } }) });
  assert.equal(d.stack, 'node');
  assert.match(d.gate.test, /npm test/);
  assert.match(d.gate.lint, /npm run lint/);
});

test('detects the node runner so failing test names can be parsed', () => {
  const vitest = detect({ 'package.json': JSON.stringify({ devDependencies: { vitest: '^1' } }) });
  assert.equal(vitest.runner, 'vitest');
  const jest = detect({ 'package.json': JSON.stringify({ devDependencies: { jest: '^29' } }) });
  assert.equal(jest.runner, 'jest');
});

test('adds a typecheck leg only when the project actually has one', () => {
  const withTs = detect({ 'package.json': '{}', 'tsconfig.json': '{}' });
  assert.ok(withTs.gate.typecheck, 'a tsconfig means a typecheck leg is available');
  const withoutTs = detect({ 'package.json': '{}' });
  assert.ok(!withoutTs.gate.typecheck, 'inventing a typecheck leg that cannot run produces a permanent BLOCKED');
});

test('detects python, rust and go', () => {
  assert.equal(detect({ 'pyproject.toml': '[project]\nname="x"\n' }).stack, 'python');
  assert.equal(detect({ 'Cargo.toml': '[package]\nname="x"\n' }).stack, 'rust');
  assert.equal(detect({ 'go.mod': 'module x\n' }).stack, 'go');
});

test('python detection picks up ruff and mypy only when configured', () => {
  const bare = detect({ 'pyproject.toml': '[project]\nname="x"\n' });
  assert.match(bare.gate.test, /pytest/);
  assert.ok(!bare.gate.lint, 'a lint command that is not installed becomes a permanent BLOCKED leg');

  const full = detect({ 'pyproject.toml': '[tool.ruff]\n[tool.mypy]\n' });
  assert.ok(full.gate.lint, 'ruff is configured, so the lint leg should exist');
  assert.ok(full.gate.typecheck, 'mypy is configured, so the typecheck leg should exist');
});

test('a malformed package.json degrades gracefully instead of crashing', () => {
  const d = detect({ 'package.json': '{ broken' });
  assert.equal(d.stack, 'node', 'the marker file is still there, so it is still a node project');
  assert.ok(d.gate.test, 'a fallback test command should still be offered');
});

test('detection does not descend into node_modules to decide the stack', () => {
  const d = detect({ 'node_modules/dep/Cargo.toml': '[package]\nname="dep"\n', 'readme.txt': 'x' });
  assert.notEqual(d.stack, 'rust', 'a dependency\'s build file must not determine this project\'s stack');
});

/* --------------------------- gate resolution ------------------------------ */

test('an explicit gate in the config wins over detection', () => {
  const p = tempProject({ 'package.json': JSON.stringify({ scripts: { test: 'vitest run' } }) });
  try {
    const r = resolveGate(p.root, { gate: { test: 'make check' } });
    assert.equal(r.gate.test, 'make check', 'the project knows its own build better than any heuristic');
    assert.equal(r.gateSource, 'config');
  } finally { p.cleanup(); }
});

test('an explicit runner in the config wins over detection', () => {
  const p = tempProject({ 'package.json': '{}' });
  try {
    const r = resolveGate(p.root, { runner: 'pytest' });
    assert.equal(r.runner, 'pytest',
      'declaring the runner is how a custom gate command still yields named failing tests instead of exit-code-only evidence');
  } finally { p.cleanup(); }
});

test('a partial config gate keeps the detected legs it did not override', () => {
  const p = tempProject({ 'package.json': JSON.stringify({ scripts: { test: 'vitest run', lint: 'eslint .' } }) });
  try {
    const r = resolveGate(p.root, { gate: { test: 'make check' } });
    assert.equal(r.gate.test, 'make check');
    assert.ok(r.gate.lint, 'overriding one leg must not silently delete the others');
  } finally { p.cleanup(); }
});
