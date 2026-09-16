import type { Mastra } from '@mastra/core';
import type { DynamicWorkflowGraph } from '@mastra/core/workflows';
import { logger } from '../../utils/logger.js';
import { routingPlanMetadata, sweepOldRoutingPlans } from './plan-retention.js';

/**
 * A spike: can Studio draw a workflow built at runtime, and can a stream of them be kept to
 * a sensible length?
 *
 * Routing gave up its Studio graph when the task DAG went away (#718). Workflows are the
 * only primitive Studio graphs, so getting the picture back means routing has to *be* a
 * workflow -- and since which agents a request needs is known only once the request arrives,
 * that workflow has to be built per request.
 *
 * The first question is answered: Studio lists these with a `Dynamic` badge and draws the
 * root with its nested branches. The second is what this now demonstrates, by registering a
 * fresh plan on every boot and sweeping the older ones. Restart a few times and the list
 * should hold steady rather than grow.
 *
 * Delete this file once the design it is standing in for is built or abandoned.
 */

/**
 * What an agent step takes and gives back.
 *
 * Not a choice: `createStepFromAgent` hands every agent step `z.object({ prompt: z.string() })`
 * in and `z.object({ text: z.string() })` out. A first attempt declared the workflow input as
 * `{ userQuery }` and was rejected before it ran -- `[incompatible-schema] graph.0.steps.0:
 * Step input is incompatible with the preceding workflow output`. A validator that traces
 * schemas through a graph is most of what makes a generated graph safe to run, so the
 * vocabulary is worth stating rather than rediscovering.
 */
const AGENT_STEP_INPUT = { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] } as const;
const AGENT_STEP_OUTPUT = { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } as const;

/** One thing a plan asks of one agent. */
export interface PlannedDelegation {
  agentId: string;
  prompt: string;
}

/**
 * One delegation: give an agent its own prompt, then run it.
 *
 * A workflow of its own rather than two entries in the parallel block, because a `mapping`
 * entry has to be a top-level workflow entry -- one inside a `parallel` is rejected with
 * `[invalid-map-placement]`. Since a plan's whole point is asking each agent a *different*
 * question, per-branch prompts mean per-branch workflows. That is the shape a planner has to
 * emit, and it is the main thing this spike learned.
 *
 * `mapConfig` is a JSON string rather than an object: it is parsed by `parseMapConfig` on the
 * way in, and an object is rejected with `[invalid-map-config]`.
 */
function delegationWorkflow(planId: string, index: number, delegation: PlannedDelegation): DynamicWorkflowGraph {
  const id = `${planId}-${index}-${delegation.agentId}`;

  return {
    id,
    description: `Ask the ${delegation.agentId} agent one question`,
    metadata: routingPlanMetadata(planId),
    inputSchema: AGENT_STEP_INPUT,
    outputSchema: AGENT_STEP_OUTPUT,
    graph: [
      {
        type: 'mapping',
        id: `${id}-prompt`,
        mapConfig: JSON.stringify({ prompt: { value: delegation.prompt, schema: { type: 'string' } } }),
      },
      { type: 'agent', id: `${id}-run`, agentId: delegation.agentId },
    ],
  };
}

/**
 * A plan as a bundle: one workflow per delegation, and a root running them together.
 *
 * `addDynamicWorkflows` validates a bundle as a unit and registers nothing if any member is
 * rejected, so a root may reference branches that do not exist yet.
 *
 * Everything is parallel here because the spike's two questions are independent. A real
 * planner would sequence the parts that depend on each other -- a location before a weather
 * lookup -- which is the same vocabulary with entries in series rather than in one block.
 */
export function buildRoutingPlan(planId: string, delegations: PlannedDelegation[]): DynamicWorkflowGraph[] {
  const branches = delegations.map((delegation, index) => delegationWorkflow(planId, index, delegation));

  return [
    ...branches,
    {
      id: planId,
      description: 'A routing plan, built for one request',
      metadata: routingPlanMetadata(planId),
      inputSchema: AGENT_STEP_INPUT,
      outputSchema: { type: 'object' },
      graph: [
        {
          type: 'parallel',
          steps: branches.map((branch, index) => ({
            type: 'workflow' as const,
            id: `branch-${index}`,
            workflowId: branch.id,
          })),
        },
      ],
    },
  ];
}

/** What the spike asks for, so that what Studio draws is a plan rather than a box. */
const SPIKE_DELEGATIONS: PlannedDelegation[] = [
  { agentId: 'weather', prompt: 'What is the current weather in Aarhus, Denmark?' },
  { agentId: 'calendar', prompt: 'What is on my calendar today?' },
];

/**
 * Registers a fresh plan, then sweeps the older ones.
 *
 * Sweeping after rather than before, so the newest plan is already among the rows being
 * counted and the list settles at exactly the number kept.
 *
 * Failure is logged rather than thrown: a spike must not take the server down, and the log
 * line answers a second question for free -- whether a graph of this shape validates at all.
 */
export async function registerRoutingGraphSpike(mastra: Mastra): Promise<void> {
  const planId = `routing-plan-${Date.now()}`;

  try {
    await mastra.addDynamicWorkflows(buildRoutingPlan(planId, SPIKE_DELEGATIONS));
    logger.info('Registered a routing plan; look for it in Studio', {
      planId,
      origin: mastra.getWorkflowOrigin(planId),
    });
  } catch (error) {
    logger.error('Routing plan could not be registered', { planId, error });
    return;
  }

  await sweepOldRoutingPlans(mastra);
}
