import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { TokenUsageStorage } from '../../storage/token-usage.js';
import { executeTool } from '../../utils/tool-factory.js';
import {
  checkTokenQuotaTool,
  getRecentTokenUsageTool,
  getTokenUsageTool,
  setTokenQuotaTool,
  tokenUsageTools,
} from './token-usage-tools.js';

/**
 * Each test gets its own SQLite file so quotas and usage never leak between
 * cases. The directory is deliberately never removed: `mock.module` is
 * process-global, so a spec file that runs later in the same process inherits
 * this `getTokenUsageStorage` and would hit SQLITE_READONLY_DBMOVED if the file
 * underneath it disappeared.
 */
const testDatabaseDirectory = mkdtempSync(path.join(tmpdir(), 'hey-jarvis-api-token-usage-'));
let databaseCounter = 0;
let storage = new TokenUsageStorage(path.join(testDatabaseDirectory, 'usage-0.db'));

// Only `getTokenUsageStorage` is replaced; every other storage accessor keeps
// working for whichever module happens to share this process.
const actualStorageModule = await import('../../storage/index.js');
mock.module('../../storage/index.js', () => ({
  ...actualStorageModule,
  getTokenUsageStorage: async () => storage,
}));

beforeEach(() => {
  databaseCounter += 1;
  storage = new TokenUsageStorage(path.join(testDatabaseDirectory, `usage-${databaseCounter}.db`));
});

/** Records one call's worth of usage; totals are derived by the storage layer. */
async function recordUsage(model: string, promptTokens: number, completionTokens: number, provider = 'google') {
  await storage.recordUsage({ model, provider, promptTokens, completionTokens });
}

/**
 * Typed stand-ins for the four token usage tools.
 *
 * None of them declares an `outputSchema`, so Mastra has no output type to infer and
 * `executeTool` resolves to `unknown`. `executeTool` is also typed with a tool's parsed
 * input, in which a defaulted field like `resetPeriod` or `limit` is required -- while
 * omitting it, and letting the default apply, is exactly what several tests below check.
 *
 * These shapes mirror what each `execute` actually accepts and returns, so the
 * assertions stay typed. Giving the tools real output schemas would be the better fix,
 * but that changes the contract they publish to the agent and belongs in its own change.
 */
type Executable<TInput, TResult> = Parameters<typeof executeTool<TInput, TResult>>[0];

interface UsageTotals {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  requestCount: number;
}

interface TokenUsageResult extends Partial<UsageTotals> {
  success: boolean;
  message?: string;
  model?: string;
  provider?: string;
  models?: Array<UsageTotals & { model: string; provider: string }>;
  totals?: UsageTotals;
  period?: { startDate?: string; endDate?: string };
}

interface QuotaInfo {
  model: string;
  currentUsage: number;
  maxQuota: number;
  remainingTokens: number;
  percentUsed: number;
  isOverQuota: boolean;
}

interface CheckQuotaResult {
  success: boolean;
  message?: string;
  quota?: QuotaInfo;
  quotas?: QuotaInfo[];
}

interface SetQuotaResult {
  success: boolean;
  message: string;
  quota: { model: string; maxTokens: number; resetPeriod: 'daily' | 'monthly' | 'yearly' };
}

interface RecentUsageResult {
  success: boolean;
  count: number;
  records?: Array<{
    id: number;
    model: string;
    provider: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    timestamp: string;
    traceId: string | null;
    agentId: string | null;
    workflowId: string | null;
  }>;
}

const getTokenUsage = (input: { model?: string; startDate?: string; endDate?: string }) =>
  executeTool(getTokenUsageTool as Executable<typeof input, TokenUsageResult>, input);

const checkTokenQuota = (input: { model?: string }) =>
  executeTool(checkTokenQuotaTool as Executable<typeof input, CheckQuotaResult>, input);

const setTokenQuota = (input: { model: string; maxTokens: number; resetPeriod?: 'daily' | 'monthly' | 'yearly' }) =>
  executeTool(setTokenQuotaTool as Executable<typeof input, SetQuotaResult>, input);

