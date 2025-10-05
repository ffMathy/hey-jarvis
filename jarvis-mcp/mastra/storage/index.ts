import { LibSQLStore, LibSQLVector } from "@mastra/libsql";
import { mkdir } from "fs/promises";
import path from 'path';

const databaseDirectory = path.join(process.cwd(), 'jarvis-mcp');

let sqlStorageProviderInstance: LibSQLStore | null = null;
let vectorStorageProviderInstance: LibSQLVector | null = null;
let initializationPromise: Promise<void> | null = null;

async function initializeStorage() {
  if (!initializationPromise) {
    initializationPromise = (async () => {
      await mkdir(databaseDirectory, { recursive: true });
      
      sqlStorageProviderInstance = new LibSQLStore({
        url: `file:${path.join(databaseDirectory, 'mastra.sql.db')}`, // absolute path to database file
      });
      
      vectorStorageProviderInstance = new LibSQLVector({
        connectionUrl: `file:${path.join(databaseDirectory, 'mastra.vector.db')}`, // absolute path to vector database file
      });
    })();
  }
  return initializationPromise;
}

// Initialize storage on module load
initializeStorage().catch((error) => {
  console.error('Failed to initialize storage:', error);
  process.exit(1);
});

// Export proxies that ensure storage is initialized before use
export const sqlStorageProvider = new Proxy({} as LibSQLStore, {
  get(target, prop) {
    if (!sqlStorageProviderInstance) {
      throw new Error('Storage provider not initialized yet. Please ensure initialization is complete.');
    }
    const value = Reflect.get(sqlStorageProviderInstance, prop);
    return typeof value === 'function' ? value.bind(sqlStorageProviderInstance) : value;
  }
});

export const vectorStorageProvider = new Proxy({} as LibSQLVector, {
  get(target, prop) {
    if (!vectorStorageProviderInstance) {
      throw new Error('Vector storage provider not initialized yet. Please ensure initialization is complete.');
    }
    const value = Reflect.get(vectorStorageProviderInstance, prop);
    return typeof value === 'function' ? value.bind(vectorStorageProviderInstance) : value;
  }
});