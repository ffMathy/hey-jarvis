import { LibSQLStore, LibSQLVector } from '@mastra/libsql';
import { mkdir } from 'fs/promises';
import path from 'path';
import { CredentialsStorage } from './credentials.js';
import { DeviceStateStorage } from './device-state.js';
import { EmailStateStorage } from './email-state.js';

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

async function ensureDatabaseDirectory(): Promise<void> {
  await mkdir(databaseDirectory, { recursive: true });
}

function getSqlDatabasePath(): string {
  return path.join(databaseDirectory, 'mastra.sql.db');
}

export async function getSqlStorageProvider(): Promise<LibSQLStore> {
  await ensureDatabaseDirectory();

  return new LibSQLStore({
    id: 'hey-jarvis-sql-storage',
    url: `file:${getSqlDatabasePath()}`,
  });
}

export async function getVectorStorageProvider(): Promise<LibSQLVector> {
  await ensureDatabaseDirectory();

  return new LibSQLVector({
    id: 'hey-jarvis-vector-storage',
    connectionUrl: `file:${path.join(databaseDirectory, 'mastra.vector.db')}`,
  });
}

let credentialsStorageInstance: CredentialsStorage | null = null;

export async function getCredentialsStorage(): Promise<CredentialsStorage> {
  if (!credentialsStorageInstance) {
    await ensureDatabaseDirectory();
    credentialsStorageInstance = new CredentialsStorage(getSqlDatabasePath());
  }
  return credentialsStorageInstance;
}

let deviceStateStorageInstance: DeviceStateStorage | null = null;

export async function getDeviceStateStorage(): Promise<DeviceStateStorage> {
  if (!deviceStateStorageInstance) {
    await ensureDatabaseDirectory();
    deviceStateStorageInstance = new DeviceStateStorage(getSqlDatabasePath());
  }
  return deviceStateStorageInstance;
}

let emailStateStorageInstance: EmailStateStorage | null = null;

export async function getEmailStateStorage(): Promise<EmailStateStorage> {
  if (!emailStateStorageInstance) {
    await ensureDatabaseDirectory();
    emailStateStorageInstance = new EmailStateStorage(getSqlDatabasePath());
  }
  return emailStateStorageInstance;
}

export { CredentialsStorage } from './credentials.js';
export { type DeviceStateChange, DeviceStateStorage, type StoredDeviceState } from './device-state.js';
export { EmailStateStorage, type LastEmailState } from './email-state.js';
