import type { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import { createAgent } from '../../utils/index.js';
import { logger } from '../../utils/logger.js';
import { getPublicAgents } from '..';
import type { PlannedChain } from './plan.js';

/**
 * The agent that turns a request into a plan.
 *
 * It replaces a supervisor that delegated inside its own loop. The routing decision is the
 * same one -- which agents, in what order, each asked what -- but it is now written down
 * before anything runs, which is what lets the request be a workflow Studio can draw, and
 * what lets a poll name the work that is still outstanding rather than guess at it.
 *
 * The planner never runs the work and never sees an answer, so nothing here should try to
 * reason about results. It reads a request and emits chains.
 */

const PLANNER_AGENT_ID = 'routing-planner';

export { PLANNER_AGENT_ID };

/**
 * What the planner emits.
 *
 * Chains rather than a flat list, because order is the only thing a plan has to express that
 * a list cannot: everything in one chain runs in sequence with the previous answer in hand,
 * and the chains run at the same time as each other.
 */
const planSchema = z.object({
  chains: z
    .array(
      z.object({
        delegations: z
          .array(
            z.object({
              agentId: z.string().describe('Exactly one of the agent ids listed in the instructions'),
              prompt: z
                .string()
                .describe('A self-contained instruction for that agent; it cannot see the request or the plan'),
            }),
          )
          .min(1),
      }),
    )
    .describe('Chains run at the same time as each other; delegations within a chain run in order'),
});

export { planSchema };

/** How the planner is told what it may delegate to. */
function agentCatalogue(agents: Agent[]): string {
  return agents.map((agent) => `## ${agent.id}\n${agent.getDescription() || 'No description given.'}`).join('\n\n');
}

/**
 * The planner's instructions.
 *
 * Exported so the LLM evaluation can judge the real thing rather than a paraphrase of it.
 */
export function plannerInstructions(agents: Agent[]): string {
  return `You are the router for the Hey Jarvis assistant. A request arrives that needs work from the specialized agents below, and your job is to write the plan that gets all of it done.

You do not answer anything yourself and you never see a result. Everything the user is asking about — the weather, the calendar, the house, the shopping list, recipes, email, the commute — is known only to these agents. A plan that leaves an agent out is a question that never gets asked.

# The plan
A plan is a set of chains. Chains run at the same time as each other. The delegations inside one chain run in order, and every delegation after the first is handed the previous one's answer along with its own prompt.

So:
- Independent parts of the request go in **separate chains**, so they run at once
- A part that needs a value another part produces goes in the **same chain, after it** — a location before a weather lookup, a recipe before a shopping list
- Never put independent work in one chain; that only makes the user wait longer

# Writing a delegation
- \`agentId\` must be exactly one of the ids below. Never invent one, and never delegate work an agent's description does not cover
- \`prompt\` must be self-contained. The agent cannot see the user's request, this plan, or any other agent's answer, so everything it needs must be in the prompt you write
- For a delegation that follows another in its chain, write the prompt as if the previous answer is attached — it is. Say what to do with it rather than restating it

# Critical rules
- If no agent can handle part of the request, leave it out rather than misassigning it
- Do not invent work the user did not ask for, and do not look up a value the user already gave you
- Never ask clarifying questions — make best-guess assumptions and plan anyway
- If nothing in the request can be handled by any agent, return no chains at all

# The agents
${agentCatalogue(agents)}`;
}

/**
 * The ids the planner is allowed to name, remembered from the catalogue it was built with.
 *
 * Held rather than re-derived because `getPublicAgents()` constructs a fresh agent per call
 * -- ten of them, each with its own tools and memory -- and a routing request would otherwise
 * pay for that twice: once to build the planner and once to check what it wrote.
 */
let routableAgentIds: ReadonlySet<string> | undefined;

/** Which agents a plan may delegate to. */
export async function getRoutableAgentIds(): Promise<ReadonlySet<string>> {
  if (!routableAgentIds) {
    routableAgentIds = new Set((await getPublicAgents()).map((agent) => agent.id));
  }
  return routableAgentIds;
}

/**
 * Builds the planner over the agents it is allowed to route to.
 *
 * The catalogue is baked into the instructions rather than looked up per request: the agents
 * are fixed at boot, and the planner is on the latency-critical path.
 */
export async function getRoutingPlannerAgent(): Promise<Agent> {
  const routableAgents = await getPublicAgents();
  routableAgentIds = new Set(routableAgents.map((agent) => agent.id));

  return createAgent({
    id: PLANNER_AGENT_ID,
    name: 'RoutingPlanner',
    description: 'Turns a user request into a plan of delegations for the specialized agents.',
    instructions: plannerInstructions(routableAgents),
    // Planning one request has nothing to recall from the last one, and memory here would
    // buy an embedding round trip on the one path that cannot afford any: the poll deadline
    // is 5s against ElevenLabs' 8s cascade timeout.
    memory: undefined,
  });
}

/**
 * Drops anything the plan cannot actually run.
 *
 * A plan is registered as a bundle and validated as one, so a single delegation naming an
 * agent that does not exist takes the whole request down with it. A model that invents an id
 * is a thing that happens; losing the rest of the plan over it need not be.
 */
export function keepRunnableDelegations(chains: PlannedChain[], knownAgentIds: ReadonlySet<string>): PlannedChain[] {
  return chains
    .map((chain) => ({
      delegations: chain.delegations.filter((delegation) => {
        if (knownAgentIds.has(delegation.agentId)) {
          return true;
        }
        logger.warn('Routing plan named an agent that does not exist', { agentId: delegation.agentId });
        return false;
      }),
    }))
    .filter((chain) => chain.delegations.length > 0);
}

/** Asks the planner for a plan, and returns only the parts of it that can be run. */
export async function planDelegations(planner: Agent, userQuery: string): Promise<PlannedChain[]> {
  const response = await planner.generate(userQuery, {
    structuredOutput: { schema: planSchema },
    toolChoice: 'none',
  });

  const plan = response.object;
  if (!plan) {
    throw new Error('The routing planner did not return a plan');
  }

  return keepRunnableDelegations(plan.chains, await getRoutableAgentIds());
}
