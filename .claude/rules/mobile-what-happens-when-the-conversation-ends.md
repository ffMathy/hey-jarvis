---
paths:
  - "mobile/**"
---

# What happens when the conversation ends

> Part of [Mobile App → The hologram](mobile-the-hologram.md). Paths in it are relative to `mobile/` unless they say otherwise.

He goes. The agent hangs up, the session drops, and the sphere used to go on turning exactly as it
does while he listens — which is the same complaint the problem line answers, the other way round:
an assistant who has finished looks identical to one who is waiting for you. So the end of a
conversation takes him off the screen and unmounts the drawing (a frame loop drawing a sphere nobody
can see is a phone kept awake for no one). Across the whole screen he fades over `LEAVING_SECONDS`.
Summoned, he does not fade: the sheet slides straight down with him still drawn on it, and the
assistant's window is retracted once it is off the screen. He used to fade first and the sheet
followed once he had, which was most of a second of a finished assistant still on screen; the user
asked for the sheet simply to go. Tapping beside it or pressing back starts it down at once too.

**Quiet after a finished request ends it too, from the agent's side.** Its `turnTimeout` of three
seconds and its `end_call` tool hang up once a request is done and nobody answers, so to the screen it
is simply the agent hanging up: the app registers no client tool for it. **A finished command does not
wait for the quiet.** Setting an alarm or switching off a light is told to confirm it in a few words
and call `end_call` straight away (see `COMMAND_DONE_INSTRUCTIONS` in
`mcp/mastra/verticals/routing/workflows.ts`), so the call is over the moment he has said it is done.
