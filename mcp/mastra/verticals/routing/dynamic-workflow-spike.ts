import type { Mastra } from '@mastra/core';
import type { DynamicWorkflowGraph } from '@mastra/core/workflows';
import { logger } from '../../utils/logger.js';

/**
 * A spike, to answer one question before anything is built on it: does Studio draw a
 * workflow that was registered at runtime?
 *
 * Routing gave up its Studio graph when the task DAG went away (#718). Workflows are the
 * only primitive Studio graphs, so getting the picture back means routing has to *be* a
 * workflow -- and since which agents a request needs is only known once the request
 * arrives, that workflow has to be built per request.
 *
 * Mastra supports the shape: `addDynamicWorkflow` validates a graph, persists it and
 * live-registers it, `getWorkflowOrigin` reports such a workflow as `dynamic`, and the
 * validation module names "Studio draft UI" as one of its consumers. All of which strongly
 * implies Studio renders these. Implying is not showing, and the entire value of the
 * redesign is the picture, so this registers one and leaves it to be looked at.
 *
 * It is deliberately shaped like a routing plan rather than a toy: two independent
 * delegations running in parallel, then something that reads both. If Studio draws this,
 * it will draw a real plan.
 *
 * Delete this file once the question is answered either way.
 */

/** The id the spike registers under, so a second boot can recognise its own row. */
const SPIKE_WORKFLOW_ID = 'routing-graph-spike';

/**
 * What a planner would emit for "what is the weather, and what is on my calendar".
 *
 * Agent steps rather than code steps, because that is what a routing plan is made of: the
 * graph names agents by id and Mastra resolves them against the live instance.
 */
const SPIKE_GRAPH: DynamicWorkflowGraph = {
  id: SPIKE_WORKFLOW_ID,
  description: 'Spike: can Studio draw a workflow registered at runtime?',
  inputSchema: {
    type: 'object',
    properties: { userQuery: { type: 'string' } },
    required: ['userQuery'],
  },
  outputSchema: { type: 'object' },
  graph: [
    {
      type: 'parallel',
      steps: [
        { type: 'agent', id: 'ask-weather', agentId: 'weather' },
        { type: 'agent', id: 'ask-calendar', agentId: 'calendar' },
      ],
    },
  ],
};

/**
 * Registers the spike, unless it is already there.
 *
 * A dynamic workflow is persisted, and persisted definitions are rehydrated on boot, so the
 * second start would otherwise fail on a duplicate id. Failure is logged rather than thrown:
 * a spike that cannot register must not take the server down with it, and the log line is
 * the answer to a different question -- whether the graph validates at all.
 */
export async function registerRoutingGraphSpike(mastra: Mastra): Promise<void> {
  if (mastra.getWorkflowOrigin(SPIKE_WORKFLOW_ID)) {
    logger.info('Routing graph spike is already registered', { workflowId: SPIKE_WORKFLOW_ID });
    return;
  }

  try {
    await mastra.addDynamicWorkflow(SPIKE_GRAPH);
    logger.info('Routing graph spike registered; look for it in Studio', {
      workflowId: SPIKE_WORKFLOW_ID,
      origin: mastra.getWorkflowOrigin(SPIKE_WORKFLOW_ID),
    });
  } catch (error) {
    logger.error('Routing graph spike could not be registered', { workflowId: SPIKE_WORKFLOW_ID, error });
  }
}
