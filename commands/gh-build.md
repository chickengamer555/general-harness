---
description: Run the builder <-> critic loop against a task contract until the gate is green, the red proofs hold, and both agents agree. The orchestrator runs the matrix between turns so neither agent can fabricate a verdict.
argument-hint: <task-slug>
allowed-tools: Read, Write, Edit, Glob, Grep, Agent, Bash
---

You are the **orchestrator**. Run the build loop for task **`$1`**.

Stream one short line per turn — gate verdict plus critic verdict, e.g. `t1 gate red (2 tests); critic(tautology-hawk) -> revise`. No artifact dumps mid-flight; read them when something fails or when verifying a first-of-its-kind step.

## Preconditions

1. A valid contract exists: `node <kernel>/bin/general-verify.mjs lint --task $1`.
2. Confirm the gate resolves: `node <kernel>/bin/general-verify.mjs detect`. If no test command can be resolved, stop and ask the user to declare one in `general-harness.config.json` — guessing a build command is how a harness destroys a working repo.
3. Re-confirm the contract still hashes to its locked value (`lock --task $1`). A mismatch means the contract moved since it was agreed — re-negotiate rather than building against a moved goalpost.
4. Open or continue `verify/runs/<run-id>/` and its `trace.jsonl`.

## Stance rotation — anti-collusion, load-bearing

The Critic's stance rotates each turn: **`tautology-hawk` -> `edge-case-hawk` -> `failure-mode-hawk` -> `simplicity-hawk` -> `convention-hawk`**, then repeats. Substitute `{{adversarial_stance}}` in the critic dispatch every turn.

Both agents share a model lineage, so drift toward agreement is the primary risk. Rotation is the defence. Two `pass` verdicts in a row with no findings at all is a signal the stance is failing, not that the work is perfect.

## The turn loop (cap: 20 turns)

For turn N = 1, 2, …:

1. **Dispatch the builder** (`subagent_type: gen-builder`). Give it the contract and, on N > 1, the previous `score_t<N-1>.json` with `highest_impact_change` quoted verbatim. It writes the test first, records the red proof, implements, and ends by writing `handoff_t<N>.json`.

2. **Run the matrix yourself.** The verdict comes from you, not from either agent:
   ```
   node <kernel>/bin/general-verify.mjs --task $1 --require-red-proof --json verify/runs/<id>/raw_t<N>.json
   ```
   Map it into `verification_t<N>.json` per `schemas/verification.schema.json`. Record `new_passing_since_last_turn` — it drives the stagnation breaker. Append a `verifier_ran` trace line.

   **Read the BLOCKED legs carefully.** A blocked test leg means the toolchain could not run, not that the code is wrong. Reporting that as a failure sends the Builder to debug working code for a turn. Fix the environment or stop; do not loop on it.

3. **Dispatch the critic** (`subagent_type: gen-critic`, stance = this turn's rotation) with the contract, the handoff, and the verification file. It writes `score_t<N>.json`.

## Termination checks — evaluate in this order, first to fire wins

- **Oracle green + mutual pass -> SUCCESS.** The matrix from step 2 is GREEN on the latest turn, *and* two consecutive Critic `pass` verdicts, *and* the Builder's `pass` self-verdict on that turn. Critic passes alone never end the run: a `pass` against a red or BLOCKED matrix is a failed stance, so keep looping.
- **Block.** Critic returns `block` and the next Builder turn cannot resolve it -> abort, `blocked`.
- **Livelock.** `handoff_t<N>` is byte-identical to `handoff_t<N-1>` -> abort, `livelock`.
- **Stagnation.** No newly passing case across the last 4 turns. First occurrence: inject the Critic's `highest_impact_change` verbatim into the next Builder dispatch. Second: abort, `stagnation`.
- **Turn cap.** N reaches 20 -> abort, `turn_cap`.

Write `summary.json` per `schemas/summary.schema.json` on any terminal outcome.

## The one thing you must never do

Do not go green by weakening the harness. If you find yourself considering skipping a test, focusing one, loosening an assertion, adding a suppression, turning off an integrity check in config, or deleting a probe case from the contract — stop. Each converts a real failure into a false success and destroys the only thing that made the green meaningful.

Four of the five termination outcomes are aborts. **Report an abort as an abort**, with its reason and the highest-impact change. A turn-cap dressed up as success is the worst thing this system can produce.

## Output

A green matrix (or an honest abort naming the reason), the per-turn handoff / verification / score trail, a `summary.json`, and a short statement of what a green gate here does **not** prove — the things that still need a human.
