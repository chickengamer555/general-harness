// Tests for the run lock and the trivially-true gate check.
// SPDX-License-Identifier: MIT

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMatrix, loadConfig } from '../kernel/matrix.mjs';
import { VERDICT } from '../kernel/core/types.mjs';
import { isTrivialCommand } from '../kernel/core/gate.mjs';
import { LOCK_VERSION, hashFile, writeLock, readLock, relock, lockPath, historyPath } from '../kernel/core/lock.mjs';
import { tempProject } from './helpers.mjs';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'kernel', 'bin', 'general-verify.mjs');

function contract(task, tier, tests = 'test/a.test.mjs') {
  return JSON.stringify({
    task,
    title: 'A task',
    description: 'Something that must become true for this test.',
    tier,
    clauses: [{ id: 'A1', text: 'It works.', observable_by: 'a test passes' }],
    units: [{ id: 'u', tests, cases: [{ id: 'c', description: 'the case', probe: true, maps_to_clause: 'A1' }] }],
  });
}

function project(tier = 'standard', extra = {}) {
  return tempProject({
    'general-harness.config.json': JSON.stringify({ contractsDir: 'verify', gate: { test: 'node --test "test/*.test.mjs"' } }),
    'verify/a.task.json': contract('a', tier),
    'test/a.test.mjs': 'one',
    'test/b.test.mjs': 'two',
    'test/helper.mjs': 'not a test',
    ...extra,
  });
}

async function lockLeg(root) {
  const report = await runMatrix({ dir: root, skipGate: true });
  return { leg: report.legs.find((l) => l.leg === 'lock'), summary: report.summary };
}

test('the lock records a sha256 for every contract, mapped test, gate-glob test and the config', () => {
  const p = project('standard', { 'other/mapped.test.mjs': 'mapped', 'verify/m.task.json': contract('m', 'quick', 'other/mapped.test.mjs') });
  try {
    writeLock(p.root, loadConfig(p.root));
    const lock = readLock(p.root);
    assert.equal(lock.version, LOCK_VERSION);
    assert.deepEqual(Object.keys(lock.files).sort(), [
      'general-harness.config.json',
      'other/mapped.test.mjs',
      'test/a.test.mjs',
      'test/b.test.mjs',
      'verify/a.task.json',
      'verify/m.task.json',
    ]);
    for (const h of Object.values(lock.files)) assert.match(h, /^[0-9a-f]{64}$/);
    assert.ok(lockPath(p.root).endsWith(join('.general-harness', 'lock.json')));
  } finally {
    p.cleanup();
  }
});

test('a run names an edited test file as lock drift', async () => {
  const p = project();
  try {
    writeLock(p.root, loadConfig(p.root));
    p.write('test/a.test.mjs', 'one, edited to get green');
    const { leg, summary } = await lockLeg(p.root);
    assert.equal(leg.verdict, VERDICT.FAIL);
    assert.deepEqual(leg.changed, ['test/a.test.mjs']);
    assert.ok(summary.breakers.some((b) => b.startsWith('lock') && b.includes('test/a.test.mjs')));
  } finally {
    p.cleanup();
  }
});

test('a run names added and removed files as lock drift', async () => {
  const p = project();
  try {
    writeLock(p.root, loadConfig(p.root));
    p.write('verify/new.task.json', contract('new', 'quick', 'test/b.test.mjs'));
    unlinkSync(join(p.root, 'test', 'a.test.mjs'));
    const { leg, summary } = await lockLeg(p.root);
    assert.equal(leg.verdict, VERDICT.FAIL);
    assert.deepEqual(leg.added, ['verify/new.task.json']);
    assert.deepEqual(leg.removed, ['test/a.test.mjs']);
    const b = summary.breakers.find((x) => x.startsWith('lock'));
    assert.ok(b.includes('verify/new.task.json') && b.includes('test/a.test.mjs'));
  } finally {
    p.cleanup();
  }
});

test('a lock with another schema version fails and asks for a relock', async () => {
  const p = project();
  try {
    writeLock(p.root, loadConfig(p.root));
    const lock = readLock(p.root);
    writeFileSync(lockPath(p.root), JSON.stringify({ ...lock, version: LOCK_VERSION + 1 }));
    const { leg } = await lockLeg(p.root);
    assert.equal(leg.verdict, VERDICT.FAIL);
    assert.match(leg.reason, /version/);
    assert.match(leg.reason, /--relock/);
  } finally {
    p.cleanup();
  }
});

test('a missing lock is allowed when every selected contract is quick', async () => {
  const p = project('quick');
  try {
    const { leg, summary } = await lockLeg(p.root);
    assert.equal(leg.verdict, VERDICT.SKIP);
    assert.ok(!summary.breakers.some((b) => b.startsWith('lock')));
  } finally {
    p.cleanup();
  }
});

