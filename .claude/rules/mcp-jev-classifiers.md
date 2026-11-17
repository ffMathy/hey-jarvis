---
paths:
  - "mcp/**"
---

# Jev Classifiers

> Part of [Jarvis Mastra AI Agents](mcp.md). Paths in it are relative to `mcp/` unless they say otherwise.

Decisions that are a choice from a list, a place on a scale, or a yes/no are answered by Jev, TypeSafe
AI's decision model, through Mastra's `Classifier` (`classifier.decide`) instead of a language model (see
`.claude/rules/jev-classifiers.md`). Every classifier is built with `createLazyClassifier` in
`utils/classifier-factory.ts`, registered on the Mastra instance so Studio traces it, and read through
a pure policy function that acts only above a confidence bar (`confidentChoice` / `confidentScoreLevel`
/ `confidentBoolean` in `utils/classifier-answers.ts`). Without `HEY_JARVIS_TYPESAFE_AI_API_KEY`, on a
failed call, or on an unsure answer, each decision is made exactly as it was before there was a classifier.

**A refusal is an unsure answer.** Jev may decline any question (`{ type: 'refusal' }`, no choice, score
or probability). The helpers in `utils/classifier-answers.ts` read one as nothing — `confidentBoolean` as
neither yes nor no — so no call site checks for a refusal itself. The one answer read without a bar,
routing's response style, has no guess to take on a refusal: the classifier then settles nothing about
the request but its relation to a running one (a sure `cancels` still stops it), and the planner decides
the rest.

