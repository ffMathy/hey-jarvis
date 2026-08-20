import { describe, expect, it } from 'bun:test';
import { getEmailParsingAgent } from './agents.js';

/**
 * Constructing the agent neither contacts the model provider nor needs an API key,
 * so these tests only pin down the configuration. Nothing here calls `generate()`.
 */
describe('getEmailParsingAgent', () => {
  it('identifies itself as the email response parser', async () => {
    const agent = await getEmailParsingAgent();

    expect(agent.id).toBe('emailResponseParser');
    expect(agent.name).toBe('EmailResponseParser');
  });

  it('instructs the model how to interpret informal replies', async () => {
    const agent = await getEmailParsingAgent();

    const instructions = await agent.getInstructions();
    expect(typeof instructions).toBe('string');
    expect(instructions).toContain('parsing email responses');
    expect(instructions).toContain('interpret as approval');
    expect(instructions).toContain('interpret as rejection');
    expect(instructions).toContain('use null or empty values');
  });

  it('has no tools of its own', async () => {
    const agent = await getEmailParsingAgent();

    expect(Object.keys(await agent.listTools())).toEqual([]);
  });
});
