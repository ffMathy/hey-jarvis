import type { Agent } from '@mastra/core/agent';
import { createMemory } from '../../memory/index.js';
import { createAgent } from '../../utils/index.js';
import { getPublicAgents } from '..';
import { recordDelegationFailure } from './delegation-failures.js';

const SUPERVISOR_INSTRUCTIONS = `You are the router for the Hey Jarvis assistant. A request arrives that needs work from the specialized agents available to you, and your job is to get all of it done and report back.

You do not answer from your own knowledge. Everything the user is asking about — the weather, the calendar, the house, the shopping list, recipes, email, the commute — is known only to the agents. If you answer without delegating, you are guessing.

# Delegation strategy
1. Work out which parts of the request need which agent, from the descriptions and capabilities you were given
2. Delegate every part that some agent can cover, and delegate parts that do not depend on each other at the same time rather than one after another
3. When one part needs a value another produces — a location before a weather lookup, a recipe before a shopping list — delegate the first, wait for it, and pass its result into the second
4. Give each agent a self-contained instruction. It cannot see the user's original request, this conversation, or what any other agent returned, so anything it needs must be in the prompt you send it

# Critical rules
- Only delegate work to an agent whose stated capabilities cover it
- If no agent can handle part of the request, leave it out rather than misassigning it, and say so at the end
- Do not invent work the user did not ask for, and do not look up a value the user already gave you
- Never ask clarifying questions — make best-guess assumptions and proceed
- An agent that fails is not the end of the request: carry on with the rest, and report what could not be found out

# Finishing
You are done when every part of the request that some agent can handle has been covered. Close with a plain summary of what was found, in your own words — never a task id, a tool name, or a raw response.`;

export { SUPERVISOR_INSTRUCTIONS };

/**
 * The id the supervisor is registered under on the Mastra instance.
 *
 * Shared so the controller can ask for the registered agent by the same name it was
 * registered with, rather than the two drifting apart.
 */
export const ROUTING_SUPERVISOR_AGENT_ID = 'routing-supervisor';

/**
 * The agent that fulfils a routing request by delegating to the specialized agents.
 *
 * This replaces a planner that emitted a task DAG for a separate executor to run. The DAG
 * was deliberately explicit — inspectable and replayable in Studio rather than buried in a
 * tool-call loop — and giving that up is the cost of this change. What it buys is that
 * ordering, parallelism, dependency passing and failure handling are now the model's job
 * inside one loop, instead of ~1000 lines of wave scheduler, completion registry and
 * report bookkeeping maintained here.
 *
 * The agents are attached as subagents, so Mastra generates a delegation tool per agent
 * and the supervisor loop drives them. Progress is observed through the session's event
 * stream rather than through a DAG that this vertical owns; see
 * {@link ./controller.ts}.
 */
export async function getRoutingSupervisorAgent(): Promise<Agent> {
  const routableAgents = await getPublicAgents();
  const delegationMemory = await createMemory({ enableSemanticRecall: false, enableWorkingMemory: false });

  // Delegation runs a subagent *memory-backed*, which the path this replaced never did:
  // the DAG executor called `agent.generate([...])` with no memory option at all, so no
  // thread was created, nothing was embedded, and the agents' own Memory was inert. Mastra
  // builds a thread and resource per delegation instead, which switches on semantic recall
  // — a hosted `gemini-embedding-001` round trip per message — working memory, and vector
  // writes, on every single delegation.
  //
  // None of that is wanted here and all of it is in the way. The supervisor holds the
  // request; a subagent is asked one self-contained question and answers it, so there is
  // nothing across calls for it to recall. What the embedder does buy is latency, on the
  // one path in this repo that cannot afford any: the poll deadline is 5s against
  // ElevenLabs' 8s cascade timeout. The synapse vertical already made this same trade for
  // the same reason.
  for (const agent of routableAgents) {
    agent.__setMemory(delegationMemory);
  }

  return createAgent({
    id: ROUTING_SUPERVISOR_AGENT_ID,
    name: 'RoutingSupervisor',
    description: 'Fulfils a user request by delegating each part of it to the specialized agents.',
    instructions: SUPERVISOR_INSTRUCTIONS,
    agents: Object.fromEntries(routableAgents.map((agent) => [agent.id, agent])),
    // The router coordinates; it has no business remembering across requests, and the
    // agents it delegates to keep their own memory.
    memory: undefined,
    defaultOptions: {
      delegation: {
        // The only place the real reason for a failed delegation is available. Mastra wraps
        // it in a `MastraError` on the way out and the session sees only that wrapper, so a
        // failure that is not caught here reaches the user as "Failed agent tool execution
        // for weather" and nothing more.
        onDelegationComplete: ({ success, error, toolCallId, primitiveId }) => {
          if (success || !error) {
            return;
          }
          recordDelegationFailure(toolCallId, primitiveId, error);
        },
      },
    },
  });
}
