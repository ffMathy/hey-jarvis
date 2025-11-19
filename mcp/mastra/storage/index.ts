import { LibSQLStore, LibSQLVector } from '@mastra/libsql';
import { mkdir } from 'fs/promises';
import path from 'path';

const databaseDirectory = path.join(process.cwd(), 'mcp');

export async function getSqlStorageProvider(): Promise<LibSQLStore> {
  await mkdir(databaseDirectory, { recursive: true });

  return new LibSQLStore({
    id: 'hey-jarvis-sql-storage',
    url: `file:${path.join(databaseDirectory, 'mastra.sql.db')}`,
  });
}

export async function getVectorStorageProvider(): Promise<LibSQLVector> {
  await mkdir(databaseDirectory, { recursive: true });

  return new LibSQLVector({
    id: 'hey-jarvis-vector-storage',
    connectionUrl: `file:${path.join(databaseDirectory, 'mastra.vector.db')}`,
  });
}
