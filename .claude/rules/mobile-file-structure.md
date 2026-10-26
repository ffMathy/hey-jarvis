---
paths:
  - "mobile/**"
---

# File Structure

> Part of [Mobile App](mobile.md). Paths in it are relative to `mobile/` unless they say otherwise.

```
../hologram/src/                  # Jarvis himself, shared with the watch — see .claude/rules/hologram.md
├── elevenlabs-settings.ts        # the two credentials, and what is wrong with them
├── conversation-token.ts         # minting a token, and every ElevenLabs failure explained
├── hologram-drawing.ts           # what one frame of the hologram looks like (worklets)
├── voice-analysis.ts             # the FFT and RMS, the same for live audio and the emulator replay
├── voice-levels.ts               # spectrum folding, easing, and the agitation/burst tracker
├── voice-contract.ts             # JarvisVoice: the two questions the sphere asks a voice
├── greeting-handover.ts          # when the recorded greeting is over, and the override it comes with
├── jarvis-session.ts             # the conversation itself — the phone's, the watch's and the headset's
├── failure-text.ts               # what each failure says, in words rather than the SDK's
├── written-caption.ts            # which of his lines are written down: text mode, and the text-only session
├── react/                        # `hologram/react`, the half that needs a framework
│   ├── hologram-view.tsx         # Reanimated clocks, reading the voice every frame
│   ├── gpu-layer.tsx             # the one GL canvas all of him is drawn into, and waiting for the GPU
│   └── is-foreground.ts          # stops the clock and the microphone when nobody is looking
└── conversation/                 # `hologram/conversation`, the half that needs the ElevenLabs SDK
    ├── session.ts                # useJarvisSession: the session, the SDK, the greeting's player, the call's audio
    ├── greeting-player.ts        # "Hello sir, how can I help?" as call audio, by hologram's native module …
    ├── greeting-player.web.ts    # … and through expo-audio in a browser
    └── call-audio.ts             # the call's audio session, switched into before he greets

mobile/
├── app.config.ts                 # Expo config: package name, scheme, permissions, plugins
├── index.ts                      # registerRootComponent
├── metro.config.js               # monorepo resolution + singleton pinning
├── eas.json                      # development / preview / production builds
├── modules/jarvis-assistant/     # the local Expo module that owns the assistant registration
│   ├── index.ts                  # the JS side
│   └── android/src/main/         # Kotlin, the merged manifest, and res/xml — and the photo activity
├── modules/jarvis-audio/         # raw audio for the hologram: the microphone, or Jarvis's WebRTC track
└── src/
    ├── app.tsx                   # root component: the tour, settings, the conversation, sample mode
    ├── onboarding-screen.tsx     # the first-run tour: agents, credentials, assistant role
    ├── onboarding.ts             # its steps, which of them this device has, and every link
    ├── onboarding-storage.ts     # whether the tour has been walked
    ├── conversation-screen.tsx   # the hologram, and nothing else on the screen but a faint camera
    ├── settings-screen.tsx       # the two fields with no tour around them, for coming back to, and the Jarvis server
    ├── elevenlabs-fields.tsx     # the fields themselves, shared with the tour (which skips the server)
    ├── settings-storage.ts       # platform-agnostic half of persistence (the key and format are hologram's)
    ├── read-again.ts             # reading the keystore again when the reading, not the value, failed
    ├── watch-card.tsx            # whether Jarvis is on the paired watch, and the key handover
    ├── answer-the-watch.ts       # sends the credentials across whenever the watch asks
    ├── use-assistant-registration.ts  # whether Jarvis still holds the assistant role
    ├── assist-link.ts            # what "opened by the assistant" looks like
    ├── assistant-window.ts       # the window the assistant gesture opens, and retracting it
    ├── sample-screen.tsx         # sample mode: Jarvis alone, tapped to walk through his moods
    ├── sample-sheet.tsx          # the sheet he arrives in when summoned, and why he waits for it to settle
    ├── hologram-size.ts          # how big it is drawn on this screen
    ├── spark-density.ts          # how many particles this phone can manage
    ├── jarvis-voice.ts           # following Jarvis's track for the session on Android: tapped and analysed …
    ├── jarvis-voice.web.ts       # … and in a browser, the same track through Web Audio
    ├── agent-audio-track.ts      # this app's Room check, and Android's native ids for Jarvis's track
    ├── tapped-voice.ts           # raw samples from modules/jarvis-audio → volume and spectrum
    ├── use-photo-sending.ts      # showing Jarvis a photo: the button's tap, the note that it is here, the heartbeat
    ├── use-screenshot-sending.ts # what was on the screen he was summoned over, sent once he is connected
    ├── screenshot-sending.ts     # that screenshot, from the phone to the server and a note to the agent
    ├── summoning-screenshot.ts   # reading it from modules/jarvis-assistant …
    ├── summoning-screenshot.web.ts  # … and nothing in a browser, which is never summoned over anything
    ├── photo-sending.ts          # one tap, from the camera opening to Jarvis hearing how it went
    ├── photo-messages.ts         # every word the phone puts into the conversation about the camera
    ├── photo-upload.ts           # asking the Jarvis server for a slot, sending the photo to it, reading back its id
    ├── jarvis-server.ts          # where the Jarvis server's address is kept (what it may be is hologram's)
    ├── camera-button.tsx         # the camera beside him
    ├── take-photo.ts             # the phone's own camera app, through modules/jarvis-assistant …
    ├── take-photo.web.ts         # … and a file picker in a browser
    ├── typed-message-field.tsx   # writing to Jarvis instead of talking, and he still answers aloud
    ├── written-reply-line.tsx    # the last thing he said in writing: the one thing on this screen to read
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

Most of what this screen runs is not in this tree, because the watch and the headset (`vr/`)
run it too: **the conversation itself** is `hologram`'s session (`jarvis-session.ts`), which this
screen holds with `useJarvisSession` from `hologram/conversation` — the greeting, the token, the
twenty-second deadline, the failures in words, the tool calls, the listening lattice's score, the
dropping of what an interruption leaves queued, text mode's muted microphone and written lines. See
"One conversation, three devices" in `.claude/rules/hologram-one-conversation-three-devices.md`. So are whether a conversation is open
or has ended (`conversation-life.ts`), his voice analysed from what a browser plays
(`played-voice.ts`), finding his track in the room (`agent-audio-track.ts`), his last written line
(`written-reply.ts`), and the settings' storage key and format (`elevenlabs-settings.ts`). They are
in `hologram/src/`, with their specs. What this app hands the session is only what is its own: its
name in the history, its `Room` check, how it follows his track (`jarvis-voice.ts`), its toast, and
the microphone it asks for before summoning him.

**There is no ElevenLabs React provider any more.** `@elevenlabs/react-native` is still the first
import in `app.tsx`, for its side effects — it registers the native session strategy on
`@elevenlabs/client`, whose `Conversation.startSession` the session dials with — but nothing else is
taken from it. The provider reported any `onError` as the conversation's status, so a non-fatal
error once connected faded Jarvis out while his voice played on; its twenty-second deadline showed a
line but never ended a session that connected late; and the SDK's and LiveKit's own words reached the
screen. The session gets all three right. It lasts as long as the screen: opening settings ends the
conversation.
