/**
 * The quietest a reading can be and still count as speech, in a browser.
 *
 * Twice the phone's, because a browser's volume is a different quantity: the mean of the
 * voice-range spectrum as Web Audio reports it, rather than the RMS of the last 40 ms. The same
 * room therefore reads higher here, and at the phone's floor the published page counted an empty
 * room as somebody talking — which is what the user saw, and what they asked for this number to
 * fix.
 */
export const QUIETEST_SPEECH_HERE = 0.2;
