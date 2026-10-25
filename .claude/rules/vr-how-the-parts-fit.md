---
paths:
  - "vr/**"
---

# How the parts fit

> Part of [VR](vr.md). Paths in it are relative to `vr/` unless they say otherwise.

`main.ts` is the one place that chooses them. The room (`app/room-runtime.ts`)
knows each other module only through `app/ports.ts`, which names the few calls it
makes of each — the wake engine, the session and the hologram fit their ports as
they are; placement has an adapter (`app/room-placement.ts`), because the room
model answers from a worker and has to be fed snapshots only an XR frame can take.

**What loads when.** The page itself, the wake engine and the greeting's player
are in the first chunk, because the page needs them from its first frame: the
models load and warm up while the user reads, and the Enter tap has to reach the
engine and the player before it awaits anything. The room — three, the hologram,
the placement client — and the ElevenLabs SDK with LiveKit (about 600 kB of their
own, in a chunk of their own) are loaded apart, but started at once rather than
on the tap, so they have usually arrived by the time someone finds the button.

**The Enter tap**, in this order and before anything is awaited, because each of
these is only allowed while the tap's activation lasts:

1. the app's AudioContext is created or resumed (his voice is analysed on it);
2. the greeting's player is primed — an element that has played inside a gesture
   may play again outside one, and the greeting starts long after the tap;
3. the wake engine is started, creating its 16 kHz AudioContext — on the stream
   the microphone step opened and kept, when there was one; when the permission
   was already granted there was no such step, a stream is opened now, and the
   engine starts once it arrives (Chromium allows that after any tap on the page,
   and the watchdog would ask for a select otherwise);
4. the immersive session is requested.

**A summon**, from the wake word or a select: the next XR frame reads the room and
the depth probes and asks for a spot; he is drawn there at once and anchored in
the same frame; the session starts the greeting and the token request together,
and dials once the greeting is over. **The wake word is armed again only once his
voice has been quiet for two seconds** (`session.quietFor(2)`, which the room
reports to the state machine as `voice-quiet`): it listens through microphones a
few centimetres from the speakers his voice comes out of.

**When the session ends**, the room stops the wake engine *before* it stops the
microphone's tracks: the engine's watchdog would see the tracks end and open the
microphone again.
