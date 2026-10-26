---
paths:
  - "mcp/**"
---

<a id="pointing"></a>
# What sir points at

> Part of [Routing](mcp-routing.md). Paths in it are relative to `mcp/` unless they say otherwise.

On the headset, "turn that on" means the thing sir is pointing at. The headset says what that is over
the WebSocket API — `{"type":"pointing","entity":{"id":…,"name":…}}`, or `"entity": null` — whenever it
changes, and the server keeps the newest report of any socket until that socket says otherwise or
closes (`utils/pointing.ts`). The moment a request is routed, `withPointing` writes it after the
request — `Turn that on (pointing at "Kitchen ceiling", id light.kitchen_ceiling)` — because nothing
but that string reaches the agents. The voice agent hears none of this. The planner copies an id in the request verbatim into the prompt of the
agent that owns the thing, and every agent is told in the shared guidelines to act on an id it is
given without looking it up. A request the routing classifier settles on its own never reaches the
planner, and needs it not to: its one agent is handed the user's words as they are, id included. A
smart home command carried out without the agent puts every candidate entity to Jev with its id
beside its name, so the command names the one he points at for it. The tool call on that id, or the
home command, then lights the thing up by the path above.
