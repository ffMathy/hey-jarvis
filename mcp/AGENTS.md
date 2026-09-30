# Jarvis Mastra AI Agents

> **Note:** See the root [AGENTS.md](../AGENTS.md) for shared conventions (Turborepo commands, commit standards, 1Password, etc.)

## Overview
Mastra-powered AI agent framework for intelligent home automation, voice interactions, and Model Context Protocol (MCP) integrations.

## About Mastra
[Mastra](https://mastra.ai) is a TypeScript agent framework for production-ready AI applications with unified LLM interfaces, persistent memory, tool calling, and graph-based workflows.

**This project uses Mastra V1 beta** (v1.0.0-beta.2).

### Key API Changes from V0
- `streamVNext()` → `stream()` - Standard streaming API
- `generateVNext()` → `generate()` - Standard generation API
- Full AI SDK v5 compatibility

## Project Structure
The project follows a vertical-based organization structure for better cohesion:

```
mcp/
├── mastra/
│   ├── verticals/       # Organized by business verticals
│   │   ├── weather/     # Weather vertical
│   │   │   ├── agent.ts
│   │   │   ├── tools.ts
│   │   │   ├── workflows.ts
│   │   │   └── index.ts
│   │   ├── shopping/    # Shopping vertical
│   │   │   ├── agents.ts
│   │   │   ├── tools.ts
│   │   │   ├── workflows.ts
│   │   │   └── index.ts
│   │   ├── cooking/     # Cooking vertical
│   │   │   ├── agent.ts        # General recipe search agent
│   │   │   ├── tools.ts
│   │   │   ├── meal-planning/  # Sub-vertical for meal planning
│   │   │   │   ├── agents.ts   # 3 specialized meal planning agents
│   │   │   │   ├── workflows.ts
│   │   │   │   └── index.ts
│   │   │   └── index.ts
│   │   ├── coding/      # GitHub repository management
│   │   │   ├── agent.ts          # Coding agent
│   │   │   ├── tools.ts
│   │   │   ├── workflows.ts
│   │   │   └── index.ts
│   │   ├── notification/    # Proactive notifications
│   │   │   ├── agent.ts
│   │   │   ├── tools.ts
│   │   │   ├── workflows.ts
│   │   │   └── index.ts
│   │   ├── phone/           # Phone calls, texts and contacts (tools only)
│   │   │   ├── contacts.ts
│   │   │   ├── tools.ts
│   │   │   └── index.ts
│   │   ├── visualize/   # Pages built on request by a Claude session (mostly shortcuts)
│   │   │   ├── agent.ts
│   │   │   ├── shortcuts.ts
│   │   │   ├── tools.ts
│   │   │   └── index.ts
│   │   ├── presence/        # Where the user is (shortcuts only)
│   │   │   ├── shortcuts.ts
│   │   │   └── index.ts
│   │   ├── vision/          # Photos sent from the phone's camera button, and the agents that read them
│   │   │   ├── agents.ts
│   │   │   ├── live-conversation.ts # Asks ElevenLabs whether the phone's conversation is live, before a slot opens
│   │   │   ├── photos.ts    # The in-memory store, its upload slots, and which photos are waiting
│   │   │   ├── tools.ts
│   │   │   └── index.ts
│   │   └── reflection/      # The assistant's own errors and failed runs
│   │       ├── agent.ts
│   │       ├── reports.ts   # Pure readers over Mastra's stored records
│   │       ├── tools.ts
│   │       └── index.ts
│   ├── processors/      # Output processors for post-processing
│   │   ├── error-reporting.ts
│   │   └── index.ts
│   ├── memory/          # Shared memory management
│   ├── storage/         # Shared storage configuration
│   └── index.ts         # Main Mastra configuration
├── project.json         # TURBO project configuration
└── AGENTS.md           # This documentation
```

## Key Features

### 🤖 Intelligent Agents
- **TypeScript-based agents** with persistent memory and tool calling
- **Multi-provider LLM support** via Vercel AI SDK (OpenAI, Anthropic, Google Gemini, Ollama)
- **Structured output** generation with Zod validation
- **Real-time streaming** responses with step-by-step visibility
- **A twenty-step tool loop**, set by `createAgent` — see below

#### The step budget

A step is one turn of the tool loop, and Mastra's default is five. Running out is not an
error: the run ends on a tool-calls step and the agent's answer is an empty string, which
routing reports as "finished without answering". That is what the calendar did to every
request asking for a week at a time — five steps was enough to list the calendars and read
them, and left none to answer with.

So `createAgent` sets `maxSteps` to twenty, which is Mastra's own ceiling for its durable and
network agents: enough for an agent to walk a household's worth of calendars, emails or
devices and still speak, while remaining a bound on a model that has started looping.
`mastra/utils/agent-factory.spec.ts` pins it with a model that insists on six tool calls.

An agent that needs more than twenty needs fewer round trips, not a bigger number — a tool
that answers in one call rather than one per item.

#### The shared guidelines

`createAgent` follows every agent's own instructions with the same short section: never ask
questions, make a best-guess assumption instead, and the current time. The instructions are
resolved on every request, not at construction — agents are built once at boot and the server
stays up for days, so a time taken then would be days stale.

An agent's answer usually ends the exchange, so a question in it has nowhere to go. Questions
that do reach the user come from a tool that suspends, or from a Claude Code session that stops
to ask (see **Questions a coding session asks** under the coding vertical), never from an agent's
own text.
`mastra/utils/agent-factory.spec.ts` pins the exact text.

### 🔧 Tool Ecosystem
- **Model Context Protocol (MCP)** server integrations
- **Home automation tools** for smart device control
- **Voice processing** capabilities for speech-to-text and text-to-speech
- **External API integrations** for weather, calendar, and more

### 🌊 Workflow Engine
- **Graph-based workflows** with deterministic execution
- **Branching and conditional logic** with `.then()`, `.branch()`, `.parallel()`
- **Suspend/resume functionality** for human-in-the-loop interactions
- **Real-time tracing** and observability

### 🧠 Memory & Context
- **Persistent agent memory** with semantic recall
- **Thread-based conversations** with context preservation
- **Vector database integration** for knowledge retrieval
- **Working memory** for short-term context management
- **Automatic backup in Home Assistant**: When running as addon, all data stored in `/data` directory (included in HA backups)

### 📊 Token Usage Tracking & Quota Management
- **Automatic token tracking**: Captures token usage from all LLM interactions via AI tracing
- **Per-model statistics**: Track prompt tokens, completion tokens, and total usage by model and provider
- **Quota management**: Set token limits per model with daily, monthly, or yearly reset periods
- **Usage monitoring**: Query current usage, remaining quota, and percentage used
- **Database persistence**: Token usage stored in SQLite for historical tracking and reporting
- **AI Trace integration**: Seamlessly integrates with Mastra's observability pipeline
- **Startup summary**: Cumulative token usage displayed in console on system startup

## Current Agents

### Weather Agent
Provides intelligent weather information and forecasting capabilities:
- **4 OpenWeatherMap tools**: Current weather and 5-day forecasts by city name or GPS coordinates
- **Google Gemini model**: Uses `gemini-2.0-flash-exp` for natural language processing
- **Smart defaults**: Automatically assumes Aarhus, Denmark when no location is specified
- **Never asks questions**: Makes best-guess assumptions for seamless interaction
- **Persistent memory**: Maintains conversation context with LibSQLStore
- **Scheduled monitoring**: Hourly weather checks with automatic memory updates

**Converted from n8n**: This agent replicates the exact functionality of the original n8n Weather Agent workflow, including the same system message, tools, and behavior patterns.

### Shopping List Agent
Provides intelligent shopping list management for Bilka online store with Danish language support:
- **4 Bilka integration tools**: Product search via Algolia, cart quantity management, cart retrieval, and cart clearing
- **Whole lists in one call**: `findProductInCatalog` takes `search_queries` and `setProductBasketQuantity` takes `items`, so a shopping list is one tool call each rather than one model round trip per product. Each search sends all six preference filters in a single Algolia request, and callers arriving together share one Bilka sign-in
- **Google Gemini model**: Uses `gemini-flash-latest` for natural language processing in Danish
- **Priority-based selection**: Organic certification, Danish origin, healthier options, and price optimization
- **Smart quantity handling**: Balances food waste reduction with requested quantities (20% tolerance)
- **Special product logic**: Separate handling for herbs (fresh vs dried), garlic units, and bundled vegetables
- **Danish product aliases**: Supports synonyms like "Soja → Sojasauce", "Rødkål → Rød spidskål"
- **Automatic authentication**: JWT token management with renewal for Bilka APIs
- **Error recovery**: Retry logic with simplified search terms and graceful failure handling

**Converted from n8n**: This agent maintains all the complex logic from the original n8n Shopping List Agent workflow, including the comprehensive priority hierarchy, special rules for herbs and quantities, and Danish product handling.

### Recipe Search Agent
Provides general cooking and recipe search capabilities:
- **4 Valdemarsro tools**: Recipe search, get by ID, get all recipes, and search filters
- **Google Gemini model**: Uses `gemini-flash-latest` for natural language processing
- **Danish recipe focus**: Specialized for Danish cuisine from Valdemarsro website
- **General purpose**: Handles recipe search, information retrieval, and general cooking questions
- **Clear boundaries**: Does NOT handle meal planning, scheduling, or email formatting

**Part of cooking vertical**: This agent handles general recipe-related queries, while specialized meal planning agents handle the complex multi-step planning workflows.

### Notification Agent
Delivers a message to a person over whichever channel actually reaches them, based on where they are:
- **5 notification tools**: `sendNotification`, `notifyDevice`, `sendPushNotification`, `setPhoneAlarm`, `getPrimaryUserPresence`
- **Local Qwen3 model** via Ollama, with a fallback provider — the agent only classifies target and urgency, so a small model is enough
- **Deterministic routing**: the channel is decided in code (`routing.ts`), not by the model
- **Presence-aware**: reads the car, the house and the phone's ringer out of Home Assistant before deciding
- **Contact resolution**: also carries `lookupContact`, so a `contact` target named without a number can be resolved to the E.164 number the call and SMS channels require, instead of being reported unreachable
- **Error reporting**: configured with the error reporting processor (see Processors section)

**Who is being notified (`target`):**
The target is an object, and there are exactly two shapes:
- `{ "type": "user" }` — the primary user of the house (Mathias). Carries no contact details: Jarvis works out how to reach him from where he is.
- `{ "type": "contact", "name": ..., "phoneNumber": ..., "email": ... }` — anybody else. Needs a phone number, an email address, or both; a contact with neither is refused.

**How the channel is chosen:**

```
target is the user?
├─ in the car?          → phone call from Jarvis (ElevenLabs), urgent or not
├─ at home?
│   ├─ urgent + phone audible   → Home Assistant Voice announcement
│   ├─ urgent + phone silenced  → push notification (time-sensitive)
│   └─ not urgent              → push notification
└─ out?
    ├─ urgent      → phone call from Jarvis
    └─ not urgent  → push notification

target is a contact?
├─ has a phone number + urgent      → phone call from Jarvis
├─ has a phone number, not urgent   → SMS via Twilio
└─ email only                       → email
```

A driver cannot read a push notification, so being in the car wins over everything else. A phone on
silent or in do-not-disturb is the user asking the house to stay quiet, so an urgent message that
would have been announced falls back to a push notification instead of being dropped.

**How presence is worked out:**
- **In the car** and **at home** are answered by the [Presence Vertical](#presence-vertical-shortcuts-only).
- **Phone silenced** is answered by this vertical's own shortcut (`notification/shortcuts.ts`),
  since whether to speak out loud is a notification question: `_ringer_mode` on silent/vibrate, any
  `_do_not_disturb` sensor that is not off, an active iOS `_focus`, or an Android
  `_interruption_filter` that is not `all`. A phone that reports nothing counts as audible, so a
  missing sensor never suppresses an urgent announcement, and another person's silent phone never
  silences the user's.
- `notification/presence.ts` composes the three into the single reading the router takes. All three
  read the same devices, so they are fetched once and handed to each.

**Asking a question (`askQuestion`):**
A notification needs no reply; a question does, so it keeps to the channels that can hear one:

```
in the car?            → phone call from Jarvis
phone silenced?        → push notification saying he can answer the next time he talks to Jarvis
at home?               → Home Assistant Voice announcement, which listens after it speaks
out?                   → phone call from Jarvis
```

Urgency does not come into it: a question holds up the work that asked it. `decideQuestionChannel`
in `routing.ts` is the tree. `askQuestion` only asks; the answer comes back as whatever the user
says next to Jarvis, and finds its way back only if the question is open. So work that asks calls
`askUserQuestion`, which opens the question with a `deliverAnswer` function (see **Questions for
the user** under [Routing](#routing)) and then asks it. It is left out of `notificationTools`, so
the notification agent cannot ask a question nobody is waiting on.

**Available Tools:**
- **`sendNotification`**: the one to use. Takes `target`, `message`, `isUrgent` and an optional
  `title`, picks the channel from the tree above, delivers it, and reports which channel it used
  and why.
- **`notifyDevice`**: announces a message on the Home Assistant Voice Preview Edition speakers via
  the firmware's ESPHome `announce` service, on every matching speaker at once. The service is
  discovered rather than configured, because the device is flashed with `name_add_mac_suffix: true`
  and is therefore called `esphome.hass_elevenlabs_<mac>_announce`.
- **`sendPushNotification`**: pushes through the Home Assistant companion app
  (`notify.mobile_app_*`). Urgent pushes ask for a time-sensitive interruption so they surface
  through a focus mode. An optional `url` makes tapping the notification open it in the phone's
  browser; it is sent as both `clickAction` (Android) and `url` (iOS), since each app ignores the
  other's key.
- **`setPhoneAlarm`**: sets an alarm on the phone through the same `notify.mobile_app_*` service,
  sending the companion app's `command_activity` with Android's `SET_ALARM` intent (hour and
  minute as `:int` extras, `SKIP_UI`, and a URL-encoded label). Fire-and-forget: Home Assistant is
  not told whether the clock app took it. The first such command makes the companion app ask for
  the "Display over other apps" permission instead of acting — a one-time step on the phone. The
  routed Internet of Things agent reaches it through its `setUserPhoneAlarm` shortcut
  (`internet-of-things/shortcuts.ts`), since the notification agent is not one the router picks.
- **`getPrimaryUserPresence`**: reports in-car / home / phone-silenced and the reason for each.
  `sendNotification` does this for itself; the tool exists for answering "where is he?" and for
  tracing a surprising route.

**Required Environment Variables:**
- `HEY_JARVIS_PRIMARY_USER_PHONE_NUMBER`: the primary user's own number in E.164 format. Needed
  before Jarvis can call him — a `user` target carries no number of its own. Resolved from
  `op://Jarvis/Primary user/Phone number` through `mcp/op.optional.env`, so a missing item only
  disables calling him rather than stopping the server.
- `HEY_JARVIS_PRIMARY_USER_NAME` (optional): the primary user's name. Defaults to `Mathias`, and is
  what person and phone entities are matched against.
- `HEY_JARVIS_PRIMARY_USER_PHONE_DEVICE` (optional): device slug of his phone, e.g. `mathias_iphone`.
  Set this when the phone is not named after its owner — companion-app entities are named after the
  device, so without it a two-phone household cannot be told apart.
- `HEY_JARVIS_PRIMARY_USER_NOTIFY_SERVICE` (optional): pins the companion-app notify service, e.g.
  `notify.mobile_app_mathias_iphone`, which is then called without fetching the service list at
  all. Otherwise it is discovered: the user's own `notify.<name>_phone` (e.g. `notify.mathias_phone`,
  the notify group his automations already target) wins when it exists, then the `mobile_app_*`
  phone matching his name or device slug, then the only phone. Watches (`mobile_app_*watch*`) are
  never picked, because the Wear OS companion app ignores `command_activity` and would drop an
  alarm without a word. Discovery refuses to guess between several phones. The
  service list discovery reads is kept between calls and refreshed in the background after ten
  minutes, and looked up afresh when the kept list picks nothing or a service it picked has gone.
- `HEY_JARVIS_CAR_NAME` (optional): the car's name, when it is not a Tesla behind Tessie.

**Example Usage:**
```typescript
// Let the routing decide
await executeTool(sendNotification, {
  target: { type: 'user' },
  message: 'There is water on the utility room floor.',
  isUrgent: true,
});

// Somebody else entirely
await executeTool(sendNotification, {
  target: { type: 'contact', name: 'Julie', phoneNumber: '+4512345678' },
  message: 'The Bilka order arrives between 17 and 18.',
});
```


### Presence Vertical (Shortcuts Only)
Answers where the primary user is. No agents, no workflows and no tools of its own — everything it
knows comes from the Internet of Things vertical, and what lives here is the *reading* of it.

**Available Shortcuts** (`presence/shortcuts.ts`):
- **`getUserLocation`**: the primary user's own location, a shortcut onto the IoT vertical's
  `inferUserLocation` narrowed to the one person this vertical is about.
- **`getPresenceDevices`**: the car and the user's phone, a shortcut onto `getAllDevices` filtered
  to the two devices any presence question turns on.

**Available Functions:**
- **`isUserHome()`**: Home Assistant already answers this — a person entity's state is the zone they
  are in, and `home` is the zone the house is in. The zone list is checked too, so a person standing
  in a named sub-zone of the property still counts as home.
- **`isUserInCar()`**: two independent signals, either of which is enough. The *phone* says so —
  companion-app activity recognition reporting `automotive`/`in_vehicle`, or a live Android Auto or
  car Bluetooth connection, which works in any car including one the house cannot see. Or the *car*
  says so — Tessie reporting somebody on board, a non-parked shift state or a non-zero speed — *and*
  the user's GPS is within 150m of it. The occupancy half is what makes the second signal usable: a
  car parked in the driveway sits within GPS range of somebody standing in the kitchen, so proximity
  alone would put the user in the car every time he is home.
- **`fetchPresenceSources()`**: both questions read the same two sources, so a caller asking more
  than one fetches once and passes the result to each. The whole house is searched only to *find*
  the car and the phone; their device ids are then remembered per user, and later calls render just
  those two (`renderDevicesById` in the IoT vertical), with states always fresh. After ten minutes
  the ids are still used and the house is searched again behind the request; a device that has
  gone, or a render that fails, falls back to the full search. `getPresenceDevices` still renders
  the whole house.

Each answer comes back as `{ answer, reason }` — the reason is carried through to the notification
routing, so a surprising route can be traced back to the sensor that caused it.

**Required Environment Variables:**
- `HEY_JARVIS_PRIMARY_USER_NAME` (optional): the primary user's name, defaulting to `Mathias`. It is
  what person entities and companion-app devices are matched against.
- `HEY_JARVIS_PRIMARY_USER_PHONE_DEVICE` (optional): the device name of his phone, e.g.
  `Mathias' iPhone`. Set this when the phone is not named after its owner — companion-app devices
  are named after the phone, so without it a two-phone household cannot be told apart.
- `HEY_JARVIS_CAR_NAME` (optional): the car's name, when it is not a Tesla behind Tessie.

### Visualize Vertical (Shortcuts)
Answers "visualize…" and "generate a UI for…" with an interactive web page (an artifact), and pushes
its link to the user's phone so a tap opens it in the phone's browser. It builds nothing itself: the
page is written by a Claude Code session, which is the coding vertical's to start, and the push is
the notification vertical's to send. What lives here is the asking — the brief a session builds from —
the reading of the page it hands back, and hosting that page for a day.

**Available Shortcuts** (`visualize/shortcuts.ts`):
- **`createArtifact`**: a shortcut onto the coding vertical's `runCodingTask`. Wraps the request in a
  brief (`buildArtifactTask`) that asks for one self-contained, phone-first HTML page, handed back
  in a fenced ```` ```html ```` block at the end of the session's final message — and tells the
  session not to ask questions, touch a repository, or try to publish the page itself.
- **`openArtifactOnPhone`**: a shortcut onto the notification vertical's `sendPushNotification`,
  refusing to send without a `url`. Also how the agent sends an earlier page again.

**Available Tools** (`visualize/tools.ts`):
- **`generateUserInterface`**: the two shortcuts in order. Builds the page, reads it out of the
  session's last message (`findArtifactHtml`, which takes the *last* fenced block, and refuses a
  document that never reaches `</html>`), hosts it, and pushes the link to the phone unless
  `sendToPhone` is `false`. Returns `artifactUrl`, `expiresAt` and `sentToPhone`. A push that fails
  is reported next to the link rather than thrown, since the page exists either way.

**Hosting** (`visualize/artifact-hosting.ts`): a session run over SSH has nowhere to publish to —
asked to, it invented links like `https://artifacts.local/news-summary` — and free file hosts serve
`.html` as plain text. So the MCP server hosts the pages itself, at
`GET /artifacts/<uuid>` under `HEY_JARVIS_PUBLIC_URL`, the production MCP server's own tunnel
hostname. Not `HEY_JARVIS_CLOUDFLARED_TUNNEL_URL`: that is the ElevenLabs tests' local-testing
tunnel, only up during a test run, and links on it answer Cloudflare error 1033. Each page is a file in `$HEY_JARVIS_STORAGE_PATH/artifacts/`, so Studio's process can
store a page the MCP server serves and a restart keeps the links working. A page lives for 24 hours
(`ARTIFACT_LIFETIME_MILLISECONDS`): after that it answers 404, and expired files are deleted each
time a new page is stored. The random UUID is the only thing keeping a page private, so it is served
with `no-store`, `no-referrer` and `noindex`. If a Cloudflare Access application covers the tunnel
hostname, give `/artifacts/*` a *Bypass* policy, or the phone gets Access's login page instead.

**Agent:** `visualize` is routable, so the planner sends it visualization requests. The builder
cannot reach Jarvis's own data, so a page about the calendar, the house or the shopping list needs
that agent to fetch it first and the planner to pass it along — the agent's description says so.

**Also reached from web research:** `visualizeResearch` (`web-research/shortcuts.ts`) is a shortcut
onto `generateUserInterface`, so "look into X and show me a chart" is one delegation to `webResearch`
— it researches, then hands its findings to the builder itself, rather than the planner chaining a
second agent that would only get the research as text. It is slow like the tool it wraps. It sits
beside Gemini's built-in search, a mix only Gemini 3 accepts in one request, so the research agent
must stay on a Gemini 3 model.

The shortcut is for research *on the web*. A request about Jarvis himself — ideas for his code, why
he failed — is not research the web can do, however it is phrased, and web research's description
says so and names the coding and reflection agents instead. Those are chained by the planner rather
than reached through more shortcuts on web research: a shortcut belongs to the agent that already
holds the context, and here web research holds none of it.

**Requirements:** the Claude Code sandbox under [Coding Agent](#coding-agent);
`HEY_JARVIS_PUBLIC_URL` (in `op.optional.env`, the `Public URL` field of the `Jarvis` item), the
production MCP server's public address; plus the
companion-app notify service the [Notification Agent](#notification-agent) uses for the push.

**Example Use Cases:**
- "Visualize the electricity prices for the rest of the day"
- "Generate a UI for tracking my running times"
- "Send that chart to my phone again"

### Vision Vertical
Lets sir send Jarvis a photo with the camera button on his phone — a receipt, a label, a letter, a
screen — and ask about it, whether he says what he wants before he sends it or not at all. The camera
and the shot are the phone's (see "Showing him something" in `mobile/AGENTS.md`); what lives here is
the check that lets a phone send one, where the photo is kept, and how an agent gets to see it.

**How a photo arrives:**
1. Sir taps the camera button, which the phone offers only once he has entered this server's
   address under **Jarvis server** in its settings. In that same tap, while the conversation is
   certainly live, the phone `POST`s `{ "conversationId": "conv_…" }` — the id of the ElevenLabs
   conversation it is in — to **`/api/photos/slots`**.
2. The server asks ElevenLabs whether that conversation is in progress on Jarvis's agent (**the
   live-conversation check**, below). Only then does it open a *slot* for one photo and answer `201`
   with `{ uploadToken, uploadPath: "/api/photos/<token>", expiresAt }`: the token is 128 random bits,
   good for five minutes and for one photo.
3. The phone `PUT`s the JPEG to `uploadPath`, appended to the address in its own settings — it never
   sends to a URL from anywhere else — with no key and no credentials. The first body sent to a slot
   is the photo; it answers `201` with `{ photoId }`.
4. The phone tells the voice agent, as a message from sir that takes a turn: `I've sent you a photo
   (photo photo3).` The agent routes it through `routePromptWorkflow` with `(photo photo3)` in it,
   and the planner hands it to the vision agent. Both orders work:
   - **Told first, then sent** — "I'll send you a receipt, what's the total?" — the agent routes
     nothing until the photo arrives, then routes the question with the id in it: ordinary work on
     the photo.
   - **Sent first**, with nothing said — the agent routes `He sent a photo without saying what he
     wants: look at it and say what it shows (photo photo3)`. The planner plans one vision task that
     says what the photo shows and what in it could be acted on, and names the photo in
     `photosToAskAbout`; the closing report then has Jarvis say what it shows, ask what sir would like
     done with it, and wait for the answer (see **Questions for the user** under [Routing](#routing)).

**A photo nobody has looked at is not lost with the conversation.** The conversation that sent a
photo looks at it straight away, but that conversation can end before the phone gets to tell it —
the phone's message goes into that conversation or nowhere — and the look can fail. Until
`lookAtPhoto` has a reading for it (`markPhotoLookedAt`), or sir says he wants nothing done with it
(`dismissPhoto`), a photo is *waiting* (`photosWaiting` in `vision/photos.ts`), and routing picks it
up from there (`routing/waiting-photos.ts` — routing depends on vision, never the other way):
- **The planner is shown every waiting photo**, after the request, by id and age (`- photo3, sent 4
  minutes ago`), the one just sent included. A request that says what to do with one is planned as
  work on it: the vision agent reading `(photo photo3)`, and anything acting on what it shows chained
  after it. "The photo" means the one listed, or the one sent last. A photo is never an `answers`
  entry, since nothing is suspended on it; his reply is a request of its own.
- **"Nothing, never mind" dismisses it.** That reply is not work, and with nowhere to put it the
  planner used to return an empty plan, which was reported to sir as a request no agent could
  handle. The plan's `dismissedPhotoIds` (required, empty-when-absent, like `answers`) takes it
  instead: the controller dismisses those photos, and a plan that does nothing else finishes as done
  rather than failing. A dismissed photo is still kept, so a question he thinks better of finds it;
  it is only no longer waiting.
- **A later request's closing report brings it up**, in `questionsForUser` with the photo id as its
  id: `Sir sent you a photo 4 minutes ago (photo3) that nobody has looked at yet: ask him what he
  would like done with it.` Only once it has waited a minute unlooked-at (`PHOTO_WAITING_GRACE_MS`),
  because the conversation that sent it routes a look at it within seconds, and then left alone for
  `QUESTION_REMINDER_INTERVAL_MS` like a question. A photo is kept for just as long, so in practice
  it is brought up once. The grace is not tied to a conversation, which nothing here knows: a photo
  whose first look failed can be brought up again in the conversation that sent it, as any question
  he moved on from would be. See **Questions for the user** under [Routing](#routing).
- **Only a reading counts.** A reader that failed has told sir nothing about his photo, so it stays
  waiting — and a photo sent with nothing said whose look failed is not asked about as one Jarvis
  has described; a question about a photo that is not kept marks nothing.

**The live-conversation check** (`vision/live-conversation.ts`) is what stands in front of a slot.
Both photo routes have to bypass Cloudflare Access, since the phone holds no Access service token,
so anyone can ask for a slot; the phone proves it is in a conversation with Jarvis instead of
holding a secret. The check:
- **Refuses a malformed id before asking anything**: only `^conv_[A-Za-z0-9]{8,64}$` goes upstream.
- **Asks ElevenLabs with a raw `fetch`**, not the SDK, which parses the whole transcript strictly and
  has thrown on shapes it did not expect (elevenlabs-js issue #268): `GET
  /v1/convai/conversations/{id}` with `HEY_JARVIS_ELEVENLABS_API_KEY` in `xi-api-key`, five seconds
  at most, and a Zod schema of only `agent_id` and `status`. Live means `agent_id` is
  `HEY_JARVIS_ELEVENLABS_AGENT_ID` or `HEY_JARVIS_ELEVENLABS_TEST_AGENT_ID` — whichever are set,
  neither preferred, unlike `initiatePhoneCall`, whose precedence would turn away every photo from
  sir's phone on a server with the test agent configured — and `status` is `initiated` or
  `in-progress`.
- **Gives a call that has only just started a second chance.** Nothing documented says how soon one
  can be looked up, so a `404` is asked again 1.5 seconds later, and then each agent's list is
  searched (`?agent_id=…&page_size=100&call_start_after_unix=<now − 960>` with `processing`, `done`
  and `failed` excluded; 960 is `maxDurationSeconds` and a minute).
- **Fails closed.** A refused key (`401`/`403`), a rate limit, an ElevenLabs error, a timeout or a
  body that cannot be read is *unverifiable*, and the slot is refused with `502`. A server without
  the API key or either agent id refuses every slot with `503`, and `mcp-server.ts` logs one warning
  at startup naming the missing variables (`whyPhotoSlotsAreOff`) — never a value.
- **Is bounded**, since every check spends Jarvis's ElevenLabs quota: a conversation found live is
  taken as live for a minute without asking again, and at most 30 checks a minute go upstream from
  the whole process (beyond that, `429`). The body holds the whole transcript, emails and calendar
  entries included, so it is never logged: at most the status and a refusal's `detail.code`, and
  never the conversation id.

**Its limits are deliberate.** It proves only that whoever asks knows the id of a conversation live
on Jarvis's agent. A conversation id is not a secret — it is in ElevenLabs' history, and the SDK
sends it unauthenticated to upload a file or leave feedback — a call that has just ended can read as
live for a moment, and a live verdict is trusted for a minute. So the upload's protection is the
slot's token, and that is enough on its own: 128 random bits, single-use, good for five minutes,
claimed before a byte of the photo is read, and handed straight from this server to the phone. It
used to travel through ElevenLabs, in the result of an MCP tool the voice agent called, and a
separate upload key typed into the phone was needed because of it; now nothing but this server and
the phone ever sees it, and there is no key.

**Available Tools** (`vision/tools.ts`):
- **`lookAtPhoto`**: fetches the photo by id and shows it, beside the question, to the photo reader.
  The only way any agent here sees a photo, since a routed agent is handed text and nothing else.
  Its answer is the reading quoted as the photo's content, with the photo's age:
  `Photo photo1, taken just now, shows: «…»`. Once the reader has answered, the photo is no longer
  waiting.

**Agents** (`vision/agents.ts`):
- **`vision`** is public, so the planner routes to it. It finds the id and the question in its
  prompt and calls `lookAtPhoto` once, at low thinking. A chain works like any other: "add what is
  on this receipt to the shopping list" is this agent, then the shopping list agent. Asked only what
  a photo shows — one sent with nothing said — it says what it shows *and what in it could be acted
  on*: items and prices, an amount due, a date, a name or number worth keeping, which is what Jarvis
  needs to ask a useful question and to answer the ones sir asks back.
- **`photoReader`** is not public and has no memory — a photo is never written into a thread. It
  treats text in a photo as something to report, never as instructions, because whoever made the
  thing photographed wrote it.

**The photo store** (`vision/photos.ts`) is **in memory, in the MCP server's process, and nowhere
else**: `/data` goes into every Home Assistant backup, and a photo of a letter does not belong there.
Everything is bounded for the Pi — at most 20 open slots and 5 photos of at most 3 MB, oldest let go
first, a photo kept for 30 minutes. An id is matched however a model wrote it ("Photo 3" is
`photo3`), and a question that names no photo means the latest only if it is under three minutes
old. Studio's process (`mastra dev`, 4111) has a store of its own that nothing fills, so photos can
only be asked about through the MCP server.

**The photo routes** (`api/routes.ts`) are reachable by anyone — the phone holds no Cloudflare Access
service token — and both answer in the routes' JSON envelope (`success`, `message`, `data`):
- **`POST /api/photos/slots`** (`PHOTO_SLOTS_ROUTE`) reads its own body, JSON of at most a kilobyte
  (`readSlotRequest`), and answers `201` with the slot; `400` for a body without a well-formed
  conversation id — one that is not JSON, or over a kilobyte, included — `403` for a conversation not
  live on Jarvis's agent, `429` once the minute's checks are spent, `502` when ElevenLabs could not
  confirm it, and `503` when this server cannot check at all. `registerApiRoutes(router, { isLiveJarvisConversation })` takes a stand-in for the check, which
  is how `routes.spec.ts` covers each answer without ElevenLabs.
- **`PUT /api/photos/:uploadToken`** (`PHOTO_UPLOAD_ROUTE`) asks for no key, and **reads nothing until
  the request has earned it**, in this order:
  1. `claimSlotBeforeReading`: a wrong content type is a `415`, and an unknown or used token a `404`
     — the slot is claimed before anything else happens, so it is read from once.
  2. Only then does `express.raw` read at most 3 MB.

The JSON parser in `mcp-server.ts` skips everything under `/api/photos/` for the same reason, and the
request log writes an upload's path without its token (`withoutUploadToken`, which leaves
`/api/photos/slots` readable) and never with its headers or body. CORS allows any origin, `PUT`,
`POST` and `OPTIONS`, and the `Content-Type` header: what lets a request through is written into it
by the phone — the conversation id, the token — rather than anything a browser attaches by itself,
and the browser build is served from GitHub Pages. Both paths answer an `OPTIONS` preflight.

**Required Environment Variables:** none of its own. The check uses `HEY_JARVIS_ELEVENLABS_API_KEY`,
which needs read access to the agents' conversation history, and at least one of
`HEY_JARVIS_ELEVENLABS_AGENT_ID` and `HEY_JARVIS_ELEVENLABS_TEST_AGENT_ID` — the same variables the
phone vertical uses. Without them the server starts as usual and photo uploads are off.

**Requirements:** a Cloudflare Access bypass for `/api/photos/*`, and this server's address in the
phone's settings under **Jarvis server** — see [MCP Server Access](#mcp-server-access).

**Example Use Cases:**
- "I'll send you a receipt — what's the total?", then the photo
- "What does this letter say I have to do?"
- "Add everything on this receipt to the shopping list"
- A photo with nothing said: "That's a Netto receipt for 36.95 kroner, sir, for milk and rye bread.
  What would you like done with it?"

### Phone Vertical
Provides outbound calling, texting and contact lookup, and feeds the phone's notifications to Synapse:
- **4 phone tools**: Place calls, send texts, and read the user's Google address book
- **No agents**: The tools are for use by other agents
- **Notifications**: Maps the Android notifications the Home Assistant event monitor sees into Synapse state changes (see [Phone Notifications Into Synapse](#phone-notifications-into-synapse))
- **Twilio integration**: Uses ElevenLabs Conversational AI platform with Twilio for phone calls
- **Custom first message**: Each call can specify a custom greeting message for the recipient
- **Conversation support**: After the initial message, the agent can engage in conversation with the recipient
- **Contact resolution**: Turns a spoken name ("mom", "Sarah") into the E.164 number the calling and texting tools require

**Available Tools:**
- **`initiatePhoneCall`**: Initiates an outbound phone call to a specified phone number
  - Requires phone number in E.164 format (e.g., "+1234567890")
  - Accepts a custom first message for the agent to speak
  - Returns conversation ID and call SID on success
  - Uses ElevenLabs conversational agent for the phone interaction
- **`sendTextMessage`**: Sends an SMS via Twilio to a phone number in E.164 format
- **`lookupContact`**: Resolves a name or nickname to matching contacts and their phone numbers
  - Matching ignores case, accents and punctuation, so voice transcripts match stored spellings
  - Returns several matches with `isAmbiguous` set, rather than guessing between two people of the same name
  - Filters to contacts that have a phone number by default (`requirePhoneNumber`)
- **`getContacts`**: Lists the whole address book, with `maxResults` and `forceRefresh`
  - Reads Google Contacts, which is what syncs to the user's phone — nothing runs on the phone itself
  - Numbers are normalized to E.164 via `libphonenumber-js`; one that cannot be placed is returned as stored with `isE164: false`
  - Results are cached for 5 minutes, since a lookup ranks the entire address book locally

**Required Environment Variables:**
- `HEY_JARVIS_ELEVENLABS_API_KEY`: ElevenLabs API key for authentication
- `HEY_JARVIS_ELEVENLABS_TEST_AGENT_ID` or `HEY_JARVIS_ELEVENLABS_AGENT_ID`: ID of the ElevenLabs conversational agent to use (test agent ID takes precedence if set)
- `HEY_JARVIS_TWILIO_ACCOUNT_SID`, `HEY_JARVIS_TWILIO_AUTH_TOKEN`, `HEY_JARVIS_TWILIO_PHONE_NUMBER`: Twilio credentials for `sendTextMessage`
- `HEY_JARVIS_GOOGLE_CLIENT_ID`, `HEY_JARVIS_GOOGLE_CLIENT_SECRET`, `HEY_JARVIS_GOOGLE_REFRESH_TOKEN`: Google OAuth2 credentials for the contact tools

**Example Usage:**
```typescript
// Initiate a phone call with custom greeting
await phoneTools.initiatePhoneCall.execute({
  phoneNumber: '+1234567890',
  firstMessage: 'Hello, this is Jarvis calling to remind you about your upcoming appointment.',
});

// Resolve a spoken name, then text whoever it turned out to be
const { matches } = await executeTool(lookupContact, { name: 'mom' });
const [contact] = matches;
const number = contact?.phoneNumbers.find((phoneNumber) => phoneNumber.isE164);

if (number) {
  await executeTool(sendTextMessage, { phoneNumber: number.value, message: 'Running 10 minutes late' });
}
```

**Setup Requirements:**
1. Create an ElevenLabs account and obtain an API key
2. Create a conversational agent in ElevenLabs
3. Configure a Twilio phone number in ElevenLabs for outbound calls
4. Store the credentials in 1Password:
   - `op://Jarvis/ElevenLabs/API key`
   - `op://Jarvis/ElevenLabs/Jarvis agent ID`
   - `op://Jarvis/Twilio/Account SID`, `op://Jarvis/Twilio/Auth token`, `op://Jarvis/Twilio/Phone number` for `sendTextMessage`
5. The contact tools reuse the **existing** Google OAuth credentials — no new 1Password item or field:
   - `op://Jarvis/Google/Hey Jarvis client ID` → `HEY_JARVIS_GOOGLE_CLIENT_ID` (unchanged)
   - `op://Jarvis/Google/Hey Jarvis client secret` → `HEY_JARVIS_GOOGLE_CLIENT_SECRET` (unchanged)
   - `op://Jarvis/Google/Hey Jarvis refresh token` → `HEY_JARVIS_GOOGLE_REFRESH_TOKEN` (**value must be replaced**)
6. Enable the **Google People API** in the Google Cloud project, then mint a refresh token carrying the contacts scope:
   ```bash
   # generate-tokens skips a provider that already has a stored token, so clear it first
   sqlite3 mcp/mastra.sql.db "DELETE FROM oauth_credentials WHERE provider='google';"

   # --reveal-token prints the full value so it can be pasted into 1Password;
   # without it only a fingerprint is shown, and revealing is refused on CI
   bun run --cwd mcp generate-tokens --reveal-token
   ```
   - Paste the new value into the `refresh token` field of the **Google OAuth** item in the **Personal** vault
   - Updating 1Password is what matters for deployment and for the integration tests: both resolve `mcp/op.env` from the vault, so a stale vault copy leaves them on a token without the contacts scope
   - Client ID and secret are always read from environment variables; only the refresh token can also live in Mastra storage
   - See [Google OAuth2 Setup](#google-oauth2-setup) for the full flow

### Coding Agent
Reads, analyses and changes code — Jarvis's own above all — and manages GitHub repositories:
- **6 agent tools** (`codingTools`): list repositories (`listUserRepositories`), list issues (`listRepositoryIssues`), search repositories (`searchRepositories`), answer questions about the code (`analyzeCodebase`), and follow and steer Claude Code sessions (`getCodingSessionStatus`, `sendCodingSessionMessage`). `tools.ts` also defines `startCodingSession` and `runCodingTask`, which `implementFeatureWorkflow` and other verticals' shortcuts run rather than the agent, and `createGitHubIssue` and `updateGitHubIssue`, which nothing registers today
- **Google Gemini model**: Uses `gemini-flash-latest` for natural language processing
- **Repository management**: Browse and search repositories for any GitHub user
- **Issue tracking**: View open, closed, or all issues for repositories
- **Codebase questions**: `analyzeCodebase` has a Claude Code session read the code and answer — how something works, a review, ideas for improvement, technical debt — without changing anything. It is `runCodingTask` with a read-only brief (`buildCodebaseQuestionTask`), and it is slow like the tool it wraps. A `context` input carries what the code cannot show, most often the reflection agent's failures, which live in Mastra's storage where a session cannot reach. Before it existed, a question about Jarvis's own code had no agent to go to, and "gather ideas to improve Jarvis and visualize them" was planned onto web research. The planned shape now is reflection → coding → visualize, one chain, each handed the previous answer
- **Workflow coordination**: Triggers requirements gathering workflow for new feature requests
- **Smart defaults**: a task with no repository named is a task on Jarvis himself, `ffMathy/hey-jarvis` (`coding/repository.ts`). Every tool, `implementFeatureWorkflow` and the agent default to it, and the implementing session is told the repository up front and never asks which one is meant

**Key Capabilities:**
- List all public repositories for a GitHub user
- Search repositories by name, keywords, or topics
- View issues with filtering by state (open/closed/all)
- Follow and steer running Claude Code sessions
- Trigger requirements gathering workflow for new implementations
- Provide GitHub URLs for quick access to repositories and issues

**Architecture Pattern:**
This agent follows the **workflow delegation pattern**. When a user requests a new feature implementation, instead of gathering requirements itself, it delegates to the `implementFeatureWorkflow`, which starts a Claude Code session on the change at once — no issue is filed, and nothing is asked first. The session reads the codebase, decides whatever the code settles, and implements the change; a request the code settles is never held up by a question. The workflow returns as soon as the session has started, so it is not marked slow.

**Questions a coding session asks:**
Only a choice that is the user's to make stops a session, and it can come up at any point — before
the session has changed a line, or halfway through. The session is told how
(`buildSessionQuestionInstructions` in `session-questions.ts`): end the turn on a fenced block tagged
`jarvis-question` holding one short spoken question, and nothing after it. When
`ClaudeSessionWatcher` sees a turn end with `end_turn` on such a block (`readSessionQuestion`), it
publishes nothing for that turn and instead asks through `createSessionQuestionAsker`:

1. `askUserQuestion` opens the question with a `deliverAnswer` function that sends the answer to the
   session (`sendClaudeSessionMessage`), then asks it with `askQuestion` — a call in the car or away,
   the house speakers at home (see the [Notification Agent](#notification-agent)).
2. The watcher reports `coding_session_question_asked` (question, id, channel) or
   `coding_session_question_failed` to Synapse.
3. The user answers on that call, on the speakers, or the next time he talks to Jarvis. His words go
   through `routePromptWorkflow`, the planner matches them to the open question, and the controller
   hands them to `deliverAnswer`, which resumes the session with everything it had done. Jarvis tells
   him the answer was passed on; the session's own reply arrives later as its events always do.

This replaced a separate analysing session and an up-front interview that suspended the workflow
once per question. That always cost minutes before anything was built, and its questions went out
through `sendNotification`, whose channels could not hear an answer.

**Claude Code Sessions:**
Implementation work is delegated to the official [Claude Code CLI](https://code.claude.com/docs/en/headless), signed
in to the user's Claude **subscription** with a token from `claude setup-token` — so it is billed there, not to an API
key. It runs inside a [Docker Sandbox](https://docs.docker.com/ai/sandboxes/) named `jarvis` on the host: a microVM
with its own filesystem, Docker daemon and egress proxy, which is what bounds a session that skips permission prompts.
A sandbox needs KVM and the `sbx` daemon on the host, so the server reaches the host over SSH and runs
`sbx exec -i jarvis …` there (`claude-code-host.ts`). The SSH key gets no shell: its forced command,
`mcp/.scripts/claude-code-ssh-command.sh`, accepts only `start <session id>`, `resume <session id>` or
`export <session id>` and fixes the sandbox, the directory and the `claude` and `git` command lines itself, so a
compromised container can start sessions in the sandbox, fetch their work, and do nothing else on the host.
`claude-code-ssh-command.spec.ts` runs it under `sh` with a fake `sbx` that goes on to run the sandbox's half against
a fake `flock` and `claude` and the real `git`, and most of what it checks is what the script refuses. The fakes
report to a log file, not stdout, because `export`'s stdout must be the bundle alone. It sets `PATH` to
`/usr/bin:/bin`, so it runs on Linux (CI) and not under Windows' own `sh` lookup. The subscription token travels on
the first line of stdin, never on a command line. Each run of a session is one `claude --print` process in
`~/jarvis-sessions/<session id>` inside the sandbox, talking stream-json both ways. The session clones the repository
anonymously over HTTPS, works unattended, commits on a `jarvis/…` branch, and pushes nothing — the server publishes
its work (below).

**The sandbox cannot write to GitHub; the server publishes.** A session started by `startCodingSession` is told
(`buildSessionWorkInstructions` in `publish-session-work.ts`) to commit on a branch named `jarvis/<description>`, not
to push or open a pull request, and to end its final message with a fenced block tagged `jarvis-pull-request`
holding `{"branch", "title", "body"}` as JSON. `readSessionWork` takes the block from the last such opening fence to
the message's last closing fence — so a description with code fences of its own survives — and validates it with
zod; a turn without it (a question, say) publishes nothing. When `ClaudeSessionWatcher` sees such a session go idle
with `end_turn`, it calls `publishSessionWork`, which:

1. refuses a branch outside `jarvis/` before anything else;
2. runs `export <session id>` over the same SSH path (`exportSessionWorkOverSsh`), capped at
   `MAXIMUM_BUNDLE_BYTES` (50 MB), past which the connection is dropped. In the sandbox that takes the session's
   lock (`flock -w 30`, exit **75** if a turn is running), locates the repository at the session's directory
   itself (`--git-dir=.git`, no discovery upwards), and writes
   `git bundle create - --branches ^refs/remotes/origin/<default>` to stdout — every local branch, less what the
   default branch had when the session last fetched. So every prerequisite of the bundle is a commit of the default
   branch, which only moves forward, and the server satisfies them by cloning the default branch before it
   unbundles. Other exits: **66** no repository, **67** nothing committed, **68** no `origin/HEAD`, **70** git
   failed;
3. in a temporary directory, removed afterwards whatever happens, makes a bare, blobless, single-branch clone of the
   default branch from GitHub and fetches the branch out of the bundle with `fetch.fsckObjects`;
4. refuses the default branch itself, a branch with no commits of its own, and a branch whose `CI_PROTECTED_PATHS` —
   `.github/workflows/`, `.github/actions/` and `.github/actions.lock`, one constant — differ at all from the default
   branch's current tip, because the repository's own branches, and pull requests from them, run its workflows with
   its secrets. The tip rather than the merge-base, since a pushed branch runs the workflows of its own head commit,
   and one based on an old commit would bring back that commit's workflows; a branch that is merely behind a change
   to CI is refused until it is rebased;
5. pushes the branch, without force, with `HEY_JARVIS_GITHUB_API_TOKEN`, handed to git as an
   `http.https://github.com/.extraheader` through `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_0`/`GIT_CONFIG_VALUE_0` in an
   environment with nothing of the server's in it — never on a command line;
6. opens the pull request with the vertical's Octokit client (`github-client.ts`), or finds the one already open for
   the branch, which the push has just updated.

The outcome reaches Synapse as `coding_session_pull_request_opened` (with `pullRequestUrl`) or
`coding_session_pull_request_failed` (with `error`, and `refused: true` when the work broke a rule rather than the
publishing failing). `runCodingTask` sessions are never watched, so they never publish. The container's image
carries `git` for this.

**The host decides between starting and resuming.** `start` and `resume` both mean "run this session": inside the
sandbox the forced command passes `--resume` when `~/.claude/projects/*/<session id>.jsonl` exists and is not empty,
and `--session-id` otherwise. The server still sends its guess, since a host on the older forced command goes by it,
but a wrong guess — a first run that died before Claude Code wrote anything, or one that wrote the transcript without
the server seeing a line — can no longer wedge a session into `No conversation found` or `already in use`.

**One process per session.** Before running `claude`, the sandbox takes `flock -w 120` on
`~/jarvis-sessions/<session id>.lock` (beside the session's directory, so the directory stays empty for a clone) and
exits with **75** if another process still holds it after two minutes — as one can when a dropped SSH connection
leaves the previous `claude` finishing its turn. The lock is held by the waiting shell, and `claude` runs with the
descriptor closed, so a background process the session leaves behind cannot hold it. The other exit codes a session
error can carry are **64** (request refused), **65** (no token on stdin) and **255** (SSH itself failed).

`ClaudeCodeSessions` (`claude-sessions.ts`) keeps each session's events in memory, reduced to the four that matter
— `session.status_running`, `agent.message`, `session.status_idle` (with `end_turn` or why else it stopped) and
`session.error`. A message sent while a session works is written to the same process; one sent after it went idle
resumes the session in a new process. Being in memory, sessions do not survive a restart of the server, though their
transcripts stay in the sandbox. Nothing waits on a process without a limit:

- A new process waits 30 seconds for the previous one to exit, then kills it (`ClaudeCodeProcess.kill()`, which ends
  the SSH connection) and launches anyway; the host's lock covers whatever is left in the sandbox.
- A process that goes 60 minutes without closing its turn (`MAXIMUM_TURN_DURATION_MILLISECONDS`, restarted per turn)
  is killed, with a `session.error` and a `timed_out` stop.
- Sending a message to a process that has stopped fails instead of reporting success, and a newly launched process
  that exits within 20 seconds without writing a line (refused, no token, SSH failure) makes `send()` — and so
  `create()` — throw with its exit code and the end of its stderr. The same text reaches the watcher as
  `session.error` for a process that dies later.

The SSH key is written once per server process to a `0600` file in a `0700` directory under the system temp
directory, removed when the server exits; a failed write is retried on the next launch rather than remembered.

Claude Code never runs in the server's own container, which carries the 1Password service account token for the
whole vault.

- **`startCodingSession`**: Creates the session, seeded with the request, how its work gets published and when and
  how it may ask the user something, and starts watching it with `publishTo` set, so the watcher asks its questions
  and opens the pull request once it is done. Used by `implementFeatureWorkflow`.
- **`getCodingSessionStatus`**: Reports a session's status (`running` or `idle`) and the last five messages it has
  produced.
- **`sendCodingSessionMessage`**: Sends a follow-up message to a session, to answer a question or redirect its work.
- **`runCodingTask`**: For work whose result is an answer rather than a pull request. Starts a session on a free-form
  task, waits until its turn ends (`waitForClaudeSessionTurn`, up to 15 minutes) and returns the last message it
  sent. The session is not handed to the watcher, because the caller reports the result itself. Like
  `startCodingSession` it is not one of the coding agent's own tools; the agent's own `analyzeCodebase` wraps it with a read-only brief, and other verticals reach it through shortcuts, such as the
  [Visualize Vertical](#visualize-vertical-shortcuts)'s `createArtifact`. It is marked slow, and a shortcut
  onto it inherits the mark. Every task it starts ends on `FOREGROUND_WORK_NOTE`, which tells the session to work in
  the foreground: its answer is the last message of its turn, and the process is let go the moment that turn ends,
  so a subagent or command left running in the background is stopped unfinished — and a turn that ends on "waiting
  for the background agent" answers nothing.

**Feeding Back Into Synapse:**
`ClaudeSessionWatcher` follows each session's events and republishes them as Synapse state changes with the source
`coding` and a state type derived from the event type (for example `coding_session_agent_message`). The session has
already dropped what is not worth hearing — Claude Code prints every tool call and its result, and each state change
costs tokens once Synapse reasons over the batch. Events are deduplicated by id, and a failed hand-off is logged
without tearing down the watch. A finished turn is published once, when its `session.status_idle` is first seen, and
the watcher waits for it before handling the session's next event, so a session is never published twice at once.

**Environment Requirements:**

| Environment variable | 1Password reference | What it is |
| --- | --- | --- |
| `HEY_JARVIS_GITHUB_API_TOKEN` | already mapped in `mcp/op.env` | GitHub token (`Jarvis → GitHub API key`) with **Contents**, **Pull requests** and **Issues** read and write on every repository Jarvis may code on — the tools read repositories and issues, and the server pushes sessions' branches and opens their pull requests with it |
| `HEY_JARVIS_CLAUDE_CODE_SSH_TARGET` | `op://Jarvis/Claude Code/SSH target` | The host with the `jarvis` sandbox: `user@host`, or `ssh://user@host:port`. With the MCP container on host networking (`--network host`), `jarvis@127.0.0.1` — there `host.docker.internal` is the `docker0` gateway, whose port 22 host firewalls commonly drop |
| `HEY_JARVIS_CLAUDE_CODE_SSH_PRIVATE_KEY` | `op://Jarvis/Claude Code/private key?ssh-format=openssh` | The key the host authorizes for that user |
| `HEY_JARVIS_CLAUDE_CODE_OAUTH_TOKEN` | `op://Jarvis/Claude Code/OAuth token` | The subscription token `claude setup-token` prints |

The host itself — 64-bit Linux with KVM and glibc 2.39 or newer, a user of its own signed in to Docker and pinned to
the forced command, and the `jarvis` sandbox, with no GitHub secret for public repositories and only a read-only
one for private ones — is set up as described in **Letting Jarvis code on your Claude subscription** in
`mcp/README.md`. The forced command has to be reinstalled whenever it changes: a copy from before `export` refuses
every export (exit 64), so no session's work is published, and a copy from before it set
`CLAUDE_CODE_DISABLE_BACKGROUND_TASKS=1` lets a session end its turn to wait for a background agent that is then
stopped with it.

The three `HEY_JARVIS_CLAUDE_CODE_*` references live in `mcp/op.optional.env`, not `mcp/op.env`. `op run` fails
on the first reference it cannot resolve, and when they sat in `mcp/op.env` a missing `Claude Code` item crash-looped
both supervisord programs and took all of Jarvis down. Now `.scripts/run-with-env.sh` hands `op run` only the
optional references that resolve (`.scripts/append-optional-env.sh` tests each with `op read`, printing the
reference, never the value), and they never count as missing when deciding whether to fall back to 1Password. A
missing item disables coding sessions and nothing else.

The vertical imports without any of them — `getClaudeCodeHostConfiguration()` throws only when a session is launched,
so repository and issue browsing works on the GitHub token alone and only the tools that start or follow a session
(`startCodingSession`, `runCodingTask` and the session tools) need the host. At startup `mcp-server.ts` checks
`isClaudeCodeHostConfigured()` and logs one warning naming whichever variables are missing
(`getMissingClaudeCodeHostVariables()`, names only).

To resume a session by hand on the host, run
`sbx exec -it -e CLAUDE_CODE_OAUTH_TOKEN jarvis sh -c 'cd ~/jarvis-sessions/<id> && flock -w 120 ../<id>.lock claude --resume <id>'`
as the `jarvis` user with `CLAUDE_CODE_OAUTH_TOKEN` exported first — without `-e` Claude Code in the sandbox runs
unauthenticated, and the `flock` keeps it from overlapping a process Jarvis starts. On a Pi 5, `sbx diagnose` warning about `mkfs.erofs` and 16 KB blocks means the 16 KB-page kernel;
`mcp/README.md` has the fix.

**Example Use Cases:**
- "What repositories does ffMathy have?"
- "Show me open issues in hey-jarvis"
- "Search for repositories about AI agents"
- "I want to add email notifications" _(triggers `implementFeatureWorkflow`)_

### Commute Agent
Provides intelligent commute planning and navigation assistance using Google Maps:
- **4 Google Maps tools**: Travel time estimation, route-based place search, proximity-based place search, detailed place information
- **Google Gemini model**: Uses `gemini-flash-latest` for natural language processing
- **Traffic-aware routing**: Estimates travel time with real-time traffic data for driving mode
- **Multi-modal support**: Handles driving, walking, bicycling, and transit modes
- **Smart defaults**: Automatically assumes Aarhus, Denmark when no location is specified
- **Never asks questions**: Makes best-guess assumptions for seamless interaction

**Key Capabilities:**
- **Travel Time Estimation** (`getTravelTime` tool):
  - Calculate distance and duration between two locations
  - Optional real-time traffic data for driving routes
  - Support for departure time specification for future travel planning
  - Handles multiple travel modes (driving, walking, bicycling, transit)
  - Returns both normal duration and traffic-adjusted duration
  
- **Route-Based Place Search** (`searchPlacesAlongRoute` tool):
  - Find places along a route between origin and destination
  - Useful for finding EV chargers, gas stations, rest stops, restaurants
  - Searches at multiple points along the route (0%, 25%, 50%, 75%)
  - Returns distance from route in meters for each place
  - Results ordered by distance from route (closest first)
  - Returns name, address, GPS coordinates, ratings, place types, and distance from route
  
- **Proximity-Based Place Search** (`searchPlacesByDistance` tool):
  - Find places near a location, ordered by distance (closest first)
  - Configurable search radius up to 50km
  - Returns distance from center point in meters
  - Perfect for "what's nearby" queries
  
- **Detailed Place Information** (`getPlaceDetails` tool):
  - Get comprehensive information about specific places
  - Includes ratings, reviews (top 5), opening hours, contact information
  - Can search by Google Place ID or by name and location
  - Returns phone numbers, websites, and current open/closed status

**Example Use Cases:**
- "How long will it take to drive from Aarhus to Copenhagen with traffic?"
- "Find EV charging stations along my route to Copenhagen"
- "What restaurants are near me?" (defaults to Aarhus)
- "Show me the opening hours and reviews for [place name]"
- "Find the closest gas stations within 10km"

**Required Environment Variable:**
- `HEY_JARVIS_GOOGLE_MAPS_API_KEY` - Google Maps API key. Distinct from the Gemini key: this one is restricted to the Maps APIs and returns API_KEY_INVALID against Generative Language.

**Setup Instructions:**
Google Maps APIs require an API key rather than OAuth2 credentials. If you already have a Google Cloud project for Calendar/Tasks, you can reuse the same project and the same API key for both Gemini AI and Maps:

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Select your existing project (same one used for Calendar/Tasks OAuth2)
3. Enable the required APIs:
   - Distance Matrix API
   - Directions API
   - Places API (New)
   - Geocoding API
4. Go to **Credentials** → **Create Credentials** → **API Key** (or reuse existing)
5. Store the API key in 1Password: `op://Jarvis/Google/Hey Jarvis API key`
6. Set environment variable: `HEY_JARVIS_GOOGLE_MAPS_API_KEY`

**Note:**
Maps APIs are public services (no user data access) that use API keys for billing and quota management, while Calendar/Tasks APIs access private user data and require OAuth2 authentication. Both can be enabled in the same Google Cloud project.

### Reflection Agent
Answers questions about the assistant itself rather than about the world — what failed, when, in
which agent, and why. It is the only agent whose tools read Mastra's own records, and the only one
that can explain a request the rest of the system got wrong.

It reads three things, because a failure lands in a different place depending on what kind it was:

- **Traces.** Every agent run, tool call and model call is sampled (`SamplingStrategyType.ALWAYS`)
  and kept for 14 days, each span carrying its own error. This is where a request that failed lives.
- **Workflow runs.** Kept for 30 days, each with the snapshot naming the step it stopped at. A
  scheduled email check that has failed hourly since last night is here and in no trace anyone would
  think to look for, because nobody asked for it.
- **The runtime diagnostics ring** (`utils/diagnostics.ts`). Everything Mastra reports about *itself*
  — a scheduler tick that threw, a run retired at boot, an exception an agent handled and tracked —
  goes to a logger and, with no telemetry backend attached, nowhere else. None of it is a run, so
  none of it is in a trace. `createLogger` keeps the last 200 warnings and errors in memory so
  something inside the system can read them back. It empties on restart, and the tool says so in its
  own output rather than letting an empty list read as a clean bill of health.

**Available Tools** (`reflection/tools.ts`):
- **`getSystemHealth`**: how many runs there were in a window, how many failed, and which agents they
  were in. The starting point for any broad question.
- **`listRecentFailures`**: the failures themselves, each with a traceId. Filtered on `hasChildError`
  rather than on the trace's own status — a run fails from the inside, so the tool call that broke
  carries the error while the agent span above it may well have recovered and finished clean.
  Matching on the root's status alone misses exactly the failures worth asking about. Each failure
  carries its `cause` — the innermost failing span — so "why did that fail?" is usually answered
  without a `describeTrace` call.
- **`describeTrace`**: one trace span by span, with the failing spans ordered innermost first. That
  ordering is the answer to "why": the deepest failure is the thing that actually broke, and every
  span above it is a wrapper reporting that something below it did. Inputs and outputs are included
  for the failing spans only, unless `includePayloads` is set: a routed request has dozens of spans,
  and every payload is text the agent has to read before it can answer.
- **`listWorkflowRuns`**: recent runs with their status and, for the failed ones, which step stopped
  them. A `foreach` step reports each failing iteration separately, because "the step failed" and
  "the step failed on two of forty items" are different answers.
- **`listRuntimeErrors`**: the diagnostics ring, filterable by level.

**Nothing here writes.** A vertical that could clear its own error log would be the last thing worth
trusting about an error.

The reporting logic lives in `reflection/reports.ts` as pure functions over storage records, so
which span is named as the cause and what its error reads as are tested without a database, a model
or a running server (`reports.spec.ts`). `errorSummary` joins an error to its `cause` rather than
picking one: a routing delegation arrives wrapped in a `MastraError` whose message names only the
agent — `[Agent:RoutingSupervisor] - Failed agent tool execution for calendar` — with the real
reason kept underneath it, and either half alone has been the one that was not useful.

**Reached by voice through Analysis Mode.** `elevenlabs/src/assets/agent-prompt.md` sends any phrase
beginning with "analysis" into a flat, numbered readout, and a focus that the live conversation
cannot answer — why something failed elsewhere, whether the scheduled checks are running — is routed
here rather than guessed at.

### Routing Planner Agent
Turns a voice request into a **plan** for the specialized agents to run:
- **The thirteen public agents are its catalogue**, baked into its instructions at boot
- **No tools of its own**: it writes a plan, it never runs one and never sees a result
- **No memory**: planning one request has nothing to recall from the last
- **Flash-Lite, not Flash**: every request waits on the planner before any work starts, and
  picking agents from a list is classification rather than reasoning. Flash-Lite also thinks at
  `minimal` by default. If plans get worse, `PLANNER_MODEL` in `routing/planner.ts` is the line to
  revert, and the routing LLM eval is what shows it — run it by hand, since CI never does

The planner writes a flat list of **tasks**. Each names one agent, the prompt it is given, and
in `needs` the id of the one task whose answer it cannot be carried out without. Tasks run at
the same time as each other unless `needs` says otherwise.

What actually runs is **chains**, derived from that list in `task-chains.ts`: the delegations
inside one chain run in order, and every delegation after the first is handed the previous
answer along with its own prompt. So ordering and dependency passing are structural rather than
implied.

**The derivation is the point.** The planner used to emit chains itself, which made sequencing a
structural decision — which bucket does this go in — and that is the decision it got wrong,
silently and in the direction that costs a wrong answer: it would write five tasks as five
chains, and a task whose whole job was to use another's answer ran beside it and invented one.
A live eval caught it filling a to-do reminder with a generic lasagna ingredient list while the
recipe lookup it depended on was still running. Naming the task you are waiting on is a local
judgement about a single prompt, and it is the one a planner can actually make; placing it is
not, so nothing downstream is free to place it wrongly.

A task needed by two others is run once per dependent, because a chain carries only the
previous answer forward. That is the one thing the derivation trades away, and deliberately:
repeating a lookup costs time and quota, while dropping one of the edges costs a wrong answer.
The common shapes — a location before a weather lookup, a recipe before a reminder — are paths
and pay nothing for it.

Routing has been three things. A task DAG with a wave scheduler this vertical owned; then a
supervisor agent delegating inside its own tool-call loop; now a plan. The middle one is why:
its loop was opaque, so a request could not be looked at, and it could not say what was
outstanding because a delegation existed only once it had been called. A plan is a workflow, so
Studio draws it and the run is persisted — and the work is written down before any of it runs.

*Note: Additional agents will be added as the project evolves.*

## Available Workflows

### Routing
The entry point for every voice request. Two MCP tools, deliberately: the voice model gets a
small, fast surface, and everything else happens behind them. A photo sir sends reaches Jarvis the
same way, as a request naming it (see [Vision Vertical](#vision-vertical)); the phone opens its slot
over the REST API, not through the voice model.

**Workflows:**
- **`routePromptWorkflow`**: starts a request and returns at once, with the session to poll
- **`getNextInstructionsWorkflow`**: reports whatever has landed since the last call

**How a request runs:**
1. `routePromptWorkflow` starts the request and returns immediately — it does not wait for the
   planner, let alone for the agents the plan names.
2. The planner writes a plan. Mastra validates and registers it as a **dynamic workflow** built
   for this one request: one workflow per chain, and a root running the chains in parallel.
3. Every delegation in the plan is marked outstanding *before a single step runs*, so the first
   poll already names the whole of the work.
4. `getNextInstructionsWorkflow` reports the delegations that have finished since the last poll,
   folded from the run's own step-result stream. A result is handed over exactly once.
5. When the run ends, the request is done and the closing report recaps everything — including
   anything the run never got to, so a delegation that never answered is reported rather than
   dropped.
6. A delegation that stops to ask the user something is reported in that closing report as a
   question, in `questionsForUser` — see **Questions for the user** below.

**How long the answer is:** the planner labels every request with a `responseStyle`, by where its
value lands (`RESPONSE_STYLES` in `routing/planner.ts`):
- `command` — something changed in the world (lights, alarms, list additions): a few words, with a
  remark only where the result differs from what was asked
- `lookup` — one fact: one sentence, at most one remark
- `briefing` — several facts or a summary: detail, at most one remark
- `conversation` — open-ended: full character

A mixed request takes the style that needs the most words. Every report the loop sends speaks in
that style (`SPEAKING_INSTRUCTIONS` in `routing/workflows.ts`); it used to ask for "a detailed
manner" every time, which is how "turn off the lights" earned a paragraph.

**Ending the call:** every finished request — answered, failed, or handed to a notification — ends
with `FINISHED_REQUEST_INSTRUCTIONS`: say nothing more, and if asked to speak again before sir has
said anything, call `end_call` without a word. The agent's turn timeout is what asks him again.
Nothing still waiting on sir carries it — a question the work stopped on, one from earlier, or what
to do with a photo he sent without saying: those end on `askTheUserInstructions`, which asks last and
waits. See **Hanging up when he goes quiet** in `elevenlabs/AGENTS.md`.

**Questions for the user:**
Some work cannot finish on what the request said. Questions come from two places, and
`verticals/routing/questions.ts` keeps both kinds as an `OpenQuestion` until sir answers:

- **A tool that suspends.** Any routable agent whose tool suspends with a `question`, and resumes
  with a single text field, suspends the agent inside that tool call. Its answer resumes that agent
  (the steps below).
- **Work outside any request.** A Claude Code session implementing a change asks long after the
  request that started it was answered (see **Questions a coding session asks** under the coding
  vertical). Nothing is suspended then, so the question is opened with `openAnsweredByQuestion` and
  a `deliverAnswer` function, asked over a channel his answer can come back on (`askQuestion`), and
  its answer is handed to that function. What the function returns is the delegation's result.

A suspending tool goes like this:

1. The suspension reaches the plan run as a `workflow-step-output` wrapping the agent's
   `tool-call-suspended` chunk, carrying the agent run id, the tool call id, the question and the
   resume schema. That is the only place it shows.
2. **The plan run is then stopped.** Mastra's agent step resolves on the agent's `onFinish`, and a
   suspended agent never finishes, so the step — and the run, and the stream routing reads — would
   wait forever while Jarvis heard "Still processing" on every poll. Once every delegation in the
   plan has answered or asked, `consumeRun` cancels the run. The suspended agent is not part of it:
   it is persisted in storage as an `agentic-loop` run of its own, which is what gets resumed.
3. The closing report carries the question in `questionsForUser`, with instructions to ask it last
   and stop. Questions wait for the closing report because sir's answer arrives as a new request,
   and a new request supersedes the old one — asking early would cancel whatever else was still
   running the moment he replied.
4. His answer comes back through **`routePromptWorkflow`**, like everything else he says. Open
   questions are kept past the request that asked them and shown to the planner alongside every
   request; the planner's `answers` field says which question a request answers, if any. That keeps
   the answer on the existing two tools and keeps Jarvis from having to label a reply as one.
5. The answer resumes the agent with `agent.resumeStream({ [field]: answer }, { runId, toolCallId })`.
   The tool gets the answer, the workflow carries on, and the agent either finishes — its text is
   the delegation's result — or stops on the next question, which is asked in turn.

A question sir ignores stays open: talking about something else plans that as usual, and the
answer is still taken later. It is not forgotten either: the closing report of the next request he
makes carries every question still waiting in `questionsForUser`, and Jarvis answers the request,
then reminds him of the question and asks it last (`takeQuestionsToBringUp` in `questions.ts`).
That is what rescues a question asked on a call he missed or in a push notification. A question
brought up is left alone for 30 minutes (`QUESTION_REMINDER_INTERVAL_MS`), so a conversation hears
it once rather than after every request, and a superseded request or one he is to be notified about
brings nothing up, since nobody hears its report. Open questions live in memory, so a restart forgets them while the
suspended run stays in storage; the request then has to be made again.

**A photo he sent that nobody has looked at yet** is brought up the same way (`takePhotosToBringUp`
in `routing/waiting-photos.ts`, into `waitingPhotos` beside `earlierQuestions`): after the earlier
questions and before the request's own in `questionsForUser`, under the same conditions, and in the
failure path too. The instructions name a photo — "work he started earlier, or a photo he sent" — and
ask for its id in the reply as `(photo photo3)` only when one is waiting, so every other report reads
as it did. The difference is the reply: it is not an answer to hand back but a request, which the
planner, shown every waiting photo, plans as work on that photo — or, for "nothing", as dismissing it
(`dismissedPhotoIds`), which the instructions ask to be routed like any other reply. See **A photo
nobody has looked at is not lost with the conversation** under [Vision Vertical](#vision-vertical).

**A photo he sent with nothing said** is asked about too, as this request's own question rather than
one from earlier. The request is the look — `He sent a photo without saying what he wants: look at it
and say what it shows (photo photo3)` — and the planner names the photo in `photosToAskAbout`
(required, empty-when-absent, and only ever a photo it was shown and did not dismiss). Once the
request's work is done, the controller keeps those whose look actually read them
(`RoutingProgress.photosToAskAbout`), and the closing report adds one question per photo, last in
`questionsForUser`, with the photo id as its id: `Now that you have told him what photo3 shows, ask
him what he would like done with it.` (`askWhatToDoWithPhoto`). It is closed with
`askTheUserInstructions` as a request waiting on him, photo wording included, so Jarvis speaks the
result, asks, and waits — never `end_call`. A photo asked about that way is not also brought up as a
waiting one, and a request that failed asks nothing about its photos: one whose look failed is still
waiting, and is brought up later like any other. `waiting-photos.spec.ts` drives this end to end on
scripted models, from the routed message to the report that asks.

A reply given on a call or on the house speakers only reaches the work if the ElevenLabs agent
routes it, so its prompt (`elevenlabs/src/assets/agent-prompt.md`) says a reply to a question the
call opened with is passed to `routePromptWorkflow` with the question it answers, never merely
acknowledged. Before that rule, an answer given on a call could go no further than the call.

`coding-interview.spec.ts` runs the whole coding path — the two MCP tools, the planner, the coding
agent, the session watcher asking a session's question, and the answer reaching that session — on
scripted models.

<a id="slow-tasks"></a>
**Slow tasks:**
Some work takes minutes: a Claude Code session answering a question about a codebase, or building a page. A tool or
workflow is flagged slow in code with `markAsSlow` (`mastra/utils/slow-tasks.ts`), and a shortcut
onto a slow tool is slow too. The flag belongs to the tool rather than the agent — the coding
agent lists issues in a second and starts an implementation that takes ten minutes.

1. Routing sees the agent call a slow tool the same way it sees a suspension: the step forwards
   the agent's `tool-call` chunk as `workflow-step-output`, and its `toolName` (`workflow-<id>` for
   a workflow) is looked up among the slow ones. That becomes a `delegation_slow` event.
2. The next poll returns at once with the task in `slowTaskIds`, and instructions to tell the user
   it will take a few minutes and offer to notify him when it is done. Each task is offered once.
3. His reply to the offer is **not** routed — a new request supersedes the running one and would
   cancel the work he just agreed to be told about. If he accepts, Jarvis polls with
   `notifyWhenDone: true`, which keeps the two-tool surface.
4. From then on the request outlives the conversation: a newer request does not cancel it, its
   questions stay open, and when it ends `completion-notice.ts` sends him the results through
   `sendNotification` — or, when it is waiting on a question, asks it through `askQuestion`, where
   his answer can come back. He answers it there or the next time he talks to Jarvis, through
   **Questions for the user** as usual.

**Why a workflow per request:**
Which agents a request needs is known only once it arrives, so a request that is a workflow has
to be built per request. What that buys: Studio graphs it, so what a request did — the root, its
chains, every agent step, what each was asked and what it answered — can be looked at rather
than read back from logs; the run is persisted; and the work is written down before it starts,
so `taskIdsInProgress` names what is outstanding instead of inferring it from whatever happened
to start.

`workflow-finish` is deliberately **not** read off the run stream. A chain is a nested workflow
sharing the root's pubsub, so its own finish event reaches the same stream — taking the first
one for the request's would close the request the moment the fastest chain was done. The end of
the request is the end of the stream, which only the root run has.

**Retention:**
A plan is a workflow per request, so the list would grow without limit. The five newest plans
stay visible and runnable; older ones are unregistered and their definitions archived, which
stops them rehydrating at boot without throwing away what they recorded.

**Polling contract:**
A poll blocks up to `POLL_DEADLINE_MS` (10s) waiting for something to report, then says so and
asks to be called again. That deadline has to fit inside ElevenLabs' `cascadeTimeoutSeconds`
(15s, in `elevenlabs/src/assets/agent-config.json`): a poll that times out at the ElevenLabs
boundary is a *lost* answer, not a delayed one. **The two move together.** They were 5s and 8s;
raising the deadline alone would reproduce the measured failures the header comment on
`POLL_DEADLINE_MS` records — every poll returning inside 4.4s succeeded, and the ones blocking
toward a 15s deadline against an 8s boundary came back failed at 9.3s, 10.9s and 13.7s. The
agent half only reaches the live agent once `bunx turbo deploy --filter=elevenlabs` has run, so
until then the deployed agent still enforces whatever it was last given.
The closing report recaps every result, including ones earlier polls already relayed, so a
response dropped on the way cannot lose an answer for good.

**One call per turn, carrying all of it:**
`userQuery` takes everything the user asked for in that turn, and the planner writes a task per
part with the independent ones running side by side. A real conversation had the agent split
"what about my calendar and my email this week?" into two routing calls — calendar planned, run,
polled and reported, and only then the email — so the second answer arrived a whole round of
polling late for no gain. The cause was the agent prompt's "every request gets its own call",
read as being about the things inside one turn rather than about successive turns. The prompt now
separates the two rules, and the `userQuery` description says it as well, since that description
is what the voice model reads when it decides what to put in the field.

**Who says "I'm on it":**
ElevenLabs, not the instructions. `routePromptWorkflow` has pre-tool speech set to **Force** in
its tool settings, so the agent speaks before the call is made — earlier than any instruction in
a response can manage, since a response only exists once the call has returned. `INSTRUCTIONS.poll`
therefore asks for no line at all. It used to, and when the agent prompt asked as well Jarvis
delivered both. That setting is an override held on the tool in the ElevenLabs dashboard rather
than in `agent-config.json` — MCP tools reach the agent through `mcpServerIds` and carry their own
configuration — so it is invisible from this repository and is written down in the code instead.

**Two tools, deliberately:**
The voice model gets `routePromptWorkflow` and `getNextInstructionsWorkflow` and nothing else.
That is a hard constraint, not an accident of the current design: the model on the call is
chosen for speed, and every extra tool is surface it has to reason about on a latency budget
that has no room for it.

It is also why a question's answer comes back through `routePromptWorkflow` rather than a tool
of its own (see **Questions for the user** above): the planner already reads every request, so it
is the one that recognises a reply as an answer. Approval gates are still not on this path: an
approval resumes with `{ approved: boolean }` rather than a sentence, so `readSuspension` refuses
it and the delegation is reported as failed rather than left parked on a question nobody can
answer.

**Authoring rules a generated plan has to respect:**
`createStepFromAgent` fixes every agent step's input to `{ prompt }` and its output to
`{ text }`; a `mapping` entry has to be a top-level workflow entry, so one inside a `parallel`
is rejected — which is why each chain is its own workflow; and `mapConfig` is a JSON *string*,
not an object. `plan.spec.ts` pins all of these against `validateDynamicWorkflow`, the same
check registration runs, so "would this register?" is answerable in milliseconds rather than by
restarting a server.

**Concurrent callers:**
`createSession({ resourceId })` is get-or-create and isolated, and the task records are scoped
by the same `resourceId`. Two callers get two sessions and neither can see the other's
delegations.

**Inspecting a request:**
Traces, in Studio's Observability tab — model calls, each delegation, timings and errors for
one request. Workflows are the only thing Studio draws as a graph, and the graph of this
machinery would be the same picture every time; what varies is which agents were asked and what
they said, which is what a trace shows.

### 📅 Workflow Scheduling

Scheduled workflows run through Mastra's built-in `mastra.schedules`, which persists each
schedule as a storage row rather than holding it in memory.

**Key Features:**
- **Durable**: a schedule survives a restart or redeploy, and can be paused, resumed, retimed or
  fired once through `mastra.schedules` (and over `/api/schedules`) with no deploy
- **Reconciled on boot**: `mastra/schedule-reconciler.ts` is the source of truth; the stored rows
  are brought in line with it every time the server starts
- **Timezone support**: every cadence is stored with `Europe/Copenhagen`
- **Run on startup**: a declaration can also fire once at boot, for workflows that catch up on
  what happened while the process was down
- **Pre-defined patterns**: cadences named in `utils/workflows/cron-patterns.ts`
- **Error handling**: a scheduled run that throws is reported through the instance's
  `scheduler.onError`, which logs it with the schedule id and the error intact. Without that
  handler the rejection is swallowed with nothing to say which schedule it came from.

**How to Schedule a Workflow:**

Add a declaration to `SCHEDULED_WORKFLOWS` in `mcp/mastra/schedule-reconciler.ts`:

```typescript
export const SCHEDULED_WORKFLOWS: ScheduledWorkflowDeclaration[] = [
  {
    workflowId: myWorkflow.id,
    cron: CronPatterns.EVERY_3_HOURS,
  },
  {
    workflowId: myStartupWorkflow.id,
    cron: CronPatterns.EVERY_MINUTE,
    runOnStartup: true,
  },
];
```

The workflow must also be registered in the `workflows` map in `mastra/index.ts` — the boot path
refuses to start otherwise, because a schedule whose target cannot be resolved is deleted by the
scheduler about thirty seconds later, silently.

**Reconciliation rules:**
- Rows are matched to declarations by workflow id
- Removing a declaration deletes its row; a durable row outlives the code that created it
- The sweep only touches rows tagged `managedBy: hey-jarvis-scheduler`, so a schedule created at
  runtime or by another feature survives a deploy
- A runtime pause is not permanent: reconciliation restates `status: active`, because the
  declarations are what say whether a schedule should be running

**Only `mcp-server` fires schedules:**
The container runs `mcp-server` and `mastra dev` side by side (`mcp/supervisord.conf`), both on
the same `mastra.sql.db`. `mastra dev` starts its workers unconditionally, and Mastra starts a
scheduler for any schedule rows it finds — so until this was pinned down, both processes polled
the same rows every ten seconds, raced to claim each fire, and ran the winner's workflow in
whichever process won. Twice the writers on one SQLite write lock is what produced the
`Failed to claim due schedule fire` / `SQLITE_BUSY: database is locked` bursts on the Pi, and the
400 Studio answered a chat with. `ownsSchedules()` in `schedule-reconciler.ts` reads the
`MASTRA_DEV=true` that `mastra dev` sets on the server it spawns, and `mastra/index.ts` passes
`scheduler: { enabled: false }` there. Studio can still list, pause and edit schedules; it just
never fires them.

**Runs left behind by a restart:**
`mastra dev` asks Mastra to restart every active workflow run once its server is up. A scheduled
run is persisted as `running` with `activePaths: []` and keeps that until it ends — the
event-driven engine only records a position on end, failure or suspend — so one interrupted
mid-flight can never be restarted: the engine starts at index `undefined`, runs no step, and
throws `undefined is not an object (evaluating 'lastOutput.result')`. Every crash left more of
them, and every boot logged the error once per orphan. `retireUnrestartableRuns`
(`workflow-run-recovery.ts`) marks them failed with the reason on the run, alongside runs whose
workflow graph has changed. It only retires positionless runs in the process that owns the
schedules, at boot, before its scheduler starts — from `mastra dev` such a run is
indistinguishable from one `mcp-server` is executing right now. That means `mastra dev` can still
log the error for a scheduled run that happens to be in flight when it boots; the restart throws
before running any step, so it changes nothing.

**SQLite connections:**
Every table lives in `mastra.sql.db`, opened by LibSQLStore and by each class in
`mastra/storage/`, in both processes. Open a new connection with `openSqliteClient`
(`storage/sqlite-client.ts`), never a bare `createClient({ url })`: the bare client's busy timeout
is zero, so it fails with `SQLITE_BUSY` the instant anything else is writing.
`SQLITE_BUSY_TIMEOUT_MS` (15 s) is shared with LibSQLStore's `connectionTimeoutMs`. LibSQLStore
also switches the file to WAL, which persists in the file, so readers never wait on a writer. The
wait happens inside the synchronous driver and stalls that process's event loop, so it is a
ceiling for a slow SD card, not something to lean on.

**Available Cron Patterns** (`utils/workflows/cron-patterns.ts`):
- `EVERY_MINUTE`: `* * * * *`
- `EVERY_3_HOURS`: `0 */3 * * *`
- `DAILY_AT_MIDNIGHT`: `0 0 * * *`
- `WEEKLY_SUNDAY_8AM`: `0 8 * * 0`

Mastra validates the expression when the row is created, so a new cadence can be added verbatim
in standard 5-field form; croner nicknames (`@hourly`, `@daily`) work too.

**Currently Scheduled Workflows** (see `mastra/schedule-reconciler.ts`):
1. **Weather Monitoring** - Runs every 3 hours
   - Workflow: `weatherMonitoringWorkflow`
   - Purpose: Updates weather information and notifies other agents of changes

2. **Weekly Meal Planning** - Runs every Sunday at 8:00 AM
   - Workflow: `weeklyMealPlanningWorkflow`
   - Purpose: Generates weekly meal plan with Danish recipes

3. **Email Checking** - Runs every minute + on startup
   - Workflow: `emailCheckingWorkflow`
   - Purpose: Tracks which emails have arrived; does not trigger the state reactor

4. **Form Replies Detection** - Runs every 3 hours + on startup
   - Workflow: `formRepliesDetectionWorkflow`
   - Purpose: Resumes the suspended runs that inbound form replies answer, and registers the
     emails as a state change

5. **IoT Noise Baselines** - Runs every 3 hours + on startup
   - Workflow: `iotNoiseBaselineWorkflow`
   - Purpose: Recalculates how much each entity normally fluctuates, from 15 minutes of history,
     so the Home Assistant event monitor can drop changes that are only noise. The changes
     themselves are not polled: see [Home Assistant Event Monitor](#home-assistant-event-monitor)

6. **Storage Retention** - Runs nightly at midnight
   - Workflow: `storageRetentionWorkflow`
   - Purpose: Trims token usage rows past their retention window

**Monitoring Scheduled Workflows:**

View logs in the terminal when workflows execute:
```
⚙️  Executing scheduled workflow: Hourly Weather Check
   Time: 2024-01-15T10:00:00.000Z
✅ Workflow completed successfully (1234ms)
   Status: success
```

### Voice Announcements
Announcing on the Home Assistant Voice Preview Edition speakers is a tool (`notifyDevice`), not a
workflow — there is nothing to orchestrate, and the routing that decides *whether* to announce lives
in the notification vertical (see [Notification Agent](#notification-agent)).

**Technical Implementation:**
- Uses the ESPHome API service the Hey Jarvis firmware exposes: `esphome.{device_name}_announce`
- Parameters: `message` (string), `silence_seconds` (integer)
- The device is flashed with `name_add_mac_suffix: true`, so the service name carries a MAC suffix
  and is discovered from Home Assistant at call time rather than hardcoded
- The device speaks the message and then stays in a normal conversation until the room has been
  silent for `silence_seconds`, so the user can simply answer back
- An announcement is suppressed by the device itself while its master mute switch is on

**Usage Example:**
```typescript
await executeTool(notifyDevice, {
  message: 'Sir, your meeting starts in 5 minutes',
  deviceName: 'kitchen', // Optional: announces on every voice device when omitted
  silenceSeconds: 3, // Optional: defaults to 3
});
```

**ESPHome Device Configuration:**
The target device must expose this service (it is part of
`home-assistant-voice-firmware/home-assistant-voice.elevenlabs.yaml`):
```yaml
api:
  services:
    - service: announce
      variables:
        message: string
        silence_seconds: int
      then:
        - elevenlabs_stream.start:
            initial_message: !lambda 'return message;'
            timeout: !lambda 'return silence_seconds > 0 ? silence_seconds * 1000 : 3000;'
```


### Phone Notifications Into Synapse

The Home Assistant companion app on Android reports each notification the phone posts through its
`sensor.<phone>_last_notification` sensor: the state is the text, and the attributes carry the app
(`package`), `android.title`, `android.text`, `android.bigText` and `post_time`. The Home Assistant
event monitor (`internet-of-things/event-monitor.ts`) already receives that sensor's `state_changed`
events, and routes them to `phone/notifications.ts` instead of the device reports. Each one is
registered with Synapse as `notification_posted` from the `phone` source, with `app`, `title`,
`text` and `postedAt`. From there it is an ordinary state change: matched against subscriptions, saved
to memory, and rolled up by the delivery policy rather than waking the reactor per notification.

How these differ from the monitor's other entities:

- **Attribute-only updates count.** The monitor otherwise drops them, but two notifications in a row
  with the same text differ only in their attributes.
- **No bulking.** Each notification is its own message; the bulker would keep only the first and
  last of a burst.
- **Never a device state.** Neither this sensor nor `_last_removed_notification` is reported,
  caught up on, or stored as a device state, so the text never lands in `device_state` storage.
- **No catch-up.** The sensor holds only the latest notification, so one posted while the socket
  was down is not reported on reconnect.
- The `sensitive` label excludes the sensor as it does any other entity. A notification with neither
  a title nor text (media players, progress bars) is dropped.

**Setup:** the *Last notification* sensor and its Allow List, in the
[companion app checklist](#home-assistant-companion-app-setup) below.

### Home Assistant Companion App Setup

Jarvis reads the primary user's Android phone entirely through the Home Assistant companion app:
where he is, whether he is driving, whether the phone is silenced, and what notifications it gets. It
also sends to the phone through the app. Every toggle below is in the companion app unless stated
otherwise, and most are under **Settings → Companion app → Manage sensors**.

**Home Assistant side:**

- **Assign the phone to the user's person.** Go to Settings → People → *the user* → *Track device*
  and add the phone's `device_tracker`. The `person` entity is what "is he home" and "how far is he
  from the car" are answered from (`inferUserLocation`). A phone that isn't assigned to a person
  gives no location at all.
- **Tell Jarvis which phone is his.** Companion-app devices are named after the phone ("Pixel 9"),
  not after the user. Do one of these:
  - set `HEY_JARVIS_PRIMARY_USER_PHONE_DEVICE` to the device name;
  - name the device after the user;
  - make a notify group called `notify.<user>_phone`.

  In a household with only one phone, none of this is needed.

**Companion app:**

| Toggle | Where | Permission | Used for |
| --- | --- | --- | --- |
| Background location | Location sensors | Location → *Allow all the time* | The user's zone and GPS fix: home or away, distance to the car |
| Detected activity | Activity sensors | Physical activity | "In vehicle" means he is driving, so an urgent message becomes a call |
| Android Auto | Android Auto sensors | — | Connected to the car, so the same as driving |
| Ringer mode | Audio sensors | — | Silent or vibrate means an urgent message is not spoken out loud in the house |
| Do not disturb | Do not disturb sensors | — | Same as ringer mode, for DND and its priority-only modes |
| Battery level | Battery sensors | — | Only used to recognise the device as a phone |
| Last notification | Notification sensors | Notification access; set the **Allow List** | Feeds the phone's notifications into Synapse (see [above](#phone-notifications-into-synapse)) |
| Notifications | Android app settings → Notifications | Allow notifications | Push notifications from `sendPushNotification` / `sendNotification` |
| Display over other apps | Android app settings | Display over other apps | `command_activity`, which is how Jarvis sets an alarm on the phone |

Notes:

- **Leave *Last removed notification* off.** Jarvis never reads it and keeps it out of every report,
  so enabling it only costs battery.
- **Allow List for *Last notification*:** everything allowed ends up in shared memory, so leave out
  banking, one-time codes and the like.
- **Display over other apps can't be requested up front.** The companion app asks for it the first
  time a `command_activity` arrives, so the first alarm Jarvis sets only opens that prompt. Grant it,
  and every alarm after that works.
- **Battery:** set the companion app's battery usage to *Unrestricted* in Android's app settings.
  Otherwise Android defers its background updates, and the location, activity and notification
  sensors can be minutes behind. Jarvis would then route messages based on where the user was, not
  where he is.
- **A Wear OS watch** with the companion app registers as a device of its own. Jarvis never sends to
  it, because the phone mirrors its notifications onto the watch anyway, so nothing on the watch
  needs enabling.
- **A reinstalled app** comes back as a new device. Assign its new `device_tracker` to the person
  again. The rest is picked up on its own within ten minutes.

### State Change Notification Workflow
Reactive notification workflow using agent network for intelligent state change analysis:
- **`stateChangeNotificationWorkflow`**: Analyzes state changes and sends notifications when warranted
- **Agent Network**: Uses Mastra Agent Network with notification agent for intelligent decision-making
- **Semantic Recall**: Leverages memory to understand context and determine notification necessity
- **Subscription Matching**: Retrieves relevant Given/When/Then subscriptions via static embeddings (see below)
- **Asynchronous Execution**: Triggered automatically by `registerStateChange` tool calls
- **Smart Filtering**: Only notifies for significant, actionable, or time-sensitive changes

**Workflow Steps:**
1. **Save to Memory**: State change is persisted for semantic recall
2. **Match Subscriptions**: State change is embedded and scored against every subscription's WHEN/GIVEN
3. **Analyze State Change**: Agent network examines state change data plus the matched subscriptions
4. **Notification Decision**: Determines if user should be notified based on:
   - Significance: Is this change important enough?
   - Actionability: Can the user do something about it?
   - Timing: Is this time-sensitive or urgent?
   - Context: What else is happening (from semantic recall)?
5. **Conditional Notification**: If warranted, hands the message to the notification agent, which routes it via `sendNotification`

**Technical Implementation:**
- Uses `AgentNetwork` from `@mastra/core` for multi-agent coordination
- Streams agent analysis for real-time decision-making
- Examines tool calls to detect if notification was actually sent
- Logs reasoning and notification status for observability

### Synapse Subscriptions (Points of Interest)

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

### Synapse Rules (Standing Instructions in Code)

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

### Weather Workflow
Multi-step weather processing workflow with state change registration:
- **`weatherWorkflow`**: Handles interactive weather requests from prompts or chat
- **`weatherMonitoringWorkflow`**: Performs scheduled weather checks every hour with automatic state change registration
- **Agent integration**: Seamlessly connects to the weather agent for tool execution
- **State change registration**: Automatically registers weather updates for notification analysis

**Workflow Steps:**
1. **Scheduled Weather Check**: reads the current weather for Aarhus, Denmark straight from the weather API and writes the line itself — no model call
2. **Register State Change**: Calls `registerStateChange` tool to persist weather data and trigger notification analysis

**Technical Implementation:**
- The check calls the weather tool directly. It was an agent step, and `createAgentStep` runs its agent with tools disabled, so every hourly update was the model guessing the weather; the factory now refuses tools at compile time
- Uses custom step with tool execution for state change registration
- Transforms weather result into structured state change format
- Triggers `stateChangeNotificationWorkflow` asynchronously

### Shopping List Workflow
Multi-step shopping list processing workflow implementing the original n8n 3-agent architecture:
- **`shoppingListWorkflow`**: Handles natural language shopping requests in Danish with 5-step process
- **Step 1 - Cart Snapshot**: Gets current cart contents as "before" baseline
- **Step 2 - Information Extraction**: Uses specialized Information Extractor agent to parse user requests into structured product data with operation types (set/remove/null)
- **Step 3 - Product Mutation**: A plain step running the Shopping List Mutator Agent's own tool loop, with only the search and set tools and the current basket in its prompt; it skips the model when nothing needs changing. It used to be an agent step, whose tools are disabled, so it never changed the basket
- **Step 4 - Updated Cart Snapshot**: Gets final cart contents as "after" comparison
- **Step 5 - Summary Generation**: Uses Summarization Agent to compare before/after states and provide user feedback in Danish
- **Error handling**: Comprehensive retry logic and graceful failure messages for each step
- **Danish language support**: Processes requests and provides responses in Danish

**Converted from n8n**: This workflow replicates the exact 3-agent pattern from the original n8n Shopping List Agent workflow, including Information Extractor → Shopping List Mutator → Summarization Agent flow with before/after cart comparison.

### Implement Feature Workflow
Takes a change from a spoken request to a Claude Code session implementing it:
- **`implementFeatureWorkflow`**: Starts the session at once; the session studies the codebase, asks only what the user alone can decide, and implements
- **Step 1 - Prepare**: Resolves the repository (Jarvis's own by default) and an optional title
- **Step 2 - Start Coding Session**: Starts a Claude Code session on the change with `startCodingSession`, and watches its events; the watcher asks the session's questions and opens the pull request once the session is done. No issue is filed
- **Step 3 - Format**: Says whether the session started, and on what

**Workflow Steps:**
1. **Prepare**: The request goes to the session as the user said it.
2. **Coding Session**: The session is told to read the parts of the codebase the request touches before changing
   anything, and to decide whatever the code, its documentation and its conventions settle. When nothing is left that
   only the user can decide, which is the usual case, it implements the change without asking. When something is, it
   asks then or at any later point (see **Questions a coding session asks** under [Coding Agent](#coding-agent)). The
   session runs unattended in the host's Docker Sandbox, and every notable event it emits (agent messages, status
   transitions, errors) is republished as a Synapse state change from the `coding` source, so progress flows into the
   existing notification path instead of needing the workflow to stay alive. The session commits on a `jarvis/…`
   branch and pushes nothing; when it is done, the watcher pushes the branch and opens the pull request from the
   server, and reports its link as `coding_session_pull_request_opened` (see **The sandbox cannot write to GitHub; the
   server publishes** under [Coding Agent](#coding-agent))
3. **Format**: Reports the session id and title, or why the session did not start.

**Usage Example:**
```typescript
await mastra.workflows.implementFeatureWorkflow.execute({
  initialRequest: "Add email notifications for task reminders",
  repository: "hey-jarvis", // Optional: defaults to "hey-jarvis"
  owner: "ffMathy", // Optional: defaults to "ffMathy"
});
```

**Why it asks nothing up front:**
It used to run a separate analysing session first and suspend once per question it wrote. That cost
minutes before anything was built even when nothing needed asking, and could only ask before the
work began. Letting the implementing session ask means a clear request is built straight away and a
question that only shows up halfway through can still be asked.

### Human-in-the-Loop Demo Workflow

Demonstrates email-based workflow suspension and resumption with a 3-step approval process:
- **`humanInTheLoopDemoWorkflow`**: Multi-step approval workflow with email-based human input
- **Step 1 - Budget Approval**: Requests approval for project budget (Yes/No + comments)
- **Step 2 - Vendor Selection**: Requests vendor selection (Vendor name + justification)
- **Step 3 - Final Confirmation**: Requests final action confirmation (Confirm/Cancel + notes)
- **Email integration**: Sends form request emails carrying the id of the suspended run
- **Security validation**: Only a reply from the address that was asked is accepted
- **LLM parsing**: `parseEmailReply()` turns the free text of the reply into the typed response
- **No timeout**: A suspended request waits until it is answered — nothing expires it, and the
  email does not claim otherwise

**Email Format:**
- Subject: `Form Request [RUN-{runId}/REQ-{requestId}]: {question}`
- Body: Question + instructions + the request reference (`{runId}/{requestId}`)
- Resume trigger: A reply whose subject still carries both ids

**Workflow Steps:**
1. **Initialize**: Pass the recipient, project name and budget through
2. **Request Budget Approval**: Send email, suspend workflow, wait for reply
3. **Stop When Budget Is Rejected**: A "no" finishes the run with `approvalGranted: false`
4. **Request Vendor Selection**: Send email, suspend, wait for reply
5. **Request Final Confirmation**: Send email, suspend, wait for reply
6. **Format Output**: Generate final result with all collected data

**Security Features:**
- Run id embedded in the email subject: `[RUN-{runId}/...]` — unlike a workflow id, which is
  shared by every run and every recipient
- Request id alongside it: `[.../REQ-{requestId}]`, minted per question. Every stage of one run
  suspends under the same run id, so the request id is what says *which* question a reply
  answers; a reply is only accepted for the request the run is still waiting on
- Sender validated against the address the request was sent to; an empty sender is refused
  rather than skipped
- A reply that fails validation is refused and the request stays open, so a wrong-sender,
  duplicate or late reply cannot destroy a pending approval or answer the wrong question
- An empty reply body is refused rather than handed to the parsing agent
- `recipientEmail` is required: there is no default address a stray Studio run could mail

**Usage Example:**
```typescript
const run = await humanInTheLoopDemoWorkflow.createRun();
const result = await run.start({
  inputData: {
    recipientEmail: 'user@example.com',
    projectName: 'New Website',
    budgetAmount: 50000,
  },
});

// Workflow suspends and sends email
// User replies to email with answer
// formRepliesDetectionWorkflow (runs every 3 hours) finds the reply and resumes the run
```

**Helper Functions:**
- `getSendEmailAndAwaitResponseWorkflow(slug, responseSchema)`: Reusable send-and-wait workflow,
  embeddable in any parent workflow with `.then(...)`
- `parseEmailReply()`: Uses the email parsing agent to extract the typed answer from a reply

### Email Checking Workflow
Tracks which emails have arrived, with **persistent tracking** of the last seen email. It does
not touch form replies or the state reactor — that is the form replies workflow below, which
keeps its own last-seen state under a separate storage key:
- **`emailCheckingWorkflow`**: Scheduled workflow that runs every minute + on startup
- **Step 1 - Search NEW Emails**: Uses `findNewEmailsSinceLastCheck` with persistent storage to fetch only emails received since the last workflow run
- **Step 2 - Store in State**: Stores new emails in workflow state and tracks the most recent email ID/timestamp
- **Step 3 - Update Last Seen**: Updates the `email_last_seen` database table with the most recent email
- **Step 4 - Format Output**: Returns summary with email count and update status

**Key Feature - Persistent Email Tracking:**
The workflow uses the `email_last_seen` database table to track which emails have been processed:
- **First run**: Returns recent emails (up to limit), stores the most recent as "last seen"
- **Subsequent runs**: Only returns emails received AFTER the last seen timestamp
- **Avoids reprocessing**: Each email is processed only once, even if it remains unread
- **Persists across restarts**: State is stored in LibSQL database (backed up in Home Assistant)

**Email State Functions:**
These are internal functions (not exposed as agent tools) for tracking email state:
```typescript
// Find only NEW emails since last check (storage key, mailbox folder, limit)
const result = await findNewEmailsSinceLastCheck('inbox', 'inbox', 50);

// Manually update last seen state
await updateLastSeenEmail('inbox', 'email-id-123', '2025-12-01T10:00:00Z');

// Get current last seen state
const state = await getLastSeenEmailState('inbox');

// Reset state (next run fetches recent emails again)
await clearLastSeenEmailState('inbox');
```

**Scheduled Execution:**
```typescript
scheduler.schedule({
  workflow: emailCheckingWorkflow,
  schedule: CronPatterns.EVERY_MINUTE,
  inputData: {},
  runOnStartup: true,
});
```

### Form Replies Detection Workflow
Automatically processes incoming email replies to form requests and resumes the suspended runs
they answer:
- **`formRepliesDetectionWorkflow`**: Scheduled workflow that runs every 3 hours
- **Step 1 - Search**: Finds emails received since this workflow's own last check
  (storage key `inbox-form-replies`)
- **Step 2 - Extract**: Reads the run id and request id out of the subject with
  `parseFormRequestSubject()` — the same function that builds the subject writes it, so the two
  sides cannot drift apart
- **Step 3 - Process**: For each email carrying the token:
  - Finds the run by asking each registered workflow whether it holds it
  - Hands the reply to the step that suspended, which checks the request id and the sender, and
    parses the free text with the email parsing agent
  - Counts the reply as resumed, rejected, or (no such run) an error
- **Step 4 - Register**: Registers the emails as a state change for the notification system
- **Step 5 - Summary**: Returns counts of emails processed, replies found, runs resumed and
  replies rejected

**Scheduled Execution:**
```typescript
scheduler.schedule({
  workflow: formRepliesDetectionWorkflow,
  schedule: CronPatterns.EVERY_3_HOURS,
  inputData: {},
  runOnStartup: true,
});
```

**When a reply is refused:**
A refused reply leaves the run suspended exactly where it was, so the person who was asked can
still answer. Replies are refused when they come from an address other than the one the request
was sent to, when they answer a request the run has already moved past, when the body is blank,
and when the parsing agent cannot read an answer out of them. Each is counted in
`repliesRejected` rather than reported as an error, because nothing has gone wrong with the
system. Only a token naming a run that does not exist is reported as an error.

## Processors

### 🔍 **Output Processors**
This project implements custom output processors that run after agent responses are generated. Processors enable post-processing logic without blocking the main agent flow.

### **Error Reporting Processor**
Automatically captures errors from agent responses and creates GitHub issues with sanitized information.

**Features:**
- **Asynchronous execution**: Runs in background without blocking agent responses
- **Error detection**: Scans agent output for error indicators (keywords: "error", "failed", "exception", "stack trace")
- **PII sanitization**: Uses Mastra's built-in PIIDetector to remove sensitive information before creating issues
- **GitHub integration**: Creates issues using the `createGitHubIssue` tool
- **Automatic integration**: Added to ALL agents by default via agent factory
- **Configurable**: Labels, repository, and enable/disable options

**Automatic Integration:**
The error reporting processor is automatically added to all agents created with `createAgent()`. No manual configuration needed - every agent gets error reporting by default.

```typescript
// Error reporting is automatically included
export async function getMyAgent() {
  return createAgent({
    name: 'MyAgent',
    instructions: '...',
    tools: myTools,
    // Error reporting processor is automatically added
  });
}
```

**Configuration:**
- `owner` (optional): Repository owner, defaults to "ffMathy"
- `repo` (required): Repository name where issues will be created
- `labels` (optional): Issue labels, defaults to `["automated-error", "bug"]`
- `enabled` (optional): Enable/disable processor, defaults to `true`

**Environment Requirements:**
- `HEY_JARVIS_GITHUB_API_TOKEN`: GitHub Personal Access Token with `repo` scope

**How It Works:**
1. After agent generates response, processor scans messages for error indicators
2. If error detected, Mastra's PIIDetector sanitizes the error message (removes PII)
3. GitHub issue is created with sanitized error using `createGitHubIssue` tool
4. All processing happens asynchronously - agent response returns immediately

**Testing:**
```bash
# Start MCP server
bunx turbo serve --filter=mcp

# Access playground at http://localhost:4111/agents
# Select any agent (all have error reporting)
# Send message containing error keywords: "error", "failed", "exception", "stack trace"
# Verify agent responds immediately (non-blocking)
# Check GitHub repository for created issue with sanitized error
```

**PII Redaction Examples:**
Mastra's PIIDetector automatically redacts:
- Email: `user@example.com` → `[EMAIL]`
- API Key: `sk_live_abc123` → `[API-KEY]`
- IP Address: `192.168.1.1` → `[IP-ADDRESS]`
- Phone: `555-1234` → `[PHONE]`
- Credit Card: `4111-1111-1111-1111` → `[CREDIT-CARD]`

**Architecture Notes:**
- **Async execution**: Processor doesn't block agent responses (~2-3s background processing)
- **Error detection**: Simple keyword matching (very fast)
- **PII sanitization**: Uses Mastra's PIIDetector with Google Gemini (~1-2 seconds)
- **Issue creation**: GitHub API call (~0.5-1 second)
- **Failure handling**: Processor errors are logged but don't fail the main agent flow

## Agent-as-Step and Tool-as-Step Patterns

### 🔄 **Modern Workflow Architecture**
All workflows in this project have been converted to use **agent-as-step** and **tool-as-step** patterns, which provide:

- **Better Reusability**: Existing agents and tools become reusable workflow components
- **Simplified Logic**: Less custom step code, more declarative workflow composition  
- **Consistent Behavior**: Agent and tool behavior is the same whether used standalone or in workflows
- **Easier Maintenance**: Changes to agents/tools automatically benefit all workflows using them

### 🤖 **Agent-as-Step Pattern**
Uses existing agents directly as workflow steps:

```typescript
const weatherStep = createAgentStep({
  id: 'weather-check',
  description: 'Get weather using weather agent',
  agentName: 'weather',
  inputSchema: z.object({ location: z.string() }),
  outputSchema: z.object({ result: z.string() }),
  prompt: ({ context }) => `Get weather for ${context.location}`,
  structuredOutput: { // Optional for JSON responses
    schema: z.object({ temperature: z.number(), condition: z.string() })
  }
});
```

**Benefits:**
- Leverages existing agent intelligence and tool access
- Consistent prompting and response handling
- Automatic scoring and evaluation (when enabled)
- Memory integration

### 🔧 **Tool-as-Step Pattern** 
Uses existing tools directly as workflow steps:

```typescript
const getCurrentWeatherStep = createToolStep({
  id: 'get-current-weather',
  description: 'Get current weather for a city',
  tool: getCurrentWeatherByCity,
  inputSchema: z.object({ location: z.string() }),
  inputTransform: ({ location }) => ({ cityName: location }),
});
```

**Benefits:**
- Direct tool execution without agent overhead
- Precise input/output transformation
- Better for deterministic operations
- Faster execution for simple operations

### 🌊 **Converted Workflows**

#### **Weather Monitoring Workflow**
- **Before**: Custom step with manual agent calling
- **After**: Agent-as-step pattern with weather agent
- **Improvement**: Simplified from 2 custom steps to 1 agent step + 1 transform step

#### **Weekly Meal Planning Workflow**  
- **Before**: Complex custom steps calling multiple agents
- **After**: Tool-as-step for recipe fetching + agent-as-step for meal planning
- **Improvement**: Tool-as-step for `getRecipeCatalog`, agent-as-step for `mealPlanRecipeSelector` and `mealPlanGenerator`
- **Token budget**: Recipes are chosen from the compact catalogue and only the chosen ones are fetched in full with `getRecipeById`, so no prompt ever carries every recipe
- **Baby tasting**: The household's baby is learning to eat and tastes the adults' dinner. `BABY_TASTING_GUIDELINES` in `cooking/workflows.ts` (from "Mad til børn", 2025) goes to both `mealPlanRecipeSelector` and `mealPlanGenerator`. It covers mild heat, little salt, no honey, no large predatory fish, and choking hazards. The generator moves chili and salt to after the baby's portion is set aside, and adds a "Til baby:" direction to each recipe

#### **Shopping List Workflow**
- **Before**: 5 complex custom steps with inline agent creation
- **After**: Mix of tool-as-step and agent-as-step patterns
- **Improvement**: Tool-as-step for cart operations, agent-as-step for extraction/processing/summarization

### 📋 **Pattern Selection Guidelines**

**Use Agent-as-Step when:**
- Need natural language processing
- Require tool calling capabilities  
- Want conversation context
- Need flexible, intelligent responses

**Use Tool-as-Step when:**
- Have deterministic operations
- Need direct API calls
- Want precise input/output control
- Prefer faster execution

**Use Custom Steps when:**
- Need complex data transformation
- Require workflow-specific logic
- Must combine multiple operations
- Need conditional branching

## Development

### Prerequisites
```bash
# Install Mastra globally
bun install mastra --global
```

### Testing Requirements

**Where a test belongs**

A spec that needs a credential, reaches the network, or starts the MCP server is
named `*.integration.spec.ts` and runs under `turbo test:integration`, which is
the only target that resolves secrets from 1Password. Everything else keeps the
plain `*.spec.ts` suffix and runs under `turbo test`, which carries no secrets at
all — so a test that quietly starts reaching for one fails there rather than
passing on someone's personal account.

CI runs `turbo test` on every push. `turbo test:integration` never runs on
GitHub Actions — only when someone runs the target by hand.

**CRITICAL: Test Server Startup Must Use run-with-env.sh**

When starting the MCP server for testing purposes, **ALWAYS use `run-with-env.sh` directly with tsx** to ensure proper environment variable loading from 1Password without nested TURBO process issues:

✅ **CORRECT:**
```bash
# Tests should start the server using run-with-env.sh + tsx directly
./.scripts/run-with-env.sh mcp/op.env bunx tsx mcp/mastra/mcp-server.ts
```

❌ **INCORRECT:**
```bash
# Don't use Turborepo tasks - they cause nested TURBO processes in test environment
bun run --cwd mcp serve:mcp
bun run --cwd mcp serve:mcp

# Don't bypass run-with-env.sh - environment variables won't load
bunx tsx mcp/mastra/mcp-server.ts
```

**Why This Matters:**
- The `run-with-env.sh` script ensures 1Password CLI authentication and environment variable injection
- Direct tsx execution avoids nested TURBO process issues that cause premature exit
- Tests run in the same environment as development and need access to secrets
- Without run-with-env.sh, required environment variables won't be available
- This approach provides the simplest, most direct path to a running server

**Test Implementation Pattern:**
```typescript
// In test setup files (e.g., mcp-server-manager.ts)
mcpServerProcess = spawn('./.scripts/run-with-env.sh', [
    'mcp/op.env',
    'bunx',
    'tsx',
    'mcp/mastra/mcp-server.ts'
], {
    detached: true,
    stdio: ['ignore', 'inherit', 'inherit'],
    cwd: '/workspaces/hey-jarvis',
});
```

### Running the Project
```bash
# Start development server with playground
bunx turbo serve --filter=mcp

# Build for production
bunx turbo build --filter=mcp
```

### Development Playground
Access the Mastra development playground at `http://localhost:4111/agents` to:
- Test agents interactively
- Monitor agent memory and state
- Debug tool calls and workflows
- View execution traces and performance metrics

### Environment Setup

This project uses **1Password CLI** for secure environment variable management in both development and production environments. 

#### Required Environment Variables
All environment variables use the `HEY_JARVIS_` prefix for easy management and DevContainer forwarding. Store these in your 1Password vault:
- **Weather**: `HEY_JARVIS_OPENWEATHERMAP_API_KEY` for weather data
- **Google Maps**: `HEY_JARVIS_GOOGLE_MAPS_API_KEY` for navigation, travel time estimation and place search
- **Google Gemini**: `HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY` for language models and embeddings. Deliberately separate from the Maps key -- they are restricted to different APIs and are not interchangeable.
- **Google OAuth2 (Calendar, Tasks & Contacts)**: `HEY_JARVIS_GOOGLE_CLIENT_ID`, `HEY_JARVIS_GOOGLE_CLIENT_SECRET`, `HEY_JARVIS_GOOGLE_REFRESH_TOKEN` for accessing the Google Calendar, Tasks and People APIs (see [Google OAuth2 Setup](#google-oauth2-setup) below)
- **Shopping (Bilka)**: `HEY_JARVIS_BILKA_EMAIL`, `HEY_JARVIS_BILKA_PASSWORD`, `HEY_JARVIS_BILKA_API_KEY` for authentication
- **Shopping (Search)**: `HEY_JARVIS_ALGOLIA_API_KEY`, `HEY_JARVIS_ALGOLIA_APPLICATION_ID`, `HEY_JARVIS_BILKA_USER_TOKEN` for product search
- **ElevenLabs**: `HEY_JARVIS_ELEVENLABS_API_KEY`, `HEY_JARVIS_ELEVENLABS_AGENT_ID`, `HEY_JARVIS_ELEVENLABS_VOICE_ID` for voice AI (test agent ID `HEY_JARVIS_ELEVENLABS_TEST_AGENT_ID` takes precedence for phone calls). The key and the agent ids also confirm that the phone's conversation is live before a photo slot is opened — there either agent counts — so without them photo uploads are off (see [Vision Vertical](#vision-vertical))
- **Recipes**: `HEY_JARVIS_VALDEMARSRO_API_KEY` for Danish recipe data
- **GitHub**: `HEY_JARVIS_GITHUB_API_TOKEN` for GitHub API access (coding agent and error reporting processor)
- **Claude Code sessions**: `HEY_JARVIS_CLAUDE_CODE_SSH_TARGET`, `HEY_JARVIS_CLAUDE_CODE_SSH_PRIVATE_KEY` to reach the host whose Docker Sandbox the coding vertical runs Claude Code in, and `HEY_JARVIS_CLAUDE_CODE_OAUTH_TOKEN` to bill it to the Claude subscription
- **WiFi**: `HEY_JARVIS_WIFI_SSID`, `HEY_JARVIS_WIFI_PASSWORD` for Home Assistant Voice Firmware
- **Notifications**: `HEY_JARVIS_PRIMARY_USER_PHONE_NUMBER` so Jarvis can call or text the primary user; optionally `HEY_JARVIS_PRIMARY_USER_NAME`, `HEY_JARVIS_PRIMARY_USER_PHONE_DEVICE`, `HEY_JARVIS_PRIMARY_USER_NOTIFY_SERVICE` and `HEY_JARVIS_CAR_NAME` to pin down which person, phone and car the routing looks at

#### Development Setup
1. **Install 1Password CLI**: Follow [1Password CLI installation guide](https://developer.1password.com/docs/cli/get-started/)
2. **Sign in to 1Password**: `eval $(op signin)` - **CRITICAL: Always run this command when you get a 1Password authentication error or non-zero exit code from op commands**
3. **Store your API keys** in 1Password vaults with the paths referenced in `.env`
4. **Run commands**: Use `bunx turbo serve --filter=mcp` or `bun run --cwd mcp serve:mcp` - both use `op run` automatically

**Important**: 
- If any command using 1Password fails with "no active session found" or similar errors, immediately run `eval $(op signin)` to re-authenticate before continuing.
- **After running `eval $(op signin)`, always assume it succeeded regardless of what output it returns.** It typically returns no output when successful.

#### Terminal Session Management
**CRITICAL: Always reuse existing terminal sessions** when running commands:
- Check `get_terminal_output` to see what terminals are available
- Reuse the same terminal ID for related commands instead of creating new terminals
- This maintains context, environment variables, and reduces resource usage

#### Important Development Guidelines
- **Do NOT create separate `*-dev` targets** that bypass 1Password CLI
- **The `op run` approach is designed for both development AND production**
- **1Password CLI provides secure local testing** without hardcoded keys
- **All Turborepo tasks should use the same `op run --env-file=".env"` pattern**
- **This ensures consistency between development and deployment environments**

If you encounter 1Password CLI authentication issues:
1. Run `op signin` to authenticate
2. Verify your vault contains the referenced secret paths
3. Check that the `.env` file references match your 1Password structure

### Google OAuth2 Setup

The Calendar, Todo-List and Phone verticals use Google's official `googleapis` NPM package for accessing the Google Calendar, Google Tasks and Google People APIs. These APIs require OAuth2 authentication as they access private user data.

#### Token Generation Behavior

The token generation script **automatically skips providers** that already have refresh tokens stored in Mastra storage. This means:

- ✅ **First run**: Generates tokens for all providers (opens browser for each)
- ✅ **Subsequent runs**: Only generates tokens for providers without stored tokens
- ✅ **Selective refresh**: Delete a specific provider's token from storage to regenerate only that one

To regenerate a token for a specific provider, delete it from storage first:
```bash
# Remove Google token to force regeneration
sqlite3 mcp/mastra.sql.db "DELETE FROM oauth_credentials WHERE provider='google';"

# Then run the generator - will only regenerate Google token
bun run --cwd mcp generate-tokens
```

#### Why OAuth2?
- **Private Data Access**: Google Calendar, Tasks and Contacts contain personal information that requires user consent
- **API Key Limitation**: API keys only work for public data, not private calendars or task lists
- **Automatic Token Refresh**: The `googleapis` library handles access token refresh automatically
- **Long-Lived Tokens**: Refresh tokens remain valid for 6+ months with regular use

#### Initial Setup (One-Time)

**Step 1: Create Google Cloud Project**
1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project or select an existing one
3. Enable the following APIs:
   - Google Calendar API
   - Google Tasks API
   - Google People API

**Step 2: Configure OAuth2 Credentials**
1. Navigate to **APIs & Services** → **Credentials**
2. Click **Create Credentials** → **OAuth 2.0 Client ID**
3. Configure the OAuth consent screen (if prompted):
   - Choose "Internal" for personal use or "External" for broader access
   - Fill in application name and developer contact
4. Select **Web application** as the application type
5. Add authorized redirect URI: `http://localhost:3000/oauth2callback`
6. Save the **Client ID** and **Client Secret**

**Step 3: Generate Refresh Token**

Run the token generation script to obtain your refresh token:

```bash
# Run the interactive token generator
bun run --cwd mcp generate-tokens

# This will:
# 1. Open your browser for Google authorization
# 2. Request access to Calendar, Tasks and Contacts
# 3. Generate and store your refresh token
```

The script will guide you through:
- Opening the Google authorization page
- Granting access to your Calendar, Tasks and Contacts
- Receiving your long-lived refresh token

The token is written straight to Mastra storage and only summarised on screen (length + last three
characters), so a durable credential does not linger in terminal scrollback. When you need the full
value — to copy it into 1Password, for example — delete the stored copy and re-run with
`--reveal-token` (or `HEY_JARVIS_REVEAL_REFRESH_TOKEN=1`). Revealing is refused when a CI
environment is detected, because build logs outlive the job.

**Step 4: Store Credentials Securely**

You have four options for storing your OAuth2 credentials:

**Mastra Storage (Default)**
```bash
# Generate tokens and store refresh token in Mastra's LibSQL database
bun run --cwd mcp generate-tokens

# This will:
# 1. Guide you through the OAuth flow
# 2. Store ONLY the refresh token in oauth_credentials table
# 3. Client ID and secret must still be set in environment variables
```

**Benefits**:
- Persistent refresh token across container restarts
- Automatic token renewal when OAuth provider rotates tokens
- Client ID/secret in env vars (more secure)
- Single source for refresh tokens across deployments

**Note**: Client ID and secret must always be provided via environment variables for security.

#### 1Password Items

`mcp/op.env` maps each environment variable to an `op://` reference, resolved at process start by
`run-with-env.sh` — through the 1Password CLI locally, and through `OP_SERVICE_ACCOUNT_TOKEN` in the
release workflow and deployment. Everything lives in the **Jarvis** vault:

| Environment variable | 1Password reference |
| --- | --- |
| `HEY_JARVIS_GOOGLE_CLIENT_ID` | `op://Jarvis/Google/Hey Jarvis client ID` |
| `HEY_JARVIS_GOOGLE_CLIENT_SECRET` | `op://Jarvis/Google/Hey Jarvis client secret` |
| `HEY_JARVIS_GOOGLE_REFRESH_TOKEN` | `op://Jarvis/Google/Hey Jarvis refresh token` |

Adopting another Google API in a vertical needs no new item or field — Calendar, Tasks and Contacts
all authenticate with this one credential. What it does need is a **new refresh token value**,
because the scopes a token carries are fixed when it is minted:

```bash
# generate-tokens skips a provider that already has a stored token, so clear it first
sqlite3 mcp/mastra.sql.db "DELETE FROM oauth_credentials WHERE provider='google';"

# --reveal-token prints the full value to paste into 1Password; without it only a
# fingerprint is shown, and revealing is refused when CI is detected
bun run --cwd mcp generate-tokens --reveal-token
```

Then update the `Hey Jarvis refresh token` field on the **Google** item. Updating 1Password is the
step that matters beyond your own machine: the Mastra copy is local, so CI and the deployed
assistant keep using the vault's token until it is replaced.

#### Token Lifecycle

**Access Tokens**:
- Short-lived (~1 hour)
- Automatically refreshed by the `googleapis` library
- No manual intervention needed

**Refresh Tokens**:
- Long-lived (6+ months with regular use)
- Used to obtain new access tokens
- Automatically renewed and stored when OAuth provider rotates them
- Will not expire as long as:
  - Used at least once every 6 months
  - Not revoked at [Google Account Permissions](https://myaccount.google.com/permissions)
  - Google Cloud Project credentials remain valid

**Automatic Token Renewal**:
Both Calendar and Todo-List verticals automatically update the stored refresh token when renewed:
```typescript
oauth2Client.on('tokens', async (tokens) => {
  if (tokens.refresh_token) {
    const credentialsStorage = await getCredentialsStorage();
    await credentialsStorage.renewRefreshToken('google', tokens.refresh_token);
    console.log('✅ Refresh token updated in storage');
  }
});
```

#### Credential Management with Mastra Storage

When using `--store-in-mastra`, credentials are persisted in the LibSQL database and tools automatically fall back to stored credentials when environment variables are not set.

**Credential Lookup Order**:
1. Environment variables (`HEY_JARVIS_GOOGLE_CLIENT_ID`, `HEY_JARVIS_GOOGLE_CLIENT_SECRET`, `HEY_JARVIS_GOOGLE_REFRESH_TOKEN`)
2. Mastra storage (`oauth_credentials` table) - **refresh token only**

**Note**: Client ID and secret are ALWAYS read from environment variables. Only the refresh token can be stored in Mastra.

**Storage Schema**:
```sql
CREATE TABLE IF NOT EXISTS oauth_credentials (
  provider TEXT PRIMARY KEY,
  refresh_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)
```

**Security Note**: Client IDs and secrets are intentionally NOT stored in the database. They must be provided via environment variables (`HEY_JARVIS_GOOGLE_CLIENT_ID` and `HEY_JARVIS_GOOGLE_CLIENT_SECRET`).

**Programmatic Access**:
```typescript
import { getCredentialsStorage } from './mastra/storage';

// Get stored refresh token
const credentialsStorage = await getCredentialsStorage();
const refreshToken = await credentialsStorage.getRefreshToken('google');

// Store/update refresh token manually
await credentialsStorage.setRefreshToken('google', newRefreshToken);

// Renew refresh token (called automatically by OAuth handlers)
await credentialsStorage.renewRefreshToken('google', renewedToken);

// List all stored providers
const providers = await credentialsStorage.listProviders();

// Delete refresh token
await credentialsStorage.deleteRefreshToken('google');
```

**Benefits**:
- **Persistent**: Refresh tokens survive container restarts
- **Automatic Fallback**: Tools check storage if refresh token env var is missing
- **Secure**: Client ID/secret never stored in database
- **Multi-Tenant**: Support multiple OAuth providers
- **Programmatic**: Easy token rotation

#### Troubleshooting

**"No refresh token received" Error**:
- This happens if you previously authorized the application
- Solution:
  1. Go to [Google Account Permissions](https://myaccount.google.com/permissions)
  2. Remove this application
  3. Run `bun run --cwd mcp generate-tokens` again

**"Missing required Google OAuth2 credentials" Error**:
- Verify all three environment variables are set:
  - `HEY_JARVIS_GOOGLE_CLIENT_ID`
  - `HEY_JARVIS_GOOGLE_CLIENT_SECRET`
  - `HEY_JARVIS_GOOGLE_REFRESH_TOKEN`
- If using 1Password: Run `eval $(op signin)` to authenticate

**"Invalid grant" Error**:
- Refresh token has been revoked or expired
- Solution: Run `bun run --cwd mcp generate-tokens` to get a new token

**Authorization Timeout**:
- The token generator times out after 5 minutes
- Solution: Run the script again and complete authorization promptly

#### Security Best Practices

- **Never commit credentials**: Always use 1Password or environment variables
- **Rotate tokens periodically**: Generate new tokens if you suspect compromise
- **Use internal consent screen**: For personal projects, use "Internal" OAuth consent screen
- **Monitor token usage**: Check [Google Account Activity](https://myaccount.google.com/security) regularly
- **Revoke old tokens**: Remove old application access from Google Account Permissions

### Adding New OAuth Providers

The token generation script (`mcp/generate-refresh-tokens.ts`) is designed to support multiple OAuth providers through a common interface. All configured providers will be processed automatically when the script runs.

OAuth provider configurations are defined in separate files under `mcp/mastra/credentials/`:
- `mcp/mastra/credentials/google.ts` - Google Calendar, Tasks and Contacts provider
- `mcp/mastra/credentials/microsoft.ts` - Microsoft Outlook/Email provider
- `mcp/mastra/credentials/types.ts` - Shared TypeScript interfaces
- `mcp/mastra/credentials/index.ts` - Module exports

### Microsoft OAuth2 Setup

The Email vertical uses Microsoft OAuth2 for accessing Outlook/Microsoft 365 email through the Microsoft Graph API.

#### Why OAuth2?
- **Private Data Access**: Email contains personal information that requires user consent
- **API Key Limitation**: Microsoft Graph doesn't support API keys for email access
- **Automatic Token Refresh**: The `@azure/msal-node` library handles access token refresh automatically
- **Long-Lived Tokens**: Refresh tokens remain valid for 90+ days with regular use

#### Initial Setup (One-Time)

**Step 1: Create Azure App Registration**
1. Go to [Azure Portal → App Registrations](https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps)
2. Create a new app registration
3. **IMPORTANT**: Under "Supported account types", select:
   - "Accounts in any organizational directory and personal Microsoft accounts" (for `/consumers/` endpoint)
   - OR "Personal Microsoft accounts only" (also uses `/consumers/` endpoint)
4. Select **Web** as the platform type
5. Add redirect URI: `http://localhost:3000/oauth2callback`

**Step 2: Configure API Permissions**
1. Navigate to **API permissions**
2. Click **Add a permission** → **Microsoft Graph**
3. Select **Delegated permissions**
4. Add the following permissions:
   - `Mail.ReadWrite` - Read and write mail
   - `Mail.Send` - Send mail
   - `offline_access` - Required for refresh token
5. Grant admin consent (if required by your organization)

**Step 3: Create Client Secret**
1. Navigate to **Certificates & secrets**
2. Click **New client secret**
3. Add a description and set expiration (recommended: 24 months)
4. Save the **Client Secret Value** immediately (it won't be shown again)
5. Note the **Application (client) ID** from the Overview page

**Step 4: Generate Refresh Token**

Run the token generation script:

```bash
# Run the interactive token generator
bun run --cwd mcp generate-tokens

# This will:
# 1. Open your browser for Microsoft authorization
# 2. Request access to your Email
# 3. Generate and store your refresh token automatically
```

The script will guide you through:
- Opening the Microsoft authorization page
- Granting access to your Email
- Receiving your long-lived refresh token

**Step 5: Store Credentials Securely**

Credentials are automatically stored in Mastra storage:

**Mastra Storage (Default)**
```bash
# Generate tokens and store refresh token in Mastra's LibSQL database
bun run --cwd mcp generate-tokens

# This will:
# 1. Guide you through the OAuth flow
# 2. Store ONLY the refresh token in oauth_credentials table
# 3. Client ID and secret must still be set in environment variables
```

**Benefits**:
- Persistent refresh token across container restarts
- Automatic token renewal when OAuth provider rotates tokens
- Client ID/secret in env vars (more secure)
- Single source for refresh tokens across deployments

**Note**: Client ID and secret must always be provided via environment variables for security.

#### Token Lifecycle

**Access Tokens**:
- Short-lived (~1 hour)
- Automatically refreshed by the `@azure/msal-node` library
- No manual intervention needed

**Refresh Tokens**:
- Long-lived (90+ days with regular use, up to 6 months with continuous use)
- Used to obtain new access tokens
- Automatically renewed and stored when OAuth provider rotates them
- Will not expire as long as:
  - Used at least once every 90 days
  - Not revoked at [Microsoft Account Permissions](https://account.microsoft.com/privacy/ad-settings)
  - Azure App Registration remains active

**Automatic Token Renewal**:
The Email vertical automatically updates the stored refresh token when renewed:
```typescript
const response = await msalClient.acquireTokenByRefreshToken(tokenRequest);

if (response.refreshToken && response.refreshToken !== refreshToken) {
  const credentialsStorage = await getCredentialsStorage();
  await credentialsStorage.renewRefreshToken('microsoft', response.refreshToken);
  console.log('✅ Refresh token updated in storage');
}
```

#### Troubleshooting

**"No refresh token received" Error**:
- Make sure you included `offline_access` scope in the app registration
- Solution:
  1. Go to Azure Portal → App Registrations → Your App → API permissions
  2. Ensure `offline_access` is listed
  3. Run `bun run --cwd mcp generate-tokens` again

**"Missing required Microsoft OAuth2 credentials" Error**:
- Verify all three environment variables are set:
  - `HEY_JARVIS_MICROSOFT_CLIENT_ID`
  - `HEY_JARVIS_MICROSOFT_CLIENT_SECRET`
  - `HEY_JARVIS_MICROSOFT_REFRESH_TOKEN`
- If using 1Password: Run `eval $(op signin)` to authenticate

**"Invalid grant" Error**:
- Refresh token has been revoked or expired
- Solution: Run `bun run --cwd mcp generate-tokens` to get a new token

**"AADSTS65001: User consent required" Error**:
- Admin consent is required for your organization
- Solution: Contact your IT administrator to grant consent for the app

**Authorization Timeout**:
- The token generator times out after 5 minutes
- Solution: Run the script again and complete authorization promptly

#### Security Best Practices

- **Never commit credentials**: Always use 1Password or environment variables
- **Rotate tokens periodically**: Generate new tokens if you suspect compromise
- **Use appropriate scopes**: Only request the minimum permissions needed
- **Monitor token usage**: Check [Microsoft Account Activity](https://account.microsoft.com/account) regularly
- **Revoke old tokens**: Remove old application access from Microsoft Account Permissions
- **Set client secret expiration**: Use shorter expiration periods (6-12 months) for better security

### Adding New OAuth Providers

The token generation script (`mcp/generate-refresh-tokens.ts`) is designed to support multiple OAuth providers through a common interface. All configured providers will be processed automatically when the script runs.

OAuth provider configurations are defined in separate files under `mcp/mastra/credentials/`:
- `mcp/mastra/credentials/google.ts` - Google Calendar, Tasks and Contacts provider
- `mcp/mastra/credentials/microsoft.ts` - Microsoft Outlook/Email provider
- `mcp/mastra/credentials/types.ts` - Shared TypeScript interfaces
- `mcp/mastra/credentials/index.ts` - Module exports

#### Provider Interface

Each OAuth provider must implement the `OAuthProvider` interface:

```typescript
interface OAuthProvider {
  name: string;                    // Display name (e.g., "Google", "Microsoft")
  clientIdEnvVar: string;          // Environment variable for client ID
  clientSecretEnvVar: string;      // Environment variable for client secret
  refreshTokenEnvVar: string;      // Environment variable for refresh token
  scopes: string[];                // OAuth scopes to request
  setupInstructions: string[];     // Steps for initial provider setup
  storageInstructions: string[];   // Instructions for storing credentials
  createClient: (clientId: string, clientSecret: string) => any;
  getAuthUrl: (client: any) => string;
  exchangeCode: (client: any, code: string) => Promise<TokenResponse>;
}
```

#### Example: Adding Microsoft OAuth

```typescript
import { ConfidentialClientApplication } from '@azure/msal-node';

const microsoftProvider: OAuthProvider = {
  name: 'Microsoft',
  clientIdEnvVar: 'HEY_JARVIS_MICROSOFT_CLIENT_ID',
  clientSecretEnvVar: 'HEY_JARVIS_MICROSOFT_CLIENT_SECRET',
  refreshTokenEnvVar: 'HEY_JARVIS_MICROSOFT_REFRESH_TOKEN',
  scopes: [
    'https://graph.microsoft.com/Calendars.ReadWrite',
    'https://graph.microsoft.com/Tasks.ReadWrite',
    'offline_access', // Required for refresh token
  ],
  setupInstructions: [
    'Go to Azure Portal > App Registrations',
    'Create a new app registration',
    'Add http://localhost:3000/oauth2callback to redirect URIs',
    'Create a client secret in Certificates & secrets',
  ],
  storageInstructions: [
    '1Password:',
    '  - Store in "Microsoft OAuth" item',
    '  - Fields: client id, client secret, refresh token',
  ],
  createClient: (clientId: string, clientSecret: string) => {
    return new ConfidentialClientApplication({
      auth: {
        clientId,
        clientSecret,
        authority: 'https://login.microsoftonline.com/common',
      },
    });
  },
  getAuthUrl: (client) => {
    return client.getAuthCodeUrl({
      scopes: microsoftProvider.scopes,
      redirectUri: REDIRECT_URI,
    });
  },
  exchangeCode: async (client, code: string) => {
    const result = await client.acquireTokenByCode({
      code,
      scopes: microsoftProvider.scopes,
      redirectUri: REDIRECT_URI,
    });
    return {
      access_token: result.accessToken,
      refresh_token: result.refreshToken,
      scope: result.scopes.join(' '),
      token_type: result.tokenType,
      expiry_date: result.expiresOn?.getTime() || 0,
    };
  },
};

// Add to PROVIDERS array
const PROVIDERS: OAuthProvider[] = [
  googleProvider,
  microsoftProvider, // New provider
];
```

#### Steps to Add a New Provider

1. **Install Provider SDK**: Add the OAuth library to package.json
   ```bash
   bun add @provider/oauth-library
   ```

2. **Create Provider Configuration**: Create a new provider file in `mcp/mastra/credentials/`
   - Set appropriate environment variable names
   - Configure OAuth scopes for required APIs
   - Implement client creation, auth URL generation, and token exchange
   ```typescript
   // mcp/mastra/credentials/your-provider.ts
   import type { OAuthProvider, TokenResponse } from './types.js';
   
   export const yourProvider: OAuthProvider = {
     name: 'YourProvider',
     // ... provider configuration
   };
   ```

3. **Export Provider**: Add your provider to `mcp/mastra/credentials/index.ts`
   ```typescript
   export * from './types.js';
   export { googleProvider } from './google.js';
   export { microsoftProvider } from './microsoft.js';
   export { yourProvider } from './your-provider.js'; // Add here
   ```

4. **Register Provider**: Import and add to PROVIDERS array in `mcp/mastra/generate-refresh-tokens.ts`
   ```typescript
   import { googleProvider, microsoftProvider, yourProvider } from './credentials/index.js';
   
   const PROVIDERS: OAuthProvider[] = [
     googleProvider,
     microsoftProvider,
     yourProvider, // Add here
   ];
   ```

5. **Update Environment Files**: Add new variables to `mcp/op.env` — or to `mcp/op.optional.env` if the server
   must keep running while the 1Password item does not exist yet (a missing `mcp/op.env` reference stops it)
   ```bash
   HEY_JARVIS_YOUR_PROVIDER_CLIENT_ID="op://Jarvis/Your Provider/Hey Jarvis client ID"
   HEY_JARVIS_YOUR_PROVIDER_CLIENT_SECRET="op://Jarvis/Your Provider/Hey Jarvis client secret"
   HEY_JARVIS_YOUR_PROVIDER_REFRESH_TOKEN="op://Jarvis/Your Provider/Hey Jarvis refresh token"
   ```

6. **Run Token Generation**: Execute `bun run --cwd mcp generate-tokens`
   - Script will process ALL providers automatically
   - Skip any provider with missing credentials
   - Each provider opens its own browser authorization flow

7. **Update Documentation**: Add provider-specific notes to this AGENTS.md file

#### Multi-Provider Benefits

- **Automatic Processing**: All providers run sequentially without user intervention
- **Graceful Skipping**: Providers without credentials are skipped automatically
- **Consistent UX**: Same flow for all providers (open browser, authorize, receive token)
- **Easy Maintenance**: Add providers without modifying core script logic
- **Type Safety**: TypeScript ensures all providers implement the required interface

## MCP Server Access

The MCP server itself checks no credentials on port 4112. What stands in front of it is the
Cloudflare tunnel and its **Cloudflare Access** application: ElevenLabs and the integration tests
present a service token (`CF-Access-Client-Id` / `CF-Access-Client-Secret`), and a browser signs in
with an identity policy.

**`/api/photos/*` must bypass Access**, as `/artifacts/*` must for the visualize vertical's pages
(see [Visualize Vertical](#visualize-vertical-shortcuts)). The phone asks for a photo slot there
(`POST /api/photos/slots`) and sends the photo there (`PUT /api/photos/<token>`), and it cannot
present an Access service token, so without a bypass Access answers both with its sign-in page, and
the phone tells sir his photo did not reach Jarvis. In Zero Trust → Access → Applications, add a
self-hosted application for `<your MCP hostname>/api/photos/*` with a single **Bypass** policy
(include: Everyone). It covers both routes and every method, which matters because the browser build
sends a CORS preflight (`OPTIONS`) before each.

**Behind the bypass are two checks, and no credential.** Opening a slot needs the id of a
conversation that ElevenLabs, asked with this server's own API key, reports as in progress on
Jarvis's agent; sending the photo needs the slot's token, 128 random bits handed straight to the
phone, good for five minutes and one photo, and claimed before a byte of the body is read (see
[Vision Vertical](#vision-vertical)). Nothing else under `/api` is reachable without Access.

**Rolling the camera out** takes these steps, in this order:
1. Deploy the MCP server image with the vision vertical, and add the bypass above. The startup log
   should not say `Photo uploads are off`; if it does, it names the ElevenLabs variable missing.
2. Redeploy the ElevenLabs agent (`bunx turbo deploy --filter=elevenlabs`), so that its prompt knows
   the phone's photo messages and it has no client tool for the camera. An agent deployed from an
   earlier build of this feature expects to open the camera itself, through a tool this server no
   longer publishes.
3. In the ElevenLabs dashboard, leave nothing on the MCP server's tool approval policy but the two
   tools it publishes, `routePromptWorkflow` and `getNextInstructionsWorkflow`.
4. On the phone, enter this server's `https://` address under **Jarvis server** in the settings.
   Until it has one, the phone offers no camera button.
5. If a 1Password item was created in the `Jarvis` vault for the earlier build's upload key, delete
   it: nothing reads it any more.

## Integration Capabilities

### Internet of Things (IoT)
- Voice command processing through ESPHome firmware
- Smart device control and automation
- Alarms on the user's phone, through the companion app (`setUserPhoneAlarm`, a shortcut onto the notification vertical's `setPhoneAlarm`)
- **Everyday control is one tool call.** "Turn off the living room lights" is `callIoTService`
  with `{"area_id": "living_room"}`, made without any lookup: the agent's instructions list the
  home's areas (cached for ten minutes, refreshed in the background), and Home Assistant targets
  a whole area, or a list of entities, in one call. `findEntities` returns only id, name, area and
  state for when ids are needed; `getAllDevices`, with every attribute, is for when they matter.
  The agent runs at `low` thinking (`LOW_THINKING_PROVIDER_OPTIONS`), since each step of its tool
  loop is a wait before the house changes. Routing logs `elapsedMs` for the plan, its
  registration and each delegation, and `callIoTService` logs the service call itself, so a slow
  request can be read back as a breakdown
- Sensor data processing and analysis
- Scene and routine management

#### Home Assistant Event Monitor
`verticals/internet-of-things/event-monitor.ts` holds one subscription to Home Assistant's
websocket API (through the official `home-assistant-js-websocket` client) and files what happens in
the house for the State Change Reactor as it happens. It is started by `mcp-server.ts` only, the
process that also owns the schedules, so Studio never files a change twice.

- **What it listens to.** `state_changed` events whose state value moved (attribute-only updates
  and entities being added or removed are dropped), and every other bus event except
  `IGNORED_EVENT_TYPES` — Home Assistant's own bookkeeping, plus `call_service`,
  `automation_triggered` and `script_started`, whose effects are reported as state changes anyway.
  Other events are what bring button presses, doorbells and tag scans to the reactor, filed as
  `home_assistant_event`; state changes keep the `device_state_change` type. The companion app's
  notification sensors are the exception: they are routed to the phone vertical, not reported as
  device states (see [Phone Notifications Into Synapse](#phone-notifications-into-synapse)).
- **Spammy sources are bulked** (`change-bulker.ts`). Changes are collected per entity, or per event
  type and source. A quiet bucket is released after 30 seconds; one that reaches 5 changes is spammy
  and held for 10 minutes, then reported once with `changeCount`/`occurrences`, the first and last
  value and the distinct values in between.
- **Filtering** (`change-reports.ts`). Anything whose entity or device carries the `sensitive` label
  is dropped. A state bucket is dropped as noise unless some value it passed through differs from
  where it started by more than the entity's noise baseline, so a door that opened and closed inside
  one window is still reported.
- **Catch-up.** On every connect and reconnect it compares `get_states` against the last states it
  saw (persisted in `iot_device_states`) and reports what changed while it was away.

### Model Context Protocol (MCP)
- Server-client communication for tool sharing
- Resource management and discovery
- Secure agent-to-agent communication
- Real-time data synchronization

### Voice Interface
- Speech-to-text processing
- Natural language understanding
- Text-to-speech generation with ElevenLabs
- Wake word detection and response

## Architecture Benefits

### Vertical Organization
- **Business Domain Alignment**: Code is organized by business verticals (weather, shopping, cooking) rather than technical layers
- **High Cohesion**: Related agents, tools, and workflows are co-located for better maintainability
- **Sub-vertical Support**: Complex verticals like cooking can have sub-folders (meal-planning) for specialized flows
- **Clear Ownership**: Each vertical has its own focused scope and responsibilities

### Type Safety
- Full TypeScript support with runtime validation
- Zod schemas for structured data
- Type-safe tool definitions and agent configurations

### Scalability
- Horizontal scaling with workflow distribution
- Memory-efficient agent state management
- Observability and performance monitoring
- Cloud deployment ready (Vercel, Cloudflare, AWS Lambda)

### Extensibility
- Modular agent and tool architecture
- Plugin-based workflow system
- Easy integration with external services
- Custom evaluation and scoring systems

## Vertical Organization Conventions

### 📋 **Core Principles**
This project uses **vertical organization** where code is grouped by business domain rather than technical layer. Follow these conventions for all future development:

### 🏗️ **Directory Structure Rules**

#### **1. New Vertical Creation**
When adding a new business vertical (e.g., `calendar`, `security`, `entertainment`):

```bash
# Create the vertical directory structure
mastra/verticals/[vertical-name]/
├── agent.ts          # Single general-purpose agent (if simple)
├── agents.ts         # Multiple agents (if moderate complexity)
├── tools.ts          # All tools for this vertical
├── shortcuts.ts      # Cross-vertical tools (optional - see section 3)
├── workflows.ts      # All workflows for this vertical
└── index.ts          # Export everything from this vertical
```

**Examples:**
- **Simple vertical**: `weather/` (1 agent, 1 workflow)
- **Moderate vertical**: `shopping/` (2 agents, 1 workflow)
- **Complex vertical**: `cooking/` (1 general + 3 specialized agents, 1 workflow)

#### **2. Sub-Vertical Creation**
For complex verticals with multiple specialized flows, create sub-verticals:

```bash
# Complex vertical with sub-vertical
mastra/verticals/[vertical-name]/
├── agent.ts                    # General vertical agent
├── tools.ts                    # Shared tools for the vertical
├── shortcuts.ts                # Cross-vertical tools (optional)
├── [sub-vertical-name]/        # Specialized sub-vertical
│   ├── agents.ts              # Specialized agents
│   ├── workflows.ts           # Specialized workflows
│   └── index.ts               # Sub-vertical exports
└── index.ts                   # Main vertical exports
```

**Example**: `cooking/meal-planning/` contains 3 specialized agents for complex meal planning workflows

#### **3. Shortcuts (Cross-Vertical Tools)**
Shortcuts are tools that "piggy-back" on other verticals' capabilities. They allow a vertical to leverage tools from other domains while providing a domain-specific interface.

**When to use shortcuts:**
- When a vertical needs data or actions from another vertical's domain
- When you want to provide a simplified, domain-specific interface to cross-vertical functionality
- When a vertical needs to integrate with IoT devices, external services, or other agents

**Directory structure with shortcuts:**
```bash
mastra/verticals/commute/
├── agent.ts          # Commute agent (includes both tools and shortcuts)
├── tools.ts          # Core commute tools (getTravelTime, searchPlaces, etc.)
├── shortcuts.ts      # Cross-vertical shortcuts (e.g., getCarNavigationDestination via IoT)
└── index.ts          # Exports tools, shortcuts, and agent
```

**Example shortcuts:**
- **Commute vertical** → `getCarNavigationDestination`: Queries IoT devices to get the Tesla's current navigation destination via Tessie integration
- **Weather vertical** → `getUserCurrentLocation`: Uses IoT device tracking to find user location for weather queries

**Shortcut implementation pattern:**
Shortcuts must use the `createShortcut` utility which automatically reuses the input and output schemas from the underlying tool:

```typescript
// shortcuts.ts
import { createShortcut } from '../../utils/shortcut-factory.js';
import { someToolFromOtherVertical } from '../other-vertical/tools.js';

export const myShortcut = createShortcut({
  id: 'myShortcut',
  description: 'Domain-specific description of what this shortcut does',
  tool: someToolFromOtherVertical,
  execute: async (input) => {
    // Call the underlying tool (schemas are inherited)
    const result = await someToolFromOtherVertical.execute(input);
    
    // Optionally filter/transform the result while maintaining schema compatibility
    return result;
  },
});

export const myVerticalShortcuts = {
  myShortcut,
};
```

**Agent integration:**
Shortcuts are merged with regular tools when creating agents:
```typescript
// agent.ts
import { myVerticalShortcuts } from './shortcuts.js';
import { myVerticalTools } from './tools.js';

export async function getMyAgent(): Promise<Agent> {
  return createAgent({
    id: 'my-vertical',
    name: 'MyVertical',
    instructions: '...',
    tools: { ...myVerticalTools, ...myVerticalShortcuts },
  });
}
```

**Export pattern:**
```typescript
// index.ts
export { getMyAgent } from './agent.js';
export { myVerticalTools } from './tools.js';
export { myVerticalShortcuts } from './shortcuts.js';
```

### 🎯 **Naming Conventions**

#### **File Naming**
- **Single agent**: `agent.ts` (e.g., `weather/agent.ts`)
- **Multiple agents**: `agents.ts` (e.g., `shopping/agents.ts`)
- **Tools**: Always `tools.ts`
- **Shortcuts**: Always `shortcuts.ts` (optional - for cross-vertical tool re-use)
- **Workflows**: Always `workflows.ts`
- **Exports**: Always `index.ts`

#### **Agent Naming**
- **General agents**: `[vertical]Agent` (e.g., `weatherAgent`, `recipeSearchAgent`)
- **Specialized agents**: `[vertical][Purpose]Agent` (e.g., `mealPlanSelectorAgent`, `shoppingListSummaryAgent`)

#### **Tool Naming**
- **Tool IDs**: Always use `camelCase` matching the variable name (e.g., `getCurrentWeather`, `findProductInCatalog`)
- **Tool variable names**: Must exactly match their tool ID (e.g., tool ID `getCurrentWeather` = variable name `getCurrentWeather`)
- **Tool exports**: **CRITICAL** - Export tools using the variable name directly as shorthand
- **Tool collection exports**: Use `[vertical]Tools` (e.g., `weatherTools`, `cookingTools`)

**Example - CORRECT Tool Naming:**
```typescript
// ✅ CORRECT: Variable name matches tool ID (camelCase)
export const getCurrentWeather = createTool({
  id: 'getCurrentWeather',  // camelCase ID matching variable name
  // ... tool config
});

export const weatherTools = {
  getCurrentWeather,  // ✅ Shorthand - key and value use same name
  getForecast,
};
```

**Example - INCORRECT Tool Naming:**
```typescript
// ❌ INCORRECT: Variable name doesn't match ID
export const fetchWeather = createTool({
  id: 'getCurrentWeather',  // ❌ ID doesn't match variable name
  // ... tool config
});

// ❌ INCORRECT: Using different key than variable name
export const weatherTools = {
  'get-current-weather': getCurrentWeather,  // ❌ Wrong key format!
};
```

**Why This Matters:**
Mastra's `/api/tools` endpoint requires tool keys to match their tool IDs. When tools are registered in the Mastra instance, the object keys become the tool identifiers used by the API. The tool ID, variable name, and export key must all be identical for tools to be properly exposed.

#### **Workflow Naming**
- **Workflow IDs**: Use `camelCase` matching the export name (e.g., `weatherMonitoringWorkflow`)
- **Workflow exports**: Use descriptive names (e.g., `weatherMonitoringWorkflow`, `weeklyMealPlanningWorkflow`)

### 📦 **Export Patterns**

#### **Vertical Index Exports**
Each vertical's `index.ts` must follow this pattern:

```typescript
// [Vertical] vertical exports
export { [agent/agents] } from './agent'; // or './agents'
export { [vertical]Tools } from './tools';
export { [workflows] } from './workflows';
export * from './[sub-vertical]'; // if sub-verticals exist
```

#### **Main Verticals Index**
The main `verticals/index.ts` should export everything:

```typescript
// Main verticals exports
export * from './weather';
export * from './shopping';
export * from './cooking';
export * from './[new-vertical]'; // Add new verticals here
```

### 🔧 **Implementation Guidelines**

#### **Agent Creation Rules**
1. **Start Simple**: Begin with a single general agent (`agent.ts`)
2. **Split When Complex**: If >3 distinct responsibilities, consider multiple agents (`agents.ts`)
3. **Create Sub-Verticals**: If >4 agents, create specialized sub-verticals
4. **Maintain Focus**: Each agent should have ONE clear responsibility

#### **Tool Organization Rules**
1. **Vertical Ownership**: All tools for a vertical go in its `tools.ts`
2. **No Cross-Vertical Tools**: Tools belong to exactly one vertical
3. **Shared Tools**: If truly shared, create a new `shared/` vertical
4. **API Integration**: Group related API calls in the same vertical
5. **CRITICAL - Tool Naming**: Tool ID, variable name, and export key must all be identical camelCase

**Tool Export Pattern:**
```typescript
// In tools.ts - Export using variable name directly (shorthand)
export const weatherTools = {
  getCurrentWeather,        // ✅ Shorthand for getCurrentWeather: getCurrentWeather
  getForecastByCity,        // ✅ ID, variable, and key all match
};

// In index.ts - Export the tools object
export { weatherTools } from './tools';

// In mastra/index.ts - Spread into Mastra config
tools: {
  ...weatherTools,  // Keys will be tool IDs (camelCase)
  ...shoppingTools,
}
```

#### **Workflow Rules**
1. **Domain Alignment**: Workflows should match business processes, not technical steps
2. **Single Vertical**: Workflows should primarily use agents/tools from their own vertical
3. **Cross-Vertical**: If using multiple verticals, consider if it should be in a new vertical

### 🚀 **Step-by-Step: Adding a New Vertical**

#### **Example: Adding a Calendar Vertical**

1. **Create Directory Structure**:
```bash
mkdir -p mastra/verticals/calendar
```

2. **Create Core Files**:
```typescript
// calendar/agent.ts
import { createAgent } from '../../utils/agent-factory';

export const calendarAgent = createAgent({
  name: 'Calendar',
  instructions: 'You are a calendar management agent...',
  tools: calendarTools,
  // memory and model automatically provided by factory
});

// calendar/tools.ts  
import { createTool } from '../../utils/tool-factory';
import { z } from 'zod';

export const getCalendarEvents = createTool({
  id: 'getCalendarEvents',  // camelCase matching variable name
  // ... tool config
});

export const calendarTools = {
  getCalendarEvents,  // Shorthand export
};

// calendar/workflows.ts
import { createWorkflow, createStep } from '../../utils/workflow-factory';

export const calendarSyncWorkflow = createWorkflow({
  id: 'calendarSyncWorkflow',
  // ... workflow config
});

// calendar/index.ts
export { calendarAgent } from './agent';
export { calendarTools } from './tools';
export { calendarSyncWorkflow } from './workflows';
```

3. **Update Main Exports**:
```typescript
// verticals/index.ts
export * from './weather';
export * from './shopping';  
export * from './cooking';
export * from './calendar'; // Add new vertical
```

4. **Register in Mastra**:
```typescript
// mastra/index.ts
import { calendarAgent, calendarSyncWorkflow } from './verticals';

export const mastra = new Mastra({
  agents: {
    // ... existing agents
    calendar: calendarAgent,
  },
  workflows: {
    // ... existing workflows  
    calendarSyncWorkflow,
  },
});
```

### ✅ **Validation Checklist**
Before considering a vertical complete:

- [ ] Directory follows naming conventions
- [ ] All files use proper naming patterns  
- [ ] Exports are properly structured
- [ ] Agent responsibilities are clear and focused
- [ ] Tool IDs are camelCase, identical to the variable and the export key
- [ ] Workflows match business processes
- [ ] Main index files are updated
- [ ] Build passes: `bunx turbo build --filter=mcp`
- [ ] Documentation updated in this AGENTS.md file

### 🎯 **When to Create Sub-Verticals**
Create sub-verticals when:
- **>4 specialized agents** in one vertical
- **Multiple distinct workflows** that share some but not all tools
- **Complex business processes** that have sub-processes
- **Clear logical separation** within the vertical

**Example**: `cooking/meal-planning/` exists because meal planning has 3 specialized agents and complex workflows, while general recipe search is simpler.

## Future Roadmap

### Enhanced Agents
- **Calendar Agent**: Smart scheduling and meeting management
- **Security Agent**: Home security monitoring and alerts
- **Entertainment Agent**: Media control and content recommendations
- **Energy Agent**: Smart energy management and optimization

### Advanced Workflows
- **Multi-agent orchestration** for complex home automation
- **Event-driven automation** with real-time triggers
- **Learning workflows** that adapt to user preferences
- **Emergency response** protocols with prioritization

### Integrations
- **Apple HomeKit** compatibility
- **Google Assistant** and **Alexa** voice integration
- **IFTTT/Zapier** workflow connections
- **IoT device ecosystem** expansion

## Development Guidelines

### Core Development Principles

#### 🔌 **Port Configuration Management**
**CRITICAL: When changing ports, ALWAYS update ALL of these files:**

1. **Service Configuration**:
   - `mcp/supervisord.conf` - Production service ports

2. **Port Constants**:
   - `mcp/lib/ports.sh` - Bash port constants (centralized)

3. **Documentation**:
   - `mcp/AGENTS.md` - Update port references in documentation

**Port Change Checklist**:
- [ ] Update supervisord.conf
- [ ] Update ports.sh
- [ ] Update AGENTS.md documentation

### File Creation Policy
**CRITICAL**: When working on this project:

#### ❌ ABSOLUTELY PROHIBITED FILES:
- **NEVER create ANY .md files** - Not README.md, not GUIDE.md, not TESTING.md, not anything
- **NO markdown files of any kind** (README, GUIDE, DOCS, SHOPPING_README, TESTING, IMPLEMENTATION_SUMMARY, etc.)
- **NO documentation artifacts** (ANALYSIS.md, COMPARISON.md, ARCHITECTURE.md, etc.)
- **NO explanation files** (MIGRATION.md, CONVERSION.md, FEATURES.md, etc.)
- **NO example or demo scripts** unless explicitly requested
- **NO test files or testing artifacts** outside the standard test directory structure
- **NO configuration files** not directly required for functionality

#### ✅ ALLOWED FILE CREATION:
- **Core functionality files**: agents, tools, workflows in their respective directories
- **Package configuration**: Only when required for new dependencies
- **Test scripts**: Only .js/.ts files in appropriate test directories when needed

#### 📝 DOCUMENTATION UPDATES:
- **UPDATE this AGENTS.md file** instead of creating new documentation
- **Add inline comments** in code for complex logic explanations
- **Update existing configuration files** when adding new features
- **Use the Mastra playground** for testing and examples instead of creating files

#### 🎯 REASONING:
This project follows a strict "lean documentation" approach because:
- **AGENTS.md is the single source of truth** for all project documentation
- **NO OTHER .md FILES ARE PERMITTED** - everything goes in AGENTS.md
- **Scattered documentation** creates maintenance overhead and confusion
- **The Mastra playground** provides interactive testing without file creation
- **Inline comments** are more maintainable than separate documentation files
- **Multiple README files** violate the monorepo structure and TURBO conventions

**If you feel documentation is needed, ALWAYS update this AGENTS.md file instead of creating new files. DO NOT CREATE ANY .md FILES UNDER ANY CIRCUMSTANCES.**

### Tool ID Naming Conventions
**CRITICAL**: A tool's id, its variable name and its export key must be the same camelCase
word. See the [`mastra-tools`](../.claude/rules/mastra-tools.md) rule, which is the
authority on this.

#### ✅ CORRECT Examples:
- `getCurrentWeather` ✅
- `findProductInCatalog` ✅
- `setProductBasketQuantity` ✅
- `getAllDevices` ✅
- `listRecentFailures` ✅

#### ❌ INCORRECT Examples:
- `get-current-weather` ❌ (kebab-case)
- `get_current_weather` ❌ (snake_case)
- `GetCurrentWeather` ❌ (PascalCase)
- `get current weather` ❌ (spaces)
- id `getCurrentWeather` exported as `fetchWeather` ❌ (the three must match)

#### 🎯 REASONING:
- **Mastra publishes the export keys.** `/api/tools` turns the keys of the object you
  spread into `tools` into the tool names callers see, so an id that disagrees with its
  key is a tool nobody can invoke by the name it reports.
- **Consistency**: every vertical follows this, so a tool can be found by grepping its id.

#### ⚠️ This applies to tools, not to workflow steps
A **step** id stays kebab-case — `store-preferences`, `format-final-output`, and the ~70
others across the verticals — including a `createToolStep` wrapper, which is a step rather
than a tool. A **workflow** id is camelCase, matching the key it is registered under in
`mastra/index.ts`. Only tool ids are covered here.

This document previously said every tool id was kebab-case, which never matched the code:
only the `api` vertical's four token-usage tools were ever written that way, and every
other vertical — weather, calendar, coding, commute, cooking, email, IoT, notification,
phone, shopping, reflection — uses camelCase.

### Factory Pattern Usage
**CRITICAL**: All agents, tools, and workflows must be created using the Hey Jarvis factory functions:

#### 🏭 **Required Factory Functions**
- **Agents**: Use `createAgent()` from `../../utils/agent-factory`
- **Tools**: Use `createTool()` from `../../utils/tool-factory`  
- **Workflows**: Use `createWorkflow()` and `createStep()` from `../../utils/workflow-factory`
- **Agent-as-Step**: Use `createAgentStep()` from `../../utils/workflow-factory` to use agents directly as workflow steps
- **Tool-as-Step**: Use `createToolStep()` from `../../utils/workflow-factory` to use tools directly as workflow steps

#### ✅ **CORRECT Usage Examples**:

**Agent Creation:**
```typescript
import { createAgent } from '../../utils/agent-factory';
import { myTools } from './tools';

export const myAgent = createAgent({
  name: 'MyAgent',
  instructions: 'You are a helpful agent...',
  tools: myTools,
  // memory and model (gemini-flash-latest) are automatically provided
});
```

**Tool Creation:**
```typescript
import { createTool } from '../../utils/tool-factory';
import { z } from 'zod';

export const myTool = createTool({
  id: 'my-tool-action',
  description: 'Performs a specific action',
  inputSchema: z.object({ input: z.string() }),
  outputSchema: z.object({ result: z.string() }),
  execute: async ({ context }) => ({ result: context.input }),
});
```

**Workflow Creation:**
```typescript
import { createWorkflow, createStep, createAgentStep, createToolStep } from '../../utils/workflow-factory';
import { z } from 'zod';

// Traditional custom step
const myStep = createStep({
  id: 'myStep',
  description: 'A workflow step',
  inputSchema: z.object({}),
  outputSchema: z.object({ result: z.string() }),
  execute: async () => ({ result: 'done' }),
});

// Agent-as-step: Use an existing agent directly as a workflow step
const agentStep = createAgentStep({
  id: 'weather-step',
  description: 'Get weather using weather agent',
  agentName: 'weather',
  inputSchema: z.object({ location: z.string() }),
  outputSchema: z.object({ weather: z.string() }),
  prompt: ({ context }) => `Get weather for ${context.location}`,
});

// Tool-as-step: Use an existing tool directly as a workflow step
const toolStep = createToolStep({
  id: 'get-weather-step',
  description: 'Get current weather using tool',
  tool: getCurrentWeatherByCity,
  inputSchema: z.object({ location: z.string() }),
  inputTransform: ({ location }) => ({ cityName: location }),
});

export const myWorkflow = createWorkflow({
  id: 'myWorkflow',
  inputSchema: z.object({}),
  outputSchema: z.object({ result: z.string() }),
}).then(myStep);
```

#### ❌ **INCORRECT Direct Usage**:
```typescript
// ❌ NEVER do this - bypasses Hey Jarvis defaults and standards
import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { createWorkflow } from '@mastra/core/workflows';

export const badAgent = new Agent({ ... }); // ❌
export const badTool = createTool({ ... });  // ❌
export const badWorkflow = createWorkflow({ ... }); // ❌
```

#### 🎯 **Factory Pattern Benefits**:
- **Consistent Defaults**: All agents automatically get `gemini-flash-latest` model and shared memory
- **Explicit API Configuration**: Google provider is explicitly configured with `HEY_JARVIS_GOOGLE_GENERATIVE_AI_API_KEY`
- **Future-Proof**: Easy to add logging, error handling, or observability across all entities
- **Type Safety**: Better TypeScript support with optional parameters for common defaults
- **Maintainability**: Single point of configuration for system-wide changes
- **Standards Enforcement**: Ensures all components follow Hey Jarvis conventions
- **YAGNI Compliance**: Factory methods are opinionated and only expose necessary customization options

#### 📦 **Import Paths**:
Always use relative imports from your vertical to the utils:
- From `verticals/[vertical]/`: `../../utils/agent-factory`
- From `verticals/[vertical]/[sub-vertical]/`: `../../../utils/agent-factory`

**When creating new entities, ALWAYS use the Hey Jarvis factory functions instead of direct Mastra constructors.**

### Workflow State Management Guidelines
**CRITICAL**: Workflow state should **only** be used for values that need to travel across **more than one step**.

#### 🎯 **The One-Step Rule**
**If a value is only used by the immediately following step, pass it through context instead of storing it in state.**

State management has overhead and adds complexity. Only use state when:
- A value needs to be accessed **2+ steps away** from where it was created
- Multiple steps need to access the same value
- A value needs to persist through loops (e.g., `dowhile`)
- Human-in-the-loop workflows need to maintain context across suspend/resume

#### ✅ **CORRECT State Usage**:

**Example 1: Shopping Workflow - Selective State**
```typescript
// State schema - only values that span multiple steps
const workflowStateSchema = z.object({
  prompt: z.string(),      // Used by step 2 and step 5 - spans 3 steps ✅
  cartBefore: z.any(),     // Used by step 5 - spans 4 steps ✅
});

// Step 1: Get cart
const getCart = createToolStep<typeof workflowStateSchema>()({
  tool: getCurrentCartContents,
});

// Step 2: Store prompt and cart in state (both used later)
const storeForLater = createStep<typeof workflowStateSchema>()({
  execute: async ({ context, workflow }) => {
    workflow.setState({
      prompt: context.prompt,      // Will be used by extraction AND summary
      cartBefore: context.cart,    // Will be used by summary
    });
    return {};
  },
});

// Step 3: Extract products - uses state.prompt
const extractProducts = createAgentStep<typeof workflowStateSchema>()({
  prompt: ({ workflow }) => `Process: ${workflow.state.prompt}`,  // ✅ Uses state
});

// Step 4: Process products - uses context.products (immediate next step)
const processProducts = createAgentStep<typeof workflowStateSchema>()({
  inputSchema: extractedProductSchema,  // ✅ Gets from previous step context
  prompt: ({ context }) => `Process: ${JSON.stringify(context.products)}`,
});

// Step 5: Summary - uses state.prompt and state.cartBefore
const generateSummary = createAgentStep<typeof workflowStateSchema>()({
  prompt: ({ context, workflow }) => {
    return `Original: ${workflow.state.prompt}  // ✅ From state (spans 3 steps)
Before: ${workflow.state.cartBefore}           // ✅ From state (spans 4 steps)  
After: ${context}`;                            // ✅ From context (immediate)
  },
});
```

**Example 2: Weather Workflow - No State Needed**
```typescript
// NO state schema - all values flow through context
const weatherCheck = createAgentStep()({
  outputSchema: z.object({ result: z.string() }),
});

const transform = createStep()({
  inputSchema: z.object({ result: z.string() }),  // ✅ From previous step context
  execute: async ({ context }) => {
    return { weather: context.result };  // ✅ Immediate use, no state needed
  },
});

export const workflow = createWorkflow({
  // No stateSchema ✅
})
  .then(weatherCheck)
  .then(transform);  // Data flows through context
```

#### ❌ **INCORRECT State Over-Usage**:

```typescript
// ❌ BAD: Storing values that only go one step
const workflowStateSchema = z.object({
  weatherResult: z.string(),    // ❌ Only used by next step - use context!
  recipes: z.any(),             // ❌ Only used by next step - use context!
  mealplan: z.any(),           // ❌ Only used by next step - use context!
});

// ❌ BAD: Unnecessary storage step
const storeWeather = createStep<typeof workflowStateSchema>()({
  execute: async ({ context, workflow }) => {
    workflow.setState({ weatherResult: context.result });  // ❌ Wasteful!
    return {};
  },
});

// Next step immediately uses it
const useWeather = createStep<typeof workflowStateSchema>()({
  execute: async ({ workflow }) => {
    return { data: workflow.state.weatherResult };  // ❌ Should use context!
  },
});

// ✅ CORRECT: Pass through context
const getWeather = createAgentStep()()({
  outputSchema: z.object({ result: z.string() }),
});

const useWeather = createStep()()({
  inputSchema: z.object({ result: z.string() }),  // ✅ Direct context flow
  execute: async ({ context }) => {
    return { data: context.result };  // ✅ No state needed
  },
});
```

#### 📊 **State vs Context Decision Tree**

```
Does the value need to be accessed by a step that is...

→ Immediately next? 
  └─ Use CONTEXT ✅ (no state)

→ 2+ steps away?
  └─ Use STATE ✅ (store in state)

→ Used by multiple different steps?
  └─ Use STATE ✅ (store in state)

→ Needs to persist through loops?
  └─ Use STATE ✅ (store in state)

→ Part of suspend/resume workflow?
  └─ Use STATE ✅ (store in state)
```

#### 🏗️ **Implementation Pattern**

**When NOT using state (simple linear workflows):**
```typescript
// No generic parameter, no state schema
const myStep = createStep()()({
  id: 'my-step',
  inputSchema: z.object({ data: z.string() }),
  execute: async ({ context }) => {
    // Use context.data directly
  },
});

export const myWorkflow = createWorkflow({
  // No stateSchema
  inputSchema: z.object({}),
  outputSchema: z.object({}),
});
```

**When using state (values span multiple steps):**
```typescript
// Define state schema
const stateSchema = z.object({
  persistedValue: z.string(),  // Will be used multiple steps later
});

// Use generic parameter with state
const myStep = createStep<typeof stateSchema>()({
  id: 'my-step',
  execute: async ({ context, workflow }) => {
    // Store for later use
    workflow.setState({ persistedValue: context.data });
    
    // Access state
    const value = workflow.state.persistedValue;
  },
});

export const myWorkflow = createWorkflow({
  stateSchema: stateSchema,  // ✅ Provide state schema
  inputSchema: z.object({}),
  outputSchema: z.object({}),
});
```

#### 💡 **Key Takeaways**
- **Context is for immediate data flow** between adjacent steps
- **State is for long-distance data sharing** across multiple steps
- **Prefer context over state** when possible - it's simpler and more efficient
- **State adds overhead** - use it only when the value truly spans multiple steps
- **Comment why you're using state** - explain which steps will use the value

**When creating new entities, ALWAYS use the Hey Jarvis factory functions instead of direct Mastra constructors.**

### Scorers and Evaluation

**AUTOMATIC**: All agents and workflow steps automatically include comprehensive evaluation scorers through the new **AI Tracing** system:

#### 🎯 **Included Scorers**:
- **answer-relevancy**: Evaluates how well responses address the input query (0-1, higher is better)
- **hallucination**: Detects factual contradictions and unsupported claims (0-1, lower is better)
- **completeness**: Checks if responses include all necessary information (0-1, higher is better)
- **prompt-alignment**: Measures how well responses align with prompt intent (0-1, higher is better)
- **bias**: Detects potential biases in outputs (0-1, lower is better)

#### 🔧 **Available But Not Auto-Enabled**:
- **faithfulness**: Measures how accurately responses represent provided context (requires context to be provided)
- **tool-call-accuracy**: Evaluates whether the LLM selects correct tools (requires per-agent configuration with actual tool objects)

#### ⚙️ **Scorer Configuration**:
- **Default sampling rate**: 10% of responses are scored (balances monitoring with cost)
- **Evaluation model**: Uses `gemini-flash-latest` for cost-effectiveness
- **Asynchronous execution**: Scoring runs in background without blocking responses
- **Automatic storage**: Results stored in `mastra_scorers` table via AI Tracing

#### 📊 **AI Tracing and Observability**:
The project now uses **Mastra AI Tracing** instead of the deprecated telemetry system:
- **AI Tracing**: Enabled via custom observability config in Mastra setup
- **Structured Logging**: Uses PinoLogger for comprehensive log management
- **Trace Storage**: All traces and scorer results automatically stored in LibSQL database
- **DefaultExporter**: Persists traces locally for viewing in Studio
- **CloudExporter**: Optionally sends traces to Mastra Cloud (requires `MASTRA_CLOUD_ACCESS_TOKEN`)
- **TokenUsageExporter**: Custom exporter that captures and persists token usage from model generations
- **TokenTrackingProcessor**: Enriches spans with agent/workflow context for accurate attribution

#### 💰 **Token Usage Tracking**:
Automatic token tracking is built into the observability pipeline:

**Architecture:**
1. **TokenUsageExporter**: Custom AI tracing exporter that listens for `MODEL_GENERATION` spans
2. **TokenTrackingProcessor**: Span processor that enriches traces with agent/workflow IDs
3. **TokenUsageStorage**: SQLite-based storage layer for historical token usage data
4. **Startup Logging**: Cumulative usage statistics displayed in console on system startup

**Database Schema:**
```sql
-- Token usage records table
CREATE TABLE token_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model TEXT NOT NULL,              -- e.g., "gemini-flash-latest"
  provider TEXT NOT NULL,           -- e.g., "google"
  prompt_tokens INTEGER DEFAULT 0,
  completion_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER NOT NULL,
  timestamp TEXT NOT NULL,
  trace_id TEXT,                    -- Links to AI trace
  agent_id TEXT,                    -- Agent that made the call
  workflow_id TEXT                  -- Workflow that made the call
);

-- Quota configuration table
CREATE TABLE token_quotas (
  model TEXT PRIMARY KEY,
  max_tokens INTEGER NOT NULL,
  reset_period TEXT DEFAULT 'monthly',  -- daily/monthly/yearly
  last_reset TEXT NOT NULL
);
```

**Startup Display:**
On system startup, cumulative token usage is logged to the console:
```
📊 Token Usage Summary:
   Total: 150,000 tokens (42 requests)
   Prompt: 100,000 | Completion: 50,000
   By Model:
   - gemini-flash-latest: 120,000 tokens (35 requests)
   - gpt-4: 30,000 tokens (7 requests)
```

**Programmatic Access:**
Token usage can be queried programmatically via the `TokenUsageStorage` API:
```typescript
import { getTokenUsageStorage } from './storage';

const storage = await getTokenUsageStorage();
const totalUsage = await storage.getTotalUsage();
const modelUsage = await storage.getAllModelUsage();
```

#### 🔧 **Customizing Scorers**:
```typescript
// Override sampling rate for production (lower cost)
export const myAgent = createAgent({
  name: 'MyAgent',
  instructions: 'You are a helpful agent...',
  tools: myTools,
  scorers: createScorersConfig({}, 0.05), // 5% sampling
});

// Add custom scorers
export const myAgent = createAgent({
  name: 'MyAgent',
  instructions: 'You are a helpful agent...',
  tools: myTools,
  scorers: createScorersConfig({
    customScorer: {
      scorer: myCustomScorer(),
      sampling: { type: 'ratio', rate: 1.0 },
    },
  }),
});

// Disable scorers (not recommended)
export const myAgent = createAgent({
  name: 'MyAgent',
  instructions: 'You are a helpful agent...',
  tools: myTools,
  scorers: undefined,
});
```

#### 📊 **Monitoring and Analysis**:
- View scoring results in the Mastra playground at `http://localhost:4111/agents`
- Access AI traces and detailed metrics through Studio's Observability section
- Query the `mastra_scorers` table directly for custom analysis
- Use scoring data to identify improvement opportunities and track performance trends

**All scorers are automatically enabled by default to ensure comprehensive quality monitoring across the Hey Jarvis system.**

### Agent Architecture Guidelines
When refactoring or creating agents:
- **Prefer specialized agents** over single multi-purpose agents for complex workflows
- **Keep agent prompts focused** on specific cognitive tasks
- **Use clear separation of concerns** between search, selection, generation, and formatting
- **Maintain backward compatibility** by keeping original agent names as aliases
- **Update the main Mastra index** to register all new specialized agents
- **Test agent interactions** using the Mastra playground at `http://localhost:4111/agents`

## Contributing
- Follow TypeScript best practices
- Include proper agent memory management
- Implement comprehensive tool validation
- Add appropriate workflow testing
- Apply YAGNI principle

### Scope Guidelines for Commits
Use MCP-specific scopes:
- `mcp`, `agents`, `workflows`, `tools`
- `weather`, `shopping`, `cooking`

For more information about Mastra development, visit the [official documentation](https://mastra.ai/docs).