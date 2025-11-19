import type { Processor } from '@mastra/core/processors';
import type { MastraDBMessage } from '@mastra/core/agent';
import { Mastra } from '@mastra/core';

export interface ErrorReportingProcessorOptions {
    /**
     * Repository owner (defaults to "ffMathy")
     */
    owner?: string;
    /**
     * Repository name where issues will be created
     */
    repo: string;
    /**
     * Labels to add to created issues (defaults to ["automated-error", "bug"])
     */
    labels?: string[];
    /**
     * Whether to enable the processor (defaults to true)
     */
    enabled?: boolean;
}

/**
 * Output processor that captures errors from agent responses and creates GitHub issues.
 * 
 * This processor:
 * - Runs asynchronously after the response is complete (non-blocking)
 * - Detects error conditions in the output
 * - Uses the ErrorFilter agent to sanitize PII from error messages
 * - Creates a GitHub issue with the sanitized error details
 * 
 * Usage:
 * ```typescript
 * const agent = await createAgent({
 *   name: 'MyAgent',
 *   instructions: '...',
 *   tools: {...},
 *   outputProcessors: [
 *     createErrorReportingProcessor({
 *       repo: 'hey-jarvis',
 *       labels: ['automated-error', 'my-agent']
 *     })
 *   ]
 * });
 * ```
 */
export function createErrorReportingProcessor(
    options: ErrorReportingProcessorOptions
): Processor {
    const {
        owner = 'ffMathy',
        repo,
        labels = ['automated-error', 'bug'],
        enabled = true,
    } = options;

    return {
        id: 'error-reporting-processor',
        name: 'Error Reporting to GitHub',
        
        async processOutputResult({ messages }) {
            if (!enabled) {
                return messages;
            }

            // Run error detection and reporting asynchronously (non-blocking)
            // We don't await this promise so it doesn't block the response
            void (async () => {
                try {
                    await detectAndReportErrors(messages, {
                        owner,
                        repo,
                        labels,
                    });
                } catch (error) {
                    // Silently log errors in the processor to avoid blocking the main flow
                    console.error('[ErrorReportingProcessor] Failed to process error:', error);
                }
            })();

            // Return messages unchanged (processor doesn't modify output)
            return messages;
        },
    };
}

/**
 * Detects errors in messages and creates GitHub issues for them
 */
async function detectAndReportErrors(
    messages: MastraDBMessage[],
    options: Required<Pick<ErrorReportingProcessorOptions, 'owner' | 'repo' | 'labels'>>
): Promise<void> {
    // Check if any message indicates an error
    const errorMessage = findErrorInMessages(messages);
    if (!errorMessage) {
        return;
    }

    // Get the Mastra instance to access agents and tools
    // We need to import it dynamically to avoid circular dependencies
    const { mastra } = await import('../index.js');
    
    // Use the ErrorFilter agent to sanitize the error
    const sanitizedError = await sanitizeError(mastra, errorMessage);
    
    // Create a GitHub issue with the sanitized error
    await createIssueForError(mastra, sanitizedError, options);
}

/**
 * Finds error indicators in messages
 */
function findErrorInMessages(messages: MastraDBMessage[]): string | null {
    for (const message of messages) {
        const content = typeof message.content === 'string' 
            ? message.content 
            : message.content
                .filter((c) => c.type === 'text')
                .map((c) => 'text' in c ? c.text : '')
                .join(' ');

        // Look for common error indicators
        if (
            content.toLowerCase().includes('error') ||
            content.toLowerCase().includes('failed') ||
            content.toLowerCase().includes('exception') ||
            content.toLowerCase().includes('stack trace')
        ) {
            return content;
        }
    }
    
    return null;
}

/**
 * Uses the ErrorFilter agent to sanitize error messages
 */
async function sanitizeError(mastra: Mastra, errorMessage: string): Promise<string> {
    const errorFilterAgent = mastra.agents.errorFilter;
    
    if (!errorFilterAgent) {
        // If ErrorFilter agent is not available, return the original error
        // This shouldn't happen in production, but provides a fallback
        console.warn('[ErrorReportingProcessor] ErrorFilter agent not found, using original error message');
        return errorMessage;
    }

    try {
        const response = await errorFilterAgent.text({
            messages: [
                {
                    role: 'user',
                    content: `Please sanitize this error message by removing all PII and format it for a GitHub issue:\n\n${errorMessage}`,
                },
            ],
        });

        return response.text;
    } catch (error) {
        console.error('[ErrorReportingProcessor] Failed to sanitize error:', error);
        return `Error sanitization failed. Original error (may contain PII): ${errorMessage}`;
    }
}

/**
 * Creates a GitHub issue using the createGitHubIssue tool
 */
async function createIssueForError(
    mastra: Mastra,
    sanitizedError: string,
    options: Required<Pick<ErrorReportingProcessorOptions, 'owner' | 'repo' | 'labels'>>
): Promise<void> {
    // Import the tool dynamically to avoid circular dependencies
    const { createGitHubIssue } = await import('../verticals/coding/tools.js');

    try {
        const result = await createGitHubIssue.execute({
            context: {
                owner: options.owner,
                repo: options.repo,
                title: 'Automated Error Report',
                body: sanitizedError,
                labels: options.labels,
            },
        });

        if (result.success) {
            console.log(`[ErrorReportingProcessor] Created issue: ${result.issue_url}`);
        } else {
            console.error(`[ErrorReportingProcessor] Failed to create issue: ${result.message}`);
        }
    } catch (error) {
        console.error('[ErrorReportingProcessor] Failed to execute createGitHubIssue tool:', error);
    }
}
