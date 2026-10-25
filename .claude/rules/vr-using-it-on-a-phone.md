---
paths:
  - "vr/**"
---

# Using it on a phone

> Part of [VR](vr.md). Paths in it are relative to `vr/` unless they say otherwise.

The same page works in Chrome on an Android phone with ARCore: **Enter your
room** opens the phone's camera as the room, and Jarvis stands in it on the
screen. The session says it is on a phone through `XRSession.interactionMode`
(`screen-space`; `isHandheld` in `xr/input-snapshots.ts`), and only what the
hands and controllers did changes:

- **A tap on the screen is the select.** It summons him and walks sample mode's
  moods; a press held for 0.8 s hangs up, as a held pinch does.
- **Pointing is a tap.** There are no hands in a phone's room to point with, so a
  tap on a placed entity points at it at once — ringed and named, and told to the
  Jarvis server as a pointed finger is — and holds it for 15 s
  (`TAP_HOLD_SECONDS`), long enough to tap the lamp and then say "Hey Jarvis,
  turn that on". A tap on an entity never also summons him or ends sample mode.
  Headsets keep pointing with a finger or a controller, and do not tap.
- **Placing things is a drag.** **Place entities** (or **Try him in your
  room**, with the samples) on the 2D page opens the drawer
  level with the camera and 0.7 m off, so it fits a portrait screen; touch a
  token, drag it to where it belongs — it sits where the line through your finger
  meets the room, from the transient-input hit test — and lift your finger to drop
  it. Drag it back onto the drawer to put it back. Tap Done to finish. There is
  no A/X or wrist button on a phone, so the drawer is opened from the page only.
  A phone's browser anchors a spot only for the session — it has no persistent
  anchors — so a drop is kept on an anchor of that session
  (`SESSION_ANCHOR_PREFIX` in `entities/room-anchors.ts`), and comes back as lost,
  for placing again, next time.
- **The hint and the guide** say "tap" and "drag" rather than "pinch".
