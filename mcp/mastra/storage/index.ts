import { LibSQLStore, LibSQLVector } from '@mastra/libsql';
import { mkdir } from 'fs/promises';
import path from 'path';
import { CredentialsStorage } from './credentials.js';

// Use HEY_JARVIS_STORAGE_PATH environment variable if set, otherwise use local mcp/ directory
// Home Assistant addon sets this to /data for automatic backups
function getDatabaseDirectory(): string {
  const envPath = process.env.HEY_JARVIS_STORAGE_PATH;
  
  if (envPath) {
    console.log('📦 Using configured storage directory (from HEY_JARVIS_STORAGE_PATH):', envPath);
    return envPath;
  }
  
  // Development environment - use local directory
  const localDir = path.join('/tmp', 'mcp');
  console.log('📦 Using local development directory for storage:', localDir);
  return localDir;
}

const databaseDirectory = getDatabaseDirectory();

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

let credentialsStorageInstance: CredentialsStorage | null = null;

export async function getCredentialsStorage(): Promise<CredentialsStorage> {
  if (!credentialsStorageInstance) {
    await mkdir(databaseDirectory, { recursive: true });
    credentialsStorageInstance = new CredentialsStorage(path.join(databaseDirectory, 'mastra.sql.db'));
  }
  return credentialsStorageInstance;
}

export { CredentialsStorage } from './credentials.js';
