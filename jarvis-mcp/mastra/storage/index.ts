import { LibSQLStore, LibSQLVector } from "@mastra/libsql";
import { mkdir } from "fs/promises";
import path from 'path';

const databaseDirectory = path.join(process.cwd(), 'jarvis-mcp');

let sqlStorageProviderInstance: LibSQLStore | null = null;
let vectorStorageProviderInstance: LibSQLVector | null = null;
let initializationPromise: Promise<void> | null = null;

async function initializeStorage() {
  if (!initializationPromise) {
    initializationPromise = mkdir(databaseDirectory, { recursive: true }).then(() => {
      sqlStorageProviderInstance = new LibSQLStore({
        url: `file:${path.join(databaseDirectory, 'mastra.sql.db')}`,
      });
      
      vectorStorageProviderInstance = new LibSQLVector({
        connectionUrl: `file:${path.join(databaseDirectory, 'mastra.vector.db')}`,
      });
    });
  }
  return initializationPromise;
}

export async function getSqlStorageProvider(): Promise<LibSQLStore> {
  await initializeStorage();
  return sqlStorageProviderInstance!;
}

export async function getVectorStorageProvider(): Promise<LibSQLVector> {
  await initializeStorage();
  return vectorStorageProviderInstance!;
}