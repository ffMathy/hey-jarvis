---
paths:
  - "mobile/**"
---

# Showing him something

> Part of [Mobile App](mobile.md). Paths in it are relative to `mobile/` unless they say otherwise.

Jarvis can be sent a photo — a receipt, a label, a letter — and asked about it. Only sir opens the
camera: the faint button beside Jarvis is the only way in, and it is there only once the phone knows
where sir's own Jarvis server is (the optional **Jarvis server** setting, see Configuration). Both ways
of using it work:

- **Tell him first, then send it.** "I'll send you a receipt — what's the total?" He tells sir to go
  ahead with the camera button and waits; when the photo arrives, he routes the question with it.
- **Send it first.** A photo with nothing said: he looks at it straight away, says what it shows, and
  asks what sir would like done with it — and can answer questions about it from there.

The photo goes to the Jarvis server (the MCP server), is kept there in memory for a day, and a
model that can see answers from it (`.claude/rules/mcp-vision-vertical.md`, "Vision").

```
connected, server set  phone ─ contextual update ──▶ agent   "…it has a camera button beside you…"
sir taps the button    phone  opens the camera app, or the browser's picker, inside the tap
                       phone ─ POST <server>/api/photos/slots {"conversationId": "conv_…"} ──▶ Jarvis server (not awaited)
                       phone ─ contextual update ──▶ agent   "Sir has opened the camera…" — it waits
                       phone ─ user_activity ──▶ agent   at once, then every 5 s until the tap is seen through
                                 server asks ElevenLabs: is that conversation live on Jarvis's agent?
                             ◀── 201 { "uploadPath": "/api/photos/<token>" }, or a refusal
photo taken            phone ─ PUT image/jpeg to <server><uploadPath>, no key ──▶ Jarvis server ──▶ { photoId }
                       phone ─ user message ──▶ agent   "I've sent you a photo (photo photo3)."
                       agent ─ routePromptWorkflow "… (photo photo3)" ──▶ Jarvis server
```

The note that the camera is open, and the first `user_activity`, go out in the tap itself, right after
the slot request starts and before the server has answered it — whatever it answers. A slot refused, or
never answered, is told once the camera has closed, as a photo that did not reach him.

Six decisions carry it, and each has a reason:

- **The phone calls the server itself, and nothing about the photo passes through ElevenLabs.** The
  agent has no camera tool and no upload tool; the button does the whole of it (`use-photo-sending.ts`,
  and the flow in `photo-sending.ts`). The slot request and the upload go to the address sir typed
  (`jarvis-server.ts`), and of the server's answer only the path is used, and only when it is exactly
  the upload route and a 22-character token (`photo-upload.ts`) — so nothing the server says, or
  anything pretending to be it, can send sir's photo to another host. The agent is given only the
  name the photo was filed under.
- **A slot is opened only for a live conversation, and the upload asks for no key.** Both routes sit
  behind the Cloudflare Access bypass for `/api/photos/*`, since the phone holds no Access service
  token, so anyone can reach them. The slot request carries the conversation's ElevenLabs id (the
  session's `liveConversationId`), and the server asks ElevenLabs whether that conversation is in
  progress on Jarvis's agent before it opens one (`.claude/rules/mcp-vision-vertical.md`, "Vision"). The slot's token is 128
  random bits that go straight from the server to this phone and nowhere else, which is all the upload
  asks for. The id is read at the tap, while the conversation is certainly live: the call may drop
  while sir frames the shot, and the slot, open for five minutes, outlives that.
- **The phone's own camera app takes the photo, and `CAMERA` stays blocked.** Summoned, the
  conversation is drawn in the assistant's window, which has no activity — and expo-camera's view
  and the image picker both need one, as does a runtime permission prompt. So `JarvisPhotoActivity`
  (in `modules/jarvis-assistant`) hands `ACTION_IMAGE_CAPTURE` to the camera app for one shot, into a
  file lent through `JarvisPhotoProvider`, and hands back a JPEG no longer than 1600 px, turned
  upright. `ACTION_IMAGE_CAPTURE` needs no permission from an app that does not declare `CAMERA`,
  and throws for one that declares it without holding it, which is why the block in `app.config.ts`
  must stay; `take-photo.contract.spec.ts` holds it there.
