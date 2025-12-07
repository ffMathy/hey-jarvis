import { describe, expect, test } from 'bun:test';
import { getWebResearchAgent } from './agent.js';
import { webResearchTools } from './tools.js';

describe('Web Research Agent - Google Search Tool Migration', () => {
  test('should be created successfully with correct name', async () => {
    const agent = await getWebResearchAgent();

    // Verify agent is created with correct name
    expect(agent).toBeDefined();
    expect(agent.name).toBe('WebResearch');
  });

  test('webResearchTools should contain googleSearch tool', () => {
    // Verify googleSearch tool is exported (replaces Tavily tools)
    expect(webResearchTools).toBeDefined();
    expect(webResearchTools.googleSearch).toBeDefined();
    expect(typeof webResearchTools.googleSearch).toBe('object');
  });

  test('googleSearch tool should have expected provider-defined structure', () => {
    const { googleSearch } = webResearchTools;

    // Verify tool has expected properties (based on AI SDK provider-defined tools)
    expect(googleSearch).toBeDefined();
    expect(googleSearch).toHaveProperty('type');
    expect(googleSearch.type).toBe('provider-defined');
    expect(googleSearch).toHaveProperty('name');
    expect(googleSearch.name).toBe('google_search');
    expect(googleSearch).toHaveProperty('id');
    expect(googleSearch.id).toBe('google.google_search');
  });

  test('webResearchTools exports are properly configured', () => {
    // Verify that the tools object has the correct structure
    expect(webResearchTools.googleSearch).toBe(webResearchTools.googleSearch);
    expect(Object.keys(webResearchTools)).toContain('googleSearch');
    expect(Object.keys(webResearchTools).length).toBeGreaterThan(0);
  });
});
