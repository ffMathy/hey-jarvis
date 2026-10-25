# Testing Guidelines

Strict requirements for when to run tests across the Hey Jarvis project.

## Its rules

Each topic is a rule of its own, under the same paths:

- [When to Run Tests](validation-when-to-run-tests.md)
- [Every Fix Gets a Test That Reproduces It](validation-every-fix-gets-a-test-that-reproduces-it.md)
- [Unit Tests vs Integration Tests](validation-unit-tests-vs-integration-tests.md)
- [Critical Rules](validation-critical-rules.md)

## How to Run Tests

**CRITICAL: Always delegate validation to the `validation` agent.** Never run tests, linting, or builds directly in the main conversation context. The validation agent is purpose-built for this — it captures full output and reports results back.

Use the Task tool with `subagent_type: "validation"` to run:
- Linting: `bunx turbo lint --filter=<project>`
- Tests: `bunx turbo test --filter=<project>`
- Integration tests: `bunx turbo test:integration --filter=<project>` (needs 1Password)
- Builds: `bunx turbo build --filter=<project>`
- Full workspace checks: `bunx turbo lint && bunx turbo test && bunx turbo build`
