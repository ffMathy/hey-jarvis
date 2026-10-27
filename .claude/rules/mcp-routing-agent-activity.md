---
paths:
  - "mcp/**"
---

# Which agents are at work

> Part of [Routing](mcp-routing.md). Paths in it are relative to `mcp/` unless they say otherwise.

The headset also shows sir which of Jarvis's agents a request is using, as satellites round him that
flare on every tool call and fold back into him when done (`.claude/rules/vr-seeing-him-work-src-satellites-app-room.md`, "Seeing him work"). So
`RoutingProgress` publishes `{ type: "agentActivity", delegationId, agentId, state }` on
`utils/live-events.ts` as each delegation moves on:

| State | When |
| --- | --- |
| `planned` | `delegation_start`: the moment routing knows the request's agents (`announcePlan` in `runChains`), before the plan is registered and before a direct answer is tried |
| `working` | the first chunk its agent streams (`delegation_working`), once |
| `tool` | every `tool-call` chunk its agent streams: a moment, and it is still `working` after it |
| `asking` | it suspended on a question sir can answer; `failed` when it cannot be asked |
| `answered` / `failed` | `delegation_end`, failed for an error or an empty answer; and every delegation still outstanding when the run ends or fails |

The delegation id is the plan's step id, which carries the plan's own id, so it is unique across
requests. A direct answer (the classifier's fast route) is reported as that same delegation, so a
satellite is out while it is tried, and one that declines leaves the plan to carry on the very
delegation it announced. `delegation_working` is read off the same `workflow-step-output` chunks as slow tools and
affected entities (`asWorkingEvents`), and off a resumed agent's own stream when an answer is carried
back. As with affected entities, none of it reaches the voice agent.

**Each vertical draws its own agent.** Every message carries `glyph`, the SVG path the agent's
vertical declares in its `glyph.ts` (`export const weatherGlyph = { agentId, path } satisfies
AgentGlyph`, exported from the vertical's `index.ts`), gathered in `verticals/agent-glyphs.ts`
(`AGENT_GLYPHS`, `glyphOfAgent`) for routing to look up. A glyph fits the circle of radius 1 round
0,0, y down, and is drawn as round-capped strokes 0.15 wide: closed shapes and lines, no fills, and
only the commands M, L, H, V, A, C, Q and Z, which is all the devices accept. The glyph files import
nothing but that type, because the headset's preview page reads them at build time to show every
glyph without a server. `routing/agent-glyphs.spec.ts` fails when an agent `getPublicAgents` returns
has no glyph, when one names an agent routing cannot reach, when two agents share a path, and when a
path uses anything the devices refuse or reaches past radius 1 — so a new routable agent needs a
`glyph.ts` in its vertical, and nothing else on any device.
