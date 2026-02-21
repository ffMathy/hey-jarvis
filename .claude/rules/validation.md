# Testing Guidelines

Strict requirements for when to run tests across the Hey Jarvis project.

## When to Run Tests

**Testing and linting are MANDATORY after making code changes.** You must verify your changes work before reporting completion.

### When to Skip Validation

Validation is **NOT required** when changes only affect non-code files:
- Documentation files (`.md`, `AGENTS.md`, `README.md`, `CHANGELOG.md`)
- Comments-only changes in code files
- Configuration files that don't affect build/runtime (`.gitignore`, `.nxignore`, editor settings)
- License files, `.editorconfig`, or other metadata

If a task includes **both** code and non-code changes, validation is still required.

### After Every Code Change

Run tests after:
- Implementing a new feature
- Fixing a bug
- Refactoring code
- Changing configuration that affects build or runtime
- Updating dependencies

**Important:** Run only tests for the affected changes, unless you are completely done with your task — in which case you should run *all tests* to ensure nothing else is broken.

### Before Declaring Done

**After every task that touches code, run tests before reporting completion.**

This is non-negotiable — do not tell the user "it's done" until tests have passed. Typecheck alone is not sufficient.

Do NOT consider your work complete until:
- All linting passes without warnings or errors
- All tests pass without skipping any
- The build succeeds (if applicable)

## How to Run Tests

**CRITICAL: Always delegate validation to the `validation` agent.** Never run tests, linting, or builds directly in the main conversation context. The validation agent is purpose-built for this — it captures full output and reports results back.

Use the Task tool with `subagent_type: "validation"` to run:
- Linting: `bunx nx lint <project>`
- Tests: `bunx nx test <project>`
- Builds: `bunx nx build <project>`
- All affected: `bunx nx affected --target=test`

## Critical Rules

### Never Skip Tests

Tests must NEVER be skipped or disabled.

- NEVER use `.skip()` to disable tests
- NEVER comment out failing tests
- NEVER disable tests in CI/CD environments
- NEVER ignore test failures

### Keep Fixing Until It Works

When the validation agent reports failures, you MUST:

1. Analyze the failure output carefully
2. Fix the root cause (not the symptom — no hacks or conditional skipping)
3. Re-run via the validation agent
4. Repeat until ALL tests and linting pass

### What NOT to Do

- Never skip tests with `.skip()`
- Never reduce test expectations to make them pass
- Never disable linting rules without good reason
- Never ignore build warnings or errors
- Never commit code with failing tests
- Never proceed if tests fail — fix them first
- Never give up on fixing issues — keep iterating until resolved
