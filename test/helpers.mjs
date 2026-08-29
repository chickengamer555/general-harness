// Shared test helpers.
// SPDX-License-Identifier: MIT

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

/** A throwaway directory, cleaned up by the caller. */
export function tempProject(files = {}) {
  const root = mkdtempSync(join(tmpdir(), 'gh-test-'));
  for (const [rel, content] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
  }
  return {
    root,
    write(rel, content) {
      const p = join(root, rel);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, content);
      return p;
    },
    cleanup() {
      try { rmSync(root, { recursive: true, force: true }); } catch { /* windows file locks */ }
    },
  };
}

/**
 * Build source text containing a shortcut marker WITHOUT writing that marker
 * literally into this repository's own test files.
 *
 * If these fixtures were written literally, general-harness's own integrity leg
 * would find them while scanning its own test directory and report its own
 * suite as compromised - which is both wrong and a good illustration of why the
 * check has to look at real files rather than at a hard-coded list.
 */
export const marker = {
  focusedTest: (name) => 'it' + '.only(' + JSON.stringify(name) + ', () => { assert.ok(true); });',
  skippedTest: (name) => 'it' + '.skip(' + JSON.stringify(name) + ', () => { assert.ok(true); });',
  assertionFree: (name) => 'test(' + JSON.stringify(name) + ', () => { const r = go(); return r; });',
  pytestSkip: () => '@pytest' + '.mark.skip\ndef test_thing():\n    assert True\n',
  rustIgnore: () => '#[' + 'ignore]\nfn thing() {}\n',
  goSkip: () => 'func TestThing(t *testing.T) {\n\tt' + '.Skip("later")\n}\n',
  tsIgnore: () => '// @ts-' + 'ignore\n',
  eslintDisable: () => '/* eslint-' + 'disable no-unused-vars */\n',
  consoleLog: () => 'console' + '.log("here");\n',
  emptyCatch: () => 'try { go(); } catch (e) {\n}\n',
};

/** A test body that does assert, for contrast with the assertion-free ones. */
export const realTest = (name) =>
  'test(' + JSON.stringify(name) + ', () => { assert.equal(go(), 1); });';
