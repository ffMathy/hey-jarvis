---
paths:
  - "mobile/**"
---

# Testing

> Part of [Mobile App](mobile.md). Paths in it are relative to `mobile/` unless they say otherwise.

Everything under `src/` that can be tested without a device is, and it runs in the ordinary offline suite:

```bash
bunx turbo test --filter=mobile
```

Tests must not import React Native or any Expo native module — there is no runtime for them under `bun test`. Keep logic worth testing in plain `.ts` files (`assist-link.ts`, `elevenlabs-settings.ts`, `conversation-token.ts`) and let the `.tsx` files stay thin enough to read. Where such a file also reads the store — `jarvis-server.ts` does — its spec replaces `key-value-store` with `mock.module` before importing it, since the real one pulls in `expo-secure-store` and React Native with it.

`turbo build` bundles the JavaScript with Metro rather than assembling an APK. That needs no Android SDK, so it runs in CI's dev container on every push, and it still catches the failures a bundle can catch: an import that does not resolve, a native module missing from the tree, a file no test imports. The native build — Kotlin, Gradle, the manifest merge — is exercised by the Mobile APK workflow, only when the app changes.

## The browser tests

`turbo e2e --filter=mobile` exports the production web build and drives it in Chromium — the real bundle, served over HTTP, clicked through. It runs in CI alongside the rest.

The boundary is the ElevenLabs session, which needs a real API key and real quota. Everything up to it is exercised for real: the first-run tour (its two steps in a browser, its links, Back, and the side trip to sample mode and back), settings validation, persistence across a reload, the hologram drawing and moving with CanvasKit loaded from the export's own `canvaskit.wasm`, and the token request to ElevenLabs — its `xi-api-key` header, agent ID and participant name, and that the key never appears in the URL — along with how a rejected key and an unknown agent are explained. The typed field is covered on both of its paths: that a refused microphone still opens a conversation — dialled by asking for a **signed URL** rather than a token — and that the field stops saying "Connecting…" once nothing is; and that a microphone that *works* gets the same field beside it, over a token and not a signed URL, since a typed line there is answered out loud and quietly turning it into a text-only session would be the one way to lose that. A `start` that never opened a session at all gets no field, which is the phone's refused microphone by another route. The greeting is covered by counting `HTMLMediaElement.play()` in the page — the player fetches the recording at mount whether or not it plays, so a request proves nothing: it plays once from the export's own assets beside the token request, plays without being refused in a tab nobody has clicked — with the microphone held for it let go afterwards — and does not play in the text-only session, whose `conversation_initiation_client_data` must carry no `first_message`. The override on a voice session travels over LiveKit's data channel, which these tests close, so it is pinned by `greeting-handover.spec.ts` in `hologram` instead. Both URLs are intercepted with `page.route`; every other non-localhost request is aborted, and non-local WebSockets are closed, so a test can never dial out. Playwright answers CORS preflights for routed requests itself, so whether ElevenLabs' real CORS policy admits the web build is **not** covered — the test checks instead that the request carries no header besides `xi-api-key`, which is all a preflight would have to allow.

**The camera is covered end to end in the text-only session**, whose socket the suite plays ElevenLabs' side of (`listenAsTheAgent`) — its handshake gives the conversation the id `conv_1` — with the Jarvis server answered by `page.route`. Every conversation with a camera in it first saves a Jarvis server on the settings screen (`saveJarvisServer`) while the conversation the tour landed on is still connected, the way sir would, and carries on in the conversation that replaces it. With a server: the page tells the agent once that there is a camera button here, and shows it; a tap opens the file chooser, tells the agent the camera is open, `POST`s `{"conversationId": "conv_1"}` to `<server>/api/photos/slots`, `PUT`s the picked image as a JPEG to `<server><uploadPath>` with no `Authorization` header, and then takes sir's turn naming the photo, "(photo photo7)"; backing out of the chooser sends `user_activity` in the tap, while it is open, and then the note that the camera was closed, with no upload and no turn; a slot refused with a `403` in the server's envelope takes the turn saying the photo did not reach him, with the phone's reason; a picked file the browser cannot draw takes the turn saying it could not be read as a photo, never the note that the camera was closed; and a conversation that ends while the chooser is open — the settings saved, and a new conversation opened, before the photo is picked — still has the photo uploaded to the slot opened at the tap, while the new conversation hears neither a turn naming it nor the note that the camera closed. Without a server, or once it is cleared: no note and no button. The settings screen refuses an `http` address that is not `localhost`, a path and a user name, and saves nothing else on the screen with them; keeps a bare host as its `https` origin across a reload; and leaves an address it could not read alone when the rest of the screen is saved. What it cannot reach is the phone's camera app, the assistant's window stepping aside for it, and whether the server's real CORS admits the web build's origin, since Playwright answers routed preflights itself — see below.

