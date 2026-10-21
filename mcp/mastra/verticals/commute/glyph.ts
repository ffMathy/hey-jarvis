import type { AgentGlyph } from '../agent-glyphs.js';

/** The commute agent on sir's devices, while a request has it at work: a map pin. See `../agent-glyphs.ts`. */
export const commuteGlyph = {
  agentId: 'commute',
  path: 'M 0.38 -0.22 A 0.38 0.38 0 1 0 -0.38 -0.22 A 0.38 0.38 0 1 0 0.38 -0.22 Z M -0.3 0.02 L 0 0.72 L 0.3 0.02',
} satisfies AgentGlyph;
