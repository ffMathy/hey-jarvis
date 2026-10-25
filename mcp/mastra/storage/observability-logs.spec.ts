/**
 * Observability logs.
 *
 * `@mastra/libsql` stores no logs, so Mastra's exporter dropped every log it emitted and
 * Studio's Logs page read "Logs are not available with your current storage". These
 * tests run a real Mastra instance with the real exporter, so the records the store
 * holds are the ones Mastra actually writes, then pin the filters Studio's page offers.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { Mastra } from '@mastra/core';
import { InMemoryStore, type LogRecord, logRecordSchema, MastraCompositeStore } from '@mastra/core/storage';
import { LibSQLStore } from '@mastra/libsql';
import { DefaultExporter, Observability } from '@mastra/observability';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { type ObservabilityStore, withFallbacks } from './observability.js';
import { ObservabilityLogStorage } from './observability-logs.js';

let databaseDirectory: string;
let logs: ObservabilityLogStorage;

beforeEach(async () => {
  databaseDirectory = await mkdtemp(path.join(tmpdir(), 'observability-logs-'));
  logs = new ObservabilityLogStorage(path.join(databaseDirectory, 'logs.db'));
});

afterEach(async () => {
  await logs.close();
  await rm(databaseDirectory, { force: true, recursive: true });
});

/** A log as Mastra's exporter hands it over, varied by whatever the test needs. */
function logRecord(overrides: Partial<LogRecord>): LogRecord {
  return logRecordSchema.parse({ timestamp: new Date(), level: 'warn', message: 'something', ...overrides });
}

describe('logs written by a real Mastra instance', () => {
  async function observabilityOf(mastra: Mastra): Promise<ObservabilityStore> {
    const store = await mastra.getStorage()?.getStore('observability');
    if (!store) {
      throw new Error('The composed storage must expose an observability domain');
    }
    return store;
  }

  it('are listed back, which LibSQL alone could not do', async () => {
    const libsql = new LibSQLStore({ id: 'observability-logs-spec', url: ':memory:' });
    await libsql.init();
    const durable = await libsql.getStore('observability');
    const feedback = await new InMemoryStore({ id: 'observability-logs-spec-feedback' }).getStore('observability');
    if (!durable || !feedback) {
      throw new Error('Both stores must expose an observability domain for this spec to mean anything');
    }

    const mastra = new Mastra({
      logger: false,
      storage: new MastraCompositeStore({
        id: 'observability-logs-spec-composite',
        default: libsql,
        domains: { observability: withFallbacks(durable, { feedback, logs }) },
      }),
      observability: new Observability({
        configs: { default: { serviceName: 'observability-logs-spec', exporters: [new DefaultExporter()] } },
      }),
    });

    mastra.loggerVNext.warn('the boiler is offline', { entityId: 'boiler' });
    mastra.loggerVNext.error('the boiler is on fire');
    await mastra.shutdown();

    const result = await (await observabilityOf(mastra)).listLogs({});

    expect(result.logs.map((log) => log.message)).toEqual(['the boiler is on fire', 'the boiler is offline']);
    expect(result.logs[1]?.data).toEqual({ entityId: 'boiler' });
    expect(result.logs[0]?.timestamp).toBeInstanceOf(Date);
    expect(result.pagination).toEqual({ total: 2, page: 0, perPage: 10, hasMore: false });
  });
});

