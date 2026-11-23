---
description: Run the builder <-> critic loop against a task contract until the matrix is green, the red proofs hold, and both agents agree. The orchestrator runs the matrix between turns.
argument-hint: <task-slug>
allowed-tools: Read, Write, Edit, Glob, Grep, Agent, Bash
---

You are the **orchestrator**. Run the build loop for task **`$1`**. The turn
protocol, stance rotation and termination breakers are in
`<kernel>/skills/loop-orchestration/SKILL.md` - read it first; this file only
holds the concrete steps.

Stream one line per turn, e.g. `t1 matrix red (2 tests); critic(tautology-hawk) -> revise`. Read artifacts only when something fails.

## Preconditions

1. The contract is valid: `node <kernel>/kernel/bin/general-verify.mjs lint --task $1`.
2. The gate resolves: `node <kernel>/kernel/bin/general-verify.mjs detect`. If no test command resolves, stop and ask the user to declare one in `general-harness.config.json`. Never guess.
3. At standard or full tier the lock exists (`general-verify --lock`, taken once the red proofs are recorded); without it the run is BLOCKED. If the lock leg reports drift in a contract, the goalpost moved since it was agreed: stop and re-negotiate.
4. Open or continue `verify/runs/<run-id>/` and its `trace.jsonl`.

## Each turn N (cap 20)

1. **Dispatch the builder** (`subagent_type: gen-builder`) with the contract and, on N > 1, `score_t<N-1>.json` with `highest_impact_change` quoted verbatim. It writes the test first, records the red proof, implements, and writes `handoff_t<N>.json`.
2. **Run the matrix yourself:**
   ```
   node <kernel>/kernel/bin/general-verify.mjs --task $1 --require-red-proof --json verify/runs/<id>/raw_t<N>.json
   ```
   Map it into `verification_t<N>.json` per `schemas/verification.schema.json`, record `new_passing_since_last_turn`, append a `verifier_ran` trace line. A BLOCKED leg is an environment problem, not a Builder failure.
3. **Dispatch the critic** (`subagent_type: gen-critic`, this turn's stance) with the contract, the handoff and the verification file. It writes `score_t<N>.json`.
4. **Evaluate the breakers** from loop-orchestration. A Builder `dispute` stops the run: put it to the user as fix the code, the clause, or the check.

On any terminal outcome write `summary.json` per `schemas/summary.schema.json`.

## Output

A green matrix or an honest abort naming its reason, the handoff / verification / score trail, `summary.json`, and what a green gate here does **not** prove.
