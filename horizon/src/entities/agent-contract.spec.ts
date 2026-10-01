import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { HEADSET_DEVICE_CONTEXT } from '../conversation/headset-session';
import { NOT_POINTING_TEXT, POINTING_CONTEXT_ID, pointingText } from './pointing';

/**
 * What the headset says to the agent, held to what the agent is taught to hear — across packages,
 * read as text.
 *
 * Three packages share a few sentences and nothing enforces them: the headset sends them
 * (`HEADSET_DEVICE_CONTEXT`, `pointing.ts`), the ElevenLabs agent's prompt quotes them and teaches
 * the voice model what to write when sir says "that", and the MCP server's routing workflow and
 * planner describe the same form to the models on their side. An app imports nothing from another
 * package, so each copies what it needs, and a sentence reworded in one place would leave the
 * others waiting for words that never come — the agent would never mark anything, or never
 * understand what "that" means — with every package's own tests still passing. This reads the other
 * packages' files as they are and fails when they drift.
 */

const ROOT = path.join(import.meta.dir, '../../..');

function read(relative: string): string {
  return readFileSync(path.join(ROOT, relative), 'utf8');
}

const PROMPT = read('elevenlabs/src/assets/agent-prompt.md');
const ELEVENLABS_HEADSET = read('elevenlabs/tests/utils/headset.ts');
const ROUTING_WORKFLOWS = read('mcp/mastra/verticals/routing/workflows.ts');
const ROUTING_PLANNER = read('mcp/mastra/verticals/routing/planner.ts');

/** A pointing update as the headset writes it: `Sir is pointing at "<name>" (<id>).` */
const POINTING_UPDATE = /Sir is pointing at "([^"]+)" \(([^)\s]+)\)\./;

/** What the voice model is to add to a request about what sir points at: `(pointing at "<name>", id <id>)`. */
const POINTED_REQUEST = /\(pointing at "([^"]+)", id ([^)\s]+)\)/;

function match(text: string, pattern: RegExp, where: string): RegExpMatchArray {
  const found = text.match(pattern);
  if (found === null) throw new Error(`${where} has nothing of the form ${pattern}.`);
  return found;
}

describe('the device context', () => {
  it('is quoted word for word in the prompt that gates markAffected on it', () => {
    expect(PROMPT).toContain(`"${HEADSET_DEVICE_CONTEXT}"`);
  });

  it('is the sentence the ElevenLabs evals send as the headset', () => {
    expect(ELEVENLABS_HEADSET).toContain(JSON.stringify(HEADSET_DEVICE_CONTEXT));
  });
});

describe('what sir points at', () => {
  it('reaches the agent in the form the prompt shows it', () => {
    const [example, name, id] = match(PROMPT, POINTING_UPDATE, 'The prompt');
    expect(pointingText({ id: id ?? '', name: name ?? '' })).toBe(example);
  });

  it('is sent under the context id, and cleared with the sentence, that the evals use', () => {
    expect(ELEVENLABS_HEADSET).toContain(`POINTING_CONTEXT_ID = '${POINTING_CONTEXT_ID}'`);
    expect(ELEVENLABS_HEADSET).toContain(`NOT_POINTING_CONTEXT = '${NOT_POINTING_TEXT}'`);
    // The evals' template for the same update, which has to write what pointingText writes.
    expect(ELEVENLABS_HEADSET).toMatch(/`Sir is pointing at "\$\{entity\.name\}" \(\$\{entity\.id\}\)\.`/);
    // The prompt's own words for the clearing sentence.
    expect(NOT_POINTING_TEXT).toContain('not pointing at anything');
    expect(PROMPT).toContain('not pointing at anything');
  });

  it('is written into the request with the name and the very id the update gave', () => {
    const [, updateName, updateId] = match(PROMPT, POINTING_UPDATE, 'The prompt');
    const [, requestName, requestId] = match(PROMPT, POINTED_REQUEST, 'The prompt');
    expect(requestName).toBe(updateName);
    expect(requestId).toBe(updateId);
  });

  it('is what the routing workflow and the planner tell their models to expect', () => {
    for (const [where, text] of [
      ['The routing workflow', ROUTING_WORKFLOWS],
      ['The routing planner', ROUTING_PLANNER],
    ] as const) {
      const [, name, id] = match(text, POINTED_REQUEST, where);
      // Any entity will do as the example, as long as it is written the same way.
      expect(name?.length).toBeGreaterThan(0);
      expect(id).toMatch(/^[^\s"()]+$/);
    }
  });
});
