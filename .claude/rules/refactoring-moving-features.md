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

# Refactoring: Moving Features between Objects

Techniques for putting behaviour and data in the right home: moving functions and fields, splitting and merging classes or modules, and controlling delegation. They cure the [Couplers](code-smells.md#couplers) and [Change Preventers](code-smells.md#change-preventers).

In TypeScript, "class" often means "module": moving a function between files is the same refactoring as moving a method between classes.

---

## Move Method

**When:** a function uses another class's or module's data more than its own ([Feature Envy](code-smells.md#feature-envy)).

**Steps:** copy the function to its new home and adapt it to that context; make the old one delegate, run the tests; then update callers and delete the old one.

❌ **BAD**
```typescript
class Account {
  overdraftCharge() {
    return this.type.isPremium ? 10 + this.daysOverdrawn * 0.85 : this.daysOverdrawn * 1.75;
  }
}
```
✅ **GOOD**
```typescript
class AccountType {
  overdraftCharge(daysOverdrawn: number) {
    return this.isPremium ? 10 + daysOverdrawn * 0.85 : daysOverdrawn * 1.75;
  }
}
```

## Move Field

**When:** a field is used more by another class than by its owner.

**Steps:** add the field (with accessors if needed) to the target; point every use at the target; remove the original.

❌ **BAD**
```typescript
class Account { interestRate = 0.02; type: AccountType; }
```
✅ **GOOD**
```typescript
class AccountType { interestRate = 0.02; }
class Account { type: AccountType; get interestRate() { return this.type.interestRate; } }
```

## Extract Class

**When:** one class does the work of two ([Large Class](code-smells.md#large-class), [Data Clumps](code-smells.md#data-clumps), [Divergent Change](code-smells.md#divergent-change)).

**Steps:** create a class for the split-off responsibility; link the old class to it; [Move Field](#move-field) and [Move Method](#move-method) one at a time; decide whether to expose the new class.

❌ **BAD**
```typescript
class Person {
  name: string;
  officeAreaCode: string;
  officeNumber: string;
  telephoneNumber() { return `(${this.officeAreaCode}) ${this.officeNumber}`; }
}
```
✅ **GOOD**
```typescript
class TelephoneNumber {
  constructor(readonly areaCode: string, readonly number: string) {}
  toString() { return `(${this.areaCode}) ${this.number}`; }
}
class Person { name: string; officeTelephone: TelephoneNumber; }
```

## Inline Class

**When:** a class does almost nothing ([Lazy Class](code-smells.md#lazy-class), [Speculative Generality](code-smells.md#speculative-generality)).

**Steps:** move all its features into the class that uses it; point callers there; delete it. The reverse of [Extract Class](#extract-class).

❌ **BAD**
```typescript
class Person { telephone: TelephoneNumber; }
class TelephoneNumber { number: string; }
```
✅ **GOOD**
```typescript
class Person { telephoneNumber: string; }
```

## Hide Delegate

**When:** callers navigate through one object to reach another ([Message Chains](code-smells.md#message-chains)).

**Steps:** add a method on the server object that does the navigation; switch callers to it; consider hiding the delegate entirely.

❌ **BAD**
```typescript
const manager = person.department.manager;
```
✅ **GOOD**
```typescript
class Person {
  get manager() { return this.department.manager; }
}
const manager = person.manager;
```

## Remove Middle Man

**When:** a class has grown so many forwarding methods it is only a pass-through ([Middle Man](code-smells.md#middle-man)). The reverse of [Hide Delegate](#hide-delegate).

**Steps:** expose the delegate; point callers at it directly; delete the forwarding methods.

❌ **BAD**
```typescript
class Person {
  get manager() { return this.department.manager; }
  get budget() { return this.department.budget; }
  get headcount() { return this.department.headcount; }
}
```
✅ **GOOD**
```typescript
class Person { readonly department: Department; }
const budget = person.department.budget;
```

## Introduce Foreign Method

**When:** a library type lacks one function you need ([Incomplete Library Class](code-smells.md#incomplete-library-class)) and you cannot change it.

**Steps:** write a function in your code that takes the library value as its first parameter; name it as if it belonged there; use it everywhere instead of repeating the expression. **NEVER** patch the library's prototype (see [`no-hacks`](no-hacks.md)).

❌ **BAD**
```typescript
const nextDay = new Date(previousEnd.getFullYear(), previousEnd.getMonth(), previousEnd.getDate() + 1);
```
✅ **GOOD**
```typescript
const addOneDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
const nextDay = addOneDay(previousEnd);
```

## Introduce Local Extension

**When:** a library type lacks several functions you need — too many for loose foreign methods.

**Steps:** create a wrapper (composition, preferred) or subclass that adds them; use it instead of the library type. In TypeScript, a module of functions over the library type is usually enough; reach for a wrapper class only when it needs state. **NEVER** use declaration merging or prototype patches to bolt methods onto a library.

❌ **BAD**
```typescript
declare global { interface Date { addDays(days: number): Date } }
Date.prototype.addDays = function (days) { … };
```
✅ **GOOD**
```typescript
class CalendarDate {
  constructor(private readonly date: Date) {}
  addDays(days: number) { return new CalendarDate(new Date(this.date.getTime() + days * 86_400_000)); }
  isWeekend() { return [0, 6].includes(this.date.getDay()); }
}
```
