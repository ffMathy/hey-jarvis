import { describe, expect, test } from 'bun:test';
import { Mastra } from '@mastra/core';
import type { Agent } from '@mastra/core/agent';
import { InMemoryStore } from '@mastra/core/storage';
import { MastraServer } from '@mastra/hono';
import { KNOWLEDGE_ROUTES } from '@mastra/server/server-adapter';
import { Hono } from 'hono';
import { z } from 'zod';
import { createScriptedModel } from '../../tests/utils/scripted-model.js';
import { createAgent } from '../utils/agent-factory.js';
import { createJarvisKnowledge, HOUSEHOLD_SCOPE, householdKnowledgeOptions, JARVIS_KNOWLEDGE_KEY } from './index.js';

/** Jarvis's Knowledge on a store of its own in memory, standing in for the shared SQLite file. */
function inMemoryJarvisKnowledge() {
  const storage = new InMemoryStore();
  return { storage, knowledge: createJarvisKnowledge(storage) };
}

/**
 * Jarvis's Knowledge, registered the way `mastra/index.ts` registers it, on the same store as the
 * Mastra instance, and served through a real `MastraServer` the way Studio reaches it.
 */
async function servedKnowledge(jarvis = inMemoryJarvisKnowledge(), agents: Record<string, Agent> = {}) {
  const mastra = new Mastra({
    storage: jarvis.storage,
    agents,
    knowledge: { [JARVIS_KNOWLEDGE_KEY]: jarvis.knowledge },
    server: { apiRoutes: [...KNOWLEDGE_ROUTES] },
  });
  const app = new Hono();
  await new MastraServer({ app, mastra }).init();
  return { app, knowledge: jarvis.knowledge, mastra };
}

const instancesResponseSchema = z.object({ instances: z.array(z.object({ key: z.string(), id: z.string() })) });
const searchResponseSchema = z.object({ results: z.array(z.object({}).passthrough()) });

describe("Studio's Knowledge page", () => {
  test("finds Jarvis's Knowledge at /api/knowledge, under its key", async () => {
    const { app } = await servedKnowledge();

    const response = await app.request('/api/knowledge');

    expect(response.status).toBe(200);
    expect(instancesResponseSchema.parse(await response.json()).instances).toEqual([
      { key: JARVIS_KNOWLEDGE_KEY, id: JARVIS_KNOWLEDGE_KEY },
    ]);
  });

  test('searches the pages written to the household', async () => {
    const { app, knowledge } = await servedKnowledge();
    await knowledge.upsertPage({
      scope: HOUSEHOLD_SCOPE,
      path: 'cooking',
      name: 'Cooking',
      body: 'Dinners are planned for two people, three days per recipe.',
    });

    const response = await app.request(`/api/knowledge/${JARVIS_KNOWLEDGE_KEY}/search?q=Cooking`);

    expect(response.status).toBe(200);
    expect(JSON.stringify(searchResponseSchema.parse(await response.json()).results)).toContain('Cooking');
  });
});

describe('householdKnowledgeOptions', () => {
  test('lets an agent write to the household with its own Knowledge tools', async () => {
    const { model } = createScriptedModel(({ index }) => {
      if (index === 1) {
        return {
          toolCalls: [
            {
              toolName: 'knowledge_page',
              input: { op: 'write', scope: HOUSEHOLD_SCOPE, key: 'dinners', name: 'Dinners' },
            },
          ],
        };
      }
      if (index === 2) {
        return {
          toolCalls: [
            {
              toolName: 'knowledge_note',
              input: {
                op: 'add',
                page: `${HOUSEHOLD_SCOPE}#dinners`,
                scope: [HOUSEHOLD_SCOPE],
                text: 'Fish is served on Fridays.',
              },
            },
          ],
        };
      }
      return { text: 'Noted, sir.' };
    });
    const jarvis = inMemoryJarvisKnowledge();
    // Memory is left out, as the routing specs leave it out: the shared one wants real credentials.
    // A run then holds only the household, which is what this is about.
    const agent = await createAgent({
      id: 'householdWriter',
      name: 'householdWriter',
      instructions: 'You keep notes about the household.',
      model,
      memory: undefined,
      ...householdKnowledgeOptions(jarvis.knowledge),
    });
    const { app } = await servedKnowledge(jarvis, { householdWriter: agent });

    await agent.generate('Remember that we have fish on Fridays.');

    const response = await app.request(`/api/knowledge/${JARVIS_KNOWLEDGE_KEY}/search?q=Fridays`);
    expect(JSON.stringify(searchResponseSchema.parse(await response.json()).results)).toContain(
      'Fish is served on Fridays.',
    );
  });
});
