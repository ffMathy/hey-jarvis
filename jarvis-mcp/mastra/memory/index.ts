import { Memory } from "@mastra/memory";
import { getSqlStorageProvider, getVectorStorageProvider } from "../storage";
import { google } from "../utils/google-provider";
import { embed } from "ai";

export async function createMemory() {
    const sqlStorageProvider = await getSqlStorageProvider();
    const vectorStorageProvider = await getVectorStorageProvider();
    
    return new Memory({
        storage: sqlStorageProvider,
        vector: vectorStorageProvider,
        embedder: {
            embedText: async (text: string) => {
                const { embedding } = await embed({
                    model: google.textEmbeddingModel('text-embedding-004'),
                    value: text,
                });
                return embedding;
            },
            embedMany: async (texts: string[]) => {
                const embeddings = await Promise.all(
                    texts.map(async (text) => {
                        const { embedding } = await embed({
                            model: google.textEmbeddingModel('text-embedding-004'),
                            value: text,
                        });
                        return embedding;
                    })
                );
                return embeddings;
            },
        },
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