---
paths:
  - "mcp/**"
---

# Synapse Subscriptions (Points of Interest)

> Part of [Jarvis Mastra AI Agents → Available Workflows](mcp-available-workflows.md). Paths in it are relative to `mcp/` unless they say otherwise.

Subscriptions capture things the user cares about, as a **Given/When/Then** rule:

| Component | Field | Required | Example |
| --------- | ----- | -------- | ------- |
| WHEN | `whenEvent` | yes | "the sun goes down" |
| GIVEN | `givenCondition` | no | "the lights are on" |
| THEN | `thenAction` | yes | "close the blinds" |

> The fields are named `whenEvent`/`givenCondition`/`thenAction` rather than `when`/`given`/`then` because Biome's `noThenProperty` rule forbids a `then` property — an object carrying one looks like a thenable to the runtime.

**How matching works:**
1. All three components are vectorised at registration time with **Model2Vec** (`minishlab/potion-base-8M`, via `@yarflam/potion-base-8m`). Model2Vec is a static embedding table, so embedding is a vocabulary lookup and mean-pool — no API call, no network, no GPU. See `mastra/utils/static-embedder.ts`.
2. Every incoming state change is rendered to a sentence (`describeStateChange`) and embedded the same way.
3. The state change is scored against each subscription's WHEN **and** GIVEN embeddings. The higher of the two is the ranking score, because a state change can just as easily be a precondition ("the lights turned on") as a trigger.
4. Matches above `DEFAULT_MINIMUM_SCORE` (0.3), capped at `DEFAULT_MAXIMUM_MATCHES` (5), are handed to the State Change Reactor **with all three components**.
5. The LLM decides whether a candidate genuinely fires — vector matching is recall only, never a decision — and calls `markSubscriptionTriggered` after acting. One-shot subscriptions ("the *next* time I get home") disable themselves at that point.

Semantic memory recall still uses the hosted Gemini embedder; Model2Vec is used only for this high-frequency matching path.

**Subscription tools:**
- `registerSubscription` — store a new point of interest (`whenEvent`, `givenCondition?`, `thenAction`, `oneShot?`)
- `listSubscriptions` — show what Jarvis is watching for
- `findRelevantSubscriptions` — score a free-text description against all subscriptions
- `markSubscriptionTriggered` — record a firing; retires one-shot subscriptions
- `setSubscriptionEnabled` / `removeSubscription` — pause or delete

Storage lives in `mastra/storage/subscriptions.ts` (table `synapse_subscriptions`); embeddings are stored as BLOBs alongside the text.

**Example:**
```typescript
// "When the sun goes down, if the lights are on, close the blinds."
await registerSubscription.execute({
  whenEvent: 'the sun goes down',
  givenCondition: 'the lights are on',
  thenAction: 'close the blinds',
  source: 'user',
  oneShot: false,
});

// "The next time I get home from work, turn on the lights."
await registerSubscription.execute({
  whenEvent: 'I get home from work',
  thenAction: 'turn on the lights',
  source: 'user',
  oneShot: true,
});
```

**Example Triggers:**
```typescript
// Weather vertical detects significant change
await registerStateChange.execute({
  source: 'weather',
  stateType: 'significant_temperature_change',
  stateData: { previousTemp: 15, currentTemp: 25, change: '+10°C' },
});

// Calendar vertical sees deadline approaching
await registerStateChange.execute({
  source: 'calendar',
  stateType: 'task_deadline_approaching',
  stateData: { task: 'Submit report', deadline: '2025-11-23T09:00:00Z' },
});
```
