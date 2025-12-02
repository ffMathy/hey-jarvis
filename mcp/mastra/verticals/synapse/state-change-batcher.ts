import { createMemory } from '../../memory/index.js';
import { getStateChangeReactorAgent } from './agent.js';

/**
 * Maximum number of retries for a failed batch before dropping changes
 */
const MAX_RETRY_ATTEMPTS = 3;

/**
 * State Change data type
 */
export interface StateChange {
  source: string;
  stateType: string;
  stateData: Record<string, unknown>;
}

/**
 * Pending state change with timestamp for batching
 */
interface PendingStateChange extends StateChange {
  timestamp: Date;
  retryCount: number;
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
  ) {}

  /**
   * Add a state change to the batch.
   * Returns immediately - processing happens asynchronously.
   */
  async add(stateChange: StateChange): Promise<void> {
    this.stats.totalReceived++;
    console.log(`📥 [BATCHER] State change received: ${stateChange.stateType} from ${stateChange.source}`);

    this.pendingChanges.push({
      ...stateChange,
      timestamp: new Date(),
      retryCount: 0,
    });

    console.log(`📦 [BATCHER] Batch size: ${this.pendingChanges.length}/${this.maxBatchSize}`);

    // Process immediately if batch is full
    if (this.pendingChanges.length >= this.maxBatchSize) {
      console.log(`📦 [BATCHER] Batch full, processing immediately`);
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
      this.processBatch().catch((error) => {
        console.error('❌ [BATCHER] Error processing batch:', error);
      });
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

    console.log(`🔄 [BATCHER] Processing batch of ${changesToProcess.length} state changes`);

    try {
      // Save all changes to memory
      await this.saveToMemory(changesToProcess);

      // Analyze all changes together
      await this.analyzeChanges(changesToProcess);

      this.stats.totalProcessed += changesToProcess.length;
      this.stats.batchesProcessed++;

      console.log(
        `✅ [BATCHER] Batch processed. Total: ${this.stats.totalProcessed}/${this.stats.totalReceived}, Batches: ${this.stats.batchesProcessed}`,
      );
    } catch (error) {
      console.error('❌ [BATCHER] Failed to process batch:', error);
      this.handleFailedBatch(changesToProcess);
    } finally {
      this.isProcessing = false;
    }
  }

  /**
   * Handle failed batch by re-queuing changes with retry limit
   */
  private handleFailedBatch(failedChanges: PendingStateChange[]): void {
    const toRetry: PendingStateChange[] = [];
    const toDrop: PendingStateChange[] = [];

    for (const change of failedChanges) {
      change.retryCount++;
      if (change.retryCount < MAX_RETRY_ATTEMPTS) {
        toRetry.push(change);
      } else {
        toDrop.push(change);
      }
    }

    if (toDrop.length > 0) {
      this.stats.droppedCount += toDrop.length;
      console.error(`⚠️ [BATCHER] Dropping ${toDrop.length} state changes after ${MAX_RETRY_ATTEMPTS} retry attempts`);
      for (const dropped of toDrop) {
        console.error(`   Dropped: ${dropped.stateType} from ${dropped.source}`);
      }
    }

    if (toRetry.length > 0) {
      console.log(`🔄 [BATCHER] Re-queuing ${toRetry.length} changes for retry`);
      this.pendingChanges = [...toRetry, ...this.pendingChanges];
      this.resetTimer();
    }
  }

  /**
   * Save all state changes to memory in a single operation
   */
  private async saveToMemory(changes: PendingStateChange[]): Promise<void> {
    const memory = await createMemory();
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
    console.log(`💾 [BATCHER] Saved ${changes.length} state changes to memory`);
  }

  /**
   * Build the batch analysis prompt from state changes
   */
  private buildBatchPrompt(changes: PendingStateChange[]): string {
    const changesDescription = changes
      .map(
        (change, index) =>
          `${index + 1}. Source: ${change.source}
   Type: ${change.stateType}
   Time: ${change.timestamp.toISOString()}
   Data: ${JSON.stringify(change.stateData, null, 2)}`,
      )
      .join('\n\n');

    return `Multiple state changes have been detected. Analyze them together for efficiency:

${changesDescription}

For each state change, decide if the user should be notified or if any action is needed. Consider:
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
    const batchPrompt = this.buildBatchPrompt(changes);

    try {
      const networkStream = await reactorAgent.network(batchPrompt);
      await networkStream.result;
      console.log(`🤖 [BATCHER] Agent analysis completed for batch of ${changes.length} changes`);
    } catch (error) {
      console.error('❌ [BATCHER] Agent analysis failed:', error);
      throw error;
    }
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
