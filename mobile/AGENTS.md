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
../hologram/src/                  # the sphere itself, shared with the watch — see ../hologram/AGENTS.md
├── hologram-drawing.ts           # what one frame of the hologram looks like (worklets)
├── voice-analysis.ts             # the FFT and RMS, the same for live audio and the emulator replay
├── voice-levels.ts               # spectrum folding, easing, and the agitation/burst tracker
├── voice-contract.ts             # JarvisVoice: the two questions the sphere asks a voice
└── react/                        # `hologram/react`, the half that needs a framework
    ├── hologram-view.tsx         # Skia canvas, Reanimated clocks, reading the voice every frame
    └── is-foreground.ts          # stops the clock and the microphone when nobody is looking

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
    ├── app.tsx                   # root component: settings, conversation, and sample mode
    ├── conversation-screen.tsx   # the hologram, the Talk button and the assistant card
    ├── sample-screen.tsx         # sample mode: Jarvis alone, tapped to walk through his moods
    ├── sample-mode.ts            # the four moods, and the order a tap walks them in
    ├── simulated-voice.ts        # speaking and thinking as a JarvisVoice, made from the clock
    ├── jarvis-hologram.tsx       # the hologram on Android …
    ├── jarvis-hologram.web.tsx   # … and in a browser, once CanvasKit has loaded
    │                              #   (both are two lines over `hologram/react`)
    ├── hologram-size.ts          # how big it is drawn on this screen
    ├── jarvis-voice.ts           # Jarvis's voice on Android: his track, tapped and analysed …
    ├── jarvis-voice.web.ts       # … and in a browser, as the SDK measures it
    ├── agent-audio-track.ts      # finding Jarvis's track in the conversation's LiveKit room
    ├── tapped-voice.ts           # raw samples from modules/jarvis-audio → volume and spectrum
    ├── sdk-voice-readers.ts      # the SDK's own readers, made safe to call before a session
    ├── settings-screen.tsx
    ├── assist-link.ts            # what "opened by the assistant" looks like
    ├── conversation-token.ts     # minting a conversation token from ElevenLabs
    ├── elevenlabs-settings.ts    # validation of what the user typed
    ├── settings-storage.ts       # platform-agnostic half of persistence
    ├── platform-contracts.ts     # the shapes the .web.ts pairs below must keep
    ├── key-value-store.ts        # keystore on Android …
    ├── key-value-store.web.ts    # … localStorage in a browser
    ├── microphone-permission.ts      # PermissionsAndroid …
    └── microphone-permission.web.ts  # … getUserMedia
```

## The hologram

The conversation screen is built around Jarvis as the film drew him: the golden sphere from the *Avengers: Age of Ultron* lab scene. A round, see-through, warm amber ball, brightest at its core and never dark inside, textured with short bright strokes, bounded by one rim element at a time — a bright crescent on the left limb, a segmented ladder ring, or a thin ring — and a hooked ring at the core. The film's slow protrusions are deliberately not drawn: on a phone they read as an arm swinging out of the ball on a loop, and the user asked for them gone. It turns on its own — the body about the vertical axis, the rim rolling the other way — it materialises when it first appears, and when Jarvis talks it grows agitated, glows and swells.

None of those numbers are a guess. The proportions, the colours, the rotation speeds, what changes while Jarvis speaks and the order the ball assembles itself in were all measured frame by frame from the scene itself, and `hologram/src/hologram-drawing.ts` cites that study section by section beside the code each finding produced.

```
Android, in a conversation     Jarvis's WebRTC track ─ modules/jarvis-audio (AudioTap) ─ tapped-voice.ts ─ hologram/src/voice-analysis.ts
Android, in sample mode        WebRTC's recorder ────── modules/jarvis-audio (AudioTap) ─ tapped-voice.ts ─ hologram/src/voice-analysis.ts
Browser, in a conversation     @elevenlabs/react-native getOutputVolume / getOutputByteFrequencyData (AnalyserNode)
Browser, in sample mode        getUserMedia ─ AnalyserNode
  └─ a JarvisVoice (platform-contracts.ts), read every 40 ms on the JS thread
       └─ hologram/src/voice-levels.ts perceivedLevel + foldSpectrum → 24 log-spaced bands (targets)
            └─ hologram/src/react/hologram-view.tsx  UI thread, every frame: easeLevel/easeBands toward the
                 targets, and advanceVoiceActivity on the *raw* reading → agitation and chip bursts
                 └─ hologram/src/hologram-drawing.ts   drawHologram(canvas, size, frame, scene, resources) → Skia Picture
