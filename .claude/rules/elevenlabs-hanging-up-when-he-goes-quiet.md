---
paths:
  - "elevenlabs/**"
---

# Hanging up when he goes quiet

> Part of [ElevenLabs Integration](elevenlabs.md). Paths in it are relative to `elevenlabs/` unless they say otherwise.

A finished request should not leave the line open until the 30-second `silenceEndCallTimeout`
gives up on it. So the agent has **`turnTimeout: 3`**: after three seconds of silence, ElevenLabs asks
Jarvis to speak again. The prompt's **When Sir Is Silent** section and the `end_call`/`skip_turn`
descriptions tell him what that means — after a finished request, `end_call` without a word; while
the conversation waits on sir, `skip_turn`. Every finished request — answered, failed, or handed off
to a notification — also ends with the routing loop's `FINISHED_REQUEST_INSTRUCTIONS`, which says
the same and forbids ending on a question or an offer, since the line closes while he is still
answering it. A request still waiting on him never carries it. The prompt, both descriptions and
routing's instructions all make the same one exception: a photo Jarvis is waiting for, whose silence
gets `skip_turn` even straight after a finished request (see **Showing Jarvis something** below).

That setting is agent-wide, so it is the one mechanism on every medium: the apps, the Voice speaker
and a telephone call alike. `initialWaitTime: 30` keeps it from firing at the start of a session
whose first message is empty (the apps play a recorded greeting instead). If the model ever fills
those silences with "are you still there?", `turnTimeout: -1` switches it off again — and with it
every hang-up after a finished request, so that is a trade, not a fix.

**`retranscribeOnTurnTimeout: true`** is what keeps that from hanging up on sir mid-sentence. A long
reply has pauses in it, and three seconds of one fires the timeout before ElevenLabs has turned the
words before it into a transcript. With retranscription off, Jarvis was then asked to speak again
with nothing from sir since his last reply, and after a finished request that means `end_call` — so
the longer sir talked, the likelier the line went dead under him. With it on, the audio gathered so
far is transcribed when the timeout fires, and Jarvis hears what sir said instead of a silence. It
costs the silence discount on those turns, which is cheap beside a dropped call.
`tests/specs/agent-config.spec.ts` holds the setting on.

There used to be a second mechanism, the `hangUpWhenQuiet` client tool, that armed a three-second
clock on the device itself. It was removed: the agent asked for it, the phone, watch and firmware
each kept their own copy of the clock, and `turnTimeout` already did the same job everywhere.

## What belongs in the routing instructions instead

Every response from `routePromptWorkflow` and `getNextInstructionsWorkflow`
carries an `instructions` field, and the prompt's only rule about the loop is
to follow that field literally. So the run-time mechanics — how long to keep
polling, what to say between reports, what to do with a failed call, that a
finished request does not finish the conversation — live in `INSTRUCTIONS` and
`ALL_TASKS_COMPLETED_INSTRUCTIONS` in
[`mcp/mastra/verticals/routing/workflows.ts`](../../mcp/mastra/verticals/routing/workflows.ts),
where they arrive exactly when they apply.

State each such rule in one place only. Asking for the same line here *and*
there is how Jarvis once acknowledged the same request twice.
