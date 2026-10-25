---
paths:
  - "elevenlabs/**"
---

# The Realtime model

> Part of [ElevenLabs Integration](elevenlabs.md). Paths in it are relative to `elevenlabs/` unless they say otherwise.

`conversationConfig.realtime_model` is `eleven_realtime_v1_max`, Eleven Realtime v1 Max: one
speech-to-speech model that hears sir, decides the line and speaks it, in place of the cascade of
`scribe_realtime`, an LLM and a TTS model. Setting it is what ElevenAgents calls Realtime mode;
`null` puts the agent back in Custom mode.

Max rather than Mini, because the hardest turn this agent takes is a tool call — `routePromptWorkflow`,
`end_call`, `skip_turn` — and on the published benchmarks Max completes 87% of tool-use tasks to
Mini's 60%, at much the same time to first audio. Max also requires `maxTokens` of at least 1,024 or
no limit; it is `-1`, no limit.

While it is set, ElevenLabs ignores the stored `agent.prompt.llm`, `reasoningEffort`,
`enable_parallel_tool_calls`, `cascadeTimeoutSeconds`, `tts.modelId`, `tts.expressiveMode` and
`asr.provider`. They stay in the config because they come back the moment `realtime_model` is
`null`, so the two sections below describe the Custom mode the agent falls back to. The prompt, the
first message, the voice, the languages, the tools and MCP servers, and every `turn` setting
(`turnTimeout` included) still apply.

The key is snake_case because no published `@elevenlabs/elevenlabs-js` has a field for it — `fetch`
saves every key the SDK does not know under the API's own name, as with
`enable_parallel_tool_calls` — and `toConversationConfigBody` carries it into the deploy, which
otherwise strips unknown keys. `tests/specs/conversation-config-body.spec.ts` checks that it does.

Three things ElevenLabs' documentation leaves open, which only a deploy and
`turbo test:integration` answer:

- **Transfers.** Realtime agents may only transfer to other Realtime agents, checked when the agent
  is published. `transfer_to_agent` sends sir to the "Mathias agent", which must therefore be in
  Realtime mode too, or the deploy is rejected.
- **Text-only conversations.** ElevenLabs advises keeping text-only agents in Custom mode. The test
  agent is deployed `textOnly`, and the phone's typed conversation sends the `textOnly` override; how
  a Realtime agent holds either is not documented.
- **Audio tags.** `expressiveMode` is a managed setting, so whether the Realtime model performs
  `[Victorian]` and the other `suggestedAudioTags` the prompt uses — or reads them out — is untested.
