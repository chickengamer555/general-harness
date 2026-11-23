---
name: tdd-red-proof
description: Use when running general-verify red, when a red proof is missing, weak (exit-code-only), stale, or a case refuses to go red, or when judging whether a test proves anything. Not for: choosing a tier or the iron rules (general-harness); running the builder/critic loop (loop-orchestration); web contracts (web-harness).
---

# The red proof

Test-driven development has one property that makes the discipline worth its
cost, and it is not "tests first" as a ritual:

> **A test you watched fail, and then watched pass, has demonstrably been wired
> to the thing it claims to check.**

A test written afterwards has not. It may be asserting on a constant. It may be
testing a mock against itself. It may be exercising a code path that no longer
exists. And it will sit there green forever, indicating nothing, while everyone
counts it as coverage.

Every other part of TDD is a working habit and stays advisory. **This part is
checkable**, so this harness checks it.

## Recording one

```
general-verify red --task <task>
```

This runs the gate, parses out which tests failed, matches them against the
declared cases, and writes `.general-harness/redproof.json`.

**That file is evidence and belongs in the repository.** It is not a cache. CI
needs it for `--require-red-proof`, and a reviewer needs it to see that a test
was ever actually red.

## Matching

Case ids and test names are matched by normalised containment: strip everything
that is not a letter or digit, lowercase, then check the test name contains the
case id.

So the case `handles-empty-input` matches all of:

- `slugify handles empty input`
- `test_handles_empty_input`
- `HandlesEmptyInput`

When a name genuinely differs, pin it explicitly rather than renaming things to
suit the tool:

```jsonc
{ "id": "handles-empty-input", "test_name": "returns blank for nothing" }
```

## When a case will not go red — the important case

**Stop. This is a finding, not an inconvenience.**

A case that stays green against a not-implemented stub is a case whose test
asserts something that was already true. Which means it is exactly the test that
would never have caught the bug.

This is not hypothetical. The example bundled with this harness was written
with a stub returning `''`, and the `handles-empty-input` case passed — because
the test asserted `equal(slugify(''), '')`, which an empty stub satisfies
perfectly. The red proof caught it immediately. The fix was a stub that throws,
which made the test genuinely red and the proof meaningful.

When it happens:

1. Make the stub obviously wrong — `throw new Error('not implemented')` rather
   than a plausible-looking default value.
2. If the case *still* will not go red, the test is asserting something trivial.
   Strengthen the assertion until a wrong implementation would fail it.
3. Only then implement.

## Confidence, and reading it honestly

Every proof records how it was obtained:

| confidence | means |
|---|---|
| `exact` | individual failing test names were parsed from a structured report |
| `heuristic` | names were scraped from human-readable output; one may be missed or mangled |
| `exit-code-only` | nothing could be parsed — we know the **suite** was red, not which case was |

An `exit-code-only` proof is real but much weaker, and it says so rather than
implying it knew more. If you are getting it, declare `"runner"` in
`general-harness.config.json` so the right output parser is used — that is
usually the whole fix.

## Stale proofs

A proof records the contract hash it was taken against. When the contract
changes, existing proofs are marked **stale**.

Stale is not automatically invalid: contracts legitimately gain cases, and a
proof for an untouched case is still good evidence. But it does mean the case
was proven against a *different agreement*, and a reader deserves to know. If
the clause itself changed materially, re-record.

## What the red proof does not prove

It proves a test can distinguish two states of the code. It does not prove:

- the test asserts the **right** thing (that is the Critic's job, and yours),
- the implementation is correct beyond the cases anyone thought of,
- the design is right at all.

It closes one specific hole — tests that were never wired to anything — and it
closes it completely. That is worth having, and it is not worth overclaiming.
