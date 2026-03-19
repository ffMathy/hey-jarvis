import type { Agent } from '@mastra/core/agent';

/**
 * Creates a simplified wrapper around an agent that returns clean text responses.
 */
export function createSimplifiedAgentWrapper(agent: Agent) {
  return {
    async generate(input: { message: string }) {
      const result = await agent.generate(input.message);
      return result.text || 'No response generated';
    },
  };
}
