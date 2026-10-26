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

# Refactoring: Dealing with Generalization

Techniques for moving behaviour up and down inheritance hierarchies, extracting shared abstractions, and swapping inheritance for delegation (or back). They cure [Refused Bequest](code-smells.md#refused-bequest), [Duplicate Code](code-smells.md#duplicate-code) among siblings, [Lazy Class](code-smells.md#lazy-class) and [Speculative Generality](code-smells.md#speculative-generality).

**ALWAYS prefer composition over inheritance** in TypeScript. Many of these techniques exist to repair hierarchies; the cheapest hierarchy to repair is the one never built. Shared behaviour is often best as a plain function or a shared `interface` + helper module. Inheritance is right when a framework demands it (e.g. extending `Error`) or when subtypes truly are substitutable ([Liskov](solid.md#liskov-substitution-principle)).

---

## Pull Up Field

**When:** sibling subclasses declare the same field.

**Steps:** check they are used the same way; move the field to the parent; delete it from the subclasses.

❌ **BAD**
```typescript
class Salesperson extends Employee { name: string; }
class Engineer extends Employee { name: string; }
```
✅ **GOOD**
```typescript
class Employee { name: string; }
```

## Pull Up Method

**When:** sibling subclasses have methods with the same behaviour.

**Steps:** make the bodies identical (via other refactorings if needed); move one to the parent; delete the rest.

❌ **BAD**
```typescript
class Salesperson extends Employee { annualCost() { return this.monthlyCost * 12; } }
class Engineer extends Employee { annualCost() { return this.monthlyCost * 12; } }
```
✅ **GOOD**
```typescript
class Employee { annualCost() { return this.monthlyCost * 12; } }
```

## Pull Up Constructor Body

**When:** subclass constructors repeat the same initialisation.

**Steps:** create a parent constructor that does the shared part; call it with `super(...)` from each subclass; keep only subclass-specific lines there.

❌ **BAD**
```typescript
class Manager extends Employee {
  constructor(name: string, id: string, readonly grade: number) { super(); this.name = name; this.id = id; }
}
```
✅ **GOOD**
```typescript
class Manager extends Employee {
  constructor(name: string, id: string, readonly grade: number) { super(name, id); }
}
```

## Push Down Method

**When:** a parent method is only relevant to one (or a few) subclasses.

**Steps:** move it into the subclasses that use it; delete it from the parent.

❌ **BAD**
```typescript
class Employee { quota() { … } } // only salespeople have quotas
```
✅ **GOOD**
```typescript
class Salesperson extends Employee { quota() { … } }
```

## Push Down Field

**When:** a parent field is only used by some subclasses.

**Steps:** declare it in those subclasses; remove it from the parent.

❌ **BAD**
```typescript
class Employee { commissionRate: number; }
```
✅ **GOOD**
```typescript
class Salesperson extends Employee { commissionRate: number; }
```

## Extract Subclass

**When:** some features of a class are used only by some of its instances.

**Steps:** create a subclass for that subset; move the specific fields and methods into it; create those instances through the subclass. In TypeScript, consider a new member of a discriminated union instead (see [Replace Type Code with Subclasses](refactoring-organizing-data.md#replace-type-code-with-subclasses)).

❌ **BAD**
```typescript
class JobItem { isLabour: boolean; employee?: Employee; unitPrice() { return this.isLabour ? this.employee!.rate : this.price; } }
```
✅ **GOOD**
```typescript
class JobItem { unitPrice() { return this.price; } }
class LabourItem extends JobItem { constructor(readonly employee: Employee) { super(); } unitPrice() { return this.employee.rate; } }
```

## Extract Superclass

**When:** two classes have common fields and methods.

**Steps:** create a parent; [Pull Up Field](#pull-up-field), [Pull Up Method](#pull-up-method), [Pull Up Constructor Body](#pull-up-constructor-body) for the shared parts. If the classes only share *behaviour* and not identity, extract a function or use composition instead.

❌ **BAD**
```typescript
class Department { name: string; annualCost() { … } }
class Employee { name: string; annualCost() { … } }
```
✅ **GOOD**
```typescript
abstract class Party { name: string; abstract annualCost(): number; }
class Department extends Party { annualCost() { … } }
class Employee extends Party { annualCost() { … } }
```

## Extract Interface

**When:** several clients use the same subset of a class, or two classes share a role without sharing code.

**Steps:** declare a TypeScript `interface` (or `type`) for the subset; make the classes implement it; type clients against the interface. Structural typing means implementations need not even mention it. See [Interface Segregation](solid.md#interface-segregation-principle).

❌ **BAD**
```typescript
function bill(employee: Employee) { return employee.rate * employee.daysWorked; }
```
✅ **GOOD**
```typescript
interface Billable { rate: number; daysWorked: number; }
function bill(billable: Billable) { return billable.rate * billable.daysWorked; }
```

## Collapse Hierarchy

**When:** a subclass is practically the same as its parent ([Lazy Class](code-smells.md#lazy-class), [Speculative Generality](code-smells.md#speculative-generality)).

**Steps:** choose which one to keep; move everything into it; point users at it; delete the other.

❌ **BAD**
```typescript
class Employee { … }
class Salesperson extends Employee {} // adds nothing
```
✅ **GOOD**
```typescript
class Employee { … }
```

## Form Template Method

**When:** subclasses implement the same algorithm with the same steps in the same order, differing only in the steps' details.

**Steps:** extract each step into its own method with the same signature in every subclass; pull the algorithm skeleton up to the parent; leave the steps abstract. In TypeScript, a higher-order function taking the varying steps as function parameters often replaces the hierarchy. See [Template Method](design-patterns-behavioral.md#template-method).

❌ **BAD**
```typescript
class TextStatement { value(customer: Customer) { return header(customer) + customer.rentals.map(textLine).join('') + footer(customer); } }
class HtmlStatement { value(customer: Customer) { return htmlHeader(customer) + customer.rentals.map(htmlLine).join('') + htmlFooter(customer); } }
```
✅ **GOOD**
```typescript
type StatementFormat = { header(customer: Customer): string; line(rental: Rental): string; footer(customer: Customer): string };
const statement = (customer: Customer, format: StatementFormat) =>
  format.header(customer) + customer.rentals.map(format.line).join('') + format.footer(customer);
```

## Replace Inheritance with Delegation

**When:** a subclass uses only part of its parent, or inherits things that do not make sense for it ([Refused Bequest](code-smells.md#refused-bequest)).

**Steps:** add a field holding an instance of the former parent; delegate the methods you need to it; remove `extends`.

❌ **BAD**
```typescript
class Stack<Item> extends Array<Item> {} // exposes splice, sort, shift…
```
✅ **GOOD**
```typescript
class Stack<Item> {
  readonly #items: Item[] = [];
  push(item: Item) { this.#items.push(item); }
  pop() { return this.#items.pop(); }
}
```

## Replace Delegation with Inheritance

**When:** a class delegates *everything* to another and is truly a substitutable kind of it ([Middle Man](code-smells.md#middle-man)).

**Steps:** make the class extend the delegate; delete the forwarding methods and the delegate field. Do **not** do it when only part of the interface is delegated, or the delegate is shared with other objects — use [Remove Middle Man](refactoring-moving-features.md#remove-middle-man) instead.

❌ **BAD**
```typescript
class Employee {
  constructor(private readonly person: Person) {}
  get name() { return this.person.name; }
  get lastName() { return this.person.lastName; }
}
```
✅ **GOOD**
```typescript
class Employee extends Person {}
```
