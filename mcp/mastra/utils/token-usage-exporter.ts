/**
 * Token Usage Exporter
 *
 * Custom AI tracing exporter that captures token usage from model generations
 * and persists them to the token usage storage for quota tracking.
 */

import type { IMastraLogger } from '@mastra/core/logger';
import type { AISpanProcessor, AITracingEvent, AITracingExporter, AnyAISpan } from '@mastra/observability';
import { getTokenUsageStorage } from '../storage/index.js';

export class TokenUsageExporter implements AITracingExporter {
  name = 'token-usage-exporter';
  private logger?: IMastraLogger;

  init(): void {
    // Initialization if needed
  }

  setLogger(logger: IMastraLogger): void {
    this.logger = logger;
  }

  async exportEvent(event: AITracingEvent): Promise<void> {
    // Only process span_ended events for model generations
    if (event.type !== 'span_ended') {
      return;
    }

    const span = event.exportedSpan;

    // Only track MODEL_GENERATION spans
    if (span.type !== 'model_generation') {
      return;
    }

    // Extract token usage from span attributes
    const attributes = span.attributes;
    if (!attributes || !attributes.usage) {
      return;
    }

    const usage = attributes.usage;

    // Ensure we have non-zero token counts (skip calls with no tokens)
    if (!usage.totalTokens && !usage.promptTokens && !usage.completionTokens) {
      return;
    }

    const promptTokens = usage.promptTokens ?? 0;
    const completionTokens = usage.completionTokens ?? 0;
    const totalTokens = usage.totalTokens ?? promptTokens + completionTokens;

    // Get model and provider information
    const model = attributes.model ?? 'unknown';
    const provider = attributes.provider ?? 'unknown';

    // Find the root span to get agent/workflow context
    let agentId: string | undefined;
    let workflowId: string | undefined;

    // Search through metadata for agent/workflow IDs
    if (span.metadata) {
      agentId = span.metadata.agentId as string | undefined;
      workflowId = span.metadata.workflowId as string | undefined;
    }

    try {
      const storage = await getTokenUsageStorage();

      await storage.recordUsage({
        model,
        provider,
        promptTokens,
        completionTokens,
        totalTokens,
        traceId: span.traceId,
        agentId,
        workflowId,
      });

      this.logger?.debug('Token usage recorded', {
        model,
        provider,
        promptTokens,
        completionTokens,
        totalTokens,
        traceId: span.traceId,
      });
    } catch (error) {
      this.logger?.error('Failed to record token usage', {
        error: error instanceof Error ? error.message : String(error),
        model,
        provider,
      });
    }
  }

  async shutdown(): Promise<void> {
    // Cleanup if needed
  }
}

/**
 * Processor that enriches spans with agent/workflow context for token tracking
 */
export class TokenTrackingProcessor implements AISpanProcessor {
  name = 'token-tracking-processor';

  process(span?: AnyAISpan): AnyAISpan | undefined {
    if (!span) return undefined;

    // For AGENT_RUN spans, add agentId to metadata
    if (span.type === 'agent_run' && span.attributes?.agentId) {
      span.metadata = {
        ...span.metadata,
        agentId: span.attributes.agentId,
      };
    }

    // For WORKFLOW_RUN spans, add workflowId to metadata
    if (span.type === 'workflow_run' && span.attributes?.workflowId) {
      span.metadata = {
        ...span.metadata,
        workflowId: span.attributes.workflowId,
      };
    }

    // For MODEL_GENERATION spans, inherit context from parent
    if (span.type === 'model_generation' && span.parent?.metadata) {
      span.metadata = {
        ...span.metadata,
        agentId: span.parent.metadata.agentId,
        workflowId: span.parent.metadata.workflowId,
      };
    }

    return span;
  }

  async shutdown(): Promise<void> {
    // Cleanup if needed
  }
}