describe('listing', () => {
  it('pages newest first by default', async () => {
    const start = Date.now();
    await logs.batchCreateLogs({
      logs: [1, 2, 3].map((second) =>
        logRecord({ message: `log ${second}`, timestamp: new Date(start + second * 1000) }),
      ),
    });

    const firstPage = await logs.listLogs({ pagination: { page: 0, perPage: 2 } });
    const secondPage = await logs.listLogs({ pagination: { page: 1, perPage: 2 } });

    expect(firstPage.logs.map((log) => log.message)).toEqual(['log 3', 'log 2']);
    expect(firstPage.pagination).toEqual({ total: 3, page: 0, perPage: 2, hasMore: true });
    expect(secondPage.logs.map((log) => log.message)).toEqual(['log 1']);
    expect(secondPage.pagination?.hasMore).toBe(false);
  });

  it('orders oldest first when asked', async () => {
    const start = Date.now();
    await logs.batchCreateLogs({
      logs: [2, 1].map((second) => logRecord({ message: `log ${second}`, timestamp: new Date(start + second * 1000) })),
    });

    const result = await logs.listLogs({ orderBy: { field: 'timestamp', direction: 'ASC' } });

    expect(result.logs.map((log) => log.message)).toEqual(['log 1', 'log 2']);
  });

  it('stores a log the exporter retries only once', async () => {
    const log = logRecord({ logId: 'log-1' });

    await logs.batchCreateLogs({ logs: [log] });
    await logs.batchCreateLogs({ logs: [log] });

    expect((await logs.listLogs({})).pagination?.total).toBe(1);
  });

  it('refuses delta polling rather than answering it wrongly', async () => {
    await expect(logs.listLogs({ mode: 'delta' })).rejects.toThrow('Delta polling is not supported');
  });
});

describe('filters', () => {
  const now = new Date();

  beforeEach(async () => {
    await logs.batchCreateLogs({
      logs: [
        logRecord({
          message: 'calendar warning',
          level: 'warn',
          timestamp: new Date(now.getTime() - 60_000),
          traceId: 'trace-1',
          entityName: 'calendar',
          executionSource: 'cloud',
          tags: ['home', 'morning'],
        }),
        logRecord({
          message: 'weather error',
          level: 'error',
          timestamp: now,
          traceId: 'trace-2',
          entityName: 'weather',
          source: 'local',
          tags: ['home'],
        }),
      ],
    });
  });

  async function messagesFor(filters: Parameters<ObservabilityLogStorage['listLogs']>[0]['filters']) {
    return (await logs.listLogs({ filters })).logs.map((log) => log.message);
  }

  it('by level, one or several', async () => {
    expect(await messagesFor({ level: 'error' })).toEqual(['weather error']);
    expect(await messagesFor({ level: ['warn', 'error'] })).toHaveLength(2);
  });

  it('by time range, honouring exclusive bounds', async () => {
    expect(await messagesFor({ timestamp: { start: now } })).toEqual(['weather error']);
    expect(await messagesFor({ timestamp: { start: now, startExclusive: true } })).toEqual([]);
    expect(await messagesFor({ timestamp: { end: now, endExclusive: true } })).toEqual(['calendar warning']);
  });

  it('by trace', async () => {
    expect(await messagesFor({ traceId: 'trace-1' })).toEqual(['calendar warning']);
  });

  it('by a context field kept only in the stored record', async () => {
    expect(await messagesFor({ entityName: 'weather' })).toEqual(['weather error']);
  });

  it('by execution source, under either of its names', async () => {
    expect(await messagesFor({ executionSource: 'local' })).toEqual(['weather error']);
    expect(await messagesFor({ source: 'cloud' })).toEqual(['calendar warning']);
  });

  it('by tags, requiring every one', async () => {
    expect(await messagesFor({ tags: ['home'] })).toHaveLength(2);
    expect(await messagesFor({ tags: ['home', 'morning'] })).toEqual(['calendar warning']);
  });
});

describe('retention', () => {
  it('deletes only logs older than the cutoff', async () => {
    const now = Date.now();
    await logs.batchCreateLogs({
      logs: [
        logRecord({ message: 'old', timestamp: new Date(now - 20 * 24 * 60 * 60 * 1000) }),
        logRecord({ message: 'recent', timestamp: new Date(now) }),
      ],
    });

    expect(await logs.deleteOlderThan(new Date(now - 14 * 24 * 60 * 60 * 1000))).toBe(1);
    expect((await logs.listLogs({})).logs.map((log) => log.message)).toEqual(['recent']);
  });
});
