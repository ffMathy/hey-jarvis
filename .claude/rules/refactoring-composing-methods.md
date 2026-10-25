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

# Refactoring: Composing Methods

Techniques for shaping functions: breaking long ones apart, removing needless locals, and clarifying what each piece does. Most cures for [Long Method](code-smells.md#long-method) and [Duplicate Code](code-smells.md#duplicate-code) start here.

**ALWAYS keep tests green between steps** (see [`refactoring`](refactoring.md)). "Method" below means any function, method or arrow function.

---

## Extract Method

**When:** a fragment can be grouped and named, or needs a comment to explain it.

**Steps:** create a function named after *what* the fragment does; move the fragment in; pass the locals it reads as parameters and return the one it produces; replace the fragment with a call.

❌ **BAD**
```typescript
function printInvoice(invoice: Invoice) {
  // print the details
  console.log(`Customer: ${invoice.customerName}`);
  console.log(`Total: ${invoice.total}`);
}
```
✅ **GOOD**
```typescript
function printInvoice(invoice: Invoice) {
  printDetails(invoice);
}
function printDetails(invoice: Invoice) {
  console.log(`Customer: ${invoice.customerName}`);
  console.log(`Total: ${invoice.total}`);
}
```

## Inline Method

**When:** a function's body is as clear as its name, or it only forwards (see [Middle Man](code-smells.md#middle-man), [Speculative Generality](code-smells.md#speculative-generality)).

**Steps:** check it is not overridden or exported for others; replace every call with the body; delete the function.

❌ **BAD**
```typescript
const isAdult = (person: Person) => isOlderThanSeventeen(person);
const isOlderThanSeventeen = (person: Person) => person.age > 17;
```
✅ **GOOD**
```typescript
const isAdult = (person: Person) => person.age > 17;
```

## Extract Variable

**When:** an expression is hard to read at a glance.

**Steps:** assign each meaningful part of the expression to a `const` with an explaining name; use the names in the expression. If the value is needed elsewhere, prefer [Extract Method](#extract-method).

❌ **BAD**
```typescript
if (platform.toUpperCase().includes('MAC') && browser.includes('IE') && resize > 0) { … }
```
✅ **GOOD**
```typescript
const isMacOs = platform.toUpperCase().includes('MAC');
const isInternetExplorer = browser.includes('IE');
const wasResized = resize > 0;
if (isMacOs && isInternetExplorer && wasResized) { … }
```

## Inline Temp

**When:** a temporary variable holds a simple expression and only gets in the way (often before [Replace Temp with Query](#replace-temp-with-query)).

**Steps:** make sure it is assigned once; replace each use with the expression; delete the variable.

❌ **BAD**
```typescript
const basePrice = order.basePrice();
return basePrice > 1000;
```
✅ **GOOD**
```typescript
return order.basePrice() > 1000;
```

## Replace Temp with Query

**When:** a local stores the result of an expression that other functions would also like to use.

**Steps:** extract the expression into a function (side-effect free); replace the local with calls. Only do it when the computation is cheap or memoised.

❌ **BAD**
```typescript
const basePrice = quantity * itemPrice;
return basePrice > 1000 ? basePrice * 0.95 : basePrice * 0.98;
```
✅ **GOOD**
```typescript
const basePrice = () => quantity * itemPrice;
return basePrice() > 1000 ? basePrice() * 0.95 : basePrice() * 0.98;
```

## Split Temporary Variable

**When:** one local is reassigned to hold different things in turn (not a loop counter or accumulator).

**Steps:** give each assignment its own `const` with a name for what it holds.

❌ **BAD**
```typescript
let temporary = 2 * (height + width);
console.log(temporary);
temporary = height * width;
console.log(temporary);
```
✅ **GOOD**
```typescript
const perimeter = 2 * (height + width);
console.log(perimeter);
const area = height * width;
console.log(area);
```

## Remove Assignments to Parameters

**When:** a function reassigns one of its parameters. Readers expect a parameter to keep the value the caller passed.

**Steps:** introduce a local initialised from the parameter; use it instead. Never mutate an object parameter the caller still owns — return a new value.

❌ **BAD**
```typescript
function discount(inputValue: number, quantity: number) {
  if (quantity > 50) inputValue -= 2;
  return inputValue;
}
```
✅ **GOOD**
```typescript
function discount(inputValue: number, quantity: number) {
  const discountAmount = quantity > 50 ? 2 : 0;
  return inputValue - discountAmount;
}
```

## Replace Method with Method Object

**When:** a long function has so many intertwined locals that [Extract Method](#extract-method) cannot separate them.

**Steps:** create a class whose fields are the function's parameters and locals; move the body into a `compute()` method; now extract freely, since locals are fields. In TypeScript, a closure (a function returning inner functions sharing state) often does the same job with less ceremony.

❌ **BAD**
```typescript
function price(order: Order) {
  let primaryBase = 0; let secondaryBase = 0; let tertiaryBase = 0;
  // 60 lines mixing all three…
}
```
✅ **GOOD**
```typescript
class PriceCalculation {
  private primaryBase = 0; private secondaryBase = 0; private tertiaryBase = 0;
  constructor(private readonly order: Order) {}
  compute() { this.computePrimary(); this.computeSecondary(); return this.total(); }
}
```

## Substitute Algorithm

**When:** there is a clearer or library-provided way to do what a function does.

**Steps:** make sure the tests cover the behaviour; replace the body with the new algorithm; run the tests. Prefer a well-known package over a hand-rolled one (see [`use-npm-packages`](use-npm-packages.md)).

❌ **BAD**
```typescript
function findPerson(people: string[]) {
  for (const person of people) {
    if (person === 'Don') return 'Don';
    if (person === 'John') return 'John';
  }
  return '';
}
```
✅ **GOOD**
```typescript
const knownPeople = new Set(['Don', 'John']);
const findPerson = (people: string[]) => people.find((person) => knownPeople.has(person)) ?? '';
```
