import {
  createGreetingReaders,
  createSimulatedSpectrum,
  fillSimulatedSpectrum,
  type JarvisVoice,
  SILENT_VOICE,
  type SimulatedMood,
  simulatedUserAt,
  simulatedVolume,
  type UserVoice,
} from 'hologram';
import type { HologramDrive } from '../hologram3d';
import type { PreviewPhase } from './preview-hook';

/** How a phase is shown: whether it starts a fresh arrival, and what drives him through it. */
export interface PhaseDrive {
  /** Whether the phase begins with him arriving — summoned — rather than already here. */
  arrives: boolean;
  drive: HologramDrive;
}

/**
 * How long he is left to settle before a phase that does not begin with an arrival: the vortex
 * (1.4 s) and a little of him idling, so what is seen is the phase and not the end of the arrival.
 */
export const SETTLE_SECONDS = 2;

/** A voice made up from the clock, in a sample-mode mood, `secondsIntoPhase` into it. */
function simulatedVoice(mood: SimulatedMood, secondsIntoPhase: () => number): JarvisVoice {
  const spectrum = createSimulatedSpectrum();
  const read = () => fillSimulatedSpectrum(mood, secondsIntoPhase(), spectrum);
  return {
    listening: true,
    speaking: mood !== 'thinking',
    getSpectrum: read,
    getVolume: () => simulatedVolume(read()),
  };
}

/**
 * What drives him through each phase, from the sources the phone's sample mode uses: the
 * greeting's own measurement as it plays from his arrival, the simulated voice speaking, someone
 * simulated talking to him, the hum of a thought with the thinking flag up, silence, and silence
 * with the leaving flag up.
 *
 * Every voice reads `secondsIntoPhase`, so the same second always sounds the same, and each is made
 * once: the frame clock reads a voice at once whenever it is handed a different one.
 */
export function createPhaseDrives(secondsIntoPhase: () => number): Record<PreviewPhase, PhaseDrive> {
  const greeting: JarvisVoice = {
    listening: true,
    speaking: true,
    ...createGreetingReaders(secondsIntoPhase),
  };
  const someone: UserVoice = {
    getPresence: () => simulatedUserAt(secondsIntoPhase()).presence,
    getVolume: () => simulatedUserAt(secondsIntoPhase()).volume,
  };
  const quiet = { voice: SILENT_VOICE, thinking: false, leaving: false };
  return {
    arriving: { arrives: true, drive: quiet },
    greeting: { arrives: true, drive: { ...quiet, voice: greeting } },
    speaking: { arrives: false, drive: { ...quiet, voice: simulatedVoice('speaking', secondsIntoPhase) } },
    listening: { arrives: false, drive: { ...quiet, user: someone } },
    thinking: {
      arrives: false,
      drive: { ...quiet, voice: simulatedVoice('thinking', secondsIntoPhase), thinking: true },
    },
    idle: { arrives: false, drive: quiet },
    leaving: { arrives: false, drive: { ...quiet, leaving: true } },
  };
}
