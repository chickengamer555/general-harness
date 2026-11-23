# Skill trigger evals

Prompts for checking by hand that each skill in this repo triggers when it
should and stays quiet when a neighbour fits better. Run each in a fresh session
with the skills installed and note which skill loads. The arrow on a near miss
names the skill that should load instead.

## general-harness

### Should trigger

- "The Kotlin Android app crashes when the list is empty - fix it properly, with a test."
- "Write a Python function that parses these log lines, test-first."
- "Refactor this Rust CLI's argument parsing without breaking anything."
- "/general-harness add retry with backoff to the upload script"
- "The bash backup script deletes the wrong folder sometimes. Reproduce it before you fix it."

### Near miss

- "Build a React settings page with a dark-mode toggle and verify it." -> web-harness
- "My Godot player controller jitters on slopes." -> godot-verify:godot-harness
- "Make my landing page look less generic." -> taste-skill
- "What does this regex do?" -> no harness; just answer

## loop-orchestration

### Should trigger

- "Run /gh-build on the payments task."
- "The builder and critic keep agreeing with no findings - should the loop stop?"
- "Run the full-tier contract loop for the auth change."

### Near miss

- "Fix this off-by-one in one function." -> general-harness (quick tier, no loop)
- "Run /web-build on the SearchBox unit." -> web-harness
- "Why did my red proof say exit-code-only?" -> tdd-red-proof

## tdd-red-proof

### Should trigger

- "general-verify red says 0 cases recorded red - why?"
- "My red proof is marked stale after I edited the contract."
- "This case will not go red against the stub."

### Near miss

- "Which tier should this task be?" -> general-harness
- "My web invariant passes against an empty badge." -> web-harness
- "Set up CI for this repo." -> no harness skill
