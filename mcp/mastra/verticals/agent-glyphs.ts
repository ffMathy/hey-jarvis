import { calendarGlyph } from './calendar/glyph.js';
import { codingGlyph } from './coding/glyph.js';
import { commuteGlyph } from './commute/glyph.js';
import { cookingGlyph } from './cooking/glyph.js';
import { emailGlyph } from './email/glyph.js';
import { internetOfThingsGlyph } from './internet-of-things/glyph.js';
import { reflectionGlyph } from './reflection/glyph.js';
import { shoppingListGlyph } from './shopping/glyph.js';
import { todoListGlyph } from './todo-list/glyph.js';
import { visionGlyph } from './vision/glyph.js';
import { visualizeGlyph } from './visualize/glyph.js';
import { weatherGlyph } from './weather/glyph.js';
import { webResearchGlyph } from './web-research/glyph.js';

/**
 * How each agent routing can send a request to is drawn on sir's devices while a request has it at
 * work: a satellite round Jarvis with its agent's glyph (see "Which agents are at work" in
 * `.claude/rules/mcp.md`). Each vertical draws its own, in its `glyph.ts`; this only gathers them, and
 * routing puts the glyph on every `agentActivity` it publishes, so a device draws whatever it is
 * sent and a new agent needs no change on any of them.
 *
 * **A glyph is an SVG path** in glyph radii — the glyph fits the circle of radius 1 round 0,0 — with
 * y pointing down, drawn as round-capped strokes 0.15 wide: closed shapes and lines, no fills. Only
 * the commands M, L, H, V, A, C, Q and Z, in absolute or relative form, and numbers; the devices
 * refuse anything else (`hologram`'s `agent-activity.ts`).
 *
 * These files import nothing but this type, so the headset's preview page can show every glyph
 * without the server (`vr/src/preview/satellites-panel.ts`).
 */
export interface AgentGlyph {
  /** The agent's id, as routing names it. */
  agentId: string;
  /** The glyph, as an SVG path. */
  path: string;
}

/** Every vertical's glyph. */
export const AGENT_GLYPHS: readonly AgentGlyph[] = [
  weatherGlyph,
  calendarGlyph,
  emailGlyph,
  internetOfThingsGlyph,
  shoppingListGlyph,
  todoListGlyph,
  codingGlyph,
  webResearchGlyph,
  cookingGlyph,
  commuteGlyph,
  reflectionGlyph,
  visualizeGlyph,
  visionGlyph,
];

/** The glyph `agentId` is drawn with, or `undefined` for an agent that has none. */
export function glyphOfAgent(agentId: string): string | undefined {
  return AGENT_GLYPHS.find((glyph) => glyph.agentId === agentId)?.path;
}
