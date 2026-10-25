---
paths:
  - "mcp/**"
---

<a id="affected-entities"></a>
# What a request touches (affected entities)

> Part of [Routing](mcp-routing.md). Paths in it are relative to `mcp/` unless they say otherwise.

On sir's headset he places things from his home in the room — a light, his inbox, the family
calendar — and the next time Jarvis works on one of them, it glows. For that the headset has to be
told, while the request is still running, what it is touching, and the only place that knows is the
tool an agent calls. So a tool that touches something is marked with `markAsAffectingEntities`
(`mastra/utils/affected-entities.ts`) and a reader that picks the things out of its arguments and
result, parsed with zod. A shortcut onto a marked tool inherits its reader, and a workflow an agent
calls as a tool is looked up through its `workflow-` prefix, exactly as for slow tasks.

An entity is `{ id, name? }`. The `id` is opaque to everything downstream, and is whatever the owning
tools take as that thing's id, so an agent later handed one acts on it without a lookup. An alias a
tool accepts (`primary`, `@default`) is reported by the real id it stands for, or the headset would
record one thing twice and never light the copy he placed. `name` is only for display. Ids longer
than 200 characters are dropped and names are cut at 120.

Some tools have to ask for the real id or the name of what they touched — the lights an area's
service call reached, a calendar's name, a task list's title. They ask alongside their own call,
through `lookUpWithinTimeLimit`, which gives up after `AFFECTED_ENTITY_LOOKUP_TIMEOUT_MS` (1.5 s)
and falls back to the id as asked: the call is what sir is waiting for, and the answer only lights
something up. The task-list lookup is also asked once, with no retries and a timeout, since nothing
but the glow waits on it. The calendar list keeps Google's retries, because it is
`getAllCalendars`' answer too, but has a timeout of its own so a hanging load cannot hold the cache.

1. Routing reads every `tool-result` chunk the way it reads slow tool calls: forwarded by the agent
   step as `workflow-step-output`, or, for an answer carried back to a question, off the resumed
   agent's own stream. Whatever the readers name becomes a `delegation_affected_entities` event.
   A call that never ran touched nothing, whatever its reader would say: Mastra streams input that
   failed validation (`{ error: true, … }`) and a failed workflow tool (`{ error, runId }`) as
   ordinary results, and `readAffectedEntities` skips both before a reader sees them. A request
   answered without its agent (see **Direct answers** below) streams no tool result at all, so
   `answerDirectly` hands back what it touched beside its facts (`DirectAnswerOutcome`), and
   `runDirectOrPlan` reports that as the same event, just before the result. One that declines or
   fails reports nothing of what it tried: the agent it falls back to reports what it touches itself.
2. Each thing is pushed once per request — again only when a later tool names one that was pushed
   without a name — and at most `MOST_AFFECTED_ENTITIES_PER_REQUEST` (20) of them
   (`handleDelegationAffectedEntities` in `routing/controller.ts`).
3. It is published on `utils/live-events.ts` as `{ type: "affectedEntities", entities }` the moment
   it is read, and the WebSocket API (`verticals/api/live-socket.ts`) sends that to every device
   holding a socket open — see [The WebSocket API](mcp-mcp-server-access.md#the-websocket-api). Nothing about it reaches the
   voice agent: no poll response carries it, and no poll is woken or held for it.

A device subscribes by holding a socket, and acts on the events it cares about: the headset records
what it is sent and lights the ones he has placed, and the phone and the watch ignore it. The sockets
know nothing of conversations, so every socket is sent every event; for one household that is what
is wanted. `affected-entities-interview.spec.ts` pins the join against a real
plan run: what the lookup read is pushed while the service call is still held, before any answer.

What is marked, and what is deliberately not:

| Vertical | Reports | Left unmarked, and why |
| --- | --- | --- |
| Internet of things | `callIoTService`: the entities it reached — the ids named, and the service domain's entities in the areas and devices named (every domain for `homeassistant`), resolved alongside the call, given up on after 1.5 s and never failing it. `findEntities`: what it found, when that is at most `MOST_ENTITIES_A_LOOKUP_AFFECTS` (10). `getEntityLogbook`: the entity. A home command carried out without the agent (`home-commands.ts`): the entities Jev chose and the service was called on. A question about the house answered without the agent: the entities it was about, under the same limit as `findEntities` (`entitiesALookupAffects`), so "what lights are on in the kitchen" lights them and "are any lights on" lights nothing | `getAllDevices`, `getChangedDevicesSince` and `inferUserLocation` are surveys; `getAllServices` names no entity; `setUserPhoneAlarm` has only a notify service, not an entity id; `entity_id: "all"` is every light in the house |
| Calendar | the calendar an event was created, changed or deleted in; the calendar a lookup read, or with `allCalendars` only those its events came from | `getAllCalendars` is a survey |
| Email | the folder `findEmails` read, `inbox` by default; Drafts for a draft or a reply; Sent Items for a sent message | `deleteEmail`: its folder is not known without a lookup |
| To-do list | the task list a task was read, added, changed or deleted in | `getAllTaskLists` is a survey |
| Shopping | the Bilka basket (`bilka-basket`, given an id because there is only one) when it is read, emptied or changed | `findProductInCatalog`: nothing in the catalogue is his yet |
| Coding | the repository, as its lower-cased `owner/repo`, of `listRepositoryIssues`, `analyzeCodebase`, `startCodingSession`, the issue tools and `implementFeatureWorkflow` | listing or searching every repository; a session's status and messages are about the session |
| Cooking, commute, weather, web research, visualize, reflection | nothing | recipes, places, forecasts and search results are looked up from the outside world, pages expire after a day, and Jarvis's own internals are not a thing in sir's home to place |

Events, messages and tasks are not reported themselves, only what holds them: the headset places
lasting things, and an event placed in the room would never glow again.

A lookup answered without its agent (`utils/direct-lookup-factory.ts`) reports exactly what the agent's
call of the same tool would have, because it makes that call: its `answer` is handed a `callTool`,
and `answerLookup` (`utils/direct-lookup-factory.ts`) reads every call made through it with the tool's
own reader. So the rules stay on the tools, and no lookup has a list of its own: the calendar lookups
report the calendars their events came from, unread email the inbox, the to-do list the default list
by its real id, the shopping list the basket, open issues Jarvis's repository, and the weather nothing.
A lookup that calls a tool with `executeTool` instead lights nothing up, so every call goes through
`callTool`. `verticals/direct-answers.spec.ts` lists what each lookup reports, and fails for one that is not
listed.

`affected-entities-interview.spec.ts` runs a light switch through both MCP tools on a real plan run,
because a mismatch in the chunk shape would be silent: the request would answer, and nothing would
ever glow. It also answers a question, to pin the resumed-agent path.
