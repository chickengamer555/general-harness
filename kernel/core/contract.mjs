// Task contracts: discovery, the completeness gate, and locking.
// SPDX-License-Identifier: MIT
//
// A task contract is deliberately small. It is not a design document and it is
// not a ticket - it is the shortest possible statement of what must become true,
// written down BEFORE the code, in a form a machine can check afterwards.
//
// The gate below enforces the few properties that make it worth writing at all:
// every clause observable, every unit carrying a probe case, every case tied to
// a clause. A contract that fails these is documentation, not a contract.

import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';
import { canonicalHash } from './canonical-hash.mjs';

const IGNORE_DIRS = new Set(['node_modules', 'dist', 'build', 'out', 'target', 'coverage', 'vendor', '__pycache__']);

export function findContracts(root, acc = []) {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (IGNORE_DIRS.has(e.name) || e.name.startsWith('.')) continue;
      findContracts(join(root, e.name), acc);
    } else if (e.name.endsWith('.task.json')) {
      acc.push(join(root, e.name));
    }
  }
  return acc;
}

export const TIERS = ['quick', 'standard', 'full'];

export function validateContract(c, where = '<contract>') {
  const errs = [];
  const at = (m) => errs.push(where + ': ' + m);

  if (!c || typeof c !== 'object') return [where + ': not a JSON object'];
  if (!c.task || typeof c.task !== 'string') at('missing "task" (the task id)');
  if (!c.title) at('missing "title"');
  if (!c.description || c.description.length < 10) {
    at('missing or trivial "description" - state what must become true, in language the person who asked for it would recognise');
  }
  if (c.tier && !TIERS.includes(c.tier)) at('tier "' + c.tier + '" is not one of ' + TIERS.join(' | '));

  /* --- clauses ---------------------------------------------------------- */
  if (!Array.isArray(c.clauses) || c.clauses.length === 0) {
    at('needs at least one clause - a contract with no requirement in it agrees to nothing');
  } else {
    const seen = new Set();
    for (const cl of c.clauses) {
      if (!cl.id) { at('a clause has no id'); continue; }
      if (seen.has(cl.id)) at('duplicate clause id "' + cl.id + '"');
      seen.add(cl.id);
      if (!cl.text) at('clause "' + cl.id + '" has no text');
      if (!cl.observable_by) {
        at('clause "' + cl.id + '" has no "observable_by" - if you cannot say how a machine would tell this clause was met, it is a wish, not a requirement. Sharpen it or move it to open_questions.');
      }
    }
  }

  /* --- units and cases -------------------------------------------------- */
  if (!Array.isArray(c.units) || c.units.length === 0) {
    at('needs at least one unit');
  } else {
    const unitIds = new Set();
    const clauseIds = new Set((c.clauses ?? []).map((x) => x.id));
    const coveredClauses = new Set();

    for (const u of c.units) {
      if (!u.id) { at('a unit has no id'); continue; }
      if (unitIds.has(u.id)) at('duplicate unit id "' + u.id + '"');
      unitIds.add(u.id);

      if (!Array.isArray(u.cases) || u.cases.length === 0) {
        at('unit "' + u.id + '" declares no cases - nothing will be checked');
        continue;
      }
      const caseIds = new Set();
      for (const cs of u.cases) {
        if (!cs.id) { at('a case in unit "' + u.id + '" has no id'); continue; }
        if (caseIds.has(cs.id)) at('duplicate case id "' + cs.id + '" in unit "' + u.id + '"');
        caseIds.add(cs.id);
        if (!cs.description) at('case "' + u.id + '/' + cs.id + '" has no description');
        if ('reported' in cs) {
          if (typeof cs.reported !== 'string' || !cs.reported.trim()) {
            at('case "' + u.id + '/' + cs.id + '" has an empty "reported" - put the user\'s own words for the symptom there');
          } else if (cs.guard) {
            at('case "' + u.id + '/' + cs.id + '" is both "reported" and a "guard" - a reported bug was red by definition, and its red proof is the evidence the fix is real');
          }
        }
        if (cs.maps_to_clause) {
          if (!clauseIds.has(cs.maps_to_clause)) {
            at('case "' + u.id + '/' + cs.id + '" maps to unknown clause "' + cs.maps_to_clause + '"');
          } else {
            coveredClauses.add(cs.maps_to_clause);
          }
        }
      }
      if (!u.cases.some((cs) => cs.probe)) {
        at('unit "' + u.id + '" has no probe case - only the happy path is covered. Add at least one "probe": true case: the empty input, the boundary, the hostile value, the failure path.');
      }
    }

    for (const id of clauseIds) {
      if (!coveredClauses.has(id)) {
        at('clause "' + id + '" has no case mapped to it - it is agreed but unproven, which is the hole this contract exists to prevent');
      }
    }
  }

  return errs;
}

export function loadContract(path) {
  const rel = relative(process.cwd(), path);
  let contract;
  try {
    contract = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    return { path, contract: null, hash: null, errors: [rel + ': invalid JSON - ' + e.message] };
  }
  const errors = validateContract(contract, rel);
  return {
    path,
    dir: dirname(path),
    contract,
    hash: errors.length === 0 ? canonicalHash(contract) : null,
    errors,
  };
}

export function loadAll(root, filterTask = null) {
  const out = [];
  for (const p of findContracts(resolve(root)).sort()) {
    const loaded = loadContract(p);
    if (filterTask && loaded.contract?.task !== filterTask) continue;
    out.push(loaded);
  }
  const seen = new Map();
  for (const u of out) {
    const id = u.contract?.task;
    if (!id) continue;
    if (seen.has(id)) {
      u.errors.push('duplicate task id "' + id + '" - also declared in ' + relative(process.cwd(), seen.get(id)));
    } else seen.set(id, u.path);
  }
  return out;
}

/** Every declared case, flattened, for matching against test results. */
export function allCases(contract) {
  const out = [];
  for (const u of contract.units ?? []) {
    for (const cs of u.cases ?? []) {
      out.push({ unit: u.id, ...cs, key: u.id + '/' + cs.id });
    }
  }
  return out;
}
