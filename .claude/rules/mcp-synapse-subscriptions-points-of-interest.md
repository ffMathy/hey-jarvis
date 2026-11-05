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
1. The WHEN and GIVEN components are vectorised with **Model2Vec** (`minishlab/potion-base-8M`, via `@yarflam/potion-base-8m`), each also in the third person when it was phrased in the first (`paraphrase.ts`). Model2Vec is a static embedding table, so embedding is a vocabulary lookup and mean-pool — no API call, no network, no GPU. See `mastra/utils/static-embedder.ts`. The embeddings are derived from the text when matching needs them (`embedSubscriptions` in `synapse/subscription-matcher.ts`), not stored: each phrasing's embedding is kept in memory for as long as a subscription uses it, because matching runs on every state change (about 16 ms per 120 phrasings on a laptop, several times that on the Pi).
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

**Where they are kept:** in Jarvis's Knowledge (see [Knowledge](mcp-knowledge.md)), one page per subscription under
`synapse:home#subscriptions/<id>`, written and read by `synapse/subscription-store.ts`. A page shows its rule in words —
**When** …, **Given** …, **Then** … — and ends on the stored record as a fenced JSON block, which is the only part the
store reads back. Every firing is a dated note on the page ("Fired, for the second time, and is now spent."), so
Studio's Knowledge page shows what Jarvis watches for and when each rule last went off.

- **Only the subscription tools change them.** Agents holding the household get the `synapse:` scope as viewers: they can
  find and read a subscription with their Knowledge tools, and `knowledge_page` refuses to edit one. So a page always
  holds the record the tools wrote, and nothing skips `registerSubscription`'s rule that every subscription has an end.
- **A page that holds no subscription is logged and skipped**, so one bad page cannot stop every match — the same trade
  the [rules](mcp-synapse-rules-standing-instructions-in-code.md) make for a rule that does not parse.
- **The SQLite table they used to live in** (`synapse_subscriptions`) is moved across the first time each process asks
  for the store (`migrateLegacySubscriptions`), keeping every id, firing count and setting, and then dropped. Both
  processes may do it at once: the table is read in one transaction, a subscription already across is left as it is,
  and the table is dropped only once every row is across. `storage/legacy-subscriptions.ts` and the migration go once
  every deployment has started on a version with them.

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
