---
name: general-harness
description: Use when the user runs /general-harness, or asks for a fix, function, script, refactor or feature in code that does not render a web page - any language, including Kotlin and Android apps, Python, Rust, Go, shell scripts, libraries and CLIs - and wants it verified rather than hoped. Use it from the first edit, not after the code exists. Not for: anything that renders DOM in a browser (web-harness); Godot projects (godot-verify:godot-harness); visual design or how a page looks (taste-skill).
---

# The general harness

Kernel: `<kernel>` (the installer bakes in the clone path). CLI:
`node <kernel>/kernel/bin/general-verify.mjs`, below `general-verify`.
Zero dependencies. Imposes no house style: match the code around it.

## Iron rules - these hold in every tier

1. **The matrix decides.** Done means `general-verify` printed GREEN on the
   latest run. Not a test you ran by hand, not an agent's claim, not two agents
   agreeing. In the loop, SUCCESS needs the matrix GREEN on that turn.
2. **A reported bug gets a red case first.** Add a case with
   `"reported": "<the user's own words>"` and a test showing the symptom, run
   `general-verify red --task <task>`, show the red output, then fix. The matrix
   fails a reported case with no red proof in every tier, with or without
   `--require-red-proof`, and a reported case can never be a `guard`.
3. **Never edit a locked file to get green.** `.general-harness/lock.json` pins
   the contracts, every test file they name (or the gate command names), and
   the config. A changed, added or removed file is a FAIL that names it.
   Relocking (`--relock --reason "<why>"`) is the human's call, after they agree.
4. **A dispute is a legal stop.** If a test and the contract disagree, follow
   the contract and raise a dispute: name the clause, what conflicts with it and
   why, then stop and ask the user to fix the code, the clause, or the check.
5. **No "fixed" without red then green** for the same case. If the symptom
   cannot be reproduced in a test (hardware, timing, feel), say so, say what
   you checked instead, and do not call it green.
6. **Never go green by weakening the harness**: no skip, focus, loosened
   assertion, suppression, disabled check or deleted probe. A gate command that
   cannot fail (`true`, `:`, `exit 0`, an `echo`, empty, or a chain of only
   those) is a FAIL on its own.
7. **BLOCKED is not FAIL** - the command could not run, so nothing was learned.
   **Never guess a build command**; if `detect` finds none, ask.

## Pick the tier - state it and why in one line

Each task contract carries `"tier"`; a run uses the **strictest tier among the
selected contracts**, and a contract with none counts as quick.

| Tier | Pick it for | What the kernel changes |
|---|---|---|
| **quick** (default) | a fix, a function, a script, a small refactor | no lock needed: a missing lock is SKIP |
| **standard** | several units, or code that will be maintained | a missing lock is BLOCKED; run `--lock` once red proofs are recorded |
| **full** | auth, money, data loss, an external audience | same kernel rules as standard; adds proposer + qa and a contract sign-off |

Every tier runs the gate, the integrity checks and the red-proof leg. Red proofs
are advisory except for reported cases unless you pass `--require-red-proof`,
which this harness always does at the end. A drifted lock FAILs in any tier.

## Quick mode, in order

```
node <kernel>/kernel/bin/general-verify.mjs detect   # which gate does this project have?
node <kernel>/kernel/bin/general-verify.mjs init     # config + a first contract
```

1. Write `verify/<task>.task.json`: clauses with `observable_by`, units, cases,
   one `probe: true` per unit. Show it to the user in plain words.
2. Write the failing test, then `general-verify red --task <task>`. A case that
   will not go red is a finding: the test asserts something already true.
3. Implement the smallest change that reads like its neighbours.
4. `general-verify --require-red-proof` until GREEN.
5. One adversarial self-review in a named stance (dossiers in
   `<kernel>/agents/critic.md`): what broken implementation would still pass?
6. Report the verdict and what a green gate here does not prove.

## Read when entering a phase

| Phase | Read |
|---|---|
| recording or reading a red proof, a case that will not go red, stale or weak proofs | `<kernel>/skills/tdd-red-proof/SKILL.md` |
| writing the contract (standard / full) | `<kernel>/commands/gh-contract.md` |
| running the builder/critic loop: turn protocol, breakers, gateways | `<kernel>/skills/loop-orchestration/SKILL.md`, then `<kernel>/commands/gh-build.md` |
| reading a verdict | `<kernel>/commands/gh-verify.md` |
| clause-by-clause sign-off | `<kernel>/commands/gh-review.md` |
| CLI flags, the three legs, escape hatches | `<kernel>/README.md` |

## CLI

`general-verify` (gate + integrity + red proof + lock, one verdict) · `detect` ·
`init` · `lint` · `red [--force]` · `integrity` · `lock` (print hashes) ·
`selftest` · `--lock` · `--relock --reason "<why>"` (logs to
`lock-history.jsonl`) · `-t <task>` · `--require-red-proof` · `--json <f>` ·
`-v`. Exit `0` green, `1` red, `2` the harness could not run.

## Escape hatches - visible on purpose

`general-harness-disable-file: <reason>` in a file's first 20 lines excludes it
from scanning and is named in every run. `"guard": true` on a case means it was
already true and must stay true: no red proof expected, counted separately,
never as proven. Use either only with a written reason.
