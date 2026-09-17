/**
 * The one place colours and spacing are defined.
 *
 * Dark, because an assistant is summoned over whatever was already on screen and
 * often in the dark, and the least it can do is not be a flashlight.
 */
export const theme = {
  colors: {
    background: '#05070d',
    surface: '#101725',
    border: '#1e293b',
    text: '#e2e8f0',
    mutedText: '#94a3b8',
    accent: '#38bdf8',
    accentText: '#05070d',
    listening: '#38bdf8',
    speaking: '#a78bfa',
    danger: '#f87171',
    success: '#4ade80',
  },
  spacing: {
    small: 8,
    medium: 16,
    large: 24,
    huge: 40,
  },
  radius: {
    card: 16,
    button: 12,
  },
} as const;
