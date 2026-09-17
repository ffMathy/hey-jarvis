import type { UsePreferredHeadset } from './platform-contracts';

/**
 * Nothing to do in a browser.
 *
 * Which device a page records from and plays to is the browser's and the operating system's
 * business, set in their own settings, and a page cannot move it — `setSinkId` can move output on
 * some browsers and there is no input equivalent at all. Nor should it: a site that reached in and
 * changed your audio device would be a site doing something wrong.
 */
export const usePreferredHeadset: UsePreferredHeadset = () => undefined;
