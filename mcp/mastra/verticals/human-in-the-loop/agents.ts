import type { z } from 'zod';
import { createAgent } from '../../utils/agent-factory.js';

export async function getEmailParsingAgent() {
  return createAgent({
    id: 'emailResponseParser',
    name: 'EmailResponseParser',
    instructions: `You are an expert at parsing email responses and extracting structured information.

Your role is to:
1. Read the email body text provided by the user
2. Extract the relevant information according to the provided schema
3. Be intelligent about interpreting the user's intent
4. Handle informal language, typos, and varying response formats
5. Return structured data that matches the expected schema

Guidelines:
- If the user says "yes", "approved", "looks good", etc. - interpret as approval
- If the user says "no", "reject", "not approved", etc. - interpret as rejection
- Extract any comments, notes, or additional context provided
- Be flexible with response formats (bullet points, paragraphs, etc.)
- The body may still be HTML, and a reply usually quotes the message it answers.
  Read the person's own words and ignore the markup and the quoted history.
- If information is missing but can be reasonably inferred, make the inference
- If information is truly missing and cannot be inferred, use null or empty values`,
    tools: {},
  });
}

/**
 * Builds the prompt that turns one email reply into a structured answer.
 *
 * Kept separate from {@link parseEmailReply} so its wording can be tested without
 * reaching a model.
 */
export function buildEmailParsingPrompt({ question, replyBody }: { question: string; replyBody: string }): string {
  return [
    'A person was asked the following question by email:',
    '',
    question,
    '',
    'This is their reply, exactly as it arrived:',
    '',
    replyBody,
    '',
    'Extract their answer into the requested structure.',
  ].join('\n');
}

/**
 * Turns the free text of an email reply into the structured response a suspended
 * step is waiting for.
 *
 * Throws when the model cannot produce something the schema accepts. Callers are
 * expected to treat that as "this reply did not answer the question" rather than as
 * a failure of the run: a person who writes "let me think about it" has not answered,
 * and the request they were sent is still open.
 */
export async function parseEmailReply<TResponseSchema extends z.ZodObject<z.ZodRawShape>>({
  question,
  replyBody,
  responseSchema,
}: {
  question: string;
  replyBody: string;
  responseSchema: TResponseSchema;
}): Promise<z.output<TResponseSchema>> {
  const agent = await getEmailParsingAgent();

  const parsed = await agent.generate([{ role: 'user', content: buildEmailParsingPrompt({ question, replyBody }) }], {
    structuredOutput: { schema: responseSchema },
    toolChoice: 'none',
  });

  if (parsed.object === undefined || parsed.object === null) {
    throw new Error('The email parsing agent returned no structured response');
  }

  return responseSchema.parse(parsed.object);
}
