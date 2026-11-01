/**
 * Where the current glance is kept: one JSON file beside the pages it points at.
 *
 * A file rather than memory for the reasons the pages are files (`artifact-hosting.ts`): it has to
 * outlive a restart, so the phone is still shown a glance after a deploy, and the scheduled run that
 * builds a glance and the socket that hands it out are both in the MCP server's process today but
 * need not be. It is written to a temporary file and renamed over the old one, so a reader never
 * sees half of it.
 *
 * A glance is only as good as its page, which is hosted for {@link ARTIFACT_LIFETIME_MILLISECONDS}:
 * one older than that is no glance at all. It is rebuilt well within that (see `glance.ts`).
 */

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { type GlanceSummary, publishLiveEvent } from '../../utils/live-events.js';
import { logger } from '../../utils/logger.js';
import { ARTIFACT_LIFETIME_MILLISECONDS, getArtifactDirectory } from './artifact-hosting.js';

/** A glance action's id: a short slug the page and the device name it by. */
export const GLANCE_ACTION_ID_PATTERN = /^[a-z0-9-]{1,40}$/;

export const glanceActionSchema = z.object({
  id: z.string().regex(GLANCE_ACTION_ID_PATTERN),
  label: z.string().min(1),
  prompt: z.string().min(1),
});

export const storedGlanceSchema = z.object({
  id: z.uuid(),
  url: z.url(),
  /** The hosted page's id, under `/artifacts/`. */
  artifactId: z.uuid(),
  title: z.string(),
  generatedAt: z.iso.datetime(),
  actions: z.array(glanceActionSchema),
});

/** The glance as it is kept: what a device is told, and which hosted page it is. */
export type StoredGlance = z.infer<typeof storedGlanceSchema>;

export function getGlancePath(): string {
  return path.join(getArtifactDirectory(), 'glance.json');
}

/** Stores `glance` as the current one, replacing whatever was there in one rename. */
export async function storeGlance(glance: StoredGlance): Promise<void> {
  const glancePath = getGlancePath();
  const temporaryPath = `${glancePath}.${randomUUID()}.tmp`;

  await mkdir(path.dirname(glancePath), { recursive: true });
  await writeFile(temporaryPath, JSON.stringify(storedGlanceSchema.parse(glance)), 'utf8');
  try {
    await rename(temporaryPath, glancePath);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw new Error(`Could not store the glance at ${glancePath}`, { cause: error });
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

/**
 * The current glance, or nothing when none was ever built, or its page has expired.
 *
 * A file that cannot be read as a glance counts as none, and says why in the log: the next
 * scheduled run then builds one over it, which is the only repair there is.
 */
export async function readCurrentGlance(now = new Date()): Promise<StoredGlance | undefined> {
  let contents: string;
  try {
    contents = await readFile(getGlancePath(), 'utf8');
  } catch (error) {
    if (isMissingFile(error)) {
      return undefined;
    }
    throw error;
  }

  let parsed: z.ZodSafeParseResult<StoredGlance>;
  try {
    parsed = storedGlanceSchema.safeParse(JSON.parse(contents));
  } catch (error) {
    logger.warn('[GLANCE] The stored glance is not JSON; treating it as missing', {
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  }
  if (!parsed.success) {
    logger.warn('[GLANCE] The stored glance is not a glance; treating it as missing', {
      error: parsed.error.message,
    });
    return undefined;
  }

  const ageMilliseconds = now.getTime() - Date.parse(parsed.data.generatedAt);
  return ageMilliseconds < ARTIFACT_LIFETIME_MILLISECONDS ? parsed.data : undefined;
}

/** What a device is told of a glance: everything but which file its page is. */
export function toGlanceSummary({ artifactId: _artifactId, ...summary }: StoredGlance): GlanceSummary {
  return summary;
}

/** Stores a newly built glance and tells every device holding a socket open. */
export async function publishGlance(glance: StoredGlance): Promise<void> {
  await storeGlance(glance);
  publishLiveEvent({ type: 'glance', glance: toGlanceSummary(glance) });
}
