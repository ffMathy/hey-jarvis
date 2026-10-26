---
paths:
  - "elevenlabs/**"
---

# Showing Jarvis something

> Part of [ElevenLabs Integration](elevenlabs.md). Paths in it are relative to `elevenlabs/` unless they say otherwise.

**Sir sends the photo, and the agent takes no part in taking it.** The camera is a button on the
phone, beside Jarvis, and the agent has no tool for it. The tap opens the camera and, in the same
gesture, has the phone ask the MCP server for an upload slot, naming the conversation it is holding;
the server checks with ElevenLabs that the conversation is live on Jarvis's agent before it opens one,
and the phone then uploads the photo to it. The phone and the server settle between them where the
photo goes, so nothing the model reads — an email it summarised, the text on an earlier photo — can
send it anywhere else: no address ever passes through the conversation. The phone's half is
"Showing him something" in `.claude/rules/mobile-showing-him-something.md`, and the server's is the Vision vertical in
`.claude/rules/mcp.md`.

**What the agent hears of it is the phone's, sentence for sentence** (`mobile/src/photo-messages.ts`).
Three are contextual updates, which start no turn: once connected, that this device is sir's phone
with a camera button beside Jarvis, sent only when the phone knows a Jarvis server to send photos to;
at the tap, that sir has opened the camera; and, should he back out, that he closed it without a
photo. The other two are user messages in sir's name, because each is meant to start the agent's
turn: "I've sent you a photo (photo photo3)." once the photo is filed, and "The photo I took didn't
reach you: …" with a short reason when it was not. The first update is the one gate. The watch, the
Voice speaker, a telephone call and a phone with no server set all share this agent and never send
it, so the prompt has Jarvis tell sir to send the photo from his phone there, rather than point him at
a button that is not in front of him.

**Sir can go about it in either order.** Told first — "I'll send you a receipt, what's the
total?" — Jarvis routes nothing: there is nothing to look at yet, and a look routed now would read
whichever photo came last, possibly one from another conversation. He tells sir to go ahead with the
camera button and waits; when the photo's message arrives, the question goes to `routePromptWorkflow`
with "(photo photo3)" in it. Anything else asked in the same breath — "…and what's the weather?" — is
routed at once, on its own, and answering it does not end the wait: what sir wants done with the photo
goes with the photo. Should the agent route the announcement anyway, routing recognises it
(`awaitsPhoto` in `planner.ts`) and has Jarvis invite the photo and wait, rather than report a request
nothing could handle. Sent first, with nothing said, the message alone is routed as "He sent a
photo without saying what he wants: look at it and say what it shows (photo photo3)". The planner
puts that photo in `photosToAskAbout`, so routing's closing report has Jarvis say what it shows, then
ask what sir would like done with it and wait for the answer rather than hang up. That question comes
from routing's `instructions` and not from the prompt, because those outrank the prompt and would
otherwise forbid ending on a question (`.claude/rules/mcp-routing.md`, "Routing"). Every later request about the
photo names it by its id the same way, which is how the planner knows to send it to the `vision`
agent. The prompt states each of these rules once, in its **Photos** section, and a photo's id joins
the tool names and argument lists sir must never hear.

**A photo on its way is sir busy, not sir gone.** Nothing holds the agent's turn while he frames a
shot, so the three-second turn timeout asks Jarvis to speak again, and after a finished request the
answer to that is to hang up. So Jarvis waits instead — `skip_turn`, never `end_call` — while he is
waiting for a photo from sir on a device that has told him it has a camera button: sir said he would
send one, or a note says he has opened the camera on his phone, and since then nothing has settled
it. The photo settles it, and so do the phone's message that it did not reach him, its note that sir
closed the camera without one, and sir saying it is not coming. Nothing else he says does: his
answer to a question asked beside the photo, or anything else he asks for before it comes, is routed
as a request of its own, and once ended the wait — so that request's silence hung up on him on his
way to the camera. That holds even straight after a finished request, when the silence would
otherwise mean he has what he came for. A wait nothing settles is still bounded by the 30-second
`silenceEndCallTimeout`.

