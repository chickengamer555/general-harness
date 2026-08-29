# Quickstart — a verified change in ten minutes

Quick mode: no subagents, no run directories, just the discipline. Assume you
have a project and a small piece of work to do.

## 1. See what the project already has

```sh
cd your-project
node ~/Documents/general-harness/kernel/bin/general-verify.mjs detect
```

```
  stack   Node / JavaScript / TypeScript
  runner  vitest
  gate    detected

  test        npm test --silent
  lint        npm run lint --silent
  typecheck   npx tsc --noEmit
```

If nothing is detected, **ask** for the test command and put it in the config.
Do not guess — running the wrong command in an unfamiliar repository can be
destructive.

```sh
node ~/Documents/general-harness/kernel/bin/general-verify.mjs init
```

## 2. Write the contract — before anything else

Say you need a retry helper. Start with what must be true.

`verify/retry.task.json`:

```jsonc
{
  "task": "retry",
  "title": "Retry helper",
  "description": "Retry an async operation on failure with exponential backoff, giving up after a bounded number of attempts and surfacing the last error rather than swallowing it.",
  "tier": "quick",

  "clauses": [
    { "id": "A1", "text": "An operation that succeeds first time is called exactly once.",
      "observable_by": "a test named \"calls once on success\" passes" },
    { "id": "A2", "text": "A failing operation is retried up to the attempt limit and no further.",
      "observable_by": "a test named \"stops at the attempt limit\" passes" },
    { "id": "A3", "text": "When every attempt fails, the LAST error is thrown - never swallowed, never replaced with a generic one.",
      "observable_by": "a test named \"throws the last error\" passes",
      "rationale": "A generic 'retries exhausted' error destroys the only information anyone debugging this will have." },
    { "id": "A4", "text": "Backoff grows between attempts rather than hammering immediately.",
      "observable_by": "a test named \"backs off between attempts\" passes" }
  ],

  "units": [
    { "id": "retry",
      "surface": "src/retry.js",
      "tests": "test/retry.test.js",
      "cases": [
        { "id": "calls-once-on-success", "description": "the happy path", "maps_to_clause": "A1" },
        { "id": "stops-at-the-attempt-limit", "description": "exactly N attempts, not N+1", "probe": true, "maps_to_clause": "A2" },
        { "id": "throws-the-last-error", "description": "the failure path - the case most likely to be silently wrong", "probe": true, "maps_to_clause": "A3" },
        { "id": "backs-off-between-attempts", "description": "delays grow", "maps_to_clause": "A4" }
      ] }
  ],

  "non_goals": ["jitter", "per-error-type retry policies", "a circuit breaker"]
}
```

Note where the probes are: the **attempt limit** and the **error surfaced on
total failure**. Those are the two things that go wrong in retry helpers. A probe
pointed at the easy case is decoration.

Note the non-goals too. Without them, "shouldn't this have jitter?" arrives at
review time instead of now.

```sh
general-verify lint
```

Then show the clauses to whoever asked and check that is what they meant. One
message. It is the only gateway quick mode has, and skipping it means everything
downstream treats guesses as settled.

## 3. Write the failing tests

Write them against the contract, one per case, named so the case ids match:

```js
test('retry calls once on success', async () => { /* ... */ });
test('retry stops at the attempt limit', async () => { /* ... */ });
test('retry throws the last error', async () => { /* ... */ });
test('retry backs off between attempts', async () => { /* ... */ });
```

Create the implementation as a stub that **obviously** fails:

```js
export async function retry() {
  throw new Error('retry: not implemented');
}
```

A stub returning a plausible-looking default is a trap: a test asserting on that
default will pass, and the red proof will correctly refuse to count it.

## 4. Watch it fail, and record that

```sh
general-verify red --task retry
```

```
  retry  4/4 case(s) recorded red  [exact]
```

**If a case does not go red, stop and find out why.** It means the test asserts
something that was already true — exactly the test that would never have caught
the bug. Strengthen the assertion, then re-record.

## 5. Implement to green

The smallest change that satisfies the contract, written to read like the code
around it.

```sh
general-verify --require-red-proof
```

```
  test          PASS   842ms  npm test --silent
  lint          PASS   1201ms npm run lint --silent
  integrity     PASS   8 test file(s), 24 source file(s)
  red-proof     PASS
      retry                 4/4 proven

  GREEN  4 leg(s), 0 failed, 0 blocked, 1 contract(s)
```

## 6. Review your own work adversarially — once

Pick a stance and hold it honestly for one pass:

- **tautology-hawk** — for each test: *what broken implementation would still
  pass this?* If `throws-the-last-error` only asserts that *something* threw, a
  helper throwing a generic error passes it. That is a wrong implementation the
  test does not catch.
- **failure-mode-hawk** — what if the operation throws synchronously? Returns a
  rejected promise? Never resolves?
- **simplicity-hawk** — did an options object appear that the contract never
  asked for?

## 7. Hand back honestly

Report the verdict, then say plainly what a green run here does **not** prove:
real-world timing, behaviour under concurrent callers, integration with the
thing actually being retried. That list is the agenda for the human look, not a
disclaimer.

## Scaling up

For a real feature:

```
/gh-contract checkout "cart totals, discount codes, payment confirmation"
/gh-build checkout
/gh-review checkout
```

Read `docs/architecture.md` for why the loop is shaped this way, and
`skills/loop-orchestration/SKILL.md` for the turn protocol and the termination
breakers.
