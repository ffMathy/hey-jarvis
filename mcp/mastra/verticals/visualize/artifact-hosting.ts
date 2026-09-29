/**
 * Hosts the pages this vertical builds, for a day, on the MCP server itself.
 *
 * A Claude Code session run over SSH has no way to publish anything: asked to "publish an
 * artifact", it made up an address such as `https://artifacts.local/news-summary`, which nothing
 * answers. Free file hosts are no way out either -- they serve `.html` as plain text, so a phone
 * would show the page's source. So the session hands back the page itself, and it is served from
 * here, under the tunnel's public hostname: the one address of Jarvis's the phone can already reach.
 *
 * Pages are files in the storage directory rather than entries in memory, because the tool that
 * stores a page and the server that serves it are not always the same process (Studio on 4111
 * builds pages too, and only the MCP server on 4112 is behind the tunnel), and because a restart
 * should not break a link that was pushed to the phone an hour earlier.
 *
 * Each page is named by a random UUID, which is all that keeps it private: anyone with the link
 * can open it until it expires.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Request, Response, Router } from 'express';
import { logger } from '../../utils/logger.js';

/** How long a page stays up after it was built. */
export const ARTIFACT_LIFETIME_MILLISECONDS = 24 * 60 * 60 * 1000;

/** The path pages are served under, on the MCP server. */
export const ARTIFACT_ROUTE_PREFIX = '/artifacts';

/** A page's name: a UUID, so a request can never name a file outside the directory. */
const ARTIFACT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Where pages are kept: beside the rest of the server's state, which survives a restart. */
export function getArtifactDirectory(): string {
  return path.join(process.env.HEY_JARVIS_STORAGE_PATH || path.join('/tmp', 'mcp'), 'artifacts');
}

/**
 * The public address the MCP server answers on -- the Cloudflare tunnel's hostname.
 *
 * Without it a page could be stored but not linked to, so its absence is an error that says which
 * variable to set, rather than a link to somewhere the phone cannot reach.
 */
export function getPublicBaseUrl(): string {
  const baseUrl = process.env.HEY_JARVIS_CLOUDFLARED_TUNNEL_URL?.trim();
  if (!baseUrl) {
    throw new Error('HEY_JARVIS_CLOUDFLARED_TUNNEL_URL is not set, so there is no public address to host the page at.');
  }

  return (/^https?:\/\//.test(baseUrl) ? baseUrl : `https://${baseUrl}`).replace(/\/+$/, '');
}

function getArtifactPath(id: string): string {
  return path.join(getArtifactDirectory(), `${id}.html`);
}

function isExpired(storedAt: Date, now = Date.now()): boolean {
  return now - storedAt.getTime() >= ARTIFACT_LIFETIME_MILLISECONDS;
}

/** Deletes the pages that have outlived {@link ARTIFACT_LIFETIME_MILLISECONDS}. */
export async function removeExpiredArtifacts(): Promise<void> {
  const directory = getArtifactDirectory();
  const now = Date.now();

  for (const fileName of await readdir(directory).catch(() => [])) {
    const filePath = path.join(directory, fileName);
    const stats = await stat(filePath).catch(() => undefined);

    if (stats && isExpired(stats.mtime, now)) {
      await rm(filePath, { force: true });
    }
  }
}

/** What {@link hostArtifact} hands back. */
export interface HostedArtifact {
  id: string;
  url: string;
  expiresAt: Date;
}

/** Stores a page and returns the public link it is served at for the next day. */
export async function hostArtifact(html: string): Promise<HostedArtifact> {
  const baseUrl = getPublicBaseUrl();
  const id = randomUUID();

  await mkdir(getArtifactDirectory(), { recursive: true });
  // Expired pages go on the way in, so nothing has to run on a timer to keep the directory small.
  await removeExpiredArtifacts();
  await writeFile(getArtifactPath(id), html, 'utf8');

  return {
    id,
    url: `${baseUrl}${ARTIFACT_ROUTE_PREFIX}/${id}`,
    expiresAt: new Date(Date.now() + ARTIFACT_LIFETIME_MILLISECONDS),
  };
}

/** Reads a hosted page back, or nothing when it never existed or has expired. */
export async function readArtifact(id: string): Promise<string | undefined> {
  if (!ARTIFACT_ID_PATTERN.test(id)) {
    return undefined;
  }

  const filePath = getArtifactPath(id);
  const stats = await stat(filePath).catch(() => undefined);
  if (!stats) {
    return undefined;
  }

  if (isExpired(stats.mtime)) {
    await rm(filePath, { force: true });
    return undefined;
  }

  return await readFile(filePath, 'utf8');
}

async function serveArtifact(req: Request<{ id: string }>, res: Response): Promise<void> {
  const html = await readArtifact(req.params.id);

  if (html === undefined) {
    res.status(404).type('text/plain').send('This page has expired or never existed.');
    return;
  }

  res
    .status(200)
    .set({
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow',
    })
    .type('html')
    .send(html);
}

/** Serves hosted pages at `GET /artifacts/:id` on the given router. */
export function registerArtifactRoutes(router: Router): string {
  const routePath = `${ARTIFACT_ROUTE_PREFIX}/:id`;

  router.get(routePath, (req: Request<{ id: string }>, res: Response) => {
    serveArtifact(req, res).catch((error: unknown) => {
      logger.error('[VISUALIZE] Failed to serve a hosted page', { error });
      if (!res.headersSent) {
        res.status(500).type('text/plain').send('The page could not be read.');
      }
    });
  });

  return routePath;
}
