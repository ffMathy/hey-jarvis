/**
 * Hosting tests.
 *
 * Each test gets a storage directory of its own and a made-up public hostname, and pages are
 * served by a real Express server on a free port, so what is checked is what a phone would get.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readdir, rm, utimes } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import express from 'express';
import {
  ARTIFACT_LIFETIME_MILLISECONDS,
  getArtifactDirectory,
  getPublicBaseUrl,
  hostArtifact,
  readArtifact,
  registerArtifactRoutes,
} from './artifact-hosting.js';

const PAGE = '<!doctype html><html><body><h1>News</h1></body></html>';

const originalEnvironment = {
  storagePath: process.env.HEY_JARVIS_STORAGE_PATH,
  tunnelUrl: process.env.HEY_JARVIS_PUBLIC_URL,
};

function restoreEnvironmentVariable(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

/** Makes a hosted page look as if it was stored `ageMilliseconds` ago. */
async function age(id: string, ageMilliseconds: number) {
  const storedAt = new Date(Date.now() - ageMilliseconds);
  await utimes(path.join(getArtifactDirectory(), `${id}.html`), storedAt, storedAt);
}

let storageDirectory: string;
let server: Server;
let serverUrl: string;

beforeAll(async () => {
  const router = express.Router();
  registerArtifactRoutes(router);

  const app = express();
  app.use(router);

  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => {
    server.once('listening', () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('Expected the test server to be listening on a TCP port');
  }
  serverUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(() => {
  server.close();
});

beforeEach(async () => {
  storageDirectory = await mkdtemp(path.join(tmpdir(), 'visualize-hosting-'));
  process.env.HEY_JARVIS_STORAGE_PATH = storageDirectory;
  process.env.HEY_JARVIS_PUBLIC_URL = 'https://jarvis.example.com';
});

afterEach(async () => {
  restoreEnvironmentVariable('HEY_JARVIS_STORAGE_PATH', originalEnvironment.storagePath);
  restoreEnvironmentVariable('HEY_JARVIS_PUBLIC_URL', originalEnvironment.tunnelUrl);
  await rm(storageDirectory, { recursive: true, force: true });
});

describe('getPublicBaseUrl', () => {
  it('drops a trailing slash', () => {
    process.env.HEY_JARVIS_PUBLIC_URL = 'https://jarvis.example.com/';

    expect(getPublicBaseUrl()).toBe('https://jarvis.example.com');
  });

  it('assumes HTTPS for a bare hostname', () => {
    process.env.HEY_JARVIS_PUBLIC_URL = 'jarvis.example.com';

    expect(getPublicBaseUrl()).toBe('https://jarvis.example.com');
  });

  it('says which variable is missing', () => {
    delete process.env.HEY_JARVIS_PUBLIC_URL;

    expect(() => getPublicBaseUrl()).toThrow(/HEY_JARVIS_PUBLIC_URL is not set/);
  });
});

describe('hostArtifact', () => {
  it('links to the page under the public hostname, for a day', async () => {
    const before = Date.now();
    const hosted = await hostArtifact(PAGE);

    expect(hosted.url).toBe(`https://jarvis.example.com/artifacts/${hosted.id}`);
    expect(hosted.expiresAt.getTime()).toBeGreaterThanOrEqual(before + ARTIFACT_LIFETIME_MILLISECONDS);
    expect(await readArtifact(hosted.id)).toBe(PAGE);
  });

  it('names every page differently', async () => {
    const first = await hostArtifact(PAGE);
    const second = await hostArtifact(PAGE);

    expect(first.id).not.toBe(second.id);
  });

  it('clears out expired pages when a new one is stored', async () => {
    const old = await hostArtifact(PAGE);
    await age(old.id, ARTIFACT_LIFETIME_MILLISECONDS + 1000);

    const fresh = await hostArtifact(PAGE);

    expect(await readdir(getArtifactDirectory())).toEqual([`${fresh.id}.html`]);
  });
});

describe('readArtifact', () => {
  it('forgets a page once its day is up', async () => {
    const hosted = await hostArtifact(PAGE);
    await age(hosted.id, ARTIFACT_LIFETIME_MILLISECONDS + 1000);

    expect(await readArtifact(hosted.id)).toBeUndefined();
  });

  it('still has a page just before its day is up', async () => {
    const hosted = await hostArtifact(PAGE);
    await age(hosted.id, ARTIFACT_LIFETIME_MILLISECONDS - 60_000);

    expect(await readArtifact(hosted.id)).toBe(PAGE);
  });

  it('refuses a name that is not a page id', async () => {
    expect(await readArtifact('../mastra.sql.db')).toBeUndefined();
    expect(await readArtifact('news-summary')).toBeUndefined();
  });
});

describe('GET /artifacts/:id', () => {
  it('serves the page as HTML that is neither cached nor indexed', async () => {
    const hosted = await hostArtifact(PAGE);

    const response = await fetch(`${serverUrl}/artifacts/${hosted.id}`);

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('x-robots-tag')).toBe('noindex, nofollow');
    expect(await response.text()).toBe(PAGE);
  });

  it('answers 404 for an expired page', async () => {
    const hosted = await hostArtifact(PAGE);
    await age(hosted.id, ARTIFACT_LIFETIME_MILLISECONDS + 1000);

    const response = await fetch(`${serverUrl}/artifacts/${hosted.id}`);

    expect(response.status).toBe(404);
  });

  it('answers 404 for a page that never existed', async () => {
    const response = await fetch(`${serverUrl}/artifacts/00000000-0000-4000-8000-000000000000`);

    expect(response.status).toBe(404);
  });
});
