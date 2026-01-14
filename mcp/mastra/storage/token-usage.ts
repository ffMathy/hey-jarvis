/**
 * Token Usage Storage
 *
 * Tracks LLM token usage by model to monitor consumption against quotas.
 * Aggregates token usage from Mastra AI tracing data.
 */

import { type Client, createClient } from '@libsql/client';

export interface TokenUsageRecord {
  id: number;
  model: string;
  provider: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  timestamp: string;
  traceId?: string;
  agentId?: string;
  workflowId?: string;
}

export interface TokenUsageSummary {
  model: string;
  provider: string;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  requestCount: number;
}

export interface QuotaInfo {
  model: string;
  currentUsage: number;
  maxQuota: number;
  remainingTokens: number;
  percentUsed: number;
  isOverQuota: boolean;
}

export class TokenUsageStorage {
  private client: Client;
  private initialized = false;

  constructor(databasePath: string) {
    this.client = createClient({
      url: `file:${databasePath}`,
    });
  }

  /**
   * Initialize the token usage table if it doesn't exist
   */
  private async initialize(): Promise<void> {
    if (this.initialized) return;

    // Token usage records table
    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS token_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        model TEXT NOT NULL,
        provider TEXT NOT NULL,
        prompt_tokens INTEGER NOT NULL DEFAULT 0,
        completion_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        trace_id TEXT,
        agent_id TEXT,
        workflow_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    // Create index for efficient querying
    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_token_usage_model 
      ON token_usage(model)
    `);

    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_token_usage_timestamp 
      ON token_usage(timestamp)
    `);

    // Quota configuration table
    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS token_quotas (
        model TEXT PRIMARY KEY,
        max_tokens INTEGER NOT NULL,
        reset_period TEXT NOT NULL DEFAULT 'monthly',
        last_reset TEXT NOT NULL DEFAULT (datetime('now')),
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);

