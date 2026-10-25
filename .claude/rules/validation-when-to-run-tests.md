# When to Run Tests

> Part of [Testing Guidelines](validation.md).

**Testing and linting are MANDATORY after making code changes.** You must verify your changes work before reporting completion.

## When to Skip Validation

Validation is **NOT required** when changes only affect non-code files:
- Documentation files (`.md`, `AGENTS.md`, `README.md`, `CHANGELOG.md`)
- Comments-only changes in code files
- Configuration files that don't affect build/runtime (`.gitignore`, `.nxignore`, editor settings)
- License files, `.editorconfig`, or other metadata

If a task includes **both** code and non-code changes, validation is still required.

## After Every Code Change

Run tests after:
- Implementing a new feature
- Fixing a bug
- Refactoring code
- Changing configuration that affects build or runtime
- Updating dependencies

**Important:** Run only tests for the affected changes, unless you are completely done with your task — in which case you should run *all tests* to ensure nothing else is broken.

## Commit and Push Early

**Commit and push as soon as a change is written, before validating it**, then validate locally while CI runs on the push. The two run in parallel, so CI's time is spent at the same time as yours instead of after it.

1. Write the change
2. Commit and push it (opening the draft pull request if there is none)
3. Run local validation (via the `validation` agent) while CI runs
4. Fix whatever either one reports, commit and push again, and repeat until both are green

A pushed commit is not a finished one. Pushing early changes *when* you validate, not *whether*.

## Before Declaring Done

**After every task that touches code, run tests before reporting completion.**

This is non-negotiable — do not tell the user "it's done" until tests have passed locally *and* CI is green on the latest push. Typecheck alone is not sufficient.

Do NOT consider your work complete until:
- All linting passes without warnings or errors
- All tests pass without skipping any
- The build succeeds (if applicable)
- CI passes on the latest pushed commit
