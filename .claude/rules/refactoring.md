---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
  - "**/*.kt"
  - "**/*.java"
  - "**/*.cpp"
  - "**/*.h"
---

# Refactoring

Refactoring changes the **structure** of code without changing **what it does**. Done well, it turns messy code into clean code through a series of small, safe steps.

**CRITICAL: A refactoring never changes behaviour.** If the observable result changes, it is not a refactoring — it is a feature or a fix, and it is reviewed as one.

**CRITICAL: Tests are green before you start and green after every step.** If there are no tests covering the code, write them first (see [`validation`](validation.md)).

## How to Refactor

1. **Start from green.** Run the tests that cover the code you are about to touch.
2. **Take one small step** — one technique from the catalog, applied once.
3. **Run the tests again.** Red means undo the step, not patch forward.
4. **Repeat** until the smell is gone. Stop as soon as the code is clear enough for the change you came to make.

Small steps keep every intermediate state working, so a failure always points at the last step taken.

## When to Refactor

- **Rule of Three** — the first time, just write it; the second time, wince at the duplicate but write it; the third time, refactor.
- **When adding a feature** — first reshape the code so the feature is easy to add, then add it. "Make the change easy, then make the easy change."
- **When fixing a bug** — bugs hide in tangled code. Clarifying it often reveals the bug; write the reproducing test first.
- **During code review** — the cheapest moment to fix structure is before it merges.

## When NOT to Refactor

- The code is about to be deleted or rewritten from scratch anyway.
- There are no tests and you cannot write any — make it testable first, in the smallest possible step.
- You are under a deadline and the refactor is unrelated to the change — note it and come back (but see the [`boy-scout-rule`](boy-scout-rule.md) for small things).

## Keep Refactoring and Behaviour Changes Apart

**ALWAYS put refactorings and behaviour changes in separate commits where practical.** A `refactor(...)` commit that also changes behaviour is impossible to review: the reviewer cannot tell which diff lines are supposed to be inert.

```
refactor(shopping): extract quantity parsing into its own function
feat(shopping): support fractional quantities
```

## Dirty Code vs Clean Code

Clean code is:

- **Obvious** — a reader understands it without the author present. See [`clean-code`](clean-code.md) for naming.
- **Free of duplication** — every change is made in one place.
- **Minimal** — no classes, parameters or branches that do nothing today (YAGNI, in [`clean-code`](clean-code.md)).
- **Fully tested** — and the tests pass.
- **Cheap to change** — which is the whole point.

Dirty code shows up as [code smells](code-smells.md). Each smell lists the techniques that cure it.

## Catalog Index

| File | Group |
| --- | --- |
| [code-smells.md](code-smells.md) | The 23 smells that tell you to refactor |
| [refactoring-composing-methods.md](refactoring-composing-methods.md) | Composing Methods — shaping functions |
| [refactoring-moving-features.md](refactoring-moving-features.md) | Moving Features between Objects |
| [refactoring-organizing-data.md](refactoring-organizing-data.md) | Organizing Data |
| [refactoring-simplifying-conditionals.md](refactoring-simplifying-conditionals.md) | Simplifying Conditional Expressions |
| [refactoring-simplifying-method-calls.md](refactoring-simplifying-method-calls.md) | Simplifying Method Calls |
| [refactoring-generalization.md](refactoring-generalization.md) | Dealing with Generalization |

Related: [`design-patterns`](design-patterns.md) (where many refactorings lead), [`solid`](solid.md), [`no-hacks`](no-hacks.md).