const getRecentTokenUsage = (input: { limit?: number }) =>
  executeTool(getRecentTokenUsageTool as Executable<typeof input, RecentUsageResult>, input);

describe('tokenUsageTools', () => {
  it('exposes the four token usage tools under their documented ids', () => {
    expect(Object.keys(tokenUsageTools).sort()).toEqual([
      'checkTokenQuotaTool',
      'getRecentTokenUsageTool',
      'getTokenUsageTool',
      'setTokenQuotaTool',
    ]);
    expect(getTokenUsageTool.id).toBe('get-token-usage');
    expect(checkTokenQuotaTool.id).toBe('check-token-quota');
    expect(setTokenQuotaTool.id).toBe('set-token-quota');
    expect(getRecentTokenUsageTool.id).toBe('get-recent-token-usage');
  });
});

describe('getTokenUsageTool', () => {
  describe('all models', () => {
    it('reports an empty summary and zeroed totals when nothing has been recorded', async () => {
      const result = await getTokenUsage({});

      expect(result).toEqual({
        success: true,
        models: [],
        totals: { promptTokens: 0, completionTokens: 0, totalTokens: 0, requestCount: 0 },
        period: { startDate: undefined, endDate: undefined },
      });
    });

    it('aggregates per model and across all models, heaviest model first', async () => {
      await recordUsage('gemini-flash-latest', 100, 50);
      await recordUsage('gemini-flash-latest', 200, 100);
      await recordUsage('gpt-4', 10, 5, 'openai');

      const result = await getTokenUsage({});

      expect(result.models).toEqual([
        {
          model: 'gemini-flash-latest',
          provider: 'google',
          promptTokens: 300,
          completionTokens: 150,
          totalTokens: 450,
          requestCount: 2,
        },
        {
          model: 'gpt-4',
          provider: 'openai',
          promptTokens: 10,
          completionTokens: 5,
          totalTokens: 15,
          requestCount: 1,
        },
      ]);
      expect(result.totals).toEqual({
        promptTokens: 310,
        completionTokens: 155,
        totalTokens: 465,
        requestCount: 3,
      });
    });

    it('echoes the requested period back as ISO strings', async () => {
      const result = await getTokenUsage({
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: '2024-02-01T00:00:00.000Z',
      });

      expect(result.period).toEqual({
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: '2024-02-01T00:00:00.000Z',
      });
    });

    it('leaves out records that fall outside the requested window', async () => {
      await recordUsage('gemini-flash-latest', 100, 50);

      const result = await getTokenUsage({
        startDate: '2020-01-01T00:00:00.000Z',
        endDate: '2020-12-31T00:00:00.000Z',
      });

      expect(result.models).toEqual([]);
      expect(result.totals).toEqual({
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        requestCount: 0,
      });
    });

    it('includes records that fall inside the requested window', async () => {
      await recordUsage('gemini-flash-latest', 100, 50);

      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
      const result = await getTokenUsage({
        startDate: yesterday.toISOString(),
        endDate: tomorrow.toISOString(),
      });

      expect(result.totals).toEqual({
        promptTokens: 100,
        completionTokens: 50,
        totalTokens: 150,
        requestCount: 1,
      });
    });
  });

  describe('a single model', () => {
    it('returns that model’s summary', async () => {
      await recordUsage('gemini-flash-latest', 100, 50);
      await recordUsage('gemini-flash-latest', 200, 100);
      await recordUsage('gpt-4', 999, 999, 'openai');

      const result = await getTokenUsage({ model: 'gemini-flash-latest' });

      expect(result).toEqual({
        success: true,
        model: 'gemini-flash-latest',
        provider: 'google',
        promptTokens: 300,
        completionTokens: 150,
        totalTokens: 450,
        requestCount: 2,
        period: { startDate: undefined, endDate: undefined },
      });
    });

    it('reports failure for a model that has never been used', async () => {
      await recordUsage('gemini-flash-latest', 100, 50);

      const result = await getTokenUsage({ model: 'claude-imaginary' });

      expect(result).toEqual({
        success: false,
        message: 'No usage data found for model: claude-imaginary',
      });
    });

    it('reports failure when the window excludes every record for that model', async () => {
      await recordUsage('gemini-flash-latest', 100, 50);

      const result = await getTokenUsage({
        model: 'gemini-flash-latest',
        startDate: '2020-01-01T00:00:00.000Z',
        endDate: '2020-12-31T00:00:00.000Z',
      });

      expect(result.success).toBe(false);
    });
  });

  describe('date parsing', () => {
    it('rejects a malformed start date without touching storage', async () => {
      const result = await getTokenUsage({ startDate: 'last tuesday' });

      expect(result).toEqual({
        success: false,
        message: 'Invalid start date format: last tuesday',
      });
    });

    it('rejects a malformed end date', async () => {
      const result = await getTokenUsage({
        startDate: '2024-01-01T00:00:00.000Z',
        endDate: '2024-13-45',
      });

      expect(result).toEqual({
        success: false,
        message: 'Invalid end date format: 2024-13-45',
      });
    });

    it('silently ignores an empty-string date instead of rejecting it', async () => {
      // An empty string is falsy, so it never reaches `new Date()` and the
      // query runs unfiltered rather than reporting a bad date.
      const result = await getTokenUsage({ startDate: '', endDate: '' });

      expect(result.success).toBe(true);
      expect(result.period).toEqual({ startDate: undefined, endDate: undefined });
    });

    it('accepts a plain calendar date', async () => {
      await recordUsage('gemini-flash-latest', 100, 50);

      const result = await getTokenUsage({ startDate: '2020-01-01' });

      expect(result.success).toBe(true);
      expect(result.period?.startDate).toBe('2020-01-01T00:00:00.000Z');
      expect(result.totals?.totalTokens).toBe(150);
    });
  });
});

