import type { ConfirmGlanceAction } from './platform-contracts';

/**
 * Asks sir with the browser's own `window.confirm`, which the glance's `<iframe>` cannot draw over
 * or answer for: the title, then the server's prompt.
 */
export const confirmGlanceAction: ConfirmGlanceAction = async ({ title, prompt }) =>
  window.confirm(`${title}\n\n${prompt}`);