```

Every source hands the hologram the same two readings — a volume, and 1024 bytes of spectrum across 100–8000 Hz on Web Audio's decibel scale — so the drawing never knows which it is listening to. The volume is not quite the same quantity everywhere: on Android it is the RMS of the last 40 ms; in a browser it is what the ElevenLabs web SDK reports, the mean of that spectrum, and sample mode in a browser takes it the same way so the user's voice and Jarvis's are on one scale there. The two scales differ, so the threshold at which the sphere counts a voice as speech sits in a slightly different place in a browser than on a phone.

### Why Android analyses the audio itself

On Android the SDK's two readers come from LiveKit's native processors (`@livekit/react-native` 2.12.0), and neither is usable for this:

- **The spectrum is a comb.** The SDK asks for 1024 bars; at 48 kHz only 169 FFT bins fall in 100–8000 Hz, and every bar between two of them reads 0 (`MultibandVolumeProcessor.kt`). Two of the hologram's 24 bands could never light.
- **The volume reads each sample with its bytes swapped.** WebRTC hands sinks a `ByteBuffer` in Java's default big-endian order over little-endian PCM — the recorded-samples dispatcher wraps it with `ByteBuffer.wrap`, and the native sink wrapper sets no order — and `VolumeProcessor.kt` reads it as it comes, so anything above near-silence reads close to full scale. This one is read from the code; the app no longer goes through it, and it has not been measured.

So `modules/jarvis-audio` hangs its own `AudioTap` off the same audio — Jarvis's remote track in a conversation, or WebRTC's recorder in sample mode — reading the bytes little-endian into a ring of the last third of a second, and JavaScript pulls from it and analyses it with `hologram/src/voice-analysis.ts`. That is the same code that turns the emulator check's recorded voice into its replayed readings, so what the replay shows is what a phone computes.

Finding Jarvis's track takes one step outside the SDK's public surface: `useRawConversation()` is public, but the LiveKit room is on the conversation's protected `connection`. `agent-audio-track.ts` reaches it with `Reflect.get`, checks it is a real `livekit-client` `Room`, and follows the participant whose identity contains "agent" — as the SDK's own code does. `agent-audio-track.contract.spec.ts` reads the installed SDK and fails if any of that moves. If the track cannot be found anyway, the hologram falls back to the SDK's readers described above: it still draws and nothing fails, but a volume that reads near full scale for any sound at all makes the sphere treat every noise from Jarvis as full-blown speech — agitation snapping on and off with the reading rather than following his syllables — and two of its bands stay dark.

## Sample mode

Before the app is set up there is nothing for the hologram to follow, so the settings screen offers **"No key yet? Try the hologram"**. It opens `sample-screen.tsx`: the same hologram, in a sheet, walking through what Jarvis does.

**It used to listen to you, and it does not any more.** There was a fourth mood, `microphone`, that opened the phone's microphone and drove the sphere from your own voice — with a recorder of its own on Android (`MicrophoneRecorder`, `AudioRecord` with `VOICE_RECOGNITION`), a browser path through an `AnalyserNode`, a permission prompt, a recording indicator, and an end-to-end emulator check that played a tone in and compared what the app heard against Android's own audio HAL. All of it is gone, along with `sample-voice.ts`, `sample-voice.web.ts`, `UseSampleVoice`, and the emulator harness's `microphone` run.

What it bought was proof that the hologram follows a real voice, which is worth having — but sample mode is a thing to look at before there is an account, and the simulated voices in `hologram/src/simulated-voice.ts` show the same moods from the clock. Every mood is now a tap, and nothing on that screen opens a microphone.

- **A conversation still listens to Jarvis through WebRTC**, which is right: that audio is already inside WebRTC and never touches this path.
- **In a browser it is `getUserMedia` into an `AnalyserNode`** with the ElevenLabs web SDK's settings (`fftSize` 2048, smoothing 0.8), not connected to the speakers.

**The frame rate was geometry, not pixels.** On a phone this drawing ran at 8 frames a second while the same picture ran at 58 in that phone's own browser. Building the picture was 2.6 ms of a 120 ms frame, so it was not JavaScript; and it did not change with the size of the canvas, which ruled out fill rate. A GPU pays to turn every stroked path into triangles, and this drawing hands it about 1300 that are different every frame — and the particle halo strokes every one of them again, at ten times the width. A build with a third of that geometry ran at 57. **Measure geometry before pixels**, and remember that every headless benchmark here is a CPU scanline rasteriser where the opposite is true.

**A frame has two halves, and they are paid on different threads.** Building the picture is JavaScript, in a Reanimated worklet; painting it is Skia. Measure them apart — record into a `PictureRecorder` without flushing, then with — before changing anything for speed, because they are fixed by completely different things.

**Building the picture is boundary crossings, not arithmetic.** Skia's path builder sends every `moveTo` and `lineTo` across into native code as it is called. Measured with the JIT switched off, which is what Hermes on a phone is, a thousand two-verb dashes cost 4.41 ms that way, 0.91 ms handed over as one array of commands, and the arithmetic behind them 0.08 ms. The drawing batches them now (`pathOf` in `hologram-drawing.ts`). Cutting fragments is a poor trade by comparison: halving them saves under a quarter, because most of what is left is fixed.

**Painting is pixels.** Split apart headlessly, one frame at 384 px is 1.2 ms of building the picture and 49 ms of painting it, and the building does not change with size while the painting scales with area — 384 px costs 49 ms, 269 px costs 28 ms, 230 px costs 22 ms. The levers are `MINIMUM_FRAME_SECONDS`, which caps how often a picture is built and so bounds *both* halves at once — it is at forty a second, and has been at sixty and at thirty, which is the cheapest lever there is — and then pixels: `DRAWN_RESOLUTION` in `hologram/src/react/hologram-view.tsx`, which lays the canvas out at seven tenths and scales it up, and `SPHERE_FRACTION`, since a bigger sphere fills more of them. Fewer fragments, cheaper glyphs and shorter paths are all optimising the 1.2 ms. Measure the two apart before changing anything for speed.

The two costliest single layers to *paint*, measured by taking each out: the shadow (15 ms of the 49) and the particle halos (13 ms). The costliest to *build* is the fragment body, at 64% of it — and the cost there is the sheer number of path commands, not the fragment count, which is why halving the fragments saves under a quarter.

**Sample mode shows the frame rate in the corner**, counted on the UI thread where the frames happen and read twice a second by a leaf component. It reports what the device achieves, so sixty means it is keeping up with `MINIMUM_FRAME_SECONDS` and less is what it managed. Use it before and after any change made for speed.

**The square is bigger than the screen, and that is nearly free.** Chips are thrown to about 1.6R on a syllable and the drawing clips at the edge of its square, so a square the size of the screen cut them in mid-air. `useWholeScreenHologramSize` makes it half again wider and `SPHERE_FRACTION` is set against that, so the sphere is the same size on screen and the only thing that cuts a chip is the screen itself — where an edge cannot be seen. Measured, that cost 0.6 ms a frame, because Skia rasterises only what is drawn and everything drawn is sized from the sphere, the shadow included (`BACKDROP_REACH` is in sphere radii).

What each layer is, what the voice does to it, and which finding of the film study each number came from is written at the top of `hologram/src/hologram-drawing.ts`. These are the things worth knowing before changing it:

- **Layers, back to front.** A warm volume fill (one textured circle: the ball is lit through, never a dark disc with light drawn on it); the inner shells — a two-armed whorl winding out of the core, a long loop, a saturated arc, data streaks; the fragment body, 1,000 short strokes and glyphs inside 0.94R, turning about the vertical axis, plus a turning shell below the core; comet arcs and spokes; the core's bloom, hooked ring and knot; the bright fragments and their hot cores; a hairline ring at the limb; the rolling ladder truss; the bright left crescent; the fraying and streak arcs; the latest burst's chips; rare accents; and, only while it forms, the intro.
- **Idle motion, and only idle motion.** Nothing breathes, pulses or flickers as a whole. The outer rim layer rolls clockwise in the screen plane at 11°/s; the inner layer — whorl, loop, arc and a quarter of the fragments — counter-turns at 5°/s; the body itself turns about the vertical axis once every 24 s, each fragment living on its own 0.3–0.65 s clock and re-lighting near where it sits on the turning ball, with a shell below the core turning about the vertical axis into the film's sideways counter-streams. A 59-second script decides which rim element leads and how dense the fragments are, handing each over within a second or so.
- **Speech is activity, and only activity.** As in the film: the sphere's brightness and silhouette hold while Jarvis talks — measured at ±3% and ±1% — and what changes is behaviour. Fragments turn over about half again as fast, the crescent splits into thin arcs and opens gaps, the hot highlights all but go, the limb frays outward, and slabs of light break off the left limb on syllable onsets and in the gaps after them. `hologram/src/voice-levels.ts` turns the raw readings into an **agitation** envelope (up over 0.15 s while speech is present, down over 0.15 s, the same for a whisper as for a shout) driving the activity, and into **chip bursts**, which come in flurries of four a quarter-second apart and then rest for 0.6 s. The sphere also swells by up to `SWELL_WITH_VOICE`, which is movement rather than light.

  **It did not always hold.** `GLOW_WITH_VOICE` brightened the whole drawing with his voice for most of this app's life, because the user could not tell on a phone whether he was talking: it went in at 0.3 and was retuned to 0.8, 2.4, 1.6, 1.1 and 1.35 as each version was looked at on a real screen. It is 0 now — with the sphere most of the screen wide and the sparks drawn out into lines, the movement reads on its own, and on 2026-09-17 the user asked for the brightening gone. Measured, ordinary speech now lifts the disc 1–3% and a shout 5–9%, all of it from more lit pixels rather than brighter ones. Both `hologram/src/hologram-drawing.spec.ts` and the emulator check now pin the *holding* — a band, with a floor as well as a ceiling, because a sphere that dimmed while he talked would read as flinching and nothing else would catch it.

  **The fragments now turn over far more slowly than the film's, in both states.** At the film's rate the phone read as a sizzle — the user's word — while Jarvis spoke, "a surface boiling rather than a machine thinking", and what is wanted is his overwhelming calm. The calm pool is about twice as slow as the film's 0.2–0.6 s and the fast pool three to four times slower than it was; measured, that halves the speaking churn and takes a fifth off the idle. It does not take more off the idle however slow the pool gets, because what is left there is the ball *turning*, and the turn is still at the film's measured rate. Do not read the calm as a regression and speed it back up: see `pickFragmentRate`.
- **The body turns like a globe.** The film's interior does not spin — under 1-3°/s, measured — and the drawing held it pinned for that reason. It no longer does: the body turns about the vertical axis once every `BODY_TURN_SECONDS`, the rate the first hologram used, because a rim rolling round a still ball read as inert on a phone. The rim still rolls in the screen plane at the film's 11°/s and the inner shells still counter-turn at 5°/s.
- **The materialisation is a dial and a fade.** The film assembles the ball: a point of light, sparks, a band built out of flying pieces, the fill spreading patch by patch behind the dial, a ragged limb, and a tilted equatorial ring sweeping round. All of that is gone at the user's request — it was a lot of ceremony to sit through on every summoning. What is left is the spoked dial, swirling, while the sphere fades in behind it through a single layer and grows from `ARRIVAL_SMALLEST` to full size. `MATERIALISE_SECONDS` is 1.4, down from the film's 3.6: it plays on every summoning, and the user wanted it out of the way.
- **There are no specks, and the ladder ring is built once per weight.** The drawing used to scatter 220 blinking points over the ball, each a dot with its own halo. A speck cost about as much as a stroke — two crossings into Skia, then stroked five times over for its halo — while contributing a single dot on top of a thousand strokes already twinkling underneath, so it was 14% of a frame for something you had to look for. They are gone, the stroke count went up to make up the light, and the dim and mid halos widened to carry what their halos used to. The ladder truss is built in the rolling frame, so its shape depends only on its weight, which is constant except during a handover: the five paths are memoised on that weight, worth another 10%. Memoised on the *input*, so a frame still draws the same picture whatever preceded it — caching keyed on what happened last frame breaks `draws a frame the same way after other frames`, and rightly.
- **Onsets and gaps need memory, and memory needs `modify`.** `advanceVoiceActivity` writes into a state object that lives from frame to frame, and it is fed the *raw* reading rather than the eased one, because easing is exactly what smears a syllable's start into a slope. The view advances it inside `activity.modify(...)`, the way the bands are eased: a shared value assigned from the JS runtime gets a warning-only setter in the UI runtime, so writing to it directly would drop every update in silence in a development build and work in release. `hologram/src/voice-levels.ts`'s header says so at length.
- **It materialises.** The first 3.6 seconds after the canvas mounts replay the film's assembly — a point of light, sparks, band pieces, a spoked dial that snaps on and then breaks up, fragments arriving in patches with the fill washing in behind them, a tilted equatorial ring sweeping through — driven by `appearance = min(1, time / MATERIALISE_SECONDS)`, which the view computes from its own clock. At `appearance` 1 nothing of the intro is left.
- **It is all worklets.** `drawHologram` and every helper it calls start with `'worklet'` and use only their arguments and module-level number constants — no mutable module state, no closures, no `Math.random` while drawing; randomness comes from the seeded scene. The scene (flat number arrays, built once from a fixed seed) and the resources (paints, shaders, textures and mutable `PathBuilder`s, built once) are created per mounted canvas and must never be shared between two.
- **Loudness is eased on the UI thread, not the JS thread.** The SDK refreshes about 25 times a second; easing toward each reading every frame is what keeps the bands smooth, and `easeLevel` is exponential so the result is the same on a 60 Hz and a 120 Hz screen. The tracker is frame-rate independent for the same reason, and tested at 30, 60, 90 and 144 Hz.
- **It was designed by looking, and is tested by looking.** `hologram/src/hologram-drawing.spec.ts` renders it headlessly through CanvasKit — the same Skia API calls — and asserts on pixels: it moves when silent, it holds its brightness whether he speaks softly or loudly, speech shows as chips beyond the limb and more change than when calm, which bands are sounding changes the picture, the rim turns while the body stays put, it materialises and leaves nothing behind, nothing pops at a script boundary, no frame of the materialisation turns a tenth of the light on at once, and it stays inside its square. The device check is `.scripts/verify-hologram-on-emulator.sh`, below.

## First run

A new install opens on a three-step tour (`src/onboarding-screen.tsx`), not on the two fields it used to. The fields were an unanswerable question: nothing on that screen said what an ElevenLabs agent is, that Jarvis is one, or that the agent — not this app — is where the connections to everything else are made. Somebody who already had a key and an agent ID was the only person the old first screen worked for.

| Step | What it does |
| --- | --- |
| `agent` | What an agent is, that its tools are what make it an assistant, and links to sign up, build one, and read about webhooks and MCP servers |
| `credentials` | The API key and the agent ID, with a link to where each is found |
| `assistant` | The recommendation to hand Jarvis the assistant role, and the button that opens the picker — plus the watch card, when there is a watch |

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

For each conversation the app asks `GET https://api.elevenlabs.io/v1/convai/conversation/token` for a WebRTC token for that agent, and the session runs on the token; the key itself is used for nothing else. `conversation-token.ts` turns each failure into what to fix — a rejected key, a key without permission to start conversations (which ElevenLabs can also answer with 401), an agent ID the account does not have or a malformed one (400), an account out of credits (402), rate limiting (429) — by reading only ElevenLabs' fixed `detail.status` / `detail.code` identifiers. It never repeats anything else from a response, since a message can echo the request that carried the key.