describe('checkTokenQuotaTool', () => {
  describe('a single model', () => {
    it('reports failure when the model has no quota', async () => {
      const result = await checkTokenQuota({ model: 'gemini-flash-latest' });

      expect(result).toEqual({
        success: false,
        message: 'No quota configured for model: gemini-flash-latest',
      });
    });

    it('reports a freshly configured quota as entirely unused', async () => {
      await storage.setQuota('gemini-flash-latest', 1_000_000, 'monthly');

      const result = await checkTokenQuota({ model: 'gemini-flash-latest' });

      expect(result).toEqual({
        success: true,
        quota: {
          model: 'gemini-flash-latest',
          currentUsage: 0,
          maxQuota: 1_000_000,
          remainingTokens: 1_000_000,
          percentUsed: 0,
          isOverQuota: false,
        },
      });
    });

    it('counts only usage for the model it was asked about', async () => {
      await storage.setQuota('gemini-flash-latest', 1000, 'monthly');
      await recordUsage('gemini-flash-latest', 100, 50);
      await recordUsage('gpt-4', 900, 900, 'openai');

      const result = await checkTokenQuota({ model: 'gemini-flash-latest' });

      expect(result.quota?.currentUsage).toBe(150);
      expect(result.quota?.remainingTokens).toBe(850);
    });

    it('rounds percentUsed to two decimals', async () => {
      await storage.setQuota('gemini-flash-latest', 3, 'monthly');
      await recordUsage('gemini-flash-latest', 1, 0);

      const result = await checkTokenQuota({ model: 'gemini-flash-latest' });

      expect(result.quota?.percentUsed).toBe(33.33);
    });

    it('treats usage exactly at the limit as still within quota', async () => {
      await storage.setQuota('gemini-flash-latest', 100, 'monthly');
      await recordUsage('gemini-flash-latest', 60, 40);

      const result = await checkTokenQuota({ model: 'gemini-flash-latest' });

      expect(result.quota).toEqual({
        model: 'gemini-flash-latest',
        currentUsage: 100,
        maxQuota: 100,
        remainingTokens: 0,
        percentUsed: 100,
        isOverQuota: false,
      });
    });

    it('flags a single token over the limit as over quota', async () => {
      await storage.setQuota('gemini-flash-latest', 100, 'monthly');
      await recordUsage('gemini-flash-latest', 60, 41);

      const result = await checkTokenQuota({ model: 'gemini-flash-latest' });

      expect(result.quota?.isOverQuota).toBe(true);
      expect(result.quota?.remainingTokens).toBe(0);
      expect(result.quota?.percentUsed).toBe(101);
    });

    it('clamps remaining tokens at zero and lets percentUsed run past 100', async () => {
      await storage.setQuota('gemini-flash-latest', 100, 'monthly');
      await recordUsage('gemini-flash-latest', 200, 50);

      const result = await checkTokenQuota({ model: 'gemini-flash-latest' });

      expect(result.quota?.remainingTokens).toBe(0);
      expect(result.quota?.percentUsed).toBe(250);
      expect(result.quota?.isOverQuota).toBe(true);
    });

    it('counts today’s usage against a daily quota', async () => {
      await storage.setQuota('gemini-flash-latest', 500, 'daily');
      await recordUsage('gemini-flash-latest', 100, 50);

      const result = await checkTokenQuota({ model: 'gemini-flash-latest' });

      expect(result.quota?.currentUsage).toBe(150);
    });
  });

  describe('all models', () => {
    it('reports failure when nothing has a quota', async () => {
      await recordUsage('gemini-flash-latest', 100, 50);

      const result = await checkTokenQuota({});

      expect(result).toEqual({
        success: false,
        message: 'No quotas configured for any models',
      });
    });

    it('returns one entry per configured quota', async () => {
      await storage.setQuota('gemini-flash-latest', 1000, 'monthly');
      await storage.setQuota('gpt-4', 200, 'monthly');
      await recordUsage('gemini-flash-latest', 100, 50);

      const result = await checkTokenQuota({});

      expect(result.success).toBe(true);
      expect(result.quotas).toHaveLength(2);
      expect(result.quotas?.find((quota) => quota.model === 'gemini-flash-latest')).toEqual({
        model: 'gemini-flash-latest',
        currentUsage: 150,
        maxQuota: 1000,
        remainingTokens: 850,
        percentUsed: 15,
        isOverQuota: false,
      });
      expect(result.quotas?.find((quota) => quota.model === 'gpt-4')?.currentUsage).toBe(0);
    });
  });
});

