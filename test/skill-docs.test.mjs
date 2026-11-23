// Tests for the skill, command and agent documents: size, routing, and
// references that still point at something.
// SPDX-License-Identifier: MIT

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Repo-specific: the entry skill, the neighbours its description must name,
// and the skills outside this repo that the documents may mention.
const MAIN = 'general-harness';
const NEIGHBOURS = ['web-harness', 'godot-verify:godot-harness', 'taste-skill'];
const EXTERNAL = new Set(['web-harness', 'godot-verify:godot-harness', 'taste-skill']);

const SKILL_CAP = 8192;
const REPO_DIRS = ['kernel', 'skills', 'commands', 'agents', 'schemas', 'example', 'docs'];
const TRIGGERS = 'docs/skill-triggers.md';

const read = (rel) => readFileSync(join(REPO, rel), 'utf8');
const list = (dir, suffix) => readdirSync(join(REPO, dir)).filter((f) => f.endsWith(suffix)).map((f) => dir + '/' + f);
const skillDirs = () => readdirSync(join(REPO, 'skills')).filter((d) => existsSync(join(REPO, 'skills', d, 'SKILL.md')));
const docs = () => [...skillDirs().map((d) => 'skills/' + d + '/SKILL.md'), ...list('commands', '.md'), ...list('agents', '.md')];

function frontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  const out = {};
  for (const line of (m ? m[1] : '').split(/\r?\n/)) {
    const kv = line.match(/^([a-z-]+):\s*(.*)$/);
    if (kv) out[kv[1]] = kv[2];
  }
  return out;
}

const skillNames = () => new Set(skillDirs().flatMap((d) => [d, frontmatter(read('skills/' + d + '/SKILL.md')).name]));
const agentNames = () => new Set(list('agents', '.md').map((f) => frontmatter(read(f)).name));

/** Repo files a document points at: <kernel>/x anywhere, and backticked repo-relative paths. */
function pathRefs(text) {
  const out = new Set();
  for (const m of text.matchAll(/<kernel>\/([^\s`'"()\]]+)/g)) out.add(m[1]);
  const lead = new RegExp('^(?:' + REPO_DIRS.join('|') + ')/');
  for (const m of text.matchAll(/`([^`\s]+)`/g)) if (lead.test(m[1])) out.add(m[1]);
  return [...out].map((p) => p.replace(/[.,;:]+$/, '')).filter((p) => !/[<>*${}]/.test(p));
}

function deadRefs(rel) {
  const text = read(rel);
  const dead = [];
  for (const p of pathRefs(text)) if (!existsSync(join(REPO, p))) dead.push(p);
  const skills = skillNames();
  for (const m of text.matchAll(/`([a-z0-9:-]+)` skill/g)) {
    if (!skills.has(m[1]) && !EXTERNAL.has(m[1])) dead.push('skill ' + m[1]);
  }
  for (const m of text.matchAll(/`\/([a-z][a-z0-9-]*)[`\s]/g)) {
    if (!existsSync(join(REPO, 'commands', m[1] + '.md')) && !skills.has(m[1]) && !EXTERNAL.has(m[1])) dead.push('command /' + m[1]);
  }
  const agents = agentNames();
  for (const m of text.matchAll(/subagent_type:\s*`?([a-z0-9-]+)/g)) if (!agents.has(m[1])) dead.push('agent ' + m[1]);
  return dead.map((d) => rel + ': ' + d);
}

function publicFiles() {
  const out = [...docs(), 'README.md', 'CLAUDE.md'];
  if (existsSync(join(REPO, 'docs'))) out.push(...list('docs', '.md'));
  return out.filter((f) => existsSync(join(REPO, f)));
}

test('skill-md-under-cap: every SKILL.md is at most 8 KB', () => {
  const over = skillDirs()
    .map((d) => ['skills/' + d + '/SKILL.md', statSync(join(REPO, 'skills', d, 'SKILL.md')).size])
    .filter(([, size]) => size > SKILL_CAP)
    .map(([f, size]) => f + ' is ' + size + ' bytes');
  assert.deepEqual(over, []);
});

test('no-dead-references: every path, skill, command and agent a document names exists', () => {
  assert.deepEqual(docs().flatMap(deadRefs), []);
});

test('no-personal-paths: no absolute home path or email address in a public document', () => {
  const hits = [];
  const patterns = [/\/home\/[A-Za-z0-9_-]+/, /\/Users\/[A-Za-z0-9_-]+/, /[A-Za-z]:\\Users\\/, /[\w.+-]+@[\w-]+\.[a-z]{2,}/];
  for (const f of publicFiles()) {
    const text = read(f);
    for (const re of patterns) {
      const m = text.match(re);
      if (m) hits.push(f + ': ' + m[0]);
    }
  }
  assert.deepEqual(hits, []);
});

test('descriptions-route-not-summarise: each description says when to use it and names what it is not for', () => {
  const bad = [];
  for (const d of skillDirs()) {
    const desc = frontmatter(read('skills/' + d + '/SKILL.md')).description ?? '';
    if (!/^Use when /.test(desc)) bad.push(d + ': does not start with "Use when"');
    if (!desc.includes('Not for:')) bad.push(d + ': no "Not for:"');
    if (d === MAIN) for (const n of NEIGHBOURS) if (!desc.includes(n)) bad.push(d + ': does not name ' + n);
  }
  assert.deepEqual(bad, []);
});

test('iron-rules-lead: the first 40 lines of the entry skill carry the rules that must survive compaction', () => {
  const head = read('skills/' + MAIN + '/SKILL.md').split(/\r?\n/).slice(0, 40).join('\n');
  const missing = ['matrix', 'reported', 'red', 'locked', '--relock', 'dispute', 'fixed'].filter((w) => !head.includes(w));
  assert.deepEqual(missing, []);
});

test('trigger-evals-listed: skill-triggers.md lists 3-6 should-trigger and 3-6 near-miss prompts per skill', () => {
  assert.ok(existsSync(join(REPO, TRIGGERS)), TRIGGERS + ' exists');
  const sections = new Map(read(TRIGGERS).split(/^## /m).slice(1).map((s) => [s.split(/\r?\n/)[0].trim(), s]));
  const bad = [];
  for (const d of skillDirs()) {
    const s = sections.get(d);
    if (!s) { bad.push(d + ': no section'); continue; }
    for (const head of ['Should trigger', 'Near miss']) {
      const part = s.split(/^### /m).find((p) => p.startsWith(head));
      const n = part ? part.split(/\r?\n/).filter((l) => /^- /.test(l)).length : 0;
      if (n < 3 || n > 6) bad.push(d + ': ' + head + ' has ' + n);
    }
  }
  assert.deepEqual(bad, []);
});
