// Tests for the dispute exit: the schema shape and the loop documents.
// SPDX-License-Identifier: MIT

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(REPO, rel), 'utf8');
const json = (rel) => JSON.parse(read(rel));

const BUILDER_RULE = 'If a test and the contract disagree, follow the contract and raise a dispute; never edit a locked file to get green.';
const LOOP_DOCS = ['agents/builder.md', 'agents/critic.md', 'commands/gh-build.md', 'skills/loop-orchestration/SKILL.md'];

test('the handoff schema accepts dispute as a builder self-verdict', () => {
  const s = json('schemas/handoff.schema.json');
  assert.ok(s.properties.builder_self_verdict.enum.includes('dispute'));
  assert.ok(s.properties.builder_self_verdict.enum.includes('pass'));
});

test('a dispute verdict requires a dispute object naming clause, conflicts_with and because', () => {
  const s = json('schemas/handoff.schema.json');
  const rule = (s.allOf ?? []).find((r) => r.if?.properties?.builder_self_verdict);
  assert.ok(rule, 'an if/then keyed on builder_self_verdict');
  assert.equal(rule.if.properties.builder_self_verdict.const, 'dispute');
  assert.deepEqual(rule.then.required, ['dispute']);
  const d = s.properties.dispute;
  assert.equal(d.type, 'object');
  assert.deepEqual([...d.required].sort(), ['because', 'clause', 'conflicts_with']);
  for (const k of d.required) assert.equal(d.properties[k].type, 'string');
});

test('the summary schema has a disputed termination reason', () => {
  const s = json('schemas/summary.schema.json');
  assert.ok(s.properties.termination_reason.enum.includes('disputed'));
});

test('every loop document routes a dispute to the human as a three-way choice', () => {
  for (const rel of LOOP_DOCS) {
    const text = read(rel).replace(/\s+/g, ' ');
    assert.match(text, /dispute/, rel + ' mentions the dispute verdict');
    assert.match(text, /fix the code, the clause, or the check/i, rel + ' names the three-way choice');
  }
});

test('the builder prompt says to follow the contract and never edit a locked file', () => {
  assert.ok(read('agents/builder.md').replace(/\s+/g, ' ').includes(BUILDER_RULE));
});