| Classifier | Where | Decides |
| --- | --- | --- |
| `routingClassifier` | `routing/classifier.ts` | Single-agent fast path, answers to waiting questions, goodbyes, replace/cancel/add, which direct answer (with each source's own questions) |
| `homeCommandClassifier` | `internet-of-things/home-commands.ts`, `internet-of-things/phone-alarm.ts` | Which entities a smart home command acts on, and when a phone alarm rings |
| `changeRelevanceClassifier` | `internet-of-things/change-relevance.ts` | What kind of Home Assistant change a report is |
| `stateChangeClassifier` | `synapse/state-change-classifier.ts` | How much attention a state change needs, and which subscriptions it fires |
| `weatherNotabilityClassifier` | `weather/classifier.ts` | Whether an hourly weather update is worth filing |
| `emailTriageClassifier` | `email/classifier.ts` | Each new email's kind and urgency |
| `orderChangeClassifier` | `shopping/classifier.ts` | Whether a Bilka email reports an order change the subject match missed |
| `productChoiceClassifier` | `shopping/classifier.ts` | Which catalogue product a shopping list item is |
| `emailReplyClassifier` | `human-in-the-loop/classifier.ts` | The yes/no fields of an emailed answer |
| `codingSessionQuestionClassifier` | `coding/classifier.ts` | Whether a Claude session ended on a question in prose |
| `notificationUrgencyClassifier` | `notification/classifier.ts` | Whether a message the agent sends is urgent |

**Direct answers.** When routing's Jev call is sure which agent a request is for, it can often tell what the
request is, too, and then code answers it with no agent at all, handing back plain facts for the voice model
to phrase. Routing knows none of them: every vertical declares its own, and `getDirectAnswerCatalog()` in
`verticals/index.ts` gathers them for routing to offer (the contract is `utils/direct-answer-source.ts`).
Three kinds:

- **Lookups**: fixed, read-only questions a vertical declares in its `lookups.ts` with `createDirectLookup`.
  Weather now and forecast (at the user's location, else Aarhus), calendar today, tomorrow and this week (in
  the household's time zone, `utils/household.ts`), the open to-do list, the shopping basket, unread email,
  and open issues. A lookup is offered only for a request routed to its own agent, phrased as a question
  rather than a command, and with nothing more specific in it than the lookup covers.
- **Commands**: requests that change something, which a vertical declares in its `commands.ts` with
  `createDirectCommand`. Offered by description the same way, only for a request routed to its own agent and
  phrased as a command. Today: the phone alarm (`internet-of-things/phone-alarm.ts`), where a second short
  Jev call picks the hour (of 24) and minute (of 60) before `setPhoneAlarm` is called. A morning-or-evening
  hour ("set an alarm for 7"), a time from now ("in 20 minutes") or a named alarm stays with the agent.
- **Sources** (`createDirectAnswerSource`): a vertical whose options come from live data brings its own
  questions, built per request and asked on routing's call, and reads routing's answers to them itself. The
  only one is `internet-of-things/direct-answers.ts`: smart home commands (the Home Assistant service, then a
  yes/no per entity it can act on, then the service call) and questions about how the house is now (the
  kind of device, then a yes/no per entity of that kind, then their current states). History, locations,
  settings and anything unsure stay with the agent.

Any direct answer that declines or fails runs the same one-agent chain the request would have run anyway.

Every direct answer also says what it read or changed (`DirectAnswerOutcome`, `{ text, entities }`), the same
things the agent's tool calls would have reported, and routing reports them just before the answer (see
[What a request touches](mcp-routing-affected-entities.md#affected-entities)): a command the entities it was carried out on, a question about
the house the entities it was about, and a lookup whatever the tools it called through `callTool` report.

**Synapse state change gate.** The State Change Reactor runs on Gemini Flash-Lite, so every time it
is woken costs money, and it is only woken for a change something can come of
(`triageStateChange` in `synapse/state-change-classifier.ts`):

- one the caller filed `high`, or Jev is sure needs attention `now` (filed high);
- one a rule applies to;
- one a subscription that vector recall shortlisted might fire for — at least 0.15, with an
  unanswered candidate counting as one that might;
- one Jev is sure should reach someone `soon`.

Everything else is saved to memory and held back, and the reason is logged. Before this the reactor
was woken for every change, rolled up about once a minute, which on Flash-Lite was estimated at
$110–$200 a month. The classifier can only add to what is filed or take a candidate subscription off
it, so no key, a failed call or an unsure answer never wakes the reactor for something the policy
alone would not. That matters, because Jev is rarely sure of an attention level: in one day of 3,100
changes, five got one. Each filed change carries every candidate's fire probability under it.
`registerStateChange` takes an optional `priority: 'high'` for callers that already know a change
cannot wait; it is a floor, and such a change is never held back. With Mastra's default delivery
policy, `high` is delivered at once when the reactor is idle, and as a summary followed by the
record when it is busy.

**Weather monitoring.** The hourly update is compared with the last one filed, kept in memory, by a
Jev score: routine / notable_change / warning. Confident routine is not filed, a warning is filed at
high priority, and anything else is filed as before. The first update after a restart is never
dropped. The state data no longer carries a timestamp, so identical updates collapse under the
notifier's dedupe key.

**Home Assistant report relevance.** The event monitor classifies each entity (id, friendly name,
domain, device class) or event type once and keeps the answer for a day: safety_security / presence /
comfort_control / energy_telemetry / diagnostics. Confident diagnostics and energy telemetry are not
reported unless a synapse subscription matches them, and confident safety_security is filed at high
priority. Telemetry was most of what the house reported: a phone's charging wattage, smart plugs'
power and current, the bedroom's air quality and the grid's CO2 intensity.

**Email triage.** Before new emails are filed for the reactor, each is classified in parallel by kind
and urgency from its sender, subject and preview. Confident newsletters and promotions, and emails
that need nobody, are left out and counted in `droppedEmailCount`; emails it is sure of carry a
`kind`; one it is sure needs the user now files the batch at high priority. When nothing is left,
nothing is filed.

**Email trigger fallback filters.** A trigger may have a `fallbackFilter`, asked only when the sender
matches and the subject filter does not; it never overrides or delays a subject match. The Bilka
order-change trigger keeps its exact subject match and falls back to Jev, so a reworded subject still
notifies.

**Shopping list product choice.** For items that are a whole count of something to set ("2 stk
agurk"), the workflow searches the catalogue in code and asks Jev which basket line or result the
item is, or none. Confident items are set without the mutator agent. Removals, weights and volumes,
zero or fractional quantities, unsure items, failed searches, and two items settling on the same
product go to the agent as before, which is skipped when nothing is left for it.

**Email replies.** When every field of an emailed answer is a required boolean, with at most optional
strings beside it, `parseEmailReply` first asks Jev one boolean per field plus whether the reply
decides anything at all, over the person's own words (`human-in-the-loop/reply-text.ts` strips HTML
and quoted history). At least 90% sure either way on everything becomes the answer; sure it decides
nothing refuses the reply like an unreadable one. Anything else, including any answer with a required
string such as meal-plan feedback, is read by the Gemini parsing agent as before.

**Coding session questions.** When a Claude session's turn ends without a fenced `jarvis-question`
block, Jev is asked whether the message ends by asking the user to decide something before the work
can continue. Above 85%, the last paragraph is asked exactly like a fenced question and nothing is
published.

**Notification urgency.** When an agent calls `sendNotification`, Jev checks the agent's `isUrgent`
against the same guidance the agent is given (`notification/classifier.ts`), and overrides it only
when at least 90% sure of the opposite, logging the override. Code callers keep the urgency they
passed.
