// The red proof — mechanical evidence that the test failed before it passed.
// SPDX-License-Identifier: MIT
//
// Test-driven development has one property that makes it worth the discipline:
// a test you watched fail, and then watched pass, has demonstrably been wired to
// the thing it claims to check. A test written afterwards has not. It may be
// asserting on a constant, testing a mock against itself, or exercising a code
// path that no longer exists - and it will sit there green forever, indicating
// nothing.
//
// Every other part of TDD is a working habit and stays advisory. THIS part is
// checkable, so this harness checks it: `general-verify red` records which
// declared cases were observed failing, and `verify --require-red-proof`
// refuses to call a run green if a case went straight to passing without ever
// having been seen to fail.
//
// It is deliberately honest about its own limits. A proof recorded from
// exit-code-only evidence knows the SUITE was red, not which case was, and it
// says exactly that rather than implying more.

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIDENCE } from './types.mjs';

export const STORE_DIR = '.general-harness';
export const STORE_FILE = 'redproof.json';

function storePath(root) {
  return join(root, STORE_DIR, STORE_FILE);
}

export function loadProofs(root) {
  const p = storePath(root);
  if (!existsSync(p)) return { version: 1, entries: [] };
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8'));
    return { version: parsed.version ?? 1, entries: parsed.entries ?? [] };
  } catch {
    return { version: 1, entries: [] };
  }
}

function saveProofs(root, store) {
  mkdirSync(join(root, STORE_DIR), { recursive: true });
  writeFileSync(storePath(root), JSON.stringify(store, null, 2) + '\n');
}

/**
 * Normalise an identifier so `strips-unicode-punctuation`,
 * `test_strips_unicode_punctuation` and "strips unicode punctuation" all
 * collapse to the same string. Test naming conventions differ per language and
 * per person; the contract should not have to care.
 */
export function normalise(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Does this observed test name correspond to this declared case?
 * A case may pin the mapping exactly with `test_name`; otherwise we match by
 * normalised containment, which handles the common conventions without
 * demanding the contract author guess at the runner's output format.
 */
export function caseMatchesTest(declaredCase, testName) {
  if (declaredCase.test_name) {
    return normalise(testName).includes(normalise(declaredCase.test_name));
  }
  const id = normalise(declaredCase.id);
  if (!id) return false;
  return normalise(testName).includes(id);
}

/**
 * Record a red observation for every declared case that matched a failing test.
 *
 * Returns what was recorded AND what was not, because the second list is the
 * more useful one: a declared case with no matching failure means either the
 * test does not exist yet, or it is named so differently that the mapping is
 * broken - and both are worth knowing before you start implementing.
 */
export function recordRed(root, { task, contractHash, cases, testResult }) {
  const store = loadProofs(root);
  const at = new Date().toISOString();
  const recorded = [];
  const unmatched = [];

  const suiteWasRed = testResult.verdict === 'FAIL';
  const namesKnown = testResult.confidence !== CONFIDENCE.exitCodeOnly && testResult.failing.length > 0;

  for (const cs of cases) {
    const hit = testResult.failing.find((n) => caseMatchesTest(cs, n));

    if (hit) {
      recorded.push(upsert(store, {
        task, unit: cs.unit, case: cs.id, key: cs.key,
        matched_test: hit,
        failed_at: at,
        contract_hash: contractHash,
        gate_command: testResult.command,
        confidence: testResult.confidence,
      }));
    } else if (suiteWasRed && !namesKnown) {
      // The suite was red but the runner's output could not be parsed into
      // names. That is weaker evidence and is stored as exactly that, so a
      // later reader is never misled about what was actually observed.
      recorded.push(upsert(store, {
        task, unit: cs.unit, case: cs.id, key: cs.key,
        matched_test: null,
        failed_at: at,
        contract_hash: contractHash,
        gate_command: testResult.command,
        confidence: CONFIDENCE.exitCodeOnly,
        note: 'the suite was red but individual test names could not be parsed from this runner; this proof records that the gate failed, not that this specific case did',
      }));
    } else {
      unmatched.push(cs);
    }
  }

  saveProofs(root, store);
  return { recorded, unmatched, suiteWasRed, namesKnown };
}

function upsert(store, entry) {
  const i = store.entries.findIndex((e) => e.task === entry.task && e.key === entry.key);
  if (i === -1) store.entries.push(entry);
  else store.entries[i] = entry;
  return entry;
}

/**
 * Check every declared case has a red proof, and that the proof still refers to
 * the contract as it stands now.
 *
 * A stale proof (recorded against an older contract hash) is reported
 * separately from a missing one. It is not automatically invalid - contracts
 * legitimately gain cases - but it does mean the case was proven against a
 * different agreement, and whoever reads the report should know.
 */
export function checkRedProof(root, { task, contractHash, cases }) {
  const store = loadProofs(root);
  const forTask = store.entries.filter((e) => e.task === task);

  const missing = [];
  const stale = [];
  const weak = [];
  const proven = [];

  for (const cs of cases) {
    const e = forTask.find((x) => x.key === cs.key);
    if (!e) { missing.push(cs); continue; }
    if (e.contract_hash && contractHash && e.contract_hash !== contractHash) stale.push({ case: cs, proof: e });
    if (e.confidence === CONFIDENCE.exitCodeOnly) weak.push({ case: cs, proof: e });
    proven.push({ case: cs, proof: e });
  }

  return { proven, missing, stale, weak, total: cases.length };
}

export function clearProofs(root, task = null) {
  const store = loadProofs(root);
  store.entries = task ? store.entries.filter((e) => e.task !== task) : [];
  saveProofs(root, store);
  return store;
}
