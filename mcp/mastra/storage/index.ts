import { InMemoryStore, MastraCompositeStore, type RetentionConfig } from '@mastra/core/storage';
import { LibSQLStore, LibSQLVector } from '@mastra/libsql';
import { mkdir } from 'fs/promises';
import path from 'path';
import { CredentialsStorage } from './credentials.js';
import { DeviceStateStorage } from './device-state.js';
import { EmailStateStorage } from './email-state.js';
import { EntityNoiseBaselineStorage } from './entity-noise-baseline.js';
import { withFeedbackFrom } from './observability.js';
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

let sqlStorageProviderInstance: LibSQLStore | null = null;

export async function getSqlStorageProvider(): Promise<LibSQLStore> {
  if (!sqlStorageProviderInstance) {
    await ensureDatabaseDirectory();

    sqlStorageProviderInstance = new LibSQLStore({
      id: 'hey-jarvis-sql-storage',
      url: `file:${getSqlDatabasePath()}`,
    });
  }
  return sqlStorageProviderInstance;
}

let vectorStorageProviderInstance: LibSQLVector | null = null;

export async function getVectorStorageProvider(): Promise<LibSQLVector> {
  if (!vectorStorageProviderInstance) {
    await ensureDatabaseDirectory();

    vectorStorageProviderInstance = new LibSQLVector({
      id: 'hey-jarvis-vector-storage',
      url: `file:${path.join(databaseDirectory, 'mastra.vector.db')}`,
    });
  }
  return vectorStorageProviderInstance;
}

/**
 * How long Mastra's own append-only tables are kept.
 *
 * Both of these grow as a side effect of the system simply running: observability
 * samples every span (`SamplingStrategyType.ALWAYS` in mastra/index.ts) and the
 * schedulers start workflow runs around the clock, on a device that is never switched
 * off. `token_usage` already grew for the life of the database this way, which is why
 * storageRetentionWorkflow exists; giving Mastra a durable store without a policy would
 * reintroduce the same leak on two more tables.
 *
 * Memory is deliberately absent: threads and messages are the user's own conversation
 * history, not telemetry, so they are kept until something deletes them on purpose.
 */
const MASTRA_RETENTION: RetentionConfig = {
  observability: { spans: { maxAge: '14d' } },
  workflows: { workflowSnapshot: { maxAge: '30d' } },
};

let mastraStorageProviderInstance: MastraCompositeStore | null = null;

/**
 * Builds the storage adapter for the Mastra instance itself.
 *
 * Without this Mastra falls back to an in-memory store and says so on every boot: "No
 * `storage` configured on Mastra — falling back to an in-memory store. In-memory storage
 * is not durable". Everything Mastra owns — workflow runs, schedules, traces,
 * notifications — was being kept in RAM and lost on restart, even though the LibSQL
 * database backing agent memory was right here.
 *
 * Feedback is served from a separate in-memory store because LibSQL does not implement
 * that part of the observability domain at all; see storage/observability.ts. Feedback
 * left in Studio therefore lasts as long as the process does, which is the most any
 * store here can offer for it, and better than the 500 the endpoint answers otherwise.
 */
export async function getMastraStorageProvider(): Promise<MastraCompositeStore> {
  if (mastraStorageProviderInstance) {
    return mastraStorageProviderInstance;
  }

  const sqlStorageProvider = await getSqlStorageProvider();
  const durableObservability = await sqlStorageProvider.getStore('observability');
  const feedbackObservability = await new InMemoryStore({ id: 'hey-jarvis-feedback-storage' }).getStore(
    'observability',
  );

  mastraStorageProviderInstance = new MastraCompositeStore({
    id: 'hey-jarvis-mastra-storage',
    default: sqlStorageProvider,
    domains:
      durableObservability && feedbackObservability
        ? { observability: withFeedbackFrom(durableObservability, feedbackObservability) }
        : undefined,
    retention: MASTRA_RETENTION,
  });

  return mastraStorageProviderInstance;
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
