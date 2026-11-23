---
name: gen-loop-orchestration
description: Use when running the general-harness builder/critic loop at standard or full tier (/gh-contract, /gh-build), or deciding whether a loop run has ended. Not for: quick-tier work you do alone (general-harness skill); the web loop (web-harness); recording red proofs (tdd-red-proof).
---

# Orchestrating the builder/critic loop

This file is the single home of the turn protocol, stance rotation and
termination breakers. `<kernel>/commands/gh-build.md` holds the concrete
dispatch and matrix commands; the iron rules are in
`<kernel>/skills/general-harness/SKILL.md`.

The orchestrator is the **main session**: a subagent cannot spawn another. The
two agents never see each other's messages; their channels are files on disk
plus the verification rollup the orchestrator writes between turns.

## The structural guarantee

**The orchestrator runs the matrix. Neither agent does.** Both read the same
orchestrator-written `verification_t<N>.json`, so a fabricated verdict is
impossible by construction. An agent may re-run it read-only; neither writes
into the verification namespace, and neither's claim is ever the record.

## Phases

```
/gh-contract <task> [description]
    quick/standard: you draft it    -> human confirms in one message
    full          : proposer <-> qa -> human approves the contract
    write the failing test -> general-verify red   (the red proof)
    standard/full : general-verify --lock

/gh-build <task>        builder <-> matrix <-> critic -> green
/gh-verify, /gh-review  read-only: the legs, and clause -> case -> test
```

Tier 1 (full only) runs at most 3 rounds. Independent units are parallel-safe:
**dispatch them in one message with multiple Agent calls.**

## Stance rotation

The Critic's stance rotates every turn: **tautology-hawk -> edge-case-hawk ->
failure-mode-hawk -> simplicity-hawk -> convention-hawk**, then repeat;
substitute `{{adversarial_stance}}` in each dispatch. `tautology-hawk` leads.
Both agents share a model lineage, so drift toward agreement is the biggest
risk; rotation forces non-overlapping attention. Two `pass` verdicts with no
findings means the stance is failing, not that the work is perfect.

## Termination breakers - in order, first to fire wins

- **SUCCESS (`mutual_pass`).** The matrix you ran this turn
  (`general-verify --require-red-proof`) is GREEN, *and* two consecutive Critic
  `pass` verdicts, *and* the Builder's `pass` self-verdict this turn. A Critic
  `pass` against a red or BLOCKED matrix is a failed stance, not a stop.
- **Dispute (`disputed`).** The Builder's self-verdict is `dispute`. Stop and
  put its `dispute` object (`clause`, `conflicts_with`, `because`) to the user:
  fix the code, the clause, or the check. A changed clause or check is relocked
  with `--relock --reason "<what was agreed>"` by the human's decision. Never
  resolve it by editing a locked file.
- **Block (`blocked`).** The Critic returns `block` and the next Builder turn
  cannot resolve it.
- **Livelock (`livelock`).** `handoff_t<N>` is byte-identical to `handoff_t<N-1>`.
- **Stagnation (`stagnation`).** No newly passing case across 4 turns. First
  time: inject the Critic's `highest_impact_change` verbatim into the next
  Builder dispatch. Second time: abort.
- **Turn cap (`turn_cap`).** 20 turns.

Five of the six outcomes are aborts. **Report an abort as an abort**, with the
reason and the highest-impact change. A turn cap dressed up as success is the
worst output this system can produce.

## BLOCKED is not a failing turn

A BLOCKED leg means the command could not run. Do not feed it to the Builder as
a failure; fix the environment or stop and tell the user. Never guess a
replacement build command.

## What you are guarding

- **Tautological tests.** The gate cannot see them; the Critic reading every
  test in `tests_added` can. Ask: what broken implementation would still pass?
- **Weakening the harness.** A skipped or focused test, a loosened assertion, a
  suppression, a disabled check, a deleted probe. Diff against the previous turn
  every time; the lock leg names any trusted file that moved. An undisclosed
  shortcut is a `block`.

## The human gateway

Only a human can say "this is what I want built" and accept the risk on green.
Hand over what the gate cannot prove: real-world performance, load and
concurrency, integration with anything mocked, untested security properties,
and whether it was worth building. That list is the review agenda.
