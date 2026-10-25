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

# Code Smells

A code smell is a surface sign that the structure underneath is wrong. It is not a bug — the code works — but it makes the next change slower and riskier.

**ALWAYS treat a smell in code you are changing as a reason to refactor** (see [`refactoring`](refactoring.md) and the [`boy-scout-rule`](boy-scout-rule.md)). **NEVER** refactor a smell away in the same commit as a behaviour change.

Each smell below lists: **Signs**, **Why it hurts**, **Cure** (techniques from the catalog), and **Leave it when**.

---

## Bloaters

Code that has grown too big to work with. It accumulates slowly, one "just one more line" at a time.

### Long Method

- **Signs:** a function longer than a screen; you need comments to separate its sections; you scroll to find where a variable was set.
- **Why it hurts:** long functions hide duplication and bugs, and can only be understood whole.
- **Cure:** [Extract Method](refactoring-composing-methods.md#extract-method), [Replace Temp with Query](refactoring-composing-methods.md#replace-temp-with-query), [Introduce Parameter Object](refactoring-simplifying-method-calls.md#introduce-parameter-object), [Preserve Whole Object](refactoring-simplifying-method-calls.md#preserve-whole-object), [Replace Method with Method Object](refactoring-composing-methods.md#replace-method-with-method-object), [Decompose Conditional](refactoring-simplifying-conditionals.md#decompose-conditional).
- **Leave it when:** the function is a flat, linear sequence (e.g. a config table or a test arrange block) that reads top to bottom with no branching.

### Large Class

- **Signs:** a class or module with many fields, many methods, and several unrelated groups of them; its name ends in `Manager`, `Helper`, `Utils` or `Service` and means nothing.
- **Why it hurts:** it changes for many reasons (see [Single Responsibility](solid.md#single-responsibility-principle)) and every change risks the rest.
- **Cure:** [Extract Class](refactoring-moving-features.md#extract-class), [Extract Subclass](refactoring-generalization.md#extract-subclass), [Extract Interface](refactoring-generalization.md#extract-interface), [Duplicate Observed Data](refactoring-organizing-data.md#duplicate-observed-data) (to split UI from domain).
- **Leave it when:** it is a cohesive facade over one concept and every member uses the same state.

### Primitive Obsession

- **Signs:** strings and numbers standing for domain concepts (money, ids, units, statuses); string constants used as type codes; arrays whose positions mean different fields (`[latitude, longitude]`).
- **Why it hurts:** validation and behaviour for the concept are scattered, and nothing stops a `userId` being passed as an `orderId`.
- **Cure:** [Replace Data Value with Object](refactoring-organizing-data.md#replace-data-value-with-object), [Replace Type Code with Class](refactoring-organizing-data.md#replace-type-code-with-class), [Replace Type Code with Subclasses](refactoring-organizing-data.md#replace-type-code-with-subclasses), [Replace Type Code with State/Strategy](refactoring-organizing-data.md#replace-type-code-with-statestrategy), [Replace Array with Object](refactoring-organizing-data.md#replace-array-with-object), [Introduce Parameter Object](refactoring-simplifying-method-calls.md#introduce-parameter-object). In TypeScript, a string-literal union or a branded type is often enough.
- **Leave it when:** the value has no rules or behaviour of its own and only passes through.

### Long Parameter List

- **Signs:** more than three or four parameters; several booleans; callers passing `undefined` to reach a later argument.
- **Why it hurts:** calls are unreadable, argument order is easy to swap, and every new need adds one more.
- **Cure:** [Replace Parameter with Method Call](refactoring-simplifying-method-calls.md#replace-parameter-with-method-call), [Preserve Whole Object](refactoring-simplifying-method-calls.md#preserve-whole-object), [Introduce Parameter Object](refactoring-simplifying-method-calls.md#introduce-parameter-object). In TypeScript, a single named-options object.
- **Leave it when:** grouping would create a dependency you do not want (e.g. passing a whole object into a module that must not know about it).

### Data Clumps

- **Signs:** the same three or four values travel together through many signatures and fields (`host, port, username, password`); removing one makes the rest meaningless.
- **Why it hurts:** each occurrence is a copy that must be kept in step.
- **Cure:** [Extract Class](refactoring-moving-features.md#extract-class), [Introduce Parameter Object](refactoring-simplifying-method-calls.md#introduce-parameter-object), [Preserve Whole Object](refactoring-simplifying-method-calls.md#preserve-whole-object).
- **Leave it when:** the values only meet in one place.

---

## Object-Orientation Abusers

Object-oriented features used incompletely or wrongly.

### Switch Statements

- **Signs:** the same `switch`/`if…else if` on a type field repeated in several functions; adding a new kind means editing all of them.
- **Why it hurts:** the knowledge of each kind is spread across the codebase (see [Shotgun Surgery](#shotgun-surgery) and [Open/Closed](solid.md#openclosed-principle)).
- **Cure:** [Replace Conditional with Polymorphism](refactoring-simplifying-conditionals.md#replace-conditional-with-polymorphism), [Replace Type Code with Subclasses](refactoring-organizing-data.md#replace-type-code-with-subclasses), [Replace Type Code with State/Strategy](refactoring-organizing-data.md#replace-type-code-with-statestrategy), [Replace Parameter with Explicit Methods](refactoring-simplifying-method-calls.md#replace-parameter-with-explicit-methods), [Introduce Null Object](refactoring-simplifying-conditionals.md#introduce-null-object). In TypeScript, a lookup `Record<Kind, Handler>` or an exhaustive `switch` on a discriminated union with a `never` check.
- **Leave it when:** there is a single switch, in one place (e.g. a factory or a reducer), and it is exhaustively type-checked.

### Temporary Field

- **Signs:** a field that is only set for one algorithm and is `undefined` the rest of the time; methods check "is this set yet?".
- **Why it hurts:** readers expect a field to be meaningful for the whole lifetime of the object.
- **Cure:** [Extract Class](refactoring-moving-features.md#extract-class) (or [Replace Method with Method Object](refactoring-composing-methods.md#replace-method-with-method-object)) for the field and the code that uses it; [Introduce Null Object](refactoring-simplifying-conditionals.md#introduce-null-object). Often just turn it into a local variable or a parameter.
- **Leave it when:** it is a genuine lazily-initialised cache, documented as such.

### Refused Bequest

- **Signs:** a subclass uses only a little of what it inherits, overrides methods to throw `not supported`, or ignores inherited fields.
- **Why it hurts:** the hierarchy lies — the subclass is not really a kind of its parent (see [Liskov Substitution](solid.md#liskov-substitution-principle)).
- **Cure:** [Replace Inheritance with Delegation](refactoring-generalization.md#replace-inheritance-with-delegation); or [Extract Superclass](refactoring-generalization.md#extract-superclass) and [Push Down Method](refactoring-generalization.md#push-down-method) / [Push Down Field](refactoring-generalization.md#push-down-field) to move the unwanted parts out of the shared parent.
- **Leave it when:** the subclass only skips harmless helpers and still honours every contract of the parent.

### Alternative Classes with Different Interfaces

- **Signs:** two classes or modules do the same job but name their methods differently (`fetchForecast` vs `getWeather`).
- **Why it hurts:** callers cannot swap them, and the duplication is invisible to search.
- **Cure:** [Rename Method](refactoring-simplifying-method-calls.md#rename-method), [Move Method](refactoring-moving-features.md#move-method), [Add Parameter](refactoring-simplifying-method-calls.md#add-parameter), [Parameterize Method](refactoring-simplifying-method-calls.md#parameterize-method), [Extract Superclass](refactoring-generalization.md#extract-superclass) or [Extract Interface](refactoring-generalization.md#extract-interface); then delete one.
- **Leave it when:** they live in separate libraries you do not own — wrap them with an [Adapter](design-patterns-structural.md#adapter) instead.

---

## Change Preventers

A change in one place forces changes in many others.

### Divergent Change

- **Signs:** one module is edited for many unrelated reasons ("when we add a provider I edit this file; when we change the output format I also edit this file").
- **Why it hurts:** unrelated changes collide in one file and in one review.
- **Cure:** [Extract Class](refactoring-moving-features.md#extract-class) per reason to change; [Extract Superclass](refactoring-generalization.md#extract-superclass) / [Extract Subclass](refactoring-generalization.md#extract-subclass) when the variations are kinds of the same thing.
- **Leave it when:** the reasons always change together in practice.

### Shotgun Surgery

- **Signs:** one logical change needs small edits in many files (the mirror of Divergent Change).
- **Why it hurts:** forgetting one edit ships a bug.
- **Cure:** [Move Method](refactoring-moving-features.md#move-method) and [Move Field](refactoring-moving-features.md#move-field) to gather the behaviour in one place; [Inline Class](refactoring-moving-features.md#inline-class) if that leaves an empty shell.
- **Leave it when:** the spread is deliberate layering (e.g. a schema, a migration and a type) and a type check catches every missed spot.

### Parallel Inheritance Hierarchies

- **Signs:** every new subclass of one hierarchy requires a matching subclass in another (`XxxAgent` always comes with `XxxAgentRenderer`).
- **Why it hurts:** a special case of Shotgun Surgery — the hierarchies must be kept in lock-step by hand.
- **Cure:** make instances of one hierarchy refer to the other, then [Move Method](refactoring-moving-features.md#move-method) and [Move Field](refactoring-moving-features.md#move-field) until the second hierarchy disappears.
- **Leave it when:** merging them would couple two layers that must stay apart (e.g. domain and UI).

---

## Dispensables

Something pointless whose removal would make the code cleaner.

### Comments

- **Signs:** a comment explains *what* a block does, because the code does not say it; a comment is needed to name a section of a long function.
- **Why it hurts:** comments go stale while the code moves on; a comment is often a deodorant for a smell.
- **Cure:** [Extract Variable](refactoring-composing-methods.md#extract-variable), [Extract Method](refactoring-composing-methods.md#extract-method), [Rename Method](refactoring-simplifying-method-calls.md#rename-method), [Introduce Assertion](refactoring-simplifying-conditionals.md#introduce-assertion) for stated assumptions.
- **Leave it when:** the comment explains *why* (a constraint, an upstream bug, a non-obvious trade-off), or documents a public API.

### Duplicate Code

- **Signs:** two fragments that look the same or do the same thing differently. See DRY in [`clean-code`](clean-code.md).
- **Why it hurts:** a fix applied to one copy is missing from the other.
- **Cure:** [Extract Method](refactoring-composing-methods.md#extract-method), [Pull Up Method](refactoring-generalization.md#pull-up-method), [Form Template Method](refactoring-generalization.md#form-template-method), [Substitute Algorithm](refactoring-composing-methods.md#substitute-algorithm), [Extract Class](refactoring-moving-features.md#extract-class), [Consolidate Conditional Expression](refactoring-simplifying-conditionals.md#consolidate-conditional-expression), [Consolidate Duplicate Conditional Fragments](refactoring-simplifying-conditionals.md#consolidate-duplicate-conditional-fragments).
- **Leave it when:** the copies are coincidentally similar and will diverge (wait for the Rule of Three), or merging them would create a dependency across a boundary that must stay independent.

### Lazy Class

- **Signs:** a class or module that does almost nothing — one trivial method, or a wrapper that only forwards.
- **Why it hurts:** every abstraction costs a reader a jump; this one pays nothing back.
- **Cure:** [Inline Class](refactoring-moving-features.md#inline-class), [Collapse Hierarchy](refactoring-generalization.md#collapse-hierarchy).
- **Leave it when:** it is a deliberate seam (e.g. an adapter at a library boundary that keeps a dependency replaceable).

### Data Class

- **Signs:** a class with only fields and getters/setters; the logic that uses its data lives in other modules.
- **Why it hurts:** the behaviour that belongs with the data is duplicated by every consumer.
- **Cure:** [Encapsulate Field](refactoring-organizing-data.md#encapsulate-field), [Encapsulate Collection](refactoring-organizing-data.md#encapsulate-collection), [Remove Setting Method](refactoring-simplifying-method-calls.md#remove-setting-method), [Hide Method](refactoring-simplifying-method-calls.md#hide-method), then [Move Method](refactoring-moving-features.md#move-method) / [Extract Method](refactoring-composing-methods.md#extract-method) to bring behaviour to the data.
- **Leave it when:** it is a plain data transfer shape — a Zod schema's inferred type, an API payload, a Mastra tool input. In TypeScript, plain readonly types plus pure functions are idiomatic, not a smell.

### Dead Code

- **Signs:** unused variables, parameters, functions, exports, branches that can never run, commented-out code.
- **Why it hurts:** readers spend time understanding code that does nothing, and are afraid to delete it.
- **Cure:** delete it (git remembers). [Remove Parameter](refactoring-simplifying-method-calls.md#remove-parameter), [Inline Class](refactoring-moving-features.md#inline-class), [Collapse Hierarchy](refactoring-generalization.md#collapse-hierarchy).
- **Leave it when:** never. Commented-out code is never kept "for later".

### Speculative Generality

- **Signs:** abstract classes with one subclass, unused parameters, hooks and options "for later", interfaces with a single implementation and no test double. See YAGNI in [`clean-code`](clean-code.md).
- **Why it hurts:** you pay to read and maintain flexibility nobody uses.
- **Cure:** [Collapse Hierarchy](refactoring-generalization.md#collapse-hierarchy), [Inline Class](refactoring-moving-features.md#inline-class), [Inline Method](refactoring-composing-methods.md#inline-method), [Remove Parameter](refactoring-simplifying-method-calls.md#remove-parameter).
- **Leave it when:** the generality is required today — a framework extension point, or an interface a test double implements.

---

## Couplers

Excessive coupling between modules, or delegation taken too far.

### Feature Envy

- **Signs:** a function uses another object's data more than its own (`order.customer.address.city`, `order.customer.address.country`…).
- **Why it hurts:** the behaviour lives far from the data it depends on, so changes to that data break remote code.
- **Cure:** [Move Method](refactoring-moving-features.md#move-method), [Extract Method](refactoring-composing-methods.md#extract-method) then move the part that envies.
- **Leave it when:** the separation is intentional — a [Strategy](design-patterns-behavioral.md#strategy) or [Visitor](design-patterns-behavioral.md#visitor) keeps behaviour apart from data on purpose.

### Inappropriate Intimacy

- **Signs:** one module reaches into another's private fields or internal files (`import … from 'other-package/src/internal'`); two classes call each other back and forth.
- **Why it hurts:** neither can change without the other.
- **Cure:** [Move Method](refactoring-moving-features.md#move-method), [Move Field](refactoring-moving-features.md#move-field), [Extract Class](refactoring-moving-features.md#extract-class), [Hide Delegate](refactoring-moving-features.md#hide-delegate), [Change Bidirectional Association to Unidirectional](refactoring-organizing-data.md#change-bidirectional-association-to-unidirectional), [Replace Inheritance with Delegation](refactoring-generalization.md#replace-inheritance-with-delegation).
- **Leave it when:** never across package boundaries; within one small module it may be fine.

### Message Chains

- **Signs:** `a.getB().getC().getD().value` — a caller navigates a chain of objects.
- **Why it hurts:** the caller depends on the whole structure; any change in the middle breaks it.
- **Cure:** [Hide Delegate](refactoring-moving-features.md#hide-delegate); or [Extract Method](refactoring-composing-methods.md#extract-method) and [Move Method](refactoring-moving-features.md#move-method) for what the end of the chain is used for.
- **Leave it when:** it is a fluent builder or a query API designed to be chained, or plain data access on a stable readonly shape.

### Middle Man

- **Signs:** most methods of a class only forward to another object.
- **Why it hurts:** an indirection with no value — the over-correction of Message Chains.
- **Cure:** [Remove Middle Man](refactoring-moving-features.md#remove-middle-man), [Inline Method](refactoring-composing-methods.md#inline-method), [Replace Delegation with Inheritance](refactoring-generalization.md#replace-delegation-with-inheritance).
- **Leave it when:** it is a deliberate [Proxy](design-patterns-structural.md#proxy), [Decorator](design-patterns-structural.md#decorator), [Adapter](design-patterns-structural.md#adapter) or [Facade](design-patterns-structural.md#facade), or isolates a dependency.

### Incomplete Library Class

- **Signs:** a library lacks a method you need, and the workaround is repeated at every call site.
- **Why it hurts:** you cannot edit the library (and must not — see [`no-hacks`](no-hacks.md)).
- **Cure:** [Introduce Foreign Method](refactoring-moving-features.md#introduce-foreign-method) for one or two helpers; [Introduce Local Extension](refactoring-moving-features.md#introduce-local-extension) for more. Check first whether another package already does it (see [`use-npm-packages`](use-npm-packages.md)).
- **Leave it when:** the gap is needed in one place only.
