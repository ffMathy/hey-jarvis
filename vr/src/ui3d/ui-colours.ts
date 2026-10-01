/**
 * The colours of everything the headset app shows besides Jarvis himself, in the room and on the
 * 2D page alike.
 *
 * The phone's (`mobile/src/theme.ts`), copied rather than imported — an app cannot import another
 * app — so that the three places someone meets Jarvis's words look like one product. The page's
 * stylesheet in `index.html` names the same values as CSS variables.
 */
export const UI_COLOURS = {
  background: '#05070d',
  surface: '#101725',
  border: '#1e293b',
  text: '#e2e8f0',
  mutedText: '#94a3b8',
  accent: '#38bdf8',
  danger: '#f87171',
  success: '#4ade80',
} as const;
