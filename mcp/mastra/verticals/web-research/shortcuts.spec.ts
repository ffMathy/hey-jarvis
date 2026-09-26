/**
 * `visualizeResearch` tests.
 *
 * The page builder it hands off to reaches a Claude cloud session and a phone, so it is replaced
 * for each test with `spyOn` -- scoped to the test, unlike `mock.module`. What is left is the
 * shortcut's own promises: that the research agent has it, that routing sees it as slow, and that
 * the request it was given reaches the builder whole.
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { isSlowTask } from '../../utils/slow-tasks.js';
import { executeTool } from '../../utils/tool-factory.js';
import { generateUserInterface } from '../generative-ui/tools.js';
import { getWebResearchAgent } from './agent.js';
import { visualizeResearch } from './shortcuts.js';

const builtPage = {
  success: true,
  artifactUrl: 'https://claude.ai/artifact/abc123',
  sentToPhone: true,
  message: 'Built and sent to the phone.',
};

let generateUserInterfaceSpy: ReturnType<typeof spyOn<typeof generateUserInterface, 'execute'>>;

beforeEach(() => {
  generateUserInterfaceSpy = spyOn(generateUserInterface, 'execute').mockResolvedValue(builtPage);
});

afterEach(() => {
  generateUserInterfaceSpy.mockRestore();
});

describe('visualizeResearch', () => {
  it('is one of the research agent’s tools, beside its search', async () => {
    const tools = await (await getWebResearchAgent()).listTools();

    expect(Object.keys(tools)).toEqual(expect.arrayContaining(['googleSearch', 'visualizeResearch']));
  });

  it('is marked slow, so routing offers to send the page on instead of holding the call', () => {
    expect(isSlowTask(visualizeResearch.id)).toBe(true);
  });

  it('takes exactly what the page builder takes', () => {
    expect(visualizeResearch.inputSchema).toBe(generateUserInterface.inputSchema);
    expect(visualizeResearch.outputSchema).toBe(generateUserInterface.outputSchema);
  });

  it('hands the research to the page builder whole, and returns what it built', async () => {
    const request = 'Chart the day-ahead electricity prices in DK1 for today: 00-06 1.10 DKK, 06-12 2.40 DKK.';

    const result = await executeTool(visualizeResearch, { request, title: 'Electricity prices', sendToPhone: false });

    expect(result).toEqual(builtPage);
    expect(generateUserInterfaceSpy).toHaveBeenCalledTimes(1);
    expect(generateUserInterfaceSpy.mock.calls[0][0]).toEqual({
      request,
      title: 'Electricity prices',
      sendToPhone: false,
    });
  });
});
