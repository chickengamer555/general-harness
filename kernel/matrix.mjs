// The matrix — gate + integrity + red proof, folded into one verdict.
// SPDX-License-Identifier: MIT
//
// One source of truth, three consumers: CI, the terminal grid, and an
// orchestrating agent between builder turns. Same code, same result, and no
// path by which an agent's *claim* about a result becomes the record.
//
// Three legs, and all three have to hold:
//   gate       - the project's own test/lint/typecheck commands
//   integrity  - the checks the gate structurally cannot run on itself
//   red proof  - evidence each case was seen failing before it passed
// plus the lock: the tests, contracts and config the other three trust, hashed.
//
// A run is green only when every leg is green. Green tests with a focused test
// left in the file is not green; it is a suite that stopped running most of
// itself and said nothing.

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { VERDICT } from './core/types.mjs';
import { detectStack } from './core/stacks.mjs';
import { runTests, runAux, excerpt, isTrivialCommand } from './core/gate.mjs';
import { runIntegrity } from './core/quality.mjs';
import { loadAll, allCases } from './core/contract.mjs';
import { checkRedProof } from './core/redproof.mjs';
import { lockLeg, strictestTier } from './core/lock.mjs';

export const CONFIG_FILE = 'general-harness.config.json';

export function loadConfig(dir) {
  const p = join(resolve(dir), CONFIG_FILE);
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    throw new Error(CONFIG_FILE + ' is not valid JSON: ' + e.message);
  }
}

/**
 * Resolve the gate. An explicit gate in the config always wins over detection —
 * the project knows its own build better than any heuristic, and a harness that
 * insists otherwise is one people work around.
 */
export function resolveGate(dir, config) {
  const detected = detectStack(dir);
  const gate = { ...detected.gate, ...(config.gate ?? {}) };
  // `runner` only selects which output parser to use. Declaring it explicitly
  // matters when the gate is a custom command detection cannot classify - it is
  // the difference between named failing tests and exit-code-only evidence, and
  // therefore between a strong red proof and a weak one.
  return {
    ...detected,
    gate,
    runner: config.runner ?? detected.runner,
    gateSource: config.gate ? 'config' : detected.stack ? 'detected' : 'none',
  };
}

export async function runMatrix({ dir = '.', task = null, requireRedProof = false, skipGate = false } = {}) {
  const root = resolve(dir);
  const config = loadConfig(root);
  const resolved = resolveGate(root, config);
  const contractsDir = config.contractsDir ? resolve(root, config.contractsDir) : root;

  const units = await loadAll(contractsDir, task);
  const contractErrors = units.flatMap((u) => u.errors);
  const legs = [];

  /* ------------------------------- lock -------------------------------- */
  const tier = strictestTier(units.map((u) => u.contract?.tier));
  legs.push(lockLeg(root, config, tier));

  /* ------------------------------- gate -------------------------------- */
  let testResult = null;
  if (!skipGate) {
    if (typeof resolved.gate.test === 'string' && isTrivialCommand(resolved.gate.test)) {
      legs.push(trivialLeg('test', resolved.gate.test));
    } else if (!resolved.gate.test) {
      legs.push({
        leg: 'test',
        verdict: VERDICT.BLOCKED,
        blockedReason:
          'no test command could be resolved. The stack was ' +
          (resolved.stack ? 'detected as ' + resolved.label + ' but exposes no test script' : 'not recognised') +
          '. Declare one explicitly in ' + CONFIG_FILE + ' under "gate": { "test": "..." }.',
      });
    } else {
      testResult = runTests(resolved.gate.test, root, resolved.runner);
      legs.push({
        leg: 'test',
        command: resolved.gate.test,
        verdict: testResult.verdict,
        blockedReason: testResult.blockedReason,
        durationMs: testResult.durationMs,
        counts: testResult.counts,
        failing: testResult.failing,
        confidence: testResult.confidence,
        output: testResult.verdict === VERDICT.PASS ? null : excerpt(testResult.stdout + '\n' + testResult.stderr),
      });
    }

    for (const leg of ['lint', 'typecheck']) {
      if (typeof resolved.gate[leg] === 'string' && isTrivialCommand(resolved.gate[leg])) {
        legs.push(trivialLeg(leg, resolved.gate[leg]));
        continue;
      }
      if (!resolved.gate[leg]) continue;
      const r = runAux(resolved.gate[leg], root);
      legs.push({
        leg,
        command: resolved.gate[leg],
        verdict: r.verdict,
        blockedReason: r.blockedReason,
        durationMs: r.durationMs,
        output: r.verdict === VERDICT.PASS ? null : excerpt(r.stdout + '\n' + r.stderr),
      });
    }
  }

  /* ----------------------------- integrity ----------------------------- */
  const integrity = runIntegrity(root, config.quality ?? {}, {
    scanDirs: config.scanDirs ?? null,
  });
  const integrityVerdict = integrity.checks.some((c) => c.status === 'fail') ? VERDICT.FAIL : VERDICT.PASS;
  legs.push({
    leg: 'integrity',
    verdict: integrityVerdict,
    checks: integrity.checks,
    stats: integrity.stats,
  });

  /* ----------------------------- red proof ----------------------------- */
  const redProofs = [];
  for (const u of units) {
    if (!u.contract) continue;
    const cases = allCases(u.contract);
    const rp = checkRedProof(root, { task: u.contract.task, contractHash: u.hash, cases });
    redProofs.push({ task: u.contract.task, ...rp });
  }
  if (units.length) {
    legs.push({
      leg: 'red-proof',
      verdict: unproven(redProofs, requireRedProof).length ? VERDICT.FAIL : VERDICT.PASS,
      required: requireRedProof,
      proofs: redProofs,
    });
  }

  /* ------------------------------ rollup ------------------------------- */
  const summary = rollup({ legs, contractErrors, units, requireRedProof, redProofs });

  return {
    timestamp: new Date().toISOString(),
    root,
    stack: resolved.stack,
    stackLabel: resolved.label,
    runner: resolved.runner,
    gate: resolved.gate,
    gateSource: resolved.gateSource,
    tier,
    contracts: units.map((u) => ({
      task: u.contract?.task ?? null,
      path: u.path,
      hash: u.hash,
      errors: u.errors,
      clauses: (u.contract?.clauses ?? []).length,
      cases: u.contract ? allCases(u.contract).length : 0,
      probes: u.contract ? allCases(u.contract).filter((c) => c.probe).length : 0,
      tier: u.contract?.tier ?? null,
    })),
    legs,
    contractErrors,
    summary,
  };
}

