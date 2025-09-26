import { LibSQLStore, LibSQLVector } from "@mastra/libsql";

export const sqlStorageProvider = new LibSQLStore({
  url: 'file:./mastra.sql.db', // path is relative to the .mastra/output directory
});

export const vectorStorageProvider = new LibSQLVector({
    connectionUrl: 'file:./mastra.vector.db', // path is relative to the .mastra/output directory
});