- **The window steps aside, and comes back only to a conversation.** The assistant's window is
  above every app, the camera's included, so it is put away while the photo is taken — with React
  Native left running, so the conversation is kept alive and the photo sent the moment it exists —
  and `returnFromTheCamera` brings it back only if the conversation lived through the photo. Brought
  back to one that had ended, the showing would have started a new conversation with a greeting.
  The photo activity runs in a task of its own, so it never brings the app's own activity forward
  behind it.
- **Every tap ends in one thing said, and never in the server's words.** A camera closed without a
  photo is a note that takes no turn (`CAMERA_CLOSED`). A photo that could not be sent is said as
  sir's turn, `photoNotSent(reason)`, so Jarvis tells him out loud rather than leaving him waiting,
  with one of five fixed reasons the phone picks from what happened (`PHOTO_PROBLEMS` in
  `photo-messages.ts`): a photo taken or picked that could not be read — a HEIC a desktop browser
  cannot draw, a JPEG the camera app left that could not be decoded or read back — is "it could not
  be read as a photo", and never a camera closed, since sir did send something (the camera's answer
  says which, `CameraAnswer` in `platform-contracts.ts`, and `JarvisPhotoActivity` answers
  `NOT_READABLE` rather than nothing); a `403` in the server's own envelope, or a session with no id
  to give, is "this conversation could not be confirmed as live"; a `503` in its envelope is "photo
  uploads are switched off on the Jarvis server"; a `413` is "it was larger than a photo can be"; and
  anything else — no network, a server that did not answer in time, a `5xx`, Cloudflare Access's own
  pages, a sign-in page answered as a `200` — is "the Jarvis server could not be reached". Nothing a
  response said is repeated, to the agent or in the phone's log, which gets a description in the
  phone's own words and names Cloudflare Access when a refusal was not the server's.
