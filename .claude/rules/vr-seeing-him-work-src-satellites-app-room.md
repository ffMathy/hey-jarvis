---
paths:
  - "vr/**"
---

# Seeing him work (`src/satellites/`, `app/room-satellites.ts`, `hologram3d/satellites.ts`)

> Part of [VR](vr.md). Paths in it are relative to `vr/` unless they say otherwise.

The phone and its web build show the same satellites round the sphere on the screen, from the same
lifecycle in `hologram` (`agent-work.ts`; see `.claude/rules/hologram.md`). What is the headset's own is
where they are in the room (`satellites/satellite-spots.ts`) and how they are drawn there.

While a request runs, each of the agents it uses circles him as a small glyph of its own — the SVG
path its vertical on the server declares (`mcp/mastra/verticals/<vertical>/glyph.ts`), sent with
every message: a sun for the weather, a page for the calendar, an eye for vision and so on, and a
plain ring for an agent whose vertical draws none — so a pause while he thinks reads as work under
way rather than silence.

**The glyph atlas** (`hologram3d/glyph-atlas.ts`). A glyph arrives as a path, so it cannot be
written into the shader: the page strokes it once with a 2D canvas's `Path2D` — white, round-capped,
the phone's stroke width — into one of eight 128-pixel slots side by side in a mipmapped texture, and
the satellites' shader reads its slot's coverage and tints it in his colours. A glyph keeps its slot
while any satellite wears it, and a new one is drawn into a slot no glyph still wanted holds
(`assignGlyphSlots`, pure and pinned by its spec).

The server says where each delegation has got to in an `agentActivity` message on the line the page
keeps open (`hologram`'s `agent-activity.ts`; the server's side is "What a request touches" in
`.claude/rules/mcp.md`), and `hologram`'s `agent-work.ts` — the lifecycle the phone shares — turns that into satellites, purely:

| Message | Satellite |
| --- | --- |
| `planned` | comes out dim (`PLANNED_BRIGHTNESS`) on the orbit, in the widest gap of the ring |
| `working` | lit |
| `tool` | lit, and flares — a hot ring going out from the glyph — for `FLARE_SECONDS` |
| `asking` | lit and pulsing, held for as long as it waits on sir |
| `answered` | its orbit closes on his centre over `FOLD_SECONDS`: it folds back into him |
| `failed` | drifts outwards and goes out over the same time, never reaching him |

The orbit is `ORBIT_RADII` of his radius, tilted `ORBIT_TILT_RADIANS` off level so they pass in front
of him and behind, and goes round once in `ORBIT_SECONDS`; the satellites ease to even spacing as
they come and go. At most `MAX_SATELLITES` are out. One with no news for `STALE_SECONDS` (but one
asking) goes out as failed, so a lost message never leaves one circling, and the end of the
conversation folds every one in. A message that comes while he is not in the room is still taken in
— a request asked on the phone has satellites too — but nothing is drawn without him to circle.

The room queues each message and takes it in at the start of the next frame, so every time in the
state is the XR frame's (`app/room-satellites.ts`). They are drawn as his coronas are: one instanced
draw of view-facing quads, Screen-blended in his stroke colours, no depth, never under
`MIN_APPARENT_RADIUS_DEGREES`, after the coronas and before the panels. Sample mode's thinking has
three pretend agents at work (`pretendWork`), taking turns to call a tool, so they can be seen without
a server; they answer when it stops. `window.__jarvis.satellites` lists each one's agent and status.