**The hologram is two canvases where the browser has WebGL 2**: Skia's, under the test id `hologram-picture`, and the GPU body's, `hologram-body`. Chromium draws the GPU body on SwiftShader there, and a locator for "the canvas" inside `hologram` would find two; look for the one by its id.

**`hologram-body.spec.ts` checks his body on the GPU, on a stopped clock.** Playwright's fake clock (`page.clock`) is stopped on the tour, before sample mode opens, and every frame after that is one the spec steps, at ten frames a second. That is what makes two pictures comparable: on the real clock the density loop steers the share of particles by whatever frame rate the machine manages, so two pages would never draw the same particles at the same moment. Stepped at ten, both shed to the floor (250 sparks) and draw the same moment, the same way, every run. The spec covers:

- **the GPU path**: a WebGL 2 context on the body's canvas, every frame after the arrival lit, centred where Skia's sphere is and the size of it — read from the canvas inside the frame, by wrapping expo-gl's `endFrameEXP`, since there is no drawing buffer to read afterwards — none of its light outside the hologram's square on the page and nearly all of it inside the sphere there, and the page showing, pixel by pixel, Skia's picture and the body's Screened together (within 16 levels, measured at 8; laid on top instead, 58) — and the body's drawing buffer tagged Display P3, as React Native Skia tags its own, which only the tag can show: Chromium here does not manage colour, so an sRGB body looks the same in its screenshots while a phone's browser shows it paler and yellower than the rest of him;
- **no WebGL 2**: a browser with none at all, where there is no GL view, and one that refuses only the body's canvas, where expo-gl hands over WebGL 1 and the view gives the GL view up — both drawing the rest of him from the first frames, not after `BODY_READY_TIMEOUT_MS`, with his clock and the density loop running and no error. Only the body's canvas is refused there because CanvasKit itself cannot fall back where `WebGL2RenderingContext` exists but is refused, and throws `failed to create webgl context: err 0`;
- **a context lost mid-show** (`WEBGL_lose_context`): no body on screen within three frames, the rest of him going on, still him once the page is laid out again — which is when a browser would paint the lost canvas as its white placeholder — and the body back once the context is restored and expo-gl hands it over again;
- **a body that never becomes usable**: its context made and the body built in it, but every frame finding the context lost — the browser's stand-in for expo-gl's lookup on the UI runtime coming back empty, which nothing else here can make happen — so he is held at the start of his arrival, unlit and with the GL view still there, until `BODY_READY_TIMEOUT_MS` lets the rest of him arrive without it;
- **the tilt**, through a stand-in for the browser's `GravitySensor` that reads only when the spec hands it a reading before a frame: readings bring the eye in from infinitely far (36% of the body's canvas changes; a tenth is required), two phones handed the same readings draw the same body to the byte, a 15° tip turns him (31%) and, held, he is back straight on within five seconds; and he comes back to the foreground on a fresh reading — a phone that moved while the app was away shows him straight on, where the reading Reanimated used to keep put a fifth of the canvas out. Which way each gesture turns him is `tilted-view.spec.ts`'s, in `hologram`.

A stepped clock surfaces an exception thrown in any timer or frame callback as a failure of `fastForward` itself, rather than as a page error. The hologram's own numbers are written into the spec rather than imported: its main entry takes Skia's enums from a module Node cannot load.

Every test that needs a configured app walks the tour first, through the `walkToCredentials` helper: the app no longer opens on a form, so a spec that types into one without pressing Next is a spec that fails on a missing field rather than on what it was checking.

Set `CHROMIUM_EXECUTABLE_PATH` to run against a Chromium that Playwright did not install itself — useful in a sandbox that ships a browser of a different build than the pinned `@playwright/test` expects. Leave it unset everywhere else.

## What CI cannot test, and what stands in for it

