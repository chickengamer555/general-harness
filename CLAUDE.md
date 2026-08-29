# general-harness — the stack-agnostic verification harness

This repo is the **harness tier**: the kernel that decides green/red, plus the
agents, commands and skills that drive work to green against it. It is consumed
by projects, never the reverse.

## Layout

| Path | What |
|---|---|
| `kernel/` | The framework. `bin/general-verify.mjs` is the CLI and the oracle. |
| `schemas/` | Run artifacts for the builder/critic loop: handoff, score, verification, summary. |
| `agents/` | proposer, qa (Tier 1); builder, critic (Tier 2). |
| `commands/` | `/gh-contract`, `/gh-build`, `/gh-verify`, `/gh-review`. |
| `skills/` | `general-harness` (the global entry point), `tdd-red-proof`, `loop-orchestration`. |
| `example/` | `clean/` — a real unit with real red proofs. `shortcuts/` — one instance of every shortcut the integrity checks must catch. |

## The gate

```sh
npm run check      # selftest + the example verified with --require-red-proof
```

`selftest` runs the integrity checks against both example directories: the clean
one must produce **no false positives**, and the shortcuts one must have **every
shortcut class found**. Run it after any change to `core/quality.mjs` — a check
that has silently stopped catching things is worse than no check, because its
green is still trusted.

## Working on this repo

- **Zero runtime dependencies, and keep it that way.** Plain Node stdlib only.
  Every dependency added here is a dependency imposed on every consumer, and the
  reason this harness can be dropped into a Python or Rust repo is that it needs
  nothing from them.
- **Never loosen a check to make the example green.** If the example fails,
  either the example is wrong or the check found something. Work out which
  before touching either.
- **Any new integrity check ships with a fixture** in `example/shortcuts/` and an
  entry in the `expected` list in `cmdSelftest`. A check with nothing proving it
  works is a check nobody will notice breaking.
- **Never claim more precision than the output supports.** The `confidence`
  field on gate results and red proofs is load-bearing. If a parser cannot
  extract test names, it must return null and let the caller downgrade — not
  guess. Blurring this would undermine the one thing the red proof is for.
- **BLOCKED is not FAIL.** Anywhere a command might fail to run at all, that path
  must produce BLOCKED with a reason. Reporting it as a failure sends someone to
  debug working code.
- **Vocabulary is shared on purpose** with `assembly-harness` and `web-harness`:
  contract, case, probe, verdict (PASS/FAIL/BLOCKED/SKIP), gate, matrix, handoff,
  score. Do not rename these locally.

## A note on the example

`example/clean/` ships with committed red proofs in
`.general-harness/redproof.json`. Those are real: the tests were run against a
throwing stub, observed failing, and recorded — then the implementation was
restored. **Red proofs are evidence and belong in version control**, which is why
`.gitignore` deliberately does not exclude them.

The first attempt at that recording used a stub returning `''`, and the
`handles-empty-input` case passed against it — the test asserted
`equal(slugify(''), '')`, which an empty stub satisfies perfectly. The red proof
caught it. That is the example's real lesson and it is documented in
`example/README.md`.

## Related

- `web-harness` — the same discipline, specialised for web UI (DOM contracts, a11y, design tokens).
- `assembly-harness` — the original app-specific React / Postgres / FastAPI harnesses this pattern came from.
