import { createMemory } from '../../memory/index.js';
import { getSubscriptionStorage } from '../../storage/index.js';
import { logger } from '../../utils/logger.js';
import { embedTexts } from '../../utils/static-embedder.js';
import { getStateChangeReactorAgent } from './agent.js';
import { describeStateChange, type StateChange } from './state-change.js';
import { formatSubscriptionMatches, rankSubscriptions } from './subscription-matcher.js';

export type { StateChange } from './state-change.js';

/**
 * Pending state change with timestamp for batching
 */
interface PendingStateChange extends StateChange {
  timestamp: Date;
  retryCount: number;
}

/**
 * Indents every line of a multi-line block so it nests under a numbered list
 * entry in the batch prompt.
 */
function indent(text: string, padding: string): string {
  return text
    .split('\n')
    .map((line) => `${padding}${line}`)
    .join('\n');
}

/**
 * State Change Batcher
 *
 * Collects state changes and processes them in batches to optimize token usage.
 * Instead of sending each state change to the LLM individually (incurring system
 * prompt overhead each time), this batcher collects changes and sends them together.
 *
 * Configuration:
 * - batchDelayMs: Time to wait before processing accumulated changes (default: 5 seconds)
 * - maxBatchSize: Maximum number of changes to batch together (default: 10)
 */
export class StateChangeBatcher {
  private pendingChanges: PendingStateChange[] = [];
  private batchTimer: ReturnType<typeof setTimeout> | null = null;
  private isProcessing = false;
  private stats = {
    totalReceived: 0,
    totalProcessed: 0,
    batchesProcessed: 0,
    droppedCount: 0,
  };

  constructor(
    private readonly batchDelayMs: number = 5000,
    private readonly maxBatchSize: number = 10,
    /**
     * How many times a state change may be carried into a failed batch before it is
     * given up on. Three attempts covers a provider blip without holding a change
     * hostage to something genuinely broken.
     */
    private readonly maxRetries: number = 3,
    /**
     * Ceiling on the pending queue. Retrying means a persistent outage now feeds
     * changes back in rather than discarding them, so the queue needs a bound or a
     * long outage turns into unbounded memory growth on a device with 2GB of it.
     */
    private readonly maxPendingChanges: number = 200,
  ) {}

  /**
   * Add a state change to the batch.
   * Returns immediately - processing happens asynchronously.
   */
  async add(stateChange: StateChange): Promise<void> {
    this.stats.totalReceived++;
    logger.info('[BATCHER] State change received', {
      stateType: stateChange.stateType,
      source: stateChange.source,
    });

    this.pendingChanges.push({
      ...stateChange,
      timestamp: new Date(),
      retryCount: 0,
    });

    // Shed the oldest first when the queue is over its bound. Newer state is the more
    // useful state -- "the door is open now" matters more than that it opened an hour
    // ago -- and dropping silently is what this class used to do, so it is counted.
    if (this.pendingChanges.length > this.maxPendingChanges) {
      const overflow = this.pendingChanges.splice(0, this.pendingChanges.length - this.maxPendingChanges);
      this.stats.droppedCount += overflow.length;
      logger.error('[BATCHER] Pending queue over capacity, dropped oldest state changes', {
        dropped: overflow.length,
        capacity: this.maxPendingChanges,
        totalDropped: this.stats.droppedCount,
      });
    }

    logger.info('[BATCHER] Batch size', {
      current: this.pendingChanges.length,
      max: this.maxBatchSize,
    });

    // Process immediately if batch is full
    if (this.pendingChanges.length >= this.maxBatchSize) {
      logger.info('[BATCHER] Batch full, processing immediately');
      this.clearTimer();
      await this.processBatch();
      return;
    }

    // Start or restart the batch timer
    this.resetTimer();
  }

  /**
   * Clear the batch timer
   */
  private clearTimer(): void {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
  }

  /**
   * Reset the batch timer
   */
  private resetTimer(): void {
    this.clearTimer();
    this.batchTimer = setTimeout(() => {
      void (async () => {
        try {
          await this.processBatch();
        } catch (error) {
          logger.error('[BATCHER] Error processing batch', { error });
        }
      })();
    }, this.batchDelayMs);
  }

