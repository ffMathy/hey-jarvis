/**
 * How sure the lattice should be that someone is speaking, from the microphone's level alone — for
 * the moments no `vad_score` can say so, because nothing is listening yet.
 *
 * On a phone and a watch the conversation is dialled only once the greeting is over, and the agent
 * starts sending scores only once it hears the microphone. Between the two, what sir says is kept
 * (`HeldVoice`), and the lattice has to answer it too, or he would be talking to a sphere that
 * looks as though it is not listening. So until the first score the session reads the kept
 * microphone's level instead, through this.
 *
 * It answers in the score's own units, so the drawing's threshold (`HEARING_THRESHOLD`, 0.25) and
 * its easing treat it exactly as they treat a score. It is a plain loudness gate, which is all a
 * level can be: nothing below `QUIET_DBFS`, sure by `SPEAKING_DBFS`, in decibels between — so the
 * threshold falls near -41 dBFS, above a quiet room and below a voice at arm's length.
 */

/** The level at and below which nobody is speaking, in dBFS. */
const QUIET_DBFS = -45;
/** The level at which someone certainly is, in dBFS. */
const SPEAKING_DBFS = -30;

/** A presence score, 0–1, from a microphone's RMS level, 0–1 of full scale. */
export function presenceFromMicrophoneLevel(level: number): number {
  if (!(level > 0)) {
    return 0;
  }
  const decibels = 20 * Math.log10(Math.min(1, level));
  return Math.min(1, Math.max(0, (decibels - QUIET_DBFS) / (SPEAKING_DBFS - QUIET_DBFS)));
}
