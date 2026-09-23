# Mobile App

> **Note:** See the root [AGENTS.md](../AGENTS.md) for shared conventions (Turborepo commands, commit standards, 1Password, etc.)

## Overview

An Expo app that registers as the phone's **default digital assistant** on Android, replacing Gemini or Google Assistant, and answers as Jarvis over a live ElevenLabs voice conversation. It also builds for web, where the conversation works and the assistant role does not.

No iOS target: Apple does not let an app replace Siri, so it would ship something that cannot do the one thing this project exists for.

## TURBO Commands

```bash
bunx turbo lint --filter=mobile       # Biome
bunx turbo typecheck --filter=mobile  # tsgo
bunx turbo test --filter=mobile       # the offline suite
bunx turbo build --filter=mobile      # bundles the JS for Android into dist/mobile
bunx turbo build:apk --filter=mobile  # installable arm64 release APK into dist/mobile-apk (needs JDK + Android SDK)
bunx turbo e2e --filter=mobile        # exports for web and drives it in Chromium
```

## Getting an APK onto a phone

The **Mobile APK** workflow (`.github/workflows/mobile-apk.yml`) builds one on every push to `main` and every pull request that touches the app — `mobile/**`, the lockfile, or the build configuration — and can be started by hand from the Actions tab. Open the run and download `jarvis-<commit>.apk` from its Artifacts; it is uploaded unzipped, so it is the APK itself. Artifacts are kept for 30 days.

It runs `build:apk` straight on the runner rather than in the dev container CI uses, because the runner image already has the Android SDK with its licences accepted. Three things about the APK worth knowing:

- **arm64-v8a only.** That is what phones run, and each extra ABI compiles every native module again. For an x86_64 emulator, build locally with `reactNativeArchitectures=x86_64`, or use `.scripts/verify-assistant-on-emulator.sh`, which does.
- **Signed with the Expo template's debug keystore**, the same well-known key everywhere. CI and local builds therefore install over each other, which is what side-loading wants — but anyone can sign an update with that key, so it is not a distribution build. Anything published goes through EAS (`eas.json`'s `production` profile) with a real key.
- **It is the release variant**: the JS bundle is embedded, no Metro and no development client, and nothing configured — the ElevenLabs API key and agent ID are typed into the settings screen on first run, as on any install.

To run it on a device (needs the Android SDK, which CI does not have):

```bash
bun run --cwd mobile native:prebuild   # generates android/ from app.config.ts + modules/
bun run --cwd mobile android           # builds and installs a development build
bun run --cwd mobile start             # Metro, for an already-installed development build
```

The prebuild script is called `native:prebuild` rather than `prebuild` deliberately: npm and bun treat `prebuild` as a lifecycle hook and run it automatically before `build`, which would put `expo prebuild` in front of every CI build — needing an Android SDK that CI does not have.

**Expo Go does not work.** The conversation needs LiveKit's native WebRTC modules and the assistant registration needs the native module in `modules/`, so a development build is the minimum.

## How it fits together

```
phone (assist gesture)
  └─ JarvisVoiceInteractionSession          modules/jarvis-assistant (Kotlin)
       └─ heyjarvis://assist                deep link into the app
            └─ ConversationScreen           src/conversation-screen.tsx
                 ├─ GET /v1/convai/conversation/token   → ElevenLabs, with the API key
                 └─ WebRTC session                      → the ElevenLabs Jarvis agent
```

The agent on the other end is the same one `elevenlabs/` deploys, with the same prompt and the same `routePromptWorkflow` tools. This app adds a way to reach it, not a second Jarvis.

## File Structure

```
../hologram/src/                  # Jarvis himself, shared with the watch — see ../hologram/AGENTS.md
├── elevenlabs-settings.ts        # the two credentials, and what is wrong with them
├── conversation-token.ts         # minting a token, and every ElevenLabs failure explained
├── hologram-drawing.ts           # what one frame of the hologram looks like (worklets)
├── voice-analysis.ts             # the FFT and RMS, the same for live audio and the emulator replay
├── voice-levels.ts               # spectrum folding, easing, and the agitation/burst tracker
├── voice-contract.ts             # JarvisVoice: the two questions the sphere asks a voice
├── greeting-handover.ts          # when the recorded greeting is over, and the override it comes with
├── react/                        # `hologram/react`, the half that needs a framework
│   ├── hologram-view.tsx         # Skia canvas, Reanimated clocks, reading the voice every frame
│   └── is-foreground.ts          # stops the clock and the microphone when nobody is looking
└── conversation/                 # `hologram/conversation`, the half that needs the ElevenLabs SDK
    ├── agent-voice.ts            # his voice as the SDK hears it — the whole voice on web and watch
    ├── sdk-voice-readers.ts      # the SDK's analysers, safe to call before a session exists
    ├── tool-activity.ts          # which tool calls are in flight, and how long he keeps thinking after
    ├── greeting.ts               # "Hello sir, how can I help?" while the session is dialled behind it
    └── user-voice.ts             # the user's vad_score and microphone level, for the listening lattice

mobile/
├── app.config.ts                 # Expo config: package name, scheme, permissions, plugins
├── index.ts                      # registerRootComponent
├── metro.config.js               # monorepo resolution + singleton pinning
├── eas.json                      # development / preview / production builds
├── modules/jarvis-assistant/     # the local Expo module that owns the assistant registration
│   ├── index.ts                  # the JS side
│   └── android/src/main/         # Kotlin, the merged manifest, and res/xml
├── modules/jarvis-audio/         # raw audio for the hologram: the microphone, or Jarvis's WebRTC track
└── src/
    ├── app.tsx                   # root component: the tour, settings, the conversation, sample mode
    ├── onboarding-screen.tsx     # the first-run tour: agents, credentials, assistant role
    ├── onboarding.ts             # its steps, which of them this device has, and every link
    ├── onboarding-storage.ts     # whether the tour has been walked
    ├── conversation-screen.tsx   # the hologram, and nothing else on the screen
    ├── settings-screen.tsx       # the two fields with no tour around them, for coming back to
    ├── elevenlabs-fields.tsx     # the two fields themselves, shared with the tour
    ├── settings-storage.ts       # platform-agnostic half of persistence
    ├── watch-card.tsx            # whether Jarvis is on the paired watch, and the key handover
    ├── answer-the-watch.ts       # sends the credentials across whenever the watch asks
    ├── use-assistant-registration.ts  # whether Jarvis still holds the assistant role
    ├── assist-link.ts            # what "opened by the assistant" looks like
    ├── assistant-window.ts       # the window the assistant gesture opens, and retracting it
    ├── sample-screen.tsx         # sample mode: Jarvis alone, tapped to walk through his moods
    ├── sample-sheet.tsx          # the sheet he arrives in when summoned, and why he waits for it to settle
    ├── jarvis-hologram.tsx       # the hologram on Android …
    ├── jarvis-hologram.web.tsx   # … and in a browser, once CanvasKit has loaded
    │                              #   (both are two lines over `hologram/react`)
    ├── hologram-size.ts          # how big it is drawn on this screen
    ├── spark-density.ts          # how many particles this phone can manage …
    ├── spark-memory.ts           # … and remembering what it managed last time
    ├── jarvis-voice.ts           # Jarvis's voice on Android: his track, tapped and analysed …
    ├── jarvis-voice.web.ts       # … and in a browser, the same track through Web Audio
    ├── agent-audio-track.ts      # finding Jarvis's track in the conversation's LiveKit room
    ├── tapped-voice.ts           # raw samples from modules/jarvis-audio → volume and spectrum
    ├── played-voice.ts           # the same, from the samples a browser is playing
    ├── queued-audio.ts           # dropping what a browser still has queued when he is cut off
    ├── conversation-life.ts      # whether a conversation is open, and whether one has ended
    ├── typed-message-field.tsx   # writing to Jarvis instead of talking, and he still answers aloud
    ├── written-reply.ts          # the last thing he said in writing, and how long he takes to say it …
    ├── written-reply-line.tsx    # … and the one thing on this screen there is to read
    ├── theme.ts                  # the one place colours and spacing are defined
    ├── platform-contracts.ts     # the shapes the .web.ts pairs below must keep
    ├── key-value-store.ts        # keystore on Android …
    ├── key-value-store.web.ts    # … localStorage in a browser
    ├── microphone-permission.ts      # PermissionsAndroid …
    ├── microphone-permission.web.ts  # … getUserMedia
    ├── preferred-microphone.ts       # onto the headset, on Android …
    ├── preferred-microphone.web.ts   # … which a browser does for itself
    ├── speech-floor.ts               # the quietest a phone reading counts as speech …
    └── speech-floor.web.ts           # … and, now both measure an RMS, the same in a browser
```

## The hologram

The conversation screen is built around Jarvis as the film drew him: the golden sphere from the *Avengers: Age of Ultron* lab scene. A round, see-through, warm amber ball, brightest at its core and never dark inside, textured with short bright strokes, bounded by one rim element at a time — a bright crescent on the left limb, a segmented ladder ring, or a thin ring — and a hooked ring at the core. The film's slow protrusions are deliberately not drawn: on a phone they read as an arm swinging out of the ball on a loop, and the user asked for them gone. It turns on its own — the body about the vertical axis, the rim rolling the other way — it spirals out of its core when it first appears, and when Jarvis talks it grows agitated, glows and swells.

