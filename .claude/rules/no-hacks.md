
# No Hacks

**CRITICAL: NEVER ship a hack. ALWAYS fix the root cause.**

A hack makes a symptom disappear while the cause stays. It passes today's check and fails later, somewhere harder to debug, for someone who does not know the hack exists. If you do not yet understand why something fails, keep investigating — "it works now" without "because" is not a fix.

Before writing any workaround, ask: **why does this happen?** Then ask it again of the answer, until you reach something you can actually fix.

---

## Silencing the Compiler

**NEVER** use `@ts-ignore`, `@ts-expect-error`, `as any`, `as unknown as T`, or the `!` non-null assertion to make a type error go away. The type error is telling you something is wrong; fix the types or the code. See [`typescript`](typescript.md).

❌ **BAD**
```typescript
// @ts-ignore
const temperature = response.data.temp;
const user = users.find((candidate) => candidate.id === id)!;
```
✅ **GOOD**
```typescript
const { temperature } = weatherResponseSchema.parse(response.data);
const user = users.find((candidate) => candidate.id === id);
if (!user) throw new Error(`no user with id ${id}`);
```

`@ts-expect-error` is acceptable **only** in a test asserting that something must *not* compile.

## Silencing the Linter

**NEVER** add `biome-ignore` (or `eslint-disable`, `@Suppress`, `#pragma warning`) to make a lint error go away. Fix the code. If a rule is genuinely wrong for the whole project, change the rule in the config, in its own reviewed commit, with the reason. A one-off suppression is only acceptable with a comment explaining a concrete reason the rule cannot apply here — never "to make CI pass".

## Sleeps, Retries and Timeouts over Races

**NEVER** add a `sleep`, `setTimeout`, extra retry or longer timeout to make a flaky test or a race "go away". It hides the race, slows everything down, and fails again on a slower machine.

❌ **BAD**
```typescript
await startServer();
await new Promise((resolve) => setTimeout(resolve, 2000)); // wait for it to be ready
```
✅ **GOOD**
```typescript
const server = startServer();
await server.ready; // resolves once the server is actually listening
```

Wait for the actual event or condition (a promise, a readiness signal, a polled condition with a clear failure message). Retries belong only where failure is genuinely transient and expected (network calls to external services), with a bounded count and backoff — never as a cover for your own bug.

## Special-Casing Test Inputs

**NEVER** make code detect it is under test (`if (process.env.NODE_ENV === 'test')`, checking for a test id or fixture value) or hard-code the values a test expects. The test then verifies the special case, not the code.

❌ **BAD**
```typescript
if (city === 'TestCity') return { temperature: 20 };
```
✅ **GOOD**
```typescript
export function createWeatherTool(provider: WeatherProvider) { … } // test passes a fake provider
```

Inject dependencies instead ([Dependency Inversion](solid.md#dependency-inversion-principle)).

## Swallowing Errors

**NEVER** catch an error and ignore it, log-and-continue as if it succeeded, or return a fake default that hides the failure.

❌ **BAD**
```typescript
try { await saveShoppingList(list); } catch {}
```
✅ **GOOD**
```typescript
try {
  await saveShoppingList(list);
} catch (error) {
  throw new Error(`failed to save shopping list ${list.id}`, { cause: error });
}
```

Catch only to **handle** (recover meaningfully, retry a known-transient failure, translate to a domain error with `cause`). Otherwise let it propagate.

## Magic Flags and Toggles

**NEVER** add a boolean parameter, environment variable or config switch whose only purpose is to turn off broken behaviour (`SKIP_VALIDATION`, `useOldParser`, `disableCache`). Fix the behaviour. A flag doubles the paths that must work and is never removed.

## Copy, Paste and Tweak

**NEVER** duplicate a function or file and change a few lines to get a variant. Extract the shared part and parameterise the difference ([Extract Method](refactoring-composing-methods.md#extract-method), [Parameterize Method](refactoring-simplifying-method-calls.md#parameterize-method), [Duplicate Code](code-smells.md#duplicate-code)).

## Monkey-Patching and Editing Dependencies

**NEVER** edit files in `node_modules`, patch a library's prototype, overwrite globals, or reach into a package's private internals. The change vanishes on the next install and breaks silently on the next upgrade.

❌ **BAD**
```typescript
Array.prototype.last = function () { return this[this.length - 1]; };
import { internalParse } from 'some-library/dist/internal/parser.js';
```
✅ **GOOD**
```typescript
const last = <Item>(items: readonly Item[]) => items.at(-1);
```

Use the library's public API, wrap it ([Adapter](design-patterns-structural.md#adapter), [Introduce Foreign Method](refactoring-moving-features.md#introduce-foreign-method)), upgrade it, or replace it.

## Skipping or Weakening Tests

**NEVER** `.skip()`, comment out, delete, or loosen the assertions of a failing test to make the suite green. See [`validation`](validation.md).

---

## When a Workaround Is Genuinely Unavoidable

Sometimes the root cause is outside this repository — an upstream bug in a library, a platform, or a device firmware — and cannot be fixed here today. Then, and only then, a workaround is allowed, **provided all of these hold**:

1. **The root cause is understood** and confirmed to be upstream, not guessed.
2. **It is isolated** in one small, named function or module — never smeared across call sites.
3. **It links the upstream issue** (or the bug report you filed).
4. **It states the removal condition** — the version or fix after which it can be deleted.
5. **It is tested**, so removing it later shows whether the upstream fix landed.

✅ **GOOD**
```typescript
// Workaround for https://github.com/example/audio-library/issues/1234:
// decodeAudio() rejects WAV files with an extensible header on Android.
// Remove once audio-library >= 3.2.0 is installed.
function normaliseWavHeader(wav: Uint8Array) { … }
```

❌ **BAD**
```typescript
// hack, don't touch
wav[20] = 1;
```
