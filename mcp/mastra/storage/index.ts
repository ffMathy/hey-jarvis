import { LibSQLStore, LibSQLVector } from '@mastra/libsql';
import { mkdir } from 'fs/promises';
import path from 'path';
import { CredentialsStorage } from './credentials.js';
import { DeviceStateStorage } from './device-state.js';
import { EmailStateStorage } from './email-state.js';
import { EntityNoiseBaselineStorage } from './entity-noise-baseline.js';
import { SubscriptionStorage } from './subscriptions.js';
import { TokenUsageStorage } from './token-usage.js';

// Use HEY_JARVIS_STORAGE_PATH environment variable if set, otherwise use local mcp/ directory
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

/**
 * The notifications domain of the shared SQL store.
 *
 * `getStore` resolves to `undefined` for a domain the adapter does not implement, which
 * for the notification inbox is not a case worth threading through every caller — LibSQL
 * implements it, and if that ever stops being true the reactor's inbox is broken and
 * should say so at construction rather than at the first rollup.
 */
export async function getNotificationsStorage() {
  const store = await (await getSqlStorageProvider()).getStore('notifications');
  if (!store) {
    throw new Error('The configured SQL storage provider does not implement the notifications domain.');
  }
  return store;
}

export async function getVectorStorageProvider(): Promise<LibSQLVector> {
  await ensureDatabaseDirectory();

  return new LibSQLVector({
    id: 'hey-jarvis-vector-storage',
    url: `file:${path.join(databaseDirectory, 'mastra.vector.db')}`,
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

let tokenUsageStorageInstance: TokenUsageStorage | null = null;

export async function getTokenUsageStorage(): Promise<TokenUsageStorage> {
  if (!tokenUsageStorageInstance) {
    await ensureDatabaseDirectory();
    tokenUsageStorageInstance = new TokenUsageStorage(getSqlDatabasePath());
  }
  return tokenUsageStorageInstance;
}

let subscriptionStorageInstance: SubscriptionStorage | null = null;

export async function getSubscriptionStorage(): Promise<SubscriptionStorage> {
  if (!subscriptionStorageInstance) {
    await ensureDatabaseDirectory();
    subscriptionStorageInstance = new SubscriptionStorage(getSqlDatabasePath());
  }
  return subscriptionStorageInstance;
}

let entityNoiseBaselineStorageInstance: EntityNoiseBaselineStorage | null = null;

export async function getEntityNoiseBaselineStorage(): Promise<EntityNoiseBaselineStorage> {
  if (!entityNoiseBaselineStorageInstance) {
    await ensureDatabaseDirectory();
    entityNoiseBaselineStorageInstance = new EntityNoiseBaselineStorage(getSqlDatabasePath());
  }
  return entityNoiseBaselineStorageInstance;
}

export { CredentialsStorage } from './credentials.js';
export { type DeviceStateChange, DeviceStateStorage, type StoredDeviceState } from './device-state.js';
export { EmailStateStorage, type LastEmailState } from './email-state.js';
export {
  type EntityNoiseBaseline,
  EntityNoiseBaselineStorage,
  type NoiseAnalysisResult,
} from './entity-noise-baseline.js';
export {
  type EmbeddedSubscription,
  type NewSubscription,
  type Subscription,
  type SubscriptionComponents,
  type SubscriptionEmbeddings,
  SubscriptionStorage,
} from './subscriptions.js';
export {
  type QuotaInfo,
  type TokenUsageRecord,
  TokenUsageStorage,
  type TokenUsageSummary,
} from './token-usage.js';
