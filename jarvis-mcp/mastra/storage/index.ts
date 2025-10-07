import { LibSQLStore, LibSQLVector } from "@mastra/libsql";
import { mkdir } from "fs/promises";
import path from 'path';

const databaseDirectory = path.join(process.cwd(), 'jarvis-mcp');

export async function getSqlStorageProvider(): Promise<LibSQLStore> {
  await mkdir(databaseDirectory, { recursive: true });
  
  return new LibSQLStore({
    url: `file:${path.join(databaseDirectory, 'mastra.sql.db')}`,
  });
}

export async function getVectorStorageProvider(): Promise<LibSQLVector> {
  await mkdir(databaseDirectory, { recursive: true });
  
  return new LibSQLVector({
    connectionUrl: `file:${path.join(databaseDirectory, 'mastra.vector.db')}`,
  });
}