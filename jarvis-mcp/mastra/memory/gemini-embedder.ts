import { google } from '../utils/google-provider';
import { embed } from 'ai';

/**
 * Gemini-based embedder for Mastra memory system.
 * Uses Google's text-embedding-004 model which is cost-effective and efficient.
 * 
 * This replaces Fastembed to avoid native module dependencies that cause
 * issues with multi-architecture Docker builds (ARM64, AMD64, etc.)
 */
export const geminiEmbedder = {
    /**
     * Generate embeddings for a single text input
     */
    embedText: async (text: string): Promise<number[]> => {
        const { embedding } = await embed({
            model: google.textEmbeddingModel('text-embedding-004'),
            value: text,
        });
        return embedding;
    },

    /**
     * Generate embeddings for multiple text inputs
     */
    embedMany: async (texts: string[]): Promise<number[][]> => {
        const embeddings = await Promise.all(
            texts.map(text => geminiEmbedder.embedText(text))
        );
        return embeddings;
    },
};