  /**
   * Process all pending state changes in a single batch
   */
  private async processBatch(): Promise<void> {
    if (this.isProcessing || this.pendingChanges.length === 0) {
      return;
    }

    this.isProcessing = true;
    this.clearTimer();

    // Take all pending changes
    const changesToProcess = [...this.pendingChanges];
    this.pendingChanges = [];

    logger.info('[BATCHER] Processing batch', {
      count: changesToProcess.length,
    });

    try {
      // Save all changes to memory
      await this.saveToMemory(changesToProcess);

      // Analyze all changes together, alongside the subscriptions they match
      await this.analyzeChanges(changesToProcess);

      this.stats.totalProcessed += changesToProcess.length;
      this.stats.batchesProcessed++;

      logger.info('[BATCHER] Batch processed', {
        totalProcessed: this.stats.totalProcessed,
        totalReceived: this.stats.totalReceived,
        batchesProcessed: this.stats.batchesProcessed,
      });
    } catch (error) {
      // The queue was drained before the work started, so without this the batch is
      // simply gone: not retried, not counted, and totalProcessed silently stops
      // matching totalReceived. An LLM call is the last thing to run in a batch and
      // hosted models fail transiently, so this is a routine occurrence, not an
      // exotic one -- gemini-flash-latest returned HTTP 500 twice in ten minutes
      // while this was being written.
      this.requeueOrDrop(changesToProcess, error);
    } finally {
      // Always release the lock: a failed batch must not wedge the batcher so
      // that every later state change is silently dropped.
      this.isProcessing = false;
    }
  }

