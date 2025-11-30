import type { Agent } from '@mastra/core/agent';

// Type for error objects with details property
interface ErrorWithDetails {
  details?: {
    message?: string;
  };
}

// Type guard to check if error has details with message
function hasDetailsMessage(error: unknown): error is ErrorWithDetails {
  return (
    typeof error === 'object' &&
    error !== null &&
    'details' in error &&
    typeof (error as ErrorWithDetails).details === 'object' &&
    typeof (error as ErrorWithDetails).details?.message === 'string'
  );
}

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
        if (hasDetailsMessage(error)) {
          return error.details?.message ?? 'An error occurred';
        }
        return 'An error occurred';
      }
    },
  };
}
