/**
 * The requirements interviewer is the one agent whose job is to ask, so it is the one agent that
 * must not be given the guideline every other agent gets: never ask questions, make a best guess.
 * Given both, it would be told to ask one question at a time and never to ask at all.
 */

import { describe, expect, it } from 'bun:test';
import { getRequirementsInterviewerAgent } from './agent.js';

describe('getRequirementsInterviewerAgent', () => {
  it('is not told never to ask questions', async () => {
    const agent = await getRequirementsInterviewerAgent();
    const instructions = await agent.getInstructions();

    expect(instructions).toContain('ONE QUESTION AT A TIME');
    expect(instructions).not.toContain('Never ask questions');
  });

  it('is still told the time', async () => {
    const agent = await getRequirementsInterviewerAgent();

    expect(await agent.getInstructions()).toContain('The time is currently:');
  });
});