    this.initialized = true;
  }

  /**
   * Record token usage from an AI generation
   */
  async recordUsage(usage: {
    model: string;
    provider: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens?: number;
    traceId?: string;
    agentId?: string;
    workflowId?: string;
  }): Promise<number> {
    await this.initialize();

    const now = new Date().toISOString();
    const totalTokens = usage.totalTokens ?? usage.promptTokens + usage.completionTokens;

    const result = await this.client.execute({
      sql: `
        INSERT INTO token_usage (
          model, provider, prompt_tokens, completion_tokens, 
          total_tokens, timestamp, trace_id, agent_id, workflow_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      args: [
        usage.model,
        usage.provider,
        usage.promptTokens,
        usage.completionTokens,
        totalTokens,
        now,
        usage.traceId ?? null,
        usage.agentId ?? null,
        usage.workflowId ?? null,
      ],
    });

    return Number(result.lastInsertRowid);
  }

  /**
   * Get token usage summary for a specific model
   */
  async getModelUsage(model: string, startDate?: Date, endDate?: Date): Promise<TokenUsageSummary | null> {
    await this.initialize();

    let sql = `
      SELECT 
        model,
        provider,
        SUM(prompt_tokens) as total_prompt_tokens,
        SUM(completion_tokens) as total_completion_tokens,
        SUM(total_tokens) as total_tokens,
        COUNT(*) as request_count
      FROM token_usage
      WHERE model = ?
    `;

    const args: (string | number)[] = [model];

    if (startDate) {
      sql += ' AND timestamp >= ?';
      args.push(startDate.toISOString());
    }

    if (endDate) {
      sql += ' AND timestamp <= ?';
      args.push(endDate.toISOString());
    }

    sql += ' GROUP BY model, provider';

    const result = await this.client.execute({ sql, args });

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      model: row.model as string,
      provider: row.provider as string,
      totalPromptTokens: Number(row.total_prompt_tokens),
      totalCompletionTokens: Number(row.total_completion_tokens),
      totalTokens: Number(row.total_tokens),
      requestCount: Number(row.request_count),
    };
  }

  /**
   * Get token usage summary for all models
   */
  async getAllModelUsage(startDate?: Date, endDate?: Date): Promise<TokenUsageSummary[]> {
    await this.initialize();

    let sql = `
      SELECT 
        model,
        provider,
        SUM(prompt_tokens) as total_prompt_tokens,
        SUM(completion_tokens) as total_completion_tokens,
        SUM(total_tokens) as total_tokens,
        COUNT(*) as request_count
      FROM token_usage
      WHERE 1=1
    `;

    const args: string[] = [];

    if (startDate) {
      sql += ' AND timestamp >= ?';
      args.push(startDate.toISOString());
    }

    if (endDate) {
      sql += ' AND timestamp <= ?';
      args.push(endDate.toISOString());
    }

    sql += ' GROUP BY model, provider ORDER BY total_tokens DESC';

    const result = await this.client.execute({ sql, args });

    return result.rows.map((row) => ({
      model: row.model as string,
      provider: row.provider as string,
      totalPromptTokens: Number(row.total_prompt_tokens),
      totalCompletionTokens: Number(row.total_completion_tokens),
      totalTokens: Number(row.total_tokens),
      requestCount: Number(row.request_count),
    }));
  }

  /**
   * Set a token quota for a specific model
   */
  async setQuota(
    model: string,
    maxTokens: number,
    resetPeriod: 'daily' | 'monthly' | 'yearly' = 'monthly',
  ): Promise<void> {
    await this.initialize();

    const now = new Date().toISOString();

    await this.client.execute({
      sql: `
        INSERT INTO token_quotas (model, max_tokens, reset_period, last_reset, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(model) DO UPDATE SET
          max_tokens = excluded.max_tokens,
          reset_period = excluded.reset_period,
          updated_at = excluded.updated_at
      `,
      args: [model, maxTokens, resetPeriod, now, now],
    });
  }

  /**
   * Get quota information for a specific model
   */
  async getQuotaInfo(model: string): Promise<QuotaInfo | null> {
    await this.initialize();

    // Get quota configuration
    const quotaResult = await this.client.execute({
      sql: 'SELECT max_tokens, reset_period, last_reset FROM token_quotas WHERE model = ?',
      args: [model],
    });

    if (quotaResult.rows.length === 0) {
      return null;
    }

    const quota = quotaResult.rows[0];
    const maxQuota = Number(quota.max_tokens);
    const resetPeriod = quota.reset_period as string;
    const lastReset = new Date(quota.last_reset as string);

    // Calculate the start date based on reset period
    const startDate = this.getResetStartDate(resetPeriod, lastReset);

    // Get current usage since last reset
    const usage = await this.getModelUsage(model, startDate);
    const currentUsage = usage?.totalTokens ?? 0;

    const remainingTokens = Math.max(0, maxQuota - currentUsage);
    const percentUsed = maxQuota > 0 ? (currentUsage / maxQuota) * 100 : 0;
    const isOverQuota = currentUsage > maxQuota;

    return {
      model,
      currentUsage,
      maxQuota,
      remainingTokens,
      percentUsed,
      isOverQuota,
    };
  }

  /**
   * Get quota information for all models with quotas
   */
  async getAllQuotaInfo(): Promise<QuotaInfo[]> {
    await this.initialize();

    // Fetch all quota configurations in one query
    const quotaResult = await this.client.execute(
      'SELECT model, max_tokens, reset_period, last_reset FROM token_quotas',
    );

    if (quotaResult.rows.length === 0) {
      return [];
    }

    // Get all models that have quotas
    const models = quotaResult.rows.map((row) => row.model as string);

    // Fetch all usage data in one query with grouping
    const _usageQuery = `
      SELECT 
        model,
        SUM(total_tokens) as total_tokens
      FROM token_usage
      WHERE model IN (${models.map(() => '?').join(',')})
      GROUP BY model
    `;

    const quotaInfos: QuotaInfo[] = [];

    for (const quotaRow of quotaResult.rows) {
      const model = quotaRow.model as string;
      const maxQuota = Number(quotaRow.max_tokens);
      const resetPeriod = quotaRow.reset_period as string;
      const lastReset = new Date(quotaRow.last_reset as string);

      // Calculate the start date based on reset period
      const startDate = this.getResetStartDate(resetPeriod, lastReset);

      // Get usage for this specific model since last reset
      const usage = await this.getModelUsage(model, startDate);
      const currentUsage = usage?.totalTokens ?? 0;

      const remainingTokens = Math.max(0, maxQuota - currentUsage);
      const percentUsed = maxQuota > 0 ? (currentUsage / maxQuota) * 100 : 0;
      const isOverQuota = currentUsage > maxQuota;

      quotaInfos.push({
        model,
        currentUsage,
        maxQuota,
        remainingTokens,
        percentUsed,
        isOverQuota,
      });
    }

    return quotaInfos;
  }

  /**
   * Delete usage records older than a specific date
   */
  async cleanupOldRecords(beforeDate: Date): Promise<number> {
    await this.initialize();

    const result = await this.client.execute({
      sql: 'DELETE FROM token_usage WHERE timestamp < ?',
      args: [beforeDate.toISOString()],
    });

    return Number(result.rowsAffected);
  }

  /**
   * Get recent usage records
   */
  async getRecentUsage(limit = 100, offset = 0): Promise<TokenUsageRecord[]> {
    await this.initialize();

    const result = await this.client.execute({
      sql: `
        SELECT 
          id, model, provider, prompt_tokens, completion_tokens,
          total_tokens, timestamp, trace_id, agent_id, workflow_id
        FROM token_usage
        ORDER BY timestamp DESC
        LIMIT ? OFFSET ?
      `,
      args: [limit, offset],
    });

    return result.rows.map((row) => ({
      id: Number(row.id),
      model: row.model as string,
      provider: row.provider as string,
      promptTokens: Number(row.prompt_tokens),
      completionTokens: Number(row.completion_tokens),
      totalTokens: Number(row.total_tokens),
      timestamp: row.timestamp as string,
      traceId: row.trace_id as string | undefined,
      agentId: row.agent_id as string | undefined,
      workflowId: row.workflow_id as string | undefined,
    }));
  }

  /**
   * Calculate the start date for quota reset based on reset period
   *
   * Note: Currently uses calendar-based resets (start of day/month/year) rather than
   * rolling periods from lastReset. This means quotas reset at fixed calendar boundaries.
   * For example, a monthly quota set on March 15th resets on April 1st, not April 15th.
   *
   * TODO: Consider implementing rolling reset periods using lastReset parameter for more
   * granular control (e.g., reset exactly 30 days after lastReset for monthly quotas).
   */
  private getResetStartDate(resetPeriod: string, lastReset: Date): Date {
    const now = new Date();

    switch (resetPeriod) {
      case 'daily': {
        const startOfDay = new Date(now);
        startOfDay.setHours(0, 0, 0, 0);
        return startOfDay;
      }
      case 'monthly': {
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        return startOfMonth;
      }
      case 'yearly': {
        const startOfYear = new Date(now.getFullYear(), 0, 1);
        return startOfYear;
      }
      default:
        return lastReset;
    }
  }

  /**
   * Delete a quota configuration
   */
  async deleteQuota(model: string): Promise<void> {
    await this.initialize();

    await this.client.execute({
      sql: 'DELETE FROM token_quotas WHERE model = ?',
      args: [model],
    });
  }

  /**
   * Get total usage across all models
   */
  async getTotalUsage(
    startDate?: Date,
    endDate?: Date,
  ): Promise<{
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalTokens: number;
    requestCount: number;
  }> {
    await this.initialize();

    let sql = `
      SELECT 
        SUM(prompt_tokens) as total_prompt_tokens,
        SUM(completion_tokens) as total_completion_tokens,
        SUM(total_tokens) as total_tokens,
        COUNT(*) as request_count
      FROM token_usage
      WHERE 1=1
    `;

    const args: string[] = [];

    if (startDate) {
      sql += ' AND timestamp >= ?';
      args.push(startDate.toISOString());
    }

    if (endDate) {
      sql += ' AND timestamp <= ?';
      args.push(endDate.toISOString());
    }

    const result = await this.client.execute({ sql, args });

    if (result.rows.length === 0) {
      return {
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        totalTokens: 0,
        requestCount: 0,
      };
    }

    const row = result.rows[0];
    return {
      totalPromptTokens: Number(row.total_prompt_tokens ?? 0),
      totalCompletionTokens: Number(row.total_completion_tokens ?? 0),
      totalTokens: Number(row.total_tokens ?? 0),
      requestCount: Number(row.request_count ?? 0),
    };
  }

  /**
   * Close the database connection
   * Should be called when the storage is no longer needed (e.g., in tests)
   */
  async close(): Promise<void> {
    await this.client.close();
  }
}
