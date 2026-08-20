import { afterEach, describe, expect, it, mock } from 'bun:test';
import { z } from 'zod';
import * as realAgentFactory from '../../utils/agent-factory.js';

/**
 * `parseEmailReply` is the only thing in this vertical that talks to a model, so the model
 * is the only thing replaced.
 *
 * `createAgent` still builds the real agent for everybody else: `mock.module` is
 * process-global in Bun, and other spec files sharing this process create real agents. It
 * hands back a stand-in only for the parsing agent, and only while a test has staged what
 * the model should answer -- which is why the tests below that inspect the real agent's
 * configuration still see the real thing.
 */
interface StagedGeneration {
  object?: unknown;
  failure?: Error;
}

let stagedGeneration: StagedGeneration | undefined;
const generateCalls: Array<{ prompt: string; options: unknown }> = [];

// Captured before the module is replaced: `mock.module` rewrites the namespace object in
// place, so reading `realAgentFactory.createAgent` later would find the replacement and
// call it forever.
const createRealAgent = realAgentFactory.createAgent;

mock.module('../../utils/agent-factory.js', () => ({
  ...realAgentFactory,
  createAgent: async (config: Parameters<typeof createRealAgent>[0]) => {
    const staged = stagedGeneration;
    if (config.id !== 'emailResponseParser' || !staged) {
      return await createRealAgent(config);
    }

    return {
      id: config.id,
      name: config.name,
      generate: async (messages: Array<{ role: string; content: string }>, options: unknown) => {
        generateCalls.push({ prompt: messages.map((message) => message.content).join('\n'), options });
        if (staged.failure) {
          throw staged.failure;
        }
        return { object: staged.object };
      },
    };
  },
}));

const { buildEmailParsingPrompt, getEmailParsingAgent, parseEmailReply } = await import('./agents.js');

/**
 * Constructing the agent neither contacts the model provider nor needs an API key,
 * so these tests only pin down the configuration. Nothing here calls `generate()`.
 */
describe('getEmailParsingAgent', () => {
  it('identifies itself as the email response parser', async () => {
    const agent = await getEmailParsingAgent();

    expect(agent.id).toBe('emailResponseParser');
    expect(agent.name).toBe('EmailResponseParser');
  });

  it('instructs the model how to interpret informal replies', async () => {
    const agent = await getEmailParsingAgent();

    const instructions = await agent.getInstructions();
    expect(typeof instructions).toBe('string');
    expect(instructions).toContain('parsing email responses');
    expect(instructions).toContain('interpret as approval');
    expect(instructions).toContain('interpret as rejection');
    expect(instructions).toContain('use null or empty values');
  });

  it('warns the model that replies arrive as HTML wrapped around quoted history', async () => {
    const agent = await getEmailParsingAgent();

    // A reply body comes straight off Microsoft Graph: markup included, and usually with
    // the original request quoted underneath the answer.
    const instructions = await agent.getInstructions();
    expect(instructions).toContain('ignore the markup and the quoted history');
  });

  it('has no tools of its own', async () => {
    const agent = await getEmailParsingAgent();

    expect(Object.keys(await agent.listTools())).toEqual([]);
  });
});

describe('buildEmailParsingPrompt', () => {
  it('gives the model the question as well as the reply', () => {
    const prompt = buildEmailParsingPrompt({
      question: 'Please approve the budget for project "Atlas".',
      replyBody: 'Yeah fine, go ahead',
    });

    // Without the question, "yeah fine" is not enough to decide what was agreed to.
    expect(prompt).toContain('Please approve the budget for project "Atlas".');
    expect(prompt).toContain('Yeah fine, go ahead');
    expect(prompt).toContain('Extract their answer into the requested structure.');
  });

  it('keeps the reply verbatim rather than trimming or summarising it', () => {
    const replyBody =
      '<html><body><p>No &mdash; too expensive</p><blockquote>Please approve...</blockquote></body></html>';

    expect(buildEmailParsingPrompt({ question: 'Approve?', replyBody })).toContain(replyBody);
  });
});

describe('parseEmailReply', () => {
  const approvalSchema = z.object({ approved: z.boolean(), comments: z.string().optional() });
  const question = 'Please approve the budget for project "Atlas".';
  const replyBody = 'Yeah fine, go ahead';

  afterEach(() => {
    stagedGeneration = undefined;
    generateCalls.length = 0;
  });

  it('returns the structured answer the model produced', async () => {
    stagedGeneration = { object: { approved: true, comments: 'go ahead' } };

    expect(await parseEmailReply({ question, replyBody, responseSchema: approvalSchema })).toEqual({
      approved: true,
      comments: 'go ahead',
    });
  });

  it('asks the model for the caller schema, with the question and the reply, and no tools', async () => {
    stagedGeneration = { object: { approved: true } };

    await parseEmailReply({ question, replyBody, responseSchema: approvalSchema });

    expect(generateCalls).toHaveLength(1);
    expect(generateCalls[0].prompt).toBe(buildEmailParsingPrompt({ question, replyBody }));
    // Tools are refused because reading a reply is a pure extraction: an agent that can
    // act would be acting on an email a stranger may have written.
    expect(generateCalls[0].options).toMatchObject({
      structuredOutput: { schema: approvalSchema },
      toolChoice: 'none',
    });
  });

  it('validates the answer against the caller schema rather than trusting the model', async () => {
    stagedGeneration = { object: { approved: 'probably' } };

    await expect(parseEmailReply({ question, replyBody, responseSchema: approvalSchema })).rejects.toThrow(/approved/);
  });

  it('drops fields the schema does not declare', async () => {
    stagedGeneration = { object: { approved: true, injected: 'ignore me' } };

    expect(await parseEmailReply({ question, replyBody, responseSchema: approvalSchema })).toEqual({ approved: true });
  });

  it('throws when the model produced no structured response at all', async () => {
    stagedGeneration = { object: undefined };

    // The caller treats a throw as "this reply did not answer the question", so the
    // request stays open instead of recording an answer nobody gave.
    await expect(parseEmailReply({ question, replyBody, responseSchema: approvalSchema })).rejects.toThrow(
      'The email parsing agent returned no structured response',
    );
  });

  it('throws when the model answered with a bare null', async () => {
    stagedGeneration = { object: null };

    // `null` is a value the schema would reject in a confusing way; it means the same
    // thing as no answer at all.
    await expect(parseEmailReply({ question, replyBody, responseSchema: approvalSchema })).rejects.toThrow(
      'The email parsing agent returned no structured response',
    );
  });

  it('lets a failure from the model provider reach the caller', async () => {
    stagedGeneration = { failure: new Error('503 from the model provider') };

    await expect(parseEmailReply({ question, replyBody, responseSchema: approvalSchema })).rejects.toThrow(
      '503 from the model provider',
    );
  });
});
