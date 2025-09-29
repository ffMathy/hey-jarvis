import { fastembed } from "@mastra/fastembed";
import { Memory } from "@mastra/memory";
import { sqlStorageProvider, vectorStorageProvider } from "../storage";

export function createMemory() {
    return new Memory({
        storage: sqlStorageProvider,
        vector: vectorStorageProvider,
        embedder: fastembed,
        options: {
            lastMessages: 10,
            workingMemory: {
                enabled: true,
                template: `Track user preferences, habits, and key personal details.`,
                version: "vnext", // Enable the improved/experimental tool
            },
            semanticRecall: {
                topK: 10, // Retrieve 10 most similar messages
                messageRange: 3, // Include 3 messages before and after each match
                scope: 'resource', // Search across all threads for this user
            },
        }
    });
}