---
paths:
  - "mcp/**"
---

# Knowledge

> Part of [Jarvis Mastra AI Agents](mcp.md). Paths in it are relative to `mcp/` unless they say otherwise.

[Mastra Knowledge](https://mastra.ai/docs/knowledge/overview) (alpha, `@mastra/core` 1.82.0) is a shared store of
markdown **pages** and short dated **notes**, grouped into **scopes**, that agents search, read and write with tools,
and that Studio browses on its **Knowledge** page. Memory holds a conversation; Knowledge holds what is true of the
household across every conversation, agent and process. All of it is in `mastra/knowledge/index.ts`.

## One instance, on the shared store

- **`getJarvisKnowledge()`** is the instance, one per process, registered on Mastra as `jarvis`
  (`JARVIS_KNOWLEDGE_KEY`). Mastra refuses two Knowledge instances on one storage backend
  (`MASTRA_ADD_KNOWLEDGE_SHARED_STORAGE`), and every table here lives in `mastra.sql.db`, so a vertical gets a scope or
  pages in this instance, never an instance of its own.
- **It is given the Mastra store** (`getMastraStorageProvider()`) rather than left to take it from Mastra on
  registration, so code that writes to it never depends on whether `getMastra()` has run. LibSQL 1.29.0 implements
  the domain; its tables are `mastra_knowledge_*`, created on first use.
- **Keyword search only.** No vector store or embedder: semantic search would embed every page and note with the
  hosted embedder Memory uses, on a database that has filled the Pi's disk with embeddings once already.
- **No retention.** Knowledge keeps every page version's activity row forever, so nothing written often belongs in it:
  a state change, a device's state, a cache. See [What stays out](#what-stays-out).
- Both processes (`mastra dev` and `mcp-server`) open the same instance on the same file. A write in one is seen by the
  other on its next read; Studio's live stream only carries writes made in its own process, and polls for the rest.

## Scopes

| Pattern | Who holds it | Role | What is in it |
| --- | --- | --- | --- |
| `household:$householdId` (`household:home`) | every agent given `householdKnowledgeOptions` | editor | the household's shared facts |
| `resource:$resourceId`, `thread:$threadId` | a run with Memory, by its resource and thread | owner | Memory's own scopes, placed under the household |
| `synapse:$householdId` (`synapse:home`) | nobody; household holders read it | viewer | the State Change Reactor's subscriptions, written only by code |

Every scope a run holds must match a declaration, or every Knowledge tool call fails, which is why Memory's
`resource:`/`thread:` declarations are there even though nothing is written to them on purpose.

**An agent is given Knowledge with `householdKnowledgeOptions(knowledge)`**, spread into `createAgent`: the instance,
which brings `knowledge_list`, `knowledge_search`, `knowledge_read`, `knowledge_page` and `knowledge_note` and their
usage instructions, and `scopes: ['household:home']`. The scope is the agent's own `scopes` option because that is the
only place a run's scopes are taken from once a server is registered: Mastra refuses scopes passed on a call or in the
request context, so a request body can never claim one. Every tool and its instruction block cost tokens on each call
of that agent, so an agent gets them only for a reason of its own.

**A scope written by code** is declared with the household as `viewer` and no `self` rule, as `synapse:` is. Agents
can then find and read its pages, and `knowledge_page` refuses to change them ("Editing a page needs editor …"), so a
page always holds what the code wrote. The code writes with the host methods (`upsertPage`, `addNote`, `removePage`),
which check no access, and reads through `knowledge.getStorage()` (`getScopesByAddress`, `getPageByPath`,
`listChildPages`). A structured record on a page is kept as a fenced JSON block, never read out of its prose.

## Studio

`server.apiRoutes: [...KNOWLEDGE_ROUTES]` in `mastra/index.ts` serves Studio's Knowledge page from
`/api/knowledge/…` on 4111, through `mastra dev` and the direct Hono server alike. The routes are spread as they are:
the adapters prefix a route with `/api` only while it is the very object in Mastra's opt-in list, so a copy would be
served at `/knowledge`, where Studio never looks. They read every page with no access check — the same trust Studio's
own `/api/memory` routes already have — and 4111 is reachable only through the tunnel behind Cloudflare Access. The
page is read-only: Studio browses Knowledge, and only agents and code change it.

## Testing

`createJarvisKnowledge(new InMemoryStore())` is the instance on a store of its own; register it on a `Mastra` with
the same store, as production does. `knowledge/index.spec.ts` serves the routes through a real `MastraServer` and
has an agent on a scripted model write a page and a note through its own tools; a Knowledge tool call that is refused
comes back to the model as an `error-text` tool result, not as a thrown error, so assert on the tool results.

## What moved into Knowledge

- **Synapse subscriptions** — one page each under `synapse:home#subscriptions`, every firing a dated note. See
  [Synapse Subscriptions](mcp-synapse-subscriptions-points-of-interest.md).

## What stays out

Each of these was weighed and left where it is; the reason is what to check before moving one later.

| What | Why it stays |
| --- | --- |
| IoT device states (`iot_device_states`), noise baselines | written on every flushed batch of Home Assistant changes or every three hours, read only by code on the flush path; Home Assistant is the source of truth, and Knowledge has no retention |
| State changes, the reactor's notification inbox | thousands a day, and the inbox is Mastra's own work queue with delivery and dedupe |
| Important changes (news for the next request) | a claim-once queue that lives a day; Knowledge has no TTL or hard delete |
| Synapse rules (`synapse/rules/*.md`) | they are rules because they are committed and reviewed; a runtime-editable copy would undo that |
| Photos | text only, and a photo is deliberately never written to disk (see [Vision Vertical](mcp-vision-vertical.md)) |
| The baby's food advice and birth date | reviewed data pinned by `baby-food.spec.ts`, and a CPR prefix kept in 1Password |
| Credentials, paired devices, token usage | secrets and accounting; the Knowledge routes read every page unchecked |
