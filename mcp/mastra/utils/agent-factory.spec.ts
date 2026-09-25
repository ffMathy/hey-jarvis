/**
 * The step budget every agent is built with.
 *
 * A step is one turn of the tool loop, and Mastra's default of five is not a failure when it
 * runs out — the run simply ends on a tool-calls step and returns an empty string. Routing
 * reports that as "finished without answering", and the calendar hit it on every request that
 * asked for a week at a time: enough calls to enumerate the calendars, none left to answer
 * with. Nothing in the answer says which limit it was up against, so the budget is pinned here
 * instead.
 *
 * The model is a stand-in that insists on a given number of tool calls before it will write
 * anything, which is the only part of a provider this question needs. It streams, because
 * streaming is the call a routing plan's agent step makes.
 */

import { afterEach, describe, expect, it, setSystemTime } from 'bun:test';
import type { LanguageModelV3CallOptions, LanguageModelV3StreamPart, LanguageModelV3Usage } from '@ai-sdk/provider';
import { z } from 'zod';
import { createAgent } from './agent-factory.js';
import { createTool } from './tool-factory.js';

/** A provider's token accounting, which nothing here looks at but the stream shape requires. */
const usage: LanguageModelV3Usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};

function streamOf(parts: LanguageModelV3StreamPart[]) {
  return {
    stream: new ReadableStream<LanguageModelV3StreamPart>({
      start(controller) {
        for (const part of parts) {
          controller.enqueue(part);
        }
        controller.close();
      },
    }),
  };
}

/** An agent whose model calls `ping` the given number of times before it answers. */
async function createAgentNeedingToolCalls(toolCallsNeeded: number) {
  const counts = { toolCallsMade: 0, stepsServed: 0 };

  const ping = createTool({
    id: 'ping',
    description: 'Answers nothing in particular',
    inputSchema: z.object({}),
    outputSchema: z.object({ pong: z.boolean() }),
    execute: async () => {
      counts.toolCallsMade += 1;
      return { pong: true };
    },
  });

  const serveOneStep = async () => {
    counts.stepsServed += 1;

    if (counts.toolCallsMade < toolCallsNeeded) {
      return streamOf([
        { type: 'stream-start', warnings: [] },
        { type: 'tool-call', toolCallId: `call-${counts.stepsServed}`, toolName: 'ping', input: '{}' },
        { type: 'finish', finishReason: { unified: 'tool-calls' as const, raw: 'tool-calls' }, usage },
      ]);
    }

    const textId = `text-${counts.stepsServed}`;
    return streamOf([
      { type: 'stream-start', warnings: [] },
      { type: 'text-start', id: textId },
      { type: 'text-delta', id: textId, delta: `Answered after ${counts.toolCallsMade} tool calls.` },
      { type: 'text-end', id: textId },
      { type: 'finish', finishReason: { unified: 'stop' as const, raw: 'stop' }, usage },
    ]);
  };

  const agent = await createAgent({
    id: 'budget-probe',
    name: 'BudgetProbe',
    instructions: 'Call ping until you can answer.',
    tools: { ping },
    model: {
      specificationVersion: 'v3',
      provider: 'test',
      modelId: 'test',
      supportedUrls: {},
      doStream: serveOneStep,
      // Mastra asks a model for a stream either way; both entry points are the same here.
      doGenerate: serveOneStep,
    },
    // The shared memory reaches for an embedder, which wants credentials a mocked test has
    // none of. The step budget is decided before any of that matters.
    memory: undefined,
  });

  return { agent, counts };
}

describe('createAgent', () => {
  it('lets an agent finish a tool loop longer than Mastra’s default of five', async () => {
    // Six is the case that was breaking: the calendar spent its five steps listing calendars
    // and reading them, and the run ended before it could say a word about what it found.
    const { agent, counts } = await createAgentNeedingToolCalls(6);

    const streamed = await agent.stream([{ role: 'user', content: 'Answer me.' }]);
    const text = await streamed.text;

    expect(counts.toolCallsMade).toBe(6);
    expect(text).toBe('Answered after 6 tool calls.');
  }, 30000);

  it('still stops a model that will not stop calling tools', async () => {
    // The budget is a ceiling as much as an allowance: a model that has started looping is
    // cut off rather than left running against a real provider's billing.
    const { agent, counts } = await createAgentNeedingToolCalls(100);

    const streamed = await agent.stream([{ role: 'user', content: 'Answer me.' }]);
    await streamed.text;

    expect(counts.toolCallsMade).toBeLessThan(100);
  }, 30000);
});

