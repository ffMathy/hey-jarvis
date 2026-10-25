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

# Refactoring: Organizing Data

Techniques for representing data well: replacing primitives with meaningful types, encapsulating state, untangling associations and replacing type codes. They cure [Primitive Obsession](code-smells.md#primitive-obsession), [Data Class](code-smells.md#data-class) and [Switch Statements](code-smells.md#switch-statements).

**TypeScript adaptations:** a string-literal union or discriminated union usually replaces a type-code class; `readonly` and `ReadonlyArray` usually replace hand-written getters; branded types give a primitive a distinct identity without a wrapper class. See [`typescript`](typescript.md).

---

## Self Encapsulate Field

**When:** a class reads its own field directly, but subclasses or lazy initialisation need to intercept the access.

**Steps:** add a getter (and setter if needed); route every internal access through it.

❌ **BAD**
```typescript
class Range {
  constructor(private low: number, private high: number) {}
  includes(value: number) { return value >= this.low && value <= this.high; }
}
```
✅ **GOOD**
```typescript
class Range {
  constructor(private lowValue: number, private highValue: number) {}
  get low() { return this.lowValue; }
  get high() { return this.highValue; }
  includes(value: number) { return value >= this.low && value <= this.high; }
}
```

Only do this when something actually needs the hook (YAGNI, in [`clean-code`](clean-code.md)).

## Replace Data Value with Object

**When:** a primitive field has grown its own data or behaviour (formatting, validation).

**Steps:** create a class or type for the value; change the field to it; move the related behaviour onto it.

❌ **BAD**
```typescript
class Order { customer: string; }
const isVip = order.customer.endsWith('(VIP)');
```
✅ **GOOD**
```typescript
class Customer {
  constructor(readonly name: string, readonly isVip: boolean) {}
}
class Order { customer: Customer; }
```

## Change Value to Reference

**When:** many equal copies of a value object should really be one shared entity, so an update is seen by everyone.

**Steps:** create a repository (registry) keyed by identity; replace construction with lookups; make the factory return the shared instance.

❌ **BAD**
```typescript
const order = { customer: new Customer(customerId) }; // a fresh copy per order
```
✅ **GOOD**
```typescript
const order = { customer: customerRepository.get(customerId) }; // the one shared Customer
```

## Change Reference to Value

**When:** a reference object is small, rarely changed and awkward to manage as shared state.

**Steps:** make it immutable; compare by value (an `equals` method or structural comparison); drop the registry.

❌ **BAD**
```typescript
const currency = currencyRegistry.get('USD');
if (price.currency === currency) { … } // identity comparison
```
✅ **GOOD**
```typescript
type Currency = 'USD' | 'EUR' | 'DKK';
if (price.currency === 'USD') { … }
```

## Replace Array with Object

**When:** an array holds different kinds of data by position.

**Steps:** create a type with a named field per position; replace index access with field access.

❌ **BAD**
```typescript
const row = ['Liverpool', 15];
const wins = row[1];
```
✅ **GOOD**
```typescript
const performance = { teamName: 'Liverpool', wins: 15 };
const wins = performance.wins;
```

## Duplicate Observed Data

**When:** domain data is stored in UI components, so domain logic depends on the view.

**Steps:** move the data into a domain model; have the view observe it (an observable store, a React state hook over the model, an event emitter) and keep both in sync through that one channel.

❌ **BAD**
```typescript
const total = Number(totalInput.value) * Number(quantityInput.value);
```
✅ **GOOD**
```typescript
const cart = createCartStore();          // domain state
cart.subscribe((state) => render(state)); // the view only reflects it
```

See [Observer](design-patterns-behavioral.md#observer).

## Change Unidirectional Association to Bidirectional

**When:** two classes each need to reach the other, but only one holds a link.

**Steps:** add the back-pointer; pick one side to own updates and keep both ends consistent from there. Only do it when navigation is really needed both ways — it doubles the coupling.

❌ **BAD**
```typescript
class Order { customer: Customer; }
class Customer {} // cannot list its orders without scanning every order
```
✅ **GOOD**
```typescript
class Customer { readonly orders = new Set<Order>(); }
class Order {
  setCustomer(customer: Customer) { this.customer?.orders.delete(this); this.customer = customer; customer.orders.add(this); }
}
```

## Change Bidirectional Association to Unidirectional

**When:** a two-way link exists but one direction is no longer used ([Inappropriate Intimacy](code-smells.md#inappropriate-intimacy)).

**Steps:** replace uses of the unwanted side with a query or a parameter; delete the back-pointer.

❌ **BAD**
```typescript
class Order { customer: Customer; }
class Customer { orders: Order[]; } // nobody navigates this way
```
✅ **GOOD**
```typescript
class Order { customer: Customer; }
class Customer {}
```

## Replace Magic Number with Symbolic Constant

**When:** a literal with a meaning appears in code.

**Steps:** declare a named `const` (module level, `as const` where useful); replace every occurrence that means the same thing.

❌ **BAD**
```typescript
const potentialEnergy = mass * 9.81 * height;
```
✅ **GOOD**
```typescript
const gravitationalAcceleration = 9.81;
const potentialEnergy = mass * gravitationalAcceleration * height;
```

## Encapsulate Field

**When:** a public mutable field can be changed by anyone.

**Steps:** make it `private` (or `#private`) with a getter, or simply `readonly`; add a setter only if writes are part of the contract and need validation.

❌ **BAD**
```typescript
class Person { name: string; }
```
✅ **GOOD**
```typescript
class Person { constructor(readonly name: string) {} }
```

## Encapsulate Collection

**When:** a class returns its internal array or set, so callers mutate it behind its back.

**Steps:** return a `ReadonlyArray` (or a copy); add `add…`/`remove…` methods for permitted changes; never expose a setter for the whole collection.

❌ **BAD**
```typescript
class Playlist { tracks: Track[] = []; }
playlist.tracks.push(track);
```
✅ **GOOD**
```typescript
class Playlist {
  readonly #tracks: Track[] = [];
  get tracks(): ReadonlyArray<Track> { return this.#tracks; }
  addTrack(track: Track) { this.#tracks.push(track); }
}
```

## Replace Type Code with Class

**When:** a field holds one of a set of codes (numbers or strings) that do not affect behaviour, and nothing stops an invalid value.

**Steps:** in TypeScript, replace the code with a **string-literal union** (or a `z.enum`), so the compiler rejects invalid values. Use a class only when the type carries data.

❌ **BAD**
```typescript
const bloodGroupA = 1;
const bloodGroupB = 2;
class Person { bloodGroup: number; }
```
✅ **GOOD**
```typescript
type BloodGroup = 'O' | 'A' | 'B' | 'AB';
class Person { bloodGroup: BloodGroup; }
```

## Replace Type Code with Subclasses

**When:** a type code changes behaviour and never changes after creation.

**Steps:** create a subclass per code; use a factory to choose it; move code-specific behaviour into the subclasses ([Replace Conditional with Polymorphism](refactoring-simplifying-conditionals.md#replace-conditional-with-polymorphism)). In TypeScript a **discriminated union** with exhaustive `switch` is often lighter than a class hierarchy.

❌ **BAD**
```typescript
class Employee { type: 'engineer' | 'salesperson'; bonus() { return this.type === 'engineer' ? 0 : this.sales * 0.1; } }
```
✅ **GOOD**
```typescript
type Employee =
  | { kind: 'engineer' }
  | { kind: 'salesperson'; sales: number };
const bonus = (employee: Employee) => (employee.kind === 'salesperson' ? employee.sales * 0.1 : 0);
```

## Replace Type Code with State/Strategy

**When:** a type code changes behaviour **and** can change during the object's life, or subclasses are not possible.

**Steps:** create a state/strategy type per code; hold the current one in a field; delegate behaviour to it; swap the field when the code changes. See [State](design-patterns-behavioral.md#state) and [Strategy](design-patterns-behavioral.md#strategy).

❌ **BAD**
```typescript
class Employee { type: 'engineer' | 'manager'; pay() { return this.type === 'manager' ? this.salary + this.bonus : this.salary; } }
```
✅ **GOOD**
```typescript
type PayPolicy = (employee: Employee) => number;
const managerPay: PayPolicy = (employee) => employee.salary + employee.bonus;
class Employee { payPolicy: PayPolicy; pay() { return this.payPolicy(this); } }
```

## Replace Subclass with Fields

**When:** subclasses differ only in constant-returning methods.

**Steps:** add fields for the constants to the parent; set them through a factory; delete the subclasses.

❌ **BAD**
```typescript
class Male extends Person { code() { return 'M'; } }
class Female extends Person { code() { return 'F'; } }
```
✅ **GOOD**
```typescript
class Person { constructor(readonly code: 'M' | 'F') {} }
```
