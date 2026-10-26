---
paths:
  - "vr/**"
---

# Entities placed in the room (`src/entities/`, `app/room-entities.ts`, `hologram3d/corona.ts`)

> Part of [VR](vr.md). Paths in it are relative to `vr/` unless they say otherwise.

An entity is whatever an agent behind the conversation read or changed for sir — a Home Assistant
light, an email folder, a calendar — pushed by the Jarvis server in an `affectedEntities` frame over
the socket the headset holds open during a conversation, as an opaque id, which may come from any
agent and is never parsed, and an optional display name. The MCP side decides what a request
touches and broadcasts it (`.claude/rules/mcp-routing-affected-entities.md`, "What a request touches"), and `hologram` reads the
frame (`jarvis-server-link.ts`, validated by `affected-entities.ts`); the phone and the watch ignore
it. This app keeps them, lets sir put them in the room, lights them while Jarvis works on them, and
tells the server what sir points at.

```
src/entities/registry.ts        every entity ever marked, and where each placed one is kept (localStorage)
src/entities/sample-entities.ts made-up entities to try placing with, in a registry of their own
src/entities/room-anchors.ts    a few persistent anchors, placements as offsets from them, restored each session
src/entities/affected.ts        how long a corona stays lit
src/entities/pointing.ts        what sir points at, and what the Jarvis server is told about it
src/entities/hand-pose.ts       pinches, pointing fingers and a raised wrist, from joints
src/entities/grab.ts            taking a token near or far, carrying it, putting it down or back
src/entities/entity-input.ts    one frame's hands and controllers, as grabbing, pointing and the wrist button read them
src/app/room-entities.ts        the room's controller: all of it, every frame
src/hologram3d/corona.ts        Jarvis's light round an entity, one instanced draw
src/ui3d/drawer-layout.ts       where everything on the drawer is (entity-drawer.ts draws it)
src/ui3d/entity-tokens.ts       the orbs, entity-labels.ts their names, pointing-reticle.ts, wrist-button.ts
```

**The registry** (`jarvis.horizon.entities`, version 1) keeps every entity ever marked, at most
300, and never forgets a placed one; every `affectedEntities` frame is recorded whatever the room is
doing. An id is any string the server sent, `__proto__` and `constructor` included, so entries are
read only as the object's own (`knownEntity`, `hasAnchor`) and defined, never assigned, even when
parsed. It is written half a second after a change, and at once when placing things ends, when the
room closes and on `pagehide`. A placement is an offset in the space of one of at most four
persistent anchors, because `local-floor` starts somewhere new every session: a drop reuses a
located anchor within 2.5 m, otherwise makes a new one while the budget lasts, and falls back to
the nearest. A drop on a new anchor is kept at no offset from it, since the anchor was made at the
spot; a recentre before that anchor is found (the stage's reset epoch, passed in every frame)
leaves the drop's point naming a spot that has moved, so it is then kept on its own anchor or not
at all, never on another by that point. A handle the headset no longer lists makes its entities
"lost", and the drawer asks for them again. An anchor no placement uses is given back when placing
things ends — before the session is ended, since an ended one may refuse (`reduceApp` puts
`exit-xr` after every other effect) — and forgotten only once the headset has let go of it; one it
refused stays in the registry and is given back at the start of the next session, which restores
only the anchors placements use. Until its anchor is located, an entity is not shown and cannot be
pointed at: it may be in another room.

**The drawer** opens world-locked where sir faces, 0.42 m ahead and 0.3 m below the eyes, tilted to
face them like a lectern: hands have to reach it, and a board that followed the gaze would move away
from the hand reaching for it. It shows a page of twelve names, what still needs a place first
(never placed, or lost), a line for what just happened, the page buttons and Done, pressed by a
fingertip or by a select along a ray. Every entity has exactly one token: in its slot, or where it
stands in the room. **Taking one** is a pinch (joint distance, 1.5 cm on and 3 cm off — never the
`select` event, which Quest fires on release) or a controller's grip, within 5–6 cm of it; or, for
anything out of reach, a pinch or a trigger pull along the ray, after which it rides the ray to
where the depth hit test meets a surface (the thumbstick pushes it out or pulls it in) until the
next pinch or pull drops it. Let go in the room, it is dropped on the room anchors and written to
the registry; let go on the drawer, it goes back in. A drop still waiting on a new anchor that is
taken back, or dropped again, gives that anchor back — at once, or as soon as the headset hands out
its handle (`RoomAnchors.cancel`) — since no placement would ever name it. Tokens are drawn in the
accent, sir's colour, through walls, with names over the carried one and every placed one; no hand
meshes, since passthrough shows the real hands (and three's hand models load from a CDN). A token is
a disc and a ring turned to the eyes, and the reticle a ring, smoothed by the renderer's four
samples: at half a headset's density the emulator's pictures show no steps along them, so, unlike
his strokes and coronas, they are not distance fields.

**The wrist button**, for hands without a controller's A or X, stands off the back of a wrist
raised as if to read a watch (the back towards the eyes within 40°, 0.15–0.7 m from them), and is
pressed by the other hand's index tip; only while waiting or placing things. On the back and not
the palm, because Meta keeps a palm-up pinch for itself on both hands, and on the left it takes sir
out of the room.

**Pointing**, whenever sir is not placing things: on a phone a tap on the screen, nearest the
finger's line inside 6°, points at once and holds for 15 s (`tapPointing`); on a headset a
controller's ray, or an index finger in a point pose (index straight, the rest curled — a hand's system ray is there whether it points or not),
picks the placed entity inside a cone of 4° or 7° round it, after a 0.28 s dwell, with a 2° margin
before switching and a drop 0.2 s outside 1.5 times the cone; one beyond a controller's depth hit is
passed over. It is ringed in the accent with its name over it. The Jarvis server is told the entity
(`ConversationPort.point`, a `pointing` frame on `hologram`'s line) while the call is live — held for
15 s when it is not yet, since people point and then say "Hey Jarvis", and cleared (`point(undefined)`)
12 s after the pointing stops. The line outlives every conversation and remembers the last one, so the room
does too (`stepPointingUpdate`): the same target is never sent twice in a row, and one a new
conversation would inherit after it has gone stale is cleared the moment that conversation is live.
The agent hears none of it: the server writes `(pointing at "<name>", id <id>)` into each request it
routes. `agent-contract.spec.ts` reads the server's template and the routing planner's example as
text, and fails if the form the server writes and the one the planner is taught drift apart.

**The corona** (`hologram3d/corona.ts`, drawn in his palette on his thinking scan's rhythm, its
radius never under 1.5°, so never under 3° across) lights round a placed entity for at least 2.5 s
after it is marked, is held while he is thinking for up to 25 s after the last mark, and fades over
his leave time, or at once when the conversation ends. Sample mode's thinking mood lights every
placed entity: the corona without a call, and a beat for the demo.

**What the tests see:** `window.__jarvis.entities` — what is known, placed (with each anchor and
where it is now), lit and pointed at, what the server would be told sir points at
(`pendingPointing`), the drawer's slots and buttons with their positions, the tokens in hand, each hand and controller as placing reads it (pinch point,
grip, index tip, rays), the wrist button, and every anchor's state — worked out only when read. The
HUD has one `entities` line.
