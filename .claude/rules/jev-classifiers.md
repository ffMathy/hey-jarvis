---
paths:
  - "mcp/mastra/**/*.ts"
---

# Prefer Jev Classifiers

**ALWAYS prefer a Jev classifier over a language model** when a decision can be asked as a question with its answers known in advance. Jev is TypeSafe AI's evaluation model, run through Mastra's `Classifier`. One short call returns a probability per answer and writes no text, so it is faster, cheaper and more predictable than a generation or an agent's tool loop.

## When to use one

A decision is a classifier question when it is one of:

- **choice**: pick one from a list (which agent, which service, which question this answers)
- **score**: place it on an ordered scale (ignore / fyi / soon / now)
- **boolean**: yes or no (is this urgent, does this subscription fire, did they approve)

Keep a language model for anything that has to **write** something: a message, a prompt, a summary, or a value pulled out of free text.

## How

- Build it with `createClassifier(id)` from `mcp/mastra/utils/classifier-factory.ts`. It returns `undefined` when `HEY_JARVIS_TYPESAFE_AI_API_KEY` is not set.
- Pass the questions per call when the options depend on current data (agents, Home Assistant services, open questions, subscriptions).
- Act on an answer only above a confidence bar (see `FAST_PATH_CONFIDENCE` in `routing/classifier.ts`). A missing probability distribution counts as unsure.
- **ALWAYS keep the fallback.** No key, a thrown error, or an unsure answer takes the path that existed before the classifier. A classifier must be able to make things faster or quieter, never make them wrong.
- Keep the policy (reading answers into a decision) in a pure function, so it can be tested without a model.
- Register the classifier on the Mastra instance in `mcp/mastra/index.ts`, so Studio traces its calls.

❌ **BAD:** a language-model step to decide a yes/no

```typescript
const { object } = await agent.generate(prompt, { structuredOutput: { schema: z.object({ urgent: z.boolean() }) } });
```

✅ **GOOD:** a classifier question, with the model as the fallback

```typescript
const classifier = createClassifier('urgency');
const urgent = classifier
  ? await isUrgentByClassifier(classifier, message).catch(() => undefined)
  : undefined;
return urgent ?? (await isUrgentByModel(message));
```
