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

    // Check if attributes has the required ModelGenerationAttributes structure
    const attributes = span.attributes;
    if (!attributes || typeof attributes !== 'object') {
      return;
    }

    // Type guard to check for usage property
    if (!('usage' in attributes) || !attributes.usage || typeof attributes.usage !== 'object') {
      return;
    }

    const usage = attributes.usage;

    // Type guard for token counts
    if (!('inputTokens' in usage) || !('outputTokens' in usage)) {
      return;
    }

    // Ensure we have non-zero token counts (skip calls with no tokens)
    // Mastra v1 beta.10+ uses inputTokens/outputTokens instead of promptTokens/completionTokens
    if (!usage.inputTokens && !usage.outputTokens) {
      return;
    }

    const promptTokens = typeof usage.inputTokens === 'number' ? usage.inputTokens : 0;
    const completionTokens = typeof usage.outputTokens === 'number' ? usage.outputTokens : 0;
    const totalTokens = promptTokens + completionTokens;

    // Get model and provider information with runtime checks
    const model = 'model' in attributes && typeof attributes.model === 'string' ? attributes.model : 'unknown';
    const provider =
      'provider' in attributes && typeof attributes.provider === 'string' ? attributes.provider : 'unknown';

    // Find the root span to get agent/workflow context
    let agentId: string | undefined;
    let workflowId: string | undefined;

    // Search through metadata for agent/workflow IDs with runtime type checks
    if (span.metadata && typeof span.metadata === 'object') {
      if ('agentId' in span.metadata && typeof span.metadata.agentId === 'string') {
        agentId = span.metadata.agentId;
      }
      if ('workflowId' in span.metadata && typeof span.metadata.workflowId === 'string') {
        workflowId = span.metadata.workflowId;
      }
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

  async flush(): Promise<void> {
    // Flush any pending token usage data
    // Currently we write synchronously, so nothing to flush
  }

  async shutdown(): Promise<void> {
    // Cleanup if needed
    await this.flush();
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
      if (
        span.attributes &&
        typeof span.attributes === 'object' &&
        'agentId' in span.attributes &&
        typeof span.attributes.agentId === 'string'
      ) {
        span.metadata = {
          ...span.metadata,
          agentId: span.attributes.agentId,
        };
      }
    }

    // For WORKFLOW_RUN spans, add workflowId to metadata
    if (span.type === 'workflow_run') {
      if (
        span.attributes &&
        typeof span.attributes === 'object' &&
        'workflowId' in span.attributes &&
        typeof span.attributes.workflowId === 'string'
      ) {
        span.metadata = {
          ...span.metadata,
          workflowId: span.attributes.workflowId,
        };
      }
    }

    // For MODEL_GENERATION spans, inherit context from parent
    if (span.type === 'model_generation') {
      if (
        'parent' in span &&
        span.parent &&
        typeof span.parent === 'object' &&
        'metadata' in span.parent &&
        span.parent.metadata
      ) {
        const parentMetadata = span.parent.metadata;
        if (typeof parentMetadata === 'object') {
          const inheritedMetadata: Record<string, unknown> = {};
          if ('agentId' in parentMetadata) {
            inheritedMetadata.agentId = parentMetadata.agentId;
          }
          if ('workflowId' in parentMetadata) {
            inheritedMetadata.workflowId = parentMetadata.workflowId;
          }
          span.metadata = {
            ...span.metadata,
            ...inheritedMetadata,
          };
        }
      }
    }

    return span;
  }

  async shutdown(): Promise<void> {
    // Cleanup if needed
  }
}
