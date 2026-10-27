---
paths:
  - "hologram/**"
---

# Hologram

> Paths in this rule are relative to `hologram/` unless they say otherwise.

Jarvis himself: the sphere, the voice tracking that drives it, and the
conversation with the agent doing the talking. Shared by every app that *is*
him — `mobile/` and `watch/`, and `vr/`, the Quest headset app that stands
him in your room, which uses the main entry, `hologram/gpu` and the assets.

## Its rules

Each topic is a rule of its own, under the same paths:

- [Four entry points](hologram-four-entry-points.md)
- [What is in each](hologram-what-is-in-each.md)
- [The rule that makes this package work](hologram-the-rule-that-makes-this-package-work.md)
- [One conversation, three devices](hologram-one-conversation-three-devices.md)
- [What he is working on, and what sir points at: the line to the server](hologram-what-he-is-working-on-and-what-sir-points-at-the.md)
- [Two things about the ElevenLabs half worth knowing before changing it](hologram-two-things-about-the-elevenlabs-half-worth.md)
- [Summoned, he greets you before he is connected](hologram-summoned-he-greets-you-before-he-is-connected.md)
- [What is said while he connects is kept, not lost](hologram-what-is-said-while-he-connects-is-kept-not-lost.md)
- [What the phone's camera button needs of it](hologram-what-the-phone-s-camera-button-needs-of-it.md)
- [Worklets](hologram-worklets.md)
- [What he looks like](hologram-what-he-looks-like.md)
- [A second renderer: the headset](hologram-a-second-renderer-the-headset.md)
- [Him on the GPU, on a phone and a watch](hologram-his-body-on-the-gpu-on-a-phone-and-a-watch.md)
- [Tilt to look around, on the phone and the watch](hologram-tilt-to-look-around-on-the-phone-and-the-watch.md)
- [Tests](hologram-tests.md)

## Hanging up after a finished request

The apps do not decide this. A finished request that is followed by quiet is ended by the agent
itself — its `turnTimeout` of 3 s and its `end_call` tool — so no device registers a client tool
for it, and each sees it as the agent hanging up. No device registers a client tool of any kind (see
"What he is working on, and what sir points at").