This used to go through the MCP server, which held the key and handed the phone tokens behind a shared secret. It was changed so the app needs nothing but ElevenLabs: no server address, no second secret, no tunnel to reach. The price is a real credential on the phone, so give the app **its own key**, restricted to what a conversation needs where the account allows it — then a lost phone is one revoked key, not every integration on the account.

What the keystore does and does not do for that key:

- **It keeps it from other apps.** `expo-secure-store` encrypts the entry with a key held in the Android Keystore, which only this app's user ID can use.
- **It keeps it out of backups.** The `expo-secure-store` config plugin in `app.config.ts` adds backup and data-extraction rules that leave its storage out of Google's cloud backup and device-to-device transfer. (After a restore the entry would not decrypt anyway, since the keystore key never leaves the phone; the app then simply opens on the settings screen.)
- **It does not protect it from an update of this app — and the side-loaded APK makes that easy.** Anything installed as an update of `com.ffmathy.heyjarvis` runs as the same app and can read the key. Android only accepts an update signed with the same key, but the APK the Mobile APK workflow builds is signed with the Expo template's public debug key (see "Getting an APK onto a phone"), so *any* APK signed with that key qualifies — including the workflow's own builds of pull requests. Never install a pull request's APK over an install that holds your real key. Closing this properly means signing with a private release key kept in a CI secret that pull request builds cannot reach.
- **It is not autofill's.** Both settings fields opt out of autofill and password managers, so saving them does not copy the key into a synced vault.