None of those numbers are a guess. The proportions, the colours, the rotation speeds, what changes while Jarvis speaks and the order the ball assembles itself in were all measured frame by frame from the scene itself, and `hologram/src/hologram-drawing.ts` cites that study section by section beside the code each finding produced.

```
Android, in a conversation     Jarvis's WebRTC track ─ modules/jarvis-audio (AudioTap) ─ tapped-voice.ts ─ hologram/src/voice-analysis.ts
Android, in sample mode        WebRTC's recorder ────── modules/jarvis-audio (AudioTap) ─ tapped-voice.ts ─ hologram/src/voice-analysis.ts
Browser, in a conversation     Jarvis's WebRTC track ─ AnalyserNode (time domain) ─ played-voice.ts ─ hologram/src/voice-analysis.ts
Browser, in sample mode        getUserMedia ─ AnalyserNode
  └─ a JarvisVoice (platform-contracts.ts), read every 40 ms on the JS thread
       └─ hologram/src/voice-levels.ts perceivedLevel + foldSpectrum → 24 log-spaced bands (targets)
            └─ hologram/src/react/hologram-view.tsx  UI thread, every frame: easeLevel/easeBands toward the
                 targets, and advanceVoiceActivity on the *raw* reading → agitation and chip bursts
                 └─ hologram/src/hologram-drawing.ts   drawHologram(canvas, size, frame, scene, resources) → Skia Picture
```

Every source hands the hologram the same two readings — a volume, and 1024 bytes of spectrum across 100–8000 Hz on Web Audio's decibel scale — so the drawing never knows which it is listening to. **Every source also computes them the same way**, with `hologram/src/voice-analysis.ts`: the volume is the RMS of the last 40 ms on both platforms, so `QUIETEST_SPEECH` means one thing everywhere and `speech-floor.web.ts` is the phone's number.

### Why neither platform asks the SDK for the volume

Both did once, and on both it was the wrong quantity — for different reasons, which is why each has its own way of getting at the samples.

**In a browser the SDK's volume is not a loudness at all.** `getOutputVolume` is the mean of an `AnalyserNode`'s *byte* spectrum, and a byte of that spectrum is a decibel reading between −100 dB and −30 dB. So the quietest thing the scale can express is −100 dB, and everything above it reads as something: the hiss under a recording, the comfort noise a codec sends between words, the room the voice was recorded in. Read as a level that says Jarvis is talking for as long as a conversation is open, and the gaps between his words never reach the tracker's speech threshold — the sphere stayed agitated through his pauses and the rim threw chips into his silences. `played-voice.ts` reads the time-domain samples off an `AnalyserNode` of its own instead and puts them through the same analysis the phone uses, where silence is zero. It used to be covered up by doubling the browser's speech floor; a floor that means something different on every surface cannot be reasoned about, and covering it was all that did.

### What happens when the conversation ends

He goes. The agent hangs up, the session drops, and the sphere used to go on turning exactly as it
does while he listens — which is the same complaint the problem line answers, the other way round:
an assistant who has finished looks identical to one who is waiting for you. So the end of a
conversation fades him over `LEAVING_SECONDS`, unmounts the drawing (a frame loop drawing a sphere
that has faded to nothing is a phone kept awake for no one), and — summoned — lets the sheet follow him down and retracts the assistant's window,
which is how sample mode leaves too.

### He greets you before he is connected

The moment the microphone is granted, "Hello sir, how can I help?" plays from the firmware's own
recording and the token request goes out beside it, so by the time he has asked, the session is
usually up. The session is opened with the agent's first message switched off and its microphone
muted until the recording ends; if it is slower than that, the screen goes on connecting exactly as
before, under the same `GIVE_UP_CONNECTING_AFTER_MS`. Hanging up mid-greeting stops it. How it
works, and the three ways to break it, are in `useGreeting`'s note and `../hologram/AGENTS.md`.

Two places it deliberately does not play. **The text-only session**, a browser that refused the
microphone: that was a choice to keep the conversation quiet, so he greets in writing there — the
agent keeps its first message, and it arrives as his first written reply. **A browser that refuses
the sound anyway**, in which case the agent keeps its first message too, so he is never left not
greeting at all.

A browser tab nobody has clicked since it loaded — a reload straight onto the conversation, or a
new tab — is not one of those, though it used to be. Browsers refuse to start a sound there *unless
the page is using the microphone*, so `microphone-permission.web.ts` holds the stream it asks
permission with until the greeting has started, and lets it go straight after. Released at once, as
it once was, the recording was refused and the agent greeted in its own voice instead.

**Not yet heard on a device.** Everything above is reasoned from the SDK's and expo-audio's
sources, not listened to. What a phone has to settle: that the greeting keeps playing, on the
speaker and at a sensible volume, when LiveKit switches Android into `MODE_IN_COMMUNICATION`
mid-sentence; that the mute lands before the agent hears any of it (there is a window of a few
milliseconds between the SDK publishing the microphone and `onConversationCreated`); and that
`vad_score` events arrive over WebRTC as they do over the firmware's socket.

The sphere also shows the user being heard: while ElevenLabs' `vad_score` says someone is
speaking, his particles snap onto a lattice that turns inside him, breathing harder the louder the
microphone is. `useUserVoice` feeds it,
and it ignores the score while Jarvis speaks, since the microphone hears him too.

### Summoned, he arrives in a sheet

The assistant gesture puts the conversation in the same bottom sheet sample mode uses
(`sample-sheet.tsx`), over whatever the user was doing, and he forms once it has stopped moving.
Opened from the launcher he still fills the screen: there is nothing underneath to keep.

It used to take the whole screen when summoned too, and nobody chose that — the sheet was only
ever written for sample mode, which is what a summoning showed before there were credentials, so a
phone that had been set up simply stopped seeing it. Tapping beside the sheet or pressing back hangs
up. The assistant's window is kept between summonings rather than rebuilt, so a summoning after he
has gone is noticed by the app returning to the foreground, which brings the sheet back and opens a
new conversation.

**Ending is not the same as never starting**, and both read `disconnected`. A conversation that
never opened has failed, and the answer to that is the line saying why *under a sphere that is
still there*. So `conversation-life.ts` folds the statuses rather than looking at the current one,
and only a conversation that was open can end.

### What happens to a sentence he is cut off in

Nothing, unless somebody does it — and in a browser that showed. Jarvis is interrupted, the server
stops sending, and whatever his `<audio>` element had already taken in stays in it, so the tail of
the sentence he was cut off in came out at the head of his next one: the same take, clipped.

