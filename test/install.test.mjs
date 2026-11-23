// Tests for the portable installer.
// SPDX-License-Identifier: MIT

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKILL = 'general-harness';

function install() {
  const home = mkdtempSync(join(tmpdir(), 'gh-install-'));
  const dst = join(home, '.claude', 'skills', SKILL);
  return {
    dst,
    run() {
      return spawnSync(process.execPath, [join(REPO, 'install.mjs')], {
        env: { ...process.env, HOME: home, USERPROFILE: home },
        encoding: 'utf8',
      });
    },
    cleanup: () => rmSync(home, { recursive: true, force: true }),
  };
}

test('the installer bakes the clone path into the installed skill', () => {
  const t = install();
  try {
    const r = t.run();
    assert.equal(r.status, 0, r.stderr);
    const text = readFileSync(join(t.dst, 'SKILL.md'), 'utf8');
    assert.ok(text.startsWith('---\n'), 'the frontmatter must stay first or the skill is not parsed');
    assert.ok(!text.includes('<kernel>'));
    assert.ok(text.includes(REPO.replaceAll('\\', '/') + '/kernel/bin/'));
  } finally {
    t.cleanup();
  }
});

test('the installer stamps the source commit', () => {
  const t = install();
  try {
    assert.equal(t.run().status, 0);
    assert.match(readFileSync(join(t.dst, 'SKILL.md'), 'utf8'), /<!-- installed by install\.mjs from \S+ at [0-9a-f]{40}/);
  } finally {
    t.cleanup();
  }
});

test('a stale install is replaced, not merged', () => {
  const t = install();
  try {
    mkdirSync(t.dst, { recursive: true });
    writeFileSync(join(t.dst, 'removed-upstream.md'), 'old');
    assert.equal(t.run().status, 0);
    assert.ok(!existsSync(join(t.dst, 'removed-upstream.md')));
  } finally {
    t.cleanup();
  }
});
