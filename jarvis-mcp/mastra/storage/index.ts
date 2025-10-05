import { LibSQLStore, LibSQLVector } from "@mastra/libsql";
import { mkdirSync, existsSync } from "fs";
import path from 'path';

const databaseDirectory = path.join(process.cwd(), 'jarvis-mcp');

// Create directory synchronously to avoid top-level await issues
if (!existsSync(databaseDirectory)) {
  mkdirSync(databaseDirectory, { recursive: true });
}

export const sqlStorageProvider = new LibSQLStore({
  url: `file:${path.join(databaseDirectory, 'mastra.sql.db')}`, // absolute path to database file
});

export const vectorStorageProvider = new LibSQLVector({
    connectionUrl: `file:${path.join(databaseDirectory, 'mastra.vector.db')}`, // absolute path to vector database file
});