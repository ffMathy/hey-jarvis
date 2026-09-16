/**
 * Whether the spike's graphs are ones Mastra will accept.
 *
 * `validateDynamicWorkflow` is the same check `addDynamicWorkflows` runs before it persists
 * anything, and it is pure -- no instance, no model, no credentials. So the question "would
 * this register?" is answerable here in milliseconds rather than by restarting a server and
 * reading a log, which is how the first two attempts were found to be wrong.
 *
 * The rejections are pinned alongside the acceptance, because they are the authoring rules a
 * planner has to emit against and there is nothing else that states them.
 */

import { describe, expect, it } from 'bun:test';
import { validateDynamicWorkflow } from '@mastra/core/workflows';
import { buildRoutingPlan } from './dynamic-workflow-spike.js';

/** A plan of the shape the spike registers, built fresh so the ids are stable to assert on. */
const PLAN = buildRoutingPlan('routing-plan-test', [
  { agentId: 'weather', prompt: 'What is the weather?' },
  { agentId: 'calendar', prompt: 'What is on my calendar?' },
]);

/** What the validator is told exists. Reference checks only run for the kinds listed. */
const REGISTRY = {
  agents: { weather: {}, calendar: {} },
  workflows: Object.fromEntries(PLAN.map((workflow) => [workflow.id, {}])),
};

function issuesFor(graph: unknown): string[] {
  return validateDynamicWorkflow(graph as never, REGISTRY as never).map((issue) => `${issue.code} ${issue.path}`);
}

describe('a routing plan', () => {
  it('is accepted, so registering it can only fail for reasons other than its shape', () => {
    for (const workflow of PLAN) {
      expect({ id: workflow.id, issues: issuesFor(workflow) }).toEqual({ id: workflow.id, issues: [] });
    }
  });

  it('tags every member with its plan, so a sweep can take a plan whole', () => {
    // A branch left behind when its root goes would leave the list holding a workflow that
    // nothing runs.
    expect(PLAN.map((workflow) => workflow.metadata)).toEqual(
      PLAN.map(() => ({ kind: 'routing-plan', planId: 'routing-plan-test' })),
    );
  });

  it('runs its delegations in parallel, which is the shape worth drawing', () => {
    const root = PLAN[PLAN.length - 1];

    expect(root?.graph).toEqual([
      {
        type: 'parallel',
        steps: [
          { type: 'workflow', id: 'branch-0', workflowId: 'routing-plan-test-0-weather' },
          { type: 'workflow', id: 'branch-1', workflowId: 'routing-plan-test-1-calendar' },
        ],
      },
    ]);
  });
});

describe('the authoring rules a generated plan has to respect', () => {
  it('rejects an agent step fed anything but { prompt }', () => {
    // `createStepFromAgent` fixes every agent step's input schema, so the graph has to carry
    // a `prompt` to it. This is what the first attempt got wrong.
    const issues = issuesFor({
      id: 'wrong-input',
      inputSchema: { type: 'object', properties: { userQuery: { type: 'string' } }, required: ['userQuery'] },
      outputSchema: { type: 'object' },
      graph: [{ type: 'agent', id: 'ask', agentId: 'weather' }],
    });

    expect(issues).toContain('incompatible-schema graph.0');
  });

  it('rejects a mapping inside a parallel, which is why each branch is its own workflow', () => {
    const issues = issuesFor({
      id: 'mapping-in-parallel',
      inputSchema: { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] },
      outputSchema: { type: 'object' },
      graph: [
        {
          type: 'parallel',
          steps: [
            {
              type: 'mapping',
              id: 'map',
              mapConfig: JSON.stringify({ prompt: { value: 'hi', schema: { type: 'string' } } }),
            },
            { type: 'agent', id: 'ask', agentId: 'weather' },
          ],
        },
      ],
    });

    expect(issues).toContain('invalid-map-placement graph.0.steps.0');
  });

  it('rejects a mapConfig that is an object rather than the JSON string it is parsed from', () => {
    const issues = issuesFor({
      id: 'object-map-config',
      inputSchema: { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] },
      outputSchema: { type: 'object' },
      graph: [{ type: 'mapping', id: 'map', mapConfig: { prompt: { value: 'hi', schema: { type: 'string' } } } }],
    });

    expect(issues).toContain('invalid-map-config graph.0.mapConfig');
  });
});
