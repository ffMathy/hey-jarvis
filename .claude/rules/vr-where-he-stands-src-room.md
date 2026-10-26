---
paths:
  - "vr/**"
---

# Where he stands (`src/room/`)

> Part of [VR](vr.md). Paths in it are relative to `vr/` unless they say otherwise.

When he is summoned, `src/room/` chooses the spot: in front of you, in the same
room, with space around him and nothing between him and your eyes. It works from
whatever the headset shares — Space Setup's planes (every Quest), its furniture
boxes and room scan (Quest 3 and 3S), or nothing at all — and from a few live
depth rays.

```
src/room/index.ts               the module's surface
src/room/types.ts               snapshots, requests and placements: plain data, postable to a worker
src/room/room-snapshot.ts       reads planes and meshes out of an XR frame; counts reference-space resets
src/room/occupancy-grid.ts      10 cm cells, an exact distance transform, Amanatides–Woo line of sight
src/room/scene-geometry.ts      poses planes and meshes, and draws them into the grid
src/room/room-scene.ts          the grid, floors, ceilings, wall outline and table tops, built from a snapshot
src/room/placement.ts           candidates, rules, scores and the relax chain
src/room/room-model.ts          createRoomModel: the same, on the calling thread
src/room/room-model-worker.ts   createRoomModelWorker: the same, from a worker
src/room/room-worker*.ts        the worker, its message protocol, and its time-sliced host
src/room/synthetic-rooms.ts     rooms built by hand, for the specs only
src/room/sem-room.ts            @iwer/sem's captured rooms as snapshots, for the specs only
src/app/room-placement.ts       the room's placement port over the model: when to read the room
```

**Reading the room.** `createRoomTracker(referenceSpace).take(frame)` must be
called inside an XR frame callback. Each call re-reads every pose, but copies a
plane's or a mesh's vertices again only when it really changed, and returns the
previous snapshot itself when nothing did — so `snapshot !== last` says whether to
send it on. `app/room-placement.ts` calls it every 300 ms and in the frame a summon
waits on, gives up on a placement after 5 s (the room then uses its fallback
spot), and keeps the room's description for the HUD. Two things it has to see
through:
- **The emulator marks everything changed on every frame.** IWER sets
  `lastChangedTime` on every plane and mesh each frame. A moved change time is
  checked against the copy — a mesh handed over in the very arrays last copied
  counts as unchanged — before anything is copied.
- **A recentre moves every pose without saying so.** `local-floor` fires `reset`,
  and no `lastChangedTime` changes. `watchResets` counts the resets, and the count
  is the snapshot's `epoch`: a new epoch reuses nothing, the worker makes questions
  wait for the new grid, and a `previous` spot from an older epoch (the adapter
  passes `previousEpoch`) is ignored.

Features the session was not granted read as empty (Chromium throws
`NotSupportedError` otherwise). Plane normals may point either way — the captured
rooms turn floors upside down — so only the normal's axis is used, never its sign.

**The grid.** 10 cm cells around the geometry, capped at 10 m from the session's
origin. Planes are drawn as two sheets 5 cm apart, so a wall at an angle to the
grid leaves no gap for a line of sight; furniture boxes are filled solid; the room
scan's triangles are sampled every 5 cm. An exact Euclidean distance transform
(Felzenszwalb–Huttenlocher, three passes) then gives every cell its distance to
the nearest occupied one. Clearance is read from it, less half a cell, so it errs
towards too little room.

**Choosing.** Candidates fan out ±35° ahead along the floor (ahead of the gaze, or
of the controller ray that summoned him), 0.9–2.6 m away, at
clamp(eyes − 0.15, 1.1, 1.6) m above the floor and a few heights either side. Hard
rules: the clearance the level asks for, inside the room (the floor polygon under
the head, else the ceiling over it, else the walls around it), clear of the user's
body, not behind a surface a depth ray sees, and a clear line of sight from 20 cm
past the eyes. The rest are scored on clearance (up to 1 m), distance from 1.6 m,
angle from ahead, height, and closeness to where he stood last time. When nothing
qualifies, the rules relax in turn:

| Level | Radius | Clearance | Distance | Cone |
| --- | --- | --- | --- | --- |
| `full` | 0.22 m | 0.5 m | 0.9–2.6 m | ±35° |
| `tight` | 0.22 m | 0.35 m | 0.9–2.6 m | ±35° |
| `small` | 0.13 m | 0.3 m | 0.6–2.6 m, and over table and desk tops | ±35° |
| `wide` | full size, then squeezed | as `tight`, then `small` | as above | ±60°, `needsPointer` |
| `fallback` | 0.13 m | — | 1.2 m ahead, pulled in front of anything known | straight ahead |

With nothing known about the room at all it goes straight to `fallback`: a
full-size hologram 1.6 m ahead of someone at a desk facing a wall a metre away
would be inside the wall. A depth probe rejects a spot when its ray passes within
the level's clearance of it and the hit is nearer than the spot; hits under 0.4 m
are ignored.

**Off the main thread.** `createRoomModelWorker` builds each snapshot's grid in the
worker in 8 ms slices, answering `place` meanwhile from the grid it built last. It
waits instead before the first grid and after a recentre. A snapshot that arrives
mid-build waits its turn, so a room that keeps changing still gets built. If the
worker cannot start or fails, placement carries on in the page. Every room entered
gets a model of its own, since the snapshots are in the session's reference space.

**How long it takes.** The captured living room — 17 planes, 8 boxes, a
62,102-triangle scan — builds in about 40 ms warm in Bun (140–240 ms cold in
Chromium, 40–60 ms warm), and a placement takes about 1 ms. `sem-room.spec.ts`
prints the numbers on every run and fails above 250 ms and 5 ms, limits that leave
room for a busy machine.

**Tests.** `placement.spec.ts` covers hand-built rooms: an open living room, a desk
facing a wall, a wardrobe ahead, two rooms joined by a doorway, planes or boxes or
a scan alone, nothing at all, a room divider, depth rays, recentring and
hysteresis. `sem-room.spec.ts` places him in all five of `@iwer/sem`'s captured
rooms, facing eight ways in each. `tests/e2e/room-placement.spec.ts` does it from
the emulated Quest's real XR frames in the browser.
