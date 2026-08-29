# Architecture

## The organising principle

Inherited from `assembly-harness`:

> **An agent is viable exactly where a machine-readable verifier can adjudicate
> its output.**

The gate is ground truth *because* agents cannot be trusted to grade themselves.
So the line for automating a role is not seniority or difficulty — it is
**verifiability**.

The corollary shapes this whole repository: **before adding an agent, build the
verifier that catches it lying.** Every check here exists because there is a
specific way to fake green that it closes.

## Why the harness borrows the runner

The most tempting design would ship a test runner. It would also be the fastest
way to make this harness something people route around.

The project already has a runner. The team trusts it, CI runs it, the IDE
integrates with it, and everyone knows how to read its output. Replacing that
buys nothing and costs adoption. So the harness detects it, runs it, and
normalises the result.

What the harness adds is everything the runner structurally cannot do:

| the runner does | the harness adds |
|---|---|
| runs the tests that exist | a contract agreed before the tests existed |
| reports which passed | proof each one was ever red |
| grades tests that ran | catches the tests that were skipped, focused or empty |
| one exit code | one verdict across gate, integrity and proof |

## The three legs

A run is green only when all three are. Green tests with a focused test left in
the file is not green: it is a suite that stopped running most of itself and
said nothing about it.

### 1. gate

The project's own commands, detected or declared. Detection covers Node, Python,
Rust, Go, .NET and Make; an explicit `gate` in the config always wins, because
the project knows its own build better than any heuristic.

The parsing is deliberately conservative. Failing test names are extracted where
the runner's output allows it, and the result carries a `confidence` —
`exact`, `heuristic`, or `exit-code-only`. **The harness never claims more
precision than the output supports**, because a red proof built on exit-code
evidence is much weaker than one built on named failures, and silently blurring
that would undermine the one thing the proof is for.

### 2. integrity

A test suite reports green when every test that **ran** passed. It has no
opinion about the tests that did not run.

That gap is not academic — it is the exact set of moves available to anyone,
human or model, under pressure to make red go away:

- `.only` on one test, and the other thirty stop running silently.
- `.skip` on the failing one.
- A test with no assertion, which passes as long as nothing throws.

These checks sit beside the gate rather than inside it, and they read source
rather than results. They are heuristics over text and say so. A heuristic that
catches four real shortcuts and occasionally asks about a fifth is worth far
more than a perfect check nobody wrote.

### 3. red proof

See `skills/tdd-red-proof/SKILL.md` for the full treatment. In short: a test you
watched fail and then watched pass has demonstrably been wired to what it
claims to check. A test written afterwards has not, and no amount of green
distinguishes the two.

This is the only part of TDD that is mechanically checkable, which is why it is
the only part this harness enforces. Everything else about how you write tests
stays a working habit.

## Trust boundaries

### The canonical hash

`canonicalHash(contract)` is a stable SHA-256 over the contract with volatile
fields stripped and keys sorted. Locking records it; later stages recompute and
compare. This makes "we agreed this" provable rather than asserted, and makes a
goalpost quietly moved mid-run immediately visible.

Red proofs record the hash they were taken against, so a proof for a contract
that has since changed is marked **stale** rather than silently trusted.

### BLOCKED

Three-way verdicts force a lie. A gate that could not run — missing toolchain,
timeout, a script that does not exist — has taught you nothing about the code.

Collapsing that into FAIL sends someone to debug working code for a turn.
Collapsing it into PASS ships unverified code. Keeping it separate is the only
option that does not eventually lie to somebody.

## Anti-collusion

Both agents in the loop share a model lineage, so **drift toward agreement is
the single biggest risk** — two instances of the same model converge happily on
"looks good to me". Four structural defences, none of them exhortation:

1. **The orchestrator runs the gate.** Neither agent produces the verdict.
2. **Stance rotation.** The Critic's stance rotates every turn, led by
   `tautology-hawk` — because a green suite full of tests that would pass
   against a wrong implementation is the failure this system exists to prevent.
3. **Termination breakers.** Livelock, stagnation and a turn cap end a loop that
   is turning without moving.
4. **Read-only Critic.** It cannot edit code. If it wants a change it must
   articulate it — which is also what makes the change reviewable.

## What this harness cannot see

Worth stating plainly, because the honest list is the agenda for human review:

- **Whether a test asserts the right thing.** The red proof shows a test can
  distinguish two states of the code. It cannot show the assertion is correct.
  Only reading it can, which is the Critic's core job and yours.
- **Real-world performance, concurrency, load.** Nothing here measures those.
- **Integration with anything mocked.** A green suite full of mocks proves the
  mocks agree with each other.
- **Security properties nobody tested for.**
- **Whether the thing was worth building.** No verifier has an opinion on that,
  which is precisely why the human gateway is not optional.

## Deliberately not built

- **A bundled test runner.** See above — it would cost adoption and buy nothing.
- **Coverage thresholds.** Coverage measures which lines executed, not whether
  anything was checked. A suite of assertion-free tests reaches 100%. The
  integrity leg targets the real failure directly instead.
- **An opinionated style checker.** The project has one, or has decided not to.
  A harness that imposes a second is a harness people disable.
- **Complexity metrics.** Cyclomatic complexity correlates weakly with anything
  that matters and produces arguments rather than fixes. The `simplicity-hawk`
  stance handles it with judgement instead, which is the right instrument.
