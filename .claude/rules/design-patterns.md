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

# Design Patterns

A design pattern is a named, proven shape for solving a recurring design problem. It is a vocabulary and a template, not a library to install.

## Rules

1. **CRITICAL: A pattern must solve a problem the code has now.** Never add a pattern because a change *might* come (YAGNI, in [`clean-code`](clean-code.md)). Most patterns are reached by [refactoring](refactoring.md) toward them when a smell appears, not designed in up front.
2. **ALWAYS use the simplest form the language allows.** In TypeScript, first-class functions, closures, modules, generators, structural types and `EventTarget` make many classic class-based patterns a few lines long. A Strategy is usually a function parameter; a Singleton is usually a module-level instance.
3. **ALWAYS name the pattern when you use it** — in the identifier (`createWeatherProviderAdapter`, `RetryingClientDecorator`) or in a one-line comment — so the next reader recognises the shape instantly.
4. **NEVER stack patterns for their own sake.** A `FactoryFactory` or an abstract builder for a two-field object is [Speculative Generality](code-smells.md#speculative-generality).
5. **Prefer composition over inheritance** — most patterns below are about composing objects, and that is why they work.

## Signs You Need a Pattern

| Problem you have today | Pattern to consider |
| --- | --- |
| `new ConcreteThing()` scattered everywhere, and the concrete type varies | [Factory Method](design-patterns-creational.md#factory-method), [Abstract Factory](design-patterns-creational.md#abstract-factory) |
| A constructor with many optional parameters | [Builder](design-patterns-creational.md#builder) (or an options object) |
| A third-party API that does not match yours | [Adapter](design-patterns-structural.md#adapter) |
| Cross-cutting behaviour (logging, caching, retry) around an object | [Decorator](design-patterns-structural.md#decorator), [Proxy](design-patterns-structural.md#proxy) |
| A complex subsystem every caller has to orchestrate | [Facade](design-patterns-structural.md#facade) |
| A `switch` choosing an algorithm | [Strategy](design-patterns-behavioral.md#strategy) |
| A `switch` on the current mode, mode changes at runtime | [State](design-patterns-behavioral.md#state) |
| Many objects must react to a change | [Observer](design-patterns-behavioral.md#observer) |
| Operations to queue, undo, log or retry | [Command](design-patterns-behavioral.md#command) |

## Classification

### [Creational](design-patterns-creational.md) — how objects are made

| Pattern | Intent in one line |
| --- | --- |
| [Factory Method](design-patterns-creational.md#factory-method) | Let a function or subclass decide which concrete type to create |
| [Abstract Factory](design-patterns-creational.md#abstract-factory) | Create families of related objects that must match each other |
| [Builder](design-patterns-creational.md#builder) | Construct a complex object step by step |
| [Prototype](design-patterns-creational.md#prototype) | Create new objects by copying an existing one |
| [Singleton](design-patterns-creational.md#singleton) | Ensure exactly one instance, reachable from anywhere |

### [Structural](design-patterns-structural.md) — how objects are composed

| Pattern | Intent in one line |
| --- | --- |
| [Adapter](design-patterns-structural.md#adapter) | Make an incompatible interface fit the one callers expect |
| [Bridge](design-patterns-structural.md#bridge) | Split an abstraction from its implementation so both vary independently |
| [Composite](design-patterns-structural.md#composite) | Treat a tree of objects and a single object the same way |
| [Decorator](design-patterns-structural.md#decorator) | Add behaviour by wrapping an object in another with the same interface |
| [Facade](design-patterns-structural.md#facade) | Give a complex subsystem one simple entry point |
| [Flyweight](design-patterns-structural.md#flyweight) | Share common state between many fine-grained objects to save memory |
| [Proxy](design-patterns-structural.md#proxy) | Stand in for another object to control access to it |

### [Behavioral](design-patterns-behavioral.md) — how objects collaborate

| Pattern | Intent in one line |
| --- | --- |
| [Chain of Responsibility](design-patterns-behavioral.md#chain-of-responsibility) | Pass a request along handlers until one deals with it |
| [Command](design-patterns-behavioral.md#command) | Turn a request into an object that can be stored, queued or undone |
| [Iterator](design-patterns-behavioral.md#iterator) | Traverse a collection without exposing its structure |
| [Mediator](design-patterns-behavioral.md#mediator) | Make objects talk through one coordinator instead of to each other |
| [Memento](design-patterns-behavioral.md#memento) | Capture and restore an object's state without exposing its internals |
| [Observer](design-patterns-behavioral.md#observer) | Notify subscribers when something happens |
| [State](design-patterns-behavioral.md#state) | Change an object's behaviour when its internal state changes |
| [Strategy](design-patterns-behavioral.md#strategy) | Make a family of algorithms interchangeable |
| [Template Method](design-patterns-behavioral.md#template-method) | Fix an algorithm's skeleton and let steps vary |
| [Visitor](design-patterns-behavioral.md#visitor) | Add operations over a structure without changing its element types |

Related: [`solid`](solid.md) (the principles most patterns serve), [`refactoring`](refactoring.md).
