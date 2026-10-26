---
paths:
  - "vr/**"
---

# VR

> Paths in this rule are relative to `vr/` unless they say otherwise.

Jarvis in your room, on a Meta Quest. A WebXR page that opens an `immersive-ar`
(passthrough) session and waits: say "Hey Jarvis" and he appears where the room
has space in front of you, greets you, and holds the full ElevenLabs
conversation — the same hologram, the same agent and the same rules for a
conversation as the phone and the watch, from the same `hologram` package. When
he has gone, the wake word is listened for again.

## Its rules

Each topic is a rule of its own, under the same paths:

- [Using it on a Quest](vr-using-it-on-a-quest.md)
- [Using it on a phone](vr-using-it-on-a-phone.md)
- [What is in here](vr-what-is-in-here.md)
- [Commands](vr-commands.md)
- [How the parts fit](vr-how-the-parts-fit.md)
- [The page, the room and its state machine (`src/page/`, `src/app/`, `src/xr/`, `src/ui3d/`)](vr-the-page-the-room-and-its-state-machine-src-page.md)
- [The wake word (`src/wake/`)](vr-the-wake-word-src-wake.md)
- [Where he stands (`src/room/`)](vr-where-he-stands-src-room.md)
- [The conversation (`src/conversation/`)](vr-the-conversation-src-conversation.md)
- [Entities placed in the room (`src/entities/`, `app/room-entities.ts`, `hologram3d/corona.ts`)](vr-entities-placed-in-the-room-src-entities-app-room.md)
- [Seeing him work (`src/satellites/`, `app/room-satellites.ts`, `hologram3d/satellites.ts`)](vr-seeing-him-work-src-satellites-app-room.md)
- [How he is drawn (`src/hologram3d/`)](vr-how-he-is-drawn-src-hologram3d.md)
- [The preview page](vr-the-preview-page.md)
- [The demo video](vr-the-demo-video.md)
- [The wake-word models, and their licence](vr-the-wake-word-models-and-their-licence.md)
- [The honest limits](vr-the-honest-limits.md)
- [What only a real headset can tell](vr-what-only-a-real-headset-can-tell.md)
- [The browser tests](vr-the-browser-tests.md)
- [Publishing: GitHub Pages, shared with the phone](vr-publishing-github-pages-shared-with-the-phone.md)

## Opening it on a Quest

- **Published:** see "Using it on a Quest" above.
- **From a pull request:** open
  `https://ffmathy.github.io/hey-jarvis/pr/<n>/vr/` — the **Web Preview**
  workflow publishes every push to a pull request there, and comments the link
  on the pull request (see below).
- **From a dev server:** WebXR needs HTTPS or `localhost`. With the headset on
  USB, `adb reverse tcp:5173 tcp:5173` makes the dev server `localhost` on the
  headset, then open `http://localhost:5173/`.
- Room data comes from the headset's Space Setup; Quest Browser asks for the
  spatial permission when a page wants planes or meshes, and a page can be
  refused it — so nothing about the room is required.

## CI

`build.yml` runs `bunx turbo e2e --filter=vr` on a line of its own after the
phone's, so the two suites never run at once. The Playwright config keys its CI
behaviour on `GITHUB_ACTIONS`, which the workflow passes into the dev container
(`CI` is not passed).

`vr#initialize` is uncached in `turbo.json`: it writes gitignored files, so a
cache hit would replay its log, restore nothing, and the build would publish a
site with no wake word.

## Scope Guidelines for Commits

Use the `vr` scope: `feat(vr): …`, `fix(vr): …`,
`test(vr): …`. A change to the shared drawing is `hologram`'s, even when it
is made for the headset.
