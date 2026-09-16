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
import { SPIKE_BUNDLE } from './dynamic-workflow-spike.js';

/** What the validator is told exists. Reference checks only run for the kinds listed. */
const REGISTRY = {
  agents: { weather: {}, calendar: {} },
  workflows: Object.fromEntries(SPIKE_BUNDLE.map((workflow) => [workflow.id, {}])),
};

function issuesFor(graph: unknown): string[] {
  return validateDynamicWorkflow(graph as never, REGISTRY as never).map((issue) => `${issue.code} ${issue.path}`);
}

describe('the spike bundle', () => {
  it('is accepted, so registering it can only fail for reasons other than its shape', () => {
    for (const workflow of SPIKE_BUNDLE) {
      expect({ id: workflow.id, issues: issuesFor(workflow) }).toEqual({ id: workflow.id, issues: [] });
    }
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
