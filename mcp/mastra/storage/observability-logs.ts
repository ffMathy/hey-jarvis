/**
 * Observability Log Storage
 *
 * The logs half of Mastra's observability domain, kept in the same SQLite file as
 * everything else. `@mastra/libsql` stores spans but not logs, so with LibSQL alone the
 * exporter dropped every log Mastra emitted and Studio's Logs page said "Logs are not
 * available with your current storage". See storage/observability.ts for how these two
 * methods are spliced into the LibSQL observability store.
 *
 * Each log is kept whole as JSON, with the columns Studio filters and sorts on most
 * pulled out beside it. Every other filter reads the JSON, which SQLite does fine at
 * the volume a warn-and-above log produces on one household's assistant.
 */

import type { Client } from '@libsql/client';
import {
  type BatchCreateLogsArgs,
  type ListLogsArgs,
  type ListLogsResponse,
  type LogRecord,
  type LogsFilter,
  listLogsArgsSchema,
} from '@mastra/core/storage';
import { openSqliteClient } from './sqlite-client.js';

/**
 * Filters that compare one field of the stored log for equality.
 *
 * Listed rather than derived from the filter object: each name ends up inside a JSON
 * path in the SQL, so only names written here may reach it.
 */
const JSON_EQUALITY_FILTERS = [
  'entityType',
  'entityName',
  'entityVersionId',
  'parentEntityVersionId',
  'rootEntityVersionId',
  'userId',
  'organizationId',
  'resourceId',
  'runId',
  'sessionId',
  'threadId',
  'requestId',
  'parentEntityType',
  'parentEntityName',
  'rootEntityType',
  'rootEntityName',
  'serviceName',
  'environment',
  'experimentId',
] as const satisfies ReadonlyArray<keyof LogsFilter>;

/**
 * Where a log says it came from. `source` is the deprecated name for `executionSource`,
 * so a filter on either matches a log that carries either, as Mastra's own stores do.
 */
const EXECUTION_SOURCE = `COALESCE(json_extract(record, '$.executionSource'), json_extract(record, '$.source'))`;

interface WhereClause {
  sql: string;
  args: Array<string | number>;
}

/** One condition of a WHERE clause, with the arguments its placeholders take. */
interface Condition {
  sql: string;
  args: Array<string | number>;
}

/** Conditions on the columns pulled out beside the stored record. */
function columnConditions(filters: LogsFilter): Condition[] {
  const conditions: Condition[] = [];
  const { timestamp, level, traceId, spanId } = filters;

  if (timestamp?.start) {
    conditions.push({ sql: `timestamp ${timestamp.startExclusive ? '>' : '>='} ?`, args: [timestamp.start.getTime()] });
  }
  if (timestamp?.end) {
    conditions.push({ sql: `timestamp ${timestamp.endExclusive ? '<' : '<='} ?`, args: [timestamp.end.getTime()] });
  }
  if (level !== undefined) {
    const levels = Array.isArray(level) ? level : [level];
    conditions.push({ sql: `level IN (${levels.map(() => '?').join(', ')})`, args: levels });
  }
  if (traceId !== undefined) {
    conditions.push({ sql: 'trace_id = ?', args: [traceId] });
  }
  if (spanId !== undefined) {
    conditions.push({ sql: 'span_id = ?', args: [spanId] });
  }

  return conditions;
}

/** Conditions on fields kept only inside the stored record's JSON. */
function recordConditions(filters: LogsFilter): Condition[] {
  const equalities = JSON_EQUALITY_FILTERS.flatMap((field) => {
    const value = filters[field];
    return value === undefined ? [] : [{ sql: `json_extract(record, '$.${field}') = ?`, args: [value] }];
  });

  const sources = [filters.executionSource, filters.source].flatMap((value) =>
    value === undefined ? [] : [{ sql: `${EXECUTION_SOURCE} = ?`, args: [value] }],
  );

  // A log must carry every tag asked for, not just one of them.
  const tags = (filters.tags ?? []).map((tag) => ({
    sql: `EXISTS (SELECT 1 FROM json_each(record, '$.tags') WHERE json_each.value = ?)`,
    args: [tag],
  }));

  return [...equalities, ...sources, ...tags];
}

