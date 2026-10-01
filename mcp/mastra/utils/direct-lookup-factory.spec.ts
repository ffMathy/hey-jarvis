import { describe, expect, it } from 'bun:test';
import { asFacts, createDirectLookup } from './direct-lookup-factory.js';

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

describe('asFacts', () => {
  it('writes facts compactly', () => {
    expect(asFacts({ tasks: [{ title: 'Milk' }] })).toBe('{"tasks":[{"title":"Milk"}]}');
  });
});
