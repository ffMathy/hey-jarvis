---
paths:
  - "hologram/**"
---

# What he is working on, and what sir points at: the line to the server

> Part of [Hologram](hologram.md). Paths in it are relative to `hologram/` unless they say otherwise.

**Neither goes through the voice agent.** The session dials with no client
tools at all, on any device. Both travel over the WebSocket each device keeps
open to sir's Jarvis server for as long as its app runs, across conversations
and between them (`jarvis-server-link.ts`; the server's end is
`mcp/mastra/verticals/api/live-socket.ts`). The line knows nothing of
conversations: `connectToServer` opens it — with the JWT for the Cloudflare
Zero Trust application in front of the server on the upgrade request, as
`Authorization: Bearer` and `cf-access-token`, when the device has one
(`serverAuthorizationHeaders`; React Native's `WebSocket` takes headers, a
browser's cannot, so the headset and the phone's web build connect without
them) — says `hello` with the device, and
tries again after a drop until it is closed. The phone and the watch hold it
from their app component (`useJarvisServer`, in `hologram/react/lifecycle`), and
the headset's page opens it once as it loads and hands it to each session. A
device with no server address has no line, and loses nothing but these two.

**What a request touches comes from the server.** As soon as a tool in a request
reports what it read or changed, the server broadcasts
`{"type":"affectedEntities","entities":[{"id":…,"name":…}]}` to every socket that
has said hello, and `readServerMessage` hands it to every listener the line has
(`ServerLink.subscribe`) as a `JarvisServerMessage`. The phone and the watch
listen to nothing, and the headset's session listens for as long as it lasts,
recording the entities and lighting them up where they stand. An entity is `{ id, name? }` (`affected-entities.ts`). The id is
**opaque** — a Home Assistant light, an email inbox, a calendar, whatever an
agent reports — and is compared, never parsed; the name is for display only. The
frame comes over the network from outside the device, so `affectedEntitiesOf`
reads it strictly: the declared shape only, each value trimmed and non-empty, an
id of at most 200 characters and a name of at most 120, no more than 50 per
message, each id once, and anything else left out. A frame that names nothing
usable is dropped.

**Which agents are at work comes from the server too.** As a request's plan names
each delegation, its agent starts, calls a tool, stops to ask, and answers or
fails, the server broadcasts
`{"type":"agentActivity","delegationId":…,"agentId":…,"state":…,"glyph":…}`, the
state one of `planned`, `working`, `tool` (a moment: still working after it),
`asking`, `answered` and `failed`, and the glyph the SVG path its agent's
vertical on the server draws it with (`mcp/mastra/verticals/agent-glyphs.ts`).
`agentActivityOf` (`agent-activity.ts`) reads it as strictly as an entity: both
ids opaque, trimmed, non-empty and at most 200 characters, the state from that
list, a glyph of at most 1000 characters made only of the path commands M, L, H,
V, A, C, Q and Z and numbers (`DRAWABLE_GLYPH`), and anything else dropped — a
glyph on its own, the message without it.

Every device that shows them shares one lifecycle, `agent-work.ts`: a satellite
per delegation, dim while planned, lit while working, flaring on each tool call,
pulsing while it asks, folding into him when it answers and drifting out when it
fails; gone after 90 s without news, at most 8 at once. It says where each is as
a place on a tilted ring of radius 1 (`satelliteOrbits`, `orbitPoint`), and each
device scales that to his size and adds its own clock, so they go round as
smoothly as that device draws him. The headset draws them in the room
(`vr/src/hologram3d/satellites.ts`); the phone and its web build draw them on the
screen, in the same picture as him (`satellite-drawing.ts` says where each is
and how lit, dimmer and smaller passing behind him, and `gpu-picture.ts` draws
the glyphs as strokes on the GPU). On the phone,
`useJarvisServer` returns the line, `useAgentSatellites` (in
`hologram/react/lifecycle`) works the satellites out on the JS thread every
`READ_INTERVAL_MS` into a shared value, and `JarvisHologram` draws whatever its
`satellites` prop, or the nearest `AgentSatellitesContext`, holds. The watch
holds the line and shows none.

**No device knows any agent's glyph.** Each vertical on the server declares its
own, in its `glyph.ts`, and it comes with every message, so a new agent needs no
change on any device. A satellite whose messages brought none is a plain ring
(`PLAIN_RING_GLYPH`). A glyph is an SVG path in glyph radii — it fits the circle
of radius 1 — with y down, drawn as round-capped strokes `GLYPH_STROKE_WIDTH`
wide: on the phone flattened into runs once for each glyph a satellite is
given (`picture-glyphs.ts`, which draws a path it cannot read as the plain
ring), and by a 2D canvas into the headset's glyph atlas. Sample mode's three pretend agents have made-up glyphs of their own
(`SAMPLE_AGENTS`), since the real ones are only the server's. With `pretending`, the hook has sample mode's
three pretend agents at work (`pretendWork`), so they can be seen with no server.

**What sir points at goes to the server.** `ServerLink.point(entity)` sends `{"type":"pointing","entity":{…}}`, or `"entity":null` for
nothing, held to the same limits (`affectedEntityOf`). Only the latest is kept:
it is sent once the server has said `ready`, at once if it already has, again
after every reconnect's `ready` (the server keeps the latest per socket, and a
new socket starts with none). The server writes it into every request it
routes, as `(pointing at "<name>", id <id>)`. Only the headset points at
anything.

**`sendContextualUpdate(text, contextId?)` tells the agent something without
asking it anything** — on the phone, what its camera button is doing (see "What
the phone's camera button needs of it"). It is sent while connected (not only
live: a browser's conversation is up behind the greeting), in a `try`, since a
socket that is going throws. Before that, the latest update for each context id,
and every update said without one, waits for the summoning under way and goes
the moment it connects, before the phase moves to `live`, so anything the holder
says on `live` lands after it; whatever is waiting when the summoning ends is
dropped, and with no summoning under way nothing is kept. The server keeps only
the newest update for a context id, which is what the ids are for, and every
update without one, which is why none of those replaces another while it waits.
No device says anything about itself on connecting.
