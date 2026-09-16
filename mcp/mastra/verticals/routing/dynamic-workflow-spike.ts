import type { Mastra } from '@mastra/core';
import type { DynamicWorkflowGraph } from '@mastra/core/workflows';
import { logger } from '../../utils/logger.js';

/**
 * A spike, to answer one question before anything is built on it: does Studio draw a
 * workflow that was registered at runtime?
 *
 * Routing gave up its Studio graph when the task DAG went away (#718). Workflows are the
 * only primitive Studio graphs, so getting the picture back means routing has to *be* a
 * workflow -- and since which agents a request needs is known only once the request
 * arrives, that workflow has to be built per request.
 *
 * Mastra supports the shape: `addDynamicWorkflows` validates a bundle, persists it and
 * live-registers it, `getWorkflowOrigin` reports the result as `dynamic`, and the
 * validation module names "Studio draft UI" among its consumers. All of which implies
 * Studio renders these, and implying is not showing. The whole value of the redesign is the
 * picture, so this registers a plan and leaves it to be looked at.
 *
 * Delete this file once the question is answered either way.
 */

/** The bundle's root. A second boot recognises its own row by this. */
const ROOT_WORKFLOW_ID = 'routing-graph-spike';

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

/**
 * One delegation: give an agent its own prompt, then run it.
 *
 * A helper workflow rather than two entries in the parallel block, because a `mapping` entry
 * has to be a top-level workflow entry -- putting one inside a `parallel` is rejected with
 * `[invalid-map-placement]`. Since a plan's whole point is asking each agent a *different*
 * question, per-branch prompts mean per-branch workflows. That is the shape a planner has to
 * emit, and it is the main thing this spike learned.
 *
 * `mapConfig` is a JSON string rather than an object: it is parsed by `parseMapConfig` on the
 * way in, and an object is rejected with `[invalid-map-config]`.
 */
function delegationWorkflow(id: string, agentId: string, prompt: string): DynamicWorkflowGraph {
  return {
    id,
    description: `Spike: ask the ${agentId} agent one question`,
    inputSchema: AGENT_STEP_INPUT,
    outputSchema: AGENT_STEP_OUTPUT,
    graph: [
      {
        type: 'mapping',
        id: `${id}-prompt`,
        mapConfig: JSON.stringify({ prompt: { value: prompt, schema: { type: 'string' } } }),
      },
      { type: 'agent', id: `${id}-run`, agentId },
    ],
  };
}

/**
 * What a planner would emit for "what is the weather, and what is on my calendar".
 *
 * Two independent delegations in parallel, which is the shape that matters: if Studio draws
 * this, it draws a routing plan rather than a box.
 */
export const SPIKE_BUNDLE: DynamicWorkflowGraph[] = [
  delegationWorkflow('routing-graph-spike-weather', 'weather', 'What is the current weather in Aarhus, Denmark?'),
  delegationWorkflow('routing-graph-spike-calendar', 'calendar', 'What is on my calendar today?'),
  {
    id: ROOT_WORKFLOW_ID,
    description: 'Spike: can Studio draw a workflow registered at runtime?',
    inputSchema: AGENT_STEP_INPUT,
    outputSchema: { type: 'object' },
    graph: [
      {
        type: 'parallel',
        steps: [
          { type: 'workflow', id: 'weather-branch', workflowId: 'routing-graph-spike-weather' },
          { type: 'workflow', id: 'calendar-branch', workflowId: 'routing-graph-spike-calendar' },
        ],
      },
    ],
  },
];

/**
 * Registers the bundle, unless it is already there.
 *
 * A dynamic workflow is persisted and rehydrated on boot, so a second start would otherwise
 * fail on a duplicate id. Failure is logged rather than thrown: a spike must not take the
 * server down, and the log line answers a second question for free -- whether a graph this
 * shape validates at all.
 */
export async function registerRoutingGraphSpike(mastra: Mastra): Promise<void> {
  if (mastra.getWorkflowOrigin(ROOT_WORKFLOW_ID)) {
    logger.info('Routing graph spike is already registered', { workflowId: ROOT_WORKFLOW_ID });
    return;
  }

  try {
    await mastra.addDynamicWorkflows(SPIKE_BUNDLE);
    logger.info('Routing graph spike registered; look for it in Studio', {
      workflowId: ROOT_WORKFLOW_ID,
      origin: mastra.getWorkflowOrigin(ROOT_WORKFLOW_ID),
    });
  } catch (error) {
    logger.error('Routing graph spike could not be registered', { workflowId: ROOT_WORKFLOW_ID, error });
  }
}
