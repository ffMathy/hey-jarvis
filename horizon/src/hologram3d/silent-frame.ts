import { type HologramFrame, MATERIALISE_SECONDS, VOICE_BAND_COUNT } from 'hologram';

/** No voice in any band. Shared, because nothing that reads a frame writes to it. */
const SILENT_BANDS: number[] = new Array(VOICE_BAND_COUNT).fill(0);

/**
 * Jarvis `time` seconds after he was summoned, with nobody talking.
 *
 * He arrives the way he does on the phone — the vortex out of his core over MATERIALISE_SECONDS
 * — and then idles: no voice, no burst, no thought, nobody heard. Every particle is drawn
 * (density 1); the headset's frame budget is steered elsewhere, not by thinning him.
 */
export function silentFrame(time: number): HologramFrame {
  return {
    time,
    level: 0,
    bands: SILENT_BANDS,
    speaking: false,
    agitation: 0,
    burstAge: 10,
    burstStrength: 0,
    burstCount: 0,
    appearance: Math.min(1, time / MATERIALISE_SECONDS),
    density: 1,
    presence: 1,
    thinking: 0,
  };
}
