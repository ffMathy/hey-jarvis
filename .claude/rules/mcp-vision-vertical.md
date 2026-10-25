---
paths:
  - "mcp/**"
---

# Vision Vertical

> Part of [Jarvis Mastra AI Agents → Current Agents](mcp-current-agents.md). Paths in it are relative to `mcp/` unless they say otherwise.

Lets sir send Jarvis a photo with the camera button on his phone — a receipt, a label, a letter, a
screen — and ask about it, whether he says what he wants before he sends it or not at all. The camera
and the shot are the phone's (see "Showing him something" in `.claude/rules/mobile-showing-him-something.md`); what lives here is
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
     the photo. Should it route the announcement anyway, the planner plans nothing for the photo and
     sets `awaitsPhoto`, and the request finishes — not as one no agent could handle — on
     instructions to tell sir to go ahead with the camera button and then hold the line with
     `skip_turn` until the photo comes or something else settles it; where the device has no camera
     button, to send him to his phone instead (see **Ending the call** under [Routing](mcp-routing.md#routing)).
   - **Sent first**, with nothing said — the agent routes `He sent a photo without saying what he
     wants: look at it and say what it shows (photo photo3)`. The planner plans one vision task that
     says what the photo shows and what in it could be acted on, and names the photo in
     `photosToAskAbout`; the closing report then has Jarvis say what it shows, ask what sir would like
     done with it, and wait for the answer (see **Questions for the user** under [Routing](mcp-routing.md#routing)).

**A screenshot of sir's screen is kept beside the photos, and never waits.** On every summoning from
the assistant gesture, the phone sends what was on its screen (`"kind": "screenshot"` in the slot
request, `PHOTO_KINDS` in `vision/photos.ts`; see "What was on the screen" in `.claude/rules/mobile-what-was-on-the-screen.md`) and
tells the voice agent its id in a note that takes no turn. It is looked at like a photo when sir asks
about his screen, but nobody sent it to be looked at: it is never in `photosWaiting`, never brought up,
never the latest photo standing in for a question that names none, and at most
`MAX_KEPT_SCREENSHOTS` are kept — counted apart from `MAX_KEPT_PHOTOS`, so a summoning a minute
cannot push his receipt out. The planner
lists one the request names under a heading of its own, and `lookAtPhoto` calls it a screenshot.

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
  it is only no longer waiting. That goes for his answer to the question a look at a photo sent with
  nothing said ends on, too: the look marked the photo as looked at, so it is not waiting any more,
  but any photo still kept that the request names by its tag is listed to the planner as well, under
  a heading of its own (`photosTheRequestNames` in `routing/planner.ts`), and his "nothing" about it
  is a dismissal like any other. Only by the id the tag gives: never the latest photo standing in.
- **A later request's closing report brings it up**, in `questionsForUser` with the photo id as its
  id: `Sir sent you a photo 4 minutes ago (photo3) that nobody has looked at yet: ask him what he
  would like done with it.` Only once it has waited a minute unlooked-at (`PHOTO_WAITING_GRACE_MS`),
  because the conversation that sent it routes a look at it within seconds, and then left alone for
  `QUESTION_REMINDER_INTERVAL_MS` like a question. A photo waits for no longer than that
  (`PHOTO_WAITS_FOR_MS`, half an hour), so in practice it is brought up once — though it is kept, and
  found by its id, for a day (`KEEP_PHOTO_MS`). The grace is not tied to a conversation, which nothing here knows: a photo
  whose first look failed can be brought up again in the conversation that sent it, as any question
  he moved on from would be. See **Questions for the user** under [Routing](mcp-routing.md#routing).
- **Only a reading counts.** A reader that failed has told sir nothing about his photo, so it stays
  waiting — and a photo sent with nothing said whose look failed is not asked about as one Jarvis
  has described; a question about a photo that is not kept marks nothing.
- **And only a reading sir hears.** What a look read reaches him in its request's closing report,
  and a request he talks over is superseded and never read. So the reader is stopped with the
  request (the tool's abort signal) — a stopped look throws rather than marking the photo, since
  Mastra hands an aborted generation back as an empty reading — and a look that did finish is taken back
  (`unmarkPhotoLookedAt`, called from `carryOut`): the photo is waiting again, and is brought up
  later rather than lost.

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
- **Is bounded**, since every check spends up to four requests on Jarvis's ElevenLabs key. A
  verdict is remembered for a minute — live, so three photos in a row cost one check, and not live, so
  repeating a made-up id costs nothing upstream; an unverifiable one is never remembered. A check
  that does go upstream counts twice: against whoever asked, at most 6 a minute
  (`MAX_CHECKS_PER_SOURCE_PER_MINUTE`), and then against the whole process, at most 30 — beyond
  either, `429`; a check refused for its source counts against nothing else. The second is the bound
  on Jarvis's key. Spending it all turns away every photo sir sends for as long as it lasts, and the
  first only raises what that costs, to five sources asking at once: it does not stop a stranger
  with a few proxies, Tor's exit nodes or several tunnels, who has that many. Behind it stand the
  Cloudflare rate limiting rule (see [MCP Server Access](mcp-mcp-server-access.md#mcp-server-access)), which turns away any
  one address's flood at the edge, and the process-wide limit, which caps what such a stranger can
  spend on the key. Whoever asked is `CF-Connecting-IP`, which Cloudflare sets on every request it passes to the
  tunnel, or the socket's address for a request that did not come through it, and an IPv6 address
  counts as its /48 (`whoIsAsking` in `api/routes.ts`): a connection is commonly delegated a /56 or
  a /48, and a free tunnel broker routes a /48, so counting each /64 would make one stranger
  hundreds of sources. The price of remembering
  *not live* is a call so new that none of the three steps found it: that phone is turned away for
  the rest of the minute too. The body holds the whole transcript, emails and calendar entries
  included, so it is never logged: at most the status and a refusal's `detail.code`, and never the
  conversation id.

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
  waiting. The reader is handed the tool's abort signal, so a request that is cancelled stops its
  look too, and a stopped look throws instead of marking the photo: Mastra resolves an aborted
  generation with no text, which would otherwise pass for a reading.

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
first, a photo kept for 30 minutes. Slots are pruned whenever the store is touched, but a photo's
half hour is kept on an unref'd timer (`letGoOfPhotoOnTime`), because the privacy policy promises
it: pruned only when touched, a photo shown late in the evening would stay in memory until someone
next spoke to Jarvis. The timer carries the photo's id and nothing else, so a photo let go of early
to make room is not held by it. An id is matched however a model wrote it ("Photo 3" is `photo3`),
and a question that names no photo means the latest only if it is under three minutes old. Studio's process (`mastra dev`, 4111) has a store of its own that nothing fills, so photos can
only be asked about through the MCP server.

**Nor is a photo kept in a trace.** The span of the photo reader's model call records its input as
the model was sent it, the photo base64-encoded into a `data:image/...` string that Mastra keeps up to
128 KB of — in the trace store on `/data`, and in Mastra Cloud where that is set up. `PhotoSpanFilter`
(`utils/photo-span-filter.ts`, on the observability config in `mastra/index.ts`) replaces every
image's bytes in every span before it is exported, leaving the question and the rest of the span as
they were. Its spec runs a real trace, with and without it, so it is held to the spans Mastra actually
writes. The photo reader has no memory, which would be a second copy.

**Nor in the log.** A model call that fails throws the AI SDK's `APICallError`, whose
`requestBodyValues` is the whole request — for the photo reader, the photo as Gemini's
`inlineData.data` — and Mastra logs that error ("Upstream LLM API error", "Error in agent stream"),
once per attempt when a `RetryError` keeps them all. `createLogger` (`utils/logger.ts`) prints
`[request body left out]` in its place, wherever the error sits: on its own, as a `cause`, or in a
`RetryError`'s `errors` and `lastError`. That goes for every agent, not just the photo reader, since
the body is every prompt in full, emails and calendar entries included. The rest of the error stays:
the URL, the status, and what the provider answered, which for Gemini names the failure rather than
repeating the request. An error nested deeper than the logger follows is printed by name and message
alone, never as the raw object whose fields Pino would otherwise print. `logger.spec.ts` logs a failed
photo read through a real logger and reads back what was written.

**The photo routes** (`api/routes.ts`) are reachable by anyone — the phone holds no Cloudflare Access
service token — and both answer in the routes' JSON envelope (`success`, `message`, `data`):
- **`POST /api/photos/slots`** (`PHOTO_SLOTS_ROUTE`) reads its own body, JSON of at most a kilobyte
  (`readSlotRequest`), and answers `201` with the slot; `400` for a body without a well-formed
  conversation id — one that is not JSON, or over a kilobyte, included — `403` for a conversation not
  live on Jarvis's agent, `429` once the minute's checks are spent — the asker's own or the whole
  process's — `502` when ElevenLabs could not confirm it, and `503` when this server cannot check at
  all. `registerApiRoutes(router, { isLiveJarvisConversation })` takes a stand-in for the check, which
  is how `routes.spec.ts` covers each answer without ElevenLabs.
- **`PUT /api/photos/:uploadToken`** (`PHOTO_UPLOAD_ROUTE`) asks for no key, and **reads nothing until
  the request has earned it**, in this order:
  1. `claimSlotBeforeReading`: a wrong content type is a `415`, and an unknown or used token a `404`
     — the slot is claimed before anything else happens, so it is read from once.
  2. Only then does `express.raw` read at most 3 MB.

The JSON parser in `mcp-server.ts` skips everything under `/api/photos/` for the same reason
(`readsItsOwnBody` in `api/routes.ts`, which `routes.spec.ts` mounts too), and the request log writes
an upload's path without its token (`withoutUploadToken`, which leaves `/api/photos/slots` readable)
and never with its headers or body. Both compare the path in any case, since Express routes
`/API/PHOTOS/SLOTS` to the slot endpoint all the same: a skip that missed it would have let the
server's parser read a hundred kilobytes, and the route's own kilobyte limit would never have
applied. CORS allows any origin, `PUT`, `POST` and `OPTIONS`, and the `Content-Type` header: what
lets a request through is written into it by the phone — the conversation id, the token — rather
than anything a browser attaches by itself, and the browser build is served from GitHub Pages. Both
paths answer an `OPTIONS` preflight.

**Required Environment Variables:** none of its own. The check uses `HEY_JARVIS_ELEVENLABS_API_KEY`,
which needs read access to the agents' conversation history, and at least one of
`HEY_JARVIS_ELEVENLABS_AGENT_ID` and `HEY_JARVIS_ELEVENLABS_TEST_AGENT_ID` — the same variables the
phone vertical uses. Without them the server starts as usual and photo uploads are off.

**Requirements:** a Cloudflare Access bypass for `/api/photos/*`, and this server's address in the
phone's settings under **Jarvis server**; a Cloudflare rate limiting rule for `/api/photos/slots` is
recommended — see [MCP Server Access](mcp-mcp-server-access.md#mcp-server-access).

**Example Use Cases:**
- "I'll send you a receipt — what's the total?", then the photo
- "What does this letter say I have to do?"
- "Add everything on this receipt to the shopping list"
- A photo with nothing said: "That's a Netto receipt for 36.95 kroner, sir, for milk and rye bread.
  What would you like done with it?"
