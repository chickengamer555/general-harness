# general-harness

[![check](https://github.com/chickengamer555/general-harness/actions/workflows/ci.yml/badge.svg)](https://github.com/chickengamer555/general-harness/actions/workflows/ci.yml)

**Harness quality without a house style.** For any language, at any size.
Invoke it with `/general-harness`.

This harness has no opinion about how you write code — it adopts whatever the
project already does. What it adds is the part that makes "done" mean something:

1. **A contract, written first** — what must become true, in language a
   non-engineer could approve, with every clause observably checkable.
2. **A red proof** — mechanical evidence each test was seen failing *before* it
   passed. The only part of TDD that can be checked rather than merely
   encouraged, so it is the part this harness checks.
3. **The project's own gate** — its test, lint and typecheck commands. The
   harness borrows the runner the team already trusts; it never replaces it.
4. **Integrity checks** — the three ways a suite goes green while proving
   nothing, which a suite structurally cannot detect in itself.

```
$ general-verify --require-red-proof

general-verify  Node / JavaScript / TypeScript (vitest), gate detected

  test          PASS  1204ms  npm test --silent
  integrity     FAIL  8 test file(s), 31 source file(s)
      x 1 focused test(s)
        test/cart.test.ts:14 it.only( - a focused test silently stops every
        other test in its file from running, and the suite still reports green.
        This is the single most effective way to fake a passing build.
  red-proof     PASS
      checkout              6/6 proven

  RED  3 leg(s), 1 failed, 0 blocked, 1 contract(s)
```

The test suite said green. It was running four of thirty-one tests.

## Why this exists

`assembly-harness` proved the pattern — contracts, an adversarial builder/critic
loop, an orchestrator-run matrix neither agent can fabricate — but each of its
harnesses is bound to one stack: React, Postgres, FastAPI.

Most work is not that. It is a script, a utility, a fix, a small refactor, in
whatever language happens to be open. Those tasks deserve the same discipline
and cannot carry the same ceremony.

So this keeps the method and drops everything stack-specific. Its sibling,
[`web-harness`](https://github.com/chickengamer555/web-harness), does the same
for web UI.

**Zero dependencies.** Plain Node, nothing to install.

## Install

```sh
git clone https://github.com/chickengamer555/general-harness
node general-harness/kernel/bin/general-verify.mjs selftest
```

Then, in the project you want to verify:

```sh
node <path-to>/general-harness/kernel/bin/general-verify.mjs detect   # what gate is here?
node <path-to>/general-harness/kernel/bin/general-verify.mjs init     # scaffold
```

### As a Claude Code plugin

```sh
/plugin marketplace add chickengamer555/general-harness
/plugin install general-verify@general-harness
```

Or install the skill globally so `/general-harness` works everywhere:

```sh
cp -r skills/general-harness ~/.claude/skills/
```

## The loop

```sh
general-verify detect                 # what does this project already use?
# write the contract
general-verify lint                   # is it complete and observable?
# write the failing test
general-verify red --task <task>      # watch it fail, and record that
# implement
general-verify --require-red-proof    # gate + integrity + proof, one verdict
```

## The three legs

### gate — the project's own tooling

Detected automatically for Node, Python, Rust, Go, .NET and Make, or declared
explicitly in `general-harness.config.json`. The harness runs `npm test`,
`pytest`, `cargo test`, `go test` — whatever is already there.

`BLOCKED` is reported separately from `FAIL`, and the distinction matters: a
missing toolchain taught you nothing about the code, and calling it a test
failure sends someone to debug something that was working.

### integrity — what a suite cannot check about itself

A test suite reports green when every test that **ran** passed. It has no
opinion about the tests that were skipped, focused out, or written with no
assertion in them. Those are the three ways a suite goes green while proving
nothing — and they are exactly the shortcuts available to anyone under pressure
to make red go away.

| check | why it is fatal |
|---|---|
| **focused tests** (`.only`) | silently stops every other test in the file from running; suite still green |
| **skipped tests** | a requirement that quietly stopped being checked |
| **assertion-free tests** | passes as long as nothing throws; appears in coverage; proves nothing |
| **swallowed errors** | an empty catch turns failure into silence — worse than a crash. A catch that *states why* is a decision, not an accident: reported as a warning, never a failure |
| **suppressions** | `@ts-ignore`, `eslint-disable`, `# noqa` — a tool that was working, turned off |
| **debug leftovers** | `console.log`, `print(`, `debugger` shipped by accident |

### red-proof — was it ever actually red?

A test written after the implementation has never been shown to be wired to
anything. It may be asserting on a constant, testing a mock against itself, or
exercising a path that no longer exists — and it will sit green forever.

`general-verify red` records which declared cases were observed failing.
`--require-red-proof` refuses to call a run green if a case went straight to
passing.

> **This caught a real problem while the example for this repo was being
> written.** The `handles-empty-input` case passed against a stub returning `''`
> — because the test asserted `equal(slugify(''), '')`, which an empty stub
> satisfies perfectly. It would never have caught the bug. The proof flagged it
> immediately; the fix was a stub that throws.

Proofs record their own **confidence** — `exact`, `heuristic`, or
`exit-code-only` — and a weak proof says so rather than implying it knew which
case failed.

### When a check is wrong about your code

Two escape hatches, both deliberately visible:

- **`general-harness-disable-file: <reason>`** in a file's first 20 lines excludes
  it from every check. It costs a written reason, and every use is **named in the
  run output** — a silent exemption is how a check quietly stops covering half a
  codebase. This exists because some files legitimately contain the patterns: a
  detector, a linter rule set, a security signature list. This harness's own
  `quality.mjs` uses it, and says so on every run.
- **`"guard": true`** on a case means "this behaviour already held and must keep
  holding". No red proof is expected, because by construction it was never red.
  Guards are counted separately and **never counted as proven**, so they cannot
  stand in for the proofs that are genuinely missing.

## The harness verifies itself

```sh
npm run check    # selftest + self-verification + the example, all with red proofs enforced
```

CI runs exactly this command on Linux and Windows. The badge at the top is that
run: if it is green, the harness passed its own gate on a machine that is not mine.

`general-verify` runs against its own kernel: a contract in `verify/`, real red
proofs committed in `.general-harness/`, and the integrity leg pointed at its own
source. It also verifies
[`web-harness`](https://github.com/chickengamer555/web-harness), whose kernel is
plain JavaScript that `web-verify` cannot grade.

That exercise produced **22 clauses across three contracts — 20 real defects and
2 capabilities the exercise showed were missing — with 27 recorded red proofs
and 7 declared guards.** Every defect was observed failing before it was fixed.
The split is 14 defects in this kernel and 6 in `web-harness`.

The three worst were all in this kernel:

- the gate inherited `NODE_TEST_CONTEXT` from whatever process invoked it, so
  running it from inside a test runner made a **failing suite report success** —
  a total, silent failure of the one thing the tool exists to do;
- a test failing because the implementation did not exist yet was classified
  `BLOCKED` rather than `FAIL`, so `general-verify red` refused to record it —
  breaking the first step of test-first development, which is the whole method.
- every "command not found" pattern had been written against Windows and bash,
  so on Linux — where `/bin/sh` is dash, which prints `/bin/sh: 1: x: not found`
  and exits 127 — **a missing toolchain was reported as a failing test suite**,
  sending someone to debug working code. The first CI run found it in under a
  minute; it had been invisible for as long as the only machine was mine.

Neither was findable by reading the code. Both fell out of pointing the harness
at itself.

## The contract

```jsonc
{
  "task": "slugify",
  "title": "URL slug generator",
  "description": "Turn arbitrary text into a URL-safe slug that is never undefined and never has repeated separators.",
  "tier": "quick",

  "clauses": [
    { "id": "A3",
      "text": "Empty, whitespace-only, null and undefined input all return an empty string - never undefined, never a thrown error.",
      "observable_by": "a test named \"handles empty input\" passes",
      "rationale": "The result goes straight into a URL. \"undefined\" in a path is a bug that surfaces far from its cause." }
  ],

  "units": [
    { "id": "slugify",
      "surface": "src/slugify.mjs",
      "tests": "test/slugify.test.mjs",
      "cases": [
        { "id": "handles-empty-input",
          "description": "empty, whitespace, null, undefined - the case that ships broken most often",
          "probe": true, "maps_to_clause": "A3" }
      ] }
  ]
}
```

The linter enforces the completeness gate: every clause has `observable_by`,
every clause has a case mapped to it, every unit has at least one probe case.

## Three tiers — match ceremony to stakes

| Tier | Use when | What runs |
|---|---|---|
| **quick** *(default)* | a fix, a function, a script, a small refactor | you alone: contract → red → green → one adversarial self-review |
| **standard** | several units, or code that will be maintained | builder + critic subagents, gate between turns |
| **full** | auth, money, data loss, an external audience | proposer + qa first, then builder + critic |

Over-ceremony is a real cost. People route around a harness that turns a
five-minute fix into an hour.

## No house style — and what that actually means

One style rule, and only one:

> **Match the code around it.** Naming, error handling, comment density, idiom.

A change that reads as though the original author wrote it is worth more than a
change that is objectively tidier and obviously foreign. If the project's
conventions are genuinely bad, say so — do not unilaterally reform them while
doing something else.

## The CLI

| Command | What it does |
|---|---|
| `general-verify` | gate + integrity + red-proof, one verdict |
| `general-verify detect` | show the detected stack and its gate |
| `general-verify init` | scaffold config and a first contract |
| `general-verify lint` | validate contracts without running anything |
| `general-verify red` | run the gate and record which cases were RED |
| `general-verify integrity` | just the static checks |
| `general-verify lock` | canonical hash per contract |
| `general-verify selftest` | prove the integrity checks still catch shortcuts |

`--require-red-proof` · `--task <id>` · `--json <path>` · `--verbose`

Exit code: `0` green, `1` red, `2` the harness itself could not run.

## Layout

```
general-harness/
├── kernel/
│   ├── bin/general-verify.mjs   # the CLI - this is the oracle
│   ├── core/
│   │   ├── stacks.mjs           #   detection + the gate each stack implies
│   │   ├── gate.mjs             #   running the gate, parsing it honestly
│   │   ├── quality.mjs          #   the integrity checks
│   │   ├── redproof.mjs         #   record and verify red-before-green
│   │   ├── contract.mjs         #   task contracts + the completeness gate
│   │   └── canonical-hash.mjs
│   ├── matrix.mjs               # the three legs, folded into one verdict
│   └── schemas/                 # task contract JSON Schema
├── schemas/                     # run artifacts: handoff · score · verification · summary
├── agents/                      # proposer · qa · builder · critic
├── commands/                    # /gh-contract · /gh-build · /gh-verify · /gh-review
├── skills/                      # general-harness · tdd-red-proof · loop-orchestration
├── example/                     # a clean unit with real red proofs + a shortcuts fixture
└── docs/                        # architecture · quickstart
```

## Never guess a build command

If the gate cannot be detected, the harness says so and stops rather than
guessing. Running the wrong command in an unfamiliar repository can be
destructive, and a question costs seconds.

## Licence

MIT. The vocabulary — contract, case, probe, verdict, gate, matrix — is shared
deliberately with `assembly-harness` and `web-harness`, so an agent that knows
one can read the others.
