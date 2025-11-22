import type { Agent } from '@mastra/core/agent';

/**
 * Creates a simplified wrapper around an agent that returns clean text responses
 * instead of verbose error objects with metadata.
 */
export function createSimplifiedAgentWrapper(agent: Agent) {
  return {
    async generate(input: { message: string }) {
      try {
        const result = await agent.generate(input.message);

        // Return just the text content
        return result.text || 'No response generated';
      } catch (error: any) {
        // Extract just the error message without all the metadata
        if (error.message) {
          return error.message;
        }
        if (error.details?.message) {
          return error.details.message;
        }
        return 'An error occurred';
      }
    },
  };
}
