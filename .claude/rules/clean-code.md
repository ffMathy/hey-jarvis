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

## Never Read Meaning Out of Prose

**NEVER decide state or meaning by regex- or substring-matching human-readable text** — instructions,
model or agent output, tool result text, transcripts, log lines, error messages, descriptions. That
includes test helpers that classify what came back. Prose is written for a reader and gets reworded:
the match breaks silently, or needs anchors and exclusions to dodge its own negations ("not all tasks
have completed yet").

**ALWAYS read a structured field instead** — a status, a list, an error code or class, a typed result.
If the producer does not emit one, add one to it; never parse its wording as a stand-in.

❌ **BAD** — whether a report is the last one, from its wording:

```typescript
const finished = /^\s*all tasks have completed/i.test(report.instructions);
if (error.message.includes('not found')) { ... }
```

✅ **GOOD** — from what the producer states outright:

```typescript
const finished = report.taskIdsInProgress?.length === 0;
if (error instanceof NotFoundError) { ... }
```

Not covered: parsing text that *is* a structured format (URLs, entity ids, paths, JSON), and asserting on
output in a test (`expect(text).toContain(...)`). Deciding what free text *means* is a classifier's job
(see `jev-classifiers.md`), never a regex's.

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
