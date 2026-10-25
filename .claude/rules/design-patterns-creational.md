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

# Design Patterns: Creational

Creational patterns control how objects are created, so callers depend on *what* they need rather than *which concrete class* provides it. Read the ground rules in [`design-patterns`](design-patterns.md) first: **a pattern must solve a problem present now.**

---

## Factory Method

**Intent:** delegate the choice of concrete type to a creation function (or an overridable method), so callers only see the common interface.

**Problem:** `new ConcreteThing()` is spread across callers; adding a new kind means editing all of them.

**Use when:** the concrete type depends on input or configuration; creation needs defaults, validation or wiring; you want one place to change how things are made. This repository's `createAgent`/`createTool`/`createWorkflow` factories are this pattern (see [`mastra`](mastra.md)).

**Don't use when:** there is one concrete type and no setup — call the constructor.

```typescript
interface Notifier { send(message: string): Promise<void> }

function createNotifier(channel: 'email' | 'push'): Notifier {
  switch (channel) {
    case 'email': return new EmailNotifier();
    case 'push': return new PushNotifier();
  }
}
```

**TypeScript:** a plain module-level `create…` function is the idiomatic form; the class-hierarchy variant (an abstract `createProduct()` overridden by subclasses) is only needed when a framework dictates subclassing.

**Related:** [Abstract Factory](#abstract-factory) (a family of factory methods), [Prototype](#prototype), [Replace Constructor with Factory Method](refactoring-simplifying-method-calls.md#replace-constructor-with-factory-method).

## Abstract Factory

**Intent:** provide one interface for creating a *family* of related objects, so the members always match.

**Problem:** objects must be used together (a light theme's button with a light theme's dialog; a test fake's client with its fake store), and mixing families is a bug.

**Use when:** there are at least two real families today — e.g. production vs in-memory test implementations of several collaborating services.

**Don't use when:** there is one family, or the "family" has one member — that is a [Factory Method](#factory-method).

```typescript
interface StorageFactory {
  createMemoryStore(): MemoryStore;
  createVectorStore(): VectorStore;
}
const inMemoryStorage: StorageFactory = {
  createMemoryStore: () => new InMemoryMemoryStore(),
  createVectorStore: () => new InMemoryVectorStore(),
};
```

**TypeScript:** an object literal of factory functions satisfying an interface; no class needed.

**Related:** [Factory Method](#factory-method), [Builder](#builder), [Singleton](#singleton) (a factory is often a single instance), [Dependency Inversion](solid.md#dependency-inversion-principle).

## Builder

**Intent:** construct a complex object step by step, separating the construction process from the final representation.

**Problem:** a constructor with many optional parameters ("telescoping constructor"), or an object that must be assembled in stages and validated at the end.

**Use when:** construction has real ordering or validation rules, or the same steps produce different representations (e.g. building a request for two APIs).

**Don't use when:** an options object with defaults does the job — in TypeScript it almost always does.

```typescript
const prompt = new PromptBuilder()
  .withSystemInstructions(instructions)
  .withHistory(messages)
  .withTools(tools)
  .build(); // validates: throws if instructions are missing
```

❌ **Over-engineered:** a builder for `{ name, age }`. ✅ **Instead:** `createPerson({ name, age })`.

**Related:** [Abstract Factory](#abstract-factory), [Composite](design-patterns-structural.md#composite) (builders often assemble trees), [Introduce Parameter Object](refactoring-simplifying-method-calls.md#introduce-parameter-object).

## Prototype

**Intent:** create new objects by copying an existing, configured instance instead of building from scratch.

**Problem:** an object is expensive or fiddly to configure, and you need many variations of it, without coupling to its concrete class.

**Use when:** you need copies of preconfigured objects (test fixtures, default configurations) and the copy must be independent of the original.

**Don't use when:** a factory function with parameters produces the variations just as easily.

```typescript
const baseRequest = { model: 'gemini-flash-latest', temperature: 0, tools: [] as string[] };
const weatherRequest = { ...structuredClone(baseRequest), tools: ['getForecast'] };
```

**TypeScript:** spread (`{ ...object }`) for shallow copies, `structuredClone` for deep copies of plain data. Beware: spread shares nested objects, and `structuredClone` drops class prototypes and functions — give classes an explicit `clone()` method instead.

**Related:** [Factory Method](#factory-method), [Memento](design-patterns-behavioral.md#memento), [Composite](design-patterns-structural.md#composite) (cloning trees).

## Singleton

**Intent:** ensure a type has exactly one instance and provide one access point to it.

**Problem:** a resource must be shared (a connection pool, a shared memory store, a logger), and creating two would be wrong or wasteful.

**Use when:** there is a genuine "exactly one per process" requirement.

**Don't use when:** you just want convenient global access — that is hidden global state. **NEVER** let a singleton hold mutable state that tests cannot reset; it makes test order matter and hides dependencies from signatures.

```typescript
// shared-memory.ts — the module system guarantees one instance per process
let sharedMemory: Memory | undefined;
export function getSharedMemory() {
  sharedMemory ??= new Memory({ storage: createStorage() });
  return sharedMemory;
}
```

**TypeScript:** a module-level instance (eagerly `export const`, or lazily as above) replaces the classic private-constructor-plus-`getInstance()` class. **ALWAYS** let code that uses it accept it as a parameter where practical, so tests can pass a fake ([Dependency Inversion](solid.md#dependency-inversion-principle)).

**Related:** [Facade](design-patterns-structural.md#facade) (often a single instance), [Abstract Factory](#abstract-factory), [Flyweight](design-patterns-structural.md#flyweight) (many shared instances, not one).
