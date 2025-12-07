import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, unlink } from 'fs/promises';
import path from 'path';
import { TokenUsageStorage } from '../mastra/storage/token-usage.js';

// Use a test-specific database file
const TEST_DB_DIR = '/tmp/token-usage-tests';
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test.db');

describe('Token Usage Storage Tests', () => {
  let storage: TokenUsageStorage;

  beforeEach(async () => {
    // Create test directory
    await mkdir(TEST_DB_DIR, { recursive: true });

    // Create new storage instance for each test
    storage = new TokenUsageStorage(TEST_DB_PATH);
  });

  afterEach(async () => {
    // Clean up test database
    try {
      await unlink(TEST_DB_PATH);
      await unlink(`${TEST_DB_PATH}-shm`);
      await unlink(`${TEST_DB_PATH}-wal`);
    } catch {
      // Ignore errors if files don't exist
    }
  });

  describe('recordUsage', () => {
    test('should record token usage', async () => {
      const id = await storage.recordUsage({
        model: 'gemini-flash-latest',
        provider: 'google',
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
      });

      expect(id).toBeGreaterThan(0);
    });

    test('should calculate total tokens if not provided', async () => {
      await storage.recordUsage({
        model: 'gpt-4',
        provider: 'openai',
        promptTokens: 200,
        completionTokens: 100,
      });

      const records = await storage.getRecentUsage(1);
      expect(records[0].totalTokens).toBe(300);
    });

    test('should store trace and agent context', async () => {
      await storage.recordUsage({
        model: 'gemini-flash-latest',
        provider: 'google',
        promptTokens: 100,
        completionTokens: 50,
        traceId: 'trace-123',
        agentId: 'weather',
        workflowId: 'weather-workflow',
      });

      const records = await storage.getRecentUsage(1);
      expect(records[0].traceId).toBe('trace-123');
      expect(records[0].agentId).toBe('weather');
      expect(records[0].workflowId).toBe('weather-workflow');
    });
  });

  describe('getModelUsage', () => {
    test('should return null for model with no usage', async () => {
      const usage = await storage.getModelUsage('nonexistent-model');
      expect(usage).toBeNull();
    });

    test('should aggregate usage for a model', async () => {
      await storage.recordUsage({
        model: 'gemini-flash-latest',
        provider: 'google',
        promptTokens: 100,
        completionTokens: 50,
      });

      await storage.recordUsage({
        model: 'gemini-flash-latest',
        provider: 'google',
        promptTokens: 200,
        completionTokens: 100,
      });

      const usage = await storage.getModelUsage('gemini-flash-latest');
      expect(usage).not.toBeNull();
      expect(usage?.totalPromptTokens).toBe(300);
      expect(usage?.totalCompletionTokens).toBe(150);
      expect(usage?.totalTokens).toBe(450);
      expect(usage?.requestCount).toBe(2);
    });

    test('should filter by date range', async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      await storage.recordUsage({
        model: 'gemini-flash-latest',
        provider: 'google',
        promptTokens: 100,
        completionTokens: 50,
      });

      const usage = await storage.getModelUsage('gemini-flash-latest', yesterday, tomorrow);
      expect(usage).not.toBeNull();
      expect(usage?.totalTokens).toBe(150);
    });
  });

  describe('getAllModelUsage', () => {
    test('should return empty array when no usage', async () => {
      const usage = await storage.getAllModelUsage();
      expect(usage).toEqual([]);
    });

    test('should return usage for all models', async () => {
      await storage.recordUsage({
        model: 'gemini-flash-latest',
        provider: 'google',
        promptTokens: 100,
        completionTokens: 50,
      });

      await storage.recordUsage({
        model: 'gpt-4',
        provider: 'openai',
        promptTokens: 200,
        completionTokens: 100,
      });

      const usage = await storage.getAllModelUsage();
      expect(usage).toHaveLength(2);
      expect(usage.map((u) => u.model).sort()).toEqual(['gemini-flash-latest', 'gpt-4']);
    });

    test('should sort by total tokens descending', async () => {
      await storage.recordUsage({
        model: 'model-a',
        provider: 'provider',
        promptTokens: 50,
        completionTokens: 25,
      });

      await storage.recordUsage({
        model: 'model-b',
        provider: 'provider',
        promptTokens: 200,
        completionTokens: 100,
      });

      const usage = await storage.getAllModelUsage();
      expect(usage[0].model).toBe('model-b'); // Higher usage first
      expect(usage[1].model).toBe('model-a');
    });
  });

  describe('setQuota and getQuotaInfo', () => {
    test('should set and retrieve quota', async () => {
      await storage.setQuota('gemini-flash-latest', 1000000, 'monthly');

      const quota = await storage.getQuotaInfo('gemini-flash-latest');
      expect(quota).not.toBeNull();
      expect(quota?.model).toBe('gemini-flash-latest');
      expect(quota?.maxQuota).toBe(1000000);
      expect(quota?.currentUsage).toBe(0);
      expect(quota?.remainingTokens).toBe(1000000);
      expect(quota?.percentUsed).toBe(0);
      expect(quota?.isOverQuota).toBe(false);
    });

    test('should update existing quota', async () => {
      await storage.setQuota('gemini-flash-latest', 1000000, 'monthly');
      await storage.setQuota('gemini-flash-latest', 2000000, 'daily');

      const quota = await storage.getQuotaInfo('gemini-flash-latest');
      expect(quota?.maxQuota).toBe(2000000);
    });

    test('should calculate quota usage correctly', async () => {
      await storage.setQuota('gemini-flash-latest', 1000, 'monthly');

      await storage.recordUsage({
        model: 'gemini-flash-latest',
        provider: 'google',
        promptTokens: 400,
        completionTokens: 200,
      });

      const quota = await storage.getQuotaInfo('gemini-flash-latest');
      expect(quota?.currentUsage).toBe(600);
      expect(quota?.remainingTokens).toBe(400);
      expect(quota?.percentUsed).toBe(60);
      expect(quota?.isOverQuota).toBe(false);
    });

    test('should detect over quota', async () => {
      await storage.setQuota('gemini-flash-latest', 100, 'monthly');

      await storage.recordUsage({
        model: 'gemini-flash-latest',
        provider: 'google',
        promptTokens: 80,
        completionTokens: 40,
      });

      const quota = await storage.getQuotaInfo('gemini-flash-latest');
      expect(quota?.currentUsage).toBe(120);
      expect(quota?.remainingTokens).toBe(0);
      expect(quota?.percentUsed).toBe(120);
      expect(quota?.isOverQuota).toBe(true);
    });

    test('should return null for model without quota', async () => {
      const quota = await storage.getQuotaInfo('nonexistent-model');
      expect(quota).toBeNull();
    });
  });

  describe('getAllQuotaInfo', () => {
    test('should return empty array when no quotas', async () => {
      const quotas = await storage.getAllQuotaInfo();
      expect(quotas).toEqual([]);
    });

    test('should return all quotas', async () => {
      await storage.setQuota('model-a', 1000, 'monthly');
      await storage.setQuota('model-b', 2000, 'daily');

      const quotas = await storage.getAllQuotaInfo();
      expect(quotas).toHaveLength(2);
      expect(quotas.map((q) => q.model).sort()).toEqual(['model-a', 'model-b']);
    });
  });

  describe('getTotalUsage', () => {
    test('should return zero for no usage', async () => {
      const total = await storage.getTotalUsage();
      expect(total.totalTokens).toBe(0);
      expect(total.totalPromptTokens).toBe(0);
      expect(total.totalCompletionTokens).toBe(0);
      expect(total.requestCount).toBe(0);
    });

    test('should aggregate all model usage', async () => {
      await storage.recordUsage({
        model: 'model-a',
        provider: 'provider',
        promptTokens: 100,
        completionTokens: 50,
      });

      await storage.recordUsage({
        model: 'model-b',
        provider: 'provider',
        promptTokens: 200,
        completionTokens: 100,
      });

      const total = await storage.getTotalUsage();
      expect(total.totalPromptTokens).toBe(300);
      expect(total.totalCompletionTokens).toBe(150);
      expect(total.totalTokens).toBe(450);
      expect(total.requestCount).toBe(2);
    });
  });

  describe('getRecentUsage', () => {
    test('should return empty array when no usage', async () => {
      const records = await storage.getRecentUsage(10);
      expect(records).toEqual([]);
    });

    test('should return recent records', async () => {
      await storage.recordUsage({
        model: 'model-a',
        provider: 'provider',
        promptTokens: 100,
        completionTokens: 50,
      });

      await storage.recordUsage({
        model: 'model-b',
        provider: 'provider',
        promptTokens: 200,
        completionTokens: 100,
      });

      const records = await storage.getRecentUsage(10);
      expect(records).toHaveLength(2);
    });

    test('should respect limit', async () => {
      for (let i = 0; i < 5; i++) {
        await storage.recordUsage({
          model: `model-${i}`,
          provider: 'provider',
          promptTokens: 100,
          completionTokens: 50,
        });
      }

      const records = await storage.getRecentUsage(3);
      expect(records).toHaveLength(3);
    });

    test('should return most recent first', async () => {
      await storage.recordUsage({
        model: 'model-old',
        provider: 'provider',
        promptTokens: 100,
        completionTokens: 50,
      });

      // Add a small delay to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10));

      await storage.recordUsage({
        model: 'model-new',
        provider: 'provider',
        promptTokens: 200,
        completionTokens: 100,
      });

      const records = await storage.getRecentUsage(10);
      expect(records[0].model).toBe('model-new');
      expect(records[1].model).toBe('model-old');
    });
  });

  describe('deleteQuota', () => {
    test('should delete quota', async () => {
      await storage.setQuota('gemini-flash-latest', 1000, 'monthly');
      await storage.deleteQuota('gemini-flash-latest');

      const quota = await storage.getQuotaInfo('gemini-flash-latest');
      expect(quota).toBeNull();
    });

    test('should not affect usage records', async () => {
      await storage.setQuota('gemini-flash-latest', 1000, 'monthly');
      await storage.recordUsage({
        model: 'gemini-flash-latest',
        provider: 'google',
        promptTokens: 100,
        completionTokens: 50,
      });

      await storage.deleteQuota('gemini-flash-latest');

      const usage = await storage.getModelUsage('gemini-flash-latest');
      expect(usage).not.toBeNull();
      expect(usage?.totalTokens).toBe(150);
    });
  });

  describe('cleanupOldRecords', () => {
    test('should delete old records', async () => {
      await storage.recordUsage({
        model: 'gemini-flash-latest',
        provider: 'google',
        promptTokens: 100,
        completionTokens: 50,
      });

      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);

      const deleted = await storage.cleanupOldRecords(tomorrow);
      expect(deleted).toBe(1);

      const records = await storage.getRecentUsage(10);
      expect(records).toEqual([]);
    });

    test('should not delete recent records', async () => {
      await storage.recordUsage({
        model: 'gemini-flash-latest',
        provider: 'google',
        promptTokens: 100,
        completionTokens: 50,
      });

      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const deleted = await storage.cleanupOldRecords(yesterday);
      expect(deleted).toBe(0);

      const records = await storage.getRecentUsage(10);
      expect(records).toHaveLength(1);
    });
  });
});
