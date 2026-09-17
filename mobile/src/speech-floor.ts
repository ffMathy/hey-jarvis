import { QUIETEST_SPEECH } from 'hologram';

/**
 * The quietest a reading can be and still count as speech, on this platform's scale.
 *
 * On Android a volume is the RMS of the last 40 ms, which is what the tracker's own floor was
 * measured against — so on a phone this is simply that floor.
 */
export const QUIETEST_SPEECH_HERE = QUIETEST_SPEECH;
