// Tests for the matrix rollup's red-proof leg.
// SPDX-License-Identifier: MIT

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runMatrix } from '../kernel/matrix.mjs';
import { VERDICT } from '../kernel/core/types.mjs';
import { tempProject } from './helpers.mjs';

function contractWith(caseFields) {
  return JSON.stringify({
    task: 'bug',
    title: 'A bug',
    description: 'The thing the user said was broken is no longer broken.',
    clauses: [{ id: 'A1', text: 'It works again.', observable_by: 'a test passes' }],
    units: [{ id: 'u', cases: [{ id: 'c', description: 'the symptom', probe: true, maps_to_clause: 'A1', ...caseFields }] }],
  });
}

async function redProofLeg(caseFields) {
  const p = tempProject({ 'bug.task.json': contractWith(caseFields) });
  try {
    const report = await runMatrix({ dir: p.root, skipGate: true });
    return { leg: report.legs.find((l) => l.leg === 'red-proof'), summary: report.summary };
  } finally {
    p.cleanup();
  }
}

test('a reported case needs red proof even in a quick run', async () => {
  const { leg, summary } = await redProofLeg({ reported: 'the save button does nothing' });
  assert.equal(leg.verdict, VERDICT.FAIL,
    'a fix for a reported bug that was never reproduced is a guess, whatever the tier');
  assert.ok(summary.breakers.some((b) => b.startsWith('red-proof') && b.includes('bug/u/c')));
});

test('an unreported case stays advisory without a proof in a quick run', async () => {
  const { leg } = await redProofLeg({});
  assert.equal(leg.verdict, VERDICT.PASS);
});