describe('setTokenQuotaTool', () => {
  it('stores the quota and defaults the reset period to monthly', async () => {
    const result = await setTokenQuota({ model: 'gemini-flash-latest', maxTokens: 1000 });

    expect(result).toEqual({
      success: true,
      message: 'Quota set successfully for gemini-flash-latest',
      quota: { model: 'gemini-flash-latest', maxTokens: 1000, resetPeriod: 'monthly' },
    });
    expect((await storage.getQuotaInfo('gemini-flash-latest'))?.maxQuota).toBe(1000);
  });

  it('honours an explicit reset period', async () => {
    const result = await setTokenQuota({
      model: 'gemini-flash-latest',
      maxTokens: 1000,
      resetPeriod: 'yearly',
    });

    expect(result.quota?.resetPeriod).toBe('yearly');
  });

  it('overwrites an existing quota rather than adding a second one', async () => {
    await setTokenQuota({ model: 'gemini-flash-latest', maxTokens: 1000 });
    await setTokenQuota({ model: 'gemini-flash-latest', maxTokens: 500, resetPeriod: 'daily' });

    const quotas = await storage.getAllQuotaInfo();
    expect(quotas).toHaveLength(1);
    expect(quotas[0].maxQuota).toBe(500);
  });

  it('leaves recorded usage untouched when the quota changes', async () => {
    await recordUsage('gemini-flash-latest', 100, 50);
    await setTokenQuota({ model: 'gemini-flash-latest', maxTokens: 1000 });

    const quota = await checkTokenQuota({ model: 'gemini-flash-latest' });
    expect(quota.quota?.currentUsage).toBe(150);
  });

  it('rejects a quota of zero tokens', async () => {
    await expect(setTokenQuota({ model: 'gemini-flash-latest', maxTokens: 0 })).rejects.toThrow('failed validation');
  });

  it('rejects a negative quota', async () => {
    await expect(setTokenQuota({ model: 'gemini-flash-latest', maxTokens: -1 })).rejects.toThrow('failed validation');
  });

  it('rejects an unknown reset period', async () => {
    await expect(
      setTokenQuota({
        model: 'gemini-flash-latest',
        maxTokens: 1000,
        // @ts-expect-error the enum only allows daily, monthly and yearly
        resetPeriod: 'hourly',
      }),
    ).rejects.toThrow('failed validation');
  });
});

