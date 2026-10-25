---
paths:
  - "hologram/**"
---

# Two things about the ElevenLabs half worth knowing before changing it

> Part of [Hologram](hologram.md). Paths in it are relative to `hologram/` unless they say otherwise.

**The participant name is a required argument, not a default.** Each device
names itself in the ElevenLabs conversation history — `jarvis-android`,
`jarvis-wear` and `jarvis-vr` — and the point of the names is to be told
apart, so a conversation held on the wrist is distinguishable from one held in
a pocket or in a headset. All three constants are in `conversation-token.ts`
and none is the default, because a default is how the watch ends up filed under
the phone's name.

**Nothing from an error response is ever repeated back.** `conversation-token.ts`
reads only `detail.status` and `detail.code`, and only when they look like the
fixed identifiers they are. The free-text message beside them is never read: it
can echo the request, and the request carried the API key. There is a test that
puts a key-shaped string in every field of every failure and asserts it never
reaches the message.

`simulated-voice.ts` is the one place with no `'worklet'` on anything, and that is deliberate: it
is read where a voice is read — the JS thread, every 40 ms — and never on the UI thread. It makes
up the two voices sample mode can show without a microphone, Jarvis speaking and Jarvis working,
as spectra, so they go through every step a real voice does and nothing downstream can tell.
It also makes up someone talking *to* him (`simulatedUserAt`) — a voice-activity score and a
microphone level — for sample mode's listening phase.

**Listening is not a voice of his.** While someone talks to Jarvis his particles snap onto a
hexagonal lattice that turns slowly inside the ball and breathes with how loud they are
(`latticeFragment`, `latticeTarget`); the whorl recedes so the lattice is what is seen. It is
driven by a `UserVoice` — ElevenLabs' `vad_score` and the microphone's input level in a
conversation, `simulatedUserAt` in sample mode — handed to the view as `user`, eased per frame by
`hearing.ts`. Only the score switches it on, past the firmware's own 0.25, so the phone, the watch
and the Voice preview agree on when someone is speaking; the level only sets how hard the lattice
breathes. It replaced a ring of ticks outside the limb, which the user found too plain, and was
chosen over drifting clusters, orbital rings, ripples and a galaxy's arms.

**The arrival is a vortex.** Particles leave the core nearest first and spiral out a turn and a
half before settling (`swirlFragment`); it moves only the particles being drawn, so the scene's
count and the density share hold throughout.

**The offline renders draw no body.** `.scripts/render-preview.ts` (the arrival, the listening
lattice and the greeting, to WebM), `render-showcase.ts` (the README's clips and cover) and
`render-play-assets.ts` (the Play listing and the apps' icons) draw with `drawHologram` under
CanvasKit in Bun, which has no GPU, and `drawHologram` no longer draws his body. Until they draw the
body on a GPU (in a headless browser, through `hologram/gpu`, as vr's preview does), what they render
is everything but his body: do not regenerate the committed clips, stills or icons from them.

**Sample mode is shared, and only sample mode has a readout.** Both devices have one — the phone's
before there is an account, the watch's while it waits for the phone — so the moods, their order,
their names and the readout's text live in `sample-mode.ts`, and the voice hook, the mood toast and
the frame-rate readout in `hologram/react/sample`. The voices themselves are `sample-drive.ts`
(`simulatedJarvisVoice`, `simulatedUserVoice` and, for a whole mode, `createSampleDrive`): the hooks
wrap it, and the headset's sample mode calls it directly. Each component takes a `style`: where it sits is
the app's decision, since a round watch face and a phone sheet want different places. The
conversation screens show no frame rate and no particle count on either device.
