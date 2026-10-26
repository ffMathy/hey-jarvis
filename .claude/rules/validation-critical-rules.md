# Critical Rules

> Part of [Testing Guidelines](validation.md).

## Never Skip Tests

Tests must NEVER be skipped or disabled.

- NEVER use `.skip()` to disable tests
- NEVER comment out failing tests
- NEVER disable tests in CI/CD environments
- NEVER ignore test failures

## Keep Fixing Until It Works

When the validation agent reports failures, you MUST:

1. Analyze the failure output carefully
2. Fix the root cause (not the symptom — no hacks or conditional skipping)
3. Re-run via the validation agent
4. Repeat until ALL tests and linting pass

## What NOT to Do

- Never skip tests with `.skip()`
- Never reduce test expectations to make them pass
- Never disable linting rules without good reason
- Never ignore build warnings or errors
- Never declare a task done, or leave a pull request, with failing tests
- Never proceed if tests fail — fix them first
- Never give up on fixing issues — keep iterating until resolved
