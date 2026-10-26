---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
---

# Clean Code

Essential clean code practices for the Hey Jarvis project.

## Its rules

Each topic is a rule of its own, under the same paths:

- [Variable Naming](clean-code-variable-naming.md)
- [YAGNI (You Aren't Gonna Need It)](clean-code-yagni-you-aren-t-gonna-need-it.md)
- [ETC (Easy To Change)](clean-code-etc-easy-to-change.md)
- [Never Read Meaning Out of Prose](clean-code-never-read-meaning-out-of-prose.md)

## DRY (Don't Repeat Yourself)

Extract duplication when you see:

1. **Identical or very similar code** in 2+ places
2. **Same logic** with minor variations
3. **Related constants** defined multiple times

Duplicated functions go to shared utilities, repeated logic becomes reusable functions, copied constants get one central definition.

## KISS (Keep It Simple)

**ALWAYS choose the simplest design that solves today's problem.** Cleverness is a cost every reader pays. A plain loop beats a reduce nobody can follow; a function beats a class hierarchy with one implementation; a pattern is used because the problem in front of you has its shape (see [`design-patterns`](design-patterns.md)), never to look sophisticated.

## Functions

- **Small and doing one thing.** If you can describe it only with "and", split it ([Extract Method](refactoring-composing-methods.md#extract-method)).
- **One level of abstraction per function.** Don't mix the business decision with string slicing; push details down into well-named helpers.
- **Few parameters.** Three is a lot; more is a [Long Parameter List](code-smells.md#long-parameter-list) — pass an object or a value that already holds them.
- **No flag arguments.** `render(true)` hides two functions in one; write `renderPreview()` and `render()`.
- **No hidden side effects.** A function named `isReady` never changes state; a query never writes, a command never answers (command–query separation).
- **Return early** with guard clauses instead of nesting the happy path ([Replace Nested Conditional with Guard Clauses](refactoring-simplifying-conditionals.md#replace-nested-conditional-with-guard-clauses)).

## Comments

**Code says *what*, comments say *why*.** A comment that restates the next line is noise; a comment that explains a constraint, a trade-off or a non-obvious reason is gold. Before writing a comment that explains *what* a block does, try to make the block say it ([Extract Method](refactoring-composing-methods.md#extract-method), [Extract Variable](refactoring-composing-methods.md#extract-variable)). **NEVER commit commented-out code** — git remembers it.

## Errors

- **Fail loudly at the boundary that knows what went wrong.** Throw an `Error` with a message that names the input and the expectation; never return a sentinel (`-1`, `null`, `''`) that the caller has to remember to check.
- **NEVER swallow an error.** An empty `catch`, or one that logs and carries on as if nothing happened, hides the bug it caught. Handle it, or let it propagate (see [`no-hacks`](no-hacks.md)).
- **Validate at the edges** (user input, network, files, environment) and trust the types inside.

## Readability

- **Avoid magic numbers and strings** — name them ([Replace Magic Number with Symbolic Constant](refactoring-organizing-data.md#replace-magic-number-with-symbolic-constant)).
- **Keep related code together** and order a file top-down: the public entry first, the helpers it calls below it.
- **Make illegal states unrepresentable** with discriminated unions rather than optional fields that must agree with each other.
- **Prefer immutability** — `const`, `readonly`, and returning new values over mutating arguments.

## Related rules

- [`solid`](solid.md) — the five principles of object-oriented design
- [`code-smells`](code-smells.md) — the signs that code needs one of the cleanups above
- [`refactoring`](refactoring.md) — the techniques for making them safely
- [`no-hacks`](no-hacks.md) — fixing the root cause instead of hiding it
