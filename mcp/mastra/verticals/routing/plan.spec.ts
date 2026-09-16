/**
 * Whether a plan is a graph Mastra will accept.
 *
 * `validateDynamicWorkflow` is the same check `addDynamicWorkflows` runs before it persists
 * anything, and it is pure -- no instance, no model, no credentials. So the question "would
 * this register?" is answerable here in milliseconds rather than by restarting a server and
 * reading a log, which is how the first two attempts at this shape were found to be wrong.
 *
 * A plan is built from whatever the planner wrote, per request, so a graph that fails
 * validation fails the user's request. The rejections are pinned alongside the acceptance,
 * because they are the authoring rules a generated plan has to respect and there is nothing
 * else that states them.
 */

import { describe, expect, it } from 'bun:test';
import { validateDynamicWorkflow } from '@mastra/core/workflows';
import { buildRoutingPlan, type PlannedChain } from './plan.js';

/** Two independent questions and one that needs the answer to another. */
const CHAINS: PlannedChain[] = [
  { delegations: [{ agentId: 'calendar', prompt: 'What is on my calendar?' }] },
  {
    delegations: [
      { agentId: 'internetOfThings', prompt: 'Where is the user right now?' },
      { agentId: 'weather', prompt: 'What is the weather there?' },
    ],
  },
];

const PLAN = buildRoutingPlan('routing-plan-test', CHAINS);

/** What the validator is told exists. Reference checks only run for the kinds listed. */
const REGISTRY = {
  agents: { weather: {}, calendar: {}, internetOfThings: {} },
  workflows: Object.fromEntries(PLAN.graphs.map((workflow) => [workflow.id, {}])),
};

/**
 * A literal `${`, spelled so the linter does not read this file's fixtures as templates.
 *
 * The fixtures below exist precisely because a prompt can contain one, so writing it
 * straight would have the check that guards against it flagged as the mistake it guards
 * against.
 */
const OPEN_PLACEHOLDER = `$${'{'}`;

function issuesFor(graph: unknown): string[] {
  return validateDynamicWorkflow(graph as never, REGISTRY as never).map((issue) => `${issue.code} ${issue.path}`);
}

describe('a routing plan', () => {
  it('is accepted, so registering it can only fail for reasons other than its shape', () => {
    for (const workflow of PLAN.graphs) {
      expect({ id: workflow.id, issues: issuesFor(workflow) }).toEqual({ id: workflow.id, issues: [] });
    }
  });

  it('tags every member with its plan, so a sweep can take a plan whole', () => {
    // A chain left behind when its root goes would leave the list holding a workflow that
    // nothing runs.
    expect(PLAN.graphs.map((workflow) => workflow.metadata)).toEqual(
      PLAN.graphs.map(() => ({ kind: 'routing-plan', planId: 'routing-plan-test' })),
    );
  });

  it('runs its chains in parallel, which is the shape worth drawing', () => {
    const root = PLAN.graphs[PLAN.graphs.length - 1];

    expect(root?.graph).toEqual([
      {
        type: 'parallel',
        steps: [
          { type: 'workflow', id: 'chain-0', workflowId: 'routing-plan-test-chain-0' },
          { type: 'workflow', id: 'chain-1', workflowId: 'routing-plan-test-chain-1' },
        ],
      },
    ]);
  });

  it('gives the first delegation in a chain its prompt as a constant', () => {
    const chain = PLAN.graphs[0];

    expect(chain?.graph[0]).toEqual({
      type: 'mapping',
      id: 'routing-plan-test-chain-0-0-calendar-prompt',
      mapConfig: JSON.stringify({
        prompt: { value: 'What is on my calendar?', schema: { type: 'string' } },
      }),
    });
  });

  it('hands a chained delegation the previous answer, because nothing else can', () => {
    // An agent cannot see the request, the plan, or any other agent's answer. A chain that
    // did not carry the previous result forward would be a sequence in name only.
    const chained = PLAN.graphs[1];
    const mapping = chained?.graph[2];

    expect(mapping).toMatchObject({ type: 'mapping', id: 'routing-plan-test-chain-1-1-weather-prompt' });
    const mapConfig = JSON.parse((mapping as { mapConfig: string }).mapConfig);
    expect(mapConfig.prompt.template).toContain('What is the weather there?');
    expect(mapConfig.prompt.template).toContain(`${OPEN_PLACEHOLDER}inputData.text}`);
  });

  it('keeps a prompt that looks like a template out of the template parser', () => {
    // `${` starts a placeholder in a template mapping, so a prompt quoting one -- a shell
    // snippet, a price, anything the user said -- would be rejected as an unknown namespace
    // and take the whole request with it.
    const plan = buildRoutingPlan('routing-plan-dollar', [
      {
        delegations: [
          { agentId: 'calendar', prompt: 'first' },
          { agentId: 'weather', prompt: `echo ${OPEN_PLACEHOLDER}HOME} please` },
        ],
      },
    ]);

    expect(issuesFor(plan.graphs[0])).toEqual([]);
  });

  it('names every delegation before anything runs, so a poll can say what is outstanding', () => {
    expect([...PLAN.agentByStepId.values()]).toEqual(['calendar', 'internetOfThings', 'weather']);
    expect(PLAN.delegationCount).toBe(3);
  });

  it('says which delegation a chain’s own result answers for', () => {
    // A chain reports its last step's text as its own output, and that arrives whether or
    // not the chain's inner steps reach the parent stream.
    expect(PLAN.delegationIdsByChainStepId.get('chain-1')).toEqual([
      'routing-plan-test-chain-1-0-internetOfThings',
      'routing-plan-test-chain-1-1-weather',
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

  it('rejects a mapping inside a parallel, which is why each chain is its own workflow', () => {
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

  it('rejects a template placeholder that names a namespace it does not have', () => {
    // The rule the prompt sanitiser exists for.
    const issues = issuesFor({
      id: 'bad-template',
      inputSchema: { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] },
      outputSchema: { type: 'object' },
      graph: [
        {
          type: 'mapping',
          id: 'map',
          mapConfig: JSON.stringify({ prompt: { template: `echo ${OPEN_PLACEHOLDER}HOME}` } }),
        },
      ],
    });

    expect(issues).toContain('invalid-map-reference graph.0.mapConfig.prompt.template');
  });
});
