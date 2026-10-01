import { describe, expect, it } from 'bun:test';
import { fillSimulatedSpectrum, SAMPLE_MODES, SILENT_VOICE, simulatedUserAt } from 'hologram';
import { createSampleDriver } from './sample-driver';

function clock(start = 5000) {
  let time = start;
  return {
    now: () => time,
    advance(milliseconds: number) {
      time += milliseconds;
    },
  };
}

function sum(values: ArrayLike<number>) {
  return Array.from(values).reduce((total, value) => total + value, 0);
}

describe('createSampleDriver', () => {
  it('is silent until a mood is chosen, and again once stopped', () => {
    const driver = createSampleDriver(clock().now);
    expect(driver.mode).toBeUndefined();
    expect(driver.drive()).toEqual({ voice: SILENT_VOICE, user: undefined, thinking: false });
    driver.setMode('speaking');
    driver.stop();
    expect(driver.drive().voice).toBe(SILENT_VOICE);
  });

  it('speaks with the greeting’s voice, from the start of it', () => {
    const time = clock();
    const driver = createSampleDriver(time.now);
    driver.setMode('speaking');
    time.advance(700);
    const drive = driver.drive();
    expect(drive.voice.speaking).toBe(true);
    expect(drive.user).toBeUndefined();
    expect(drive.thinking).toBe(false);
    const expected = fillSimulatedSpectrum('greeting', 0.7, new Uint8Array(drive.voice.getSpectrum().length));
    expect(Array.from(drive.voice.getSpectrum())).toEqual(Array.from(expected));
    expect(drive.voice.getVolume()).toBeGreaterThan(0);
  });

  it('listens to a made-up person while staying silent himself', () => {
    const time = clock();
    const driver = createSampleDriver(time.now);
    driver.setMode('listening');
    time.advance(1000);
    const drive = driver.drive();
    expect(drive.voice).toBe(SILENT_VOICE);
    expect(drive.user?.getPresence()).toBe(simulatedUserAt(1).presence);
    expect(drive.user?.getVolume()).toBe(simulatedUserAt(1).volume);
  });

  it('thinks with the hum of a mind working', () => {
    const time = clock();
    const driver = createSampleDriver(time.now);
    driver.setMode('thinking');
    time.advance(400);
    const drive = driver.drive();
    expect(drive.thinking).toBe(true);
    expect(sum(drive.voice.getSpectrum())).toBeGreaterThanOrEqual(0);
    expect(drive.voice.listening).toBe(true);
  });

  it('idles in silence', () => {
    const driver = createSampleDriver(clock().now);
    driver.setMode('idle');
    expect(driver.drive()).toEqual({ voice: SILENT_VOICE, user: undefined, thinking: false });
  });

  it('starts each mood again from its beginning', () => {
    const time = clock();
    const driver = createSampleDriver(time.now);
    driver.setMode('listening');
    time.advance(3000);
    driver.setMode('listening');
    expect(driver.drive().user?.getPresence()).toBe(simulatedUserAt(0).presence);
  });

  it('can show every mood there is', () => {
    const driver = createSampleDriver(clock().now);
    for (const mode of SAMPLE_MODES) {
      driver.setMode(mode);
      expect(driver.mode).toBe(mode);
    }
  });
});
