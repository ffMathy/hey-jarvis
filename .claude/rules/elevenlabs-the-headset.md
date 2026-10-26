---
paths:
  - "elevenlabs/**"
---

# The headset

> Part of [ElevenLabs Integration](elevenlabs.md). Paths in it are relative to `elevenlabs/` unless they say otherwise.

The agent knows nothing about sir's headset, and the headset tells it nothing about itself: no device
context, no pointing updates, no client tool. Both of the headset's extras travel between the MCP
server and the devices over its `/api/live` WebSocket instead (see `.claude/rules/mcp.md`):

- **What a request reads or changes** is pushed by the server straight to the devices, as a list of
  `{ id, name? }` entities, and the headset lights it up where sir placed it in the room. The routing
  loop's reports carry nothing about it, and the voice agent never sees it.
- **What sir is pointing at** goes from the headset to the server, which adds
  `(pointing at "<name>", id <id>)` to the request it routes. "Is that on?" reaches the planner
  already naming the entity, so the prompt has no rule about what "that" means.

The agent once took part in both, through a client tool it called with the entities and through
contextual updates naming what sir pointed at. Both are gone, and `tests/specs/agent-config.spec.ts`
fails if a client tool, or `client_tool_call` in `clientEvents`, comes back.
