import { Memory } from '@mastra/memory';
import { getSqlStorageProvider, getVectorStorageProvider } from '../storage/index.js';
import { google } from '../utils/providers/google-provider.js';

export interface CreateMemoryOptions {
  /**
   * Whether to enable working memory for the agent.
   * Default: true
   *
   * Disable for coordination agents that should not be handed the
   * updateWorkingMemory tool alongside their delegation tools.
   */
  enableWorkingMemory?: boolean;
  /**
   * Whether messages written through this instance are embedded for semantic recall.
   * Default: true
   *
   * Turn it off for high-frequency, low-value writes. Semantic recall embeds every
   * message with the hosted `gemini-embedding-001`, so a caller that logs machine
   * events — one per device state change, continuously — pays a network round trip and
   * a stored vector for each one, in order to make `co2 ppm is 1400` semantically
   * searchable. Recent context still works: `lastMessages` does not involve the
   * embedder.
   *
   * The rest of the system already made this trade in the other direction. Subscription
   * matching runs on a local static embedder specifically so that it can afford to look
   * at every state change; sending the same events to a hosted embedder through memory
   * put the cost straight back.
   */
  enableSemanticRecall?: boolean;
}

export async function createMemory(options: CreateMemoryOptions = {}) {
  const { enableWorkingMemory = true, enableSemanticRecall = true } = options;

  const sqlStorageProvider = await getSqlStorageProvider();
  const vectorStorageProvider = await getVectorStorageProvider();

  return new Memory({
    storage: sqlStorageProvider,
    vector: vectorStorageProvider,
    embedder: google.embeddingModel('gemini-embedding-001'),
    options: {
      lastMessages: 10,
      workingMemory: enableWorkingMemory
        ? {
            enabled: true,
            template: `Track user preferences, habits, and key personal details.`,
            version: 'vnext',
          }
        : {
            enabled: false,
          },
      semanticRecall: enableSemanticRecall
        ? {
            topK: 10,
            messageRange: 3,
            scope: 'resource',
          }
        : false,
    },
  });
}
