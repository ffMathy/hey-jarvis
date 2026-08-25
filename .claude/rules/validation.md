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

## Unit Tests vs Integration Tests

The suite is split in two by file name:

- `*.spec.ts` / `*.test.ts` — mocked, offline, no credentials. Run by `turbo test`.
- `*.integration.spec.ts` — real credentials, real APIs, real quota. Run by `turbo test:integration`.

Only `test:integration` goes through `run-with-env.sh`, so only it resolves
secrets from 1Password. `turbo test` runs with none of them, on purpose.

In CI, `turbo test` runs on every push; `turbo test:integration` runs only once
the pull request is out of draft, and then on every push after that.

A new test belongs in `test:integration` when it needs a credential, reaches the
network, or starts the MCP server. Give it the `*.integration.spec.ts` suffix and
the runner picks it up — there is no list to maintain.

Never reach for a real credential from a `*.spec.ts` file to make it pass. Either
mock the dependency, or rename the file so it runs where the credentials live.

## How to Run Tests

**CRITICAL: Always delegate validation to the `validation` agent.** Never run tests, linting, or builds directly in the main conversation context. The validation agent is purpose-built for this — it captures full output and reports results back.

Use the Task tool with `subagent_type: "validation"` to run:
- Linting: `bunx turbo lint --filter=<project>`
- Tests: `bunx turbo test --filter=<project>`
- Integration tests: `bunx turbo test:integration --filter=<project>` (needs 1Password)
- Builds: `bunx turbo build --filter=<project>`
- Full workspace checks: `bunx turbo lint && bunx turbo test && bunx turbo build`

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