It starts only where the phone's camera-button note came. On the watch, the Voice speaker or a
telephone call, Jarvis sends sir to his phone and hangs up on the silence after: the photo goes to the
phone's own conversation, and with `agentConcurrencyLimit: 1` a line held open for it here would keep
that conversation from starting.

The exception is written into every place that states the rule it breaks, in the same words: the
prompt's **When Sir Is Silent**, the `skip_turn` and `end_call` descriptions in
`src/assets/tools/` (listed under both `builtInTools`, which the test agent keeps, and `tools`), and
routing's `FINISHED_REQUEST_INSTRUCTIONS` and `WAIT_FOR_THE_PHOTO`, which share one condition,
`WAITING_FOR_A_PHOTO`. It was once in the prompt alone, where the three that said to hang up outweighed
it: routing's above all, since it arrives last and the prompt says to follow it literally. An
exception stated in fewer places than the rule it breaks is outweighed the same way.

The phone also sends `user_activity` once in the tap, beside the note that the camera is open, and then
every five seconds while the camera is open or the photo is on its way. The first may land before the
three-second turn timeout; the rest are too seldom to hold one off, and ElevenLabs does not document them
as holding off the 30-second `silenceEndCallTimeout`; the phone's timers stop while the app is behind
the camera besides. So a long enough shot can still end the call — and the slot, opened at the tap,
outlives it.

**A photo whose message never reached the agent is not lost.** The phone sends that message only into
the conversation that opened the slot. If that conversation ended first, the photo stays with Mastra
as one nobody has looked at, and routing brings it up in the closing report of the next request it
answers, in whichever conversation that is, the way it brings up earlier work still waiting on sir
(`.claude/rules/mcp-vision-vertical.md`, "Vision" and "Routing"). None of this is in the prompt: it arrives in
`instructions`, beside the rest of routing's run-time mechanics, when it applies.

**The agent has no client tools, and asks ElevenLabs to send none.** `clientEvents` keeps
`mcp_tool_call` for the apps' thinking phase (`hologram/src/tool-activity.ts`), and because the
integration specs read tool calls off the socket, `applyTestAgentOverrides` adds it to the test agent
should the config ever drop it. The Voice speaker logs only an MCP result's tool name and state, since
a result can hold an email summary.

**What checks it.** `tests/specs/agent-config.spec.ts`, on every push: every client event is one
ElevenLabs sends, `mcp_tool_call` is among them, and the agent declares no client tool and asks for
no `client_tool_call`, since no device answers one; and the waiting-for-a-photo exception is in the prompt's **When Sir Is Silent**
and in the `skip_turn` and `end_call` descriptions, in the same phrases, whose two copies each must
match — with the prompt sending sir to his phone, and not waiting, where there is no camera button, and
ending the wait on a camera closed without a photo. `tests/specs/camera.integration.spec.ts` holds five
live conversations with a stood-in phone. Told first, the question is routed nowhere until the photo's
message is in, and then routed naming "(photo photo1)"; sent first, the photo is routed by that name
at once; a camera opened straight after a finished request is waited on — `skip_turn` answers the turn
timeouts since the camera's note, with no `end_call` — and the photo that follows is routed; the same
request with no camera opened after it is hung up on within ten seconds, the control without which the
wait would prove nothing, since it shows the harness is asked to speak again at all; and where no
device has said it has a camera button, the announcement is not routed, and the silence after it is
hung up on. No photo is really
uploaded, so the routed look finds nothing, and the evaluator is told to expect that. The routing evals
in `mcp/mastra/verticals/routing/workflows.llm-eval.integration.spec.ts` check the planner's half:
"(photo photo3)" goes to `vision` with the id in its prompt, and "add what is on this receipt to my
shopping list" reads the photo before `shoppingList` in the same chain. Both need credentials and run
only under `turbo test:integration`.

**None of this reaches the live agent until a release deploys it.** `bunx turbo deploy` runs in the
release workflow, which every merge to `main` triggers and which releases every merge.
Until then the phone's camera button sends photos to an agent whose prompt has never
heard of them.
