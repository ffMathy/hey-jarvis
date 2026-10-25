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

# Refactoring: Simplifying Method Calls

Techniques that make function signatures and calls easy to understand and hard to misuse. They cure [Long Parameter List](code-smells.md#long-parameter-list), [Data Clumps](code-smells.md#data-clumps) and [Alternative Classes with Different Interfaces](code-smells.md#alternative-classes-with-different-interfaces).

**CRITICAL:** changing an exported signature changes every caller. Update all of them in the same commit, and let the type checker find them — never leave a deprecated overload "for compatibility" inside the monorepo.

---

## Rename Method

**When:** a function's name does not say what it does. Naming rules are in [`clean-code`](clean-code.md).

**Steps:** use the editor's rename (it updates every call site); for a published API, add the new name, delegate from the old one, then remove the old one in a later breaking release.

❌ **BAD**
```typescript
function getSnm(person: Person) { … }
```
✅ **GOOD**
```typescript
function getSecondaryPhoneNumber(person: Person) { … }
```

## Add Parameter

**When:** a function needs information from its caller that it does not have.

**Steps:** add the parameter; update callers. Before adding, check whether [Introduce Parameter Object](#introduce-parameter-object) or [Preserve Whole Object](#preserve-whole-object) fits better — every extra positional parameter grows a [Long Parameter List](code-smells.md#long-parameter-list).

❌ **BAD**
```typescript
function getContact(customer: Customer) { return customer.contacts[0]; }
```
✅ **GOOD**
```typescript
function getContact(customer: Customer, date: Date) { return customer.contacts.find((contact) => contact.isActiveOn(date)); }
```

## Remove Parameter

**When:** a parameter is no longer used ([Dead Code](code-smells.md#dead-code)).

**Steps:** check no override or implementation needs it; remove it from the signature and every call.

❌ **BAD**
```typescript
function getContact(customer: Customer, _date: Date) { return customer.primaryContact; }
```
✅ **GOOD**
```typescript
function getContact(customer: Customer) { return customer.primaryContact; }
```

## Separate Query from Modifier

**When:** a function both returns a value and changes state, so calling it to read has side effects.

**Steps:** split it into a pure query and a command that changes state; have callers call both where they need both.

❌ **BAD**
```typescript
function getTotalAndMarkPaid(order: Order) { order.isPaid = true; return order.total; }
```
✅ **GOOD**
```typescript
const getTotal = (order: Order) => order.total;
function markPaid(order: Order) { order.isPaid = true; }
```

## Parameterize Method

**When:** several functions do the same thing with a different constant.

**Steps:** create one function with a parameter for the varying value; replace the others with calls to it.

❌ **BAD**
```typescript
const raiseByFivePercent = (salary: number) => salary * 1.05;
const raiseByTenPercent = (salary: number) => salary * 1.1;
```
✅ **GOOD**
```typescript
const raise = (salary: number, percentage: number) => salary * (1 + percentage / 100);
```

## Replace Parameter with Explicit Methods

**When:** a function's body is split into branches selected by a parameter value (often a boolean or a string flag) — the reverse of [Parameterize Method](#parameterize-method).

**Steps:** create a function per branch; replace calls that pass a constant with calls to the matching function.

❌ **BAD**
```typescript
function setValue(name: 'height' | 'width', value: number) {
  if (name === 'height') height = value;
  if (name === 'width') width = value;
}
```
✅ **GOOD**
```typescript
function setHeight(value: number) { height = value; }
function setWidth(value: number) { width = value; }
```

## Preserve Whole Object

**When:** a caller pulls several values out of one object only to pass them all to a function.

**Steps:** pass the object instead; let the function read what it needs. Do not do it when it would make a low-level module depend on a high-level type — pass a narrower interface ([Interface Segregation](solid.md#interface-segregation-principle)) instead.

❌ **BAD**
```typescript
const isWithinPlan = plan.withinRange(daysTempRange.low, daysTempRange.high);
```
✅ **GOOD**
```typescript
const isWithinPlan = plan.withinRange(daysTempRange);
```

## Replace Parameter with Method Call

**When:** a caller computes a value and passes it in, though the function could compute it itself.

**Steps:** make the function obtain the value; remove the parameter.

❌ **BAD**
```typescript
const discountLevel = getDiscountLevel(order);
const price = discountedPrice(order, discountLevel);
```
✅ **GOOD**
```typescript
const price = discountedPrice(order); // calls getDiscountLevel(order) internally
```

## Introduce Parameter Object

**When:** a group of parameters always travels together ([Data Clumps](code-smells.md#data-clumps)).

**Steps:** create a type for the group; replace the parameters with one object; then move behaviour that uses the group onto it. In TypeScript, a named-options object with destructuring is idiomatic.

❌ **BAD**
```typescript
function amountInvoiced(startDate: Date, endDate: Date, customerId: string) { … }
```
✅ **GOOD**
```typescript
type DateRange = { start: Date; end: Date };
function amountInvoiced({ period, customerId }: { period: DateRange; customerId: string }) { … }
```

## Remove Setting Method

**When:** a field should be set once at creation and never change.

**Steps:** set it in the constructor or factory; make it `readonly`; delete the setter.

❌ **BAD**
```typescript
class Account { id: string; setId(id: string) { this.id = id; } }
```
✅ **GOOD**
```typescript
class Account { constructor(readonly id: string) {} }
```

## Hide Method

**When:** a function is exported or public but only used inside its own module or class.

**Steps:** make it `private` (or `#private`) or stop exporting it. Unused exports also trip lint; keep the public surface minimal.

❌ **BAD**
```typescript
export function normaliseTranscript(text: string) { … } // only used in this file
```
✅ **GOOD**
```typescript
function normaliseTranscript(text: string) { … }
```

## Replace Constructor with Factory Method

**When:** construction needs more than a constructor can do: pick a subtype, return a cached instance, run async setup, or give the creation a meaningful name.

**Steps:** add a static or module-level `create…` function; make the constructor private if callers must not bypass it; switch callers. This repository already prefers factories (see [`mastra`](mastra.md)). See [Factory Method](design-patterns-creational.md#factory-method).

❌ **BAD**
```typescript
const employee = new Employee(EmployeeType.Engineer);
```
✅ **GOOD**
```typescript
class Employee {
  private constructor(readonly kind: EmployeeKind) {}
  static createEngineer() { return new Employee('engineer'); }
}
```

## Replace Error Code with Exception

**When:** a function returns a special value (`-1`, `null`, `false`) to signal failure, and every caller must remember to check it.

**Steps:** throw a specific `Error` subclass instead; let callers that can handle it `catch` it. In TypeScript, a typed result union (`{ ok: true; value } | { ok: false; error }`) is an equally good cure when failure is an expected outcome — what matters is that the failure cannot be ignored silently.

❌ **BAD**
```typescript
function withdraw(amount: number) { if (amount > balance) return -1; balance -= amount; return 0; }
```
✅ **GOOD**
```typescript
class InsufficientFundsError extends Error {}
function withdraw(amount: number) { if (amount > balance) throw new InsufficientFundsError(); balance -= amount; }
```

## Replace Exception with Test

**When:** an exception is thrown and caught for a condition the caller could simply check first.

**Steps:** add the check before the call; remove the `try`/`catch`. Exceptions are for exceptional cases, not control flow.

❌ **BAD**
```typescript
try { return values[periodNumber].toFixed(2); } catch { return '0.00'; }
```
✅ **GOOD**
```typescript
if (periodNumber >= values.length) return '0.00';
return values[periodNumber].toFixed(2);
```