describe('getRecentTokenUsageTool', () => {
  it('returns an empty list when nothing has been recorded', async () => {
    const result = await getRecentTokenUsage({});

    expect(result).toEqual({ success: true, records: [], count: 0 });
  });

  it('maps every stored field of a record', async () => {
    await storage.recordUsage({
      model: 'gemini-flash-latest',
      provider: 'google',
      promptTokens: 100,
      completionTokens: 50,
      traceId: 'trace-123',
      agentId: 'shopping',
      workflowId: 'shoppingListWorkflow',
    });

    const result = await getRecentTokenUsage({});

    expect(result.records).toHaveLength(1);
    expect(result.records?.[0]).toEqual({
      id: expect.any(Number),
      model: 'gemini-flash-latest',
      provider: 'google',
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      timestamp: expect.any(String),
      traceId: 'trace-123',
      agentId: 'shopping',
      workflowId: 'shoppingListWorkflow',
    });
  });

  it('reports absent trace context as null rather than undefined', async () => {
    // The storage layer types these as `string | undefined` but hands back the
    // SQL NULL unchanged, so callers see null.
    await recordUsage('gemini-flash-latest', 100, 50);

    const result = await getRecentTokenUsage({});

    expect(result.records?.[0].traceId).toBeNull();
    expect(result.records?.[0].agentId).toBeNull();
    expect(result.records?.[0].workflowId).toBeNull();
  });

  it('returns the newest record first', async () => {
    await recordUsage('model-old', 100, 50);
    // Timestamps have millisecond resolution, so two back-to-back inserts can
    // tie and order arbitrarily.
    await new Promise((resolve) => setTimeout(resolve, 10));
    await recordUsage('model-new', 200, 100);

    const result = await getRecentTokenUsage({});

    expect(result.records?.map((record) => record.model)).toEqual(['model-new', 'model-old']);
  });

  it('defaults to the twenty most recent records', async () => {
    for (let index = 0; index < 25; index += 1) {
      await recordUsage(`model-${index}`, 10, 5);
    }

    const result = await getRecentTokenUsage({});

    expect(result.count).toBe(20);
    expect(result.records).toHaveLength(20);
  });

  it('honours a smaller explicit limit', async () => {
    for (let index = 0; index < 5; index += 1) {
      await recordUsage(`model-${index}`, 10, 5);
    }

    const result = await getRecentTokenUsage({ limit: 3 });

    expect(result.count).toBe(3);
  });

  it('caps the limit at one hundred records', async () => {
    for (let index = 0; index < 105; index += 1) {
      await recordUsage(`model-${index}`, 10, 5);
    }

    const result = await getRecentTokenUsage({ limit: 1000 });

    expect(result.count).toBe(100);
  });

  it('returns nothing for a limit of zero', async () => {
    await recordUsage('gemini-flash-latest', 100, 50);

    const result = await getRecentTokenUsage({ limit: 0 });

    expect(result).toEqual({ success: true, records: [], count: 0 });
  });

  it('rejects a negative limit instead of dumping the whole table', async () => {
    // `Math.min(-1, 100)` is -1, and SQLite reads a negative LIMIT as "no limit", so
    // this used to bypass the hundred-record cap entirely and return everything. The
    // schema now refuses it before the query is built.
    for (let index = 0; index < 105; index += 1) {
      await recordUsage(`model-${index}`, 10, 5);
    }

    expect(getRecentTokenUsage({ limit: -1 })).rejects.toThrow();
  });
});