test('a missing lock blocks the run when the strictest selected tier is standard', async () => {
  const p = project('quick', { 'verify/s.task.json': contract('s', 'standard', 'test/b.test.mjs') });
  try {
    const { leg, summary } = await lockLeg(p.root);
    assert.equal(leg.verdict, VERDICT.BLOCKED);
    assert.match(leg.blockedReason, /--lock/);
    assert.equal(summary.verdict, 'red');
  } finally {
    p.cleanup();
  }
});

test('writing a lock over a drifted one refuses and points to relock', () => {
  const p = project();
  try {
    writeLock(p.root, loadConfig(p.root));
    const before = readFileSync(lockPath(p.root), 'utf8');
    p.write('test/b.test.mjs', 'two, changed');
    assert.throws(() => writeLock(p.root, loadConfig(p.root)), /--relock/);
    assert.equal(readFileSync(lockPath(p.root), 'utf8'), before);
  } finally {
    p.cleanup();
  }
});

test('relock without a reason is refused', () => {
  const p = project();
  try {
    writeLock(p.root, loadConfig(p.root));
    p.write('test/b.test.mjs', 'two, changed');
    assert.throws(() => relock(p.root, loadConfig(p.root), '  '), /--reason/);
    assert.equal(existsSync(historyPath(p.root)), false);
  } finally {
    p.cleanup();
  }
});

test('relock rewrites the lock and appends the reason and what changed to the history', async () => {
  const p = project();
  try {
    writeLock(p.root, loadConfig(p.root));
    p.write('test/b.test.mjs', 'two, changed');
    p.write('test/c.test.mjs', 'three');
    const res = relock(p.root, loadConfig(p.root), 'the clause was wrong, agreed with the user');
    assert.deepEqual(res.changed, [
      { path: 'test/b.test.mjs', status: 'changed' },
      { path: 'test/c.test.mjs', status: 'added' },
    ]);
    const lines = readFileSync(historyPath(p.root), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.equal(lines.length, 1);
    assert.equal(lines[0].reason, 'the clause was wrong, agreed with the user');
    assert.deepEqual(lines[0].changed, res.changed);
    assert.ok(!Number.isNaN(Date.parse(lines[0].time)));
    const { leg } = await lockLeg(p.root);
    assert.equal(leg.verdict, VERDICT.PASS);
  } finally {
    p.cleanup();
  }
});

test('a CRLF checkout hashes the same as LF', () => {
  const p = tempProject({ 'lf.txt': 'a\nb\n', 'crlf.txt': 'a\r\nb\r\n' });
  try {
    assert.equal(hashFile(join(p.root, 'crlf.txt')), hashFile(join(p.root, 'lf.txt')));
  } finally {
    p.cleanup();
  }
});

test('isTrivialCommand recognises commands that test nothing', () => {
  for (const c of ['true', ' true ', 'exit 0', ':', 'echo tests pass', 'echo', '', '   ', 'true && exit 0', 'echo ok; true']) {
    assert.equal(isTrivialCommand(c), true, JSON.stringify(c) + ' should be trivial');
  }
  for (const c of ['npm test', 'node --test "test/*.test.mjs"', 'pytest -q', 'true && npm test', 'cargo test']) {
    assert.equal(isTrivialCommand(c), false, JSON.stringify(c) + ' is a real gate');
  }
});

test('a trivially true gate command fails the run with a reason', async () => {
  const p = tempProject({
    'general-harness.config.json': JSON.stringify({ gate: { test: 'true' } }),
  });
  try {
    const report = await runMatrix({ dir: p.root });
    const leg = report.legs.find((l) => l.leg === 'test');
    assert.equal(leg.verdict, VERDICT.FAIL);
    assert.match(leg.reason, /tests nothing/);
    assert.ok(report.summary.breakers.some((b) => b.startsWith('test') && /tests nothing/.test(b)));
  } finally {
    p.cleanup();
  }
});

test('the CLI locks, refuses to lock over drift, and relocks with a reason', () => {
  const p = project();
  const cli = (...a) => spawnSync(process.execPath, [CLI, '--dir', p.root, ...a], { encoding: 'utf8' });
  try {
    const first = cli('--lock');
    assert.equal(first.status, 0, first.stdout + first.stderr);
    assert.ok(existsSync(lockPath(p.root)));

    p.write('test/a.test.mjs', 'one, edited');
    const again = cli('--lock');
    assert.equal(again.status, 1);
    assert.match(again.stdout + again.stderr, /--relock/);

    const noReason = cli('--relock');
    assert.equal(noReason.status, 2);

    const re = cli('--relock', '--reason', 'test was asserting the wrong unit');
    assert.equal(re.status, 0, re.stdout + re.stderr);
    assert.match(re.stdout, /test\/a\.test\.mjs/);
  } finally {
    p.cleanup();
  }
});
