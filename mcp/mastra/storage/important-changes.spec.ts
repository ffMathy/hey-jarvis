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

    const first = await storage.claimUnmentioned(3, now);
    const second = await storage.claimUnmentioned(3, now);

    expect(first.map((change) => change.summary)).toEqual(['Your parcel arrives at 14:00.']);
    expect(first[0]?.source).toBe('email');
    expect(second).toEqual([]);
  });

  it('hands over the newest first, and keeps what is past the limit for the next request', async () => {
    await storage.add({ summary: 'oldest', source: 'email' }, minutesBefore(30));
    await storage.add({ summary: 'newest', source: 'email' }, minutesBefore(10));
    await storage.add({ summary: 'middle', source: 'email' }, minutesBefore(20));

    const first = await storage.claimUnmentioned(2, now);
    const second = await storage.claimUnmentioned(2, now);

    expect(first.map((change) => change.summary)).toEqual(['newest', 'middle']);
    expect(second.map((change) => change.summary)).toEqual(['oldest']);
  });

  it('lets a change lapse after a day, told or not', async () => {
    const aDayAndAMinute = IMPORTANT_CHANGE_TTL_MS / 60_000 + 1;
    await storage.add({ summary: 'stale', source: 'weather' }, minutesBefore(aDayAndAMinute));
    await storage.add({ summary: 'fresh', source: 'weather' }, minutesBefore(60));

    const claimed = await storage.claimUnmentioned(3, now);

    expect(claimed.map((change) => change.summary)).toEqual(['fresh']);
  });

  it('never hands one change to two requests arriving together', async () => {
    await storage.add({ summary: 'only once', source: 'calendar' }, minutesBefore(1));

    const [first, second] = await Promise.all([storage.claimUnmentioned(3, now), storage.claimUnmentioned(3, now)]);

    expect([...first, ...second].map((change) => change.summary)).toEqual(['only once']);
  });
});
