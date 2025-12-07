/**
 * Token Usage Tools
 *
 * Tools for querying token usage and quota information.
 */

import { z } from 'zod';
import { getTokenUsageStorage } from '../../storage/index.js';
import { createTool } from '../../utils/index.js';

/**
 * Get token usage summary for a specific model or all models
 */
export const getTokenUsageTool = createTool({
  id: 'get-token-usage',
  description: `Get token usage statistics for LLM models. Can query usage for a specific model or all models.
  
Use this tool when:
- User asks "how many tokens have I used?"
- User wants to know token consumption for a specific model
- User wants to see total token usage across all models
- User asks about API usage or costs`,
  inputSchema: z.object({
    model: z
      .string()
      .optional()
      .describe('Optional model name to get usage for. If not provided, returns usage for all models.'),
    startDate: z
      .string()
      .optional()
      .describe('Optional start date in ISO format (e.g., 2024-01-01T00:00:00Z) to filter usage from this date'),
    endDate: z.string().optional().describe('Optional end date in ISO format to filter usage until this date'),
  }),
  execute: async ({ inputData }) => {
    const storage = await getTokenUsageStorage();

    const startDate = inputData.startDate ? new Date(inputData.startDate) : undefined;
    const endDate = inputData.endDate ? new Date(inputData.endDate) : undefined;

    if (inputData.model) {
      // Get usage for specific model
      const usage = await storage.getModelUsage(inputData.model, startDate, endDate);

      if (!usage) {
        return {
          success: false,
          message: `No usage data found for model: ${inputData.model}`,
        };
      }

      return {
        success: true,
        model: usage.model,
        provider: usage.provider,
        promptTokens: usage.totalPromptTokens,
        completionTokens: usage.totalCompletionTokens,
        totalTokens: usage.totalTokens,
        requestCount: usage.requestCount,
        period: {
          startDate: startDate?.toISOString(),
          endDate: endDate?.toISOString(),
        },
      };
    }

    // Get usage for all models
    const allUsage = await storage.getAllModelUsage(startDate, endDate);
    const totalUsage = await storage.getTotalUsage(startDate, endDate);

    return {
      success: true,
      models: allUsage.map((usage) => ({
        model: usage.model,
        provider: usage.provider,
        promptTokens: usage.totalPromptTokens,
        completionTokens: usage.totalCompletionTokens,
        totalTokens: usage.totalTokens,
        requestCount: usage.requestCount,
      })),
      totals: {
        promptTokens: totalUsage.totalPromptTokens,
        completionTokens: totalUsage.totalCompletionTokens,
        totalTokens: totalUsage.totalTokens,
        requestCount: totalUsage.requestCount,
      },
      period: {
        startDate: startDate?.toISOString(),
        endDate: endDate?.toISOString(),
      },
    };
  },
});

/**
 * Check quota status for a model
 */
export const checkTokenQuotaTool = createTool({
  id: 'check-token-quota',
  description: `Check token quota status for a specific model. Shows current usage, remaining quota, and whether over quota.
  
Use this tool when:
- User asks "how many tokens do I have left?"
- User wants to know if they're over quota
- User asks about quota limits or remaining allowance
- User wants to check usage against a budget`,
  inputSchema: z.object({
    model: z
      .string()
      .optional()
      .describe('Optional model name to check quota for. If not provided, checks all models.'),
  }),
  execute: async ({ inputData }) => {
    const storage = await getTokenUsageStorage();

    if (inputData.model) {
      // Get quota for specific model
      const quota = await storage.getQuotaInfo(inputData.model);

      if (!quota) {
        return {
          success: false,
          message: `No quota configured for model: ${inputData.model}`,
        };
      }

      return {
        success: true,
        quota: {
          model: quota.model,
          currentUsage: quota.currentUsage,
          maxQuota: quota.maxQuota,
          remainingTokens: quota.remainingTokens,
          percentUsed: Math.round(quota.percentUsed * 100) / 100,
          isOverQuota: quota.isOverQuota,
        },
      };
    }

    // Get quota for all models
    const allQuotas = await storage.getAllQuotaInfo();

    if (allQuotas.length === 0) {
      return {
        success: false,
        message: 'No quotas configured for any models',
      };
    }

    return {
      success: true,
      quotas: allQuotas.map((quota) => ({
        model: quota.model,
        currentUsage: quota.currentUsage,
        maxQuota: quota.maxQuota,
        remainingTokens: quota.remainingTokens,
        percentUsed: Math.round(quota.percentUsed * 100) / 100,
        isOverQuota: quota.isOverQuota,
      })),
    };
  },
});

/**
 * Set a token quota for a model
 */
export const setTokenQuotaTool = createTool({
  id: 'set-token-quota',
  description: `Set or update token quota for a specific model. Allows setting limits on token usage.
  
Use this tool when:
- User wants to set a token budget or limit
- User asks to configure quota for a model
- User wants to update an existing quota
- User needs to manage token costs`,
  inputSchema: z.object({
    model: z.string().describe('Model name to set quota for (e.g., "gemini-flash-latest", "gpt-4")'),
    maxTokens: z.number().positive().describe('Maximum number of tokens allowed for this model'),
    resetPeriod: z
      .enum(['daily', 'monthly', 'yearly'])
      .optional()
      .default('monthly')
      .describe('How often the quota resets (daily, monthly, or yearly)'),
  }),
  execute: async ({ inputData }) => {
    const storage = await getTokenUsageStorage();

    await storage.setQuota(inputData.model, inputData.maxTokens, inputData.resetPeriod);

    return {
      success: true,
      message: `Quota set successfully for ${inputData.model}`,
      quota: {
        model: inputData.model,
        maxTokens: inputData.maxTokens,
        resetPeriod: inputData.resetPeriod,
      },
    };
  },
});

/**
 * Get recent token usage records
 */
export const getRecentTokenUsageTool = createTool({
  id: 'get-recent-token-usage',
  description: `Get recent token usage records with details about each API call.
  
Use this tool when:
- User wants to see a history of token usage
- User asks "what have I been using tokens for?"
- User wants to see recent API calls
- User needs detailed usage logs`,
  inputSchema: z.object({
    limit: z.number().optional().default(20).describe('Number of records to return (default: 20, max: 100)'),
  }),
  execute: async ({ inputData }) => {
    const storage = await getTokenUsageStorage();
    const limit = Math.min(inputData.limit ?? 20, 100);

    const records = await storage.getRecentUsage(limit);

    return {
      success: true,
      records: records.map((record) => ({
        id: record.id,
        model: record.model,
        provider: record.provider,
        promptTokens: record.promptTokens,
        completionTokens: record.completionTokens,
        totalTokens: record.totalTokens,
        timestamp: record.timestamp,
        traceId: record.traceId,
        agentId: record.agentId,
        workflowId: record.workflowId,
      })),
      count: records.length,
    };
  },
});

export const tokenUsageTools = {
  getTokenUsageTool,
  checkTokenQuotaTool,
  setTokenQuotaTool,
  getRecentTokenUsageTool,
};
