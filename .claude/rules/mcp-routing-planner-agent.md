---
paths:
  - "mcp/**"
---

# Routing Planner Agent

> Part of [Jarvis Mastra AI Agents → Current Agents](mcp-current-agents.md). Paths in it are relative to `mcp/` unless they say otherwise.

Turns a voice request into a **plan** for the specialized agents to run:
- **The thirteen public agents are its catalogue**, baked into its instructions at boot
- **No tools of its own**: it writes a plan, it never runs one and never sees a result
- **No memory**: planning one request has nothing to recall from the last
- **Flash-Lite, not Flash**: every request waits on the planner before any work starts, and
  picking agents from a list is classification rather than reasoning. Flash-Lite also thinks at
  `minimal` by default. If plans get worse, `PLANNER_MODEL` in `routing/planner.ts` is the line to
  revert, and the routing LLM eval is what shows it — run it by hand, since CI never does

The planner writes a flat list of **tasks**. Each names one agent, the prompt it is given, and
in `needs` the id of the one task whose answer it cannot be carried out without. Tasks run at
the same time as each other unless `needs` says otherwise.

An id in the request — most often the thing sir is pointing at,
`(pointing at "Kitchen ceiling", id light.kitchen_ceiling)` — is copied verbatim into the prompt of
the agent that owns the thing, so it acts on that very thing rather than looking it up (see **What
sir points at** under Routing). A request the classifier routes on its own (below) needs no copying:
its one agent is handed the user's own words, id and all.

What actually runs is **chains**, derived from that list in `task-chains.ts`: the delegations
inside one chain run in order, and every delegation after the first is handed the previous
answer along with its own prompt. So ordering and dependency passing are structural rather than
implied.

**The derivation is the point.** The planner used to emit chains itself, which made sequencing a
structural decision — which bucket does this go in — and that is the decision it got wrong,
silently and in the direction that costs a wrong answer: it would write five tasks as five
chains, and a task whose whole job was to use another's answer ran beside it and invented one.
A live eval caught it filling a to-do reminder with a generic lasagna ingredient list while the
recipe lookup it depended on was still running. Naming the task you are waiting on is a local
judgement about a single prompt, and it is the one a planner can actually make; placing it is
not, so nothing downstream is free to place it wrongly.

A task needed by two others is run once per dependent, because a chain carries only the
previous answer forward. That is the one thing the derivation trades away, and deliberately:
repeating a lookup costs time and quota, while dropping one of the edges costs a wrong answer.
The common shapes — a location before a weather lookup, a recipe before a reminder — are paths
and pay nothing for it.

**Most requests skip the planner.** A Jev classifier (`routing/classifier.ts`, on TypeSafe AI's
evaluation model through Mastra's `Classifier`) is asked first, before any language model: which
single agent can carry out the whole request as it was said — or `several`, or `none` — and how
the answer should sound. When it is at least `FAST_PATH_CONFIDENCE` sure of one agent, the planner
is never called and that agent gets the user's own words as its prompt. Only when Jev gives up is
the planner asked: several agents, one that needs another's answer first, a request that might
answer a waiting question, a classifier that is not sure, or one that fails (logged, never fatal).
The two used to start together, so every request Jev settled still sent the planner a call that was
then thrown away. Without `HEY_JARVIS_TYPESAFE_AI_API_KEY` there is no classifier and
every request is planned as before. The response-style wording lives in `response-styles.ts`, so
the planner and the classifier describe the four styles identically.

**Smart home commands skip the agent too.** The kinds of device Home Assistant holds (its
domains: lights, switches, covers), fetched live and cached for ten minutes, ride along on the same
Jev call: which kind of device the request is about, and whether it gives a setting (a brightness,
temperature, colour). These are the vertical's own questions, declared as a direct answer source
(`internet-of-things/direct-answers.ts`); routing asks them without knowing what they are about.
When the request is routed to `internetOfThings` as a `command`, Jev is sure of the kind of device
and no setting was given, one more Jev call asks the rest together
(`internet-of-things/home-commands.ts`): which service carries it out, chosen from the services
that act on that kind of device, and one yes/no per entity of that kind, with its name, area and
state. The services offered are the kind's own plus Home Assistant's generic `homeassistant.*` ones
it has no service of the same name for (`servicesFor`), so `light.turn_on` and
`homeassistant.turn_on` never compete for the same light, while a group, which has no
`group.turn_on`, is still turned on by the generic one. Asking for the kind of device first keeps
the routing call short, since a few dozen kinds stand in for hundreds of services. If the service is
sure and needs no required field, and every entity is settled one way or the other with at least one
chosen, the service is called on exactly those, with no language model involved.
The result says how many devices changed state, and does not claim success when none did, and the
entities it was called on are reported as what the request touched, exactly as the agent's
`callIoTService` would have reported them (see [What a request touches](mcp-routing-affected-entities.md#affected-entities)). Anything
else (an unsure kind, service or entity, a setting, more than 150 entities of that kind, Home
Assistant refusing the call) runs the same one-agent chain the request would have run anyway. Jev
only picks from what Home Assistant listed, so it cannot call a service or touch an entity that does
not exist.

**The same call settles three more decisions** that used to fall to the planner or a rule of thumb:

- **An answer to a waiting question.** When Jev is sure the request answers one of the open
  questions and is nothing but that answer, it goes straight back to the work that asked, in the
  user's own words, with no planner.
- **A goodbye.** `endCall` is a route choice. A goodbye that reaches routing is handed straight
  back to the voice agent's `end_call`, rather than reported as a request no agent could handle.
- **A request arriving while another runs.** It joins the running request's report while it is
  classified against it: `adds` keeps both and reports them together, `cancels` stops the running
  one and says so, and a correction, or an unsure answer, supersedes it as every request used to.
  `RoutingProgress.join` counts the requests reporting into it, and it finishes only when all do.
  What the request says about a photo is still the planner's, whichever relation Jev picks: a photo
  it waves away is let go of under `cancels` too, and one that only waves a photo away, or only says
  one is on its way, is carried out beside the running request without giving the shared report its
  own `command` style.

Routing has been three things. A task DAG with a wave scheduler this vertical owned; then a
supervisor agent delegating inside its own tool-call loop; now a plan. The middle one is why:
its loop was opaque, so a request could not be looked at, and it could not say what was
outstanding because a delegation existed only once it had been called. A plan is a workflow, so
Studio draws it and the run is persisted — and the work is written down before any of it runs.

*Note: Additional agents will be added as the project evolves.*
