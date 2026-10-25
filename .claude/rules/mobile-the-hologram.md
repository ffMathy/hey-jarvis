---
paths:
  - "mobile/**"
---

# The hologram

> Part of [Mobile App](mobile.md). Paths in it are relative to `mobile/` unless they say otherwise.

The conversation screen is built around Jarvis as the film drew him: the golden sphere from the *Avengers: Age of Ultron* lab scene. A round, see-through, warm amber ball, brightest at its core and never dark inside, textured with short bright strokes, bounded by one rim element at a time — a bright crescent on the left limb, a segmented ladder ring, or a thin ring — and a hooked ring at the core. The film's slow protrusions are deliberately not drawn: on a phone they read as an arm swinging out of the ball on a loop, and the user asked for them gone. It turns on its own — the body about the vertical axis, the rim rolling the other way — it spirals out of its core when it first appears, and when Jarvis talks it grows agitated, glows and swells.

None of those numbers are a guess. The proportions, the colours, the rotation speeds, what changes while Jarvis speaks and the order the ball assembles itself in were all measured frame by frame from the scene itself, and `hologram/src/hologram-drawing.ts` cites that study section by section beside the code each finding produced.

```
Android, in a conversation     Jarvis's WebRTC track ─ modules/jarvis-audio (AudioTap) ─ tapped-voice.ts ─ hologram/src/voice-analysis.ts
Android, in sample mode        WebRTC's recorder ────── modules/jarvis-audio (AudioTap) ─ tapped-voice.ts ─ hologram/src/voice-analysis.ts
Browser, in a conversation     Jarvis's WebRTC track ─ AnalyserNode (time domain) ─ hologram/src/played-voice.ts ─ hologram/src/voice-analysis.ts
Browser, in sample mode        getUserMedia ─ AnalyserNode
  └─ a JarvisVoice (platform-contracts.ts), read every 40 ms on the JS thread
       └─ hologram/src/voice-levels.ts perceivedLevel + foldSpectrum → 24 log-spaced bands (targets)
            └─ hologram/src/react/hologram-view.tsx  UI thread, every frame: easeLevel/easeBands toward the
                 targets, and advanceVoiceActivity on the *raw* reading → agitation and chip bursts
                 ├─ hologram/src/hologram-drawing.ts   drawHologram(canvas, size, frame, scene, resources) → Skia Picture (all but his body)
                 └─ hologram/src/gpu/gpu-body.ts       drawGpuBody(gl, body, frame) → expo-gl's canvas over it, Screened
```

Every source hands the hologram the same two readings — a volume, and 1024 bytes of spectrum across 100–8000 Hz on Web Audio's decibel scale — so the drawing never knows which it is listening to. **Every source also computes them the same way**, with `hologram/src/voice-analysis.ts`: the volume is the RMS of the last 40 ms on both platforms, so `QUIETEST_SPEECH` means one thing everywhere and `speech-floor.web.ts` is the phone's number.

## Why neither platform asks the SDK for the volume

Both did once, and on both it was the wrong quantity — for different reasons, which is why each has its own way of getting at the samples.

**In a browser the SDK's volume is not a loudness at all.** `getOutputVolume` is the mean of an `AnalyserNode`'s *byte* spectrum, and a byte of that spectrum is a decibel reading between −100 dB and −30 dB. So the quietest thing the scale can express is −100 dB, and everything above it reads as something: the hiss under a recording, the comfort noise a codec sends between words, the room the voice was recorded in. Read as a level that says Jarvis is talking for as long as a conversation is open, and the gaps between his words never reach the tracker's speech threshold — the sphere stayed agitated through his pauses and the rim threw chips into his silences. `hologram/src/played-voice.ts` reads the time-domain samples off an `AnalyserNode` of its own instead and puts them through the same analysis the phone uses, where silence is zero. It used to be covered up by doubling the browser's speech floor; a floor that means something different on every surface cannot be reasoned about, and covering it was all that did.

## Why Android analyses the audio itself

On Android the SDK's two readers come from LiveKit's native processors (`@livekit/react-native` 2.12.0), and neither is usable for this:

- **The spectrum is a comb.** The SDK asks for 1024 bars; at 48 kHz only 169 FFT bins fall in 100–8000 Hz, and every bar between two of them reads 0 (`MultibandVolumeProcessor.kt`). Two of the hologram's 24 bands could never light.
- **The volume reads each sample with its bytes swapped.** WebRTC hands sinks a `ByteBuffer` in Java's default big-endian order over little-endian PCM — the recorded-samples dispatcher wraps it with `ByteBuffer.wrap`, and the native sink wrapper sets no order — and `VolumeProcessor.kt` reads it as it comes, so anything above near-silence reads close to full scale. This one is read from the code; the app no longer goes through it, and it has not been measured.

So `modules/jarvis-audio` hangs its own `AudioTap` off the same audio — Jarvis's remote track in a conversation, or WebRTC's recorder in sample mode — reading the bytes little-endian into a ring of the last third of a second, and JavaScript pulls from it and analyses it with `hologram/src/voice-analysis.ts`. That is the same code that turns the emulator check's recorded voice into its replayed readings, so what the replay shows is what a phone computes.

Finding Jarvis's track takes one step outside the SDK's public surface, and **both platforms take the same step**: the session hands over the conversation the SDK created, but the LiveKit room is on its protected `connection`. `roomOfConversation` in `hologram/src/agent-audio-track.ts` reaches it with `Reflect.get` and follows the participant whose identity contains "agent" — as the SDK's own code does — and this app's `agent-audio-track.ts` hands it the check that the room is a real `Room` of the `livekit-client` this app bundles, since an `instanceof` against any other copy would never be true. What each platform then does with the publication differs, so that is where they part: Android turns it into the pair of native ids its `AudioTap` needs, and `jarvis-voice.web.ts` checks it is the browser's own `MediaStreamTrack` and points Web Audio at it. `agent-audio-track.contract.spec.ts` reads the installed SDK and fails if any of that moves. If the track cannot be found anyway, the hologram falls back to the SDK's readers described above: it still draws and nothing fails, but the sphere answers a reading that is barely a voice — on Android a volume that reads near full scale for any sound at all, in a browser one that never reads silence — and on Android two of its bands stay dark.

## Split into its own rules

- [His body on the GPU, and tilting the phone to look round him](mobile-his-body-on-the-gpu-and-tilting-the-phone-to-look.md)
- [What happens when the conversation ends](mobile-what-happens-when-the-conversation-ends.md)
- [He greets you before he is connected](mobile-he-greets-you-before-he-is-connected.md)
- [Summoned, he arrives in a sheet](mobile-summoned-he-arrives-in-a-sheet.md)
- [What happens to a sentence he is cut off in](mobile-what-happens-to-a-sentence-he-is-cut-off-in.md)
