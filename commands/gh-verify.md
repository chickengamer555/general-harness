---
description: Read-only. Run the gate, the integrity checks and the red-proof check, and print the verdict. No agents, no writes; the matrix is the oracle.
argument-hint: "[task-slug] (omit for everything)"
allowed-tools: Read, Bash, Glob, Grep
---

You are the **orchestrator**, read-only. Render the current verdict for **`$1`** (a task slug, or everything if empty). You spawn no subagents and write nothing.

## Run it

```
node <kernel>/kernel/bin/general-verify.mjs [--task $1] --require-red-proof --verbose
```

Exit code: `0` green, `1` red, `2` the harness itself could not run. Read the output; never restate a verdict an agent claimed.

## Read the legs honestly

### gate — the project's own test / lint / typecheck commands

- `FAIL` means tests ran and something was wrong - or the command cannot fail at all (`true`, `:`, `exit 0`, an `echo`, empty), which is reported as its own FAIL.
- **`BLOCKED` means the command could not run at all** — a missing toolchain, a timeout, a script that does not exist. Nothing was learned about the code. Reporting this as a test failure sends someone to debug code that was working. Always surface BLOCKED separately, with its reason.
- Note the `confidence` on the failing-test list. `exit-code-only` means the runner's output could not be parsed into names: we know the *suite* was red, not which test was.

### integrity — the checks a test suite structurally cannot run on itself

- **A focused test is the one to lead with.** `.only` silently stops every other test in its file from running, while the suite still reports green with a smaller number nobody reads.
- **A skipped test** is a requirement that quietly stopped being checked.
- **An assertion-free test** passes as long as nothing throws, appears in coverage, and proves nothing.

These are heuristics over source text. Say so when reporting one, and check the line before asserting it is real.

### lock - did a trusted file move?

- `FAIL` names each contract, test or config file that changed, appeared or vanished since `--lock`. Never "fix" it by relocking yourself; relocking is the human's call.
- `BLOCKED` at standard or full tier means no lock exists yet; `SKIP` at quick tier is allowed.

### red-proof — was each case observed failing before it passed?

- A case **never seen red** has not been shown to be wired to anything.
- A **stale** proof was recorded against an earlier version of the contract. Not automatically invalid — contracts legitimately gain cases — but the case was proven against a different agreement, and the reader should know.
- A **weak** proof came from exit-code-only evidence: the suite was red, not necessarily that case.
- A `reported` case with no proof fails the leg in every tier, flag or no flag.

## Traceability

Where a contract exists, append the chain: **clause id → case id → test → result**.

A clause whose case has no passing test is a hole; name it by id. A clause whose case passes but was **never red** is a different kind of hole — name that separately, because it looks green.

## Output

The legs, then a one-line roll-up: **green** only if every leg is green. Name the first breaker. List BLOCKED legs and never-red cases explicitly — those are the two people miss.
