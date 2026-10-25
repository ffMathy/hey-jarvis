---
paths:
  - "elevenlabs/**"
---

# The conversational model

> Part of [ElevenLabs Integration](elevenlabs.md). Paths in it are relative to `elevenlabs/` unless they say otherwise.

`conversationConfig.agent.prompt.llm` in `src/assets/agent-config.json` names the
model that runs the conversation: it decides every line, and it is the thing that
either calls `end_call` and `routePromptWorkflow` or merely talks about calling
them.

It is `gpt-5.6-luna`, and the bar a value here has to clear is a transcript. On
`qwen35-397b-a17b` Jarvis was asked three times in a row to end the call, said
"ending the call now" each time, and never called `end_call` — the line stayed
open until sir gave up. The same conversation had it narrating the wait it had
just been told to keep quiet about, and answering a calendar lookup with wit
instead of a result. None of that is a prompt gap: every one of those rules is
already stated once, plainly, in `agent-prompt.md` or in the `instructions`
field. They were read and not followed, which is the one failure a longer prompt
cannot fix.

That transcript is why the field sat on `claude-sonnet-5` for as long as it did:
the hosted open-weight tier was cheap and did not obey, so the answer was a
frontier model and the per-turn cost that came with it. `gemini-3.8-flash` took
the field from it on price, and lost it on the fine print — that price was
introductory, and the rise already scheduled against it undoes the very gap that
justified leaving the frontier model at all. `gpt-5.6-luna` is cheaper again, and
cheaper after a cut rather than before a rise, which is the whole of why it holds
the field now.

Be honest about what the swap costs, because the published scores do not flatter
it: read on one consistent revision of the Artificial Analysis index, luna sits a
few points *below* `gemini-3.8-flash` rather than above it. The case here is
price and the durability of price, never capability. It survives only on what the
rest of this section already argues — that the hardest turn this agent takes is
picking the right tool and calling it, and that no index measures that.

Three things follow, and none of them is optional. The value must be one of the
ids in `Llm` from `@elevenlabs/elevenlabs-js/api` — ElevenLabs rejects anything
else, and that union is versioned with the SDK, so a model newer than the pinned
`@elevenlabs/elevenlabs-js` is not selectable until the pin moves.

`reasoningEffort` sits directly beneath `llm` in the same object, and it is
`"none"`, because a transcript said to. OpenAI's chat-completions endpoint
rejects a tools-bearing request for this model family unless `reasoning_effort`
is `none` — omitting the field is refused too — and this agent is never without
tools: `end_call`, `skip_turn`, `transfer_to_agent`, and the MCP server behind
`routePromptWorkflow`. With the field left `null`, the integration specs showed
exactly that: every turn that needed a tool ended the conversation straight
after sir spoke, with no tool call and no reply, while turns that needed none
("It is 01:07, sir") went through. The ended conversations then left ElevenLabs
reporting the MCP integration as connected with zero tools for every
conversation after them. Moving `llm` to another provider is the moment to
revisit this: the constraint is OpenAI's, and `LlmReasoningEffort` in the SDK
admits `none` through `max`.

And the question to ask of any candidate is not how it reads, not what it scores,
but whether it hangs up when it says it is hanging up. `turbo test:integration
--filter=elevenlabs` is what asks it, because those specs hold live conversations
with the deployed agent; a model swap that has not been through them is a guess —
this one included, until they run.
