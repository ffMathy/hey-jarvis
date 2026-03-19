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

    // span.attributes is typed as the union of all attribute types; cast to the narrowed type
    // after the span.type === 'model_generation' guard (AnyExportedSpan is not a discriminated union)
    const attributes = span.attributes as ModelGenerationAttributes | undefined;
    if (!attributes || !attributes.usage) {
      return;
    }

    const usage = attributes.usage;

    // Ensure we have non-zero token counts (skip calls with no tokens)
    // Mastra v1 beta.10+ uses inputTokens/outputTokens instead of promptTokens/completionTokens
    if (!usage.inputTokens && !usage.outputTokens) {
      return;
    }

    const promptTokens = usage.inputTokens ?? 0;
    const completionTokens = usage.outputTokens ?? 0;
    const totalTokens = promptTokens + completionTokens;

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
  }

  async flush(): Promise<void> {
    // Flush any pending operations if needed
    // Currently, we write directly to storage, so no buffering to flush
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

    // For AGENT_RUN spans, add agentId from entityId (BaseSpan property holding the creating entity's ID)
    if (span.type === 'agent_run' && span.entityId) {
      span.metadata = {
        ...span.metadata,
        agentId: span.entityId,
      };
    }

    // For WORKFLOW_RUN spans, add workflowId from entityId (BaseSpan property holding the creating entity's ID)
    if (span.type === 'workflow_run' && span.entityId) {
      span.metadata = {
        ...span.metadata,
        workflowId: span.entityId,
      };
    }

    // For MODEL_GENERATION spans, inherit agent/workflow context from the parent span's metadata
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
