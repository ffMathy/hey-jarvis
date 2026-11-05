/**
 * The cooking agent's instructions as Mastra resolves them for a request, on Jarvis's Knowledge on a
 * store of its own. The household's dinner conventions are read on every request, so a convention
 * sir stated after the agent was built is in the next request's instructions, and so is how to add
 * the one after it.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { InMemoryStore } from '@mastra/core/storage';
import { conventionsReference } from '../../knowledge/conventions.js';
import { CONVENTIONS_SCOPE, createJarvisKnowledge, HOUSEHOLD_SCOPE } from '../../knowledge/index.js';
import { getCookingAgent } from './agents.js';
import { BABY_BIRTH_DATE_VARIABLE } from './baby-food.js';
import { cookingConventions } from './conventions.js';

/** The cooking agent on a Knowledge of its own, and that Knowledge. */
async function cookingAgentOnItsOwnKnowledge() {
  const knowledge = createJarvisKnowledge(new InMemoryStore());
  const agent = await getCookingAgent(async () => knowledge);
  return { agent, knowledge };
}

describe('getCookingAgent', () => {
  let savedBirthDate: string | undefined;

  // No baby, so the instructions are the same on every machine whatever its environment holds.
  beforeEach(() => {
    savedBirthDate = process.env[BABY_BIRTH_DATE_VARIABLE];
    delete process.env[BABY_BIRTH_DATE_VARIABLE];
  });

  afterEach(() => {
    if (savedBirthDate === undefined) {
      delete process.env[BABY_BIRTH_DATE_VARIABLE];
    } else {
      process.env[BABY_BIRTH_DATE_VARIABLE] = savedBirthDate;
    }
  });

  it("is told the household's dinner conventions on every request, with what the household has said since", async () => {
    const { agent, knowledge } = await cookingAgentOnItsOwnKnowledge();

    const before = await agent.getInstructions();
    await knowledge.addNote({
      scope: CONVENTIONS_SCOPE,
      path: cookingConventions.key,
      text: 'Leave mushrooms out of the dinners.',
      when: new Date('2026-11-03T18:00:00.000Z'),
    });
    const after = await agent.getInstructions();

    expect(before).toContain('Avoid weird soups, such as "burgersuppe", "tacosuppe" and "lasagnesuppe".');
    expect(before).not.toContain('mushrooms');
    expect(after).toContain(cookingConventions.body);
    expect(after).toContain('- 2026-11-03: Leave mushrooms out of the dinners.');
  });

  it('is told how to add a convention sir states, and holds the household it adds one as', async () => {
    const { agent, knowledge } = await cookingAgentOnItsOwnKnowledge();

    const instructions = await agent.getInstructions();

    expect(instructions).toContain(
      `knowledge_note: op "add", page "${conventionsReference(cookingConventions)}", scope ["${CONVENTIONS_SCOPE}"]`,
    );
    expect(agent.getKnowledge()).toBe(knowledge);
    expect(await agent.getScopes()).toEqual([HOUSEHOLD_SCOPE]);
  });
});
