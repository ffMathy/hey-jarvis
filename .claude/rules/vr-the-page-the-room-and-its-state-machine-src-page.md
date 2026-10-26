---
paths:
  - "vr/**"
---

# The page, the room and its state machine (`src/page/`, `src/app/`, `src/xr/`, `src/ui3d/`)

> Part of [VR](vr.md). Paths in it are relative to `vr/` unless they say otherwise.

**The page (`src/page/`) walks you to the room.** `index.html` is plain DOM in the
phone's colours (`ui3d/ui-colours.ts` names the same values), large enough to read
on Quest Browser's panel and to point at with a ray. The big button always names
the first step not yet done, so it is both the instructions and the way through
them: the key, getting ready, **Allow the microphone**, **Enter your room**.
`prerequisites.ts` decides this and `prerequisites.spec.ts` pins it.

- **The microphone is its own tap,** because Quest Browser cannot show its
  permission prompt inside an immersive session. The step opens the wake word's
  own stream (`page/microphone.ts`, with `src/wake/`'s permission check and
  microphone) and keeps it for the Enter tap. A refused microphone gets
  instructions for allowing it again.
- **Getting ready** runs the preparations `main.ts` hands over — today only the
  wake engine's `prepare`, since he is drawn with shaders that come with the
  room's code — with one progress bar weighted by what each fetches.
  A failure offers to try again, retrying only what failed.
- **Settings are the phone's,** under hologram's `ELEVENLABS_SETTINGS_STORAGE_KEY`,
  in `localStorage`. **Check and save** mints one token as `jarvis-vr` before
  keeping anything, so a mistyped key shows next to the field, not as an error
  panel in the room.
- **Two rooms need no key and no microphone:** **Try him in your room** (sample
  mode, which opens on the drawer of sample entities and brings him in when it is
  put away) and **Place entities**, which opens straight into the drawer and back to
  the page when it is done (`RoomMode` `'placement'`).
- **"His voice from where he stands"** is the headset's one setting of its own
  (`page/voice-setting.ts`, under `jarvis.horizon.voice-from-where-he-stands`):
  on by default, and read again on every Enter. Off keeps his voice on the
  headset whatever the headset could do.

**Everything in the room goes through one pure reducer (`app/app-state.ts`).**
Every event goes through `reduceApp(model, event, now)`: the wake word, selects
(already classed as tap or hold, and as on him, on the keyboard button or
elsewhere), B and Y, the conversation's phases and problems, his voice going
quiet, XR visibility, the session ending, the wake engine's health and the
keyboard. What comes out is a new model and a list of effects. Panels, the
hologram's visibility, the frame rate and whether the wake word is armed are
derived from the model and emitted as the difference between the view before and
after. The product rules pinned in `app-state.spec.ts`:

- **Dismissing:** a hold of 0.8 s or longer, or B/Y, hangs up. A tap during a call
  does nothing. A tap while he is leaving summons him again where he stands.
- **Failures:** the problem stays on a panel at his spot for max(6 s, reading
  time) or until a select. Then he leaves and the wake word is re-armed.
- **Re-arming:** only while waiting (or leaving towards waiting), in view, with the
  wake engine's health checked, and once his voice has been quiet for two seconds.
- **Visibility:** blurred keeps the call but ignores the wake word and selects, and
  a minute of it ends the call. Time spent with the system keyboard up does not
  count. Hidden ends the call quietly and disarms; coming back checks the wake
  engine before arming.
- **Session end:** hangs up, stops the microphone and brings the page back.
- **The hint** shows only when the wake engine is really listening, and only until
  the first summon. A status line shows whenever it is not listening.
