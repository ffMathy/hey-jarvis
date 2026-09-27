/**
 * What a connection does when another process holds the write lock.
 *
 * The container's two processes share one SQLite file, so this is the everyday case rather
 * than an edge: whichever one writes second has to wait its turn. The lock is held by a
 * separate process here, as it is in production, because the driver waits synchronously --
 * a holder in the same process could never let go while the waiter is blocking it.
 */

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { createClient } from '@libsql/client';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { openSqliteClient } from './sqlite-client.js';

/** How long the other process keeps the lock: past zero, well inside the timeout. */
const HOLD_MS = 1_500;

let databaseDirectory: string;
let databasePath: string;

beforeAll(async () => {
  databaseDirectory = await mkdtemp(path.join(tmpdir(), 'sqlite-client-spec-'));
  databasePath = path.join(databaseDirectory, 'busy.db');

  const setup = openSqliteClient(databasePath);
  await setup.execute('PRAGMA journal_mode=WAL');
  await setup.execute('CREATE TABLE writes (value INTEGER)');
  setup.close();
});

afterAll(async () => {
  // A closed connection only lets go of the file once its statements are finalized, and the
  // one that failed on purpose above is only finalized by the garbage collector. Windows
  // refuses to delete a file that is still open.
  Bun.gc(true);
  await Bun.sleep(50);
  Bun.gc(true);
  await rm(databaseDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

/** A lock held by another process, and the promise of that process finishing. */
interface HeldLock {
  released: Promise<number>;
}

/**
 * Starts a process that takes the write lock, says so, and holds it for {@link HOLD_MS}.
 *
 * The holder uses `bun:sqlite` rather than the driver under test, so what it does with the
 * lock does not depend on the code being tested.
 */
async function holdWriteLockElsewhere(): Promise<HeldLock> {
  const script = `
    import { Database } from 'bun:sqlite';
    const database = new Database(${JSON.stringify(databasePath)});
    database.run('BEGIN IMMEDIATE');
    database.run('INSERT INTO writes (value) VALUES (1)');
    console.log('locked');
    await Bun.sleep(${HOLD_MS});
    database.run('COMMIT');
    database.close();
  `;
  const holder = Bun.spawn([process.execPath, '-e', script], { stdout: 'pipe', stderr: 'inherit' });

  const reader = holder.stdout.getReader();
  const decoder = new TextDecoder();
  let output = '';
  while (!output.includes('locked')) {
    const { value, done } = await reader.read();
    if (done) {
      throw new Error(`The lock holder exited before taking the lock: ${output}`);
    }
    output += decoder.decode(value);
  }
  reader.releaseLock();

  // Wrapped, because an async function returning the bare promise would wait for it.
  return { released: holder.exited };
}

describe('a write while another process holds the lock', () => {
  it('fails at once on a connection opened without a busy timeout', async () => {
    // How every storage class here used to open its connection.
    const lock = await holdWriteLockElsewhere();
    const bare = createClient({ url: `file:${databasePath}` });

    try {
      await expect(bare.execute('INSERT INTO writes (value) VALUES (2)')).rejects.toThrow('SQLITE_BUSY');
    } finally {
      bare.close();
      await lock.released;
    }
  }, 20_000);

  it('waits for the lock and then succeeds on a connection from openSqliteClient', async () => {
    const lock = await holdWriteLockElsewhere();
    const client = openSqliteClient(databasePath);

    try {
      await client.execute('INSERT INTO writes (value) VALUES (3)');
      const result = await client.execute('SELECT COUNT(*) AS count FROM writes WHERE value = 3');
      expect(Number(result.rows[0].count)).toBe(1);
    } finally {
      client.close();
      expect(await lock.released).toBe(0);
    }
  }, 20_000);
});
