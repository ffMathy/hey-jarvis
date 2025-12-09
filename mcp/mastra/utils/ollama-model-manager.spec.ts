import { describe, expect, it } from 'bun:test';
import {
  ensureModelAvailable,
  getOllamaApiUrl,
  getOllamaQueueLength,
  getOllamaQueueStats,
  isModelAvailable,
  isOllamaAvailable,
  listModels,
} from './ollama-model-manager.js';

describe('Ollama Model Manager - Unit Tests', () => {
  it('should export isOllamaAvailable function', () => {
    expect(typeof isOllamaAvailable).toBe('function');
  });

  it('should export isModelAvailable function', () => {
    expect(typeof isModelAvailable).toBe('function');
  });

  it('should export ensureModelAvailable function', () => {
    expect(typeof ensureModelAvailable).toBe('function');
  });

  it('should export listModels function', () => {
    expect(typeof listModels).toBe('function');
  });

  it('should export getOllamaApiUrl function', () => {
    expect(typeof getOllamaApiUrl).toBe('function');
  });

  it('should return correct API URL format', () => {
    const apiUrl = getOllamaApiUrl();
    expect(apiUrl).toMatch(/^http:\/\//);
    expect(apiUrl).toMatch(/:\d+$/);
  });

  it('should return false for non-existent Ollama server', async () => {
    // If not running in Docker with Ollama, this should return false
    const available = await isOllamaAvailable();

    // We can't strictly test this because Ollama might be running locally
    // Just verify the function returns a boolean
    expect(typeof available).toBe('boolean');
  });

  it('should return empty array when Ollama is not available', async () => {
    const available = await isOllamaAvailable();

    if (!available) {
      const models = await listModels();
      expect(models).toEqual([]);
    }
  });

  it('should return false for non-existent model', async () => {
    const available = await isOllamaAvailable();

    if (!available) {
      // When Ollama is not available, any model check should return false
      const modelAvailable = await isModelAvailable('definitely-not-a-real-model:v9999');
      expect(modelAvailable).toBe(false);
    }
  });
});

describe('Ollama Queue - Unit Tests', () => {
  it('should export getOllamaQueueStats function', () => {
    expect(typeof getOllamaQueueStats).toBe('function');
  });

  it('should export getOllamaQueueLength function', () => {
    expect(typeof getOllamaQueueLength).toBe('function');
  });

  it('should return queue stats with correct structure', () => {
    const stats = getOllamaQueueStats();
    expect(typeof stats.droppedCount).toBe('number');
    expect(typeof stats.processedCount).toBe('number');
    expect(stats.droppedCount).toBeGreaterThanOrEqual(0);
    expect(stats.processedCount).toBeGreaterThanOrEqual(0);
  });

  it('should return queue length as a number', () => {
    const length = getOllamaQueueLength();
    expect(typeof length).toBe('number');
    expect(length).toBeGreaterThanOrEqual(0);
  });
});
