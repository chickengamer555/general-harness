---
description: Agree what to build before building it. Drafts a task contract — clauses, units, cases — and at full tier runs proposer <-> qa to check every clause is observable. Ends ready for /gh-build.
argument-hint: <task-slug> [natural-language description]
allowed-tools: Read, Write, Glob, Grep, Agent, Bash
---

You are the **orchestrator**. Produce the task contract for **`$1`**. Everything after the slug is the description.

## Size it first

Pick the tier from the table in `<kernel>/skills/general-harness/SKILL.md` and say which and why in one line. Quick: draft the contract yourself. Standard: draft it yourself, then take one adversarial pass over it. Full: run the proposer <-> qa loop below.

## Setup

Create the contracts directory (`verify/` by default) and, at standard or full tier, a run directory with a `trace.jsonl`.

**Check the gate resolves first:**

```
node <kernel>/kernel/bin/general-verify.mjs detect
```

If nothing is detected, ask the user for the test command now rather than discovering it mid-build. Never guess a build command — running the wrong one in an unfamiliar repo can be destructive, and a wrong guess is worse than a question.

## Writing the contract

Whoever drafts it — you at quick tier, `gen-proposer` at full — the standard is the same:

- **Every clause needs `observable_by`.** How would a machine tell? If you cannot say, sharpen the clause or move it to `open_questions`. A clause nobody can check is a wish.
- **Every clause needs a case mapped to it.** An unmapped clause is agreed but unproven.
- **Every unit needs at least one `probe: true` case**, and it should be the case you are actually worried about: the empty input, the boundary, the failure path, hostile input. Not the convenient one.
- **Write the non-goals down.** Unwritten scope is how a review becomes an argument.

## Full tier — the proposer ↔ qa loop (max 3 rounds)

1. **Dispatch `gen-proposer`** with the description and the schema. It writes `<task>.task.json`.
2. **Dispatch `gen-qa`** with the draft. It writes a review with `verdict: executable | not-executable` and `flagged_clauses[]`.
3. Terminate on `executable`. After 3 rounds without it, keep the draft, record the open flags, and carry them forward as Critic input. **Never spin past 3 rounds** — an unresolved clause carried visibly beats one argued in circles.

## Validate and hash

```
node <kernel>/kernel/bin/general-verify.mjs lint --task $1
node <kernel>/kernel/bin/general-verify.mjs lock --task $1
```

The linter enforces the completeness gate: observable clauses, mapped cases, a probe per unit, and the user's words on every `reported` case. `lock` prints the contract hash; the run lock (`--lock`) is taken after the red proofs, at standard or full tier.

## Human gateway

Show the human the contract in plain language and ask whether this is what they want built. Only they can answer that.

At quick tier this is one short message, not a ceremony — but do not skip it. Everything downstream treats these clauses as settled.

## Output

A validated, hashed task contract; the tier you chose and why; any open questions. Next step: write the failing test, run `general-verify red`, then `/gh-build $1`.
