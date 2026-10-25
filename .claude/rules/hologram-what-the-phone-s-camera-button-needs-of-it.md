---
paths:
  - "hologram/**"
---

# What the phone's camera button needs of it

> Part of [Hologram](hologram.md). Paths in it are relative to `hologram/` unless they say otherwise.

Only the phone can show Jarvis something: its camera button takes a photo and sends it to sir's own
Jarvis server, and everything about that — the button, the upload, the notes and messages the agent
is sent — is the phone's ("Showing him something" in `.claude/rules/mobile-showing-him-something.md`). The agent has no client
tool for it, so no device answers one (no device registers any client tool), and the watch and the
headset hold nothing for the camera at all. What the session gives the phone is general, and three things:

- **The live conversation's id** (`liveConversationId()`, on `JarvisConversation` too). The server
  opens an upload slot only for a conversation ElevenLabs says is in progress on Jarvis's agent, so
  the phone sends it this id when sir taps the button. It is the SDK's own `getId()`, read once,
  when the conversation is handed over — by then it is final on both transports: a socket takes it
  from `conversation_initiation_metadata`, and WebRTC reads it out of the LiveKit room's name before
  the start resolves. It is given only while the summoning under way is connected, so an ended
  conversation's id never is, and only when it looks like an ElevenLabs id (`conv_…`): where a
  room's name holds none, the SDK falls back to the name itself or a `room_<ms>` of its own making,
  which the server could only refuse. It is a method rather than part of the snapshot because it is
  read at the tap, and nothing on a screen is drawn from it.
- **`sendContextualUpdate`**, a note the agent reads without a turn being taken: that this device
  has a camera button, that sir has opened the camera, or that he closed it without a photo. The
  phone's notes carry no context id. (What sir points at on the headset goes to the server, not the
  agent: "What he is working on, and what sir points at".)
- **`sendUserActivity`**, which says sir is still there while he frames a shot. It holds nothing
  open: a quiet call is still the agent's to end (see above), and ElevenLabs does not document user
  activity as holding off either its turn timeout or its silence timeout. What keeps the agent from
  hanging up on the camera is its own rule, that a photo it is waiting for gets `skip_turn` ("Hanging
  up when he goes quiet" in `.claude/rules/elevenlabs.md`).

The photo goes to the server, never through the session; what goes through it is the message that
names the photo once it has arrived, or says why it did not, as a user message through `sendText`,
which takes a turn so that Jarvis answers it at once. `sendText` and `sendUserActivity` do nothing,
and the id is `undefined`, unless the summoning under way is connected; a note said before then
waits for it, as every contextual update does, though the phone only says one while connected —
`jarvis-session-conversation.spec.ts` pins the three above.