  /**
   * Puts a failed batch back on the queue, giving up on the changes that have already
   * had their attempts.
   *
   * Requeued at the front, because these changes are older than anything that arrived
   * while the batch was in flight and the reactor reads them in order.
   *
   * Nothing is rethrown. Callers are a timer, a full-batch push, and flush(), and none
   * of them can do anything useful with the error -- the recovery *is* the requeue.
   */
  private requeueOrDrop(changes: PendingStateChange[], error: unknown): void {
    const retryable: PendingStateChange[] = [];
    let dropped = 0;

    for (const change of changes) {
      const retryCount = change.retryCount + 1;

      if (retryCount >= this.maxRetries) {
        dropped++;
        continue;
      }

      retryable.push({ ...change, retryCount });
    }

    if (dropped > 0) {
      this.stats.droppedCount += dropped;
      logger.error('[BATCHER] Giving up on state changes after repeated failures', {
        dropped,
        maxRetries: this.maxRetries,
        totalDropped: this.stats.droppedCount,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (retryable.length === 0) {
      logger.error('[BATCHER] Batch failed with nothing left to retry', {
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    this.pendingChanges.unshift(...retryable);
    logger.warn('[BATCHER] Batch failed, requeued for another attempt', {
      requeued: retryable.length,
      dropped,
      pending: this.pendingChanges.length,
      error: error instanceof Error ? error.message : String(error),
    });

    // Arm the timer so the requeued work is actually picked up again. Without this a
    // failed batch would sit untouched until the next unrelated state change arrived.
    this.resetTimer();
  }

  /**
   * Save all state changes to memory in a single operation
   */
  private async saveToMemory(changes: PendingStateChange[]): Promise<void> {
    // Written without semantic recall. This is the highest-frequency writer in the
    // system — one message per device state change, forever — and embedding each of
    // them with the hosted model costs a network round trip and a stored vector to make
    // things like "co2 ppm is 1400" searchable by meaning, which nothing asks for. The
    // reactor gets its recent context from lastMessages, and the question that actually
    // needs semantics, "does this event match a subscription", is answered by the local
    // static embedder instead.
    const memory = await createMemory({ enableSemanticRecall: false });
    const messages = changes.map((change, index) => ({
      id: `state-change-batch-${Date.now()}-${index}`,
      role: 'system' as const,
      content: {
        format: 2 as const,
        parts: [
          {
            type: 'text' as const,
            text: `State change registered: ${change.stateType} from ${change.source}. Data: ${JSON.stringify(change.stateData)}`,
          },
        ],
      },
      createdAt: change.timestamp,
    }));

    await memory.saveMessages({ messages });
    logger.info('[BATCHER] Saved state changes to memory', {
      count: changes.length,
    });
  }

  /**
   * Retrieve the subscriptions whose `when`/`given` components look relevant to
   * each state change.
   *
   * Matching is vector-only and runs in-process, so this stays cheap even when
   * the batch is large — no LLM is involved until the shortlist is assembled.
   */
  private async matchSubscriptions(changes: PendingStateChange[]): Promise<string[]> {
    const storage = await getSubscriptionStorage();
    // Housekeeping on the way past. Lapsed subscriptions are already filtered out of
    // matching, so this only reclaims rows -- but a batch is the natural moment for it,
    // and it is a single DELETE against a table with tens of rows.
    const pruned = await storage.pruneExpired();
    if (pruned.length > 0) {
      logger.info('[BATCHER] Pruned lapsed subscriptions', {
        count: pruned.length,
        ids: pruned.map((subscription) => subscription.id),
      });
    }

    const subscriptions = await storage.getAllEmbedded();

    if (subscriptions.length === 0) {
      return changes.map(() => formatSubscriptionMatches([]));
    }

    // Load the subscriptions once and embed the whole batch in one pass, rather
    // than repeating both per change.
    const descriptions = changes.map(describeStateChange);
    const embeddings = await embedTexts(descriptions);

    return embeddings.map((embedding) => formatSubscriptionMatches(rankSubscriptions(embedding, subscriptions)));
  }

  /**
   * Build the batch analysis prompt from state changes and their matched
   * subscriptions.
   */
  private buildBatchPrompt(changes: PendingStateChange[], matchedSubscriptions: string[]): string {
    const changesDescription = changes
      .map(
        (change, index) =>
          `${index + 1}. Source: ${change.source}
   Type: ${change.stateType}
   Time: ${change.timestamp.toISOString()}
   Data: ${JSON.stringify(change.stateData, null, 2)}
   Candidate subscriptions:
${indent(matchedSubscriptions[index] ?? 'No subscriptions matched this state change.', '     ')}`,
      )
      .join('\n\n');

    return `Multiple state changes have been detected. Analyze them together for efficiency:

${changesDescription}

The candidate subscriptions above were retrieved by semantic similarity against their WHEN and GIVEN parts. They are suggestions, not decisions — a candidate can easily be a false match.

For each state change, decide if the user should be notified or if any action is needed. Consider:
- Does any candidate subscription genuinely fire? Its WHEN must describe what actually happened, and its GIVEN (when present) must currently hold.
- If a subscription fires, carry out its THEN and call markSubscriptionTriggered with its id.
- Are any of these related or can be summarized together?
- What's the overall context from all these changes?
- Which ones are important enough to notify about?

If multiple notifications are warranted, you can combine related ones into a single message where appropriate. Delegate to the Notification agent as needed.`;
  }

  /**
   * Analyze all state changes together in a single LLM call
   */
  private async analyzeChanges(changes: PendingStateChange[]): Promise<void> {
    const reactorAgent = await getStateChangeReactorAgent();
    const matchedSubscriptions = await this.matchSubscriptions(changes);
    const batchPrompt = this.buildBatchPrompt(changes, matchedSubscriptions);

    const networkStream = await reactorAgent.network(batchPrompt);
    await networkStream.result;
    logger.info('[BATCHER] Agent analysis completed', {
      changesCount: changes.length,
    });
  }

  /**
   * Get batcher statistics
   */
  getStats(): {
    totalReceived: number;
    totalProcessed: number;
    batchesProcessed: number;
    pendingCount: number;
    isProcessing: boolean;
    droppedCount: number;
  } {
    return {
      ...this.stats,
      pendingCount: this.pendingChanges.length,
      isProcessing: this.isProcessing,
    };
  }

  /**
   * Force immediate processing of pending changes
   */
  async flush(): Promise<void> {
    this.clearTimer();
    await this.processBatch();
  }

  /**
   * Get pending changes count
   */
  getPendingCount(): number {
    return this.pendingChanges.length;
  }
}

/**
 * Global state change batcher instance
 *
 * Default configuration:
 * - 5 second delay before processing (allows changes to accumulate)
 * - Maximum batch size of 10 changes
 */
export const stateChangeBatcher = new StateChangeBatcher();
