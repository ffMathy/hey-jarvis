import { describe, expect, it } from 'bun:test';
import { Mastra } from '@mastra/core';
import { InMemoryStore } from '@mastra/core/storage';
import { createScriptedModel } from '../../tests/utils/scripted-model.js';
import { createAgent } from '../utils/agent-factory.js';
import { type Conventions, conventionsReference, readConventions } from './conventions.js';
import { CONVENTIONS_SCOPE, createJarvisKnowledge, householdKnowledgeOptions } from './index.js';

const pantry: Conventions = {
  key: 'pantry',
  name: 'Pantry',
  description: 'How the household keeps its pantry.',
  body: '- Keep two packets of pasta in stock.',
};

/** Jarvis's Knowledge on a store of its own, the way a process opens it on the shared file. */
function jarvisKnowledgeOn(storage = new InMemoryStore()) {
  return createJarvisKnowledge(storage);
}

describe('readConventions', () => {
  it('writes the conventions to their page, and reads them back as they are when nothing was added', async () => {
    const knowledge = jarvisKnowledgeOn();

    expect(await readConventions(knowledge, pantry)).toBe(pantry.body);

    const storage = await knowledge.getStorage();
    const [scope] = await storage.getScopesByAddress([CONVENTIONS_SCOPE]);
    const page = scope && (await storage.getPageByPath({ scopeId: scope.id, path: ['pantry'], read: 'all' }));
    expect(page?.name).toBe('Pantry');
    expect(page?.body).toBe(pantry.body);
  });

  it('adds what the household has said since, oldest first and dated', async () => {
    const knowledge = jarvisKnowledgeOn();
    await readConventions(knowledge, pantry);
    await knowledge.addNote({
      scope: CONVENTIONS_SCOPE,
      path: 'pantry',
      text: 'Keep rice in stock too.',
      when: new Date('2026-11-01T09:00:00.000Z'),
    });
    await knowledge.addNote({
      scope: CONVENTIONS_SCOPE,
      path: 'pantry',
      text: 'One packet of pasta is enough now.',
      when: new Date('2026-11-04T09:00:00.000Z'),
    });

    expect(await readConventions(knowledge, pantry)).toBe(
      `${pantry.body}

What the household has said since, oldest first; where two disagree, the later one wins:
- 2026-11-01: Keep rice in stock too.
- 2026-11-04: One packet of pasta is enough now.`,
    );
  });

  it("replaces the page's body when the code's conventions change, and keeps what the household added", async () => {
    const storage = new InMemoryStore();
    const before = jarvisKnowledgeOn(storage);
    await readConventions(before, pantry);
    await before.addNote({ scope: CONVENTIONS_SCOPE, path: 'pantry', text: 'Keep rice in stock too.' });

    // The next process starts with a new instance on the same store, and the new body.
    const changed = { ...pantry, body: '- Keep three packets of pasta in stock.' };
    const conventions = await readConventions(jarvisKnowledgeOn(storage), changed);

    expect(conventions).toStartWith(changed.body);
    expect(conventions).toContain('Keep rice in stock too.');
  });
});

describe('an agent holding the household', () => {
  it('adds a convention as a note on its page, and cannot rewrite the page', async () => {
    const knowledge = jarvisKnowledgeOn();
    await readConventions(knowledge, pantry);
    const { model, calls } = createScriptedModel(({ index }) => {
      if (index === 1) {
        return {
          toolCalls: [
            {
              toolName: 'knowledge_note',
              input: {
                op: 'add',
                page: conventionsReference(pantry),
                scope: [CONVENTIONS_SCOPE],
                text: 'Keep oat milk in stock.',
              },
            },
          ],
        };
      }
      if (index === 2) {
        return {
          toolCalls: [
            {
              toolName: 'knowledge_page',
              input: { op: 'write', page: conventionsReference(pantry), body: 'Buy whatever.' },
            },
          ],
        };
      }
      return { text: 'Noted, sir.' };
    });
    const agent = await createAgent({
      id: 'pantryKeeper',
      name: 'pantryKeeper',
      instructions: 'You keep the pantry.',
      model,
      memory: undefined,
      ...householdKnowledgeOptions(knowledge),
    });
    new Mastra({ agents: { pantryKeeper: agent } });

    await agent.generate('From now on, always keep oat milk in stock.');

    const [, rewrite] = calls[calls.length - 1]?.toolResults ?? [];
    expect(rewrite?.output).toEqual({
      type: 'error-text',
      value: `Editing a page needs editor on "${CONVENTIONS_SCOPE}"; this run has contributor there.`,
    });
    const conventions = await readConventions(knowledge, pantry);
    expect(conventions).toStartWith(pantry.body);
    expect(conventions).toContain('Keep oat milk in stock.');
  });
});
