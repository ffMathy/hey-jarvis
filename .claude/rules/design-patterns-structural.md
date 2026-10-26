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

# Design Patterns: Structural

Structural patterns compose objects and modules into larger structures while keeping those structures flexible. Read the ground rules in [`design-patterns`](design-patterns.md) first: **a pattern must solve a problem present now.**

---

## Adapter

**Intent:** convert one interface into the one callers expect, so incompatible code can work together.

**Problem:** a third-party SDK, an old module or an external API has a shape that does not match your domain interface.

**Use when:** wrapping any external dependency at the boundary — it keeps the dependency replaceable and its quirks out of your domain. Also the cure for [Alternative Classes with Different Interfaces](code-smells.md#alternative-classes-with-different-interfaces) you do not own.

**Don't use when:** you own both sides — change one of them instead.

```typescript
interface WeatherProvider { currentTemperature(city: string): Promise<number> }

function createOpenWeatherAdapter(client: OpenWeatherClient): WeatherProvider {
  return {
    currentTemperature: async (city) => (await client.weather({ q: city, units: 'metric' })).main.temp,
  };
}
```

**Related:** [Facade](#facade) (simplifies; adapter converts), [Decorator](#decorator) (same interface, more behaviour), [Proxy](#proxy) (same interface, controlled access), [Bridge](#bridge).

## Bridge

**Intent:** split one large abstraction into two independent dimensions — the abstraction and its implementation — linked by composition.

**Problem:** a class hierarchy grows in two directions at once (`EmailAlert`, `PushAlert`, `UrgentEmailAlert`, `UrgentPushAlert`…), so every combination needs a subclass.

**Use when:** two dimensions really vary independently and both have more than one variant today.

**Don't use when:** only one dimension varies — that is just an interface with implementations.

```typescript
interface DeliveryChannel { deliver(text: string): Promise<void> }

class Alert {
  constructor(private readonly channel: DeliveryChannel) {}
  send(text: string) { return this.channel.deliver(text); }
}
class UrgentAlert extends Alert {
  send(text: string) { return super.send(`URGENT: ${text}`); }
}
// Any alert kind works with any channel: new UrgentAlert(pushChannel)
```

**Related:** [Adapter](#adapter) (retrofitted; bridge is designed up front), [Strategy](design-patterns-behavioral.md#strategy), [Abstract Factory](design-patterns-creational.md#abstract-factory), [Parallel Inheritance Hierarchies](code-smells.md#parallel-inheritance-hierarchies).

## Composite

**Intent:** compose objects into trees and let callers treat a single leaf and a whole branch through the same interface.

**Problem:** code walks a tree (files and folders, UI nodes, a workflow of steps and sub-workflows) with `if (isGroup)` checks everywhere.

**Use when:** the data is genuinely a recursive part–whole hierarchy.

**Don't use when:** the structure is flat.

```typescript
type ShoppingNode =
  | { kind: 'item'; price: number }
  | { kind: 'bundle'; children: ShoppingNode[] };

const totalPrice = (node: ShoppingNode): number =>
  node.kind === 'item' ? node.price : node.children.reduce((sum, child) => sum + totalPrice(child), 0);
```

**TypeScript:** a recursive discriminated union plus recursive functions is usually simpler than a `Component`/`Leaf`/`Composite` class trio.

**Related:** [Iterator](design-patterns-behavioral.md#iterator) and [Visitor](design-patterns-behavioral.md#visitor) (traverse and operate on composites), [Builder](design-patterns-creational.md#builder), [Decorator](#decorator) (one child instead of many), [Flyweight](#flyweight) (share leaves).

## Decorator

**Intent:** add behaviour to an object by wrapping it in another object with the same interface; wrappers stack.

**Problem:** you need cross-cutting behaviour (logging, caching, retries, metrics) in some combinations, and subclassing for each combination explodes.

**Use when:** the behaviour is orthogonal to the core and should be switchable per instance.

**Don't use when:** you need it on every call unconditionally and the wrapped type is yours — just put it in the type. **NEVER** use a retry decorator to hide a race or a real failure (see [`no-hacks`](no-hacks.md)).

```typescript
function withLogging(provider: WeatherProvider, logger: Logger): WeatherProvider {
  return {
    currentTemperature: async (city) => {
      logger.info('fetching temperature', { city });
      return provider.currentTemperature(city);
    },
  };
}
const provider = withCaching(withLogging(createOpenWeatherAdapter(client), logger));
```

**TypeScript:** higher-order functions (`withX(target)`) are the idiomatic decorator. Note that TypeScript's `@decorator` syntax is a different language feature, not required for this pattern.

**Related:** [Adapter](#adapter) (changes interface), [Proxy](#proxy) (controls access, usually manages the subject's lifecycle itself), [Composite](#composite), [Chain of Responsibility](design-patterns-behavioral.md#chain-of-responsibility), [Strategy](design-patterns-behavioral.md#strategy) (changes the inside instead of the skin).

## Facade

**Intent:** provide one simple interface to a complex subsystem.

**Problem:** every caller has to initialise and orchestrate several classes of a library or subsystem in the right order.

**Use when:** most callers need only a common subset of a subsystem's power; also to define clean entry points between layers (a package's `index.ts`).

**Don't use when:** the facade starts gaining every feature of the subsystem — it becomes a [Large Class](code-smells.md#large-class). Keep it thin, and let advanced callers bypass it.

```typescript
export async function speak(text: string) {
  const audio = await textToSpeech.synthesize({ text, voice: defaultVoice });
  const decoded = await audioDecoder.decode(audio);
  await speakerOutput.play(decoded);
}
```

**Related:** [Adapter](#adapter), [Mediator](design-patterns-behavioral.md#mediator) (coordinates peers; facade only simplifies), [Singleton](design-patterns-creational.md#singleton), [Abstract Factory](design-patterns-creational.md#abstract-factory), [Hide Delegate](refactoring-moving-features.md#hide-delegate).

## Flyweight

**Intent:** fit many objects in memory by sharing the state they have in common (intrinsic) and passing in the state that differs (extrinsic).

**Problem:** a huge number of similar objects (particles, map tiles, glyphs, mesh instances in the hologram) each carry their own copy of identical heavy data.

**Use when:** profiling shows memory or allocation pressure from many near-identical objects.

**Don't use when:** you have not measured a problem — it complicates code for a gain you may not need.

```typescript
const geometryCache = new Map<string, BufferGeometry>();
function sharedGeometry(shape: 'sphere' | 'cube') {
  let geometry = geometryCache.get(shape);
  if (!geometry) { geometry = buildGeometry(shape); geometryCache.set(shape, geometry); }
  return geometry; // intrinsic, shared
}
const particle = { geometry: sharedGeometry('sphere'), position, velocity }; // extrinsic per particle
```

**Related:** [Composite](#composite) (shared leaves), [Singleton](design-patterns-creational.md#singleton) (one instance vs many shared ones), [Change Value to Reference](refactoring-organizing-data.md#change-value-to-reference). In 3D code, GPU instancing is the hardware-level flyweight.

## Proxy

**Intent:** provide a stand-in for another object that controls access to it — lazily creating it, caching, checking permissions, or forwarding to a remote service.

**Problem:** the real object is expensive, remote or sensitive, and callers should not have to manage that.

**Use when:** lazy initialisation of heavy resources, access control, remote clients, or caching behind an unchanged interface.

**Don't use when:** callers could simply create the object when they need it.

```typescript
function createLazyModel(load: () => Promise<Model>): Model {
  let model: Promise<Model> | undefined;
  return {
    predict: async (input) => (await (model ??= load())).predict(input),
  };
}
```

**TypeScript:** an object implementing the same interface is enough; the built-in `Proxy` object is for genuinely dynamic interception and makes types and debugging harder — prefer the explicit form.

**Related:** [Decorator](#decorator) (adds behaviour; proxy controls access), [Adapter](#adapter), [Facade](#facade).