/** A model that answers every call at once, handing each call's system messages to `onCall`. */
function modelReadingSystemPrompt(onCall: (systemMessages: string[]) => void) {
  const answer = async ({ prompt }: LanguageModelV3CallOptions) => {
    onCall(prompt.flatMap((message) => (message.role === 'system' ? [message.content] : [])));

    return streamOf([
      { type: 'stream-start', warnings: [] },
      { type: 'text-start', id: 'text' },
      { type: 'text-delta', id: 'text', delta: 'Answered.' },
      { type: 'text-end', id: 'text' },
      { type: 'finish', finishReason: { unified: 'stop' as const, raw: 'stop' }, usage },
    ]);
  };

  return {
    specificationVersion: 'v3' as const,
    provider: 'test',
    modelId: 'test',
    supportedUrls: {},
    doStream: answer,
    doGenerate: answer,
  };
}

/**
 * What every agent is told on top of its own instructions.
 *
 * These were once built and then overwritten by the caller's bare instructions, so for a while no
 * agent was told the time or told not to ask questions, and nothing noticed. The exact text is
 * pinned here for that reason.
 */
describe('createAgent instructions', () => {
  afterEach(() => {
    setSystemTime();
  });

  async function createProbe(extra: { asksQuestions?: boolean } = {}) {
    return createAgent({
      id: 'probe',
      name: 'probe',
      instructions: 'Base instructions.',
      model: modelReadingSystemPrompt(() => {}),
      // The shared memory reaches for an embedder, which wants credentials a mocked test has
      // none of. Instructions are resolved without it.
      memory: undefined,
      ...extra,
    });
  }

  it('follows the agent’s own instructions with the guidelines every agent shares', async () => {
    const now = new Date('2026-09-25T08:30:00Z');
    setSystemTime(now);

    const agent = await createProbe();

    expect(await agent.getInstructions()).toBe(
      [
        'Base instructions.',
        '',
        '# Additional context and guidelines',
        'Never ask questions. Always make best-guess assumptions.',
        `The time is currently: \`${now.toString()}\`.`,
      ].join('\n'),
    );
  });

  it('does not tell an agent whose questions reach the user never to ask them', async () => {
    const now = new Date('2026-09-25T08:30:00Z');
    setSystemTime(now);

    const agent = await createProbe({ asksQuestions: true });

    expect(await agent.getInstructions()).toBe(
      [
        'Base instructions.',
        '',
        '# Additional context and guidelines',
        `The time is currently: \`${now.toString()}\`.`,
      ].join('\n'),
    );
  });

  it('tells the model the time of the request, not the time the agent was built', async () => {
    // Agents are built once, at boot, and the server then runs for days.
    const builtAt = new Date('2026-09-25T08:30:00Z');
    const askedAt = new Date('2026-09-28T19:05:00Z');
    const systemPrompts: string[][] = [];

    setSystemTime(builtAt);
    const agent = await createAgent({
      id: 'probe',
      name: 'probe',
      instructions: 'Base instructions.',
      model: modelReadingSystemPrompt((systemMessages) => systemPrompts.push(systemMessages)),
      memory: undefined,
    });

    setSystemTime(askedAt);
    const streamed = await agent.stream([{ role: 'user', content: 'What time is it?' }]);
    await streamed.text;

    const systemPrompt = systemPrompts.flat().join('\n');
    expect(systemPrompts).toHaveLength(1);
    expect(systemPrompt).toContain(`The time is currently: \`${askedAt.toString()}\`.`);
    expect(systemPrompt).not.toContain(builtAt.toString());
  }, 30000);
});
