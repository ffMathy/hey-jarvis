/**
 * CORS configuration for the Mastra API server.
 *
 * Kept in its own module so it can be exercised in isolation, without
 * importing `index.ts` and booting every agent and workflow.
 */

/**
 * Default Studio origins. `mastra studio` serves on port 3000, and the browser
 * reports whichever hostname the user typed, so both spellings of loopback are
 * allowed.
 */
const DEFAULT_STUDIO_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'];

/**
 * Browser origins allowed to call this API with credentials.
 *
 * Mastra Studio issues credentialed requests (e.g. `/api/auth/capabilities`),
 * and browsers reject those whenever the server answers with a wildcard
 * `Access-Control-Allow-Origin`. Echoing an explicit origin back is what lets a
 * Studio running on its own port talk to this server; when Studio is served
 * from this same origin (as in the Docker image) CORS never applies.
 *
 * @param studioBaseUrl - Value of `MASTRA_STUDIO_BASE_URL`, if configured
 */
export function getAllowedOrigins(studioBaseUrl = process.env.MASTRA_STUDIO_BASE_URL): string[] {
  if (!studioBaseUrl || DEFAULT_STUDIO_ORIGINS.includes(studioBaseUrl)) {
    return DEFAULT_STUDIO_ORIGINS;
  }

  return [studioBaseUrl, ...DEFAULT_STUDIO_ORIGINS];
}

/**
 * Options for Hono's `cors()` middleware.
 *
 * `credentials: true` is only safe alongside an explicit origin allow-list —
 * never with a wildcard origin.
 */
export function getCorsOptions(studioBaseUrl?: string) {
  return {
    origin: getAllowedOrigins(studioBaseUrl),
    credentials: true,
  };
}
