// general-verify — shared vocabulary.
// SPDX-License-Identifier: MIT
//
// Deliberately the same words as web-harness and assembly-harness, so an agent
// or a person who knows one harness can read the others without relearning:
//   contract · case · probe · gate · verdict · matrix · handoff · score
//
// Verdict taxonomy (four-way, and the fourth one is the important one):
//   PASS    — observed and right
//   FAIL    — observed and wrong
//   BLOCKED — could NOT observe: the gate would not run, the toolchain is
//             missing, the command errored before testing anything. An honest
//             "I don't know", and never reported as either green or red.
//   SKIP    — nothing to observe

export const VERDICT = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  BLOCKED: 'BLOCKED',
  SKIP: 'SKIP',
});

export const STATUS = Object.freeze({
  ok: 'ok',
  fail: 'fail',
  warn: 'warn',
  probe: 'probe',
});

export function check(verifier, status, label, detail, evidence) {
  const c = { verifier, status, label };
  if (detail !== undefined) c.detail = detail;
  if (evidence !== undefined) c.evidence = evidence;
  return c;
}

export function verdictOf(checks) {
  return checks.some((c) => c.status === STATUS.fail) ? VERDICT.FAIL : VERDICT.PASS;
}

export const PROTOCOL_VERSION = '1.0.0';

/**
 * How much confidence to place in a parsed result.
 *
 * `exact` means individual test names were parsed out of a structured report.
 * `heuristic` means names came from scraping human-readable output, so a name
 * may be missed or mangled. `exit-code-only` means nothing could be parsed and
 * all we know is whether the command succeeded.
 *
 * This is surfaced rather than hidden on purpose: a red-proof built on
 * exit-code-only evidence is much weaker than one built on named failures, and
 * whoever reads the report deserves to know which they are looking at.
 */
export const CONFIDENCE = Object.freeze({
  exact: 'exact',
  heuristic: 'heuristic',
  exitCodeOnly: 'exit-code-only',
});
