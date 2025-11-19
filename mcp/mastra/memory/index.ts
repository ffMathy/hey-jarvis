import { Memory } from '@mastra/memory';
import { getSqlStorageProvider, getVectorStorageProvider } from '../storage/index.js';
import { google } from '../utils/google-provider.js';

export async function createMemory() {
  const sqlStorageProvider = await getSqlStorageProvider();
  const vectorStorageProvider = await getVectorStorageProvider();

  return new Memory({
    storage: sqlStorageProvider,
    vector: vectorStorageProvider,
    embedder: google.textEmbeddingModel('text-embedding-004'),
    options: {
      lastMessages: 10,
      workingMemory: {
        enabled: true,
        template: `Track user preferences, habits, and key personal details.`,
        version: 'vnext', // Enable the improved/experimental tool
      },
      semanticRecall: {
        topK: 10, // Retrieve 10 most similar messages
        messageRange: 3, // Include 3 messages before and after each match
        scope: 'resource', // Search across all threads for this user
      },
    },
  });
}