There is no queue to clear in this app or in the SDK. Over WebRTC the SDK's `interrupt()` is a
documented no-op, because audio is a live LiveKit track rather than chunks the client buffers, and
audio arriving on the data channel is deliberately not re-played. (The `audioConcatProcessor` queue
that *does* have this shape is the WebSocket transport's, which here carries no audio at all.) The
only queue left is the media element's own, so `queued-audio.ts` empties it: clearing `srcObject`
tears the element's renderer down and takes the queued audio with it, and putting the same live
stream back builds a new one at the live edge. It hangs off the SDK's `onInterruption` — which the
agent sends because `interruption` is in its `clientEvents` — and an interruption is exactly the
moment there is nothing left worth playing.

On a phone this costs one empty loop. `attachedElements` is LiveKit's, and it only ever fills in a
browser: Android plays the agent's track natively, with no element and no queue of its own.

### Why Android analyses the audio itself

On Android the SDK's two readers come from LiveKit's native processors (`@livekit/react-native` 2.12.0), and neither is usable for this:

- **The spectrum is a comb.** The SDK asks for 1024 bars; at 48 kHz only 169 FFT bins fall in 100–8000 Hz, and every bar between two of them reads 0 (`MultibandVolumeProcessor.kt`). Two of the hologram's 24 bands could never light.
- **The volume reads each sample with its bytes swapped.** WebRTC hands sinks a `ByteBuffer` in Java's default big-endian order over little-endian PCM — the recorded-samples dispatcher wraps it with `ByteBuffer.wrap`, and the native sink wrapper sets no order — and `VolumeProcessor.kt` reads it as it comes, so anything above near-silence reads close to full scale. This one is read from the code; the app no longer goes through it, and it has not been measured.

So `modules/jarvis-audio` hangs its own `AudioTap` off the same audio — Jarvis's remote track in a conversation, or WebRTC's recorder in sample mode — reading the bytes little-endian into a ring of the last third of a second, and JavaScript pulls from it and analyses it with `hologram/src/voice-analysis.ts`. That is the same code that turns the emulator check's recorded voice into its replayed readings, so what the replay shows is what a phone computes.

Finding Jarvis's track takes one step outside the SDK's public surface, and **both platforms take the same step**: `useRawConversation()` is public, but the LiveKit room is on the conversation's protected `connection`. `agent-audio-track.ts` reaches it with `Reflect.get`, checks it is a real `livekit-client` `Room`, and follows the participant whose identity contains "agent" — as the SDK's own code does. What each platform then does with the publication differs, so that is where they part: Android turns it into the pair of native ids its `AudioTap` needs, and `jarvis-voice.web.ts` checks it is the browser's own `MediaStreamTrack` and points Web Audio at it. `agent-audio-track.contract.spec.ts` reads the installed SDK and fails if any of that moves. If the track cannot be found anyway, the hologram falls back to the SDK's readers described above: it still draws and nothing fails, but the sphere answers a reading that is barely a voice — on Android a volume that reads near full scale for any sound at all, in a browser one that never reads silence — and on Android two of its bands stay dark.

## Sample mode

Before the app is set up there is nothing for the hologram to follow, so the settings screen offers **"No key yet? Try the hologram"**. It opens `sample-screen.tsx`: the same hologram, in a sheet, walking through what Jarvis does.

The moods, their order and names, the simulated voice, the mood toast and the frame-rate readout are not this app's: they are `hologram`'s (`sample-mode.ts` in the main entry, and `hologram/react/sample`), because the watch's waiting screen is a sample mode too. Only where they sit on the screen is decided here.

**It used to listen to you, and it does not any more.** There was a fourth mood, `microphone`, that opened the phone's microphone and drove the sphere from your own voice — with a recorder of its own on Android (`MicrophoneRecorder`, `AudioRecord` with `VOICE_RECOGNITION`), a browser path through an `AnalyserNode`, a permission prompt, a recording indicator, and an end-to-end emulator check that played a tone in and compared what the app heard against Android's own audio HAL. All of it is gone, along with `sample-voice.ts`, `sample-voice.web.ts`, `UseSampleVoice`, and the emulator harness's `microphone` run.

What it bought was proof that the hologram follows a real voice, which is worth having — but sample mode is a thing to look at before there is an account, and the simulated voices in `hologram/src/simulated-voice.ts` show the same moods from the clock. Every mood is now a tap, and nothing on that screen opens a microphone.

- **A conversation still listens to Jarvis through WebRTC**, which is right: that audio is already inside WebRTC and never touches this path.
- **In a browser it is `getUserMedia` into an `AnalyserNode`** with the ElevenLabs web SDK's settings (`fftSize` 2048, smoothing 0.8), not connected to the speakers.

**The frame rate was a missing stencil and an interpreter, not pixels.** On a phone this drawing ran at 8 frames a second while the same picture ran at 58 in that phone's own browser, and it did not change with the size of the canvas, which ruled out fill rate. A build with a quarter of the fragments, a quarter of the shell and one halo ring ran at 57, which could not say which of those had been the cost. Two causes were found behind it, one in each half of a frame, and neither was read off the phone itself: both come from models of it run on a desktop. The first is painting. React Native Skia asks Android's EGL for a window with no stencil buffer (`EGL_STENCIL_SIZE 0` in its `gl/Display.h`, in every release up to 2.12), and without one Skia's GPU backend cannot send a stroke drawn *without antialiasing* through its tessellator on the GPU: it turns each one into an outline on the CPU and triangulates it, every frame, since the paths are new every frame and nothing it caches is ever used again. The particle halos are exactly those — the one paint here drawn without antialiasing (`HALO_ANTIALIASED`), six paths a frame of thousands of wide round-capped dashes. A browser's WebGL 2 canvas has an eight-bit stencil, so there they go to the GPU. Antialiased strokes are the same in both: Skia rasterises them into masks on the CPU either way. Modelled with the real drawing in CanvasKit on WebGL, in headless Chromium over SwiftShader, at 714 px and full density: 12.6 MB of triangles and 230-250 ms of Skia's CPU a frame without a stencil, the halos 80-86% of the painting anywhere above the floor, against about 30 ms for the whole frame with one. The app now records the whole picture, background included, inside one layer (`DRAWN_IN_A_LAYER` in `hologram/src/react/hologram-view.tsx`). A layer is a surface Skia allocates for itself and can always give a stencil, and in the same model that brings the app's canvas to the browser's 30 ms. It only helps where the GL context can draw instanced geometry — OpenGL ES 3, or ES 2 with the instancing extensions — on a GPU Skia has not switched tessellation off for (it does on Intel, Mali-T, Adreno 3xx and 4xx, and PowerVR Rogue drivers older than 1.15), and both of those are assumed of the phone rather than read off it. The second cause is building the picture, below. **Profile the phone before trusting any of these numbers**: they come from WebAssembly and a Hermes harness on a desktop CPU, with an emulated GPU, and only their ratios are expected to carry over. And remember that every headless test and benchmark here rasterises on the CPU, where the opposite holds: there the pixels are the cost and nothing is triangulated.

**A frame has two halves, and they are fixed by different things.** Building the picture is JavaScript, in a Reanimated worklet on the UI thread; painting it is Skia, when React Native Skia flushes the picture — on which Android thread has not been checked. Measure them apart — record into a `PictureRecorder` without flushing, then with — before changing anything for speed, because a change that helps one does nothing for the other. The view times the first half itself (`buildMilliseconds`), and that timing is both what the density loop steers by and what sample mode's readout shows.

**Building the picture is the interpreter, not the crossings.** On a phone the picture is built in a Reanimated worklet under Hermes, which has no JIT and runs a worklet's code as bytecode compiled at runtime without optimisation. On a Hermes V1 built the way React Native builds it, wrapped the way the worklets runtime wraps it, and timed on a desktop rather than a phone, building a picture cost about twelve times per particle what V8 with its JIT pays on the same machine. Of the 27 ms it took with all ten thousand particles, about 2 ms is handing path commands across to Skia (`MakeFromCmds`, about 190 ns a command); the rest is the drawing's own JavaScript run unoptimised, and the worklets' convention for calling helpers. Skia's own path builder, which crosses once per `moveTo` and `lineTo`, would be worse again — measured with the JIT switched off, a thousand two-verb dashes cost 4.41 ms that way against 0.91 ms handed over as one array of commands — so the drawing still batches them (`pathOf` in `hologram-drawing.ts`). At the floor, 4.1 of the 5.3 ms the build took was the loop reading and turning away the 9,750 of 10,000 rows the density share did not keep. The scene's rows are now put in the order of the share's key when it is built (`roundedInDensityOrder`), and the loop stops where the kept rows end (`densityRowsEnd`). Measured on the same harness against the code as it now stands, that takes the floor from 5.1 to 1.1 ms and a thousand particles from 7.3 to 3.0 ms, and moves the count at which the build reaches `BUILD_BUDGET_MS` from about 1,350 particles to about 2,900. Full density is unchanged, at 26-29 ms, so this narrows the gap to a browser rather than closing it. Past the floor, fewer fragments are a fair trade, whatever the headless figures under a JIT once said: under Hermes the build is close to proportional to the count drawn.

**Painting is pixels only on a CPU rasteriser.** Split apart headlessly, where CanvasKit rasterises on the CPU, one frame at 384 px was 1.2 ms of building the picture — under a JIT, with the thousand particles of the time — and 49 ms of painting it, and the painting scaled with area: 384 px costs 49 ms, 269 px costs 28 ms, 230 px costs 22 ms. That is why `DRAWN_RESOLUTION` in `hologram/src/react/hologram-view.tsx` lays the canvas out at 0.45 of the screen's resolution and scales it up, and why `SPHERE_FRACTION` counts there too, since a bigger sphere fills more pixels. On a GPU it is a different drawing: what Skia spends its CPU on is the paths it cannot hand to the GPU as they are. With a stencil, in CanvasKit on WebGL at 714 px, that was about 11 ms a frame at the floor and 30 at full density, most of it antialiased strokes, which Skia rasterises into masks on the CPU in a browser too; the halos cost under a millisecond. Without a stencil it is the halos, above. What the GPU itself pays for the pixels has not been measured anywhere — SwiftShader emulates one on the CPU, so its GPU timings say nothing about a phone's — and the only evidence is the phone's own browser holding 58 frames a second on the same drawing. **The frame rate is steered, not capped.** `MINIMUM_FRAME_SECONDS` in the view is a safety rail at 1/128 s, not the rate: what Jarvis runs at is `hologram/src/density-control.ts` adding particles until a picture takes `BUILD_BUDGET_MS` (8 ms) to build, with `TARGET_FRAMES_PER_SECOND` (40) as a backstop — two windows running below it set a ceiling the count may not climb past, which is what catches a phone whose painting runs out of room before its building does.

The costliest single layers to *paint*, measured layer by layer in the same CanvasKit-on-WebGL model at 714 px: without a stencil, the particle halos, at 80-86% of the painting anywhere above the floor; with one, the fixed layers at the floor (about 9 ms, 7 of it the inner shells) and the antialiased body strokes at full density (about 20 of the 30 ms). The shadow that used to lead this list is gone. The costliest to *build* is the fragment body, and under Hermes what costs there is the fragments themselves, run as unoptimised JavaScript, rather than the path commands handed to Skia — about 2 of the 27 ms at full density.

**Sample mode shows the frame rate, how long a picture took to build and the particle count in the corner** (the watch leaves out the build time, for room), counted on the UI thread where the frames happen and read twice a second by a leaf component. It reports what the device achieves, so forty or more means it is holding `TARGET_FRAMES_PER_SECOND` — the least the density loop will settle for — and less is what it managed; a build time near `BUILD_BUDGET_MS` is the loop holding its target, and one far over it with the count at the floor is a phone that cannot build even that. Use it before and after any change made for speed. **Only sample mode shows it**, on the phone and the watch alike: the conversation screen used to carry a faint copy in a browser, and it was removed at the user's request — a screen that is the assistant has nothing on it but him. The e2e suite checks both halves of that.

**The square is bigger than the screen, and that is nearly free.** Chips are thrown to about 1.6R on a syllable and the drawing clips at the edge of its square, so a square the size of the screen cut them in mid-air. `useWholeScreenHologramSize` makes it half again wider and `SPHERE_FRACTION` is set against that, so the sphere is the same size on screen and the only thing that cuts a chip is the screen itself — where an edge cannot be seen. Measured, that cost 0.6 ms a frame, because Skia rasterises only what is drawn and everything drawn is sized from the sphere. That was on a CPU rasteriser. On a device the picture is now drawn into a layer the size of the whole square (`DRAWN_IN_A_LAYER`), so the square's area is also what that layer allocates and what is drawn onto the window from it each frame, and what that costs a phone's GPU has not been measured.

What each layer is, what the voice does to it, and which finding of the film study each number came from is written at the top of `hologram/src/hologram-drawing.ts`. These are the things worth knowing before changing it:

- **Layers, back to front.** No warm volume any more: the textured circle of haze that used to sit under everything is gone at the user's asking, so the ball is see-through between its strokes and reads as a swarm rather than a surface — do not paint it back in. Then the inner shells — a two-armed whorl winding out of the core, a long loop, a saturated arc and the faint near half of an edge-on ellipse, all counter-turning, and data streaks; the fragment body, short strokes and glyphs inside 0.94R — up to `PARTICLE_COUNT` of them, 10,000 on the phone, of which the density loop draws whatever share the phone can afford — turning about the vertical axis, each tier with a halo of its own, plus a turning shell below the core, and all of it snapping onto a slowly turning hexagonal lattice while someone talks to him; comet arcs and spokes; the core's bloom, hooked ring and knot; the bright fragments and their hot cores; a hairline ring at the limb; the rolling ladder truss; the bright left crescent; the fraying and streak arcs; the latest burst's chips; and rare accents. Nothing is drawn only while he arrives: the vortex moves the particles already being drawn.
- **Idle motion, and only idle motion.** Nothing breathes, pulses or flickers as a whole. The outer rim layer rolls clockwise in the screen plane at 11°/s; the inner layer — whorl, loop, arc and a quarter of the fragments — counter-turns at 5°/s; the body itself turns about the vertical axis once every 24 s, each fragment living on its own 0.3–0.65 s clock and re-lighting near where it sits on the turning ball, with a shell below the core turning about the vertical axis into the film's sideways counter-streams. A 59-second script decides which rim element leads and how dense the fragments are, handing each over within a second or so.
- **Speech is activity, and only activity.** As in the film: the sphere's brightness and silhouette hold while Jarvis talks — measured at ±3% and ±1% — and what changes is behaviour. Fragments turn over about half again as fast, the crescent splits into thin arcs and opens gaps, the hot highlights all but go, the limb frays outward, and slabs of light break off the left limb on syllable onsets and in the gaps after them. `hologram/src/voice-levels.ts` turns the raw readings into an **agitation** envelope (up over 0.15 s while speech is present, down over 0.15 s, the same for a whisper as for a shout) driving the activity, and into **chip bursts**, which come in flurries of four a quarter-second apart and then rest for 0.6 s. The sphere also swells by up to `SWELL_WITH_VOICE`, which is movement rather than light.

  **It did not always hold.** `GLOW_WITH_VOICE` brightened the whole drawing with his voice for most of this app's life, because the user could not tell on a phone whether he was talking: it went in at 0.3 and was retuned to 0.8, 2.4, 1.6, 1.1 and 1.35 as each version was looked at on a real screen. It is 0 now — with the sphere most of the screen wide and the sparks drawn out into lines, the movement reads on its own, and on 2026-09-17 the user asked for the brightening gone. Measured, ordinary speech now lifts the disc 1–3% and a shout 5–9%, all of it from more lit pixels rather than brighter ones. Both `hologram/src/hologram-drawing.spec.ts` and the emulator check now pin the *holding* — a band, with a floor as well as a ceiling, because a sphere that dimmed while he talked would read as flinching and nothing else would catch it.

  **The fragments now turn over far more slowly than the film's, in both states.** At the film's rate the phone read as a sizzle — the user's word — while Jarvis spoke, "a surface boiling rather than a machine thinking", and what is wanted is his overwhelming calm. The calm pool is about twice as slow as the film's 0.2–0.6 s and the fast pool three to four times slower than it was; measured, that halves the speaking churn and takes a fifth off the idle. It does not take more off the idle however slow the pool gets, because what is left there is the ball *turning*, and the turn is still at the film's measured rate. Do not read the calm as a regression and speed it back up: see `pickFragmentRate`.
- **The body turns like a globe.** The film's interior does not spin — under 1-3°/s, measured — and the drawing held it pinned for that reason. It no longer does: the body turns about the vertical axis once every `BODY_TURN_SECONDS`, the rate the first hologram used, because a rim rolling round a still ball read as inert on a phone. The rim still rolls in the screen plane at the film's 11°/s and the inner shells still counter-turn at 5°/s.
- **The arrival is a vortex, and nothing else.** The film assembles the ball: a point of light, sparks, a band built out of flying pieces, a spoked dial, the fill spreading patch by patch, a ragged limb, and a tilted equatorial ring sweeping round. All of that is gone at the user's request. Instead the sphere is full size from the start and its particles leave the core, nearest first, spiralling out a turn and a half as streaks before settling; the core shows first, the whorl winds up with them and the rim fades in last, over `MATERIALISE_SECONDS` (1.4 s, since it plays on every summoning). It only moves the particles already being drawn, so the scene's particle count and the density share hold throughout — on the watch as on the phone. A plain fade and growth was tried first and compared side by side; the user chose the vortex.
- **There are no specks, and the ladder ring is built once per weight.** The drawing used to scatter 220 blinking points over the ball, each a dot with its own halo. A speck cost about as much as a stroke — two crossings into Skia, then stroked five times over for its halo — while contributing a single dot on top of a thousand strokes already twinkling underneath, so it was 14% of a frame for something you had to look for. They are gone, the stroke count went up to make up the light, and the dim and mid halos widened to carry what their halos used to. The ladder truss is built in the rolling frame, so its shape depends only on its weight, which is constant except during a handover: the five paths are memoised on that weight, worth another 10%. Memoised on the *input*, so a frame still draws the same picture whatever preceded it — caching keyed on what happened last frame breaks `draws a frame the same way after other frames`, and rightly.
- **Onsets and gaps need memory, and memory needs `modify`.** `advanceVoiceActivity` writes into a state object that lives from frame to frame, and it is fed the *raw* reading rather than the eased one, because easing is exactly what smears a syllable's start into a slope. The view advances it inside `activity.modify(...)`, the way the bands are eased: a shared value assigned from the JS runtime gets a warning-only setter in the UI runtime, so writing to it directly would drop every update in silence in a development build and work in release. `hologram/src/voice-levels.ts`'s header says so at length.
- **It spirals out of its core.** For the first `MATERIALISE_SECONDS` after the canvas mounts, `appearance = min(1, time / MATERIALISE_SECONDS)`, which the view computes from its own clock, runs the vortex. Nothing is drawn over it while it does.
- **It is all worklets.** `drawHologram` and every helper it calls start with `'worklet'` and use only their arguments and module-level number constants — no mutable module state, no closures, no `Math.random` while drawing; randomness comes from the seeded scene. The scene (flat number arrays, built once from a fixed seed) and the resources (paints, shaders, textures and mutable `PathBuilder`s, built once) are created per mounted canvas and must never be shared between two.
- **Loudness is eased on the UI thread, not the JS thread.** The SDK refreshes about 25 times a second; easing toward each reading every frame is what keeps the bands smooth, and `easeLevel` is exponential so the result is the same on a 60 Hz and a 120 Hz screen. The tracker is frame-rate independent for the same reason, and tested at 30, 60, 90 and 144 Hz.
- **It was designed by looking, and is tested by looking.** `hologram/src/hologram-drawing.spec.ts` renders it headlessly through CanvasKit — the same Skia API calls — and asserts on pixels: it moves when silent, it holds its brightness whether he speaks softly or loudly, speech shows as chips beyond the limb and more change than when calm, which bands are sounding changes the picture, the rim turns while the body stays put, it arrives as a vortex out of its core and nothing else, nothing pops at a script boundary, no frame of the arrival turns a tenth of the light on at once, and it stays inside its square. The device check is `.scripts/verify-hologram-on-emulator.sh`, below.

## First run

A new install opens on a three-step tour (`src/onboarding-screen.tsx`), not on the two fields it used to. The fields were an unanswerable question: nothing on that screen said what an ElevenLabs agent is, that Jarvis is one, or that the agent — not this app — is where the connections to everything else are made. Somebody who already had a key and an agent ID was the only person the old first screen worked for.

| Step | What it does |
| --- | --- |
| `agent` | What an agent is, that its tools are what make it an assistant, and links to sign up, build one, and read about webhooks and MCP servers |
| `credentials` | The API key and the agent ID, with a link to where each is found |
| `assistant` | The recommendation to hand Jarvis the assistant role, and the button that opens the picker — plus the watch card, when there is a watch, which is where the credentials are handed across to it |

Four things about it are decisions rather than details:

- **The steps, their order and every link live in `src/onboarding.ts`, which imports nothing.** `bun test` cannot parse React Native's Flow types, so anything a test needs an opinion about has to be outside the components — the same reason the contract specs read Kotlin as text. `onboarding.spec.ts` covers the order, the two-step shape in a browser, resuming, the count, and that every link is an `https://elevenlabs.io` address.
- **A browser gets two steps.** There is no assistant role in a browser and no picker to send anyone to, so the last step would be a recommendation nobody could act on. `onboardingSteps` leaves it out, and the count says "Step 2 of 2" rather than promising a third.
- **The credentials are saved the moment they parse, not at the end.** The next step sends the user out to Android's Settings, and the app is not guaranteed to come back alive; a pasted API key held in component state across that is a key lost. Which is why a tour that is resumed with credentials already stored picks up *after* them rather than asking again.
- **Whether the tour has been walked is remembered separately** (`src/onboarding-storage.ts`), and cannot be inferred from the credentials being there — because the last step comes after they are saved. A read of that flag that *fails* answers "walked": showing the tour to somebody who has a working Jarvis is the worse of the two mistakes, and a first-timer who misses it still lands on the settings screen, which is where this app used to open.

Skipping straight to sample mode is offered on every step, because the question somebody has just after installing this is whether it is worth signing up for anything at all, and the honest answer to that is the sphere rather than another paragraph. It is a side trip and not an exit: the tour is not marked walked on the way out, so tapping beside Jarvis comes back to the tour rather than past it. To the first step left to walk, not the one it left from — the screen is unmounted while sample mode is up, and keeping a wizard's position across that is not worth a prop, since by the time the last step is on screen the credentials are saved and it *is* the first one left.

Nothing in the tour is shown to a **summoned** app. Somebody who has just made the assistant gesture asked for Jarvis, and the answer to that is him — sample mode, when there is nothing set up — rather than a guided tour. See `app.tsx`.

## Configuration

The app ships with no credential. It talks to ElevenLabs directly, and both settings are typed into the tour's credentials step on first run — or into the settings screen afterwards — and kept in the Android keystore, or on web in `localStorage`:

| Setting | What it is |
| --- | --- |
| API key | An ElevenLabs API key, sent as `xi-api-key` to ElevenLabs and nowhere else |
| Agent ID | The Jarvis agent — the value of `HEY_JARVIS_ELEVENLABS_AGENT_ID` |

Both values are also what the **watch** needs, and it is given them from here rather than asked for them: see [Handing the credentials to the watch](#handing-the-credentials-to-the-watch). `conversation-token.ts` and `elevenlabs-settings.ts` live in `hologram/` for the same reason — both devices use them, so neither owns them.

For each conversation the app asks `GET https://api.elevenlabs.io/v1/convai/conversation/token` for a WebRTC token for that agent, and the session runs on the token; the key itself is used for nothing else.

**Except for a text-only conversation, which asks `GET /v1/convai/conversation/get-signed-url` instead and runs on a WebSocket.** That is the one case where the transport cannot be WebRTC: a text-only session publishes no audio, ElevenLabs' room waits for the client to publish some before it finishes coming up, and a conversation token can only be spent on a room. Dialled over WebRTC it therefore never connected *and never failed* — the screen sat on "Connecting…" indefinitely, which is what a browser with the microphone switched off used to show. Only a browser ever takes this branch: a phone with no microphone says so and stops, and `@elevenlabs/react-native` refuses a signed URL on a device outright.

**That branch was write-only until it learned to show his answer.** A text-only session returns the reply as an `agent_response` over the socket and never as audio, and nothing in the app rendered it — no transcript, no `onMessage`, nothing. So a browser with the microphone refused could send a line, get an answer, and display absolutely nothing: a silent sphere and an empty screen, indistinguishable from a conversation that had failed. `written-reply.ts` keeps the last thing he said — the last, not a transcript, and cleared the moment you send again so a stale answer never sits under a fresh question — and `written-reply-line.tsx` puts it above the field. It is the only screen in the app with something to read on it, because it is the only one with nothing to listen to.

**The sphere speaks it, out of the clock.** With no audio there is nothing for the hologram to follow, so it idled through the whole exchange: Jarvis answering you while looking exactly like an assistant who had not heard you. `written-reply.ts` also says how long he should look like he is delivering an answer — its length at fourteen characters a second, floored at 0.9 s so "Yes." is still a beat and capped at 12 s so a long answer is not mimed at length over text you have already read — and for that long the screen hands the drawing the same simulated voice sample mode uses (`useSimulatedVoice` from `hologram/react/sample`, shapes in `hologram/src/simulated-voice.ts`). It is a spectrum built from the clock, so it goes through the fold into bands, the easing, the agitation envelope and the chip bursts exactly as a real voice does, and nothing downstream knows the difference — which is the whole reason those moods are written as spectra rather than as flags on the drawing.

Only ever here. `readingAloud` is set from `onMessage`, which is wired on the text-only session alone, so every conversation that has a voice goes on following Jarvis's real one. The words are genuinely his; the only invented thing is the delivery, and it is invented only where ElevenLabs was asked not to provide one.

**Typing to Jarvis is not that branch, and has not been since he started answering typed lines out loud.** The two were the same thing for as long as the field existed only where the microphone had been refused, and the confusion cost the feature its voice: `textOnly` is what makes ElevenLabs write the reply instead of speaking it, and that override was the only session the field ever appeared in. It is not needed to *send* text. `sendUserMessage` is on `BaseConversation` rather than on `TextConversation`, so a typed line into an ordinary WebRTC session takes exactly the turn a spoken one would — Jarvis speaks the reply, and the sphere follows his voice, because `jarvis-voice.ts` reads his audio track and `mode` and neither knows how the turn began. So the field is on both platforms now, beside a working microphone as readily as without one, and the text-only fallback is what is left when there is no microphone to hold a voice conversation with at all.

**It also needs the agent's permission.** A typed conversation is asked for by sending the `text_only` override, and overrides are an allow-list: send one the agent does not permit and the server closes the conversation rather than ignoring it. So the session connects, drops immediately, and — because the SDK reports a server-side close through `onDisconnect` and *not* through `onError` — used to say nothing at all: Jarvis faded out because a conversation really had ended, and no line explained why. The screen listens for the ending now, and `platformSettings.overrides.conversationConfigOverride.conversation.textOnly` is on in `elevenlabs/src/assets/agent-config.json`, which reaches the agent only once that project is deployed.

`conversation-token.ts` turns each failure into what to fix — a rejected key, a key without permission to start conversations (which ElevenLabs can also answer with 401), an agent ID the account does not have or a malformed one (400), an account out of credits (402), rate limiting (429) — by reading only ElevenLabs' fixed `detail.status` / `detail.code` identifiers. It never repeats anything else from a response, since a message can echo the request that carried the key.

This used to go through the MCP server, which held the key and handed the phone tokens behind a shared secret. It was changed so the app needs nothing but ElevenLabs: no server address, no second secret, no tunnel to reach. The price is a real credential on the phone, so give the app **its own key**, restricted to what a conversation needs where the account allows it — then a lost phone is one revoked key, not every integration on the account.

What the keystore does and does not do for that key:

- **It keeps it from other apps.** `expo-secure-store` encrypts the entry with a key held in the Android Keystore, which only this app's user ID can use.
- **It keeps it out of backups.** The `expo-secure-store` config plugin in `app.config.ts` adds backup and data-extraction rules that leave its storage out of Google's cloud backup and device-to-device transfer. (After a restore the entry would not decrypt anyway, since the keystore key never leaves the phone; the app then simply opens on the settings screen.)
- **It does not protect it from an update of this app — and the side-loaded APK makes that easy.** Anything installed as an update of `com.ffmathy.heyjarvis` runs as the same app and can read the key. Android only accepts an update signed with the same key, but the APK the Mobile APK workflow builds is signed with the Expo template's public debug key (see "Getting an APK onto a phone"), so *any* APK signed with that key qualifies — including the workflow's own builds of pull requests. Never install a pull request's APK over an install that holds your real key. Closing this properly means signing with a private release key kept in a CI secret that pull request builds cannot reach.
- **It is not autofill's.** Both settings fields opt out of autofill and password managers, so saving them does not copy the key into a synced vault.

Reading the key can also fail outright — a keystore key invalidated by an OS update, say — and that reads as "nothing stored": the app opens on the settings screen rather than hanging on its loading spinner.

## Handing the credentials to the watch

The watch app talks to ElevenLabs directly, exactly as this one does, and it needs the same two values. It never asks for them: an API key is fifty characters beginning `sk_`, and a watch is not where anybody should type one. This app sends them over the Wearable Data Layer instead.

Both halves of the plumbing are in `modules/jarvis-watch`, beside the capability lookup that was already there:

- **`sendSettingsToTheWatch`** puts them on `/jarvis/elevenlabs-settings` as a JSON message, addressed to a node advertising the `jarvis_on_the_watch` capability — the capability rather than the connected nodes, because a message to a watch without the app is accepted by Play Services and then dropped, which would look exactly like a successful handover.
- **`whenTheWatchAsksForCredentials`** hears `/jarvis/ask-for-credentials`, which the watch sends whenever it starts with none. `src/answer-the-watch.ts` mounts that for the life of the app and answers it without a prompt; the note on that file argues why no prompt is the right default, and it is worth reading before changing it.

Only a *running* phone app can answer an ask, because the credentials are behind the keystore in JavaScript's hands rather than in the native module that hears the question. That asymmetry is the whole reason the watch's own screen says "open Jarvis on your phone" rather than waiting silently, and the reason the watch card also has a button: a watch that is not running when the button is pressed still receives, because on that side a `WearableListenerService` takes the message. See [`watch/AGENTS.md`](../watch/AGENTS.md).

**A message rather than a `DataItem`** is a security decision. See the note in `JarvisWatchModule.kt`: a data item replicates by being stored, in Play Services' own store on both devices, which is a live API key at rest somewhere neither app controls.

Four strings hold this together — two paths, each spelled in Kotlin and in TypeScript, on each of two devices — with no compiler between any of them. `src/watch-link.contract.spec.ts` reads all of them out of their sources, along with the manifest entry that wakes the watch, and fails if they drift.

## Becoming the assistant

Registration is entirely declarative, and every piece of it is load-bearing. `modules/jarvis-assistant/android/src/main/AndroidManifest.xml` is a *library* manifest that the Android build merges into the app's own, which is why there is no config plugin for any of this.

What has to be true, or the app silently never appears in the picker:

- The `VoiceInteractionService` is `exported="true"` and requires `android.permission.BIND_VOICE_INTERACTION`. The system process binds it across UIDs; `exported="false"` fails the bind with nothing logged in the app.
- The same goes for the session service.
- `res/xml/jarvis_voice_interaction_service.xml` names **both** a `sessionService` and a `recognitionService`. A missing `recognitionService` is still a hard parse error on current Android, and on API 29–30 the named class is copied into the device-wide speech recogniser setting — so `JarvisRecognitionService` has to exist and be instantiable even though it recognises nothing.
- `supportsAssist="true"` produces no error when missing and quietly downgrades the app to the plain assist-intent path.

Two things Android does **not** allow, both of which look like they work in code:

- `RoleManager.createRequestRoleIntent(ROLE_ASSISTANT)` shows no dialog. The role is declared not requestable, so the activity finishes immediately. The app sends the user to `Settings.ACTION_VOICE_INPUT_SETTINGS` instead, and re-reads the role when it comes back to the foreground. The last step of the first-run tour is where that is offered, and it says what to tap once it lands — which screen it manages to reach differs by device, so the directions change with it.
- Calling `hide()` before `startAssistantActivity()` makes the start illegal: what it checks is that the session is currently shown, and `hide()` retracts it. Start the activity first, hide second. Suppressing the session's own window with `setUiEnabled(false)` in `onPrepareShow` is fine and is what AOSP recommends for a session that only launches an activity — it is a client-side flag and does not make the session un-shown — but nothing may ask for a content view afterwards.

To debug a device where Jarvis does not appear in the picker:

```bash
adb logcat -s VoiceInteractionServiceInfo   # names the exact parse error
adb shell cmd role get-role-holders android.app.role.ASSISTANT
```

## Dependencies

Versions are pinned exactly, and every one of them has to clear the repository's 7-day npm cooldown (see the root AGENTS.md). Three pins are not just "the latest that fits":

- `@livekit/react-native` is held at **2.x**. The 3.x line is published as `latest` but does not satisfy `@elevenlabs/react-native`'s peer range.
- `livekit-client` is a direct dependency even though it is transitive, so only one copy can resolve.
- `expo-audio` is at **57.0.5**, what Expo 57's `bundledNativeModules.json` allows (`~57.0.4`). It plays the greeting on Android and, through an `HTMLAudioElement`, in a browser. It needs no config plugin: it only plays, and its manifest adds nothing but `MODIFY_AUDIO_SETTINGS`.
- `@config-plugins/react-native-webrtc` is deliberately **not** installed. Its Android half only adds permissions, and two of them — `CAMERA` and `SYSTEM_ALERT_WINDOW` — have no business in a voice assistant. `app.config.ts` declares the permissions this app actually uses and blocks `CAMERA`, which LiveKit's own manifest would otherwise merge in.

`metro.config.js` points Metro at both this package's `node_modules` and the workspace root's, and keeps hierarchical lookup **on** — the usual monorepo advice to switch it off breaks bun's isolated layout, where walking up from the importing file is how a package finds its own dependencies.

It deliberately does **not** pin `react`, `react-native`, `livekit-client` and the LiveKit packages to one copy each, which is the other half of that advice. Bun's store is keyed by version and dependency closure, so it can hold a package twice — 19 of them do here — but none of those five, and bundling with and without the resolver gives the same hash and the same module count. The comment in the file says what the symptom would be if a bump ever splits one of them, and asks you to measure before adding it back.

The hologram adds three native packages, each at the version Expo 57 pins in `bundledNativeModules.json`: `@shopify/react-native-skia` 2.6.2, `react-native-reanimated` 4.5.1 and `react-native-worklets` 0.10.1. Two consequences that are easy to trip over:

- **`turbo initialize` has to have run.** Skia gets its prebuilt native libraries, and `canvaskit.wasm` for the web, from its own postinstall — which never runs here. Two scripts do those copies instead (nothing is downloaded), and `build:apk` and `e2e` depend on both: the workspace's `.scripts/install-skia.sh` puts the native libraries in place, and this package's `.scripts/initialize.sh` copies `canvaskit.wasm` into `public/`. Without them an Android build fails in CMake and the web hologram cannot load. The native half is a single root task (`//#install-skia`) rather than a step of each app because the phone and the watch resolve the *same* copy of `@shopify/react-native-skia` and it rewrites that copy's `libs/` in place — running it in both apps at once corrupted it, which is what broke the release `deploy` job twice; see the header of `.scripts/install-skia.sh`.
- **`@babel/core` is pinned to 7.29.7 as a dev dependency.** Worklets' Babel plugin compiles each worklet by calling `@babel/core` itself, and declares it as a peer with any version. Left alone, bun satisfied that peer with the Babel 8 that `mastra`'s deployer brings into the workspace, and the release bundle failed with `Requires Babel "^7.0.0-0", but was loaded with "8.0.1"`. The pin gives this package the Babel its Expo preset uses; `mastra` keeps its own 8.

`eas.json` pins bun to `1.3.14` in a `base` profile the three real profiles extend. Without it an EAS build uses whatever bun its image happens to ship, while the repository pins `packageManager` and `engines.bun` — so keep the three in step. It has to be an exact version; the schema validates it with `semver.valid`, which rejects a range.

## Web

`platforms` includes `web`, and the conversation genuinely works there: `@elevenlabs/react-native` resolves through its `browser` export condition to the plain `@elevenlabs/react` build, which speaks WebRTC through the browser rather than through LiveKit's native modules. The same components, the same provider, no branching in the screens.

Two things do differ, and each is a pair of files Metro picks between rather than a conditional:

- **Storage.** `expo-secure-store` ships `export default {}` as its web implementation, so the native path does not degrade on web — it throws. `key-value-store.web.ts` uses `localStorage` instead, and the settings screen says so, because `localStorage` is not a keystore.
- **The microphone.** `PermissionsAndroid` is not part of `react-native-web`. `microphone-permission.web.ts` asks by requesting a stream and releasing it again, so a refusal still surfaces as a permission problem rather than as a failed connection.

`platform-contracts.ts` holds the types both halves implement, so neither can drift — nothing else in the app imports both.

The hologram is the third pair, and a different kind: Skia's web build is WebAssembly that has to be fetched before anything Skia-backed can even be imported. `jarvis-hologram.web.tsx` loads the view lazily through `WithSkiaWeb`, holding its space empty meanwhile, and CanvasKit is served from the site root — `turbo initialize` copies `canvaskit.wasm` into `public/`, which the web export publishes — so a browser never reaches for a CDN.

What does **not** work on web is the assistant role, and it never will: it is Android's. The assistant card says that outright instead of offering a setup step that leads nowhere.

## Testing

Everything under `src/` that can be tested without a device is, and it runs in the ordinary offline suite:

```bash
bunx turbo test --filter=mobile
```

Tests must not import React Native or any Expo native module — there is no runtime for them under `bun test`. Keep logic worth testing in plain `.ts` files (`assist-link.ts`, `elevenlabs-settings.ts`, `conversation-token.ts`) and let the `.tsx` files stay thin enough to read.

`turbo build` bundles the JavaScript with Metro rather than assembling an APK. That needs no Android SDK, so it runs in CI's dev container on every push, and it still catches the failures a bundle can catch: an import that does not resolve, a native module missing from the tree, a file no test imports. The native build — Kotlin, Gradle, the manifest merge — is exercised by the Mobile APK workflow, only when the app changes.

### The browser tests

`turbo e2e --filter=mobile` exports the production web build and drives it in Chromium — the real bundle, served over HTTP, clicked through. It runs in CI alongside the rest.

The boundary is the ElevenLabs session, which needs a real API key and real quota. Everything up to it is exercised for real: the first-run tour (its two steps in a browser, its links, Back, and the side trip to sample mode and back), settings validation, persistence across a reload, the hologram drawing and moving with CanvasKit loaded from the export's own `canvaskit.wasm`, and the token request to ElevenLabs — its `xi-api-key` header, agent ID and participant name, and that the key never appears in the URL — along with how a rejected key and an unknown agent are explained. The typed field is covered on both of its paths: that a refused microphone still opens a conversation — dialled by asking for a **signed URL** rather than a token — and that the field stops saying "Connecting…" once nothing is; and that a microphone that *works* gets the same field beside it, over a token and not a signed URL, since a typed line there is answered out loud and quietly turning it into a text-only session would be the one way to lose that. A `start` that never opened a session at all gets no field, which is the phone's refused microphone by another route. The greeting is covered by counting `HTMLMediaElement.play()` in the page — the player fetches the recording at mount whether or not it plays, so a request proves nothing: it plays once from the export's own assets beside the token request, plays without being refused in a tab nobody has clicked — with the microphone held for it let go afterwards — and does not play in the text-only session, whose `conversation_initiation_client_data` must carry no `first_message`. The override on a voice session travels over LiveKit's data channel, which these tests close, so it is pinned by `greeting-handover.spec.ts` in `hologram` instead. Both URLs are intercepted with `page.route`; every other non-localhost request is aborted, and non-local WebSockets are closed, so a test can never dial out. Playwright answers CORS preflights for routed requests itself, so whether ElevenLabs' real CORS policy admits the web build is **not** covered — the test checks instead that the request carries no header besides `xi-api-key`, which is all a preflight would have to allow.

Every test that needs a configured app walks the tour first, through the `walkToCredentials` helper: the app no longer opens on a form, so a spec that types into one without pressing Next is a spec that fails on a missing field rather than on what it was checking.

Set `CHROMIUM_EXECUTABLE_PATH` to run against a Chromium that Playwright did not install itself — useful in a sandbox that ships a browser of a different build than the pinned `@playwright/test` expects. Leave it unset everywhere else.

### What CI cannot test, and what stands in for it

CI has no Android emulator, and neither does an agent sandbox: that needs the Android SDK and hardware virtualisation, and the SDK only comes from `dl.google.com`. So the device-level behaviour — the assist gesture, the role picker, the session opening the app — is checked by hand on an emulator, with the script below, rather than on every push. The commands above under "Becoming the assistant" are how to look at it there, and this is the one-line version:

```bash
adb shell cmd role get-role-holders android.app.role.ASSISTANT  # is Jarvis the assistant?
adb shell settings get secure voice_interaction_service          # "" means the degraded path
adb shell input keyevent 219                                     # KEYCODE_ASSIST — the button
adb shell am start -a android.intent.action.ASSIST               # the activity path instead
adb logcat -s JarvisAssistant VoiceInteractionServiceInfo        # what the session logged
```

`keyevent 219` is the one that matters: it goes through the same path as the real button, so it reaches `JarvisVoiceInteractionSession.onShow` rather than the `ASSIST` activity, and is the only way to exercise `startAssistantActivity` short of holding the hardware button.

A GitHub-hosted runner *does* have KVM, so an emulator job is possible in principle — but adding one means a new `uses:` entry, and every action here is pinned through `.github/workflows/actions.lock`. Regenerate it with `gh actions-lock` in the same change, or GitHub rejects every workflow in the repository.

`.scripts/verify-assistant-on-emulator.sh` encodes the whole check so it is run the same way each time instead of being reconstructed from memory: boot a headless AVD, build and install the release variant, grant the role from the shell, put the launcher in front, press `KEYCODE_ASSIST`, and assert three things — Jarvis is the resumed activity, its task is `type=assistant` (which only `startAssistantActivity` produces; the session's plain-`startActivity` fallback would also bring Jarvis up, in a `standard` task), and the system logged a start of `heyjarvis://assist`. It checks every prerequisite before touching anything and names what is missing.

**It passes.** Run on 2026-09-14/15 on WSL2 (Ubuntu 22.04, 8 cores, 16 GB, KVM) against a freshly created AVD — `system-images;android-34;google_apis;x86_64` revision 14, Pixel 6 profile, emulator 37.1.11 — it exits 0 with the role held, `voice_interaction_service` pointing at `JarvisVoiceInteractionService`, and Jarvis resumed in an assistant task started by uid 1000 from the session. The first end-to-end runs failed, and each failure is now handled and commented in the script rather than left for the next person:

- `expo run:android` on the default debug variant stays attached to Metro and never returns; it is a release build with `--no-bundler` instead.
- Installing launches the app, so Jarvis was already in front before the button was pressed — the original assertion could not fail. The launcher has to hold the front first.
- The headless display sleeps and the keyguard returns; both swallow `KEYCODE_ASSIST`. The screen is kept on and the lock screen disabled.
- On a fresh AVD, `cmd role add-role-holder` throws `TimeoutException` for close to three minutes after boot while PermissionController re-evaluates every default role. The grant is retried against a deadline.
- First boot on a loaded machine leaves a SystemUI "not responding" dialog in focus indefinitely; key presses into it kill SystemUI and bring the keyguard back. The dialog is cleared first, and the build's idle Gradle and Kotlin daemons (~5 GB) are stopped so the emulator is not starved into it.

The last run, against a fresh AVD with a warm Gradle cache, took 4½ minutes end to end; earlier ones on the same machine took closer to ten while other work competed for memory, most of it first boot and waiting out the role controller. The very first build on a machine adds twenty.

What the script does **not** cover is whether the conversation then starts on its own, because that needs a real session. It was checked by hand on the same emulator, pointing the app (then still configured with a server address) at a local listener that logged one line per token request — one line per `start()`. That found a real bug: only the first summoning after the app process started opened the microphone, and every later one brought Jarvis to the front and waited for a tap (`0, 0, 0` requests for three summonings; `1` for tapping Talk). The system keeps an assistant's process alive while it holds the role, so on a phone that is almost every summoning. It is fixed — each summoning now carries a `summon` value that differs every time, and the screen claims each URL once per process (`createAssistLaunchClaim` in `assist-link.ts`) — and the same measurement then gave one request for every summoning. One summoning out of fourteen after the fix produced no request, immediately after a reinstall, and did not happen again in thirteen further attempts, including ones that recreated those conditions; its log had already been cleared, so its cause is unknown.

Two things the emulator showed about the role itself, both Android's behaviour rather than the app's: **Force stop** and **Clear storage** on Jarvis's App info screen each hand the assistant role straight back to the default — `VoiceInteractionManager` logs `Force stopping current voice interactor` and clears the role holder. An app update and ordinary process death keep it. So a user who force-stops Jarvis has to pick it again in Settings, and the assistant card will say so when the app next comes to the foreground.

What guards the handover in the meantime is `src/assist-link.contract.spec.ts`: it reads the URL out of `AssistLauncher.kt`, the `scheme` out of `app.config.ts` and `ASSIST_URL` out of `assist-link.ts`, and fails if they disagree. That drift is silent otherwise — the build passes, the app installs, the registration stays valid, and the gesture opens an app that waits to be asked again.

Two things that would otherwise ride on reasoning alone have been checked another way, and are worth re-checking the same way if the manifest or the Kotlin changes:

- The Kotlin compiles against a real `android.jar`, which is what catches a misused framework API.
- The library manifest merges as intended. Running AGP's own `ManifestMerger2` over the generated app manifest plus this module's and LiveKit's, with `REMOVE_TOOLS_DECLARATIONS` on, puts all four components in the output with `exported="true"` and `BIND_VOICE_INTERACTION` intact, and confirms `blockedPermissions` really does drop LiveKit's `CAMERA`.

### The hologram on a device

`.scripts/verify-hologram-on-emulator.sh` checks what the headless spec cannot: that the hologram animates inside the real app, through Reanimated and native Skia, and stirs with a voice. An emulator has no ElevenLabs session, so the voice comes from one of two places, chosen with `JARVIS_VOICE`:

- **The app built with `JARVIS_VOICE_REPLAY=1`**, which makes Metro swap `jarvis-voice.ts` for `tests/hologram-preview/jarvis-voice.replay.ts`, replaying readings made offline from the line. Nothing native about the audio is exercised; it isolates the drawing.

It loops six seconds of silence and then the line, record the screen for 180 s, and have `measure-pulse.ts` judge the recording. Because the film's Jarvis shows speech as activity rather than as a pulse, what it compares is **how much the hologram changes** — the mean frame difference from one tenth of a second to the next, smoothed over half a second — against the **agitation envelope** the app's own `advanceVoiceActivity` makes from the same recorded readings. Activity is measured over a crop widened by a quarter of the sphere's width on each side — half its radius — so the chips thrown out past the rim are inside the measured area rather than cut off by it. The silence rule keeps the old, sphere-sized crop, because its threshold counts change per pixel and the wider crop's black margin would dilute it.

The thresholds are fixed in the file, before anything is measured:

- activity correlates with agitation at **0.5** or better, and at least **0.2** better than with the same agitation played backwards — the control for how much of any best-of-many-offsets match is luck;
- the hologram is at least **1.3×** busier while he speaks than while he is silent;
- it keeps moving through silence: the raw change per tenth of a second, averaged over each two seconds of silence, is at least **1/255** per pixel in *every* judged stretch (averaged, because screenrecord only emits a frame when the screen changes, so at an emulator's frame rate most tenth-second pairs are one frame repeated);
- and the film guard — mean brightness while speaking is **at most 1.3×** the silent mean. A hologram that flashes with the voice fails here, which is the opposite of what the previous design was asked for.

Brightness against agitation is reported in `pulse.json` as a number to look at, and nothing passes or fails on it.

The script boots its own AVD, `jarvis-hologram-check`, and prints how to create it when it is missing; a device that is already attached is used instead, and the script says so.

**Both passed — on the previous design.** The run below measured the hologram as it was before the film redesign, when brightness was meant to follow loudness and `measure-pulse.ts` asked it to; its correlation and brightness-ratio rows answer a question the check no longer asks, and the brightness ratio of 1.68–1.69 would now fail the film guard by design. **The check has to be re-run on this design**, and this table replaced with what it reports, before the device behaviour can be called verified again. The tone, frame-count and emulator rows below still describe the machine and the audio path, which have not changed.

> **The `microphone` column is a record of something that can no longer be run.** That mode drove
> sample mode's own microphone, which the app no longer has — see "Sample mode" above. The numbers
> are left because what they proved about the native audio path is still true and was expensive to
> establish; they are simply not reproducible with this script any more.

Run on 2026-09-15 on the same WSL2 machine, against AVD `jarvis-hologram-check`: the same android-34 `google_apis` x86_64 image at 540×960 and 240 dpi, 4 cores, 2 GB, `-gpu swiftshader_indirect`.

| Measure | `microphone` | `replay` | Threshold then |
| --- | --- | --- | --- |
| Tone: the app ÷ Android's HAL | 0.1412 ÷ 0.1413 (−0.01 dB); silence around it ≤ 0.0001 | — | within 1 dB; silence ≤ 0.01 |
| Correlation with the voice | 0.739 | 0.719 | ≥ 0.5 |
| Correlation with the reversed voice | 0.372 (margin 0.367) | 0.344 (margin 0.375) | margin ≥ 0.2 |
| Brightness, speaking ÷ silent | 61.7 ÷ 36.7 = 1.68 | 57.6 ÷ 34.1 = 1.69 | ≥ 1.1 |
| Mean change per tenth of a second, stillest two seconds of silence | 1.46 (2.41 over all silence) | 1.06 (1.69 over all silence) | ≥ 1 in every two seconds |
| Distinct frames recorded in 180 s | 462 | 487 | — |

**That run is the original pulsing hologram, and the check does not pass today.** It is kept because what it proves about the audio path still holds. The drawing has since been rebuilt around the film study and then rebuilt again around the user's asks, and on the same emulator it now renders 286 distinct frames in 180 s where the original managed 462 — about 1.6 a second. The three activity rules cannot be met at that rate: sampled ten times a second, five of every six samples are the same frame as the one before, so nothing can correlate with a voice. The latest run (2026-09-16, `microphone`, the turning-and-glowing drawing) reads:

| Measure | Got | Threshold | |
| --- | --- | --- | --- |
| Tone: the app ÷ Android's HAL | 0.1412 ÷ 0.1413 | within 1 dB | pass |
| Brightness, speaking ÷ silent | 1.052 | 1.02 to 1.3 | pass |
| Correlation with the voice | 0.181 | ≥ 0.5 | fail |
| Activity, speaking ÷ silent | 1.178 | ≥ 1.3 | fail |
| Mean change per tenth of a second, stillest two seconds of silence | 0.76 | ≥ 1 | fail |

Every one of those has improved with each build — motion 0.56 → 0.65 → 0.76, correlation 0.062 → 0.068 → 0.181 — and all three are limited by the frame rate rather than by what the drawing does. The emulator rasterises in software (`-gpu host` segfaults on this machine), and `dumpsys gfxinfo` puts 1200 ms of each 1208 ms frame on the CPU with 8 ms of drawing. **Do not adjust these thresholds to make it pass.** Either the drawing gets several times cheaper again, or this check is honestly reported as unable to measure it, and the phone is the judge.

The stills that run left in `tests/hologram-preview/evidence/` show the same thing by eye: during silence, a dim sphere of thin arcs that keeps turning; during speech, a brighter and fuller one. The film design is meant to look different there — the same brightness either way, and a busier, looser ball while he talks — which is the change the re-run has to confirm.

What those numbers do and do not say:

- **The microphone run proves the bytes are read right, independently of the tone's own level.** The emulator's injection path doubles the amplitude before Android sees it: a tone injected at RMS 0.0707 was logged by the HAL at −17.0 dBFS, RMS 0.1413, and one at 0.177 read 0.354 — linear, so a gain, not clipping. The app agreed with the HAL both times. A sample read with its bytes swapped would not be off by a clean factor; it would read as loud noise. The emulator records at 8 kHz, which is also what caught `voiceRangeBins` repeating the top bin across frequencies 8 kHz audio cannot hold; they now read as silence.
- **The replay numbers predate the shared analyser.** That run replayed readings from the first version of `analyse-voice.ts`, whose spectrum window started at each reading rather than ending there, and which had its own copy of the FFT. It has not been re-run since `analyse-voice.ts` moved onto `hologram/src/voice-analysis.ts`; the microphone run, which uses the new analysis end to end, has.
- **The margins are not always wide.** An earlier microphone run, with another session's Chromium busy on the same machine, drew only 356 frames in 180 s and cleared the reversed voice by 0.243 against 0.2 (correlation 0.651); the one in the table drew 462 and cleared it by 0.367. The replay's stillest two seconds of silence were 1.06 against 1: the first two seconds after speech, holding five distinct frames that each changed by 4.2/255 per pixel, diluted by the three samples in four that repeat a frame. Neither threshold was moved after a run. A slower emulator could fail either with nothing wrong in the app.
- **The voice is played eight times slower than it was spoken.** The emulator draws with a software GPU at 2–3 frames a second — profiling on the larger Pixel 6 AVD put most of each frame in carrying GL calls through the emulator's pipe (about 64% kernel and GL transport, 12% Skia, 4% Hermes) — and syllables four times a second cannot be followed at that rate however correct the app is. The slowdown was set for that reason before any measurement: in replay each reading is held longer, and for the microphone the audio itself is slowed with `atempo`, pitch kept. The analysis, the folding, the real-time easing, the drawing and the thresholds are unchanged. `-gpu host` crashed this machine's emulator (D3D12/Vulkan under WSL2), and `-gpu guest` fell back to a slower software renderer. That profile predates `DRAWN_IN_A_LAYER`. The app's window has no stencil on the emulator either, so Skia was triangulating the particle halos on the CPU and sending the triangles through that pipe as fresh vertex data every frame — megabytes of it at full density, going by the CanvasKit model above. The check is worth re-running before concluding that the emulator cannot measure the drawing; but the antialiased strokes' masks, a few megabytes a frame, cross the pipe with or without the layer, so do not count on it passing.
- **Earlier runs failed, and each failure is handled in the script:** an emulator killed by a segfault while Gradle compiled beside it, "not responding" dialogs over the app, `adb input text` dropping characters, and — correctly — a clock that capped each frame's step at 100 ms and so turned the hologram at a quarter of real speed on a 370 ms-a-frame emulator.
- **Not checked:** how smooth it is on a phone's GPU at full frame rate; a live ElevenLabs session, where `jarvis-voice.ts` has to find Jarvis's track in the room and `listenToTrack` has to attach to a remote track rather than the recorder (the fallback if either fails is the SDK's readers); and the LiveKit byte-order problem itself, which is read from the code and which the app now avoids rather than measures.

## Scope Guidelines for Commits

Use mobile-specific scopes: `mobile`, `assistant`, `conversation`, `settings`.