- **Placing things (`editing`):** entered from `waiting` only — A/X, the wrist
  button — or straight from the page's **Place entities**, and left with B/Y, the
  same button again or the drawer's Done: back to waiting, or, in a room opened
  only to place things, back to the page at once — unless a drop is still waiting
  on its new anchor, when the room stays open (`keeping`, with "Keeping what you
  placed…" on the guide line) until the drop settles, or 11 s at most, since the
  frames that settle it stop with the session. Every select while editing is
  the placing's own, so a pinch never summons him, and since editing never opens
  over a call, a grab held for a second can never be read as the hold that hangs
  up. A select still held as it closes — the trigger or pinch that pressed Done
  on its way down — is spent (`consumeHeld` in `xr/select-gesture.ts`), so letting
  it go in the waiting room does not summon him either. The wake word is
  disarmed, the frame rate is the highest, and a guide line says what to do.

**`app/room-runtime.ts` is where the parts meet.** It opens the stage, queues
events so each step sees the model the previous one left, and carries out the
effects: it places him in the next XR frame (the head, the gaze or the ray of the
select that summoned him, the depth probes), anchors the spot, drives the
hologram from the conversation or from sample mode (`app/sample-driver.ts`, which
only remembers the mood and takes what it hands the hologram from hologram's
`createSampleDrive`, the code the phone's and the watch's sample hooks wrap), and
arranges the panels: what is about him is world-locked under him; the hint and
status line follow the gaze with a lag. A select also calls the wake engine's
`rebuild` when it needs a gesture to get audio going again, since a select is the
only user activation there is inside the room.

**The XR layer (`src/xr/`).**
- `xr-stage.ts` sets up the renderer (`RENDERER_PARAMETERS`: alpha, premultiplied,
  four samples a pixel; foveation 0.3), and the preview's renderers are made the
  same way. The samples are for the room's plain triangles — the tokens, the
  reticle, the arrow, a canvas's plane seen edge on — whose edges nothing else
  smooths; his strokes and his picture smooth themselves and are drawn
  exactly as before, since fragments are still shaded once a pixel, and the
  canvases' outlines are smoothed in their pictures (see "Text in the room" below).
  Meta recommends four samples on Quest's tiled GPUs as nearly free. With WebXR
  layers, three renders each eye into a four-sample target: straight into the
  projection layer through `WEBGL_multisampled_render_to_texture` when the GPU has
  it and the layer ignores depth, otherwise resolved into it by a blit at the end of
  the frame (the HUD's `gl` line says whether the extension is there). It runs one
  frame loop whose subscribers get the frame, the space, the viewer pose, the
  centre eye and a time step capped at 0.1 s. It also
  keeps the reference-space reset epoch, the visibility state and the frame rate:
  the lowest while waiting, the highest up to 90 while he is there.
- `xr-input.ts` turns selects into taps and holds, and reads B and Y (`buttons[5]`)
  and A and X (`buttons[4]`) from the gamepads each frame; `gamepad-buttons.ts`
  notices one press per source, for any button.
- `input-snapshots.ts` reads every hand and controller each frame: target ray and
  grip, a hand's 25 joints (`fillPoses`, declared locally since `@types/webxr`
  lacks it, or `getJointPose` where it is missing), a controller's trigger, grip
  and thumbstick, and how far along its ray a hit-test source of its own finds the
  room.
- `depth-probes.ts` is five viewer-space hit-test rays.
- `anchor-keeper.ts` creates an anchor in the placement's frame and deletes the
  previous one; his spot is never kept past its conversation. Placed entities have
  persistent anchors of their own (`entities/room-anchors.ts`).
- `origin-offset.ts` is the `?origin` test seam: `xr-stage.ts` hands out an offset
  reference space instead of `local-floor` (three draws from it too), so a session
  in the emulator starts somewhere new, as one on a headset does.
- `system-keyboard.ts` is a hidden `<textarea>`. Quest Browser shows its keyboard
  inside WebXR when the textarea is focused.

**Text in the room (`src/ui3d/`).** Panels are canvas-drawn text on planes at
1500 px per metre, which is about what a Quest 3 shows at arm's length, each with
a translucent backing so it can be read over any passthrough, drawn after
everything else and never hidden by his glow. Every canvas — panels, names, the
drawer, the keyboard and wrist buttons — goes through `ui-canvas.ts`: uploaded
premultiplied, as raw sRGB bytes, mipmapped and read trilinearly with the
renderer's most anisotropic filtering (handed in from `room-runtime.ts`, where the
renderer is known), half a mipmap level sharper than the display alone would ask
for, and drawn inside an eight-pixel transparent margin, so what ends a panel is
its picture's alpha, which filtering smooths, rather than the edge of its plane.
Without mipmaps, words shown smaller than their canvas skipped texels and broke
up; unpremultiplied, every outline had a dark fringe. There is also a drawn keyboard
button, a head-locked arrow for a spot out of view, the drawer, tokens, names,
reticle and wrist button of placing things (see "Entities placed in the room"),
and `?debug`'s HUD, whose
lines come from `describeDiagnostics` and are left out for parts with nothing to
report: the scene, XR and page visibility, the AudioContexts, the microphone's
permission and track, the wake engine's health and audio, the SDK's status and
mode, interruptions, half-duplex and the last error, the vad score, where his
voice comes from (its tier, why, what the microphone said about the echo
canceller, and the SDK's elements and their volume), the room's
planes, meshes, labels, triangles and grid, where he was placed, the entities
(known, placed, found in this room, anchors located, coronas lit, what is pointed
at), frame rates, his
CPU time and the main thread's share of it spent drawing his picture
(`picture`), the granted session features and the WebGL
extensions of interest.
