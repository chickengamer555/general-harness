# The worked example

Two directories, and both matter.

## `clean/` — a real unit with real red proofs

A slug generator: small on purpose, because the interesting part is not the
function. It is that the contract, the tests and the red proof all existed
before the implementation did.

```sh
node ../kernel/bin/general-verify.mjs --dir . --require-red-proof
```

The committed `.general-harness/redproof.json` is genuine. The tests were run
against a throwing stub, observed failing, and recorded — then the
implementation was written. **Red proofs are evidence and belong in version
control**, which is why `.gitignore` deliberately does not exclude them.

### What went wrong the first time — the actual lesson

The first attempt used a stub that returned `''` rather than throwing. Three of
the four cases went red. One did not:

```
  slugify  3/4 case(s) recorded red  [exact]
    ? slugify/handles-empty-input - no failing test matched this case
```

The test asserted `equal(slugify(''), '')` — which a stub returning `''`
satisfies perfectly. So that test was passing for the wrong reason, and would
never have caught a broken empty-input path.

Nobody noticed by reading it. The red proof noticed immediately, and
`--require-red-proof` refused to call the run green:

```
  red-proof     FAIL
      slugify               3/4 proven, 1 never seen red
```

This is the whole argument for the mechanism, and it happened while writing the
example rather than in a hypothetical.

## `shortcuts/` — the fixture the integrity checks are graded against

Never executed. It contains one instance of every shortcut the checks exist to
catch, so that when the self-test reports a class is no longer caught you know
exactly which check lost its teeth.

| in | shortcut | must be caught by |
|---|---|---|
| `test/shortcuts.test.mjs` | `it.only` — a focused test | focused-test check |
| | `it.skip`, `describe.skip` | skipped-test check |
| | two tests with no assertion | assertion-free check |
| `src/leaky.mjs` | `eslint-disable`, `@ts-ignore` | suppression check |
| | `console.log`, `debugger` | debug-leftover check |
| | an empty `catch` | swallowed-error check |

```sh
node ../kernel/bin/general-verify.mjs selftest
```

Green requires **both**: every shortcut class found in `shortcuts/`, and **no
false positives** in `clean/`. A check that fires on clean code gets ignored,
and an ignored check is not a check.

## Note on the config

`general-harness.config.json` sets `scanDirs: ["clean"]` so the ordinary matrix
run only grades the clean unit. The shortcuts directory is a fixture for the
self-test, not part of the demonstration project — if it were scanned normally
the example would be permanently red, which would teach the wrong lesson.
