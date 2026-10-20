import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { getPublicAgents } from '../index.js';

/**
 * Every agent routing can send a request to has a glyph of its own on sir's devices — across
 * packages, read as text.
 *
 * Routing tells the devices which agents a request is using (`agentActivity`, see "Which agents are
 * at work" in `mcp/AGENTS.md`), and the headset and the phone draw each as a satellite with its
 * agent's glyph, from `GLYPH_BY_AGENT` in `hologram/src/agent-work.ts`. An agent missing from that
 * table still shows, as a plain ring, so nothing fails when one is added here and forgotten there —
 * which is why this reads the table as it is and fails instead.
 */

const AGENT_WORK = readFileSync(path.join(import.meta.dir, '../../../../hologram/src/agent-work.ts'), 'utf8');

/** The table's entries, `agentId: glyph`, as written. */
function glyphTable(): Map<string, number> {
  const [, body = ''] = AGENT_WORK.match(/export const GLYPH_BY_AGENT[^=]*= \{([^}]*)\}/) ?? [];
  return new Map([...body.matchAll(/(\w+): (\d+),/g)].map(([, agentId = '', glyph = '']) => [agentId, Number(glyph)]));
}

describe('the glyph each agent is drawn with on sir’s devices', () => {
  it('exists for every agent routing can send a request to', async () => {
    const table = glyphTable();
    const missing = (await getPublicAgents()).map((agent) => agent.id).filter((agentId) => !table.has(agentId));

    expect(table.size).toBeGreaterThan(0);
    expect(missing).toEqual([]);
  });

  it('is never shared by two agents', () => {
    const glyphs = [...glyphTable().values()];

    expect(new Set(glyphs).size).toBe(glyphs.length);
  });
});
