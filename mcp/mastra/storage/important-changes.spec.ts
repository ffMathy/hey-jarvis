import { afterAll, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { IMPORTANT_CHANGE_TTL_MS, ImportantChangeStorage } from './important-changes.js';

const databaseDirectory = await mkdtemp(path.join(tmpdir(), 'important-changes-'));
const storage = new ImportantChangeStorage(path.join(databaseDirectory, 'important-changes.db'));

const now = new Date('2026-10-25T10:00:00.000Z');

function minutesBefore(minutes: number): Date {
  return new Date(now.getTime() - minutes * 60_000);
}

beforeEach(async () => {
  await storage.clear();
});

afterAll(async () => {
  await rm(databaseDirectory, { force: true, recursive: true });
});

describe('ImportantChangeStorage', () => {
  it('hands a change over once, and never again', async () => {
    await storage.add({ summary: 'Your parcel arrives at 14:00.', source: 'email' }, minutesBefore(5));

    const first = await storage.claimNewestUnmentioned(now);
    const second = await storage.claimNewestUnmentioned(now);

    expect(first?.summary).toBe('Your parcel arrives at 14:00.');
    expect(first?.source).toBe('email');
    expect(second).toBeUndefined();
  });

  it('hands over one change at a time, newest first', async () => {
    await storage.add({ summary: 'oldest', source: 'email' }, minutesBefore(30));
    await storage.add({ summary: 'newest', source: 'email' }, minutesBefore(10));
    await storage.add({ summary: 'middle', source: 'email' }, minutesBefore(20));

    const claimed = [
      await storage.claimNewestUnmentioned(now),
      await storage.claimNewestUnmentioned(now),
      await storage.claimNewestUnmentioned(now),
      await storage.claimNewestUnmentioned(now),
    ];

    expect(claimed.map((change) => change?.summary)).toEqual(['newest', 'middle', 'oldest', undefined]);
  });

  it('takes the one noted last when two were noted in the same instant', async () => {
    await storage.add({ summary: 'first', source: 'email' }, minutesBefore(1));
    await storage.add({ summary: 'second', source: 'email' }, minutesBefore(1));
    await storage.add({ summary: 'third', source: 'email' }, minutesBefore(1));

    const claimed = [
      await storage.claimNewestUnmentioned(now),
      await storage.claimNewestUnmentioned(now),
      await storage.claimNewestUnmentioned(now),
    ];

    expect(claimed.map((change) => change?.summary)).toEqual(['third', 'second', 'first']);
  });

  it('lets a change lapse after a day, told or not', async () => {
    const aDayAndAMinute = IMPORTANT_CHANGE_TTL_MS / 60_000 + 1;
    await storage.add({ summary: 'stale', source: 'weather' }, minutesBefore(aDayAndAMinute));

    expect(await storage.claimNewestUnmentioned(now)).toBeUndefined();
  });

  it('never hands one change to two polls arriving together', async () => {
    await storage.add({ summary: 'only once', source: 'calendar' }, minutesBefore(1));

    const claimed = await Promise.all([storage.claimNewestUnmentioned(now), storage.claimNewestUnmentioned(now)]);

    expect(claimed.filter((change) => change !== undefined).map((change) => change.summary)).toEqual(['only once']);
  });
});
