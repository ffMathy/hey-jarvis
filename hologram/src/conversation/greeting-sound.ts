/// <reference path="../audio-assets.d.ts" />
import greeting from '../../assets/greeting.mp3';

/**
 * Jarvis saying "Hello sir, how can I help?" — the recording the voice firmware greets with
 * (`home-assistant-voice-firmware/sounds/greetings_how_can_I_help.mp3`), bundled by each app that
 * imports this.
 *
 * On its own so that the one line which needs a bundler to mean anything is somewhere a test never
 * reaches: under `bun test` an `.mp3` is not a module at all.
 */
export const GREETING_SOUND = greeting;
