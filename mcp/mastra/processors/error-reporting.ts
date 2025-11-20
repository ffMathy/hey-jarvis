import type { MastraDBMessage } from '@mastra/core/agent';
import type { TracingContext } from '@mastra/core/observability';
import type { OutputProcessor } from '@mastra/core/processors';
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
export function createErrorReportingProcessor(options: ErrorReportingProcessorOptions): OutputProcessor {
  const { owner = 'ffMathy', repo, labels = ['automated-error', 'bug'], enabled = true } = options;

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

    async processOutputResult({ messages, tracingContext }) {
      console.log('tracing-context', tracingContext);
      if (!enabled || !tracingContext.currentSpan.errorInfo) {
        return messages;
      }

      // Run error detection and reporting asynchronously (non-blocking)
      // We don't await this promise so it doesn't block the response
      void (async () => {
        try {
          await detectAndReportErrors(
            tracingContext,
            {
              owner,
              repo,
              labels,
            },
            piiDetector,
          );
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
  tracingContext: TracingContext,
  options: Required<Pick<ErrorReportingProcessorOptions, 'owner' | 'repo' | 'labels'>>,
  piiDetector: PIIDetector,
): Promise<void> {
  // Use PIIDetector to sanitize the error
  const sanitizedError = await sanitizeError(tracingContext, piiDetector);

  // Create a GitHub issue with the sanitized error
  await createIssueForError(sanitizedError, options);
}

/**
 * Uses Mastra's PIIDetector to sanitize error messages
 */
async function sanitizeError(tracingContext: TracingContext, piiDetector: PIIDetector): Promise<string> {
  try {
    // Create a message structure for the PII detector
    const messages: MastraDBMessage[] = [
      {
        id: 'error-msg',
        role: 'system',
        createdAt: new Date(),
        content: {
          format: 2,
          parts: [{ type: 'text', text: JSON.stringify(tracingContext.currentSpan.errorInfo) }],
        },
      },
    ];

    // Use PIIDetector to sanitize the error message
    const sanitizedMessages = await piiDetector.processOutputResult({
      messages,
      abort: (reason?: string) => {
        throw new Error(reason || 'PII detection aborted');
      },
    });

    // Extract the sanitized content from MastraMessageContentV2
    const sanitizedContent = sanitizedMessages[0]?.content;
    if (sanitizedContent && 'parts' in sanitizedContent) {
      return sanitizedContent.parts
        .filter((part) => part.type === 'text')
        .map((part) => ('text' in part ? part.text : ''))
        .join(' ');
    }

    return JSON.stringify(tracingContext.currentSpan.errorInfo); // Fallback to original if sanitization fails
  } catch (error) {
    console.error('[ErrorReportingProcessor] Failed to sanitize error:', error);
    return `Error sanitization failed. Original error (may contain PII): ${JSON.stringify(tracingContext.currentSpan.errorInfo)}`;
  }
}

/**
 * Creates a GitHub issue using the createGitHubIssue tool
 */
async function createIssueForError(
  sanitizedError: string,
  options: Required<Pick<ErrorReportingProcessorOptions, 'owner' | 'repo' | 'labels'>>,
): Promise<void> {
  // Import the tool dynamically to avoid circular dependencies
  const { createGitHubIssue } = await import('../verticals/coding/tools.js');

  try {
    const result = await createGitHubIssue.execute({
      owner: options.owner,
      repo: options.repo,
      title: 'Automated Error Report',
      body: sanitizedError,
      labels: options.labels,
    });

    if ('success' in result && result.success) {
      console.log(`[ErrorReportingProcessor] Created issue: ${result.issue_url}`);
    } else {
      const errorMsg = 'message' in result ? result.message : 'Unknown error';
      console.error(`[ErrorReportingProcessor] Failed to create issue: ${errorMsg}`);
    }
  } catch (error) {
    console.error('[ErrorReportingProcessor] Failed to execute createGitHubIssue tool:', error);
  }
}
