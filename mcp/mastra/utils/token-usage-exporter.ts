/**
 * Token Usage Exporter
 *
 * Custom AI tracing exporter that captures token usage from model generations
 * and persists them to the token usage storage for quota tracking.
 */

import type { IMastraLogger } from '@mastra/core/logger';
import type {
  AnyExportedSpan,
  AnySpan,
  ModelGenerationAttributes,
  ObservabilityExporter,
  SpanOutputProcessor,
  TracingEvent,
} from '@mastra/core/observability';
import { getTokenUsageStorage } from '../storage/index.js';

export class TokenUsageExporter implements ObservabilityExporter {
  name = 'token-usage-exporter';
  private logger?: IMastraLogger;

  init(): void {
    // Initialization if needed
  }

  __setLogger(logger: IMastraLogger): void {
    this.logger = logger;
  }

  async exportTracingEvent(event: TracingEvent): Promise<void> {
    // Only process span_ended events for model generations
    if (event.type !== 'span_ended') {
      return;
    }

    const span: AnyExportedSpan = event.exportedSpan;

    // Only track MODEL_GENERATION spans
    if (span.type !== 'model_generation') {
      return;
    }

    // Cast attributes to ModelGenerationAttributes (safe after type guard)
    const attributes = span.attributes as ModelGenerationAttributes | undefined;
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
export class TokenTrackingProcessor implements SpanOutputProcessor {
  name = 'token-tracking-processor';

  process(span?: AnySpan): AnySpan | undefined {
    if (!span) return undefined;

    // For AGENT_RUN spans, add agentId to metadata
    if (span.type === 'agent_run') {
      const agentRunSpan = span as AnySpan & { attributes?: { agentId?: string } };
      if (agentRunSpan.attributes?.agentId) {
        span.metadata = {
          ...span.metadata,
          agentId: agentRunSpan.attributes.agentId,
        };
      }
    }

    // For WORKFLOW_RUN spans, add workflowId to metadata
    if (span.type === 'workflow_run') {
      const workflowRunSpan = span as AnySpan & { attributes?: { workflowId?: string } };
      if (workflowRunSpan.attributes?.workflowId) {
        span.metadata = {
          ...span.metadata,
          workflowId: workflowRunSpan.attributes.workflowId,
        };
      }
    }

    // For MODEL_GENERATION spans, inherit context from parent
    if (span.type === 'model_generation') {
      const parent = (span as AnySpan & { parent?: { metadata?: Record<string, unknown> } }).parent;
      if (parent?.metadata) {
        span.metadata = {
          ...span.metadata,
          agentId: parent.metadata.agentId,
          workflowId: parent.metadata.workflowId,
        };
      }
    }

    return span;
  }

  async shutdown(): Promise<void> {
    // Cleanup if needed
  }
}
