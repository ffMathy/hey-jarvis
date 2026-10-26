# Every Fix Gets a Test That Reproduces It

> Part of [Testing Guidelines](validation.md).

**ALWAYS write a unit test that reproduces the reported issue** before calling a bug fixed, and run it. The test must fail without the fix and pass with it — check that it does, by running it against the unfixed code. A fix with no such test is unverified, and the same bug comes back unnoticed.

**ALWAYS feed the test the shapes the library really emits**, not your guess of them. Get them from a real run with only the outside world mocked: a real Mastra workflow run with a `MockLanguageModelV3` model, for example, rather than a hand-written step-result object. A hand-written guess is how a bug passes its own tests.

❌ **BAD** — the spec put a failed step's error inside `output`, which Mastra never does, so routing reported every failed agent as answering `"null"` with every test green:

```typescript
const failed = { type: 'workflow-step-result', payload: { id, status: 'failed', output: { error: 'no' } } };
```

✅ **GOOD** — run the plan on a real Mastra instance whose model throws, and assert on what comes out:

```typescript
const agent = new Agent({ id: 'calendar', name: 'calendar', instructions: '', model: throwingModel });
const events = await eventsOfARealRun(new Mastra({ agents: { calendar: agent } }), plan);
expect(events).toContainEqual(expect.objectContaining({ result: 'failed: model exploded', isError: true }));
```