**Showing Jarvis a photo on a device** has not been run on one yet. Before relying on it, check on a phone or an emulator with a camera app: that the camera comes up over the assistant's window and the window comes back after it with the conversation still open; that the same works from the app's own activity, where the conversation's JavaScript is paused behind the camera — LiveKit's keep-alive runs on JavaScript timers, so a long capture may cost a reconnect; that ElevenLabs does not end a call while sir frames a shot in silence; that the slot request, its preflight and the upload all pass the Cloudflare Access bypass for `/api/photos/*` and reach the server through the tunnel; that ElevenLabs reports a phone's live conversation — over WebRTC as well as the socket — with the agent and status the server's check expects; and that a receipt arrives upright. What stands in for the native half meanwhile is `take-photo.contract.spec.ts` — the provider's authority and directory, the activity's manifest entry, the module's function names, the photo's size, and the answer for a photo that could not be made ready to send, read out of the Kotlin, the manifest and the resource as text — and the Mobile APK workflow compiling it.

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

What the script does **not** cover is whether the conversation then starts on its own, because that needs a real session. It was checked by hand on the same emulator, pointing the app (then still configured with the address of the token server it used at the time) at a local listener that logged one line per token request — one line per `start()`. That found a real bug: only the first summoning after the app process started opened the microphone, and every later one brought Jarvis to the front and waited for a tap (`0, 0, 0` requests for three summonings; `1` for tapping Talk). The system keeps an assistant's process alive while it holds the role, so on a phone that is almost every summoning. It is fixed — each summoning now carries a `summon` value that differs every time, and the screen claims each URL once per process (`createAssistLaunchClaim` in `assist-link.ts`) — and the same measurement then gave one request for every summoning. One summoning out of fourteen after the fix produced no request, immediately after a reinstall, and did not happen again in thirteen further attempts, including ones that recreated those conditions; its log had already been cleared, so its cause is unknown.

Two things the emulator showed about the role itself, both Android's behaviour rather than the app's: **Force stop** and **Clear storage** on Jarvis's App info screen each hand the assistant role straight back to the default — `VoiceInteractionManager` logs `Force stopping current voice interactor` and clears the role holder. An app update and ordinary process death keep it. So a user who force-stops Jarvis has to pick it again in Settings, and the assistant card will say so when the app next comes to the foreground.

What guards the handover in the meantime is `src/assist-link.contract.spec.ts`: it reads the URL out of `AssistLauncher.kt`, the `scheme` out of `app.config.ts` and `ASSIST_URL` out of `assist-link.ts`, and fails if they disagree. That drift is silent otherwise — the build passes, the app installs, the registration stays valid, and the gesture opens an app that waits to be asked again.

Two things that would otherwise ride on reasoning alone have been checked another way, and are worth re-checking the same way if the manifest or the Kotlin changes:

- The Kotlin compiles against a real `android.jar`, which is what catches a misused framework API.
- The library manifest merges as intended. Running AGP's own `ManifestMerger2` over the generated app manifest plus this module's and LiveKit's, with `REMOVE_TOOLS_DECLARATIONS` on, puts all four components in the output with `exported="true"` and `BIND_VOICE_INTERACTION` intact, and confirms `blockedPermissions` really does drop LiveKit's `CAMERA`.

## The hologram on a device

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
- **The voice is played eight times slower than it was spoken.** The emulator draws with a software GPU at 2–3 frames a second — profiling on the larger Pixel 6 AVD put most of each frame in carrying GL calls through the emulator's pipe (about 64% kernel and GL transport, 12% Skia, 4% Hermes) — and syllables four times a second cannot be followed at that rate however correct the app is. The slowdown was set for that reason before any measurement: in replay each reading is held longer, and for the microphone the audio itself is slowed with `atempo`, pitch kept. The analysis, the folding, the real-time easing, the drawing and the thresholds are unchanged. `-gpu host` crashed this machine's emulator (D3D12/Vulkan under WSL2), and `-gpu guest` fell back to a slower software renderer. That profile is of Skia drawing all of him, his body's strokes and halos included; his body is the GPU's now, so the check is worth re-running before concluding that the emulator cannot measure the drawing.
- **Earlier runs failed, and each failure is handled in the script:** an emulator killed by a segfault while Gradle compiled beside it, "not responding" dialogs over the app, `adb input text` dropping characters, and — correctly — a clock that capped each frame's step at 100 ms and so turned the hologram at a quarter of real speed on a 370 ms-a-frame emulator.
- **Not checked:** how smooth it is on a phone's GPU at full frame rate; a live ElevenLabs session, where `jarvis-voice.ts` has to find Jarvis's track in the room and `listenToTrack` has to attach to a remote track rather than the recorder (the fallback if either fails is the SDK's readers); and the LiveKit byte-order problem itself, which is read from the code and which the app now avoids rather than measures.
