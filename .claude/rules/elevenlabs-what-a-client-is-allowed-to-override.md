---
paths:
  - "elevenlabs/**"
---

# What a client is allowed to override

> Part of [ElevenLabs Integration](elevenlabs.md). Paths in it are relative to `elevenlabs/` unless they say otherwise.

`platformSettings.overrides.conversationConfigOverride` in `src/assets/agent-config.json` is an
allow-list, and a client that sends an override the agent does not permit does not get it ignored
— **the server closes the conversation**. That failure is close to silent from the app's side: the
session connects, the socket shuts, and the SDK reports it through `onDisconnect` rather than
`onError`, so nothing surfaces unless the app is listening for it (`mobile/` now is).

`conversation.textOnly` is on that list because the phone app needs it. A browser with the
microphone refused holds the conversation as text on both sides, which is done by sending exactly
that override — see "What a typed conversation asks for" in `.claude/rules/mobile.md`. It is also the
least sensitive thing on the list: it changes whether Jarvis writes or speaks, not what he is or
what he can reach.

Anything changed here reaches the agent only through `bunx turbo deploy --filter=elevenlabs`, which
needs the 1Password credentials. Until that runs, the committed config and the live agent disagree,
and it is the live one the app talks to.
