import type { Processor } from '@mastra/core/processors';
import type { MastraDBMessage } from '@mastra/core/agent';
import { PIIDetector } from '@mastra/core/processors';
import { google } from '../utils/google-provider.js';

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
 * - Uses Mastra's PIIDetector to sanitize PII from error messages
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

    // Create PII detector for sanitizing error messages
    const piiDetector = new PIIDetector({
        model: google('gemini-flash-latest'),
        strategy: 'redact',
        redactionMethod: 'placeholder',
        threshold: 0.6,
    });

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
                    }, piiDetector);
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
    options: Required<Pick<ErrorReportingProcessorOptions, 'owner' | 'repo' | 'labels'>>,
    piiDetector: PIIDetector
): Promise<void> {
    // Check if any message indicates an error
    const errorMessage = findErrorInMessages(messages);
    if (!errorMessage) {
        return;
    }

    // Use PIIDetector to sanitize the error
    const sanitizedError = await sanitizeError(errorMessage, piiDetector);
    
    // Create a GitHub issue with the sanitized error
    await createIssueForError(sanitizedError, options);
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
 * Uses Mastra's PIIDetector to sanitize error messages
 */
async function sanitizeError(errorMessage: string, piiDetector: PIIDetector): Promise<string> {
    try {
        // Create a message structure for the PII detector
        const messages: MastraDBMessage[] = [
            {
                role: 'user',
                content: errorMessage,
            },
        ];

        // Use PIIDetector to sanitize the error message
        const sanitizedMessages = await piiDetector.processOutputResult({
            messages,
            abort: (reason?: string) => {
                throw new Error(reason || 'PII detection aborted');
            },
        });

        // Extract the sanitized content
        const sanitizedContent = sanitizedMessages[0]?.content;
        if (typeof sanitizedContent === 'string') {
            return sanitizedContent;
        } else if (Array.isArray(sanitizedContent)) {
            return sanitizedContent
                .filter((c) => c.type === 'text')
                .map((c) => 'text' in c ? c.text : '')
                .join(' ');
        }

        return errorMessage; // Fallback to original if sanitization fails
    } catch (error) {
        console.error('[ErrorReportingProcessor] Failed to sanitize error:', error);
        return `Error sanitization failed. Original error (may contain PII): ${errorMessage}`;
    }
}

/**
 * Creates a GitHub issue using the createGitHubIssue tool
 */
async function createIssueForError(
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
