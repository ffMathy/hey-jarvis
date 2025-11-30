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
      } catch (error: unknown) {
        // Extract just the error message without all the metadata
        if (error instanceof Error) {
          return error.message;
        }
        if (
          typeof error === 'object' &&
          error !== null &&
          'details' in error &&
          typeof (error as { details?: { message?: string } }).details === 'object' &&
          (error as { details?: { message?: string } }).details?.message
        ) {
          return (error as { details: { message: string } }).details.message;
        }
        return 'An error occurred';
      }
    },
  };
}
