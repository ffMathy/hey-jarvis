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

# Design Patterns: Behavioral

Behavioral patterns are about how objects share responsibilities and communicate. Read the ground rules in [`design-patterns`](design-patterns.md) first: **a pattern must solve a problem present now.** In TypeScript, many of these collapse to functions, closures and generators.

---

## Chain of Responsibility

**Intent:** pass a request along a chain of handlers; each one either handles it or passes it on.

**Problem:** a request goes through a sequence of checks or processors (auth, validation, routing), and hard-wiring the sequence into one function makes it rigid.

**Use when:** the set or order of handlers varies by configuration, or handlers are added by different modules (HTTP middleware, Mastra input processors).

**Don't use when:** there is one fixed sequence — call the functions in order.

```typescript
type Handler = (request: Request, next: () => Promise<Response>) => Promise<Response>;

const runChain = (handlers: Handler[], request: Request, final: () => Promise<Response>) =>
  handlers.reduceRight<() => Promise<Response>>((next, handler) => () => handler(request, next), final)();
```

**Related:** [Decorator](design-patterns-structural.md#decorator) (every wrapper runs; a chain may stop early), [Command](#command), [Composite](design-patterns-structural.md#composite) (a request bubbling up a tree).

## Command

**Intent:** turn a request into an object that holds everything needed to perform it, so it can be queued, logged, retried or undone.

**Problem:** the code that triggers an action should not know how it is executed, or actions must be deferred, persisted or reversed.

**Use when:** you need undo/redo, job queues, scheduled actions, or a record of operations performed.

**Don't use when:** you just need to call something now — a callback is enough.

```typescript
type Command = { description: string; execute(): Promise<void>; undo(): Promise<void> };

const turnOnLight = (lightId: string): Command => ({
  description: `turn on ${lightId}`,
  execute: () => homeAssistant.turnOn(lightId),
  undo: () => homeAssistant.turnOff(lightId),
});
```

**Related:** [Memento](#memento) (undo by snapshot rather than inverse), [Chain of Responsibility](#chain-of-responsibility), [Strategy](#strategy) (how to do something vs what to do), [Observer](#observer).

## Iterator

**Intent:** traverse the elements of a collection without exposing how it is stored.

**Problem:** callers loop over a tree, a paginated API or a stream and duplicate the traversal logic.

**Use when:** the traversal is non-trivial (pagination, tree walk, lazy generation) and several callers need it.

**Don't use when:** it is an array — use `for…of` or array methods.

```typescript
async function* allEvents(calendar: CalendarClient) {
  let pageToken: string | undefined;
  do {
    const page = await calendar.listEvents({ pageToken });
    yield* page.items;
    pageToken = page.nextPageToken;
  } while (pageToken);
}
for await (const event of allEvents(calendar)) { … }
```

**TypeScript:** generators (`function*`, `async function*`) and the iterable protocol *are* this pattern; never hand-write `hasNext()`/`next()` classes.

**Related:** [Composite](design-patterns-structural.md#composite) (iterate trees), [Visitor](#visitor), [Memento](#memento) (save iteration position).

## Mediator

**Intent:** make objects communicate through one coordinator instead of referring to each other directly.

**Problem:** many components call each other (a voice UI where the wake word, the recorder, the sphere animation and the speaker all poke each other), so none can be reused or changed alone.

**Use when:** a tangle of many-to-many dependencies between peers.

**Don't use when:** two objects talk — a direct call is clearer. Beware the mediator itself becoming a [Large Class](code-smells.md#large-class).

```typescript
function createConversation(components: { wakeWord: WakeWord; recorder: Recorder; sphere: Sphere }) {
  components.wakeWord.onDetected(() => { components.sphere.setMood('listening'); components.recorder.start(); });
  components.recorder.onSilence(() => components.sphere.setMood('thinking'));
}
```

**Related:** [Observer](#observer) (often the mechanism inside a mediator), [Facade](design-patterns-structural.md#facade), [Chain of Responsibility](#chain-of-responsibility), [Command](#command).

## Memento

**Intent:** capture an object's state so it can be restored later, without exposing its internals.

**Problem:** you need undo, checkpoints or rollback, but making all fields public to copy them breaks encapsulation.

**Use when:** undo/redo, transactional rollback, saving and resuming progress.

**Don't use when:** state is large and snapshots would be expensive — consider [Command](#command) with inverse operations instead.

```typescript
class Editor {
  #text = '';
  #cursor = 0;
  save() { return Object.freeze({ text: this.#text, cursor: this.#cursor }); }
  restore(snapshot: ReturnType<Editor['save']>) { this.#text = snapshot.text; this.#cursor = snapshot.cursor; }
}
```

**TypeScript:** immutable state (readonly objects, reducers) makes every previous state a memento for free.

**Related:** [Command](#command), [Prototype](design-patterns-creational.md#prototype), [Iterator](#iterator).

## Observer

**Intent:** let subscribers register for notifications and be told when something happens, without the publisher knowing who they are.

**Problem:** several parts of the system must react to a change, and the source should not depend on them.

**Use when:** one-to-many notifications: UI reacting to state, events crossing module boundaries.

**Don't use when:** there is exactly one listener that never changes — call it. **ALWAYS** return or expose an unsubscribe, and call it — forgotten subscriptions leak memory and fire on dead components.

```typescript
class BatteryMonitor extends EventTarget {
  report(level: number) { this.dispatchEvent(new CustomEvent('level', { detail: level })); }
}
const controller = new AbortController();
monitor.addEventListener('level', (event) => render(event), { signal: controller.signal });
controller.abort(); // unsubscribe
```

**TypeScript:** `EventTarget`, Node's `EventEmitter`, a typed emitter library, RxJS or a store's `subscribe` — use what the platform already provides (see [`use-npm-packages`](use-npm-packages.md)).

**Related:** [Mediator](#mediator), [Chain of Responsibility](#chain-of-responsibility), [Command](#command), [Duplicate Observed Data](refactoring-organizing-data.md#duplicate-observed-data).

## State

**Intent:** let an object change its behaviour when its internal state changes, by delegating to a state object per mode.

**Problem:** methods are full of `switch (this.mode)` and transitions are scattered and easy to get wrong.

**Use when:** an object has a few well-defined modes with different behaviour and explicit transitions (idle → listening → thinking → speaking).

**Don't use when:** there are two states and one `if` — keep the `if`.

```typescript
type AssistantState =
  | { name: 'idle' }
  | { name: 'listening'; startedAt: number }
  | { name: 'speaking'; utteranceId: string };

function onWakeWord(state: AssistantState): AssistantState {
  switch (state.name) {
    case 'idle': return { name: 'listening', startedAt: Date.now() };
    case 'listening': case 'speaking': return state;
  }
}
```

**TypeScript:** a discriminated union plus a transition function (reducer) is the lightweight form; for complex machines use a state-machine library (e.g. XState) rather than hand-rolling one.

**Related:** [Strategy](#strategy) (strategies are independent and chosen by the caller; states know about each other and switch themselves), [Replace Type Code with State/Strategy](refactoring-organizing-data.md#replace-type-code-with-statestrategy), [Flyweight](design-patterns-structural.md#flyweight) (share stateless states).

## Strategy

**Intent:** define a family of interchangeable algorithms and let the caller pick one.

**Problem:** a function hard-codes one algorithm behind a `switch`, or callers need to plug in their own.

**Use when:** several algorithms for the same task exist today, chosen at runtime or by the caller.

**Don't use when:** there is one algorithm — that is [Speculative Generality](code-smells.md#speculative-generality).

```typescript
type RankingStrategy = (products: Product[]) => Product[];

const cheapestFirst: RankingStrategy = (products) => products.toSorted((first, second) => first.price - second.price);

function recommend(products: Product[], rank: RankingStrategy = cheapestFirst) {
  return rank(products).slice(0, 3);
}
```

**TypeScript:** a strategy is a function parameter. Use an interface with several methods only when the strategy needs more than one operation.

**Related:** [State](#state), [Template Method](#template-method) (inheritance-based variation; strategy is composition-based), [Decorator](design-patterns-structural.md#decorator), [Command](#command), [Open/Closed](solid.md#openclosed-principle).

## Template Method

**Intent:** define an algorithm's skeleton once and let specific steps vary.

**Problem:** several implementations repeat the same sequence of steps with different details ([Duplicate Code](code-smells.md#duplicate-code)).

**Use when:** the sequence is fixed and must stay consistent, and only step details vary.

**Don't use when:** the varying parts are better passed as functions — which in TypeScript is usually the case. Subclass-based templates couple every variant to the base class.

```typescript
async function runImport<Record>(steps: {
  fetch: () => Promise<unknown>;
  parse: (raw: unknown) => Record[];
  save: (records: Record[]) => Promise<void>;
}) {
  const raw = await steps.fetch();
  await steps.save(steps.parse(raw));
}
```

**Related:** [Strategy](#strategy), [Factory Method](design-patterns-creational.md#factory-method) (a specialised template step), [Form Template Method](refactoring-generalization.md#form-template-method).

## Visitor

**Intent:** separate an operation from the object structure it runs over, so new operations can be added without changing the element types.

**Problem:** you keep adding operations (render, validate, serialise) to every class in a stable hierarchy, bloating each one.

**Use when:** the set of element types is stable but operations keep growing — ASTs, document trees, workflow graphs.

**Don't use when:** element types change often — every new type forces a change to every visitor.

```typescript
type DocumentNode = { kind: 'text'; value: string } | { kind: 'link'; href: string; label: string };

type Visitor<Result> = { [Kind in DocumentNode['kind']]: (node: Extract<DocumentNode, { kind: Kind }>) => Result };

function visit<Result>(node: DocumentNode, visitor: Visitor<Result>): Result {
  switch (node.kind) {
    case 'text': return visitor.text(node);
    case 'link': return visitor.link(node);
  }
}

const toMarkdown: Visitor<string> = { text: (node) => node.value, link: (node) => `[${node.label}](${node.href})` };
```

**TypeScript:** a discriminated union plus a mapped-type handler object gives compile-time exhaustiveness without double dispatch: adding a node kind fails to compile until every visitor handles it.

**Related:** [Composite](design-patterns-structural.md#composite) (visitors often walk composites), [Iterator](#iterator), [Command](#command), [Replace Conditional with Polymorphism](refactoring-simplifying-conditionals.md#replace-conditional-with-polymorphism).