Reading the key can also fail outright — a keystore key invalidated by an OS update, say — and that reads as "nothing stored": the app opens on the settings screen rather than hanging on its loading spinner.

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
- `@config-plugins/react-native-webrtc` is deliberately **not** installed. Its Android half only adds permissions, and two of them — `CAMERA` and `SYSTEM_ALERT_WINDOW` — have no business in a voice assistant. `app.config.ts` declares the permissions this app actually uses and blocks `CAMERA`, which LiveKit's own manifest would otherwise merge in.

`metro.config.js` points Metro at both this package's `node_modules` and the workspace root's, and keeps hierarchical lookup **on** — the usual monorepo advice to switch it off breaks bun's isolated layout, where walking up from the importing file is how a package finds its own dependencies.

It deliberately does **not** pin `react`, `react-native`, `livekit-client` and the LiveKit packages to one copy each, which is the other half of that advice. Bun's store is keyed by version and dependency closure, so it can hold a package twice — 19 of them do here — but none of those five, and bundling with and without the resolver gives the same hash and the same module count. The comment in the file says what the symptom would be if a bump ever splits one of them, and asks you to measure before adding it back.

The hologram adds three native packages, each at the version Expo 57 pins in `bundledNativeModules.json`: `@shopify/react-native-skia` 2.6.2, `react-native-reanimated` 4.5.1 and `react-native-worklets` 0.10.1. Two consequences that are easy to trip over:

- **`turbo initialize` has to have run.** Skia gets its prebuilt native libraries, and `canvaskit.wasm` for the web, from its own postinstall — which never runs here. `.scripts/initialize.sh` does those two copies instead (nothing is downloaded), and `build:apk` and `e2e` depend on it. Without it an Android build fails in CMake and the web hologram cannot load.
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

The boundary is the ElevenLabs session, which needs a real API key and real quota. Everything up to it is exercised for real: the first-run tour (its two steps in a browser, its links, Back, and the side trip to sample mode and back), settings validation, persistence across a reload, the hologram drawing and moving with CanvasKit loaded from the export's own `canvaskit.wasm`, and the token request to ElevenLabs — its `xi-api-key` header, agent ID and participant name, and that the key never appears in the URL — along with how a rejected key and an unknown agent are explained. The token URL is intercepted with `page.route`; every other non-localhost request is aborted, and non-local WebSockets are closed, so a test can never dial out. Playwright answers CORS preflights for routed requests itself, so whether ElevenLabs' real CORS policy admits the web build is **not** covered — the test checks instead that the request carries no header besides `xi-api-key`, which is all a preflight would have to allow.

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
- **The voice is played eight times slower than it was spoken.** The emulator draws with a software GPU at 2–3 frames a second — profiling on the larger Pixel 6 AVD put most of each frame in carrying GL calls through the emulator's pipe (about 64% kernel and GL transport, 12% Skia, 4% Hermes) — and syllables four times a second cannot be followed at that rate however correct the app is. The slowdown was set for that reason before any measurement: in replay each reading is held longer, and for the microphone the audio itself is slowed with `atempo`, pitch kept. The analysis, the folding, the real-time easing, the drawing and the thresholds are unchanged. `-gpu host` crashed this machine's emulator (D3D12/Vulkan under WSL2), and `-gpu guest` fell back to a slower software renderer.
- **Earlier runs failed, and each failure is handled in the script:** an emulator killed by a segfault while Gradle compiled beside it, "not responding" dialogs over the app, `adb input text` dropping characters, and — correctly — a clock that capped each frame's step at 100 ms and so turned the hologram at a quarter of real speed on a 370 ms-a-frame emulator.
- **Not checked:** how smooth it is on a phone's GPU at full frame rate; a live ElevenLabs session, where `jarvis-voice.ts` has to find Jarvis's track in the room and `listenToTrack` has to attach to a remote track rather than the recorder (the fallback if either fails is the SDK's readers); and the LiveKit byte-order problem itself, which is read from the code and which the app now avoids rather than measures.

## Scope Guidelines for Commits

Use mobile-specific scopes: `mobile`, `assistant`, `conversation`, `settings`.
