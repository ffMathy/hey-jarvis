/**
 * The glance's decisions: when it is built again, what the planner is shown, and what of the
 * planner's actions a page is given. The workflow itself is run for real up to its decision, which
 * is the part that runs every quarter of an hour; a build needs a Claude Code session.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getImportantChangeStorage } from '../../storage/index.js';
import {
  decideGlanceRebuild,
  describeGlanceContext,
  GLANCE_MAX_AGE_MS,
  isGlanceQuietHour,
  MAX_GLANCE_ACTIONS,
  normalizeGlanceActions,
} from './glance.js';
import { storeGlance } from './glance-store.js';
import { glanceWorkflow } from './workflows.js';

/** 14:00 in Copenhagen (UTC+1 in November). */
const afternoon = new Date('2026-11-01T13:00:00.000Z');
/** 02:00 in Copenhagen. */
const night = new Date('2026-11-01T01:00:00.000Z');

function before(moment: Date, milliseconds: number): string {
  return new Date(moment.getTime() - milliseconds).toISOString();
}

const MINUTE = 60_000;

describe('isGlanceQuietHour', () => {
  it('counts 23:00 to 06:00 on the household clock as quiet, whatever the server clock says', () => {
    expect(isGlanceQuietHour(new Date('2026-11-01T21:59:00.000Z'))).toBe(false); // 22:59
    expect(isGlanceQuietHour(new Date('2026-11-01T22:00:00.000Z'))).toBe(true); // 23:00
    expect(isGlanceQuietHour(night)).toBe(true);
    expect(isGlanceQuietHour(new Date('2026-11-01T04:59:00.000Z'))).toBe(true); // 05:59
    expect(isGlanceQuietHour(new Date('2026-11-01T05:00:00.000Z'))).toBe(false); // 06:00
  });
});

describe('decideGlanceRebuild', () => {
  it('builds one when there is none, even at night', () => {
    expect(decideGlanceRebuild({ now: night, current: undefined, latestChangeNotedAt: undefined }).rebuild).toBe(true);
  });

  it('builds again when an important change was noted after the glance', () => {
    const current = { generatedAt: before(afternoon, 30 * MINUTE) };

    expect(
      decideGlanceRebuild({ now: afternoon, current, latestChangeNotedAt: before(afternoon, 10 * MINUTE) }),
    ).toEqual({ rebuild: true, reason: 'an important change was noted since the glance was built' });
    expect(
      decideGlanceRebuild({ now: afternoon, current, latestChangeNotedAt: before(afternoon, 40 * MINUTE) }).rebuild,
    ).toBe(false);
  });

  it('builds again once the glance is three hours old, and not a moment before', () => {
    const almost = { generatedAt: before(afternoon, GLANCE_MAX_AGE_MS - MINUTE) };
    const old = { generatedAt: before(afternoon, GLANCE_MAX_AGE_MS) };

    expect(decideGlanceRebuild({ now: afternoon, current: almost, latestChangeNotedAt: undefined })).toEqual({
      rebuild: false,
      reason: 'the glance is up to date',
    });
    expect(decideGlanceRebuild({ now: afternoon, current: old, latestChangeNotedAt: undefined }).rebuild).toBe(true);
  });

  it('builds nothing in the quiet hours while there is a glance, whatever has happened', () => {
    const decision = decideGlanceRebuild({
      now: night,
      current: { generatedAt: before(night, 5 * GLANCE_MAX_AGE_MS) },
      latestChangeNotedAt: before(night, MINUTE),
    });

    expect(decision.rebuild).toBe(false);
  });
});

describe('normalizeGlanceActions', () => {
  it('makes ids slugs, drops empty and repeated ones, and keeps at most the limit', () => {
    const actions = normalizeGlanceActions([
      { id: 'Unlock Front Door!', label: ' Unlock the door ', prompt: ' Unlock the front door ' },
      { id: 'unlock-front-door', label: 'Again', prompt: 'Unlock it again' },
      { id: '???', label: 'Nothing', prompt: 'Do nothing' },
      { id: 'open-garage', label: 'Open garage', prompt: '' },
      ...Array.from({ length: 6 }, (_, index) => ({
        id: `light-${index}`,
        label: `Light ${index}`,
        prompt: `Turn on light ${index}`,
      })),
    ]);

    expect(actions[0]).toEqual({ id: 'unlock-front-door', label: 'Unlock the door', prompt: 'Unlock the front door' });
    expect(actions).toHaveLength(MAX_GLANCE_ACTIONS);
    expect(actions.map((action) => action.id)).toEqual(['unlock-front-door', 'light-0', 'light-1', 'light-2']);
  });
});

describe('describeGlanceContext', () => {
  it('writes out every source, and says which could not be read', () => {
    const described = describeGlanceContext({
      readAt: afternoon.toISOString(),
      householdTime: 'Sun Nov 01 2026 14:00:00 GMT+0100 (Central European Standard Time)',
      changes: [
        {
          summary: 'Your parcel arrives between 14:00 and 16:00.',
          source: 'email',
          notedAt: '2026-11-01T08:00:00.000Z',
        },
      ],
      events: [],
      calendarUnavailable: 'Missing required Google OAuth2 credentials',
      entities: [{ id: 'lock.front_door', name: 'Front door', area: 'Hall', state: 'locked' }],
    });

    expect(described).toContain("The household's time is Sun Nov 01 2026 14:00:00");
    expect(described).toContain(
      '- Your parcel arrives between 14:00 and 16:00. (from email, noted 2026-11-01T08:00:00.000Z)',
    );
    expect(described).toContain('Unavailable: Missing required Google OAuth2 credentials');
    expect(described).toContain('- Front door (Hall): locked');
  });
});

describe('glanceWorkflow', () => {
  const originalStoragePath = process.env.HEY_JARVIS_STORAGE_PATH;
  let storageDirectory: string;

  beforeEach(async () => {
    storageDirectory = await mkdtemp(path.join(tmpdir(), 'glance-workflow-'));
    process.env.HEY_JARVIS_STORAGE_PATH = storageDirectory;
    await (await getImportantChangeStorage()).clear();
  });

  afterEach(async () => {
    if (originalStoragePath === undefined) {
      delete process.env.HEY_JARVIS_STORAGE_PATH;
    } else {
      process.env.HEY_JARVIS_STORAGE_PATH = originalStoragePath;
    }
    await rm(storageDirectory, { force: true, recursive: true });
  });

  it('ends at its first step, building nothing, while the glance is up to date', async () => {
    await storeGlance({
      id: '6f1c9a4e-2b3d-4c5e-8f70-1a2b3c4d5e6f',
      url: 'https://jarvis.example.com/artifacts/0e9d8c7b-6a5f-4e3d-9c2b-1a0f9e8d7c6b',
      artifactId: '0e9d8c7b-6a5f-4e3d-9c2b-1a0f9e8d7c6b',
      title: 'Nothing needs you',
      generatedAt: new Date().toISOString(),
      actions: [],
    });

    const run = await glanceWorkflow.createRun();
    const result = await run.start({ inputData: {} });

    expect(result.status).toBe('success');
    if (result.status === 'success') {
      expect(result.result.rebuilt).toBe(false);
      expect(result.result.message).toStartWith('No rebuild:');
    }
    expect(Object.keys(result.steps)).toEqual(['input', 'decide-glance-rebuild']);
  });
});
