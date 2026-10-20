import type { AgentGlyph } from '../agent-glyphs.js';

/** The weather agent on sir's devices, while a request has it at work: a sun. See `../agent-glyphs.ts`. */
export const weatherGlyph = {
  agentId: 'weather',
  path: 'M 0.42 0 A 0.42 0.42 0 1 0 -0.42 0 A 0.42 0.42 0 1 0 0.42 0 Z M 0.66 0 L 0.92 0 M 0.467 0.467 L 0.651 0.651 M 0 0.66 L 0 0.92 M -0.467 0.467 L -0.651 0.651 M -0.66 0 L -0.92 0 M -0.467 -0.467 L -0.651 -0.651 M -0 -0.66 L -0 -0.92 M 0.467 -0.467 L 0.651 -0.651',
} satisfies AgentGlyph;
