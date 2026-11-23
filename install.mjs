#!/usr/bin/env node
// Install (or refresh) the global /general-harness skill. The portable twin of
// install-skill.ps1: plain Node, no dependencies, any OS.
//
// Copies skills/general-harness into ~/.claude/skills, substitutes this clone's path for
// <kernel> so the commands in the installed copy run as written, and stamps the
// commit it came from. Re-run it after editing the skill - the copy does not
// track the repo.
//
//   node install.mjs

import { cpSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const NAME = 'general-harness';
const here = dirname(fileURLToPath(import.meta.url));
const root = here.replaceAll('\\', '/');
const dst = join(homedir(), '.claude', 'skills', NAME);
const skill = join(dst, 'SKILL.md');

const git = (...args) => execFileSync('git', ['-C', here, ...args], { encoding: 'utf8' }).trim();
const sha = git('rev-parse', 'HEAD');
const dirty = git('status', '--porcelain', '--', 'skills/' + NAME) ? ' plus uncommitted changes' : '';

rmSync(dst, { recursive: true, force: true });
cpSync(join(here, 'skills', NAME), dst, { recursive: true });

// The stamp goes after the frontmatter: anything ahead of the opening ---
// stops the skill being parsed.
const text = readFileSync(skill, 'utf8')
  .replaceAll('<kernel>', root)
  .replace(/^---\r?\n[\s\S]*?\n---\r?\n/, (fm) => fm + '<!-- installed by install.mjs from ' + root + ' at ' + sha + dirty + ' -->\n');
writeFileSync(skill, text);

if (root.includes(' ')) console.warn('clone path contains a space (' + root + ') - quote it when running the commands in the skill.');
console.log('installed: ' + dst);
console.log('kernel path baked in: ' + root + ' @ ' + sha.slice(0, 12) + dirty);
console.log('Restart Claude Code to pick it up.');
