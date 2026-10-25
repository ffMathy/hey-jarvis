---
paths:
  - "hologram/**"
---

# Tilt to look around, on the phone

> Part of [Hologram](hologram.md). Paths in it are relative to `hologram/` unless they say otherwise.

`tilt.ts` turns the phone's gravity — Reanimated's GRAVITY sensor, read every
`TILT_SENSOR_INTERVAL_MS` — into where the eye is round him (`tiltFront`) and how
far away it is (`tiltEyeSquares`), for a body drawn in three dimensions. It is
built like the frame clock: one state made once (`createTiltState`), stepped once
a frame inside `modify` with the reading as positional arguments
(`advanceTilt`), and put back as new on coming to the foreground (`resetTilt`);
it allocates nothing, and the front is written into the state's own array.

- **A phone held still shows him straight on.** The rest pose follows gravity
  over `TILT_REST_SECONDS`, so only a change of how it is held turns him, for a
  moment.
- **The turn from rest becomes a tip and a swing**, less a soft deadband, no
  further than `TILT_LARGEST_DEGREES` round him, eased over `TILT_EASE_SECONDS`.
  Gravity cannot see a turn about the vertical, so on an upright phone looking
  sideways is the steering-wheel roll.
- **Not while he listens.** The step takes the frame clock's `hearing` and scales
  the tilt down by it: the listening lattice snaps in the plane facing the eye,
  and about 7% of its lit fragments jump to another knot for every degree the
  view turns.
- **No reading, a reading that is not a number, or a phone on its side** sends
  the eye back to the front, and the next usable reading is the new rest pose, so
  nothing jumps when readings come back.
- **The eye is `PHONE_EYE_DISTANCE` of his resting radii away while readings
  arrive**, and infinitely far — a flat projection, straight on — while none do,
  eased between the two over `EYE_DISTANCE_FADE_SECONDS`. The watch and a desktop
  browser never step it, and stay infinitely far.
- **It is handed out in sides of the drawing's square** (`PHONE_EYE_SQUARES`), the
  unit `placeFlatCamera` takes it in, so that as he swells with his voice he grows
  towards the eye rather than the eye backing off with him. The camera draws an eye
  `ORTHOGRAPHIC_EYE_DISTANCE` radii off or further flat: float32 depth cannot hold
  one that far, and the fade back out ends on a remainder that puts it there.

The view steps it only while the GPU draws the body and its `tilt` prop is set,
from `TiltSensor` (`tilt-sensor.tsx`): Reanimated's GRAVITY sensor at
`TILT_SENSOR_INTERVAL_MS`, mounted only while the app is in front and the GPU
body's view is there, since nothing else unregisters it. Unmounting clears
Reanimated's own copy of the last reading as well, which it keeps for the life
of the app and would otherwise hand the next arrival as its rest pose: he would
arrive turned by however far the phone moved while he was away, and drift back
over seconds. Each frame the view hands the reading over as the sensor gave it
(`advanceTiltBy`), and `tiltedView`, in `hologram/gpu`, turns the tilt into what
`placeFlatCamera` takes: its front, taken as the eye's direction in the body's
own frame, gives the view basis (`viewBasisTowards`), and `tiltEyeSquares` the
eye's distance. `tilted-view.spec.ts` holds that chain to the gestures through
the camera — the top edge going away brings his top nearer the eye, a wheel
turned left his left — so a sign flipped or a pair of axes swapped on the way
fails there rather than on a phone.

`tilt.spec.ts` holds it to that on gestures stepped at 60 and 120 frames a second.
How it feels — the sign of each gesture, the gain, the deadband — is a device's to
judge.
