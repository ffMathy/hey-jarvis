import { describe, expect, it } from 'bun:test';
import { z } from 'zod';
import { markAsAffectingEntities } from './affected-entities.js';
import { answerLookup, asFacts, createDirectLookup } from './direct-lookup-factory.js';
import { createTool } from './tool-factory.js';

describe('createDirectLookup', () => {
  it('keeps a lookup named after its agent', () => {
    const lookup = { id: 'weather.now', agentId: 'weather', description: 'Now', answer: async () => 'sunny' };

    expect(createDirectLookup(lookup)).toBe(lookup);
  });

  it("refuses a lookup that could collide with another agent's", () => {
    expect(() =>
      createDirectLookup({ id: 'now', agentId: 'weather', description: 'Now', answer: async () => 'sunny' }),
    ).toThrow('must be named "weather.<what>"');
  });
});

describe('answerLookup', () => {
  const shelfSchema = z.object({ shelf: z.object({ id: z.string(), name: z.string() }), books: z.array(z.string()) });

  /** A tool that reads a shelf, marked the way a vertical marks its own tools. */
  const readShelf = markAsAffectingEntities(
    createTool({
      id: 'directLookupSpecReadShelf',
      description: 'Reads the books on a shelf',
      inputSchema: z.object({ shelfId: z.string() }),
      outputSchema: shelfSchema,
      execute: async ({ shelfId }) => ({ shelf: { id: shelfId, name: `Shelf ${shelfId}` }, books: ['Dune'] }),
    }),
    (_toolArguments, toolResult) => [shelfSchema.parse(toolResult).shelf],
  );

  /** A tool nobody marked, which touches nothing as far as anyone is told. */
  const readTheNews = createTool({
    id: 'directLookupSpecReadTheNews',
    description: 'Reads the news',
    inputSchema: z.object({}),
    outputSchema: z.object({ headline: z.string() }),
    execute: async () => ({ headline: 'Nothing happened' }),
  });

  function lookup(answer: Parameters<typeof createDirectLookup>[0]['answer']) {
    return createDirectLookup({ id: 'library.shelf', agentId: 'library', description: 'The shelf', answer });
  }

  it("reports what its tool calls touched, read by the tools' own readers", async () => {
    const outcome = await answerLookup(
      lookup(async (callTool) => {
        const { books } = await callTool(readShelf, { shelfId: 'hall' });
        return asFacts({ books });
      }),
    );

    expect(outcome).toEqual({ text: '{"books":["Dune"]}', entities: [{ id: 'hall', name: 'Shelf hall' }] });
  });

  it('reports each thing once, however many calls touched it, and nothing for a tool nobody marked', async () => {
    const outcome = await answerLookup(
      lookup(async (callTool) => {
        await callTool(readShelf, { shelfId: 'hall' });
        await callTool(readTheNews, {});
        await callTool(readShelf, { shelfId: 'hall' });
        return 'facts';
      }),
    );

    expect(outcome?.entities).toEqual([{ id: 'hall', name: 'Shelf hall' }]);
  });

  // The request then goes to the agent, which reports what it touches itself: a glow for an answer
  // the lookup never gave would point sir at the wrong thing.
  it('reports nothing when it declines, whatever it read first', async () => {
    const outcome = await answerLookup(
      lookup(async (callTool) => {
        await callTool(readShelf, { shelfId: 'hall' });
        return undefined;
      }),
    );

    expect(outcome).toBeUndefined();
  });

  it('throws when it fails part way, so the agent can take over', async () => {
    await expect(
      answerLookup(
        lookup(async (callTool) => {
          await callTool(readShelf, { shelfId: 'hall' });
          throw new Error('The shelf fell over');
        }),
      ),
    ).rejects.toThrow('The shelf fell over');
  });
});

describe('asFacts', () => {
  it('writes facts compactly', () => {
    expect(asFacts({ tasks: [{ title: 'Milk' }] })).toBe('{"tasks":[{"title":"Milk"}]}');
  });
});
