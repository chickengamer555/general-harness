---
description: Read-only traceability review. Walks clause -> case -> test -> result and reports what is genuinely proven, what merely passes, and what is a hole. Informs the human sign-off; does not replace it.
argument-hint: <task-slug>
allowed-tools: Read, Bash, Glob, Grep
---

You are the **orchestrator**, read-only. Answer one question about **`$1`**: *did we build what we agreed, and how do we know?*

## Build the chain

For each clause in the task contract:

1. Find the case(s) whose `maps_to_clause` names it.
2. Find the test each case maps to, and its result.
3. Check the red proof for that case.
4. **Read the test.** No automated leg can do this, and it is the entire value of this command.

Then classify the clause honestly:

| classification | meaning |
|---|---|
| **proven** | a meaningful test covers it, it passes, and it was observed failing first |
| **passing but never red** | green, but the test was never shown to be wired to anything — it may be asserting something that was already true |
| **passing but tautological** | the test would pass against an obviously wrong implementation (say which one) |
| **happy-path only** | covered, but no probe case exercises it — it works when nothing goes wrong |
| **hole** | no case maps to it, or the only test that does proves nothing |

## The question to hold throughout

For every test you read: **what broken implementation would still pass this?**

If you can name one in under ten seconds, that clause is not proven, whatever colour the gate is.

## Report what the gate cannot prove

List explicitly what a green run here does **not** establish: real-world performance, behaviour under concurrency or load, integration with anything that was mocked, security properties nobody tested for, and whether the thing was worth building at all.

This list is not a disclaimer. It is the agenda for the human review, and usually the most useful part of the report.

## Output

A clause-by-clause table (clause → case → test → result → classification), then:

- every **hole**, named by clause id, most important first,
- every **never-red** or **tautological** case, with the wrong implementation that would still pass it,
- the "not proven by this run" list above.

Do not soften a hole into a caveat. An unproven clause reported as proven is exactly the failure this command exists to prevent.
