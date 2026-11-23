// The run lock — a sha256 of everything that decides what green means.
// SPDX-License-Identifier: MIT
//
// A contract hash proves the agreement did not move. It says nothing about the
// tests that check it, or the config that names the gate: edit a test until it
// passes, or set the gate to `true`, and every contract still hashes the same.
// The lock covers those files too, and every run recomputes it, so a change to
// what the run trusts is a named failure rather than a quiet green.
//
// Locked: every task contract, every test file a unit maps to or the gate test
// command names (literal paths and globs), and the harness config. Not locked:
// source under test - changing that is the Builder's job.

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, relative, sep, isAbsolute } from 'node:path';
import { findContracts, TIERS } from './contract.mjs';
import { STORE_DIR } from './redproof.mjs';
import { VERDICT } from './types.mjs';

export const LOCK_VERSION = 1;
export const LOCK_FILE = 'lock.json';
export const HISTORY_FILE = 'lock-history.jsonl';
const CONFIG_FILE = 'general-harness.config.json';
const IGNORE_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'target', 'coverage', 'vendor', '__pycache__']);

export const lockPath = (root) => join(root, STORE_DIR, LOCK_FILE);
export const historyPath = (root) => join(root, STORE_DIR, HISTORY_FILE);

const posix = (p) => p.split(sep).join('/');

/** sha256 of a file with CRLF folded to LF, so a Windows checkout is not drift. */
export function hashFile(path) {
  const text = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function globToRegExp(segment) {
  return new RegExp('^' + segment.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]') + '$');
}

/** Expand a relative glob (`*`, `?`, `**`) under root. No dependency. */
export function expandGlob(root, pattern) {
  const parts = posix(pattern).replace(/^\.\//, '').split('/').filter(Boolean);
  const out = [];
  const walk = (dir, i) => {
    if (i === parts.length) return;
    const part = parts[i];
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (part === '**') {
      walk(dir, i + 1);
      for (const e of entries) {
        if (e.isDirectory() && !IGNORE_DIRS.has(e.name) && !e.name.startsWith('.')) walk(join(dir, e.name), i);
      }
      return;
    }
    const re = globToRegExp(part);
    for (const e of entries) {
      if (!re.test(e.name)) continue;
      const p = join(dir, e.name);
      if (i === parts.length - 1) { if (e.isFile()) out.push(p); }
      else if (e.isDirectory()) walk(p, i + 1);
    }
  };
  walk(root, 0);
  return out;
}

/** Paths and globs named in a gate command: quoted or bare tokens that are files or contain a wildcard. */
function gateFiles(root, command) {
  const out = [];
  for (const m of String(command ?? '').matchAll(/"([^"]+)"|'([^']+)'|(\S+)/g)) {
    const tok = m[1] ?? m[2] ?? m[3];
    if (tok.startsWith('-') || isAbsolute(tok)) continue;
    if (/[*?]/.test(tok)) out.push(...expandGlob(root, tok));
    else if (existsSync(join(root, tok)) && statSync(join(root, tok)).isFile()) out.push(join(root, tok));
  }
  return out;
}

function contractsDir(root, config) {
  return config.contractsDir ? resolve(root, config.contractsDir) : root;
}

/** Every file the run trusts, as sorted root-relative posix paths. */
export function trustedFiles(root, config) {
  const files = new Set();
  const add = (p) => { if (existsSync(p)) files.add(posix(relative(root, p))); };

  for (const c of findContracts(contractsDir(root, config))) {
    add(c);
    let contract;
    try {
      contract = JSON.parse(readFileSync(c, 'utf8'));
    } catch {
      continue;
    }
    for (const u of contract?.units ?? []) {
      for (const t of [u.tests ?? []].flat()) {
        if (typeof t !== 'string') continue;
        if (/[*?]/.test(t)) expandGlob(root, t).forEach(add);
        else add(join(root, t));
      }
    }
  }
  gateFiles(root, config.gate?.test).forEach(add);
  add(join(root, CONFIG_FILE));
  return [...files].sort();
}

export function computeLock(root, config) {
  const files = {};
  for (const rel of trustedFiles(root, config)) files[rel] = hashFile(join(root, rel));
  return { version: LOCK_VERSION, files };
}

export function readLock(root) {
  const p = lockPath(root);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    return { invalid: e.message };
  }
}

