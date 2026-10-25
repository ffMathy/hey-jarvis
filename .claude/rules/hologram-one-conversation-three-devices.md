---
paths:
  - "hologram/**"
---

# One conversation, three devices

> Part of [Hologram](hologram.md). Paths in it are relative to `hologram/` unless they say otherwise.

`createJarvisSession` (`jarvis-session.ts`) is the conversation on every device:
the headset calls it directly, and the phone and the watch through
`useJarvisSession`. It holds one summoning at a time on the SDK's own client —
the SDK's React provider is not used anywhere — and it is the only place the
rules live:

- **One start at a time, and stale callbacks dropped.** Every SDK callback is
  bound to the summoning that dialled it.
- **Status and mode come from the SDK's status and mode callbacks only.** The
  provider marked any `onError` as the conversation's end, so on the phone
  Jarvis faded out over a non-fatal error while his voice played on. An error
  once connected goes to the diagnostics and no further; the ending is
  `onDisconnect`'s to report.
- **Every failure ends in `failed`, with a problem in words** (`failure-text.ts`)
  and where it came from (`reaching`, `deadline`, `session` — the phone toasts
  the last). Raw texts — the platform's for being offline, LiveKit's for a room
  that would not open or closed — are replaced, and nothing that looks like a
  credential is ever shown.
- **The deadline ends what it gives up on.** A conversation that connects after
  `GIVE_UP_CONNECTING_AFTER_MS` is ended the moment its start resolves; on the
  phone it used to connect under a line saying it had not.
- **The greeting and the token start together** and the session is dialled
  behind him on every device, muted until he has finished.
- **A dropped line is redialled, not the end of him.** LiveKit rides out a
  short gap itself, but what it cannot — giving up on the room, or a change of
  network (Wi-Fi to mobile data) making it rejoin from scratch, which unwinds
  the agent's participant so the SDK reports the agent leaving — used to end
  the conversation, and on a phone that is every lift and tunnel.
  `isDroppedLine` (`connection-drop.ts`) tells those, and a written
  conversation's socket failing, from a call that is over (`end_call`, a room
  closed on purpose, a normal socket close, the maximum duration, the server
  ending it). A dropped line goes back to `connecting` with him still on
  screen, and the status held at `connecting` rather than `disconnected`, so
  nothing that folds it (`afterStatus`) sends him away. It redials at once with
  a fresh credential, then after 1, 2 and every 4 s, and gives up with
  `DROPPED_PROBLEM` after `REDIAL_GIVE_UP_AFTER_MS`. ElevenLabs cannot resume a
  conversation, so the new one skips its first message and is told, as a
  contextual update, that the line dropped and the last few lines said. The
  call's audio stays switched in across it. An agent that seems to leave a
  redialled conversation nobody has spoken in is taken at its word, so an
  agent that really did leave cannot bring him back for ever. Pinned in
  `jarvis-session-redial.spec.ts`; the fakes end conversations in the SDK's
  own shapes (`drop`, `agentSeemsToLeave`, `agentHangsUp`).

Everything that differs by device is handed in, and the main entry stays free of
platforms: the participant name, the timers, how his track is listened to
(`findRoom`, `followAgentVoice`), the call's audio a phone and a watch greet
inside (`callAudio`: let go at once when nothing was dialled, otherwise only once
the conversation has finished ending), a network to bring up first (`untilOnline`
and `leaveNetwork`, the watch's Wi-Fi), the deadline's words, which of his lines
are written down (`captions`: the headset's while-writing, the phone's text
mode; a `textOnly` summoning — a browser with no microphone — writes and mimes
every line), the half-duplex fallback (the headset's alone) and the SDK's
connection delay (the headset's is zero). A screen reads it through `snapshot`
and `subscribe`, which only tell it about changes, so a React screen renders when
something it shows has moved.

Three optional hooks exist for the headset's spatial voice, and only the headset
passes them, so the phone and the watch behave exactly as they did without them.
`halfDuplexMayJudge` is asked at every interruption whether the half-duplex
fallback may count it: the headset says no while his voice comes from where he
stands, because an echo there moves his voice back to the headset's own speakers
first, and for three seconds after that move while the echo canceller settles.
`onInterruption` and `onMessage` (in the events) tell the holder what the SDK
reported, after the session has dealt with it, so the headset can watch for his
voice coming back through the microphone.

`giveUpConnectingAfterMs` sets the deadline, `GIVE_UP_CONNECTING_AFTER_MS` when
left out, and no device sets it. Only the headset's browser tests pass it,
`Infinity` from `?deadline=never`, because they keep him greeting on a token that
never comes while an emulator draws a frame a second or slower, and the shared
twenty seconds raced them on a slow machine (see "The browser tests" in
`.claude/rules/vr.md`). An infinite wait arms no timer at all: a browser runs a
timer of `Infinity` at once, and the specs' fake clock does the same, so a session
that handed it over would fail in their hands as it would on a page.

Its specs are the headset's (`jarvis-session.spec.ts`,
`jarvis-session-conversation.spec.ts`, set up the way the headset sets it up) and
the phone's and the watch's (`jarvis-session-devices.spec.ts`), all driven by the
fakes in `jarvis-session.fakes.ts`, which fire callbacks in the SDK's own order.
