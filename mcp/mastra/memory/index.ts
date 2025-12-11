import { Memory } from '@mastra/memory';
import { getSqlStorageProvider, getVectorStorageProvider } from '../storage/index.js';
import { google } from '../utils/providers/google-provider.js';

export interface CreateMemoryOptions {
  /**
   * Whether to enable working memory for the agent.
   * Default: true
   *
   * Disable for coordination agents that use .network() to avoid
   * the updateWorkingMemory tool being injected into network routing.
   */
  enableWorkingMemory?: boolean;
}

export async function createMemory(options: CreateMemoryOptions = {}) {
  const { enableWorkingMemory = true } = options;

  const sqlStorageProvider = await getSqlStorageProvider();
  const vectorStorageProvider = await getVectorStorageProvider();

  return new Memory({
    storage: sqlStorageProvider,
    vector: vectorStorageProvider,
    embedder: google.textEmbeddingModel('text-embedding-004'),
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
      semanticRecall: {
        topK: 10,
        messageRange: 3,
        scope: 'resource',
      },
    },
  });
}
