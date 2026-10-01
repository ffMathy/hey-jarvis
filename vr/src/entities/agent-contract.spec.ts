import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * What sir points at, from the headset to the agent that acts on it — across packages, read as
 * text.
 *
 * The headset only says which entity he points at (`pointing.ts`, through `hologram`'s line to the
 * server). The MCP server keeps it and writes it into every routed request itself
 * (`mcp/mastra/utils/pointing.ts`), and the routing planner is taught to read that very form and
 * copy the id into the acting agent's prompt. If the form the server writes and the form the
 * planner is taught drift apart, pointing quietly stops meaning anything — "turn that on" goes back
 * to a guess — with every package's own tests still passing. This reads both as they are and fails
 * when they drift.
 */

const ROOT = path.join(import.meta.dir, '../../..');

function read(relative: string): string {
  return readFileSync(path.join(ROOT, relative), 'utf8');
}

const SERVER_POINTING = read('mcp/mastra/utils/pointing.ts');
const ROUTING_PLANNER = read('mcp/mastra/verticals/routing/planner.ts');

/** What the planner is taught to read in a request about what sir points at: `(pointing at "<name>", id <id>)`. */
const POINTED_REQUEST = /\(pointing at "([^"]+)", id ([^)\s]+)\)/;

describe('what sir points at', () => {
  it('is written into a routed request in the form the planner is taught to read', () => {
    // The server's template: a quoted name and a comma when there is a name, then the id.
    expect(SERVER_POINTING).toMatch(/const name = pointed\.name === undefined \? '' : `"\$\{pointed\.name\}", `;/);
    expect(SERVER_POINTING).toMatch(/\(pointing at \$\{name\}id \$\{pointed\.id\}\)/);

    // The planner's example, written the same way: a quoted name, a comma, then an id with no
    // spaces, quotes or brackets in it.
    const [, name, id] = ROUTING_PLANNER.match(POINTED_REQUEST) ?? [];
    expect(name?.length).toBeGreaterThan(0);
    expect(id).toMatch(/^[^\s"()]+$/);
  });
});
