import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type LiveEvent, onLiveEvent } from '../../utils/live-events.js';
import { ARTIFACT_LIFETIME_MILLISECONDS, getArtifactDirectory } from './artifact-hosting.js';
import { getGlancePath, publishGlance, readCurrentGlance, type StoredGlance, storeGlance } from './glance-store.js';

const originalStoragePath = process.env.HEY_JARVIS_STORAGE_PATH;
let storageDirectory: string;

beforeEach(async () => {
  storageDirectory = await mkdtemp(path.join(tmpdir(), 'glance-store-'));
  process.env.HEY_JARVIS_STORAGE_PATH = storageDirectory;
});

afterEach(async () => {
  if (originalStoragePath === undefined) {
    delete process.env.HEY_JARVIS_STORAGE_PATH;
  } else {
    process.env.HEY_JARVIS_STORAGE_PATH = originalStoragePath;
  }
  await rm(storageDirectory, { force: true, recursive: true });
});

const generatedAt = new Date('2026-11-01T10:00:00.000Z');

const glance: StoredGlance = {
  id: '6f1c9a4e-2b3d-4c5e-8f70-1a2b3c4d5e6f',
  url: 'https://jarvis.example.com/artifacts/0e9d8c7b-6a5f-4e3d-9c2b-1a0f9e8d7c6b',
  artifactId: '0e9d8c7b-6a5f-4e3d-9c2b-1a0f9e8d7c6b',
  title: 'Your parcel arrives this afternoon',
  generatedAt: generatedAt.toISOString(),
  actions: [{ id: 'unlock-front-door', label: 'Unlock the door', prompt: 'Unlock the front door' }],
};

describe('the glance store', () => {
  it('has no glance before one is stored', async () => {
    expect(await readCurrentGlance(generatedAt)).toBeUndefined();
  });

  it('reads back the glance it stored, beside the pages, leaving no temporary file', async () => {
    await storeGlance(glance);

    expect(await readCurrentGlance(generatedAt)).toEqual(glance);
    expect(path.dirname(getGlancePath())).toBe(getArtifactDirectory());
    expect(await readdir(getArtifactDirectory())).toEqual(['glance.json']);
  });

  it('replaces the glance before it', async () => {
    await storeGlance(glance);
    const next = { ...glance, id: '7a2d0b5f-3c4e-4d6f-9a81-2b3c4d5e6f70', title: 'Nothing needs you', actions: [] };
    await storeGlance(next);

    expect(await readCurrentGlance(generatedAt)).toEqual(next);
  });

  it('forgets a glance whose page has expired', async () => {
    await storeGlance(glance);

    const justBefore = new Date(generatedAt.getTime() + ARTIFACT_LIFETIME_MILLISECONDS - 1);
    const atExpiry = new Date(generatedAt.getTime() + ARTIFACT_LIFETIME_MILLISECONDS);
    expect(await readCurrentGlance(justBefore)).toEqual(glance);
    expect(await readCurrentGlance(atExpiry)).toBeUndefined();
  });

  it('counts a file that is not a glance as none', async () => {
    await storeGlance(glance);
    await writeFile(getGlancePath(), '{"id":"not a glance"}', 'utf8');
    expect(await readCurrentGlance(generatedAt)).toBeUndefined();

    await writeFile(getGlancePath(), 'not json', 'utf8');
    expect(await readCurrentGlance(generatedAt)).toBeUndefined();
  });

  it('refuses to store an action whose id is not a slug', async () => {
    const badAction = { id: 'Unlock Door', label: 'Unlock', prompt: 'Unlock the front door' };
    await expect(storeGlance({ ...glance, actions: [badAction] })).rejects.toThrow();
  });

  it('tells every device of a published glance, without the file it is kept in', async () => {
    const events: LiveEvent[] = [];
    const stopListening = onLiveEvent((event) => events.push(event));

    await publishGlance(glance);
    stopListening();

    const { artifactId: _artifactId, ...summary } = glance;
    expect(events).toEqual([{ type: 'glance', glance: summary }]);
    expect(await readCurrentGlance(generatedAt)).toEqual(glance);
  });
});