function buildWhereClause(filters: LogsFilter | undefined): WhereClause {
  const conditions = filters ? [...columnConditions(filters), ...recordConditions(filters)] : [];

  return {
    sql: conditions.length > 0 ? `WHERE ${conditions.map((condition) => condition.sql).join(' AND ')}` : '',
    args: conditions.flatMap((condition) => condition.args),
  };
}

function parseRecord(json: string): LogRecord {
  const record = JSON.parse(json);
  return { ...record, timestamp: new Date(record.timestamp) };
}

export class ObservabilityLogStorage {
  private client: Client;
  private initialized = false;

  constructor(databasePath: string) {
    this.client = openSqliteClient(databasePath);
  }

  private async initialize(): Promise<void> {
    if (this.initialized) return;

    await this.client.execute(`
      CREATE TABLE IF NOT EXISTS observability_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        log_id TEXT,
        timestamp INTEGER NOT NULL,
        level TEXT NOT NULL,
        trace_id TEXT,
        span_id TEXT,
        record TEXT NOT NULL
      )
    `);

    // Unique so a batch the exporter retries after a failed flush is not stored twice.
    // SQLite treats NULLs as distinct, so logs without an id are all kept.
    await this.client.execute(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_observability_logs_log_id
      ON observability_logs(log_id)
    `);

    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_observability_logs_timestamp
      ON observability_logs(timestamp)
    `);

    await this.client.execute(`
      CREATE INDEX IF NOT EXISTS idx_observability_logs_trace_id
      ON observability_logs(trace_id)
    `);

    this.initialized = true;
  }

  async batchCreateLogs({ logs }: BatchCreateLogsArgs): Promise<void> {
    if (logs.length === 0) return;
    await this.initialize();

    await this.client.batch(
      logs.map((log) => ({
        sql: `
          INSERT OR IGNORE INTO observability_logs (log_id, timestamp, level, trace_id, span_id, record)
          VALUES (?, ?, ?, ?, ?, ?)
        `,
        args: [
          log.logId ?? null,
          log.timestamp.getTime(),
          log.level,
          log.traceId ?? null,
          log.spanId ?? null,
          JSON.stringify(log),
        ],
      })),
      'write',
    );
  }

  /**
   * Lists logs a page at a time, newest first unless asked otherwise.
   *
   * Delta mode, Studio's live tail, is not implemented: the server only asks for it when
   * the store's features advertise it, and the LibSQL store these methods are spliced
   * into does not.
   */
  async listLogs(args: ListLogsArgs): Promise<ListLogsResponse> {
    const { mode, filters, pagination, orderBy } = listLogsArgsSchema.parse(args);
    if (mode === 'delta') {
      throw new Error('Delta polling is not supported for observability logs');
    }

    await this.initialize();

    const where = buildWhereClause(filters);
    const page = Number(pagination.page);
    const perPage = Number(pagination.perPage);
    const direction = orderBy.direction === 'ASC' ? 'ASC' : 'DESC';

    const [count, rows] = await Promise.all([
      this.client.execute({ sql: `SELECT COUNT(*) AS total FROM observability_logs ${where.sql}`, args: where.args }),
      this.client.execute({
        // `id` breaks ties between logs written in the same millisecond, in insertion order.
        sql: `
          SELECT record FROM observability_logs ${where.sql}
          ORDER BY timestamp ${direction}, id ${direction}
          LIMIT ? OFFSET ?
        `,
        args: [...where.args, perPage, page * perPage],
      }),
    ]);

    const total = Number(count.rows[0]?.total ?? 0);

    return {
      logs: rows.rows.map((row) => parseRecord(String(row.record))),
      pagination: { total, page, perPage, hasMore: (page + 1) * perPage < total },
    };
  }

  /**
   * Deletes every log older than `cutoff`.
   *
   * @returns How many logs were deleted
   */
  async deleteOlderThan(cutoff: Date): Promise<number> {
    await this.initialize();

    const result = await this.client.execute({
      sql: 'DELETE FROM observability_logs WHERE timestamp < ?',
      args: [cutoff.getTime()],
    });

    return Number(result.rowsAffected);
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
