---
name: gen-loop-orchestration
description: The turn protocol the main session follows to run the general harness builder/critic loop — contract agreement, stance rotation, the orchestrator-run gate, the four termination breakers, and the human gateway. Use when running or reasoning about /gh-contract, /gh-build, or the loop as a whole.
---

# Orchestrating the builder/critic loop

The orchestrator is the **main session**. A subagent cannot spawn another, so the
loop lives here. The two agents never see each other's messages; their only
channels are files on disk, **plus the verification rollup the orchestrator
produces between turns**.

## The one structural guarantee

**The orchestrator runs the gate. Neither agent does.**

Both agents read the same orchestrator-written `verification_t<N>.json`. That is
what makes a fabricated verdict impossible *by construction* rather than merely
discouraged. An agent may re-run the gate read-only to check something — that
changes no source and is fine — but neither may write into the verification
namespace, and neither's claim about the result is ever the record.

## The phases

```
/gh-contract <task> [description]
    quick tier : you draft it        -> human confirms in one message
    full  tier : proposer <-> qa     -> human approves the contract

    write the failing test  ->  general-verify red   (the red proof)

/gh-build <task>
    builder <-> gate <-> critic      -> green

/gh-verify · /gh-review
    read-only: the three legs, and the clause -> case -> test chain
```

Tier 1 (full only) runs at most 3 rounds. Independent units are parallel-safe —
**dispatch them in one message with multiple Agent calls**. Serialising
independent work is the most common orchestration mistake here.

## Stance rotation

The Critic's stance rotates every turn: **tautology-hawk → edge-case-hawk →
failure-mode-hawk → simplicity-hawk → convention-hawk**, then repeat. Substitute
`{{adversarial_stance}}` in each critic dispatch.

This is not decoration. Both agents share a model lineage, so **drift toward
agreement is the single biggest risk in the design** — two instances of the same
model converge happily on "looks good to me". Rotation forces non-overlapping
attention. Two `pass` verdicts in a row with no findings at all means the stance
is failing, not that the work is perfect.

`tautology-hawk` is the highest-value stance and should lead the rotation,
because a green suite full of tests that would pass against a wrong
implementation is the exact failure this whole system exists to prevent.

## Termination breakers — evaluate in order, first to fire wins

- **Oracle green + mutual pass — SUCCESS.** The matrix you ran on the latest
  turn (`general-verify --require-red-proof`) is GREEN, *and* two consecutive Critic `pass` verdicts, *and*
  the Builder's `pass` self-verdict on that turn. Critic passes alone are never
  success: they are two agents agreeing, and the matrix is the only oracle. A
  Critic `pass` against a red or BLOCKED matrix is a failed stance, not a stop.
- **Block.** The Critic returns `block` and the next Builder turn cannot resolve it.
- **Livelock.** `handoff_t<N>` is byte-identical to `handoff_t<N-1>` — the loop
  is turning without moving.
- **Stagnation.** No newly passing case across 4 turns. First occurrence: inject
  the Critic's `highest_impact_change` verbatim into the next Builder dispatch.
  Second occurrence: abort.
- **Turn cap.** 20 turns.

Four of the five outcomes are aborts. **Report an abort as an abort**, with the
reason and the highest-impact change, so the user can decide whether to re-run or
change direction. A turn-cap dressed up as success is the worst output this
system can produce.

## BLOCKED is not a failing turn

A `BLOCKED` gate leg means the command could not run — a missing toolchain, a
timeout, a script that does not exist. **Nothing was learned about the code.**

Do not feed it to the Builder as a failure: that spends a whole turn debugging
code that was working. Fix the environment, or stop and tell the user. And never
guess at a replacement build command; running the wrong one in an unfamiliar
repository can be destructive.

## What you are guarding

Two ways to fake green, and the loop must catch both.

**Tautological tests.** A green suite proves nothing if the tests would pass
against a wrong implementation. The gate cannot see this — only the Critic
reading each test can. That is why `tests_added` disclosure in the handoff is
mandatory, and why the Critic's first job every turn is to read every one of
them and ask *what broken implementation would still pass this?*

**Weakening the harness.** A test skipped or focused, an assertion loosened, a
suppression added, an integrity check disabled in config, a probe case quietly
deleted from the contract. Diff against the previous turn every time. An
**undisclosed** shortcut is a `block`-level trust violation; a disclosed one is a
judgement call, and sometimes the right one.

## The human gateway

Only a human can say "yes, this is what I want built", and only a human can
accept the risk on a green result. The gate proves the tests pass. It cannot
prove real-world performance, behaviour under load, integration with anything
that was mocked, security properties nobody tested for, or whether the thing was
worth building.

Hand that list over explicitly at the end. It is the agenda for the review, not a
disclaimer.
