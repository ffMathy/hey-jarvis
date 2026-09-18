# Conversation

> **Note:** See the root [AGENTS.md](../AGENTS.md) for shared conventions (Turborepo commands, commit standards, 1Password, etc.)

## Overview

The conversation with Jarvis: what it takes to open one, and what to say when it
cannot be opened. Shared by every app that holds one — today [`mobile/`](../mobile/AGENTS.md)
and [`watch/`](../watch/AGENTS.md).

A package of its own for the reason [`hologram/`](../hologram/AGENTS.md) is one.
There are now two devices that talk to the same ElevenLabs agent, and neither of
them should own the other's copy of the credentials, of the token request, or of
the dozen ways ElevenLabs can say no. It was all in `mobile/src` until the watch
stopped being a sphere that only turns.

## Two entry points

```
conversation          the credentials and the token — plain TypeScript over fetch
conversation/react    the hooks a screen holding one needs
```

The split is the same as `hologram`'s, and it exists for the same reason. The
main entry reaches nothing but `fetch`, so `conversation-token.spec.ts` drives
every failure ElevenLabs can answer with — a rejected key, a key without
permission, an unknown agent, an account out of credits, a rate limit — with no
account, no credential, no SDK and no device. `conversation/react` is where
`@elevenlabs/react-native` and React are called for real.

## TURBO Commands

```bash
bunx turbo typecheck --filter=conversation   # tsgo
bunx turbo lint --filter=conversation        # biome
bunx turbo test --filter=conversation        # the offline suite
```

There is no `build`: the apps' bundlers compile these sources along with their
own, so there is nothing to emit.

## What is in here

| File | What it is |
| --- | --- |
| `elevenlabs-settings.ts` | The two values, and what is wrong with them when something is. One place, because the phone types them and the watch is sent them, and both have to agree on what a usable pair looks like. |
| `conversation-token.ts` | One `GET` to ElevenLabs for a WebRTC token, and every failure turned into what the user can do about it. |
| `react/agent-voice.ts` | Jarvis's voice as the SDK hears it — the whole voice on web and on the watch. |
| `react/sdk-voice-readers.ts` | The SDK's analysers, made safe to call before a session exists. |
| `react/tool-activity.ts` | Which of his tool calls are in flight, which is what the sphere's thinking state is drawn from. |

## Things worth knowing before changing any of it

**The participant name is a required argument, not a default.** Each device
names itself in the ElevenLabs conversation history — `jarvis-android` and
`jarvis-wear` — and the point of the names is to be told apart, so a
conversation held on the wrist is distinguishable from one held in a pocket.
Both constants live in `conversation-token.ts` and neither is the default,
because a default is how the watch ends up filed under the phone's name.

**Nothing from an error response is ever repeated back.** `conversation-token.ts`
reads only `detail.status` and `detail.code`, and only when they look like the
fixed identifiers they are. The free-text message beside them is never read: it
can echo the request, and the request carried the API key. There is a test that
sends a key-shaped string in every field of every failure and asserts it never
reaches the message.

**The SDK's readers are the fallback on a phone and the whole story elsewhere.**
`useAgentVoice` is what the watch and the browser use. The phone prefers a tap
on Jarvis's own WebRTC track (`mobile/src/jarvis-voice.ts`), because LiveKit's
processors on Android report a mostly-empty spectrum and a volume with the bytes
of each sample swapped — see "The hologram on a device" in
[`mobile/AGENTS.md`](../mobile/AGENTS.md).

## Testing

Everything here is offline and stays that way. A test that needs a real
ElevenLabs credential belongs in `elevenlabs/` with the other integration
specs — see the [`validation`](../.claude/rules/validation.md) rule for which
suffix puts a test where.
