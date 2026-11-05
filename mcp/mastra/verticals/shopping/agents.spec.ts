/**
 * The shopping list agent's instructions, now that the household's aliases and preferences are a
 * page in Knowledge (`conventions:home#shopping`) rather than lines in the code.
 *
 * Each test reads them from a Knowledge instance on an in-memory store of its own, the way the
 * agent reads them from the shared one on every run.
 */

import { describe, expect, it } from 'bun:test';
import type { Knowledge } from '@mastra/core/knowledge';
import { InMemoryStore } from '@mastra/core/storage';
import { CONVENTIONS_SCOPE, createJarvisKnowledge, HOUSEHOLD_SCOPE } from '../../knowledge/index.js';
import { getShoppingListAgent, shoppingListAgentInstructions } from './agents.js';

/** The page's body as it is stored, which is what Studio shows and agents read. */
async function storedShoppingPage(knowledge: Knowledge) {
  const storage = await knowledge.getStorage();
  const [scope] = await storage.getScopesByAddress([CONVENTIONS_SCOPE]);
  const page = scope && (await storage.getPageByPath({ scopeId: scope.id, path: ['shopping'], read: 'all' }));
  if (!page) {
    throw new Error('The shopping conventions page was never written');
  }
  return page.body;
}

describe('shoppingListAgentInstructions', () => {
  it("gives the agent the household's aliases and preferences from their page", async () => {
    const knowledge = createJarvisKnowledge(new InMemoryStore());

    const instructions = await shoppingListAgentInstructions(knowledge);

    const page = await storedShoppingPage(knowledge);
    for (const convention of [
      '- **Soja** → Sojasauce',
      '- **Rødkål** → Rød spidskål',
      '- **Kyllingefillet** → Kyllingebrystfillet',
      '- **Soltørrede tomater i olie** → Soltørrede tomater',
      '- **Juice:** Avoid juice from concentrate.',
      '- **Milk:** Always use "skummetmælk" if available',
      '- **Cheese:** If asked to just buy cheese, buy solid cheese, but in slices.',
    ]) {
      expect(page).toContain(convention);
    }
    expect(instructions).toContain(`# Aliases, Variants & Synonyms
The products might be written in Danish.

- **Organic markers:** ØKO, Økologisk, Organic, Bio

The household's own aliases and preferences:

${page}`);
  });

  it('follows what the household has said since, after what the code says', async () => {
    const knowledge = createJarvisKnowledge(new InMemoryStore());
    await shoppingListAgentInstructions(knowledge);
    await knowledge.addNote({
      scope: CONVENTIONS_SCOPE,
      path: 'shopping',
      text: 'Buy letmælk instead of skummetmælk.',
      when: new Date('2026-11-04T09:00:00.000Z'),
    });

    const instructions = await shoppingListAgentInstructions(knowledge);

    expect(instructions).toContain(`${await storedShoppingPage(knowledge)}

What the household has said since, oldest first; where two disagree, the later one wins:
- 2026-11-04: Buy letmælk instead of skummetmælk.`);
  });

  it('tells the agent to add a lasting preference sir states as a note on the shopping page', async () => {
    const instructions = await shoppingListAgentInstructions(createJarvisKnowledge(new InMemoryStore()));

    expect(instructions).toContain(
      'add it as one note with knowledge_note: op "add", page "conventions:home#shopping", scope ["conventions:home"]',
    );
  });
});

describe('getShoppingListAgent', () => {
  it('reads its instructions from the Knowledge it holds, as the household it adds a note as', async () => {
    const knowledge = createJarvisKnowledge(new InMemoryStore());
    const agent = await getShoppingListAgent(async () => knowledge);
    await shoppingListAgentInstructions(knowledge);
    await knowledge.addNote({
      scope: CONVENTIONS_SCOPE,
      path: 'shopping',
      text: 'Buy letmælk instead of skummetmælk.',
      when: new Date('2026-11-04T09:00:00.000Z'),
    });

    const instructions = await agent.getInstructions();

    expect(instructions).toContain('- 2026-11-04: Buy letmælk instead of skummetmælk.');
    expect(agent.getKnowledge()).toBe(knowledge);
    expect(await agent.getScopes()).toEqual([HOUSEHOLD_SCOPE]);
  });
});
