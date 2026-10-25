---
paths:
  - "hologram/**"
---

# Four entry points

> Part of [Hologram](hologram.md). Paths in it are relative to `hologram/` unless they say otherwise.

```
hologram               the design, the voice tracking, the ElevenLabs credentials, and the
                       conversation's framework-free parts — no framework
hologram/gpu           his body on the GPU: the headset's passes and a renderer over a bare
                       WebGL 2 context — no framework either
hologram/react         the same sphere as a React Native view you can render
                       (plus ./react/lifecycle and ./react/sample, which are Skia-free)
hologram/conversation  the hook a React Native screen holds its conversation with
hologram/assets/*      the files themselves (the greeting, the icons), for a bundler that takes
                       a file as a URL
```

The split is the whole architecture of this package, and the rule below is why
it exists. Reach for `hologram` when you want to know what Jarvis looks like,
how loud someone is, or what it takes to reach his agent; `hologram/react` when
you want him on a screen; `hologram/conversation` when you want him talking;
`hologram/gpu` when you want his body, which only a GPU draws.

**Why the ElevenLabs half is in here rather than in a package of its own.** It
was briefly its own workspace package, and that was one package too many: the
two halves are the same thing seen from two sides. A sphere with no conversation
is a screensaver and a conversation with no sphere is a phone call, and both
devices want both. Keeping them together also keeps one rule instead of two
about what may import what — see below — and the entry points already carry
that rule.
