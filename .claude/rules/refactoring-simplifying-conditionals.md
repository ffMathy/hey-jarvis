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

# Refactoring: Simplifying Conditional Expressions

Conditionals grow more tangled with every special case. These techniques flatten, name and remove them. They cure [Switch Statements](code-smells.md#switch-statements), [Long Method](code-smells.md#long-method) and [Duplicate Code](code-smells.md#duplicate-code).

---

## Decompose Conditional

**When:** a condition or its branches are complex enough that you have to decode them.

**Steps:** [extract](refactoring-composing-methods.md#extract-method) the condition into a well-named predicate, and each branch into a well-named function.

❌ **BAD**
```typescript
const charge = date >= summerStart && date <= summerEnd
  ? quantity * summerRate
  : quantity * winterRate + winterServiceCharge;
```
✅ **GOOD**
```typescript
const charge = isSummer(date) ? summerCharge(quantity) : winterCharge(quantity);
```

## Consolidate Conditional Expression

**When:** several checks lead to the same result.

**Steps:** combine them with `||` / `&&` into one expression; extract it into a named predicate.

❌ **BAD**
```typescript
if (employee.seniority < 2) return 0;
if (employee.monthsDisabled > 12) return 0;
if (employee.isPartTime) return 0;
```
✅ **GOOD**
```typescript
const isNotEligibleForDisability = (employee: Employee) =>
  employee.seniority < 2 || employee.monthsDisabled > 12 || employee.isPartTime;
if (isNotEligibleForDisability(employee)) return 0;
```

## Consolidate Duplicate Conditional Fragments

**When:** the same code appears in every branch of a conditional.

**Steps:** move the shared code before or after the conditional.

❌ **BAD**
```typescript
if (isSpecialDeal()) { total = price * 0.95; send(); }
else { total = price * 0.98; send(); }
```
✅ **GOOD**
```typescript
const total = isSpecialDeal() ? price * 0.95 : price * 0.98;
send();
```

## Remove Control Flag

**When:** a boolean variable steers a loop or a series of checks (`let found = false`).

**Steps:** replace setting the flag with `break`, `continue` or `return`; prefer array methods (`find`, `some`, `every`) where they fit.

❌ **BAD**
```typescript
let found = false;
for (const person of people) {
  if (!found && person.isSuspicious) { sendAlert(person); found = true; }
}
```
✅ **GOOD**
```typescript
const suspect = people.find((person) => person.isSuspicious);
if (suspect) sendAlert(suspect);
```

## Replace Nested Conditional with Guard Clauses

**When:** nested `if`s hide the normal path of a function.

**Steps:** turn each special case into an early `return` (or `throw`) at the top; leave the main path unindented at the bottom.

❌ **BAD**
```typescript
function payAmount(employee: Employee) {
  if (employee.isDead) { return deadAmount(); }
  else { if (employee.isSeparated) { return separatedAmount(); } else { return normalPayAmount(); } }
}
```
✅ **GOOD**
```typescript
function payAmount(employee: Employee) {
  if (employee.isDead) return deadAmount();
  if (employee.isSeparated) return separatedAmount();
  return normalPayAmount();
}
```

## Replace Conditional with Polymorphism

**When:** a conditional picks behaviour by the type or kind of an object, and the same choice recurs elsewhere ([Switch Statements](code-smells.md#switch-statements)).

**Steps:** give each kind its own implementation of the behaviour (subclass, object in a lookup table, or handler per union member); call it instead of branching. In TypeScript, a `Record<Kind, Handler>` keyed by a discriminant is the lightest form; the compiler enforces that every kind has a handler.

❌ **BAD**
```typescript
function speed(bird: Bird) {
  switch (bird.kind) {
    case 'european': return baseSpeed;
    case 'african': return baseSpeed - loadFactor * bird.coconuts;
  }
}
```
✅ **GOOD**
```typescript
const speedByKind: { [Kind in Bird['kind']]: (bird: Extract<Bird, { kind: Kind }>) => number } = {
  european: () => baseSpeed,
  african: (bird) => baseSpeed - loadFactor * bird.coconuts,
};
```

A single exhaustive `switch` with a `never` default is fine; polymorphism earns its keep when the same branching appears twice or more.

## Introduce Null Object

**When:** code checks for `null`/`undefined` in many places and does the same default thing each time.

**Steps:** create an object that implements the same interface with neutral behaviour; return it instead of `null`; delete the checks. In TypeScript, consider first whether `?.` and `??` at the one boundary are enough.

❌ **BAD**
```typescript
const plan = customer ? customer.plan : basicPlan;
const name = customer ? customer.name : 'occupant';
```
✅ **GOOD**
```typescript
const unknownCustomer: Customer = { name: 'occupant', plan: basicPlan };
const resolvedCustomer = site.customer ?? unknownCustomer;
```

## Introduce Assertion

**When:** a piece of code only works if some condition holds, and that assumption is implicit.

**Steps:** state it as an assertion that throws with a clear message (an assertion function `asserts value is T` narrows the type too). Never use an assertion for input validation from users — that is real error handling.

❌ **BAD**
```typescript
// the project should have an expense limit or a primary project
const limit = project.expenseLimit ?? project.primaryProject!.memberExpenseLimit;
```
✅ **GOOD**
```typescript
function assertDefined<Value>(value: Value | undefined, message: string): asserts value is Value {
  if (value === undefined) throw new Error(message);
}
function expenseLimit(project: Project) {
  if (project.expenseLimit !== undefined) return project.expenseLimit;
  assertDefined(project.primaryProject, 'a project without an expense limit needs a primary project');
  return project.primaryProject.memberExpenseLimit;
}
```
