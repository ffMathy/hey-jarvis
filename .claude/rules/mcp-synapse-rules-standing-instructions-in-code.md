---
paths:
  - "mcp/**"
---

# Synapse Rules (Standing Instructions in Code)

> Part of [Jarvis Mastra AI Agents → Available Workflows](mcp-available-workflows.md). Paths in it are relative to `mcp/` unless they say otherwise.

Rules are the State Change Reactor's equivalent of Claude Code rules. Each rule is a Markdown file in
`mastra/verticals/synapse/rules/`. Its frontmatter says which state changes it applies to, and its body
is instructions the reactor is given whenever one of them arrives. Subscriptions and working-memory
preferences are created at runtime and can lapse or be forgotten. A rule is committed to the
repository, so it is reviewed and versioned, and it applies until it is deleted.

```markdown
---
description: Messages from family
patterns:
  - event: phone/notification_posted
    data:
      app: com.whatsapp
      title: "{mom,dad}*"
  - internet-of-things/home_assistant_event
---
Always tell me about these straight away, even at night.
```

**Patterns:**
- A pattern is either a glob matched against the change's `<source>/<stateType>`, or an object with
  that glob as `event` plus `data`. The `data` entries are globs that fields of the state data must
  also match, all of them. Nested fields are addressed by dotted path (`data.command`).
- A rule applies when **any** of its patterns matches.
- Globs are matched with picomatch in bash mode, case-insensitively:
  - `*` matches anything, slashes included, because the values are free text and ids rather than
    paths;
  - `?` and braces (`{a,b}`) work as usual;
  - an array field (e.g. `observedStates`) matches when any element does;
  - numbers and booleans are compared as text.
- Useful `<source>/<stateType>` values:
  - `phone/notification_posted`
  - `internet-of-things/device_state_change` (`entityId`, `deviceName`, `newState`, …)
  - `internet-of-things/home_assistant_event` (`eventType`, `data.*`)
  - `weather/weather_update`
  - `email/*`
  - `coding/*`

**How it reaches the reactor:**
1. `registerStateChangeNotification` matches the rules against every state change. The rules are read
   once per process, so a rule change takes effect on the next deploy or restart.
2. The matched rules go into the change's notification payload as `rules`, next to
   `matchedSubscriptions`. Each has a `name`, an optional `description` and its `instructions`.
3. The reactor's instructions treat them as deliberate: a rule is not a vector-similarity guess, so it
   applies. It wins over working memory where the two disagree, and it never needs
   `markSubscriptionTriggered`.

**Invalid rules:** a rule that doesn't parse is logged and skipped at runtime, so a mistake can't break
state-change handling. `rules.spec.ts` parses every committed rule, which keeps a broken one out of CI.

**Limitation:** a rule changes what the reactor *does* with a change, not *when* it sees it. Every
change is filed at low priority and rolled up on the dispatcher's roughly one-minute cadence, whatever
rule applies to it.