- **Nothing is waited on for ever.** The camera app is given up on after 110 s (timed on the main
  looper, since JavaScript's timers stop behind the camera), well inside the five minutes the slot
  opened at the tap stays open, and a browser's picker after the same 110 s
  (`PICKER_GIVE_UP_AFTER_MS` in `take-photo.web.ts`, which `take-photo.contract.spec.ts` holds to the
  Kotlin): a browser answers nothing while its picker stays open and cannot be made to close it, so
  the picker is then taken as closed and taken off the page, and a file picked after that is not
  sent. The slot request is given up on after 20 s (`PHOTO_SLOT_WAIT_MS` in `photo-upload.ts`), and
  the upload after 30 s plus the time its bytes take at 64 kbit/s (`PHOTO_UPLOAD_WAIT_MS` and
  `MIN_UPLINK_BYTES_PER_MS`) — a photo of a few hundred kilobytes on weak coverage takes longer than
  a fixed 30 s to send, and React Native's `fetch` reports no upload progress to wait on instead, so
  a megabyte is given 161 s. Each is an `AbortController` and a `setTimeout`, because React Native's
  `fetch` on Android waits on OkHttp with every timeout off, and a request the network swallowed
  would hold the button busy, and Jarvis waiting, for the rest of the call; the log says how long it
  waited. The slot's own wait is counted from the tap, on timers that stop behind the camera, so
  `photo-sending.ts` also gives a slot still on its way when the camera closes 20 s more at most.

**It speaks into the session every device holds, and hands it nothing.** The camera is made after
`useJarvisSession` and uses only what the session offers any screen: `status`,
`liveConversationId()`, `sendContextualUpdate` for notes that take no turn, `sendText` for what takes
one, and `sendUserActivity`. `sendText` and `sendUserActivity` are ignored unless the conversation is
connected, and a note said before then waits until it connects (the button is only there once it
has). The session dials with no client tools at all. The live line to the server also carries the
`affectedEntities` frames the server broadcasts, which the phone simply ignores (see
`.claude/rules/hologram.md`).

**The button.** A small outline of a camera at the sphere's lower right, half strength, drawn from
views (no icon library, and no Skia before CanvasKit has loaded in a browser). It is there only while
a server is set and he is connected, past the greeting and settled, not held in writing on a phone,
and neither thinking nor speaking — a photo arrives as sir's turn, and a turn in the middle of one
cancels a request or cuts off an answer — and not while its camera is open or its photo on the way.
The camera opens on the tap itself, before anything is awaited, because a browser only opens its
picker inside the gesture; the slot request, the note to the agent and the first `user_activity`
follow in the same tap.

**The call is not hung up on while sir frames the shot.** A finished request is ended by the agent
itself, after its `turnTimeout` (see `.claude/rules/hologram.md`). The note that the camera is open
(`CAMERA_OPENED`) is what the prompt waits on instead, on a device that has said it has a camera
button (`CAMERA_BUTTON_HERE`): asked to speak again before the photo has come, before a message that it
did not reach him (`photoNotSent`), before the note that he closed the camera without one
(`CAMERA_CLOSED`) and before he says it is not coming, the agent calls `skip_turn`, never `end_call` —
whatever else he says meanwhile. The same wait follows his saying he is about to send one; the wording
is in the prompt, both tool descriptions and routing, in the same words. `user_activity` is sent in the
tap, beside that note, and then every five seconds while the camera is open or the photo on its way,
because ElevenLabs ends a call a while after the user last spoke and `user_activity` may hold that off.
ElevenLabs does not document that it does: whether it does, and whether it covers the time behind the
camera app, where JavaScript's timers stop, is still to be checked on a device.

**What is done with a photo is sir's to say, and he need not say it first.** The turn a photo arrives
in (`photoSent`: "I've sent you a photo (photo photo3).") says only that it has arrived, naming it the
way the routing names a photo. The agent's prompt decides from what sir has said: if he said what he
wants done with it — before sending it or with it — that is routed with the photo named; if he said
nothing, the agent routes a look at it, the routing plans a vision task that says what it shows and
what could be done with it, and its closing report has Jarvis say so, ask sir what he would like done
with it, and wait (`.claude/rules/mcp-routing.md`, "Routing"). It used to ask first and route only the answer; a
photo sent with nothing said is now looked at at once, since that is what sending it means.

**A photo is not lost with the conversation.** If the call drops while sir frames the shot, the photo
is still sent, to the slot opened at the tap, and the server keeps it as one nobody has looked at yet;
routing brings it up in the closing report of a later request — in any conversation, on any device —
the way it brings up earlier work still waiting on him (`.claude/rules/mcp-vision-vertical.md`, "Vision" and "Routing"). What
the phone never does is tell a later conversation about it: each conversation is numbered as it ends,
and a photo in flight speaks only into the one it was taken in.

**Only the phone offers it, and only with a server.** Once connected, a phone with a server address
tells the agent once that there is a camera button here (`CAMERA_BUTTON_HERE`, a contextual update);
the prompt counts photos as possible only where it has heard that, and otherwise tells sir to send it
from his phone. The watch, the headset and the voice firmware say nothing of the sort, and have no way
to send one.

**An address changed on the settings screen reaches the next conversation.** The session is the
conversation screen's and ends with it, so holding the screen to reach the settings ends the
conversation, and the screen it returns to opens a new one — told of a camera button, or not, to
match. The address is also read again on every summoning after the first (`app.tsx`), because the
assistant's window is kept between summonings and the address is as often set in the app's own window.

**An address that cannot be read is tried again, and never erased.** It is read beside the ElevenLabs
settings, from the same keystore at the same moment, so it fails when they do — in a window the
system has only just made. `loadJarvisServerAddress` says `unreadable` rather than "none", and it is
retried as the settings are (`read-again.ts`); only an address that still cannot be read is no
address, and the camera stays off. The settings screen then starts the field empty, so it writes the
address only if sir changed the field: saving an untouched one would erase an address that had only
failed to load.

**The words and the paths are held to the other packages that read them.** `photo-messages.ts` is the
whole of what the phone says, and `photo-messages.contract.spec.ts` holds it to the prompt that quotes
it and to the routing planner that names photos the same way; `photo-upload.contract.spec.ts` holds
the slot path and the upload path's shape to the server's routes and to how it mints a token.
