import { describe, expect, test } from 'bun:test';
import { getWebResearchAgent } from './agent.js';
import { webResearchTools } from './tools.js';

describe('Web Research Agent - Google Search Grounding Migration', () => {
  test('should be created successfully with correct name', async () => {
    const agent = await getWebResearchAgent();

    // Verify agent is created with correct name
    expect(agent).toBeDefined();
    expect(agent.name).toBe('WebResearch');
  });

  test('webResearchTools should be empty (Tavily tools removed)', () => {
    // Verify no tools are exported - they've been replaced with Google Search grounding
    // which is built into the agent's model configuration
    expect(Object.keys(webResearchTools).length).toBe(0);
  });
});
