import { describe, expect, it } from 'bun:test';
import { AGENT_GLYPHS } from '../agent-glyphs.js';
import { getPublicAgents } from '../index.js';

/**
 * Every agent routing can send a request to is drawn on sir's devices with a glyph its vertical
 * declares (`verticals/agent-glyphs.ts`), sent on every `agentActivity`. An agent without one still
 * shows, as a plain ring, so nothing would fail if a new agent were added and its glyph forgotten —
 * which is why this does.
 */

/** What the devices accept as a glyph (`hologram`'s `agent-activity.ts`): these commands and numbers. */
const DRAWABLE_PATH = /^[MmLlHhVvAaCcQqZz0-9.,\s-]+$/;

/** The longest glyph the devices take. */
const LONGEST_GLYPH = 1000;

describe('the glyph each agent is drawn with on sir’s devices', () => {
  it('exists for every agent routing can send a request to, and for no other', async () => {
    const routable = (await getPublicAgents()).map((agent) => agent.id).sort();

    expect(AGENT_GLYPHS.map((glyph) => glyph.agentId).sort()).toEqual(routable);
  });

  it('is never shared by two agents', () => {
    const paths = AGENT_GLYPHS.map((glyph) => glyph.path);

    expect(new Set(paths).size).toBe(paths.length);
  });

  it('is a path the devices will draw: their commands only, and not too long', () => {
    for (const { agentId, path } of AGENT_GLYPHS) {
      expect({ agentId, drawable: DRAWABLE_PATH.test(path) }).toEqual({ agentId, drawable: true });
      expect(path.length).toBeLessThanOrEqual(LONGEST_GLYPH);
    }
  });

  it('fits the circle of radius 1 it is drawn in', () => {
    for (const { agentId, path } of AGENT_GLYPHS) {
      const coordinates = (path.match(/-?\d*\.?\d+/g) ?? []).map(Number);
      // An arc's flags and rotation are numbers too, and all of them are 0 or 1 here.
      const largest = Math.max(...coordinates.map(Math.abs));
      expect({ agentId, fits: largest <= 1 }).toEqual({ agentId, fits: true });
    }
  });
});