function trivialLeg(leg, command) {
  return {
    leg,
    command,
    verdict: VERDICT.FAIL,
    reason: 'the ' + leg + ' command ' + JSON.stringify(command) + ' tests nothing - it cannot fail, so its green is a constant. ' +
      'Declare the real command in ' + CONFIG_FILE + ', or null to disable the leg openly.',
  };
}

/**
 * The missing proofs that break the run. A case the user reported always
 * counts, in every tier: a fix for a bug nobody reproduced is a guess.
 */
function unproven(redProofs, requireRedProof) {
  return redProofs.flatMap((r) =>
    r.missing.filter((m) => requireRedProof || m.reported).map((m) => r.task + '/' + m.key));
}

export function rollup({ legs, contractErrors, units, requireRedProof, redProofs }) {
  const breakers = [];

  for (const l of legs) {
    if (l.verdict === VERDICT.FAIL) {
      if (l.leg === 'integrity') {
        const first = l.checks.find((c) => c.status === 'fail');
        breakers.push('integrity: ' + first.label + (first.detail ? ' - ' + first.detail : ''));
      } else if (l.leg === 'red-proof') {
        const miss = unproven(redProofs, requireRedProof);
        breakers.push(
          'red-proof: ' + miss.length + ' case(s) never observed failing before they passed (' +
          miss.slice(0, 4).join(', ') + ') - a test that was never red has not been shown to be wired to anything'
        );
      } else if (l.reason) {
        breakers.push(l.leg + ': ' + l.reason);
      } else {
        breakers.push(l.leg + ': failed (' + (l.command ?? 'no command') + ')');
      }
    } else if (l.verdict === VERDICT.BLOCKED) {
      breakers.push(l.leg + ': BLOCKED - ' + (l.blockedReason ?? 'could not run'));
    }
  }

  if (contractErrors.length) {
    breakers.push('contract: ' + contractErrors[0]);
  }

  const failed = legs.filter((l) => l.verdict === VERDICT.FAIL).length;
  const blocked = legs.filter((l) => l.verdict === VERDICT.BLOCKED).length;
  const green = failed === 0 && blocked === 0 && contractErrors.length === 0;

  return {
    verdict: green ? 'green' : 'red',
    reason: green ? null : breakers[0],
    breakers,
    legs: legs.length,
    failed,
    blocked,
    contracts: units.length,
    redProofRequired: !!requireRedProof,
  };
}
