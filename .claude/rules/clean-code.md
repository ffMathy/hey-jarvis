---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
---

# Clean Code

Essential clean code practices for the Hey Jarvis project.

## Variable Naming

**CRITICAL: Never shorten variable names** — clarity beats brevity.

Names should be self-documenting, immediately understandable, and clear about what they represent.

✅ **GOOD — full descriptive names:**

```typescript
const requirements = [...];
const acceptanceCriteria = [...];
const implementation = {...};
const dependencies = [...];
```

❌ **BAD — shortened abbreviations:**

```typescript
const req = [...];      // ❌ NEVER
const ac = [...];       // ❌ NEVER
const impl = {...};     // ❌ NEVER
const deps = [...];     // ❌ NEVER
```

The only acceptable abbreviations are industry-standard terms: `id`, `url`, `api`, `html`, `css`, `json`, and `i`/`j`/`k` in short loop contexts.

## YAGNI (You Aren't Gonna Need It)

**Build only what is required right now.** Don't speculate about future needs.

Factory methods should be **opinionated with sensible defaults**, not extensive customization surfaces:

```typescript
// ✅ GOOD - Opinionated with defaults
export const createAgent = (config: AgentConfig) => {
  return new Agent({
    ...config,
    model: getModel('gemini-flash-latest'),
    memory: getSharedMemory(),
  });
};

// ❌ BAD - Too many options
export const createAgent = (config: AgentConfig & {
  customMemory?: Memory,
  customModel?: Model,
  customScorers?: Scorer[],
  customProcessors?: Processor[],
}) => { ... };
```

Add features ONLY when there is a concrete use case right now, multiple call sites show the same need, the cost of not having it is measurable, and you are actively building something that requires it.

**Red flags** that signal a YAGNI violation: "we might need this in the future", "what if someone wants to…", "just in case we need to…", "it's more flexible if we…".

### Remove options every caller sets the same way

**ALWAYS remove an option, parameter or dependency once every real caller passes it the same value**, and hardcode that behaviour. That includes an option your own change has just made uniform: when you flip the last caller, delete the option in the same change. A default kept only so tests can choose the other branch is dead configuration. Rewrite those tests against the one behaviour that ships.

```typescript
// ❌ BAD - every caller passes false; true survives only in tests
createJarvisSession({ ...deps, waitsForGreetingBeforeDialling: false });

// ✅ GOOD - the session always dials behind the greeting; there is nothing to choose
createJarvisSession(deps);
```

### Replace old code, never keep it behind a switch

**NEVER keep the old implementation behind a flag, prop, query parameter, environment variable or fallback when you replace it.** Delete it in the same change. A kept-around path is code nobody runs, that every later change still has to carry and test, and it quietly becomes the thing that ships when the new path hiccups.

```typescript
// ❌ BAD - the 2D body survives behind three switches "just in case"
<JarvisHologram body={process.env.EXPO_PUBLIC_HOLOGRAM_BODY === 'skia' || query.has('flat') ? 'skia' : 'gpu'} />

// ✅ GOOD - the GPU body is the body; the 2D one is gone
<JarvisHologram />
```

If the new code cannot run somewhere, say so and decide what that platform gets — do not keep the old code as a silent fallback.

## DRY (Don't Repeat Yourself)

Extract duplication when you see:

1. **Identical or very similar code** in 2+ places
2. **Same logic** with minor variations
3. **Related constants** defined multiple times

Duplicated functions go to shared utilities, repeated logic becomes reusable functions, copied constants get one central definition.

## ETC (Easy To Change)

Write code that is easy to modify, extend, and adapt.

**Decouple components:**

```typescript
// ✅ GOOD - Loosely coupled
export function processData(data: Data, processor: DataProcessor) {
  return processor.process(data);
}

// ❌ BAD - Tightly coupled
export function processData(data: Data) {
  const processor = new SpecificProcessor();
  return processor.process(data);
}
```

**Use configuration over scattered literals:**

```typescript
// ✅ GOOD - Configurable
export const TIMEOUTS = {
  connect: 60,
  read: 300,
  retry: 60,
};

// ❌ BAD - Hard-coded and scattered throughout the code
const timeout = 60;
```

### ETC vs YAGNI

They work together: make what you build easy to change (ETC), but don't build it before it's needed (YAGNI).

## KISS (Keep It Simple)

**ALWAYS choose the simplest design that solves today's problem.** Cleverness is a cost every reader pays. A plain loop beats a reduce nobody can follow; a function beats a class hierarchy with one implementation; a pattern is used because the problem in front of you has its shape (see [`design-patterns`](design-patterns.md)), never to look sophisticated.

## Functions

- **Small and doing one thing.** If you can describe it only with "and", split it ([Extract Method](refactoring-composing-methods.md#extract-method)).
- **One level of abstraction per function.** Don't mix the business decision with string slicing; push details down into well-named helpers.
- **Few parameters.** Three is a lot; more is a [Long Parameter List](code-smells.md#long-parameter-list) — pass an object or a value that already holds them.
- **No flag arguments.** `render(true)` hides two functions in one; write `renderPreview()` and `render()`.
- **No hidden side effects.** A function named `isReady` never changes state; a query never writes, a command never answers (command–query separation).
- **Return early** with guard clauses instead of nesting the happy path ([Replace Nested Conditional with Guard Clauses](refactoring-simplifying-conditionals.md#replace-nested-conditional-with-guard-clauses)).

## Comments

**Code says *what*, comments say *why*.** A comment that restates the next line is noise; a comment that explains a constraint, a trade-off or a non-obvious reason is gold. Before writing a comment that explains *what* a block does, try to make the block say it ([Extract Method](refactoring-composing-methods.md#extract-method), [Extract Variable](refactoring-composing-methods.md#extract-variable)). **NEVER commit commented-out code** — git remembers it.

## Errors

- **Fail loudly at the boundary that knows what went wrong.** Throw an `Error` with a message that names the input and the expectation; never return a sentinel (`-1`, `null`, `''`) that the caller has to remember to check.
- **NEVER swallow an error.** An empty `catch`, or one that logs and carries on as if nothing happened, hides the bug it caught. Handle it, or let it propagate (see [`no-hacks`](no-hacks.md)).
- **Validate at the edges** (user input, network, files, environment) and trust the types inside.

## Readability

- **Avoid magic numbers and strings** — name them ([Replace Magic Number with Symbolic Constant](refactoring-organizing-data.md#replace-magic-number-with-symbolic-constant)).
- **Keep related code together** and order a file top-down: the public entry first, the helpers it calls below it.
- **Make illegal states unrepresentable** with discriminated unions rather than optional fields that must agree with each other.
- **Prefer immutability** — `const`, `readonly`, and returning new values over mutating arguments.

## Related rules

- [`solid`](solid.md) — the five principles of object-oriented design
- [`code-smells`](code-smells.md) — the signs that code needs one of the cleanups above
- [`refactoring`](refactoring.md) — the techniques for making them safely
- [`no-hacks`](no-hacks.md) — fixing the root cause instead of hiding it
