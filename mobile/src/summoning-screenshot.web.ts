import type { ReadSummoningScreenshot } from './platform-contracts';

/** A browser is never summoned over anything, so there is never a screen to send. */
export const readSummoningScreenshot: ReadSummoningScreenshot = async () => undefined;
