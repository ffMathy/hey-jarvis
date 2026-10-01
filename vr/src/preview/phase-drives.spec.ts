import { describe, expect, it } from 'bun:test';
import {
  createGreetingReaders,
  createSimulatedSpectrum,
  fillSimulatedSpectrum,
  SILENT_VOICE,
  simulatedUserAt,
  simulatedVolume,
} from 'hologram';
import { createPhaseDrives } from './phase-drives';
import { PREVIEW_PHASES } from './preview-hook';

describe('what drives him through each phase', () => {
  let seconds = 0;
  const drives = createPhaseDrives(() => seconds);

  it('covers every phase, and only the arrival and the greeting begin with him arriving', () => {
    expect(Object.keys(drives).sort()).toEqual([...PREVIEW_PHASES].sort());
    const arriving = PREVIEW_PHASES.filter((phase) => drives[phase].arrives);
    expect(arriving).toEqual(['arriving', 'greeting']);
  });

  it('greets with the greeting’s own measurement, at the second the phase has reached', () => {
    seconds = 0.9;
    const measured = createGreetingReaders(() => 0.9);
    const { voice } = drives.greeting.drive;
    expect(voice.listening && voice.speaking).toBe(true);
    expect(voice.getVolume()).toBe(measured.getVolume());
    expect(Array.from(voice.getSpectrum())).toEqual(Array.from(measured.getSpectrum()));
  });

  it('speaks with the simulated voice, and thinks with its hum and the thinking flag up', () => {
    seconds = 4;
    const spectrum = fillSimulatedSpectrum('speaking', 4, createSimulatedSpectrum());
    expect(drives.speaking.drive.voice.getVolume()).toBe(simulatedVolume(spectrum));
    expect(drives.thinking.drive.thinking).toBe(true);
    expect(drives.thinking.drive.voice.speaking).toBe(false);
    expect(drives.thinking.drive.voice.getVolume()).toBeLessThan(0.01);
  });

  it('listens to someone simulated talking to him, silent himself', () => {
    seconds = 1.2;
    const { user, voice } = drives.listening.drive;
    expect(voice).toBe(SILENT_VOICE);
    expect(user?.getPresence()).toBe(simulatedUserAt(1.2).presence);
    expect(user?.getVolume()).toBe(simulatedUserAt(1.2).volume);
  });

  it('idles in silence and leaves with the leaving flag up', () => {
    expect(drives.idle.drive).toEqual({ voice: SILENT_VOICE, thinking: false, leaving: false });
    expect(drives.leaving.drive.leaving).toBe(true);
  });

  it('hands the same voice every time, since a new one is read at once', () => {
    expect(drives.speaking.drive.voice).toBe(drives.speaking.drive.voice);
    expect(createPhaseDrives(() => 0).speaking.drive.voice).not.toBe(drives.speaking.drive.voice);
  });
});
