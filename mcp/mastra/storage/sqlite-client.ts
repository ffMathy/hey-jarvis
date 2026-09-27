import { type Client, createClient } from '@libsql/client';

/**
 * How long a statement waits for another connection's write lock before giving up with
 * `SQLITE_BUSY: database is locked`.
 *
 * Every table here lives in one file, `mastra.sql.db`, and that file is open many times
 * over: once by Mastra's LibSQLStore and once by each storage class in this directory, in
 * *both* processes the container runs (`mcp-server` and `mastra dev`). SQLite lets exactly
 * one of those connections write at a time, so contention is normal, not an error — the
 * question is only how long a writer waits for its turn.
 *
 * `@libsql/client` defaults that wait to zero for a local file: a connection opened with a
 * bare `createClient({ url })` fails the instant anything else is writing. The storage
 * classes were all opened that way. LibSQLStore waits five seconds by default, which the
 * Pi's SD card outlasted under heavy I/O — a commit that has to reach the card can hold the
 * lock that long on its own.
 *
 * Fifteen seconds is well past anything the card has been seen to take, and still short
 * enough to surface a genuinely wedged database. The wait is spent inside the driver, which
 * is synchronous, so a contended write stalls its process's event loop for as long as it
 * waits — the trade is a slow request instead of a failed one.
 */
export const SQLITE_BUSY_TIMEOUT_MS = 15_000;

/**
 * Opens a connection to a local SQLite file that waits {@link SQLITE_BUSY_TIMEOUT_MS} for
 * the write lock instead of failing immediately.
 *
 * The timeout is passed to the client rather than set with `PRAGMA busy_timeout`, because
 * a pragma only reaches the connection it runs on, and the client opens a fresh connection
 * after every `transaction()`. The option is applied to all of them.
 */
export function openSqliteClient(databasePath: string): Client {
  return createClient({
    url: `file:${databasePath}`,
    timeout: SQLITE_BUSY_TIMEOUT_MS,
  });
}
