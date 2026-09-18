import { QUIETEST_SPEECH } from 'hologram';

/**
 * The quietest a reading can be and still count as speech, in a browser.
 *
 * The phone's, because a browser now measures the same quantity. It was twice this while the
 * readings came from the ElevenLabs SDK, whose volume is the mean of the voice-range spectrum on
 * an `AnalyserNode`'s −100 dB scale rather than an amplitude: the same silence read far higher
 * here than on a phone, and the published page counted an empty room as somebody talking. Doubling
 * the floor covered that, and covering it was all it did — the two numbers still meant different
 * things, and a floor that means something different on every surface cannot be reasoned about.
 *
 * `jarvis-voice.web.ts` reads the samples the browser is playing and puts them through the same
 * analysis the phone uses, so an RMS is an RMS on both and there is one floor again.
 */
export const QUIETEST_SPEECH_HERE = QUIETEST_SPEECH;
