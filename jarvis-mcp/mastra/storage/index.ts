import { LibSQLStore, LibSQLVector } from "@mastra/libsql";
import path from 'path';

const dbDir = path.join(process.cwd(), 'jarvis-mcp');

export const sqlStorageProvider = new LibSQLStore({
  url: `file:${path.join(dbDir, 'mastra.sql.db')}`, // absolute path to database file
});

export const vectorStorageProvider = new LibSQLVector({
    connectionUrl: `file:${path.join(dbDir, 'mastra.vector.db')}`, // absolute path to vector database file
});