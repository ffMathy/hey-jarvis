import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getAllowedOrigins, getCorsOptions } from './cors.js';

const STUDIO_ORIGIN = 'http://localhost:3000';

// Defaults to '' rather than undefined so the middleware under test never falls
// back to MASTRA_STUDIO_BASE_URL from the runner's environment.
function createApp(studioBaseUrl = '') {
  const app = new Hono();
  app.use('*', cors(getCorsOptions(studioBaseUrl)));
  app.get('/api/agents', (c) => c.json({}));
  return app;
}

async function preflight(app: Hono, origin: string) {
  return await app.request('/api/agents', {
    method: 'OPTIONS',
    headers: { Origin: origin, 'Access-Control-Request-Method': 'GET' },
  });
}

describe('API CORS configuration', () => {
  describe('getAllowedOrigins', () => {
    // Passed explicitly rather than relying on the default parameter, which would
    // read MASTRA_STUDIO_BASE_URL and make these expectations depend on the runner.
    it('allows both loopback spellings of the default Studio origin', () => {
      expect(getAllowedOrigins('')).toEqual(['http://localhost:3000', 'http://127.0.0.1:3000']);
    });

    it('adds a custom Studio base URL', () => {
      expect(getAllowedOrigins('https://studio.example.com')).toContain('https://studio.example.com');
    });

    it('does not duplicate a Studio base URL that is already a default', () => {
      const origins = getAllowedOrigins(STUDIO_ORIGIN);
      expect(origins.filter((origin) => origin === STUDIO_ORIGIN)).toHaveLength(1);
    });
  });

  describe('preflight responses', () => {
    it('echoes the Studio origin back with credentials enabled', async () => {
      const response = await preflight(createApp(), STUDIO_ORIGIN);

      expect(response.headers.get('access-control-allow-origin')).toBe(STUDIO_ORIGIN);
      expect(response.headers.get('access-control-allow-credentials')).toBe('true');
    });

    it('never answers with a wildcard origin, which browsers reject for credentialed requests', async () => {
      const response = await preflight(createApp(), STUDIO_ORIGIN);

      expect(response.headers.get('access-control-allow-origin')).not.toBe('*');
    });

    it('does not allow origins outside the allow-list', async () => {
      const response = await preflight(createApp(), 'https://not-studio.example.com');

      expect(response.headers.get('access-control-allow-origin')).toBeNull();
    });

    it('allows a custom Studio base URL when one is configured', async () => {
      const customOrigin = 'https://studio.example.com';
      const response = await preflight(createApp(customOrigin), customOrigin);

      expect(response.headers.get('access-control-allow-origin')).toBe(customOrigin);
      expect(response.headers.get('access-control-allow-credentials')).toBe('true');
    });
  });
});
