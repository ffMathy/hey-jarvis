/**
 * Filing a conversation's work under its id.
 *
 * The end-to-end case is the one that matters: a real Mastra, with real observability writing to
 * real (in-memory) storage, runs an agent that calls a tool inside a conversation's scope — and the
 * trace has to come back from `listTraces({ filters: { sessionId } })` with the tool call in it,
 * which is the query Analysis Mode's `describeConversation` makes. It holds the tagging to what
 * Mastra actually stores rather than to what this file guesses it stores.
 */

import { describe, expect, it } from 'bun:test';
import { Mastra } from '@mastra/core';
import { Agent } from '@mastra/core/agent';
import { InMemoryStore } from '@mastra/core/storage';
import { createTool } from '@mastra/core/tools';
import { DefaultExporter, Observability, SamplingStrategyType } from '@mastra/observability';
import { z } from 'zod';
import { createScriptedModel } from '../../tests/utils/scripted-model.js';
import { conversationTraceReport } from '../verticals/reflection/reports.js';
import { conversationTracingOptions, currentConversationId, withinConversation } from './conversation.js';

describe('withinConversation', () => {
  it('reaches work the call leaves running after it has returned', async () => {
    let seenLater: string | undefined;
    let finished!: () => void;
    const done = new Promise<void>((resolve) => {
      finished = resolve;
    });

    // The shape of `routePromptWorkflow`: start the request, return at once, let it run on.
    withinConversation('conv_later', () => {
      void (async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        seenLater = currentConversationId();
        finished();
      })();
    });

    expect(currentConversationId()).toBeUndefined();
    await done;
    expect(seenLater).toBe('conv_later');
  });

  it('keeps two conversations running side by side apart', async () => {
    const seen = await Promise.all(
      ['conv_a', 'conv_b'].map((id) =>
        withinConversation(id, async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          return currentConversationId();
        }),
      ),
    );

    expect(seen).toEqual(['conv_a', 'conv_b']);
  });

  it('ignores a placeholder no client substituted, and an empty id', () => {
    expect(withinConversation('{{system__conversation_id}}', currentConversationId)).toBeUndefined();
    expect(withinConversation('  ', currentConversationId)).toBeUndefined();
    expect(withinConversation(undefined, currentConversationId)).toBeUndefined();
  });
});

describe('conversationTracingOptions', () => {
  it('names the conversation as the trace session', () => {
    expect(withinConversation('conv_1', () => conversationTracingOptions())).toEqual({
      tracingOptions: { metadata: { sessionId: 'conv_1' } },
    });
    expect(conversationTracingOptions(' conv_2 ')).toEqual({ tracingOptions: { metadata: { sessionId: 'conv_2' } } });
  });

  it('adds nothing outside a conversation', () => {
    expect(conversationTracingOptions()).toEqual({});
    expect(conversationTracingOptions('{{system__conversation_id}}')).toEqual({});
  });
});

describe('a conversation on a real trace', () => {
  it("files an agent run and the tool calls inside it under the conversation's id", async () => {
    const storage = new InMemoryStore({ id: 'conversation-spec' });
    const lightsOn = createTool({
      id: 'turnOnLights',
      description: 'Turn on the lights in a room',
      inputSchema: z.object({ room: z.string() }),
      outputSchema: z.object({ on: z.boolean() }),
      execute: async () => ({ on: true }),
    });
    const scripted = createScriptedModel((call) =>
      call.index === 1 ? { toolCalls: [{ toolName: 'turnOnLights', input: { room: 'kitchen' } }] } : { text: 'Done.' },
    );
    const lights = new Agent({
      id: 'lights',
      name: 'lights',
      instructions: 'Turn on lights.',
      model: scripted.model,
      tools: { turnOnLights: lightsOn },
    });
    const mastra = new Mastra({
      agents: { lights },
      storage,
      observability: new Observability({
        configs: {
          default: {
            serviceName: 'conversation-spec',
            sampling: { type: SamplingStrategyType.ALWAYS },
            exporters: [new DefaultExporter()],
          },
        },
      }),
    });

    await withinConversation('conv_kitchen', () =>
      mastra.getAgentById('lights').generate('Turn on the kitchen lights', conversationTracingOptions()),
    );
    // Another conversation's run, which must not come back with this one.
    await mastra
      .getAgentById('lights')
      .generate('Turn on the kitchen lights', conversationTracingOptions('conv_other'));
    await mastra.shutdown();

    const observability = await storage.getStore('observability');
    if (!observability) {
      throw new Error('The in-memory store has no observability domain');
    }
    const { spans: roots } = await observability.listTraces({ filters: { sessionId: 'conv_kitchen' } });
    expect(roots).toHaveLength(1);

    const trace = await observability.getTrace({ traceId: roots[0]?.traceId ?? '' });
    const report = conversationTraceReport(roots[0]?.traceId ?? '', trace?.spans ?? []);

    expect(report.entity).toBe('lights');
    expect(report.failed).toBe(false);
    const toolCall = report.steps.find((step) => step.spanType === 'tool_call');
    expect(toolCall?.name).toContain('turnOnLights');
    expect(toolCall?.input).toContain('kitchen');
    expect(toolCall?.output).toContain('true');
    // Model steps are how the agent got there, not what it did, and are left out.
    expect(report.steps.some((step) => step.spanType === 'model_step')).toBe(false);
  });
});