export function diffLock(locked, current) {
  const before = locked?.files ?? {};
  const after = current.files;
  const changed = Object.keys(after).filter((k) => k in before && before[k] !== after[k]).sort();
  const added = Object.keys(after).filter((k) => !(k in before)).sort();
  const removed = Object.keys(before).filter((k) => !(k in after)).sort();
  return { changed, added, removed };
}

function changeList(d) {
  return [
    ...d.changed.map((path) => ({ path, status: 'changed' })),
    ...d.added.map((path) => ({ path, status: 'added' })),
    ...d.removed.map((path) => ({ path, status: 'removed' })),
  ].sort((a, b) => a.path.localeCompare(b.path));
}

function save(root, lock) {
  mkdirSync(join(root, STORE_DIR), { recursive: true });
  writeFileSync(lockPath(root), JSON.stringify({ ...lock, at: new Date().toISOString() }, null, 2) + '\n');
}

/** --lock: write a first lock, or confirm an existing one. Refuses over drift. */
export function writeLock(root, config) {
  const current = computeLock(root, config);
  const existing = readLock(root);
  if (existing && !existing.invalid) {
    const changed = changeList(diffLock(existing, current));
    if (changed.length || existing.version !== LOCK_VERSION) {
      throw new Error('the existing lock does not match (' +
        (changed.length ? changed.map((c) => c.path + ' ' + c.status).join(', ') : 'lock version ' + existing.version) +
        '). Locking over drift would hide it - run --relock --reason "<why>" instead.');
    }
    return { written: false, lock: existing };
  }
  save(root, current);
  return { written: true, lock: current };
}

/** --relock: rewrite the lock and record why, and what moved. */
export function relock(root, config, reason) {
  if (!reason || !String(reason).trim()) {
    throw new Error('--relock needs --reason "<why>" - a relock without a stated reason is a goalpost moved in silence');
  }
  const current = computeLock(root, config);
  const existing = readLock(root);
  const changed = changeList(diffLock(existing?.invalid ? null : existing, current));
  save(root, current);
  mkdirSync(join(root, STORE_DIR), { recursive: true });
  appendFileSync(historyPath(root), JSON.stringify({ time: new Date().toISOString(), reason: String(reason).trim(), changed }) + '\n');
  return { changed, lock: current };
}

/** The strictest tier among the selected contracts; a contract with none is quick. */
export function strictestTier(tiers) {
  return tiers.reduce((acc, t) => (TIERS.indexOf(t ?? 'quick') > TIERS.indexOf(acc) ? t : acc), 'quick');
}

/** The lock leg of a run. */
export function lockLeg(root, config, tier) {
  const rel = posix(relative(root, lockPath(root)));
  const existing = readLock(root);
  if (!existing) {
    if (tier === 'quick') {
      return { leg: 'lock', verdict: VERDICT.SKIP, tier, reason: 'no lock at ' + rel + ' - allowed in quick tier' };
    }
    return {
      leg: 'lock',
      verdict: VERDICT.BLOCKED,
      tier,
      blockedReason: 'no lock at ' + rel + ' and the strictest selected tier is ' + tier +
        ' - nothing pins the tests and config this run trusts. Run general-verify --lock.',
    };
  }
  if (existing.invalid || existing.version !== LOCK_VERSION) {
    return {
      leg: 'lock',
      verdict: VERDICT.FAIL,
      tier,
      changed: [], added: [], removed: [],
      reason: rel + (existing.invalid ? ' is not valid JSON' : ' was written by lock schema version ' + existing.version +
        ', this kernel writes version ' + LOCK_VERSION) + ' - run --relock --reason "<why>"',
    };
  }
  const d = diffLock(existing, computeLock(root, config));
  const drift = d.changed.length + d.added.length + d.removed.length;
  if (!drift) return { leg: 'lock', verdict: VERDICT.PASS, tier, files: Object.keys(existing.files).length, ...d };
  const parts = [];
  if (d.changed.length) parts.push('changed: ' + d.changed.join(', '));
  if (d.added.length) parts.push('added: ' + d.added.join(', '));
  if (d.removed.length) parts.push('removed: ' + d.removed.join(', '));
  return {
    leg: 'lock',
    verdict: VERDICT.FAIL,
    tier,
    ...d,
    reason: 'drift against ' + rel + ' (' + parts.join('; ') + ') - a trusted file moved after locking. If that was agreed, run --relock --reason "<why>"; if not, put it back.',
  };
}
