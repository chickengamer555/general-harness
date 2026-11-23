---
name: general-harness
description: Harness discipline for any coding task in any language — contract first, test-driven with a recorded red proof, the project's own test gate, and integrity checks a test suite cannot run on itself. Use when the user runs /general-harness, or asks for a fix, function, script, refactor or small feature and wants it done properly rather than quickly-and-hopefully. Imposes no house style; scales from a five-minute change to a full adversarial loop.
---

# The general harness

Harness quality without a house style. This one deliberately has **no opinion
about how you write code** — it adopts whatever the project already does. What
it adds is the part that makes "done" mean something:

1. **A contract, written first** — what must become true, in language a
   non-engineer could approve, with every clause observably checkable.
2. **A red proof** — mechanical evidence each test was seen failing *before* it
   passed. This is the only part of TDD that can be checked rather than merely
   encouraged, so it is the part this harness checks.
3. **The project's own gate** — its test, lint and typecheck commands. The
   harness borrows the runner the team already trusts; it never replaces it.
4. **Integrity checks** — the three ways a suite goes green while proving
   nothing, which the suite structurally cannot detect in itself.

## A reported bug is reproduced before it is fixed

When the user reports a bug, the first thing you build is the failure, not the
fix:

1. Add a case with `"reported": "<the user's own words>"` and a test that shows
   that symptom.
2. Run `red --task <task>` and show the user the red output.
3. Fix it, run the matrix, show the same case green.

The matrix fails any reported case with no red proof, in every tier, with or
without `--require-red-proof`.

**Never say "fixed" without that red→green pair.** If the symptom cannot be
reproduced in a test (hardware only, timing, how it feels), say so plainly,
state what you checked instead and how (a manual run, the real device, logs),
and do not call it green.

**Kernel:** `<kernel>` (`install.mjs`, or `install-skill.ps1` on Windows, bakes
the real clone path into your installed copy of this skill, so every command
below runs as written). Source of truth:
`https://github.com/chickengamer555/general-harness`. Its web-specific sibling
is `web-harness` (`/web-harness`).

Zero dependencies — plain Node, nothing to install.

## Pick the tier first — this is the important decision

Match ceremony to stakes. Over-ceremony is a real cost; people route around a
harness that turns a five-minute fix into an hour.

| Tier | Use when | What runs |
|---|---|---|
| **quick** *(default)* | a fix, a function, a script, a small refactor | you alone: contract → red → green → one adversarial self-review |
| **standard** | several units, or code that will be maintained | builder + critic subagents, gate between turns |
| **full** | auth, money, data loss, an external audience | proposer + qa first, then builder + critic |

State the tier and why in one line. If the user asked for something quick,
believe them — but say so if the stakes warrant more.

## Quick mode — the default loop

```
node <kernel>/kernel/bin/general-verify.mjs detect      # what gate does this project have?
node <kernel>/kernel/bin/general-verify.mjs init        # scaffold config + a first contract
```

Then:

1. **Write the contract.** One `verify/<task>.task.json`: clauses (each with
   `observable_by`), units, and the cases that will prove them. Keep it short —
   four clauses is usually plenty. Show it to the user in plain language and
   check it is what they meant. That check is quick, and it is the only gateway
   quick mode has.

2. **Write the failing test.** Before the implementation.

3. **Watch it fail, and record it:**
   ```
   node <kernel>/kernel/bin/general-verify.mjs red --task <task>
   ```
   **If a case does not go red, stop and find out why.** That is a real finding,
   not an inconvenience: it almost always means the test asserts something that
   was already true — which is exactly the test that would never have caught the
   bug. (The bundled example demonstrates this happening for real.)

4. **Implement to green.** The smallest change that satisfies the contract *and*
   reads like the code around it.

5. **Run the full matrix:**
   ```
   node <kernel>/kernel/bin/general-verify.mjs --require-red-proof
   ```

6. **Review your own work adversarially — once, in a named stance.** Pick the
   one that fits (`tautology-hawk`, `edge-case-hawk`, `failure-mode-hawk`,
   `simplicity-hawk`, `convention-hawk`); `agents/critic.md` has the dossiers.
   Ask the question no automated check can: **what broken implementation would
   still pass these tests?** If you can name one, fix the *test*.

7. **Report** the verdict, and what a green gate here does not prove.

## Standard and full modes

Chain to `commands/gh-contract.md`, `commands/gh-build.md`,
`commands/gh-verify.md`, `commands/gh-review.md`, and read
`skills/loop-orchestration/SKILL.md` for the turn protocol, stance rotation and
the four termination breakers. Read those rather than improvising the loop — the
breakers exist because loops without them do not terminate.

## No house style — and what that actually means

This harness will not tell you to use functional style, or to prefer early
returns, or how long a function may be. It has one style rule:

> **Match the code around it.** Naming, error handling, comment density, idiom.

A change that reads as though the original author wrote it is worth more than a
change that is objectively tidier and obviously foreign. If the project's
conventions are genuinely bad, say so — do not unilaterally reform them while
doing something else.

## What it does insist on

- **Every unit needs at least one `probe: true` case** — the empty input, the
  boundary, the failure path, hostile input. Not the convenient one. A unit with
  only happy-path cases has tested the demo.
- **Every clause needs `observable_by`.** If you cannot say how a machine would
  tell, it is a wish, not a requirement.
- **Never go green by weakening the harness.** Skipping a test, focusing one,
  loosening an assertion, adding a suppression, turning off an integrity check,
  or deleting a probe case each convert a real failure into a false success. If
  a check is genuinely wrong, change it deliberately and out loud.
- **BLOCKED is not FAIL.** A gate that could not run — missing toolchain,
  timeout — taught you nothing about the code. Never round it to either colour.

## Never guess a build command

If the gate cannot be detected, **ask**. Running a guessed command in an
unfamiliar repository can be destructive, and a question costs seconds.

## The CLI

| Command | What it does |
|---|---|
| `general-verify` | gate + integrity + red-proof, one verdict |
| `general-verify detect` | show the detected stack and its gate |
| `general-verify init` | scaffold config and a first contract |
| `general-verify lint` | validate contracts without running anything |
| `general-verify red` | run the gate and record which cases were RED |
| `general-verify integrity` | just the static checks |
| `general-verify --require-red-proof` | fail if any case went straight to green |
| `general-verify selftest` | prove the integrity checks still catch shortcuts |

Exit: `0` green, `1` red, `2` the harness could not run.

## When a check is wrong about the code

Two escape hatches, both deliberately visible. Reach for either only with a
written reason, and never to make a real finding go away:

- **`general-harness-disable-file: <reason>`** in a file's first 20 lines
  excludes it from every check, and is **named in the run output**. For files
  that legitimately contain the patterns: a detector, a linter rule set, a
  security signature list.
- **`"guard": true`** on a contract case means "this already held and must keep
  holding" — no red proof expected, because it was never red. Guards are counted
  separately and never counted as proven.

A catch block that **states why** it swallows is reported as a warning rather
than a failure; an empty one still fails. An empty catch is an accident, a
documented one is a decision, and the check targets the accident.

## Verify the harness itself

`general-verify selftest` runs the integrity checks against a bundled fixture
containing one instance of every shortcut they exist to catch, plus a clean unit
that must produce no false positives. A check that has silently stopped working
is worse than no check, because its green is still trusted.

The harness is also **run against its own kernel** (`npm run check` in the repo),
which is how 19 real defects in these two harnesses were found — including a gate
that inherited its caller's environment and reported a failing suite as passing.
If you are changing the kernel, that gate is the one that matters.
